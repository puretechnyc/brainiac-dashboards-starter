import { json, err, uuid, readJson } from "../util.js";
import { timingSafeEqual } from "../auth.js";
const TABLES = ["client_updates", "client_north_stars", "goals_sync_runs"];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export function presentedGoalsWriteToken(request) {
  const dedicated = request.headers.get("x-goals-write-token");
  if (dedicated && dedicated.trim()) return dedicated.trim();
  const auth = request.headers.get("authorization") || "";
  const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
  return m ? m[1].trim() : null;
}
export async function isGoalsWriteToken(request, env) {
  const token = env && env.GOALS_WRITE_TOKEN;
  if (!token || typeof token !== "string" || token.trim() === "") return false;
  if (sameSecret(token, env && env.INTEGRATION_TOKEN)) return false;
  const presented = presentedGoalsWriteToken(request);
  if (!presented) return false;
  return timingSafeEqual(presented, token);
}
function sameSecret(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.trim() === "" || b.trim() === "") return false;
  return a.trim() === b.trim();
}
export async function goalsWriteAuth(request, env) {
  const token = env && env.GOALS_WRITE_TOKEN;
  if (!token || typeof token !== "string" || token.trim() === "") {
    return { ok: false, status: 503, message: "the goals writer is not configured", code: "goals_write_not_configured" };
  }
  if (sameSecret(token, env && env.INTEGRATION_TOKEN)) {
    return { ok: false, status: 503, message: "the goals writer is not configured correctly", code: "goals_write_secret_misconfigured" };
  }
  const presented = presentedGoalsWriteToken(request);
  if (!presented) return { ok: false, status: 401, message: "unauthorized", code: "unauthorized" };
  const ok = await timingSafeEqual(presented, token);
  if (!ok) return { ok: false, status: 401, message: "unauthorized", code: "unauthorized" };
  return { ok: true };
}
export async function goalsIntegrationSync(request, env) {
  const auth = await goalsWriteAuth(request, env);
  if (!auth.ok) return err(request, auth.message, auth.status, auth.code);
  if (request.method !== "POST") return err(request, "method not allowed", 405);
  const startedAt = (/* @__PURE__ */ new Date()).toISOString();
  const present = (await env.DB.prepare(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${TABLES.map(() => "?").join(",")})`
  ).bind(...TABLES).all()).results || [];
  if (present.length < TABLES.length) {
    return err(request, "the goals tables are not migrated", 503, "goals_tables_missing");
  }
  const body = await readJson(request, 512 * 1024);
  if (!body || !Array.isArray(body.updates)) {
    return err(request, "updates array required", 422);
  }
  if (body.north_stars !== void 0 && !Array.isArray(body.north_stars)) {
    return err(request, "north_stars must be an array", 422);
  }
  for (const u of body.updates) {
    if (!u || typeof u !== "object") return err(request, "invalid update row", 422);
    const ws = String(u.week_start || "");
    if (!ISO_DATE.test(ws)) return err(request, "week_start must be YYYY-MM-DD", 422);
  }
  const clientRows = (await env.DB.prepare(
    "SELECT id, name FROM clients WHERE archived = 0"
  ).all()).results || [];
  const clientMap = {};
  for (const c of clientRows) clientMap[String(c.name || "").toLowerCase().trim()] = c.id;
  const statements = [];
  const unmapped = [];
  const addUnmapped = (name) => {
    const n = String(name || "").trim();
    if (n && !unmapped.includes(n)) unmapped.push(n);
  };
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let nsUpdated = 0;
  let nsSkipped = 0;
  for (const u of body.updates) {
    const clientName = String(u.client_name || "").toLowerCase().trim();
    const clientId = clientMap[clientName];
    if (!clientId) {
      addUnmapped(u.client_name);
      skipped++;
      continue;
    }
    const teamMember = u.team_member || "";
    const sortOrder = u.sort_order || 0;
    const weekStart = String(u.week_start);
    const existing = await env.DB.prepare(
      `SELECT id FROM client_updates
        WHERE client_id = ? AND week_start = ? AND team_member = ? AND sort_order = ?`
    ).bind(clientId, weekStart, teamMember, sortOrder).first();
    if (existing) {
      statements.push({
        sql: `UPDATE client_updates SET
                week_label = ?, goals = ?, achievements = ?, department = ?,
                status = ?, is_internal = ?, updated_at = datetime('now')
              WHERE id = ?`,
        params: [
          u.week_label || "",
          u.goals || "",
          u.achievements || "",
          u.department || "",
          u.status || "",
          u.is_internal ? 1 : 0,
          existing.id
        ]
      });
      updated++;
    } else {
      statements.push({
        sql: `INSERT INTO client_updates
                (id, client_id, week_start, week_label, team_member, goals, achievements,
                 department, status, is_internal, sort_order)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [
          uuid(),
          clientId,
          weekStart,
          u.week_label || "",
          teamMember,
          u.goals || "",
          u.achievements || "",
          u.department || "",
          u.status || "",
          u.is_internal ? 1 : 0,
          sortOrder
        ]
      });
      created++;
    }
  }
  for (const ns of body.north_stars || []) {
    if (!ns || typeof ns !== "object") return err(request, "invalid north star row", 422);
    const clientName = String(ns.client_name || "").toLowerCase().trim();
    const clientId = clientMap[clientName];
    if (!clientId) {
      addUnmapped(ns.client_name);
      nsSkipped++;
      continue;
    }
    const existing = await env.DB.prepare(
      "SELECT id FROM client_north_stars WHERE client_id = ?"
    ).bind(clientId).first();
    if (existing) {
      statements.push({
        sql: `UPDATE client_north_stars SET statement = ?, updated_at = datetime('now') WHERE id = ?`,
        params: [ns.statement || "", existing.id]
      });
    } else {
      statements.push({
        sql: "INSERT INTO client_north_stars (id, client_id, statement) VALUES (?, ?, ?)",
        params: [uuid(), clientId, ns.statement || ""]
      });
    }
    nsUpdated++;
  }
  const partial = skipped > 0 || nsSkipped > 0 || unmapped.length > 0;
  const runId = uuid();
  const finishedAt = (/* @__PURE__ */ new Date()).toISOString();
  statements.push({
    sql: `INSERT INTO goals_sync_runs
            (id, started_at, finished_at, created_count, updated_count, skipped_count,
             north_stars_updated, north_stars_skipped, unmapped_clients, partial, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [
      runId,
      startedAt,
      finishedAt,
      created,
      updated,
      skipped,
      nsUpdated,
      nsSkipped,
      JSON.stringify(unmapped),
      partial ? 1 : 0,
      partial ? "partial" : "ok"
    ]
  });
  await env.DB.batch(statements.map((s) => env.DB.prepare(s.sql).bind(...s.params)));
  return json(request, {
    ok: true,
    run_id: runId,
    created,
    updated,
    skipped,
    north_stars_updated: nsUpdated,
    north_stars_skipped: nsSkipped,
    unmapped_clients: unmapped,
    partial,
    finished_at: finishedAt
  });
}
