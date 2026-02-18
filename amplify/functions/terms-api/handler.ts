import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { randomUUID } from "crypto";

const ddb = new DynamoDBClient({});

const TERMS_TABLE_NAME = process.env.TERMS_TABLE_NAME ?? "";
const CURRENT_TERMS_VERSION = process.env.CURRENT_TERMS_VERSION ?? "TOS_2026_02";

function resp(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "*",
      "access-control-allow-methods": "POST,OPTIONS",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  };
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const method = event.requestContext?.http?.method ?? "POST";

  if (method === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "*",
        "access-control-allow-methods": "POST,OPTIONS",
      },
      body: "",
    };
  }

  if (!TERMS_TABLE_NAME) return resp(500, { message: "TERMS_TABLE_NAME not configured" });

  let payload: any = {};
  try {
    payload = event.body ? JSON.parse(event.body) : {};
  } catch {
    return resp(400, { message: "Invalid JSON body" });
  }

  const termsVersion = String(payload?.termsVersion ?? "").trim();
  const sessionId = String(payload?.sessionId ?? "").trim();

  if (!termsVersion) return resp(400, { message: "termsVersion is required" });
  if (!sessionId) return resp(400, { message: "sessionId is required" });

  if (termsVersion !== CURRENT_TERMS_VERSION) {
    return resp(400, { message: "Unsupported termsVersion" });
  }

  const acceptanceId = randomUUID();
  const acceptedAt = new Date().toISOString();

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

  return resp(200, { acceptanceId, termsVersion });
};
