import { defineAuth } from "@aws-amplify/backend";
import { preSignUp } from "./pre-sign-up/resource";
import { preTokenGeneration } from "./pre-token-generation/resource";

export const auth = defineAuth({
  loginWith: { email: true },


  userAttributes: {
    givenName: { required: true, mutable: true },
    familyName: { required: true, mutable: true },
  },

  groups: ["Admin", "Staff"],


  triggers: {
    preSignUp,
    preTokenGeneration,
  },
});
