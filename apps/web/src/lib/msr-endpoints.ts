/**
 * Single source of truth for MotorsportReg API endpoints.
 *
 * MSR returns XML by default. The `.json` URL extension is the documented
 * mechanism for JSON responses — the Accept header alone is ignored.
 *
 * MSR has warned that the authorize URL may change without notice; keep it
 * here so any future update is a one-line change.
 */

export const MSR_REQUEST_TOKEN_URL =
  "https://api.motorsportreg.com/rest/tokens/request";

export const MSR_ACCESS_TOKEN_URL =
  "https://api.motorsportreg.com/rest/tokens/access";

/** Authenticated user profile — JSON via .json extension. */
export const MSR_ME_URL = "https://api.motorsportreg.com/rest/me.json";

/**
 * Base URL for the MSR OAuth authorization page.
 * Usage: `${MSR_AUTHORIZE_URL_BASE}?oauth_token=${token}`
 */
export const MSR_AUTHORIZE_URL_BASE =
  "https://www.motorsportreg.com/index.cfm/event/oauth";
