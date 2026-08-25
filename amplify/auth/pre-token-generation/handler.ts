// amplify/auth/pre-token-generation/handler.ts
//
// Pre-token-generation trigger: injects the `custom:entitlements` claim
// into every issued ID token (Req 6.1, 13.5).
//
// Table name resolution (Req 12, SSM fallback per design section 8): the
// direct ENTITLEMENT_TABLE_NAME env var wiring created an auth->data
// nested-stack circular dependency, so the data stack instead publishes the
// physical table name to an SSM parameter and this handler resolves it at
// cold start (cached for the container lifetime). ENTITLEMENT_TABLE_NAME,
// when set, still takes precedence as a direct override. There is NO
// discovery fallback (the former ListTables scan stays removed).
//
// Every non-success path fails CLOSED with an empty claim
// ({ country: "", allowedFeatures: [] }) and sign-in always completes:
//   - neither env var set / SSM read fails  -> error log + empty claim (Req 12.3/12.4)
//   - DynamoDB read failure                 -> error log + empty claim (Req 12.4)
//   - any read exceeding 5 seconds          -> empty claim via Promise.race (Req 6.5)
//   - no record for the user                -> empty claim (Req 6.4)

import type { PreTokenGenerationTriggerHandler } from "aws-lambda";
import { DynamoDBClient, GetItemCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";

const ddb = new DynamoDBClient({});
const ssm = new SSMClient({});

type Entitlements = { country: string; allowedFeatures: string[] };

const EMPTY_ENTITLEMENTS: Entitlements = { country: "", allowedFeatures: [] };

const READ_TIMEOUT_MS = 5_000;

/** Races a read against the 5-second budget (Req 6.5). */
async function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                `${label} exceeded ${READ_TIMEOUT_MS / 1000}s timeout`,
              ),
            ),
          READ_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Cached for the lifetime of the Lambda container (cold-start resolution). */
let cachedTableName: string | null = null;

/** Req 12.1, 12.3 — configuration is the exclusive source of the table
 *  name: ENTITLEMENT_TABLE_NAME directly, or ENTITLEMENT_TABLE_PARAMETER_NAME
 *  via SSM. No discovery fallback. */
async function resolveTableName(): Promise<string | null> {
  if (cachedTableName) return cachedTableName;

  const direct = (process.env.ENTITLEMENT_TABLE_NAME ?? "").trim();
  if (direct) {
    cachedTableName = direct;
    return direct;
  }

  const parameterName = (
    process.env.ENTITLEMENT_TABLE_PARAMETER_NAME ?? ""
  ).trim();
  if (!parameterName) {
    console.error(
      "[PreTokenGen] Neither ENTITLEMENT_TABLE_NAME nor " +
        "ENTITLEMENT_TABLE_PARAMETER_NAME is set",
    );
    return null;
  }

  try {
    const result = await withTimeout(
      ssm.send(new GetParameterCommand({ Name: parameterName })),
      "SSM parameter read",
    );
    const value = (result.Parameter?.Value ?? "").trim();
    if (!value) {
      console.error(
        `[PreTokenGen] SSM parameter ${parameterName} is empty`,
      );
      return null;
    }
    cachedTableName = value;
    return value;
  } catch (err) {
    // Fail closed; the next invocation retries the SSM read.
    console.error("[PreTokenGen] SSM parameter read failed:", err);
    return null;
  }
}

/** Reads the user's Entitlement record within the timeout budget.
 *  Returns the empty claim on every non-success path. */
async function readEntitlements(
  tableName: string,
  userId: string,
): Promise<Entitlements> {
  try {
    const result = await withTimeout(
      ddb.send(
        new GetItemCommand({
          TableName: tableName,
          Key: { userId: { S: userId } },
        }),
      ),
      "Entitlement read",
    );

    if (!result.Item) {
      console.log("[PreTokenGen] No entitlement record for", userId);
      return EMPTY_ENTITLEMENTS;
    }

    const item = unmarshall(result.Item);
    return {
      country: typeof item.country === "string" ? item.country : "",
      allowedFeatures: Array.isArray(item.allowedFeatures)
        ? item.allowedFeatures.map(String)
        : [],
    };
  } catch (err) {
    // Fail closed: an unreachable table yields NO access via the claim
    // rather than stale or guessed access (Req 12.4).
    console.error("[PreTokenGen] Entitlement read failed:", err);
    return EMPTY_ENTITLEMENTS;
  }
}

export const handler: PreTokenGenerationTriggerHandler = async (event) => {
  let ent: Entitlements = EMPTY_ENTITLEMENTS;

  const tableName = await resolveTableName();
  const userId = event.request.userAttributes?.sub ?? "";

  if (tableName && userId) {
    ent = await readEntitlements(tableName, userId);
  }

  // Req 13.5 — the claim is injected on EVERY issued token, including all
  // error paths, so token-based backend/API authorization keeps functioning.
  event.response = {
    claimsOverrideDetails: {
      claimsToAddOrOverride: {
        "custom:entitlements": JSON.stringify(ent),
      },
    },
  };

  return event;
};
