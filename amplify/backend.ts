import { defineBackend } from "@aws-amplify/backend";
import { ArnFormat, Stack } from "aws-cdk-lib";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import { StringParameter } from "aws-cdk-lib/aws-ssm";
import { HttpApi, CorsHttpMethod, HttpMethod } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";

import { auth } from "./auth/resource";
import { data } from "./data/resource";

import { preSignUp } from "./auth/pre-sign-up/resource";
import { preTokenGeneration } from "./auth/pre-token-generation/resource";

import { termsApi } from "./functions/terms-api/resource";

const backend = defineBackend({
  auth,
  data,
  preSignUp,
  preTokenGeneration,
  termsApi,
});


const termsTable = backend.data.resources.tables.TermsAcceptance;
termsTable.grantWriteData(backend.termsApi.resources.lambda);
backend.termsApi.addEnvironment("TERMS_TABLE_NAME", termsTable.tableName);
backend.termsApi.addEnvironment("CURRENT_TERMS_VERSION", "TOS_2026_02");
backend.termsApi.addEnvironment("ALLOWED_ORIGIN", "https://main.d3p8snpek9jhao.amplifyapp.com");


// PreTokenGen Lambda (granular-feature-entitlements, Req 12.2) — SSM
// fallback wiring (design section 8).
//
// The direct wiring (grantReadData + tableName env var) creates an
// auth->data CloudFormation edge, and the data stack already depends on
// auth (Cognito auth mode), which the pipeline rejected as a nested-stack
// circular dependency. To break the cycle, NO CloudFormation reference may
// flow from the data stack into the auth stack:
//
//   - the DATA stack publishes the physical table name to an SSM parameter
//     (depends only on resources it already owns)
//   - the AUTH-stack Lambda receives only STATIC strings: the parameter
//     name as an env var, and IAM policies whose ARNs are built from
//     pseudo-parameters (region/account) plus literals
//   - the handler resolves the table name from SSM at cold start
//
// The parameter name is qualified by the root stack name (concrete at
// synth time, so still no cross-stack reference) to keep sandbox and
// branch deployments in the same account from colliding.
// The former wildcard policy (dynamodb:* on resources: ["*"], including
// ListTables) remains removed; reads are scoped to Entitlement tables only.
const entitlementTable = backend.data.resources.tables["Entitlement"];
const preTokenLambda = backend.preTokenGeneration.resources.lambda;

const dataStack = Stack.of(entitlementTable);
const authStack = Stack.of(preTokenLambda);
// Walk to the ROOT stack: nested-stack names are deploy-time tokens, but the
// root stack's name (amplify-heimdall-<id>-...) is concrete at synth time.
let rootStack = dataStack;
while (rootStack.nestedStackParent) rootStack = rootStack.nestedStackParent;
const entitlementTableParamName = `/heimdall/${rootStack.stackName}/entitlement-table-name`;

new StringParameter(dataStack, "EntitlementTableNameParam", {
  parameterName: entitlementTableParamName,
  stringValue: entitlementTable.tableName,
});

preTokenLambda.addToRolePolicy(
  new PolicyStatement({
    actions: ["ssm:GetParameter"],
    resources: [
      authStack.formatArn({
        service: "ssm",
        resource: "parameter",
        resourceName: entitlementTableParamName.replace(/^\//, ""),
        arnFormat: ArnFormat.SLASH_RESOURCE_NAME,
      }),
    ],
  }),
);
preTokenLambda.addToRolePolicy(
  new PolicyStatement({
    actions: ["dynamodb:GetItem"],
    resources: [
      authStack.formatArn({
        service: "dynamodb",
        resource: "table",
        resourceName: "Entitlement-*",
        arnFormat: ArnFormat.SLASH_RESOURCE_NAME,
      }),
    ],
  }),
);
backend.preTokenGeneration.addEnvironment(
  "ENTITLEMENT_TABLE_PARAMETER_NAME",
  entitlementTableParamName,
);


const apiStack = backend.createStack("http-api-stack");

const httpApi = new HttpApi(apiStack, "HeimdallHttpApi", {
  apiName: "heimdallHttpApi",
  corsPreflight: {
    allowOrigins: ["https://main.d3p8snpek9jhao.amplifyapp.com"],
    allowHeaders: ["authorization", "content-type"],
    allowMethods: [CorsHttpMethod.POST, CorsHttpMethod.OPTIONS],
  },
});

httpApi.addRoutes({
  path: "/onboarding/terms/accept",
  methods: [HttpMethod.POST],
  integration: new HttpLambdaIntegration(
    "TermsAcceptIntegration",
    backend.termsApi.resources.lambda,
  ),
});

backend.addOutput({
  custom: {
    API: {
      heimdallHttpApi: {
        endpoint: httpApi.url,
        region: Stack.of(httpApi).region,
        apiName: "heimdallHttpApi",
      },
    },
  },
});

export default backend;