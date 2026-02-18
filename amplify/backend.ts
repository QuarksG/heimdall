import { defineBackend } from "@aws-amplify/backend";
import { Stack } from "aws-cdk-lib";
import { PolicyStatement, Effect } from "aws-cdk-lib/aws-iam";
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


const preTokenLambda = backend.preTokenGeneration.resources.lambda;

preTokenLambda.addToRolePolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: [
      "dynamodb:GetItem",
      "dynamodb:Query",
      "dynamodb:Scan",
      "dynamodb:ListTables",
      "dynamodb:DescribeTable",
    ],
    resources: ["*"],
  }),
);


const apiStack = backend.createStack("http-api-stack");

const httpApi = new HttpApi(apiStack, "HeimdallHttpApi", {
  apiName: "heimdallHttpApi",
  corsPreflight: {
    allowOrigins: ["*"],
    allowHeaders: ["*"],
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