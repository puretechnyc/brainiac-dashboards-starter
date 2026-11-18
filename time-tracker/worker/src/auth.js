import { uuid } from "./util.js";
const PBKDF2_ITERS = 1e5;
const enc = new TextEncoder();
function bufToB64(buf) {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function b64ToBuf(b64) {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes;
}
async function pbkdf2(password, saltBytes, iters) {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: saltBytes, iterations: iters, hash: "SHA-256" },
    keyMaterial,
    256
  );
  return bufToB64(bits);
}
export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PBKDF2_ITERS);
  return { hash, salt: bufToB64(salt), iters: PBKDF2_ITERS };
}
export async function timingSafeEqual(a, b) {
  const ha = await sha256Hex(a);
  const hb = await sha256Hex(b);
  let diff = 0;
  for (let i = 0; i < ha.length; i++) diff |= ha.charCodeAt(i) ^ hb.charCodeAt(i);
  return diff === 0;
}
export async function verifyPassword(password, storedHash, storedSaltB64, iters) {
  const computed = await pbkdf2(password, b64ToBuf(storedSaltB64), iters || PBKDF2_ITERS);
  return await timingSafeEqual(computed, storedHash);
}
export function newSessionToken() {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  return bufToB64(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export async function sha256Hex(str) {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(str));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const SESSION_TTL_MS = 12 * 60 * 60 * 1e3;
export const SESSION_IDLE_MS = 30 * 60 * 1e3;
export function isIdleExpired(lastUsedAt, nowMs = Date.now(), idleMs = SESSION_IDLE_MS) {
  if (!lastUsedAt) return false;
  const t = Date.parse(lastUsedAt);
  if (Number.isNaN(t)) return false;
  return nowMs - t > idleMs;
}
export async function createSession(env, userId) {
  const token = newSessionToken();
  const id = await sha256Hex(token);
  const now = /* @__PURE__ */ new Date();
  const expires = new Date(now.getTime() + SESSION_TTL_MS).toISOString();
  await env.DB.prepare(
    "INSERT INTO sessions (id, user_id, expires_at, last_used_at) VALUES (?, ?, ?, ?)"
  ).bind(id, userId, expires, now.toISOString()).run();
  return { token, expires };
}
export async function revokeAllSessions(env, userId) {
  await env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId).run();
}
export async function authenticate(env, request) {
  const authz = request.headers.get("Authorization") || "";
  const m = authz.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const id = await sha256Hex(m[1]);
  const row = await env.DB.prepare(
    `SELECT s.id AS sid, s.expires_at, s.last_used_at,
            u.id AS user_id, u.email, u.role, u.client_id, u.display_name, u.active
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = ?`
  ).bind(id).first();
  if (!row) return null;
  if (row.active === 0) {
    await env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(id).run();
    return null;
  }
  const now = Date.now();
  if (Date.parse(row.expires_at) < now || isIdleExpired(row.last_used_at, now)) {
    await env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(id).run();
    return null;
  }
  await env.DB.prepare("UPDATE sessions SET last_used_at = ? WHERE id = ?").bind(new Date(now).toISOString(), id).run();
  const roles = await loadStaffRoles(env, row.user_id);
  const manager = row.role === "employee" && roles.includes("manager");
  return {
    userId: row.user_id,
    email: row.email,
    role: row.role,
    clientId: row.client_id,
    displayName: row.display_name,
    roles,
    manager,
    effectiveRole: manager ? "manager" : row.role
  };
}
export async function tableExists(env, name) {
  const rows = (await env.DB.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name = ?`
  ).bind(name).all()).results || [];
  return rows.length > 0;
}
function isMissingTable(e, name) {
  const msg = String(e && e.message || e);
  return msg.includes(name) && /no such table|does not exist/i.test(msg);
}
export async function loadStaffRoles(env, userId) {
  try {
    const rows = (await env.DB.prepare(
      `SELECT role FROM staff_roles WHERE user_id = ?`
    ).bind(userId).all()).results || [];
    return rows.map((r) => r.role);
  } catch (e) {
    if (!isMissingTable(e, "staff_roles")) throw e;
    return [];
  }
}
export async function loadAllStaffRoles(env) {
  const map = /* @__PURE__ */ new Map();
  try {
    const rows = (await env.DB.prepare("SELECT user_id, role FROM staff_roles").all()).results || [];
    for (const r of rows) {
      if (!map.has(r.user_id)) map.set(r.user_id, []);
      map.get(r.user_id).push(r.role);
    }
  } catch (e) {
    if (!isMissingTable(e, "staff_roles")) throw e;
  }
  return map;
}
export const LOGIN_WINDOW_MIN = 15;
export const LOGIN_MAX_FAILS = 5;
export async function recentLoginFailures(env, { email, ip }) {
  const since = `-${LOGIN_WINDOW_MIN} minutes`;
  const emailFails = email ? (await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM login_attempts
      WHERE email = ? AND success = 0 AND created_at >= datetime('now', ?)`
  ).bind(email, since).first())?.n || 0 : 0;
  const ipFails = ip ? (await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM login_attempts
      WHERE ip = ? AND success = 0 AND created_at >= datetime('now', ?)`
  ).bind(ip, since).first())?.n || 0 : 0;
  return { emailFails, ipFails };
}
export async function recordLoginAttempt(env, { email, ip, success }) {
  await env.DB.prepare(
    "INSERT INTO login_attempts (id, email, ip, success) VALUES (?, ?, ?, ?)"
  ).bind(uuid(), email || "", ip || "", success ? 1 : 0).run();
}
export const PASSWORD_MIN_LEN = 12;
async function sha1HexUpper(str) {
  const digest = await crypto.subtle.digest("SHA-1", enc.encode(str));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
}
export async function isPasswordBreached(password, fetchImpl = fetch) {
  let sha1;
  try {
    sha1 = await sha1HexUpper(password);
  } catch (_) {
    return { breached: false, error: true };
  }
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);
  try {
    const res = await fetchImpl(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { "Add-Padding": "true" }
    });
    if (!res || !res.ok) return { breached: false, error: true };
    const text = await res.text();
    for (const line of text.split("\n")) {
      const hashSuffix = line.split(":")[0]?.trim().toUpperCase();
      if (hashSuffix && hashSuffix === suffix) return { breached: true, error: false };
    }
    return { breached: false, error: false };
  } catch (_) {
    return { breached: false, error: true };
  }
}
export async function validatePassword(password, fetchImpl = fetch) {
  if (typeof password !== "string" || password.length < PASSWORD_MIN_LEN) {
    return { ok: false, reason: `password must be >= ${PASSWORD_MIN_LEN} chars` };
  }
  const { breached, error } = await isPasswordBreached(password, fetchImpl);
  if (breached) return { ok: false, reason: "password appears in a known breach — choose another" };
  return { ok: true, hibpError: !!error };
}
const TEMP_PW_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
export function generateTempPassword() {
  const n = TEMP_PW_ALPHABET.length;
  const limit = 256 - 256 % n;
  const chars = [];
  while (chars.length < 16) {
    const buf = crypto.getRandomValues(new Uint8Array(32));
    for (const b of buf) {
      if (b < limit && chars.length < 16) chars.push(TEMP_PW_ALPHABET[b % n]);
    }
  }
  return [0, 4, 8, 12].map((i) => chars.slice(i, i + 4).join("")).join("-");
}
export async function destroySession(env, request) {
  const authz = request.headers.get("Authorization") || "";
  const m = authz.match(/^Bearer\s+(.+)$/i);
  if (!m) return;
  const id = await sha256Hex(m[1]);
  await env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(id).run();
}
export function isAdmin(p) {
  return p.role === "admin";
}
export function isEmployee(p) {
  return p.role === "employee";
}
export function isClient(p) {
  return p.role === "client";
}
export function canWrite(p) {
  return p.role === "admin" || p.role === "employee";
}
export function isManager(p) {
  if (!p || p.role !== "employee") return false;
  if (Array.isArray(p.roles)) return p.roles.includes("manager");
  return p.manager === true || p.manager === 1;
}
export function effectiveRole(p) {
  if (isAdmin(p)) return "admin";
  if (isManager(p)) return "manager";
  return p.role;
}
export function canManageAssignments(p) {
  return isAdmin(p) || isManager(p);
}
export function canApproveWorkRequests(p) {
  return isAdmin(p) || isManager(p);
}
export function timeEntryReadScope(p, alias = "t") {
  if (p.role === "admin") return { sql: "1=1", params: [] };
  if (p.role === "employee") return { sql: `${alias}.user_id = ?`, params: [p.userId] };
  return { sql: `${alias}.client_id = ? AND ${alias}.is_billable = 1`, params: [p.clientId] };
}
export function timesheetReadScope(p, alias = "ts") {
  if (p.role === "admin") return { sql: "1=1", params: [] };
  if (p.role === "employee") return { sql: `${alias}.user_id = ?`, params: [p.userId] };
  return { sql: `${alias}.client_id = ?`, params: [p.clientId] };
}
export function invoiceReadScope(p, alias = "i") {
  if (p.role === "admin") return { sql: "1=1", params: [] };
  if (p.role === "employee") return { sql: `${alias}.created_by = ?`, params: [p.userId] };
  return { sql: `${alias}.client_id = ?`, params: [p.clientId] };
}
export function clientReadScope(p, alias = "c") {
  if (p.role === "client") return { sql: `${alias}.id = ?`, params: [p.clientId] };
  return { sql: "1=1", params: [] };
}
export async function assignedClientIds(env, userId) {
  try {
    const rows = (await env.DB.prepare(
      "SELECT client_id FROM client_assignments WHERE user_id = ?"
    ).bind(userId).all()).results || [];
    return rows.map((r) => r.client_id);
  } catch (e) {
    if (!isMissingTable(e, "client_assignments")) throw e;
    return [];
  }
}
export async function assignedClientScope(env, p, alias = "c", col = "id") {
  if (isAdmin(p)) return { sql: "1=1", params: [] };
  if (!await tableExists(env, "client_assignments")) return { sql: "0=1", params: [] };
  return {
    sql: `${alias}.${col} IN (SELECT client_id FROM client_assignments WHERE user_id = ?)`,
    params: [p.userId]
  };
}
