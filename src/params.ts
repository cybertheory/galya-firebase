import { defineSecret, defineString } from "firebase-functions/params";

/** Bound at deploy; available via .value() at runtime when listed on the function. */
export const galyaApiKey = defineSecret("GALYA_API_KEY");
export const galyaWorkspaceId = defineString("GALYA_WORKSPACE_ID", { default: "" });
export const galyaBaseUrl = defineString("GALYA_BASE_URL", {
  default: "https://api.galya.io/v1",
});

export function secretBindings() {
  return [galyaApiKey];
}

export function applyGalyaEnvFromParams(): void {
  try {
    const key = galyaApiKey.value();
    if (key) process.env.GALYA_API_KEY = key;
  } catch {
    // Secret not available outside a request (e.g. module load) — rely on process.env
  }
  try {
    const ws = galyaWorkspaceId.value();
    if (ws) process.env.GALYA_WORKSPACE_ID = ws;
  } catch {
    /* ignore */
  }
  try {
    const base = galyaBaseUrl.value();
    if (base) process.env.GALYA_BASE_URL = base;
  } catch {
    /* ignore */
  }
}
