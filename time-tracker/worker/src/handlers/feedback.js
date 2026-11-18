import { json, err, readJson, uuid } from "../util.js";
import { isAdmin } from "../auth.js";
const MESSAGE_MAX = 4e3;
const PAGE_MAX = 300;
export async function createFeedback(request, env, p) {
  const b = await readJson(request);
  const message = String(b.message || "").trim();
  if (!message) return err(request, "message is required", 422, "message_required");
  if (message.length > MESSAGE_MAX) {
    return err(request, `message too long (max ${MESSAGE_MAX} characters)`, 422, "message_too_long");
  }
  const page = String(b.page || "").trim().slice(0, PAGE_MAX);
  const id = uuid();
  await env.DB.prepare(
    `INSERT INTO feedback (id, user_id, page, message, status) VALUES (?, ?, ?, ?, 'open')`
  ).bind(id, p.userId, page, message).run();
  const row = await env.DB.prepare("SELECT * FROM feedback WHERE id = ?").bind(id).first();
  return json(request, { ok: true, feedback: row }, 201);
}
export async function listFeedback(request, env, p, url) {
  if (!isAdmin(p)) return err(request, "admin only", 403);
  const clauses = [];
  const params = [];
  const status = url.searchParams.get("status");
  if (status === "open" || status === "done") {
    clauses.push("f.status = ?");
    params.push(status);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const limit = Math.min(Math.max(1, parseInt(url.searchParams.get("limit"), 10) || 100), 500);
  const offset = Math.max(0, parseInt(url.searchParams.get("offset"), 10) || 0);
  const rows = (await env.DB.prepare(
    `SELECT f.*, u.email AS user_email, u.display_name AS user_display_name
       FROM feedback f
       LEFT JOIN users u ON u.id = f.user_id
       ${where}
      ORDER BY f.created_at DESC
      LIMIT ? OFFSET ?`
  ).bind(...params, limit, offset).all()).results || [];
  const counts = await env.DB.prepare(
    `SELECT
       SUM(CASE WHEN status='open' THEN 1 ELSE 0 END) AS open,
       SUM(CASE WHEN status='done' THEN 1 ELSE 0 END) AS done
     FROM feedback`
  ).first();
  return json(request, {
    ok: true,
    feedback: rows,
    counts: { open: counts && counts.open || 0, done: counts && counts.done || 0 },
    limit,
    offset
  });
}
export async function updateFeedback(request, env, p, id) {
  if (!isAdmin(p)) return err(request, "admin only", 403);
  const b = await readJson(request);
  const status = b.status;
  if (status !== "open" && status !== "done") {
    return err(request, "status must be 'open' or 'done'", 422);
  }
  const cur = await env.DB.prepare("SELECT * FROM feedback WHERE id = ?").bind(id).first();
  if (!cur) return err(request, "not found", 404);
  if (status === "done") {
    await env.DB.prepare(
      `UPDATE feedback SET status='done', resolved_by=?, resolved_at=datetime('now'),
         updated_at=datetime('now') WHERE id=?`
    ).bind(p.userId, id).run();
  } else {
    await env.DB.prepare(
      `UPDATE feedback SET status='open', resolved_by=NULL, resolved_at=NULL,
         updated_at=datetime('now') WHERE id=?`
    ).bind(id).run();
  }
  const row = await env.DB.prepare("SELECT * FROM feedback WHERE id = ?").bind(id).first();
  return json(request, { ok: true, feedback: row });
}
