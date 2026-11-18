import { json, err, readJson, isIsoDate, isRealIsoDate, uuid, weekStart } from "../util.js";
import { lockEntriesThrough } from "./lock-schedule.js";
import { CLIENT_COLORS } from "../colors.js";
import { isAdmin, isManager, hashPassword, validatePassword, revokeAllSessions, generateTempPassword, loadAllStaffRoles, tableExists } from "../auth.js";
import { normalizeSlug, slugRejectionReason } from "../slugs.js";
import { ensureTimesheet, clientWeekStart } from "./timesheets.js";
import { tagEntrySource } from "./weekly.js";
export async function listUsers(request, env, p) {
  const managerView = !isAdmin(p) && isManager(p);
  if (!isAdmin(p) && !managerView) return err(request, "admin only", 403);
  const rows = (await env.DB.prepare(
    `SELECT id, email, display_name, role, client_id, active, cost_rate_cents, email_verified,
            created_at, updated_at
       FROM users ORDER BY created_at DESC`
  ).all()).results || [];
  const roleMap = await loadAllStaffRoles(env);
  return json(request, {
    ok: true,
    users: rows.map((u) => {
      const roles = roleMap.get(u.id) || [];
      const row = {
        ...u,
        roles,
        manager: u.role === "employee" && roles.includes("manager"),
        effective_role: u.role === "employee" && roles.includes("manager") ? "manager" : u.role
      };
      if (!managerView) return row;
      const { cost_rate_cents, ...safe } = row;
      return safe;
    })
  });
}
export async function updateUser(request, env, p, id) {
  if (!isAdmin(p)) return err(request, "admin only", 403);
  const b = await readJson(request);
  const cur = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(id).first();
  if (!cur) return err(request, "user not found", 404);
  if (id === p.userId && b.active === false) {
    return err(request, "cannot deactivate your own account", 422);
  }
  if (id === p.userId && b.role && b.role !== "admin") {
    return err(request, "cannot change your own role", 422);
  }
  const next = {
    role: b.role || cur.role,
    active: b.active === void 0 ? cur.active : b.active ? 1 : 0,
    display_name: b.display_name ?? cur.display_name,
    client_id: b.client_id !== void 0 ? b.client_id : cur.client_id,
    cost_rate_cents: b.cost_rate_cents === void 0 ? cur.cost_rate_cents : Math.round(Number(b.cost_rate_cents))
  };
  if (b.cost_rate_cents !== void 0) {
    const n = b.cost_rate_cents;
    if (typeof n === "boolean" || n === null || typeof n === "string" && n.trim() === "" || !Number.isFinite(Number(n)) || Number(n) < 0 || Number(n) > 1e8) {
      return err(request, "hourly rate must be a number of 0 or more", 422, "bad_rate");
    }
  }
  if (b.display_name !== void 0) {
    if (typeof b.display_name !== "string" || !b.display_name.trim() || b.display_name.trim().length > 120) {
      return err(request, "name must be 1 to 120 characters", 422, "bad_name");
    }
    next.display_name = b.display_name.trim();
  }
  if (!["admin", "employee", "client"].includes(next.role)) {
    return err(request, "role must be admin, employee, or client", 422);
  }
  if (next.role === "client" && !next.client_id) {
    return err(request, "client role requires client_id", 422);
  }
  const wantsManager = b.manager === void 0 ? null : Boolean(b.manager);
  const rolesTable = await tableExists(env, "staff_roles");
  if (wantsManager !== null && !rolesTable) {
    return err(request, "staff roles need database migration 019 (POST /api/admin/apply-migration-019)", 409, "migration_required");
  }
  if (wantsManager === true && next.role !== "employee") {
    return err(request, "only an employee can be a manager (set the role to employee first)", 422);
  }
  const stmts = [];
  stmts.push(env.DB.prepare(
    `UPDATE users SET role=?, active=?, display_name=?, client_id=?, cost_rate_cents=?,
            updated_at=datetime('now')
      WHERE id=?`
  ).bind(
    next.role,
    next.active,
    next.display_name,
    next.client_id,
    next.cost_rate_cents,
    id
  ));
  if (rolesTable) {
    if (wantsManager === true) {
      stmts.push(env.DB.prepare(
        `INSERT OR IGNORE INTO staff_roles (user_id, role, granted_by) VALUES (?, 'manager', ?)`
      ).bind(id, p.userId));
    } else if (wantsManager === false) {
      stmts.push(env.DB.prepare(
        `DELETE FROM staff_roles WHERE user_id = ? AND role = 'manager'`
      ).bind(id));
    } else if (next.role !== "employee") {
      stmts.push(env.DB.prepare(
        `DELETE FROM staff_roles WHERE user_id = ? AND role = 'manager'`
      ).bind(id));
    }
  }
  if (next.active === 0) {
    stmts.push(env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(id));
  }
  await env.DB.batch(stmts);
  const row = await env.DB.prepare(
    `SELECT id, email, display_name, role, client_id, active, cost_rate_cents, email_verified,
            created_at, updated_at
       FROM users WHERE id = ?`
  ).bind(id).first();
  const roleMap = await loadAllStaffRoles(env);
  const roles = roleMap.get(id) || [];
  return json(request, {
    ok: true,
    user: {
      ...row,
      roles,
      manager: row.role === "employee" && roles.includes("manager"),
      effective_role: row.role === "employee" && roles.includes("manager") ? "manager" : row.role
    }
  });
}
export async function resetPassword(request, env, p, id) {
  if (!isAdmin(p)) return err(request, "admin only", 403);
  const b = await readJson(request);
  const generated = !b.new_password;
  const newPw = generated ? generateTempPassword() : String(b.new_password);
  if (!generated) {
    const pol = await validatePassword(newPw);
    if (!pol.ok) return err(request, pol.reason, 422);
  }
  const cur = await env.DB.prepare("SELECT id, email FROM users WHERE id = ?").bind(id).first();
  if (!cur) return err(request, "user not found", 404);
  if (id === p.userId) return err(request, "use change-password for your own account", 422);
  const { hash, salt, iters } = await hashPassword(newPw);
  await env.DB.prepare(
    `UPDATE users SET password_hash=?, password_salt=?, pbkdf2_iters=?, updated_at=datetime('now') WHERE id=?`
  ).bind(hash, salt, iters, id).run();
  await revokeAllSessions(env, id);
  await env.DB.prepare("DELETE FROM login_attempts WHERE email = ? AND success = 0").bind(cur.email.toLowerCase()).run();
  const res = json(request, { ok: true, email: cur.email, sessions_revoked: true, lockout_cleared: true, ...generated ? { temp_password: newPw } : {} });
  res.headers.set("Cache-Control", "no-store");
  return res;
}
export async function forceLogout(request, env, p, id) {
  if (!isAdmin(p)) return err(request, "admin only", 403);
  const cur = await env.DB.prepare("SELECT id FROM users WHERE id = ?").bind(id).first();
  if (!cur) return err(request, "user not found", 404);
  const result = await env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(id).run();
  return json(request, { ok: true, user_id: id, sessions_revoked: result.meta?.changes || 0 });
}
export async function lockBefore(request, env, p) {
  if (!isAdmin(p)) return err(request, "admin only", 403);
  const b = await readJson(request);
  if (!b.before_date || !isIsoDate(b.before_date)) {
    return err(request, "before_date (YYYY-MM-DD) required", 422);
  }
  if (!isRealIsoDate(b.before_date)) {
    return err(request, "before_date is not a date on the calendar", 422, "bad_date");
  }
  const through = beforeDateToThrough(b.before_date);
  const res = await lockEntriesThrough(env, through, p.userId, "manual");
  return json(request, {
    ok: true,
    before_date: b.before_date,
    through_date: through,
    entries_locked: res.entries_locked,
    timesheets_locked: res.timesheets_locked,
    audited: res.audited
  });
}
function beforeDateToThrough(beforeDate) {
  const [y, m, d] = String(beforeDate).split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d - 1));
  return t.toISOString().slice(0, 10);
}
export async function bulkImport(request, env, p) {
  if (!isAdmin(p)) return err(request, "admin only", 403);
  const b = await readJson(request);
  if (!Array.isArray(b.entries)) return err(request, "entries array required", 422);
  if (!await tableExists(env, "departments")) {
    return err(
      request,
      "departments need database migration 025 (POST /api/admin/apply-migration-025) — nothing was imported",
      409,
      "migration_required"
    );
  }
  const entryHasDeptCol = (await env.DB.prepare("PRAGMA table_info(time_entries)").all()).results.some((c) => c.name === "department_id");
  const deptOk = /* @__PURE__ */ new Map();
  async function departmentValid(id) {
    if (!id) return false;
    if (deptOk.has(id)) return deptOk.get(id);
    let row;
    try {
      row = await env.DB.prepare("SELECT id, hidden FROM departments WHERE id = ?").bind(id).first();
    } catch (e) {
      if (!/no such table: departments/i.test(String(e && e.message || e))) throw e;
      row = null;
    }
    const ok = !!row && !row.hidden;
    deptOk.set(id, ok);
    return ok;
  }
  const batchDept = b.department_id == null ? "" : String(b.department_id).trim();
  const results = { created: 0, failed: 0, errors: [] };
  for (const e of b.entries) {
    try {
      if (!e.client_id || !e.user_id || !e.entry_date) {
        results.failed++;
        continue;
      }
      const rowDept = e.department_id == null ? "" : String(e.department_id).trim();
      const departmentId = rowDept || batchDept;
      if (!departmentId || !await departmentValid(departmentId)) {
        results.failed++;
        if (results.errors.length < 5) results.errors.push(`row for ${e.user_id}/${e.client_id} ${e.entry_date}: missing or invalid department`);
        continue;
      }
      const hours = Number(e.hours) || 0;
      const client = await env.DB.prepare("SELECT * FROM clients WHERE id = ?").bind(e.client_id).first();
      if (!client) {
        results.failed++;
        continue;
      }
      if (client.paused) {
        results.failed++;
        if (results.errors.length < 5) results.errors.push(`client_paused: ${client.name}`);
        continue;
      }
      const rate = Number.isFinite(e.rate_cents) ? Math.max(0, Math.round(e.rate_cents)) : client.rate_cents;
      const isBillable = e.is_billable ? 1 : 0;
      const wk = await clientWeekStart(env, e.client_id, e.entry_date);
      const ts = await ensureTimesheet(env, e.user_id, e.client_id, wk);
      const id = uuid();
      const cols = ["id", "user_id", "client_id", "project_task", "entry_date", "hours", "rate_cents", "is_billable", "notes", "timesheet_id", "entry_type"];
      const vals = [id, e.user_id, e.client_id, e.project_task || "", e.entry_date, hours, rate, isBillable, e.notes || "", ts.id, "work"];
      if (entryHasDeptCol) {
        cols.push("department_id");
        vals.push(departmentId);
      }
      await env.DB.prepare(
        `INSERT INTO time_entries (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`
      ).bind(...vals).run();
      await tagEntrySource(env, id, "import");
      results.created++;
    } catch (err2) {
      results.failed++;
      if (results.errors.length < 5) results.errors.push(String(err2).slice(0, 200));
    }
  }
  return json(request, { ok: true, ...results });
}
export async function applyMigration015(request, env, p) {
  if (!isAdmin(p)) return err(request, "admin only", 403);
  const applied = [];
  const skipped = [];
  async function step(label, sql) {
    try {
      await env.DB.prepare(sql).run();
      applied.push(label);
    } catch (e) {
      const msg = String(e && e.message || e);
      if (/duplicate column|already exists/i.test(msg)) skipped.push(label + " (already present)");
      else throw e;
    }
  }
  await step(
    "users.cost_rate_cents",
    "ALTER TABLE users ADD COLUMN cost_rate_cents INTEGER NOT NULL DEFAULT 0"
  );
  await step("projects table", `CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      archived INTEGER NOT NULL DEFAULT 0,
      created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(client_id, name)
    )`);
  await step(
    "idx_projects_client",
    "CREATE INDEX IF NOT EXISTS idx_projects_client ON projects(client_id, archived)"
  );
  await step(
    "time_entries.project_id",
    "ALTER TABLE time_entries ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE SET NULL"
  );
  await step(
    "idx_time_entries_project",
    "CREATE INDEX IF NOT EXISTS idx_time_entries_project ON time_entries(project_id)"
  );
  const cols = await env.DB.prepare("PRAGMA table_info(users)").all();
  const hasRate = (cols.results || []).some((c) => c.name === "cost_rate_cents");
  const tcols = await env.DB.prepare("PRAGMA table_info(time_entries)").all();
  const hasProj = (tcols.results || []).some((c) => c.name === "project_id");
  const tbl = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='projects'"
  ).first();
  return json(request, {
    ok: Boolean(hasRate && hasProj && tbl),
    applied,
    skipped,
    verified: { users_cost_rate_cents: hasRate, time_entries_project_id: hasProj, projects_table: Boolean(tbl) }
  });
}
export const MIGRATION_016_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS entry_edit_override (
  entry_id   TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`,
  `CREATE TABLE IF NOT EXISTS entry_deletions (
  id           TEXT PRIMARY KEY,
  entry_id     TEXT NOT NULL,
  deleted_by   TEXT NOT NULL,
  reason       TEXT NOT NULL DEFAULT '',
  was_approved INTEGER NOT NULL DEFAULT 0,
  snapshot     TEXT NOT NULL,                 -- JSON of the full row at deletion time
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
)`,
  `CREATE INDEX IF NOT EXISTS idx_entry_deletions_entry ON entry_deletions(entry_id)`,
  `DROP TRIGGER IF EXISTS trg_time_entries_locked_no_update`,
  `CREATE TRIGGER trg_time_entries_locked_no_update
BEFORE UPDATE ON time_entries
FOR EACH ROW WHEN OLD.locked = 1
  AND NOT (OLD.invoice_id IS NULL AND EXISTS (SELECT 1 FROM entry_edit_override o WHERE o.entry_id = OLD.id))
  AND (
     NEW.hours           <> OLD.hours
  OR NEW.rate_cents       <> OLD.rate_cents
  OR NEW.entry_date       <> OLD.entry_date
  OR NEW.client_id        <> OLD.client_id
  OR NEW.user_id          <> OLD.user_id
  OR NEW.project_task     <> OLD.project_task
  OR NEW.is_billable      <> OLD.is_billable
  OR NEW.notes            <> OLD.notes
  OR NEW.approval_status  <> OLD.approval_status
  OR NEW.locked           <> OLD.locked
  OR NEW.timesheet_id IS NOT OLD.timesheet_id
  OR (OLD.invoice_id IS NOT NULL AND NEW.invoice_id IS NOT OLD.invoice_id)
)
BEGIN
  SELECT RAISE(ABORT, 'time_entry is approved+locked and immutable');
END`,
  `DROP TRIGGER IF EXISTS trg_time_entries_locked_no_delete`,
  `CREATE TRIGGER trg_time_entries_locked_no_delete
BEFORE DELETE ON time_entries
FOR EACH ROW WHEN OLD.locked = 1
  AND NOT (OLD.invoice_id IS NULL AND EXISTS (SELECT 1 FROM entry_edit_override o WHERE o.entry_id = OLD.id))
BEGIN
  SELECT RAISE(ABORT, 'time_entry is approved+locked and immutable');
END`
];
export async function applyMigration016(request, env, p) {
  if (!isAdmin(p)) return err(request, "admin only", 403);
  for (const sql of MIGRATION_016_STATEMENTS) await env.DB.prepare(sql).run();
  const names = ["entry_edit_override", "entry_deletions"];
  const tables = {};
  for (const n of names) {
    tables[n] = Boolean(await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").bind(n).first());
  }
  const trg = await env.DB.prepare(
    "SELECT sql FROM sqlite_master WHERE type='trigger' AND name='trg_time_entries_locked_no_update'"
  ).first();
  const triggerUpdated = Boolean(trg && /entry_edit_override/.test(trg.sql));
  return json(request, { ok: names.every((n) => tables[n]) && triggerUpdated, tables, trigger_updated: triggerUpdated });
}
export async function applyMigration017(request, env, p) {
  if (!isAdmin(p)) return err(request, "admin only", 403);
  const applied = [];
  const skipped = [];
  try {
    await env.DB.prepare(
      `ALTER TABLE clients ADD COLUMN color TEXT
         CHECK (color IS NULL OR (length(color) = 7 AND substr(color, 1, 1) = '#' AND substr(color, 2) NOT GLOB '*[^0-9a-fA-F]*'))`
    ).run();
    applied.push("clients.color");
  } catch (e) {
    if (/duplicate column/i.test(String(e && e.message || e))) skipped.push("clients.color (already present)");
    else throw e;
  }
  const rows = (await env.DB.prepare("SELECT id FROM clients WHERE color IS NULL ORDER BY rowid").all()).results || [];
  const used = (await env.DB.prepare("SELECT COUNT(*) AS n FROM clients WHERE color IS NOT NULL").first()).n || 0;
  let i = used;
  for (const r of rows) {
    await env.DB.prepare("UPDATE clients SET color = ? WHERE id = ?").bind(CLIENT_COLORS[i % CLIENT_COLORS.length], r.id).run();
    i += 1;
  }
  const cols = (await env.DB.prepare("PRAGMA table_info(clients)").all()).results || [];
  const has = cols.some((c) => c.name === "color");
  const missing = (await env.DB.prepare("SELECT COUNT(*) AS n FROM clients WHERE color IS NULL").first()).n;
  return json(request, { ok: Boolean(has && missing === 0), applied, skipped, backfilled: rows.length, clients_without_color: missing });
}
export async function applyMigration018(request, env, p) {
  if (!isAdmin(p)) return err(request, "admin only", 403);
  const applied = [];
  const skipped = [];
  try {
    await env.DB.prepare("ALTER TABLE clients ADD COLUMN slug TEXT").run();
    applied.push("clients.slug");
  } catch (e) {
    const msg = String(e && e.message || e);
    if (/duplicate column/i.test(msg)) skipped.push("clients.slug (already present)");
    else throw e;
  }
  try {
    await env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_slug ON clients(slug)").run();
    applied.push("idx_clients_slug");
  } catch (e) {
    const msg = String(e && e.message || e);
    if (/already exists/i.test(msg)) skipped.push("idx_clients_slug (already present)");
    else throw e;
  }
  const cols = (await env.DB.prepare("PRAGMA table_info(clients)").all()).results || [];
  const has = cols.some((c) => c.name === "slug");
  return json(request, { ok: Boolean(has), applied, skipped, column_present: has });
}
export async function applyMigration020(request, env, p) {
  if (!isAdmin(p)) return err(request, "admin only", 403);
  const applied = [];
  const skipped = [];
  try {
    await env.DB.prepare(
      `ALTER TABLE time_entries ADD COLUMN source TEXT CHECK (source IS NULL OR source IN ('timer','manual','import'))`
    ).run();
    applied.push("time_entries.source");
  } catch (e) {
    const msg = String(e && e.message || e);
    if (/duplicate column/i.test(msg)) skipped.push("time_entries.source (already present)");
    else throw e;
  }
  const had = (await env.DB.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='app_settings'`).all()).results || [];
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS app_settings (
       key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_by TEXT,
       updated_at TEXT NOT NULL DEFAULT (datetime('now')))`
  ).run();
  (had.length ? skipped : applied).push(had.length ? "app_settings (already present)" : "app_settings");
  const cols = (await env.DB.prepare("PRAGMA table_info(time_entries)").all()).results || [];
  const has = cols.some((c) => c.name === "source");
  return json(request, { ok: Boolean(has), applied, skipped, column_present: has });
}
export async function applyMigration021(request, env, p) {
  if (!isAdmin(p)) return err(request, "admin only", 403);
  const applied = [];
  const skipped = [];
  try {
    await env.DB.prepare("ALTER TABLE time_entries ADD COLUMN entered_by TEXT REFERENCES users(id)").run();
    applied.push("time_entries.entered_by");
  } catch (e) {
    const msg = String(e && e.message || e);
    if (/duplicate column/i.test(msg)) skipped.push("time_entries.entered_by (already present)");
    else throw e;
  }
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_entries_entered_by ON time_entries(entered_by)").run();
  const cols = (await env.DB.prepare("PRAGMA table_info(time_entries)").all()).results || [];
  const has = cols.some((c) => c.name === "entered_by");
  return json(request, { ok: Boolean(has), applied, skipped, column_present: has });
}
export async function applyMigration022(request, env, p) {
  if (!isAdmin(p)) return err(request, "admin only", 403);
  const existed = ((await env.DB.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='member_weights'`
  ).all()).results || []).length > 0;
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS member_weights (
       user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
       weight     REAL NOT NULL DEFAULT 1 CHECK (weight > 0),
       updated_by TEXT,
       updated_at TEXT NOT NULL DEFAULT (datetime('now')))`
  ).run();
  const present = ((await env.DB.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='member_weights'`
  ).all()).results || []).length > 0;
  const count = (await env.DB.prepare("SELECT COUNT(*) AS n FROM member_weights").first())?.n || 0;
  return json(request, {
    ok: present,
    applied: existed ? [] : ["member_weights"],
    skipped: existed ? ["member_weights (already present)"] : [],
    table_present: present,
    row_count: count
  });
}
export async function applyMigration019(request, env, p) {
  if (!isAdmin(p)) return err(request, "admin only", 403);
  const applied = [];
  const skipped = [];
  const objectExists = async (type, name) => {
    const rows = (await env.DB.prepare(
      `SELECT name FROM sqlite_master WHERE type=? AND name = ?`
    ).bind(type, name).all()).results || [];
    return rows.length > 0;
  };
  const create = async (label, type, name, sql) => {
    if (await objectExists(type, name)) {
      skipped.push(`${label} (already present)`);
      return;
    }
    try {
      await env.DB.prepare(sql).run();
      applied.push(label);
    } catch (e) {
      const msg = String(e && e.message || e);
      if (/already exists|duplicate column/i.test(msg)) skipped.push(`${label} (already present)`);
      else throw e;
    }
  };
  await create("staff_roles", "table", "staff_roles", `CREATE TABLE IF NOT EXISTS staff_roles (
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role       TEXT NOT NULL CHECK (role IN ('manager')),
      granted_by TEXT,
      granted_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, role)
    )`);
  await create("client_assignments", "table", "client_assignments", `CREATE TABLE IF NOT EXISTS client_assignments (
      user_id     TEXT NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
      client_id   TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      assigned_by TEXT,
      assigned_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, client_id)
    )`);
  await create(
    "idx_client_assignments_client",
    "index",
    "idx_client_assignments_client",
    "CREATE INDEX IF NOT EXISTS idx_client_assignments_client ON client_assignments(client_id)"
  );
  await create("client_work_requests", "table", "client_work_requests", `CREATE TABLE IF NOT EXISTS client_work_requests (
      id            TEXT PRIMARY KEY,
      user_id       TEXT NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
      client_id     TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','denied')),
      note          TEXT NOT NULL DEFAULT '',
      requested_at  TEXT NOT NULL DEFAULT (datetime('now')),
      decided_by    TEXT,
      decided_at    TEXT,
      decision_note TEXT
    )`);
  await create(
    "idx_work_requests_user",
    "index",
    "idx_work_requests_user",
    "CREATE INDEX IF NOT EXISTS idx_work_requests_user ON client_work_requests(user_id, status)"
  );
  await create(
    "idx_work_requests_status",
    "index",
    "idx_work_requests_status",
    "CREATE INDEX IF NOT EXISTS idx_work_requests_status ON client_work_requests(status, requested_at)"
  );
  await create(
    "idx_work_requests_pending",
    "index",
    "idx_work_requests_pending",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_work_requests_pending ON client_work_requests(user_id, client_id) WHERE status = 'pending'"
  );
  await create("feedback table", "table", "feedback", `CREATE TABLE IF NOT EXISTS feedback (
      id          TEXT PRIMARY KEY,
      user_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
      page        TEXT NOT NULL DEFAULT '',
      message     TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done')),
      resolved_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      resolved_at TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  await create(
    "idx_feedback_status",
    "index",
    "idx_feedback_status",
    "CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback(status, created_at)"
  );
  await create(
    "idx_feedback_user",
    "index",
    "idx_feedback_user",
    "CREATE INDEX IF NOT EXISTS idx_feedback_user ON feedback(user_id)"
  );
  const names = (await env.DB.prepare(
    `SELECT name FROM sqlite_master WHERE type='table'
      AND name IN ('staff_roles','client_assignments','client_work_requests','feedback')`
  ).all()).results || [];
  const present = new Set(names.map((r) => r.name));
  const indexNames = (await env.DB.prepare(
    `SELECT name FROM sqlite_master WHERE type='index'
      AND name IN ('idx_client_assignments_client','idx_work_requests_user',
                   'idx_work_requests_status','idx_work_requests_pending',
                   'idx_feedback_status','idx_feedback_user')`
  ).all()).results || [];
  const indexes = new Set(indexNames.map((r) => r.name));
  const userCols = (await env.DB.prepare("PRAGMA table_info(users)").all()).results || [];
  const usersAltered = userCols.some((c) => c.name === "is_manager" || c.name === "manager");
  return json(request, {
    ok: present.size === 4 && indexes.size === 6 && !usersAltered,
    applied,
    skipped,
    tables: {
      staff_roles: present.has("staff_roles"),
      client_assignments: present.has("client_assignments"),
      client_work_requests: present.has("client_work_requests"),
      feedback: present.has("feedback")
    },
    indexes: {
      idx_client_assignments_client: indexes.has("idx_client_assignments_client"),
      idx_work_requests_user: indexes.has("idx_work_requests_user"),
      idx_work_requests_status: indexes.has("idx_work_requests_status"),
      idx_work_requests_pending: indexes.has("idx_work_requests_pending"),
      idx_feedback_status: indexes.has("idx_feedback_status"),
      idx_feedback_user: indexes.has("idx_feedback_user")
    },
    users_altered: usersAltered
  });
}
export async function listClientSlugs(request, env, p) {
  if (!isAdmin(p)) return err(request, "admin only", 403);
  const rows = (await env.DB.prepare(
    `SELECT id, name, slug, archived FROM clients ORDER BY (slug IS NULL), slug, name`
  ).all()).results || [];
  const assigned = rows.filter((r) => r.slug);
  const unmapped = rows.filter((r) => !r.slug);
  return json(request, {
    ok: true,
    clients: rows,
    assigned: assigned.length,
    unmapped: unmapped.length
  });
}
export async function setClientSlugs(request, env, p) {
  if (!isAdmin(p)) return err(request, "admin only", 403);
  const b = await readJson(request);
  const mappings = Array.isArray(b.mappings) ? b.mappings : null;
  if (!mappings) return err(request, "mappings must be a list", 422);
  if (mappings.length > 500) return err(request, "too many mappings in one request (max 500)", 422);
  const cols = (await env.DB.prepare("PRAGMA table_info(clients)").all()).results || [];
  if (!cols.some((c) => c.name === "slug")) {
    return err(request, "client slugs need database migration 018 (POST /api/admin/apply-migration-018)", 409, "migration_required");
  }
  const applied = [];
  const failed = [];
  const planned = [];
  const seenSlugs = /* @__PURE__ */ new Map();
  for (const [i, m] of mappings.entries()) {
    const label = m && (m.client_id || m.name) ? String(m.client_id || m.name) : `mapping[${i}]`;
    if (!m || typeof m !== "object") {
      failed.push({ label, error: "mapping must be an object" });
      continue;
    }
    if (!("slug" in m)) {
      failed.push({ label, error: "slug missing (use null to clear)" });
      continue;
    }
    let row = null;
    if (m.client_id) {
      row = await env.DB.prepare("SELECT id, name, slug, archived FROM clients WHERE id = ?").bind(String(m.client_id)).first();
      if (!row) {
        failed.push({ label, error: "no client with that id" });
        continue;
      }
    } else if (typeof m.name === "string" && m.name.trim()) {
      const cands = (await env.DB.prepare(
        `SELECT id, name, slug, archived FROM clients WHERE name = ? OR TRIM(name) = ? ORDER BY archived, name`
      ).bind(m.name.trim(), m.name.trim()).all()).results || [];
      if (cands.length === 0) {
        failed.push({ label, error: "no client with that name" });
        continue;
      }
      if (cands.length > 1) {
        failed.push({ label, error: "ambiguous client name", candidates: cands.map((c) => ({ id: c.id, name: c.name, archived: c.archived })) });
        continue;
      }
      row = cands[0];
    } else {
      failed.push({ label, error: "client_id or name required" });
      continue;
    }
    let slug = null;
    if (m.slug !== null && m.slug !== "") {
      const reason = slugRejectionReason(m.slug);
      if (reason) {
        failed.push({ label, error: reason });
        continue;
      }
      slug = normalizeSlug(m.slug);
    }
    if (slug && seenSlugs.has(slug)) {
      failed.push({ label, error: `slug "${slug}" is already claimed in this request by ${seenSlugs.get(slug)}` });
      continue;
    }
    if (slug) seenSlugs.set(slug, label);
    if (slug) {
      const clash = await env.DB.prepare("SELECT id FROM clients WHERE slug = ? AND id <> ?").bind(slug, row.id).first();
      if (clash) {
        failed.push({ label, error: `slug "${slug}" is already used by another client` });
        continue;
      }
    }
    planned.push({ clientId: row.id, slug, label });
  }
  if (planned.length) {
    try {
      await env.DB.batch(planned.map((x) => env.DB.prepare("UPDATE clients SET slug = ? WHERE id = ?").bind(x.slug, x.clientId)));
    } catch (e) {
      const msg = String(e && e.message || e);
      if (msg.includes("clients.slug")) {
        return err(request, "a slug in this request is already used by another client", 409, "slug_taken");
      }
      throw e;
    }
    for (const x of planned) applied.push({ client_id: x.clientId, slug: x.slug });
  }
  return json(request, { ok: failed.length === 0, applied, failed, applied_count: applied.length, failed_count: failed.length });
}
export async function applyMigration025(request, env, p) {
  if (!isAdmin(p)) return err(request, "admin only", 403);
  const applied = [];
  const skipped = [];
  const objectExists = async (type, name) => {
    const rows = (await env.DB.prepare(
      `SELECT name FROM sqlite_master WHERE type=? AND name = ?`
    ).bind(type, name).all()).results || [];
    return rows.length > 0;
  };
  const create = async (label, type, name, sql) => {
    if (await objectExists(type, name)) {
      skipped.push(`${label} (already present)`);
      return;
    }
    try {
      await env.DB.prepare(sql).run();
      applied.push(label);
    } catch (e) {
      const msg = String(e && e.message || e);
      if (/already exists|duplicate column/i.test(msg)) skipped.push(`${label} (already present)`);
      else throw e;
    }
  };
  const addColumn = async (label, table, column, sql) => {
    const cols = (await env.DB.prepare(`PRAGMA table_info(${table})`).all()).results || [];
    if (cols.some((c) => c.name === column)) {
      skipped.push(`${label} (already present)`);
      return;
    }
    try {
      await env.DB.prepare(sql).run();
      applied.push(label);
    } catch (e) {
      const msg = String(e && e.message || e);
      if (/duplicate column/i.test(msg)) skipped.push(`${label} (already present)`);
      else throw e;
    }
  };
  await create("departments", "table", "departments", `CREATE TABLE IF NOT EXISTS departments (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL UNIQUE,
      sort_order  INTEGER NOT NULL DEFAULT 0,
      hidden      INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now')))`);
  await create(
    "idx_departments_sort",
    "index",
    "idx_departments_sort",
    `CREATE INDEX IF NOT EXISTS idx_departments_sort ON departments(sort_order, name)`
  );
  await addColumn(
    "time_entries.department_id",
    "time_entries",
    "department_id",
    `ALTER TABLE time_entries ADD COLUMN department_id TEXT REFERENCES departments(id) ON DELETE SET NULL`
  );
  await create(
    "idx_entries_department",
    "index",
    "idx_entries_department",
    `CREATE INDEX IF NOT EXISTS idx_entries_department ON time_entries(department_id)`
  );
  await env.DB.prepare(
    `INSERT OR IGNORE INTO departments (id, name, sort_order, hidden) VALUES
       ('dept_admin',           'Admin',              1, 0),
       ('dept_ads_management',  'Ads Management',     2, 0),
       ('dept_graphic_design',  'Graphic Design',     3, 0),
       ('dept_project_manager', 'Project Manager',    4, 0),
       ('dept_seo',             'SEO',                5, 0),
       ('dept_social_media',    'Social Media',       6, 0),
       ('dept_technology',      'Technology',         7, 0),
       ('dept_video',           'Video',              8, 0),
       ('dept_paid_ads',        'Paid Ads',           9, 0)`
  ).run();
  const PROJECT_TO_DEPARTMENT = [
    ["Admin", "dept_admin"],
    ["Ads Management", "dept_ads_management"],
    ["Graphic Design", "dept_graphic_design"],
    ["Project Manager", "dept_project_manager"],
    ["SEO", "dept_seo"],
    ["Technology", "dept_technology"],
    ["Video Creator", "dept_video"],
    ["Paid Ads", "dept_paid_ads"]
  ];
  let backfilled = 0;
  for (const [projectName, deptId] of PROJECT_TO_DEPARTMENT) {
    const res = await env.DB.prepare(
      `UPDATE time_entries SET department_id = ?
        WHERE department_id IS NULL AND project_id IN (SELECT id FROM projects WHERE name = ?)`
    ).bind(deptId, projectName).run();
    backfilled += res && res.meta && res.meta.changes || 0;
  }
  const sm = await env.DB.prepare(
    `UPDATE time_entries SET department_id = 'dept_social_media'
      WHERE department_id IS NULL
        AND project_id IN (SELECT id FROM projects WHERE name IN ('Social Media Management','Social Media Manager'))`
  ).run();
  backfilled += sm && sm.meta && sm.meta.changes || 0;
  await create("client_billing", "table", "client_billing", `CREATE TABLE IF NOT EXISTS client_billing (
      client_id           TEXT PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
      billing_model       TEXT CHECK (billing_model IS NULL OR billing_model IN ('fixed_project','profit_share')),
      fixed_amount_cents  INTEGER,
      fixed_start         TEXT,
      fixed_end           TEXT,
      profit_pct          REAL,
      profit_base         TEXT,
      updated_by          TEXT REFERENCES users(id) ON DELETE SET NULL,
      updated_at          TEXT NOT NULL DEFAULT (datetime('now')))`);
  await addColumn(
    "clients.paused",
    "clients",
    "paused",
    `ALTER TABLE clients ADD COLUMN paused INTEGER NOT NULL DEFAULT 0`
  );
  await create("invoice_voids", "table", "invoice_voids", `CREATE TABLE IF NOT EXISTS invoice_voids (
      id                    TEXT PRIMARY KEY,
      invoice_id            TEXT NOT NULL,
      invoice_number        TEXT NOT NULL DEFAULT '',
      client_id             TEXT,
      voided_by             TEXT REFERENCES users(id) ON DELETE SET NULL,
      voided_by_email       TEXT NOT NULL DEFAULT '',
      reason                TEXT NOT NULL DEFAULT '',
      hours_released        REAL NOT NULL DEFAULT 0,
      entries_released      INTEGER NOT NULL DEFAULT 0,
      amount_released_cents INTEGER NOT NULL DEFAULT 0,
      snapshot              TEXT NOT NULL DEFAULT '{}',
      created_at            TEXT NOT NULL DEFAULT (datetime('now')))`);
  await create(
    "idx_invoice_voids_invoice",
    "index",
    "idx_invoice_voids_invoice",
    `CREATE INDEX IF NOT EXISTS idx_invoice_voids_invoice ON invoice_voids(invoice_id)`
  );
  await create(
    "idx_invoice_voids_created",
    "index",
    "idx_invoice_voids_created",
    `CREATE INDEX IF NOT EXISTS idx_invoice_voids_created ON invoice_voids(created_at)`
  );
  const SETTINGS = [
    ["goal_mode", "auto"],
    ["lock_schedule", '{"cadence":"weekly","weekday":0,"time":"23:59","timezone":"America/New_York"}']
  ];
  for (const [key, value] of SETTINGS) {
    const existing = await env.DB.prepare("SELECT value FROM app_settings WHERE key = ?").bind(key).first();
    await env.DB.prepare(
      `INSERT OR IGNORE INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))`
    ).bind(key, value).run();
    if (existing) skipped.push(`app_settings.${key} (already present)`);
    else applied.push(`app_settings.${key}`);
  }
  const entryCols = (await env.DB.prepare("PRAGMA table_info(time_entries)").all()).results || [];
  const clientCols = (await env.DB.prepare("PRAGMA table_info(clients)").all()).results || [];
  const deptCount = (await env.DB.prepare("SELECT COUNT(*) AS n FROM departments").first())?.n || 0;
  const hiddenCount = (await env.DB.prepare("SELECT COUNT(*) AS n FROM departments WHERE hidden = 1").first())?.n || 0;
  const assignedCount = (await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM time_entries WHERE department_id IS NOT NULL"
  ).first())?.n || 0;
  const settingsRows = (await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM app_settings WHERE key IN ('goal_mode','lock_schedule')`
  ).first())?.n || 0;
  const tables = ["departments", "client_billing", "invoice_voids"];
  const missing = [];
  for (const t of tables) if (!await objectExists("table", t)) missing.push(t);
  const ok = missing.length === 0 && entryCols.some((c) => c.name === "department_id") && clientCols.some((c) => c.name === "paused") && deptCount >= 9 && settingsRows === 2;
  return json(request, {
    ok,
    applied,
    skipped,
    missing_tables: missing,
    department_id_column: entryCols.some((c) => c.name === "department_id"),
    paused_column: clientCols.some((c) => c.name === "paused"),
    departments: deptCount,
    departments_hidden: hiddenCount,
    entries_with_department: assignedCount,
    entries_backfilled_this_call: backfilled,
    settings_rows: settingsRows,
    users_altered: false
  });
}
export async function applyMigration026(request, env, p) {
  if (!isAdmin(p)) return err(request, "admin only", 403);
  const voidTable = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='invoice_voids'"
  ).first();
  if (!voidTable) {
    return err(
      request,
      "migration 026 needs migration 025 first (the void's audit table) — apply 025, then 026",
      409,
      "migration_required"
    );
  }
  await env.DB.prepare("DROP TRIGGER IF EXISTS trg_time_entries_locked_no_update").run();
  await env.DB.prepare(
    `CREATE TRIGGER trg_time_entries_locked_no_update
BEFORE UPDATE ON time_entries
FOR EACH ROW WHEN OLD.locked = 1
  AND NOT (OLD.invoice_id IS NULL AND EXISTS (SELECT 1 FROM entry_edit_override o WHERE o.entry_id = OLD.id))
  AND (
     NEW.hours           <> OLD.hours
  OR NEW.rate_cents       <> OLD.rate_cents
  OR NEW.entry_date       <> OLD.entry_date
  OR NEW.client_id        <> OLD.client_id
  OR NEW.user_id          <> OLD.user_id
  OR NEW.project_task     <> OLD.project_task
  OR NEW.is_billable      <> OLD.is_billable
  OR NEW.notes            <> OLD.notes
  OR NEW.approval_status  <> OLD.approval_status
  OR NEW.locked           <> OLD.locked
  OR NEW.timesheet_id IS NOT OLD.timesheet_id
  OR (OLD.invoice_id IS NOT NULL AND NEW.invoice_id IS NOT OLD.invoice_id
      AND NOT EXISTS (SELECT 1 FROM invoice_voids v WHERE v.invoice_id = OLD.invoice_id))
  )
BEGIN
  SELECT RAISE(ABORT, 'time_entry is approved+locked and immutable');
END;`
  ).run();
  const trg = await env.DB.prepare(
    "SELECT sql FROM sqlite_master WHERE type='trigger' AND name='trg_time_entries_locked_no_update'"
  ).first();
  const triggerUpdated = Boolean(trg && /invoice_voids/.test(trg.sql));
  const stillImmutable = Boolean(trg && /NEW\.hours\s+<>\s+OLD\.hours/.test(trg.sql) && /OLD\.locked = 1/.test(trg.sql));
  return json(request, {
    ok: triggerUpdated && stillImmutable,
    trigger_updated: triggerUpdated,
    still_immutable: stillImmutable,
    rows_altered: 0
  });
}
export async function applyMigration030(request, env, p) {
  if (!isAdmin(p)) return err(request, "admin only", 403);
  const applied = [];
  const skipped = [];
  const hasTable = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='lock_runs'"
  ).first();
  if (hasTable) {
    skipped.push("lock_runs (already present)");
  } else {
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS lock_runs (
         id                INTEGER PRIMARY KEY AUTOINCREMENT,
         through_date      TEXT    NOT NULL,
         entries_locked    INTEGER NOT NULL DEFAULT 0,
         timesheets_locked INTEGER NOT NULL DEFAULT 0,
         source            TEXT    NOT NULL,
         ran_at            TEXT    NOT NULL DEFAULT (datetime('now')),
         ran_by            TEXT
       )`
    ).run();
    applied.push("lock_runs");
  }
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_lock_runs_ran ON lock_runs(ran_at)").run();
  const live = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='lock_runs'"
  ).first();
  const counts = await env.DB.prepare(
    `SELECT COUNT(*) total,
            SUM(CASE WHEN source = 'manual' THEN 1 ELSE 0 END) manual,
            SUM(CASE WHEN source = 'schedule' THEN 1 ELSE 0 END) scheduled
       FROM lock_runs`
  ).first();
  return json(request, {
    ok: Boolean(live),
    applied,
    skipped,
    locks: Number(counts && counts.total || 0),
    manual_locks: Number(counts && counts.manual || 0),
    scheduled_locks: Number(counts && counts.scheduled || 0)
  });
}
export async function applyMigration031(request, env, p) {
  if (!isAdmin(p)) return err(request, "admin only", 403);
  const applied = [];
  const skipped = [];
  const before = (await env.DB.prepare("PRAGMA table_info(active_timers)").all()).results || [];
  if (before.some((c) => c.name === "department_id")) {
    skipped.push("active_timers.department_id (already present)");
  } else {
    try {
      await env.DB.prepare(
        "ALTER TABLE active_timers ADD COLUMN department_id TEXT REFERENCES departments(id) ON DELETE SET NULL"
      ).run();
      applied.push("active_timers.department_id");
    } catch (e) {
      const msg = String(e && e.message || e);
      if (/duplicate column/i.test(msg)) skipped.push("active_timers.department_id (already present)");
      else throw e;
    }
  }
  const after = (await env.DB.prepare("PRAGMA table_info(active_timers)").all()).results || [];
  const present = after.some((c) => c.name === "department_id");
  return json(request, { ok: present, applied, skipped, column_present: present });
}
export async function applyMigration032(request, env, p) {
  if (!isAdmin(p)) return err(request, "admin only", 403);
  const applied = [];
  const skipped = [];
  const addColumn = async (column) => {
    const cols = (await env.DB.prepare("PRAGMA table_info(clients)").all()).results || [];
    if (cols.some((c) => c.name === column)) {
      skipped.push(`clients.${column} (already present)`);
      return;
    }
    try {
      await env.DB.prepare(`ALTER TABLE clients ADD COLUMN ${column} TEXT`).run();
      applied.push(`clients.${column}`);
    } catch (e) {
      if (/duplicate column/i.test(String(e && e.message || e))) skipped.push(`clients.${column} (already present)`);
      else throw e;
    }
  };
  await addColumn("paused_at");
  await addColumn("paused_by");
  const after = (await env.DB.prepare("PRAGMA table_info(clients)").all()).results || [];
  const present = after.some((c) => c.name === "paused_at") && after.some((c) => c.name === "paused_by");
  return json(request, { ok: present, applied, skipped, columns_present: present });
}
export async function applyMigration036(request, env, p) {
  if (!isAdmin(p)) return err(request, "admin only", 403);
  const applied = [];
  const skipped = [];
  const objectExists = async (type, name) => {
    const rows = (await env.DB.prepare(`SELECT name FROM sqlite_master WHERE type=? AND name = ?`).bind(type, name).all()).results || [];
    return rows.length > 0;
  };
  const create = async (label, type, name, sql) => {
    if (await objectExists(type, name)) {
      skipped.push(`${label} (already present)`);
      return;
    }
    try {
      await env.DB.prepare(sql).run();
      applied.push(label);
    } catch (e) {
      const msg = String(e && e.message || e);
      if (/already exists|duplicate column/i.test(msg)) skipped.push(`${label} (already present)`);
      else throw e;
    }
  };
  await create("client_project_milestones", "table", "client_project_milestones", `CREATE TABLE IF NOT EXISTS client_project_milestones (
      id            TEXT PRIMARY KEY,
      client_id     TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      label         TEXT NOT NULL DEFAULT '',
      amount_cents  INTEGER NOT NULL CHECK (amount_cents >= 0),
      release_date  TEXT NOT NULL,
      released      INTEGER NOT NULL DEFAULT 0 CHECK (released IN (0,1)),
      landed_date   TEXT,
      created_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  await create(
    "idx_client_project_milestones_client",
    "index",
    "idx_client_project_milestones_client",
    "CREATE INDEX IF NOT EXISTS idx_client_project_milestones_client ON client_project_milestones(client_id, release_date)"
  );
  await create(
    "idx_client_project_milestones_release",
    "index",
    "idx_client_project_milestones_release",
    "CREATE INDEX IF NOT EXISTS idx_client_project_milestones_release ON client_project_milestones(release_date)"
  );
  const tbl = await objectExists("table", "client_project_milestones");
  const cols = tbl ? (await env.DB.prepare("PRAGMA table_info(client_project_milestones)").all()).results || [] : [];
  const names = cols.map((c) => c.name);
  const need = ["id", "client_id", "label", "amount_cents", "release_date", "released", "landed_date"];
  const hasAll = need.every((n) => names.includes(n));
  const idx = (await env.DB.prepare(
    `SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_client_project_milestones%'`
  ).all()).results || [];
  const ok = tbl && hasAll && idx.length >= 2;
  return json(request, {
    ok,
    applied,
    skipped,
    client_project_milestones_table: tbl,
    client_project_milestones_columns: names,
    indexes: idx.map((r) => r.name)
  });
}
