import { createHash } from "node:crypto";

export function redactLastName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) return "?.";
  return trimmed[0]!.toUpperCase() + ".";
}

// Full-name-only key, independent of member_num. Used to self-heal legacy .axdb
// exports (e.g. the 2024 AxWare transition) where every driver row has a blank
// member_num, which would otherwise split one human into a distinct Driver per
// event. Never used as the primary identity — only to find merge/adopt
// candidates when an identityHash lookup misses (see ingest.ts's
// driver-resolution block), and to match a signed-in MSR user to their own
// Driver row (src/lib/driver-self.ts).
//
// Lives here rather than in ingest.ts so callers that only need the digest —
// notably the OAuth callback — don't drag ingest.ts's better-sqlite3 import
// into their bundle. ingest.ts re-exports it, so its existing importers are
// unaffected.
export function computeNameOnlyHash(firstName: string, lastName: string): string {
  const key = `${firstName.toLowerCase().trim()}|${lastName.toLowerCase().trim()}`;
  return createHash("sha256").update(key).digest("hex");
}
