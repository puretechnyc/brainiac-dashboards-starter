import { json, err, uuid, readJson } from "../util.js";
import { isAdmin, isClient } from "../auth.js";
export async function clientUpdates(request, env, p, url) {
  if (!isClient(p)) return err(request, "client portal is for client users only", 403);
  if (!p.clientId) return err(request, "no client_id bound to this user", 403);
  const clientId = p.clientId;
  const weekStart = url.searchParams.get("week_start");
  const limit = Math.min(Math.max(1, parseInt(url.searchParams.get("limit"), 10) || 50), 200);
  const offset = Math.max(0, parseInt(url.searchParams.get("offset"), 10) || 0);
  const clauses = ["client_id = ?", "is_internal = 0"];
  const params = [clientId];
  if (weekStart) {
    clauses.push("week_start = ?");
    params.push(weekStart);
  }
  const rows = (await env.DB.prepare(
    `SELECT id, week_start, week_label, goals, achievements, department, status, sort_order, created_at
       FROM client_updates
      WHERE ${clauses.join(" AND ")}
      ORDER BY week_start DESC, sort_order ASC
      LIMIT ? OFFSET ?`
  ).bind(...params, limit, offset).all()).results || [];
  const northStar = await env.DB.prepare(
    "SELECT statement FROM client_north_stars WHERE client_id = ?"
  ).bind(clientId).first();
  return json(request, {
    ok: true,
    updates: rows,
    north_star: northStar?.statement || null,
    limit,
    offset
  });
}
export async function clientUpdateWeeks(request, env, p) {
  if (!isClient(p)) return err(request, "client portal is for client users only", 403);
  if (!p.clientId) return err(request, "no client_id bound to this user", 403);
  const rows = (await env.DB.prepare(
    `SELECT DISTINCT week_start, week_label FROM client_updates
      WHERE client_id = ? AND is_internal = 0
      ORDER BY week_start DESC
      LIMIT 52`
  ).bind(p.clientId).all()).results || [];
  return json(request, { ok: true, weeks: rows });
}
export async function adminGoalsUpdates(request, env, p, url) {
  if (!isAdmin(p)) return err(request, "admin only", 403);
  const clientId = url.searchParams.get("client_id");
  const weekStart = url.searchParams.get("week_start");
  if (!clientId) return err(request, "client_id required", 422);
  const clauses = ["client_id = ?"];
  const params = [clientId];
  if (weekStart) {
    clauses.push("week_start = ?");
    params.push(weekStart);
  }
  const limit = Math.min(Math.max(1, parseInt(url.searchParams.get("limit"), 10) || 100), 500);
  const offset = Math.max(0, parseInt(url.searchParams.get("offset"), 10) || 0);
  const rows = (await env.DB.prepare(
    `SELECT * FROM client_updates WHERE ${clauses.join(" AND ")}
     ORDER BY week_start DESC, sort_order ASC
     LIMIT ? OFFSET ?`
  ).bind(...params, limit, offset).all()).results || [];
  return json(request, { ok: true, updates: rows, limit, offset });
}
export async function goalsSync(request, env, p) {
  if (!isAdmin(p)) return err(request, "admin only", 403);
  await env.DB.exec(`
    CREATE TABLE IF NOT EXISTS client_updates (
      id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      week_start TEXT NOT NULL, week_label TEXT NOT NULL DEFAULT '',
      team_member TEXT NOT NULL DEFAULT '', goals TEXT NOT NULL DEFAULT '',
      achievements TEXT NOT NULL DEFAULT '', department TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT '', is_internal INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_client_updates_client ON client_updates(client_id);
    CREATE INDEX IF NOT EXISTS idx_client_updates_week ON client_updates(week_start);
    CREATE INDEX IF NOT EXISTS idx_client_updates_combo ON client_updates(client_id, week_start);
    CREATE TABLE IF NOT EXISTS client_north_stars (
      id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      statement TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(client_id)
    );
  `);
  const body = await readJson(request);
  if (!body.updates || !Array.isArray(body.updates)) {
    return err(request, "updates array required", 422);
  }
  const clientRows = (await env.DB.prepare(
    "SELECT id, name FROM clients WHERE archived = 0"
  ).all()).results || [];
  const clientMap = {};
  for (const c of clientRows) {
    clientMap[c.name.toLowerCase().trim()] = c.id;
  }
  let created = 0;
  let updated = 0;
  let skipped = 0;
  const unmapped = [];
  for (const u of body.updates) {
    const clientName = (u.client_name || "").toLowerCase().trim();
    const clientId = clientMap[clientName];
    if (!clientId) {
      if (clientName && !unmapped.includes(u.client_name)) {
        unmapped.push(u.client_name);
      }
      skipped++;
      continue;
    }
    const existing = await env.DB.prepare(
      `SELECT id FROM client_updates
       WHERE client_id = ? AND week_start = ? AND team_member = ? AND sort_order = ?`
    ).bind(clientId, u.week_start, u.team_member || "", u.sort_order || 0).first();
    if (existing) {
      await env.DB.prepare(
        `UPDATE client_updates SET
           week_label = ?, goals = ?, achievements = ?, department = ?,
           status = ?, is_internal = ?, updated_at = datetime('now')
         WHERE id = ?`
      ).bind(
        u.week_label || "",
        u.goals || "",
        u.achievements || "",
        u.department || "",
        u.status || "",
        u.is_internal ? 1 : 0,
        existing.id
      ).run();
      updated++;
    } else {
      const id = uuid();
      await env.DB.prepare(
        `INSERT INTO client_updates
           (id, client_id, week_start, week_label, team_member, goals, achievements,
            department, status, is_internal, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        id,
        clientId,
        u.week_start,
        u.week_label || "",
        u.team_member || "",
        u.goals || "",
        u.achievements || "",
        u.department || "",
        u.status || "",
        u.is_internal ? 1 : 0,
        u.sort_order || 0
      ).run();
      created++;
    }
  }
  let nsUpdated = 0;
  if (body.north_stars && Array.isArray(body.north_stars)) {
    for (const ns of body.north_stars) {
      const clientName = (ns.client_name || "").toLowerCase().trim();
      const clientId = clientMap[clientName];
      if (!clientId) continue;
      const existing = await env.DB.prepare(
        "SELECT id FROM client_north_stars WHERE client_id = ?"
      ).bind(clientId).first();
      if (existing) {
        await env.DB.prepare(
          `UPDATE client_north_stars SET statement = ?, updated_at = datetime('now') WHERE id = ?`
        ).bind(ns.statement || "", existing.id).run();
      } else {
        await env.DB.prepare(
          "INSERT INTO client_north_stars (id, client_id, statement) VALUES (?, ?, ?)"
        ).bind(uuid(), clientId, ns.statement || "").run();
      }
      nsUpdated++;
    }
  }
  return json(request, {
    ok: true,
    created,
    updated,
    skipped,
    north_stars_updated: nsUpdated,
    unmapped_clients: unmapped
  });
}
