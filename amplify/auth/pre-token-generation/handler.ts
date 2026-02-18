// amplify/auth/pre-token-generation/handler.ts
import type { PreTokenGenerationTriggerHandler } from "aws-lambda";
import {
  DynamoDBClient,
  GetItemCommand,
  ListTablesCommand,
} from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";

const ddb = new DynamoDBClient({});

type Entitlements = { country: string; allowedFeatures: string[] };


let cachedTableName: string | null = null;


async function discoverEntitlementTable(): Promise<string | null> {
  if (cachedTableName) return cachedTableName;

  
  const envName = process.env.ENTITLEMENT_TABLE_NAME ?? "";
  if (envName) {
    cachedTableName = envName;
    return cachedTableName;
  }

  try {
    let lastTable: string | undefined;
   
    do {
      const result = await ddb.send(
        new ListTablesCommand({
          ExclusiveStartTableName: lastTable,
          Limit: 100,
        }),
      );

      const tables = result.TableNames ?? [];
      const match = tables.find(
        (t) => t.includes("Entitlement") && !t.includes("AccessRequest"),
      );

      if (match) {
        cachedTableName = match;
        console.log("[PreTokenGen] Discovered Entitlement table:", match);
        return cachedTableName;
      }

      lastTable = result.LastEvaluatedTableName;
    } while (lastTable);
  } catch (err) {
    console.error("[PreTokenGen] ListTables failed:", err);
  }

  console.warn("[PreTokenGen] Could not discover Entitlement table");
  return null;
}

export const handler: PreTokenGenerationTriggerHandler = async (event) => {
  let ent: Entitlements = { country: "", allowedFeatures: [] };

  
  const tableName = await discoverEntitlementTable();

  if (tableName) {
    try {
      const userId = event.request.userAttributes?.sub ?? "";

      if (userId) {
        const result = await ddb.send(
          new GetItemCommand({
            TableName: tableName,
            Key: { userId: { S: userId } },
          }),
        );

        if (result.Item) {
          const item = unmarshall(result.Item);
          ent = {
            country: typeof item.country === "string" ? item.country : "",
            allowedFeatures: Array.isArray(item.allowedFeatures)
              ? item.allowedFeatures.map(String)
              : [],
          };
          console.log("[PreTokenGen] Entitlement found for", userId, ent);
        } else {
          console.log("[PreTokenGen] No entitlement for", userId);
        }
      }
    } catch (err) {
      console.error("[PreTokenGen] DynamoDB read failed:", err);
    }
  }

 
  if (!ent.country && ent.allowedFeatures.length === 0) {
    const raw = String(
      (event.request.userAttributes as any)?.["custom:entitlements"] ?? "",
    ).trim();

    if (raw) {
      try {
        const parsed = JSON.parse(raw) as Entitlements;
        ent = {
          country: typeof parsed.country === "string" ? parsed.country : "",
          allowedFeatures: Array.isArray(parsed.allowedFeatures)
            ? parsed.allowedFeatures.map(String)
            : [],
        };
      } catch {
        // ignore malformed
      }
    }
  }

 
  event.response = {
    claimsOverrideDetails: {
      claimsToAddOrOverride: {
        "custom:entitlements": JSON.stringify(ent),
      },
    },
  };

  return event;
};