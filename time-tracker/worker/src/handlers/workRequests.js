import { json, err, readJson, uuid } from "../util.js";
import { canApproveWorkRequests, isAdmin, tableExists } from "../auth.js";
export async function hasWorkRequestTable(env) {
  return tableExists(env, "client_work_requests");
}
export async function listWorkRequests(request, env, p) {
  if (p.role === "client") return err(request, "client logins cannot request work", 403);
  if (!await hasWorkRequestTable(env)) {
    return err(request, "work requests need database migration 019 (POST /api/admin/apply-migration-019)", 409, "migration_required");
  }
  const mayDecide = canApproveWorkRequests(p);
  const rows = (await env.DB.prepare(
    `SELECT r.id, r.user_id, r.client_id, r.status, r.note, r.requested_at,
            r.decided_by, r.decided_at, r.decision_note,
            u.email AS requester_email, u.display_name AS requester_name,
            c.name AS client_name, c.slug AS client_slug, c.archived AS client_archived
       FROM client_work_requests r
       JOIN users u ON u.id = r.user_id
       JOIN clients c ON c.id = r.client_id
      ${mayDecide ? "" : "WHERE r.user_id = ?"}
      ORDER BY (r.status = 'pending') DESC, r.requested_at DESC`
  ).bind(...mayDecide ? [] : [p.userId]).all()).results || [];
  return json(request, {
    ok: true,
    can_decide: mayDecide,
    requests: rows.map((r) => ({
      id: r.id,
      user_id: r.user_id,
      requester_email: r.requester_email,
      requester_name: r.requester_name || r.requester_email,
      client_id: r.client_id,
      client_name: r.client_name,
      client_slug: r.client_slug || null,
      client_archived: r.client_archived === 1,
      status: r.status,
      note: r.note,
      requested_at: r.requested_at,
      decided_by: r.decided_by,
      decided_at: r.decided_at,
      decision_note: r.decision_note
    })),
    pending_count: rows.filter((r) => r.status === "pending").length
  });
}
export async function createWorkRequest(request, env, p) {
  if (p.role === "client") return err(request, "client logins cannot request work", 403);
  if (!await hasWorkRequestTable(env)) {
    return err(request, "work requests need database migration 019 (POST /api/admin/apply-migration-019)", 409, "migration_required");
  }
  const b = await readJson(request);
  const clientId = b.client_id ? String(b.client_id) : null;
  if (!clientId) return err(request, "client_id required", 422);
  const client = await env.DB.prepare("SELECT id, name, slug, archived FROM clients WHERE id = ?").bind(clientId).first();
  if (!client) return err(request, "no client with that id", 404);
  if (client.archived) return err(request, "that client is archived", 409, "client_archived");
  const assigned = await env.DB.prepare(
    "SELECT 1 AS ok FROM client_assignments WHERE user_id = ? AND client_id = ?"
  ).bind(p.userId, clientId).first();
  if (assigned) return err(request, "you are already assigned to that client", 409, "already_assigned");
  const pending = await env.DB.prepare(
    `SELECT id, requested_at FROM client_work_requests
      WHERE user_id = ? AND client_id = ? AND status = 'pending'`
  ).bind(p.userId, clientId).first();
  if (pending) {
    return json(request, {
      ok: false,
      error: "you already have a pending request for that client",
      code: "already_pending",
      request_id: pending.id,
      requested_at: pending.requested_at
    }, 409);
  }
  const note = String(b.note || "").slice(0, 1e3);
  const id = uuid();
  await env.DB.prepare(
    `INSERT INTO client_work_requests (id, user_id, client_id, note)
     VALUES (?, ?, ?, ?)`
  ).bind(id, p.userId, clientId, note).run();
  const row = await env.DB.prepare(
    `SELECT id, user_id, client_id, status, note, requested_at FROM client_work_requests WHERE id = ?`
  ).bind(id).first();
  return json(request, { ok: true, request: { ...row, client_name: client.name } }, 201);
}
export async function decideWorkRequest(request, env, p, id) {
  if (!canApproveWorkRequests(p)) return err(request, "admin or manager only", 403);
  if (!await hasWorkRequestTable(env)) {
    return err(request, "work requests need database migration 019 (POST /api/admin/apply-migration-019)", 409, "migration_required");
  }
  const b = await readJson(request);
  const decision = String(b.decision || "").toLowerCase();
  if (!["approve", "deny"].includes(decision)) {
    return err(request, "decision must be approve or deny", 422);
  }
  const cur = await env.DB.prepare(
    "SELECT id, user_id, client_id, status FROM client_work_requests WHERE id = ?"
  ).bind(String(id)).first();
  if (!cur) return err(request, "no work request with that id", 404);
  if (cur.status !== "pending") {
    return err(request, `this request is already ${cur.status}`, 409, "already_decided");
  }
  if (cur.user_id === p.userId && !isAdmin(p)) {
    return err(request, "a manager cannot decide their own request (an admin must)", 403, "self_decision");
  }
  const requester = await env.DB.prepare(
    "SELECT id, role, active FROM users WHERE id = ?"
  ).bind(cur.user_id).first();
  if (!requester) return err(request, "the requester no longer exists", 409, "requester_gone");
  if (requester.role === "client") return err(request, "a client login cannot be assigned staff work", 422);
  if (requester.active === 0) return err(request, "the requester is deactivated", 409, "requester_inactive");
  const decisionNote = String(b.note || "").slice(0, 1e3);
  const stmts = [];
  stmts.push(env.DB.prepare(
    `UPDATE client_work_requests
        SET status = ?, decided_by = ?, decided_at = datetime('now'), decision_note = ?
      WHERE id = ? AND status = 'pending'`
  ).bind(decision === "approve" ? "approved" : "denied", p.userId, decisionNote, cur.id));
  if (decision === "approve") {
    stmts.push(env.DB.prepare(
      `INSERT OR IGNORE INTO client_assignments (user_id, client_id, assigned_by)
       VALUES (?, ?, ?)`
    ).bind(cur.user_id, cur.client_id, p.userId));
  }
  await env.DB.batch(stmts);
  const row = await env.DB.prepare(
    `SELECT r.id, r.user_id, r.client_id, r.status, r.note, r.requested_at,
            r.decided_by, r.decided_at, r.decision_note, c.name AS client_name
       FROM client_work_requests r JOIN clients c ON c.id = r.client_id
      WHERE r.id = ?`
  ).bind(cur.id).first();
  const assignedNow = await env.DB.prepare(
    "SELECT 1 AS ok FROM client_assignments WHERE user_id = ? AND client_id = ?"
  ).bind(cur.user_id, cur.client_id).first();
  return json(request, {
    ok: true,
    decision: decision === "approve" ? "approved" : "denied",
    request: row,
    assigned: Boolean(assignedNow)
  });
}
export async function myWorkRequests(request, env, p) {
  if (p.role === "client") return err(request, "client logins cannot request work", 403);
  if (!await hasWorkRequestTable(env)) return json(request, { ok: true, requests: [], can_decide: false });
  const rows = (await env.DB.prepare(
    `SELECT r.id, r.client_id, r.status, r.note, r.requested_at, r.decided_at, c.name AS client_name
       FROM client_work_requests r JOIN clients c ON c.id = r.client_id
      WHERE r.user_id = ? ORDER BY r.requested_at DESC LIMIT 100`
  ).bind(p.userId).all()).results || [];
  return json(request, {
    ok: true,
    can_decide: canApproveWorkRequests(p),
    requests: rows
  });
}
