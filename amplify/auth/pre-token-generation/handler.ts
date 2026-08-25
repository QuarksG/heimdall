// amplify/auth/pre-token-generation/handler.ts
//
// Pre-token-generation trigger: injects the `custom:entitlements` claim
// into every issued ID token (Req 6.1, 13.5).
//
// Table name resolution (Req 12): the Entitlement table name comes
// EXCLUSIVELY from the ENTITLEMENT_TABLE_NAME environment variable wired in
// amplify/backend.ts — the former ListTables discovery scan is removed.
// Every non-success path fails CLOSED with an empty claim
// ({ country: "", allowedFeatures: [] }) and sign-in always completes:
//   - env var unset/empty      -> error log + empty claim (Req 12.3)
//   - DynamoDB read failure    -> error log + empty claim (Req 12.4)
//   - read exceeding 5 seconds -> empty claim via Promise.race (Req 6.5)
//   - no record for the user   -> empty claim (Req 6.4)

import type { PreTokenGenerationTriggerHandler } from "aws-lambda";
import { DynamoDBClient, GetItemCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";

const ddb = new DynamoDBClient({});

type Entitlements = { country: string; allowedFeatures: string[] };

const EMPTY_ENTITLEMENTS: Entitlements = { country: "", allowedFeatures: [] };

const READ_TIMEOUT_MS = 5_000;

/** Req 12.1, 12.3 — ENTITLEMENT_TABLE_NAME is the exclusive source of the
 *  table name; there is no discovery fallback. */
function resolveTableName(): string | null {
  const name = (process.env.ENTITLEMENT_TABLE_NAME ?? "").trim();
  if (!name) {
    console.error("[PreTokenGen] ENTITLEMENT_TABLE_NAME is unset or empty");
    return null;
  }
  return name;
}

/** Reads the user's Entitlement record, racing the read against a 5-second
 *  timeout (Req 6.5). Returns the empty claim on every non-success path. */
async function readEntitlements(
  tableName: string,
  userId: string,
): Promise<Entitlements> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      ddb.send(
        new GetItemCommand({
          TableName: tableName,
          Key: { userId: { S: userId } },
        }),
      ),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                `Entitlement read exceeded ${READ_TIMEOUT_MS / 1000}s timeout`,
              ),
            ),
          READ_TIMEOUT_MS,
        );
      }),
    ]);

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
  } finally {
    clearTimeout(timer);
  }
}

export const handler: PreTokenGenerationTriggerHandler = async (event) => {
  let ent: Entitlements = EMPTY_ENTITLEMENTS;

  const tableName = resolveTableName();
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
