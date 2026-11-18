import { json, err, SECURITY_HEADERS } from "./util.js";
import { createSession } from "./auth.js";
export const GOOGLE_REDIRECT_URI = "https://time.example.com/api/auth/google/callback";
export const GOOGLE_HD = "";
export function googleDomain(env) {
  const v = env && env.GOOGLE_WORKSPACE_DOMAIN;
  return typeof v === "string" ? v.trim().toLowerCase() : GOOGLE_HD;
}
export const GOOGLE_STATE_SECRET_MIN_BYTES = 32;
const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const JWKS_ENDPOINT = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_ISSUERS = /* @__PURE__ */ new Set(["https://accounts.google.com", "accounts.google.com"]);
const STATE_MAX_AGE_MS = 10 * 60 * 1e3;
const STATE_FUTURE_SKEW_MS = 60 * 1e3;
const CLOCK_SKEW_SEC = 300;
const JWKS_TTL_MS = 10 * 60 * 1e3;
const STATE_PURPOSE = "tt-google-state";
const BIND_COOKIE_HOST = "__Host-tt_google_bind";
const BIND_COOKIE_PLAIN = "tt_google_bind";
const BIND_COOKIE_MAX_AGE = 600;
const enc = new TextEncoder();
const dec = new TextDecoder();
function b64urlFromBytes(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlFromString(str) {
  return b64urlFromBytes(enc.encode(str));
}
function b64urlToBytes(b64url) {
  if (typeof b64url !== "string" || !/^[A-Za-z0-9_-]*$/.test(b64url)) throw new Error("bad base64url");
  const pad = "=".repeat((4 - b64url.length % 4) % 4);
  const s = atob(b64url.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes;
}
function b64urlToString(b64url) {
  return dec.decode(b64urlToBytes(b64url));
}
export function stateSecretOk(env) {
  const s = env && env.GOOGLE_STATE_SECRET;
  return typeof s === "string" && s.length >= GOOGLE_STATE_SECRET_MIN_BYTES;
}
function stateSecret(env) {
  return stateSecretOk(env) ? env.GOOGLE_STATE_SECRET : null;
}
export function googleConfigured(env) {
  if (!env) return false;
  if (typeof env.GOOGLE_CLIENT_ID !== "string" || !env.GOOGLE_CLIENT_ID) return false;
  if (typeof env.GOOGLE_CLIENT_SECRET !== "string" || !env.GOOGLE_CLIENT_SECRET) return false;
  return stateSecretOk(env);
}
export function redirectUri(env) {
  const v = env && env.GOOGLE_REDIRECT_URI;
  return typeof v === "string" && v.trim() ? v.trim() : GOOGLE_REDIRECT_URI;
}
export function randomCodeVerifier() {
  return b64urlFromBytes(crypto.getRandomValues(new Uint8Array(32)));
}
export function randomNonce() {
  return b64urlFromBytes(crypto.getRandomValues(new Uint8Array(16)));
}
export async function codeChallengeS256(codeVerifier) {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(codeVerifier));
  return b64urlFromBytes(new Uint8Array(digest));
}
export function randomBinding() {
  return b64urlFromBytes(crypto.getRandomValues(new Uint8Array(32)));
}
async function sha256B64url(value) {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(value));
  return b64urlFromBytes(new Uint8Array(digest));
}
export function parseCookies(header) {
  const out = /* @__PURE__ */ Object.create(null);
  if (typeof header !== "string") return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    if (!name || name in out) continue;
    let value = part.slice(eq + 1).trim();
    if (value.length > 1 && value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    try {
      out[name] = decodeURIComponent(value);
    } catch (_) {
      out[name] = value;
    }
  }
  return out;
}
function isSecureRequest(request) {
  try {
    return new URL(request.url).protocol === "https:";
  } catch (_) {
    return false;
  }
}
function bindCookieHeader(request, value) {
  const secure = isSecureRequest(request);
  const parts = [
    `${secure ? BIND_COOKIE_HOST : BIND_COOKIE_PLAIN}=${value}`,
    "Path=/",
    `Max-Age=${BIND_COOKIE_MAX_AGE}`,
    "HttpOnly",
    "SameSite=Lax"
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}
function clearBindCookieHeaders(request) {
  const secure = isSecureRequest(request);
  const suffix = secure ? "; Secure" : "";
  return [
    `${BIND_COOKIE_HOST}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${suffix}`,
    `${BIND_COOKIE_PLAIN}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${suffix}`
  ];
}
export function readBindCookie(request) {
  const header = request && request.headers ? request.headers.get("Cookie") : null;
  const jar = parseCookies(header);
  const name = isSecureRequest(request) ? BIND_COOKIE_HOST : BIND_COOKIE_PLAIN;
  return jar[name] || "";
}
async function hmacB64url(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return b64urlFromBytes(new Uint8Array(sig));
}
function constantTimeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
export async function makeState(env, { codeVerifier, nowMs = Date.now(), nonce, binding } = {}) {
  const secret = stateSecret(env);
  if (!secret) return null;
  if (typeof binding !== "string" || !binding) return null;
  const payload = {
    v: 2,
    iat: nowMs,
    n: nonce || randomNonce(),
    cv: codeVerifier,
    b: await sha256B64url(binding)
  };
  const body = b64urlFromString(JSON.stringify(payload));
  const sig = await hmacB64url(secret, `${STATE_PURPOSE}|${body}`);
  return `${body}.${sig}`;
}
export async function readState(env, state, { nowMs = Date.now(), maxAgeMs = STATE_MAX_AGE_MS } = {}) {
  const secret = stateSecret(env);
  if (!secret) return { ok: false, reason: "state secret not configured" };
  if (typeof state !== "string") return { ok: false, reason: "state missing" };
  const dot = state.indexOf(".");
  if (dot <= 0) return { ok: false, reason: "state malformed" };
  const body = state.slice(0, dot);
  const sig = state.slice(dot + 1);
  const expect = await hmacB64url(secret, `${STATE_PURPOSE}|${body}`);
  if (!constantTimeEqual(sig, expect)) return { ok: false, reason: "state signature mismatch" };
  let payload;
  try {
    payload = JSON.parse(b64urlToString(body));
  } catch (_) {
    return { ok: false, reason: "state decode failed" };
  }
  if (!payload || payload.v !== 2 || typeof payload.cv !== "string" || !payload.cv) {
    return { ok: false, reason: "state payload invalid" };
  }
  if (typeof payload.n !== "string" || !payload.n) return { ok: false, reason: "state payload invalid" };
  if (typeof payload.b !== "string" || !payload.b) return { ok: false, reason: "state payload invalid" };
  if (typeof payload.iat !== "number") return { ok: false, reason: "state payload invalid" };
  if (nowMs - payload.iat > maxAgeMs) return { ok: false, reason: "state expired" };
  if (payload.iat - nowMs > STATE_FUTURE_SKEW_MS) return { ok: false, reason: "state not yet valid" };
  return { ok: true, codeVerifier: payload.cv, nonce: payload.n, bind: payload.b, iat: payload.iat };
}
export function buildAuthUrl(env, { state, codeChallenge, loginHint, nonce } = {}) {
  const p = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(env),
    response_type: "code",
    scope: "openid email profile",
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state,
    hd: googleDomain(env),
    prompt: "select_account",
    access_type: "online",
    include_granted_scopes: "true"
  });
  if (nonce) p.set("nonce", nonce);
  if (loginHint) p.set("login_hint", loginHint);
  return `${AUTH_ENDPOINT}?${p.toString()}`;
}
export async function exchangeCode(env, { code, codeVerifier, fetchImpl = fetch } = {}) {
  const body = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    code,
    code_verifier: codeVerifier,
    grant_type: "authorization_code",
    redirect_uri: redirectUri(env)
  });
  let res;
  try {
    res = await fetchImpl(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: body.toString()
    });
  } catch (_) {
    return { ok: false, reason: "token exchange network error" };
  }
  if (!res || !res.ok) return { ok: false, reason: "token exchange failed" };
  let data;
  try {
    data = await res.json();
  } catch (_) {
    return { ok: false, reason: "token exchange parse error" };
  }
  if (!data || !data.id_token) return { ok: false, reason: "no id_token in token response" };
  return { ok: true, idToken: data.id_token, raw: data };
}
let jwksCache = { at: 0, keys: null };
export function resetJwksCache() {
  jwksCache = { at: 0, keys: null };
}
async function getJwks(force, fetchImpl) {
  const now = Date.now();
  if (!force && jwksCache.keys && now - jwksCache.at < JWKS_TTL_MS) return jwksCache.keys;
  const res = await fetchImpl(JWKS_ENDPOINT);
  if (!res || !res.ok) throw new Error("jwks fetch failed");
  const j = await res.json();
  if (!j || !Array.isArray(j.keys)) throw new Error("jwks malformed");
  jwksCache = { at: now, keys: j.keys };
  return j.keys;
}
export function emailAllowed(email, domain = GOOGLE_HD) {
  if (typeof email !== "string") return false;
  const e = email.trim().toLowerCase();
  const at = e.indexOf("@");
  if (at < 1 || at !== e.lastIndexOf("@")) return false;
  if (!domain) return false;
  return e.slice(at + 1) === domain;
}
export async function verifyIdToken(idToken, {
  clientId,
  fetchImpl = fetch,
  nowSec = Math.floor(Date.now() / 1e3),
  expectedNonce = null,
  allowedDomain = GOOGLE_HD
} = {}) {
  if (!idToken || typeof idToken !== "string") return { ok: false, reason: "missing id_token" };
  const parts = idToken.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed id_token" };
  let header;
  let claims;
  try {
    header = JSON.parse(b64urlToString(parts[0]));
    claims = JSON.parse(b64urlToString(parts[1]));
  } catch (_) {
    return { ok: false, reason: "malformed id_token" };
  }
  if (!header || header.alg !== "RS256") return { ok: false, reason: "bad algorithm" };
  if (header.typ !== void 0 && header.typ !== "JWT") return { ok: false, reason: "bad token type" };
  if (typeof header.kid !== "string" || !header.kid) return { ok: false, reason: "missing key id" };
  if (!claims || typeof claims !== "object") return { ok: false, reason: "malformed claims" };
  let jwk = null;
  try {
    for (const force of [false, true]) {
      const keys = await getJwks(force, fetchImpl);
      jwk = keys.find((k) => k.kid === header.kid && k.kty === "RSA" && (!k.alg || k.alg === "RS256"));
      if (jwk) break;
    }
  } catch (_) {
    return { ok: false, reason: "signing keys unavailable" };
  }
  if (!jwk) return { ok: false, reason: "unknown key id" };
  let signatureOk = false;
  try {
    const key = await crypto.subtle.importKey(
      "jwk",
      { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"]
    );
    signatureOk = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      b64urlToBytes(parts[2]),
      enc.encode(`${parts[0]}.${parts[1]}`)
    );
  } catch (_) {
    return { ok: false, reason: "signature check failed" };
  }
  if (!signatureOk) return { ok: false, reason: "bad signature" };
  if (!GOOGLE_ISSUERS.has(claims.iss)) return { ok: false, reason: "bad issuer" };
  if (!clientId || claims.aud !== clientId) return { ok: false, reason: "aud mismatch" };
  const exp = Number(claims.exp);
  if (!Number.isFinite(exp) || exp <= nowSec - CLOCK_SKEW_SEC) return { ok: false, reason: "token expired" };
  const iat = Number(claims.iat);
  if (!Number.isFinite(iat)) return { ok: false, reason: "missing issued-at" };
  if (iat > nowSec + CLOCK_SKEW_SEC) return { ok: false, reason: "issued in the future" };
  if (claims.nbf !== void 0) {
    const nbf = Number(claims.nbf);
    if (!Number.isFinite(nbf) || nbf > nowSec + CLOCK_SKEW_SEC) return { ok: false, reason: "not yet valid" };
  }
  if (typeof expectedNonce === "string" && expectedNonce) {
    if (typeof claims.nonce !== "string" || !constantTimeEqual(claims.nonce, expectedNonce)) {
      return { ok: false, reason: "nonce mismatch" };
    }
  }
  if (!(claims.email_verified === true || claims.email_verified === "true")) {
    return { ok: false, reason: "email not verified" };
  }
  const email = (claims.email || "").trim().toLowerCase();
  if (!emailAllowed(email, allowedDomain)) return { ok: false, reason: "email domain not allowed" };
  return { ok: true, email, claims };
}
export async function findActiveUserByEmail(env, email) {
  const e = (email || "").trim().toLowerCase();
  if (!e) return null;
  const u = await env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(e).first();
  if (!u) return null;
  if (u.active === 0) return null;
  return u;
}
function redirect(location, extraHeaders = {}) {
  const h = new Headers({
    Location: location,
    "Cache-Control": "private, no-store",
    ...SECURITY_HEADERS
  });
  for (const [k, v] of Object.entries(extraHeaders)) {
    if (Array.isArray(v)) {
      for (const one of v) h.append(k, one);
    } else h.set(k, v);
  }
  return new Response(null, { status: 302, headers: h });
}
function redirectWithToken(token, expires, extraHeaders) {
  const frag = `token=${encodeURIComponent(token)}&expires=${encodeURIComponent(expires)}`;
  return redirect(`/#${frag}`, extraHeaders);
}
function redirectAuthError(reason, extraHeaders) {
  return redirect(`/#auth_error=${encodeURIComponent(reason)}`, extraHeaders);
}
export function googleAvailable(request, env) {
  return json(request, { available: googleConfigured(env) });
}
export async function googleStart(request, env) {
  if (!googleConfigured(env)) return err(request, "google sign-in is not enabled", 404);
  const codeVerifier = randomCodeVerifier();
  const codeChallenge = await codeChallengeS256(codeVerifier);
  const nonce = randomNonce();
  const binding = randomBinding();
  const state = await makeState(env, { codeVerifier, nonce, binding });
  if (!state) return err(request, "google sign-in is not enabled", 404);
  return redirect(buildAuthUrl(env, { state, codeChallenge, nonce }), {
    "Set-Cookie": bindCookieHeader(request, binding)
  });
}
export async function googleCallback(request, env, url, deps = {}) {
  if (!googleConfigured(env)) return err(request, "google sign-in is not enabled", 404);
  const fetchImpl = deps.fetchImpl || fetch;
  const params = url.searchParams;
  if (params.get("error")) return redirectAuthError("google_declined");
  const code = params.get("code") || "";
  const state = params.get("state") || "";
  if (!code || !state) return redirectAuthError("bad_request");
  const st = await readState(env, state);
  if (!st.ok) return redirectAuthError("state");
  const cookieBinding = readBindCookie(request);
  if (!cookieBinding) return redirectAuthError("state");
  const bindHash = await sha256B64url(cookieBinding);
  if (!constantTimeEqual(bindHash, st.bind)) return redirectAuthError("state");
  const consumed = { "Set-Cookie": clearBindCookieHeaders(request) };
  const ex = await exchangeCode(env, { code, codeVerifier: st.codeVerifier, fetchImpl });
  if (!ex.ok) return redirectAuthError("exchange_failed", consumed);
  const vr = await verifyIdToken(ex.idToken, {
    clientId: env.GOOGLE_CLIENT_ID,
    fetchImpl,
    allowedDomain: googleDomain(env),
    expectedNonce: st.nonce
  });
  if (!vr.ok) return redirectAuthError("not_authorised", consumed);
  const user = await findActiveUserByEmail(env, vr.email);
  if (!user) return redirectAuthError("not_authorised", consumed);
  const { token, expires } = await createSession(env, user.id);
  return redirectWithToken(token, expires, consumed);
}
