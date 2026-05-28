export function isAdmin(msrUid: string | undefined | null): boolean {
  if (!msrUid) return false;
  const raw = process.env.ADMIN_MSR_UIDS;
  if (!raw) return false;
  const allowlist = raw.split(",").map((u) => u.trim()).filter(Boolean);
  return allowlist.includes(msrUid);
}
