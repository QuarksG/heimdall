import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { randomUUID } from "crypto";

const ddb = new DynamoDBClient({});

const TERMS_TABLE_NAME = process.env.TERMS_TABLE_NAME ?? "";
const CURRENT_TERMS_VERSION = process.env.CURRENT_TERMS_VERSION ?? "TOS_2026_02";
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN ?? "https://main.d3p8snpek9jhao.amplifyapp.com"; // NEW

function resp(statusCode: number, body: unknown, requestOrigin?: string) { // UPDATED: added requestOrigin param
  const origin = requestOrigin === ALLOWED_ORIGIN ? ALLOWED_ORIGIN : ""; // NEW
  return {
    statusCode,
    headers: {
      ...(origin ? { "access-control-allow-origin": origin } : {}), // UPDATED: was "*"
      "access-control-allow-methods": "POST,OPTIONS",
      "content-type": "application/json",
      "vary": "Origin", // NEW: cache correctness when response varies by origin
      // REMOVED: "access-control-allow-headers": "*"
    },
    body: JSON.stringify(body),
  };
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const requestOrigin = event.headers?.["origin"] ?? ""; // NEW

  // REMOVED: manual OPTIONS block (API Gateway handles preflight now)

  if (!TERMS_TABLE_NAME) return resp(500, { message: "TERMS_TABLE_NAME not configured" }, requestOrigin); // UPDATED

  let payload: any = {};
  try {
    payload = event.body ? JSON.parse(event.body) : {};
  } catch {
    return resp(400, { message: "Invalid JSON body" }, requestOrigin); // UPDATED
  }

  const termsVersion = String(payload?.termsVersion ?? "").trim();
  const sessionId = String(payload?.sessionId ?? "").trim();

  if (!termsVersion) return resp(400, { message: "termsVersion is required" }, requestOrigin); // UPDATED
  if (!sessionId) return resp(400, { message: "sessionId is required" }, requestOrigin); // UPDATED

  if (termsVersion !== CURRENT_TERMS_VERSION) {
    return resp(400, { message: "Unsupported termsVersion" }, requestOrigin); // UPDATED
  }

  const acceptanceId = randomUUID();
  const acceptedAt = new Date().toISOString();

  try {
    await ddb.send(
      new PutItemCommand({
        TableName: TERMS_TABLE_NAME,
        Item: marshall(
          {
            id: acceptanceId,
            termsVersion,
            sessionId,
            acceptedAt,
          },
          { removeUndefinedValues: true }
        ),
        ConditionExpression: "attribute_not_exists(id)",
      })
    );
  } catch (err) {
    console.error("[terms-api] DDB write failed:", err);
    return resp(500, { message: "Could not record acceptance" }, requestOrigin); // NEW: clean error path with CORS headers
  }

  return resp(200, { acceptanceId, termsVersion }, requestOrigin); // UPDATED
};