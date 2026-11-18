export const MAX_SLUG_LEN = 64;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export function normalizeSlug(raw) {
  if (raw === null || raw === void 0) return null;
  if (typeof raw !== "string") return null;
  const s = raw.trim().toLowerCase();
  if (s === "") return null;
  if (s.length > MAX_SLUG_LEN) return null;
  if (!SLUG_RE.test(s)) return null;
  return s;
}
export function isValidSlug(s) {
  return typeof s === "string" && s.length <= MAX_SLUG_LEN && SLUG_RE.test(s);
}
export function slugRejectionReason(raw) {
  if (raw === null || raw === void 0 || raw === "") return "slug required";
  if (typeof raw !== "string") return "slug must be a string";
  if (raw.trim() === "") return "slug required";
  if (raw.trim().length > MAX_SLUG_LEN) return `slug must be at most ${MAX_SLUG_LEN} characters`;
  if (!SLUG_RE.test(raw.trim().toLowerCase())) {
    return "slug must be lowercase letters, digits and single hyphens (e.g. acacia-medical)";
  }
  return null;
}
