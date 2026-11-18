import { json, err, readJson, uuid } from "../util.js";
import { isAdmin, isEmployee, clientReadScope } from "../auth.js";
export const EMPLOYEE_PROJECT_FIELDS = ["id", "name", "client_id", "archived", "client_name", "color"];
export function projectForEmployee(row) {
  const out = {};
  for (const k of EMPLOYEE_PROJECT_FIELDS) out[k] = row[k];
  return out;
}
async function allWithColor(env, buildSql, params) {
  try {
    return (await env.DB.prepare(buildSql(", c.color AS color")).bind(...params).all()).results || [];
  } catch (e) {
    if (!/color/i.test(String(e && e.message || e))) throw e;
    return (await env.DB.prepare(buildSql("")).bind(...params).all()).results || [];
  }
}
async function firstWithColor(env, buildSql, params) {
  try {
    return await env.DB.prepare(buildSql(", c.color AS color")).bind(...params).first();
  } catch (e) {
    if (!/color/i.test(String(e && e.message || e))) throw e;
    return await env.DB.prepare(buildSql("")).bind(...params).first();
  }
}
export async function listProjects(request, env, p, url) {
  const scope = clientReadScope(p, "c");
  const clientId = url && url.searchParams.get("client_id");
  const includeArchived = isAdmin(p) && url && url.searchParams.get("include_archived") === "1";
  const where = [scope.sql];
  const params = [...scope.params];
  if (clientId) {
    where.push("pr.client_id = ?");
    params.push(clientId);
  }
  if (!includeArchived) {
    where.push("pr.archived = 0");
    where.push("c.archived = 0");
  }
  const rows = { results: await allWithColor(env, (col) => `SELECT pr.*, c.name AS client_name${col}
       FROM projects pr
       JOIN clients c ON c.id = pr.client_id
      WHERE ${where.join(" AND ")}
      ORDER BY c.name, pr.name`, params) };
  let projects = rows.results || [];
  if (isEmployee(p)) projects = projects.map(projectForEmployee);
  return json(request, { ok: true, projects });
}
export async function createProject(request, env, p) {
  if (!isAdmin(p)) return err(request, "admin only", 403);
  const b = await readJson(request);
  const clientId = (b.client_id || "").trim();
  const name = (b.name || "").trim();
  if (!clientId || !name) return err(request, "client_id and name required", 422);
  const client = await env.DB.prepare("SELECT id, archived FROM clients WHERE id = ?").bind(clientId).first();
  if (!client) return err(request, "client_id not found", 404);
  if (client.archived) return err(request, "client is archived; restore it first", 409, "client_archived");
  const dup = await env.DB.prepare(
    "SELECT id FROM projects WHERE client_id = ? AND name = ?"
  ).bind(clientId, name).first();
  if (dup) return err(request, "a project with that name already exists for this client", 409);
  const id = uuid();
  await env.DB.prepare(
    `INSERT INTO projects (id, client_id, name, description, created_by)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(id, clientId, name, (b.description || "").trim(), p.userId).run();
  const row = await firstWithColor(env, (col) => `SELECT pr.*, c.name AS client_name${col} FROM projects pr
       JOIN clients c ON c.id = pr.client_id WHERE pr.id = ?`, [id]);
  return json(request, { ok: true, project: row }, 201);
}
export async function updateProject(request, env, p, id) {
  if (!isAdmin(p)) return err(request, "admin only", 403);
  const b = await readJson(request);
  const cur = await env.DB.prepare("SELECT * FROM projects WHERE id = ?").bind(id).first();
  if (!cur) return err(request, "project not found", 404);
  const name = b.name === void 0 ? cur.name : (b.name || "").trim();
  if (!name) return err(request, "name cannot be empty", 422);
  const description = b.description === void 0 ? cur.description : (b.description || "").trim();
  const archived = b.archived === void 0 ? cur.archived : b.archived ? 1 : 0;
  if (name !== cur.name) {
    const dup = await env.DB.prepare(
      "SELECT id FROM projects WHERE client_id = ? AND name = ? AND id != ?"
    ).bind(cur.client_id, name, id).first();
    if (dup) return err(request, "a project with that name already exists for this client", 409);
  }
  await env.DB.prepare(
    `UPDATE projects SET name=?, description=?, archived=?, updated_at=datetime('now') WHERE id=?`
  ).bind(name, description, archived, id).run();
  const row = await firstWithColor(env, (col) => `SELECT pr.*, c.name AS client_name${col} FROM projects pr
       JOIN clients c ON c.id = pr.client_id WHERE pr.id = ?`, [id]);
  return json(request, { ok: true, project: row });
}
