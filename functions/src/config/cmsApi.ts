import { defineString } from "firebase-functions/params";

// export const cmsApiToken = defineString("CMS_API_TOKEN", { default: "" });

export const CMS_API_BASE = "https://kievapts.com/api/1.1/json";

export const CMS_ENDPOINTS = {
  checkouts: "checkouts",
  checkins: "checkins",
}; 