import { json, err, readJson } from "../util.js";
import { canManageAssignments, isManager, loadAllStaffRoles, tableExists } from "../auth.js";
export async function hasAssignmentsTable(env) {
  return tableExists(env, "client_assignments");
}
export async function listAssignments(request, env, p) {
  if (!canManageAssignments(p)) return err(request, "admin or manager only", 403);
  if (!await hasAssignmentsTable(env)) {
    return err(request, "client assignments need database migration 019 (POST /api/admin/apply-migration-019)", 409, "migration_required");
  }
  const roleMap = await loadAllStaffRoles(env);
  const staffRows = (await env.DB.prepare(
    `SELECT id, email, display_name, role, active
       FROM users WHERE role <> 'client' ORDER BY display_name, email`
  ).all()).results || [];
  const clientRows = (await env.DB.prepare(
    "SELECT id, name, slug, archived FROM clients ORDER BY name"
  ).all()).results || [];
  const assignmentRows = (await env.DB.prepare(
    "SELECT a.user_id, a.client_id, a.assigned_by, a.assigned_at FROM client_assignments a"
  ).all()).results || [];
  const staff = new Map(staffRows.map((s) => {
    const roles = roleMap.get(s.id) || [];
    const manager = s.role === "employee" && roles.includes("manager");
    return [s.id, {
      user_id: s.id,
      email: s.email,
      name: s.display_name || s.email,
      role: s.role,
      roles,
      manager,
      effective_role: manager ? "manager" : s.role,
      active: s.active === 1 || s.active === void 0,
      clients: []
    }];
  }));
  const clients = new Map(clientRows.map((c) => [c.id, {
    client_id: c.id,
    slug: c.slug || null,
    name: c.name,
    archived: c.archived === 1,
    staff: []
  }]));
  for (const a of assignmentRows) {
    const s = staff.get(a.user_id);
    const c = clients.get(a.client_id);
    if (!s || !c) continue;
    s.clients.push({
      client_id: c.client_id,
      slug: c.slug,
      name: c.name,
      archived: c.archived,
      assigned_by: a.assigned_by,
      assigned_at: a.assigned_at
    });
    c.staff.push({ user_id: s.user_id, email: s.email, name: s.name, role: s.role, manager: s.manager });
  }
  return json(request, {
    ok: true,
    staff: [...staff.values()],
    clients: [...clients.values()],
    assignment_count: assignmentRows.length
  });
}
async function validateStaff(env, ids) {
  const bad = [];
  for (const id of ids) {
    const u = await env.DB.prepare("SELECT id, email, role, active FROM users WHERE id = ?").bind(String(id)).first();
    if (!u) {
      bad.push({ id: String(id), error: "no user with that id" });
      continue;
    }
    if (u.role === "client") {
      bad.push({ id: String(id), error: "a client login cannot be assigned as staff" });
      continue;
    }
    if (u.active === 0) {
      bad.push({ id: String(id), error: "that user is deactivated" });
      continue;
    }
  }
  return bad;
}
export async function applyClientTeam(env, p, client, userIds) {
  const bad = await validateStaff(env, userIds);
  if (bad.length) {
    return {
      ok: false,
      status: 422,
      code: "not_assignable",
      body: { ok: false, error: "one or more entries are not assignable", code: "not_assignable", not_assignable: bad }
    };
  }
  if (isManager(p) && userIds.includes(p.userId)) {
    return {
      ok: false,
      status: 403,
      code: "self_assignment",
      body: { ok: false, error: "a manager cannot assign themselves — an admin must do it", code: "self_assignment" }
    };
  }
  const stmts = [env.DB.prepare("DELETE FROM client_assignments WHERE client_id = ?").bind(client.id)];
  for (const uid of userIds) {
    stmts.push(env.DB.prepare(
      "INSERT INTO client_assignments (user_id, client_id, assigned_by) VALUES (?, ?, ?)"
    ).bind(uid, client.id, p.userId));
  }
  if (stmts.length) await env.DB.batch(stmts);
  return {
    ok: true,
    applied: {
      client_id: client.id,
      slug: client.slug || null,
      name: client.name || null,
      user_ids: userIds
    }
  };
}
export async function setClientTeam(request, env, p, id) {
  if (!canManageAssignments(p)) return err(request, "admin or manager only", 403);
  if (!await hasAssignmentsTable(env)) {
    return err(request, "client assignments need database migration 019 (POST /api/admin/apply-migration-019)", 409, "migration_required");
  }
  const b = await readJson(request);
  if (!Array.isArray(b.user_ids)) return err(request, "user_ids must be an array of user ids", 422);
  if (b.user_ids.length > 500) return err(request, "too many user_ids in one request (max 500)", 422);
  const client = await env.DB.prepare("SELECT id, name, slug, archived FROM clients WHERE id = ?").bind(String(id)).first();
  if (!client) return err(request, "no client with that id", 404);
  const userIds = [...new Set(b.user_ids.map(String))];
  const out = await applyClientTeam(env, p, client, userIds);
  if (!out.ok) return json(request, out.body, out.status);
  return json(request, {
    ok: true,
    applied: out.applied,
    assignment_count: (await env.DB.prepare("SELECT COUNT(*) AS n FROM client_assignments").first())?.n || 0
  });
}
export async function setAssignments(request, env, p) {
  if (!canManageAssignments(p)) return err(request, "admin or manager only", 403);
  if (!await hasAssignmentsTable(env)) {
    return err(request, "client assignments need database migration 019 (POST /api/admin/apply-migration-019)", 409, "migration_required");
  }
  const b = await readJson(request);
  const clientId = b.client_id ? String(b.client_id) : null;
  const userId = b.user_id ? String(b.user_id) : null;
  const hasUserIds = Array.isArray(b.user_ids);
  const hasClientIds = Array.isArray(b.client_ids);
  if ((clientId && hasUserIds) === (userId && hasClientIds)) {
    return err(request, "send client_id + user_ids, or user_id + client_ids", 422);
  }
  if (clientId && hasUserIds) {
    if (b.user_ids.length > 500) return err(request, "too many user_ids in one request (max 500)", 422);
  }
  if (userId && hasClientIds) {
    if (b.client_ids.length > 500) return err(request, "too many client_ids in one request (max 500)", 422);
  }
  let client = null;
  let user = null;
  if (clientId) {
    client = await env.DB.prepare("SELECT id, name, slug, archived FROM clients WHERE id = ?").bind(clientId).first();
    if (!client) return err(request, "no client with that id", 404);
  }
  if (userId) {
    user = await env.DB.prepare("SELECT id, email, display_name, role, active FROM users WHERE id = ?").bind(userId).first();
    if (!user) return err(request, "no user with that id", 404);
  }
  const validateClients = async (ids) => {
    const bad2 = [];
    for (const id of ids) {
      const c = await env.DB.prepare("SELECT id, name FROM clients WHERE id = ?").bind(String(id)).first();
      if (!c) bad2.push({ id: String(id), error: "no client with that id" });
    }
    return bad2;
  };
  const userIds = hasUserIds ? b.user_ids.map(String) : [];
  const clientIds = hasClientIds ? b.client_ids.map(String) : [];
  if (clientId) {
    const out = await applyClientTeam(env, p, client, userIds);
    if (!out.ok) return json(request, out.body, out.status);
    return json(request, {
      ok: true,
      applied: out.applied,
      assignment_count: (await env.DB.prepare("SELECT COUNT(*) AS n FROM client_assignments").first())?.n || 0
    });
  }
  if (isManager(p) && userId === p.userId) {
    return err(request, "a manager cannot assign themselves — an admin must do it", 403, "self_assignment");
  }
  const bad = await validateClients(clientIds);
  if (bad.length) {
    return json(request, {
      ok: false,
      error: "one or more entries are not assignable",
      code: "not_assignable",
      not_assignable: bad
    }, 422);
  }
  const stmts = [];
  stmts.push(env.DB.prepare("DELETE FROM client_assignments WHERE user_id = ?").bind(userId));
  for (const cid of clientIds) {
    stmts.push(env.DB.prepare(
      "INSERT INTO client_assignments (user_id, client_id, assigned_by) VALUES (?, ?, ?)"
    ).bind(userId, cid, p.userId));
  }
  if (stmts.length) await env.DB.batch(stmts);
  return json(request, {
    ok: true,
    applied: { user_id: userId, email: user?.email || null, client_ids: clientIds },
    assignment_count: (await env.DB.prepare("SELECT COUNT(*) AS n FROM client_assignments").first())?.n || 0
  });
}
