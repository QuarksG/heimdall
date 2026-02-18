// amplify/data/resource.ts
import { type ClientSchema, a, defineData } from "@aws-amplify/backend";

/**
 * DynamoDB schema — three models backing Heimdall auth & authorization.
 *
 * Authorization model:
 *  - TermsAcceptance: written by terms-api Lambda (pre-auth), Admin can read
 *  - AccessRequest:   owner can create + read own, Admin has full CRUD
 *  - Entitlement:     Admin full CRUD, pre-token-generation Lambda reads via SDK
 */

const schema = a.schema({
  /* ─── Terms Acceptance ─── */
  TermsAcceptance: a
    .model({
      termsVersion: a.string().required(),
      email: a.string(),
      sessionId: a.string(),
      acceptedAt: a.string().required(),
    })
    .authorization((allow) => [allow.group("Admin")]),

  /* ─── Access Request ─── */
  // Staff submits a request for country + feature access.
  // Admin reviews (approve/reject) via Settings panel.
  // "country" stores comma-separated ISO codes (e.g. "TR,DE,FR").
  AccessRequest: a
    .model({
      userId: a.string().required(),
      email: a.string().required(),
      fullName: a.string().required(),
      country: a.string().required(),
      requestedFeatures: a.string().required().array().required(),
      justification: a.string(),
      status: a.enum(["PENDING", "APPROVED", "REJECTED"]),
      reviewedBy: a.string(),
      reviewedAt: a.string(),
    })
    .authorization((allow) => [
      allow.owner().to(["create", "read"]),
      allow.group("Admin"),
    ]),

  /* ─── Entitlement ─── */
  // Source of truth for what a user can access.
  Entitlement: a
    .model({
      userId: a.string().required(),
      country: a.string().required(),
      allowedFeatures: a.string().required().array().required(),
      grantedBy: a.string().required(),
      grantedAt: a.string().required(),
    })
    .identifier(["userId"])
    .authorization((allow) => [allow.group("Admin")]),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: "userPool",
  },
});