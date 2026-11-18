const ALLOWED_ORIGIN_SUFFIXES = [
  ".time-tracker-staging.pages.dev",
  ".time-tracker.pages.dev",
  // add your own domain here, e.g. ".example.com"
];
export function corsHeaders(request) {
  const origin = request.headers.get("Origin") || "";
  let allow = "";
  try {
    const host = new URL(origin).hostname;
    if (ALLOWED_ORIGIN_SUFFIXES.some((s) => host === s.replace(/^\./, "") || host.endsWith(s))) {
      allow = origin;
    }
  } catch (_) {
  }
  const h = {
    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin, Authorization"
  };
  if (allow) h["Access-Control-Allow-Origin"] = allow;
  return h;
}
export const SECURITY_HEADERS = {
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer"
};
export function withSecurityHeaders(res) {
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) h.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}
export function json(request, body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "private, no-store",
      ...SECURITY_HEADERS,
      ...corsHeaders(request),
      ...extraHeaders
    }
  });
}
export function err(request, message, status = 400, code = void 0) {
  return json(request, { ok: false, error: message, code }, status);
}
export function uuid() {
  return crypto.randomUUID();
}
export function amountCents(hours, rateCents) {
  return Math.round(Number(hours) * Number(rateCents));
}
export function centsToStr(cents) {
  const sign = cents < 0 ? "-" : "";
  const a = Math.abs(cents);
  return `${sign}${Math.floor(a / 100)}.${String(a % 100).padStart(2, "0")}`;
}
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export function isIsoDate(s) {
  return typeof s === "string" && ISO_DATE.test(s) && !Number.isNaN(Date.parse(s));
}
export function isRealIsoDate(s) {
  if (!isIsoDate(s)) return false;
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(5, 7));
  const d = Number(s.slice(8, 10));
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}
const ET_WEEKDAY = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const ET_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  weekday: "short"
});
function etCalendarParts(date) {
  const parts = ET_FMT.formatToParts(date);
  const val = (t) => parts.find((p) => p.type === t)?.value;
  return {
    y: Number(val("year")),
    m: Number(val("month")),
    d: Number(val("day")),
    wd: ET_WEEKDAY[val("weekday")]
  };
}
export function weekStart(input) {
  let date;
  if (isIsoDate(input)) {
    date = /* @__PURE__ */ new Date(`${input}T12:00:00Z`);
  } else if (typeof input === "string" && input !== "" && !Number.isNaN(Date.parse(input))) {
    date = new Date(input);
  } else {
    return null;
  }
  if (Number.isNaN(date.getTime())) return null;
  const { y, m, d, wd } = etCalendarParts(date);
  const daysBack = wd === 0 ? 6 : wd - 1;
  const monday = new Date(Date.UTC(y, m - 1, d - daysBack));
  return monday.toISOString().slice(0, 10);
}
export function etToday(now = /* @__PURE__ */ new Date()) {
  const { y, m, d } = etCalendarParts(now);
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
export function etYear(now = /* @__PURE__ */ new Date()) {
  return etCalendarParts(now).y;
}
export function weekStartSunday(input) {
  return weekStart(input);
}
export function weekStartForDay(input, startDay = 1) {
  if (startDay === 1) return weekStart(input);
  let date;
  if (isIsoDate(input)) {
    date = /* @__PURE__ */ new Date(`${input}T12:00:00Z`);
  } else if (typeof input === "string" && input !== "" && !Number.isNaN(Date.parse(input))) {
    date = new Date(input);
  } else {
    return null;
  }
  if (Number.isNaN(date.getTime())) return null;
  const { y, m, d, wd } = etCalendarParts(date);
  const daysBack = (wd - startDay + 7) % 7;
  const anchor = new Date(Date.UTC(y, m - 1, d - daysBack));
  return anchor.toISOString().slice(0, 10);
}
export const dayDiff = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);
export function elapsedFraction(start, end, today) {
  if (end < today) return 1;
  if (start > today) return 0;
  const total = dayDiff(start, end) + 1;
  if (total <= 0) return 1;
  return (dayDiff(start, today) + 1) / total;
}
export async function readJson(request, capBytes = 32 * 1024) {
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > capBytes) {
    const e = new Error("request body too large");
    e.status = 413;
    throw e;
  }
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (_) {
    const e = new Error("invalid JSON");
    e.status = 400;
    throw e;
  }
}
