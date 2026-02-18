import { defineFunction } from "@aws-amplify/backend";

export const termsApi = defineFunction({
  name: "termsApi",
  resourceGroupName: "data",  
});
