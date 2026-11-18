import { json, err, readJson, uuid } from "../util.js";
import { isAdmin, isEmployee } from "../auth.js";
const MAX_DEPT_NAME = 120;
async function departmentsTableExists(env) {
  try {
    const row = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='departments'"
    ).first();
    return Boolean(row);
  } catch {
    return false;
  }
}
function slugifyDeptId(name) {
  const base = String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
  return "dept_" + (base || uuid().slice(0, 8));
}
export async function listDepartments(request, env, p, url) {
  if (!isAdmin(p) && !isEmployee(p)) return err(request, "forbidden", 403);
  if (!await departmentsTableExists(env)) {
    return json(request, { ok: true, departments: [], migration_required: true });
  }
  const includeHidden = isAdmin(p) && url && url.searchParams.get("include_hidden") === "1";
  const where = includeHidden ? "" : "WHERE hidden = 0";
  const rows = (await env.DB.prepare(
    `SELECT id, name, sort_order, hidden FROM departments ${where} ORDER BY sort_order, name`
  ).all()).results || [];
  return json(request, { ok: true, departments: rows });
}
export async function createDepartment(request, env, p) {
  if (!isAdmin(p)) return err(request, "admin only", 403);
  if (!await departmentsTableExists(env)) {
    return err(request, "departments need database migration 025 (POST /api/admin/apply-migration-025)", 409, "migration_required");
  }
  const b = await readJson(request);
  const name = (b.name || "").trim();
  if (!name) return err(request, "name required", 422);
  if (name.length > MAX_DEPT_NAME) return err(request, `name too long (max ${MAX_DEPT_NAME} characters)`, 422);
  const dup = await env.DB.prepare(
    "SELECT id FROM departments WHERE lower(name) = lower(?)"
  ).bind(name).first();
  if (dup) return err(request, "a department with that name already exists", 409, "department_exists");
  const maxRow = await env.DB.prepare("SELECT COALESCE(MAX(sort_order), 0) AS m FROM departments").first();
  const sortOrder = Number(maxRow && maxRow.m || 0) + 1;
  let id = slugifyDeptId(name);
  const idTaken = await env.DB.prepare("SELECT id FROM departments WHERE id = ?").bind(id).first();
  if (idTaken) id = "dept_" + uuid().slice(0, 8);
  try {
    await env.DB.prepare(
      "INSERT INTO departments (id, name, sort_order, hidden) VALUES (?, ?, ?, 0)"
    ).bind(id, name, sortOrder).run();
  } catch (e) {
    if (/UNIQUE/i.test(String(e && e.message || e))) {
      return err(request, "a department with that name already exists", 409, "department_exists");
    }
    throw e;
  }
  const row = await env.DB.prepare("SELECT id, name, sort_order, hidden FROM departments WHERE id = ?").bind(id).first();
  return json(request, { ok: true, department: row }, 201);
}
export async function updateDepartment(request, env, p, id) {
  if (!isAdmin(p)) return err(request, "admin only", 403);
  if (!await departmentsTableExists(env)) {
    return err(request, "departments need database migration 025 (POST /api/admin/apply-migration-025)", 409, "migration_required");
  }
  const b = await readJson(request);
  const cur = await env.DB.prepare("SELECT id, name, sort_order, hidden FROM departments WHERE id = ?").bind(id).first();
  if (!cur) return err(request, "department not found", 404);
  let name = cur.name;
  if (b.name !== void 0) {
    name = (b.name || "").trim();
    if (!name) return err(request, "name cannot be empty", 422);
    if (name.length > MAX_DEPT_NAME) return err(request, `name too long (max ${MAX_DEPT_NAME} characters)`, 422);
    if (name.toLowerCase() !== cur.name.toLowerCase()) {
      const dup = await env.DB.prepare(
        "SELECT id FROM departments WHERE lower(name) = lower(?) AND id != ?"
      ).bind(name, id).first();
      if (dup) return err(request, "a department with that name already exists", 409, "department_exists");
    }
  }
  const hidden = b.hidden === void 0 ? cur.hidden : b.hidden ? 1 : 0;
  const sortOrder = b.sort_order === void 0 || !Number.isFinite(Number(b.sort_order)) ? cur.sort_order : Math.max(0, Math.round(Number(b.sort_order)));
  try {
    await env.DB.prepare(
      `UPDATE departments SET name = ?, hidden = ?, sort_order = ?, updated_at = datetime('now') WHERE id = ?`
    ).bind(name, hidden, sortOrder, id).run();
  } catch (e) {
    if (/UNIQUE/i.test(String(e && e.message || e))) {
      return err(request, "a department with that name already exists", 409, "department_exists");
    }
    throw e;
  }
  const row = await env.DB.prepare("SELECT id, name, sort_order, hidden FROM departments WHERE id = ?").bind(id).first();
  return json(request, { ok: true, department: row });
}
