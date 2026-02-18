// amplify/auth/pre-sign-up/handler.ts
import type { PreSignUpTriggerHandler } from "aws-lambda";

const ALLOWED_DOMAINS = new Set(["amazon.cz", "amazon.tr", "amazon.com"]);
const CURRENT_TERMS_VERSION = process.env.CURRENT_TERMS_VERSION ?? "TOS_2026_02";

export const handler: PreSignUpTriggerHandler = async (event) => {
  const email = String(event.request.userAttributes?.email ?? "").trim().toLowerCase();
  const domain = email.split("@")[1] ?? "";

  if (!email || !domain || !ALLOWED_DOMAINS.has(domain)) {
    throw new Error("Email domain is not allowed.");
  }

  // clientMetadata is sent from Register.tsx signUp({ options: { clientMetadata } })
  const meta = event.request.clientMetadata ?? {};
  const acceptanceId = String((meta as any).acceptanceId ?? "").trim();
  const termsVersion = String((meta as any).termsVersion ?? "").trim();

  if (!acceptanceId) {
    throw new Error("Terms acceptance is required.");
  }

  if (termsVersion !== CURRENT_TERMS_VERSION) {
    throw new Error("Terms version mismatch. Please re-accept the terms.");
  }

  // Keep normal Cognito flow (email verification / OTP)
  event.response.autoConfirmUser = false;
  event.response.autoVerifyEmail = false;

  return event;
};