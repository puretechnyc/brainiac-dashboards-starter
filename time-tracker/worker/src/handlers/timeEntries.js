import { json, err, readJson, uuid, weekStart, isIsoDate } from "../util.js";
import { isAdmin, isEmployee, isManager, canWrite, isClient, timeEntryReadScope } from "../auth.js";
import { ensureTimesheet, clientWeekStart } from "./timesheets.js";
import { checkBudgetAlerts, checkUnderTargetAlerts } from "./budget.js";
import { tagEntrySource } from "./weekly.js";
import { hasAssignmentsTable } from "./assignments.js";
import { checkHourBudgetWarning, checkHourBudgetAlerts } from "./hourBudget.js";
import { effectiveLock, readLockedThrough, SCHEDULED_LOCK_MSG } from "./lock-schedule.js";
export async function resolveDepartment(request, env, rawId, { required }) {
  const id = rawId == null ? "" : String(rawId).trim();
  if (!id) {
    if (required) return { ok: false, response: err(request, "department_required", 422, "department_required") };
    return { ok: true, departmentId: null };
  }
  let dept;
  try {
    dept = await env.DB.prepare("SELECT id, hidden FROM departments WHERE id = ?").bind(id).first();
  } catch (e) {
    if (!/no such table: departments/i.test(String(e && e.message || e))) throw e;
    return { ok: true, departmentId: null };
  }
  if (!dept) return { ok: false, response: err(request, "department not found", 404, "bad_department") };
  if (dept.hidden) return { ok: false, response: err(request, "department is archived; cannot log new time against it", 409, "department_hidden") };
  return { ok: true, departmentId: id };
}
export async function columnExists(env, table, column) {
  const cols = (await env.DB.prepare(`PRAGMA table_info(${table})`).all()).results || [];
  return cols.some((c) => c.name === column);
}
function sanitizeForClient(entry) {
  if (!entry) return entry;
  const {
    user_id,
    rate_cents,
    timesheet_id,
    approved_by,
    approved_at,
    locked,
    invoice_id,
    timesheet_status,
    entered_by,
    entered_by_name,
    entered_by_email,
    ...safe
  } = entry;
  return safe;
}
function isFutureDate(dateStr) {
  const entryDate = /* @__PURE__ */ new Date(`${dateStr}T23:59:59Z`);
  const limit = /* @__PURE__ */ new Date();
  limit.setUTCDate(limit.getUTCDate() + 1);
  limit.setUTCHours(23, 59, 59, 999);
  return entryDate > limit;
}
export async function checkClientAssignment(env, p, clientId) {
  if (isAdmin(p)) return { ok: true };
  if (isManager(p)) return { ok: true };
  if (!isEmployee(p)) return { ok: true };
  if (!await hasAssignmentsTable(env)) return { ok: true };
  const assigned = await env.DB.prepare(
    "SELECT 1 AS ok FROM client_assignments WHERE user_id = ? AND client_id = ?"
  ).bind(p.userId, clientId).first();
  if (assigned) return { ok: true };
  const pending = await env.DB.prepare(
    `SELECT id FROM client_work_requests
      WHERE user_id = ? AND client_id = ? AND status = 'pending'`
  ).bind(p.userId, clientId).first();
  return {
    ok: false,
    code: "client_not_assigned",
    pending_request_id: pending ? pending.id : null
  };
}
export async function createEntry(request, env, p) {
  if (!canWrite(p)) return err(request, "read-only role cannot log time", 403);
  const b = await readJson(request);
  if (!b.client_id) return err(request, "client_id required", 422);
  if (!b.entry_date || !/^\d{4}-\d{2}-\d{2}$/.test(b.entry_date)) return err(request, "entry_date (YYYY-MM-DD) required", 422);
  const hours = Number(b.hours);
  if (!Number.isFinite(hours) || hours < 0) return err(request, "hours must be >= 0", 422);
  if (hours > 24) return err(request, "hours cannot exceed 24 per entry", 422, "hours_cap");
  if (isFutureDate(b.entry_date)) return err(request, "cannot log time for future dates", 422, "future_date");
  const client = await env.DB.prepare("SELECT * FROM clients WHERE id = ?").bind(b.client_id).first();
  if (!client) return err(request, "client not found", 404);
  if (client.archived) return err(request, "client is archived; cannot log time against it", 409, "client_archived");
  if (client.paused) return err(request, "This client is paused; ask an admin.", 409, "client_paused");
  let ownerId = p.userId;
  let ownerRole = p.role;
  let ownerName = null;
  if (isAdmin(p) && b.user_id && b.user_id !== p.userId) {
    const target = await env.DB.prepare("SELECT id, role, active, display_name, email FROM users WHERE id = ?").bind(b.user_id).first();
    if (!target) return err(request, "target user not found", 404, "bad_user");
    if (target.active === 0) return err(request, "target user is deactivated", 409, "user_inactive");
    if (target.role === "client") return err(request, "cannot log time under a client account", 422, "bad_user_role");
    ownerId = target.id;
    ownerRole = target.role;
    ownerName = target.display_name || target.email || null;
  }
  const assignment = await checkClientAssignment(env, p, b.client_id);
  if (!assignment.ok) {
    return json(request, {
      ok: false,
      error: `you are not assigned to ${client.name} — request access and a manager will approve it`,
      code: assignment.code,
      client_id: b.client_id,
      client_name: client.name,
      pending_request_id: assignment.pending_request_id,
      request_hint: 'POST /api/work-requests { "client_id": "' + b.client_id + '" } to request access'
    }, 403);
  }
  if (b.project_id) {
    const proj = await env.DB.prepare("SELECT client_id, archived FROM projects WHERE id = ?").bind(b.project_id).first();
    if (!proj || proj.client_id !== b.client_id) return err(request, "project not found for this client", 404);
    if (proj.archived) return err(request, "project is archived; cannot log time against it", 409, "project_archived");
  }
  const dep = await resolveDepartment(request, env, b.department_id, { required: true });
  if (!dep.ok) return dep.response;
  const departmentId = dep.departmentId;
  const validEntryTypes = ["work", "break", "time_off", "sick", "holiday"];
  const entryType = validEntryTypes.includes(b.entry_type) ? b.entry_type : "work";
  const isNonWork = entryType !== "work";
  let budgetWarning = null;
  if (entryType === "work" && hours > 0) {
    const budgetWeek = weekStart(b.entry_date);
    const budgetSubject = ownerId === p.userId ? null : { id: ownerId, name: ownerName };
    budgetWarning = (await checkHourBudgetWarning(
      env,
      { userId: ownerId, role: ownerRole },
      budgetWeek,
      budgetSubject
    )).warning;
  }
  const rate = Number.isFinite(b.rate_cents) ? Math.max(0, Math.round(b.rate_cents)) : client.rate_cents;
  const isBillable = isNonWork ? 0 : b.is_billable === void 0 ? 1 : b.is_billable ? 1 : 0;
  const wk = await clientWeekStart(env, b.client_id, b.entry_date);
  const ts = await ensureTimesheet(env, ownerId, b.client_id, wk);
  if (ts.status === "submitted" || ts.status === "approved") {
    return err(request, `week of ${wk} for this client is ${ts.status}; cannot add entries`, 409, "week_closed");
  }
  if (ts.status === "rejected") {
    await env.DB.prepare(
      `UPDATE timesheets SET status='open', updated_at=datetime('now') WHERE id = ?`
    ).bind(ts.id).run();
  }
  const id = uuid();
  const entryCols = (await env.DB.prepare("PRAGMA table_info(time_entries)").all()).results || [];
  const hasEnteredBy = entryCols.some((c) => c.name === "entered_by");
  const hasDepartment = entryCols.some((c) => c.name === "department_id");
  const cols = ["id", "user_id", "client_id", "project_id", "project_task", "entry_date", "hours", "rate_cents", "is_billable", "notes", "timesheet_id", "entry_type"];
  const vals = [id, ownerId, b.client_id, b.project_id || null, b.project_task || "", b.entry_date, hours, rate, isBillable, b.notes || "", ts.id, entryType];
  if (hasDepartment) {
    cols.push("department_id");
    vals.push(departmentId);
  }
  if (hasEnteredBy) {
    cols.push("entered_by");
    vals.push(p.userId);
  }
  await env.DB.prepare(
    `INSERT INTO time_entries (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`
  ).bind(...vals).run();
  await tagEntrySource(env, id, "manual");
  const row = await env.DB.prepare("SELECT * FROM time_entries WHERE id = ?").bind(id).first();
  await checkBudgetAlerts(env, b.client_id);
  await checkUnderTargetAlerts(env);
  await checkHourBudgetAlerts(
    env,
    ownerId,
    weekStart(b.entry_date),
    ownerId === p.userId ? null : ownerName
  );
  return json(request, { ok: true, entry: row, warning: budgetWarning }, 201);
}
export async function listEntries(request, env, p, url) {
  const scope = timeEntryReadScope(p, "t");
  const clauses = [scope.sql];
  const params = [...scope.params];
  const cid = url.searchParams.get("client_id");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (cid) {
    clauses.push("t.client_id = ?");
    params.push(cid);
  }
  if (from) {
    clauses.push("t.entry_date >= ?");
    params.push(from);
  }
  if (to) {
    clauses.push("t.entry_date <= ?");
    params.push(to);
  }
  if (url.searchParams.get("exclude_archived") === "1") {
    clauses.push("t.client_id IN (SELECT id FROM clients WHERE archived = 0)");
  }
  const limit = Math.min(Math.max(1, parseInt(url.searchParams.get("limit"), 10) || 50), 200);
  const offset = Math.max(0, parseInt(url.searchParams.get("offset"), 10) || 0);
  const hasEnteredBy = await columnExists(env, "time_entries", "entered_by");
  const rows = await env.DB.prepare(
    `SELECT t.*, c.name AS client_name, u.email AS user_email, u.display_name AS user_display_name,
            ${hasEnteredBy ? "eb.display_name AS entered_by_name, eb.email AS entered_by_email," : ""}
            ts.status AS timesheet_status
       FROM time_entries t
       JOIN clients c ON c.id = t.client_id
       LEFT JOIN users u ON u.id = t.user_id
       ${hasEnteredBy ? "LEFT JOIN users eb ON eb.id = t.entered_by" : ""}
       LEFT JOIN timesheets ts ON ts.id = t.timesheet_id
      WHERE ${clauses.join(" AND ")}
      ORDER BY t.entry_date DESC, t.created_at DESC
      LIMIT ? OFFSET ?`
  ).bind(...params, limit, offset).all();
  let entries = rows.results || [];
  const lockedThrough = await readLockedThrough(env);
  if (isClient(p)) {
    entries = entries.map(sanitizeForClient);
  } else {
    entries = entries.map((e) => {
      const perm = entryEditability(p, e, e.timesheet_status, lockedThrough);
      return {
        ...e,
        can_edit: perm.ok,
        edit_blocked: perm.ok ? null : perm.code,
        locked_kind: perm.locked_kind || null
      };
    });
  }
  return json(request, { ok: true, entries, limit, offset });
}
async function fetchScoped(env, p, id) {
  const scope = timeEntryReadScope(p, "t");
  return env.DB.prepare(
    `SELECT t.* FROM time_entries t WHERE t.id = ? AND ${scope.sql}`
  ).bind(id, ...scope.params).first();
}
export const APPROVED_MSG = "approved, ask an admin to change";
export function entryEditability(p, entry, tsStatus, lockedThrough) {
  if (isClient(p)) return { ok: false, status: 403, code: "forbidden", message: "read-only role cannot edit" };
  if (entry.invoice_id) return { ok: false, status: 409, code: "invoiced", message: "entry already invoiced" };
  const lock = effectiveLock(entry, tsStatus, lockedThrough);
  if (isAdmin(p)) return { ok: true, override: lock.approved, scheduled_lock: lock.scheduled, locked_kind: lock.kind };
  if (entry.user_id !== p.userId) return { ok: false, status: 403, code: "forbidden", message: "forbidden" };
  if (lock.approved) return { ok: false, status: 409, code: "locked", message: APPROVED_MSG };
  if (lock.scheduled) return { ok: false, status: 409, code: "locked", message: SCHEDULED_LOCK_MSG, locked_kind: "scheduled" };
  return { ok: true, override: false };
}
async function timesheetStatus(env, timesheetId) {
  if (!timesheetId) return null;
  const ts = await env.DB.prepare("SELECT status FROM timesheets WHERE id = ?").bind(timesheetId).first();
  return ts ? ts.status : null;
}
async function reopenSubmittedWeek(env, p, entry, tsStatus, { resetEntry }) {
  if (!isEmployee(p)) return;
  if (tsStatus === "submitted") {
    await env.DB.prepare(
      `UPDATE timesheets SET status='open', submitted_at=NULL, updated_at=datetime('now') WHERE id = ? AND status='submitted'`
    ).bind(entry.timesheet_id).run();
  }
  if (resetEntry && (tsStatus === "submitted" || entry.approval_status === "submitted")) {
    await env.DB.prepare(
      `UPDATE time_entries SET approval_status='open', updated_at=datetime('now') WHERE id = ? AND locked = 0 AND approval_status='submitted'`
    ).bind(entry.id).run();
  }
}
const MIGRATION_MSG = "editing an approved entry needs database migration 016 (POST /api/admin/apply-migration-016)";
function isMissingOverrideSupport(e) {
  return /entry_edit_override|entry_deletions|no such table|immutable/i.test(String(e && e.message || e));
}
export async function updateEntry(request, env, p, id) {
  if (isClient(p)) return err(request, "read-only role cannot edit", 403);
  const cur = await fetchScoped(env, p, id);
  if (!cur) return err(request, "not found", 404);
  const tsStatus = await timesheetStatus(env, cur.timesheet_id);
  const lockedThrough = await readLockedThrough(env);
  const perm = entryEditability(p, cur, tsStatus, lockedThrough);
  if (!perm.ok) return err(request, perm.message, perm.status, perm.code);
  const entryClient = await env.DB.prepare("SELECT * FROM clients WHERE id = ?").bind(cur.client_id).first();
  if (entryClient && entryClient.paused) return err(request, "This client is paused; ask an admin.", 409, "client_paused");
  const b = await readJson(request);
  const reason = (b.reason || "").trim();
  if (!reason) return err(request, "reason is required when editing entries", 422, "reason_required");
  const hours = b.hours === void 0 ? cur.hours : Number(b.hours);
  if (!Number.isFinite(hours) || hours < 0) return err(request, "hours must be >= 0", 422);
  if (hours > 24) return err(request, "hours cannot exceed 24 per entry", 422, "hours_cap");
  const validEntryTypesEdit = ["work", "break", "time_off", "sick", "holiday"];
  const nextEntryType = validEntryTypesEdit.includes(b.entry_type) ? b.entry_type : cur.entry_type || "work";
  const nextIsNonWork = nextEntryType !== "work";
  const next = {
    project_task: b.project_task ?? cur.project_task,
    project_id: b.project_id !== void 0 ? b.project_id || null : cur.project_id,
    entry_date: b.entry_date ?? cur.entry_date,
    hours,
    rate_cents: Number.isFinite(b.rate_cents) ? Math.max(0, Math.round(b.rate_cents)) : cur.rate_cents,
    is_billable: nextIsNonWork ? 0 : b.is_billable === void 0 ? cur.is_billable : b.is_billable ? 1 : 0,
    notes: b.notes ?? cur.notes,
    entry_type: nextEntryType
  };
  if (next.entry_date !== cur.entry_date && isFutureDate(next.entry_date)) {
    return err(request, "cannot log time for future dates", 422, "future_date");
  }
  if (b.project_id !== void 0 && b.project_id) {
    const proj = await env.DB.prepare("SELECT client_id, archived FROM projects WHERE id = ?").bind(b.project_id).first();
    if (!proj || proj.client_id !== cur.client_id) return err(request, "project not found for this client", 404);
    if (proj.archived) return err(request, "project is archived; cannot log time against it", 409, "project_archived");
  }
  let newTimesheetId = cur.timesheet_id;
  if (next.entry_date !== cur.entry_date) {
    const newWeek = await clientWeekStart(env, cur.client_id, next.entry_date);
    const oldWeek = await clientWeekStart(env, cur.client_id, cur.entry_date);
    if (newWeek !== oldWeek) {
      if (perm.override) {
        return err(request, "an approved entry cannot be moved to another week; delete it and log a new one", 409, "week_closed");
      }
      const targetTs = await ensureTimesheet(env, cur.user_id, cur.client_id, newWeek);
      if (targetTs.status === "approved") {
        return err(request, `target week of ${newWeek} is ${targetTs.status}; cannot move entry`, 409, "week_closed");
      }
      if (targetTs.status === "submitted" && isEmployee(p)) {
        await env.DB.prepare(
          `UPDATE timesheets SET status='open', submitted_at=NULL, updated_at=datetime('now') WHERE id = ?`
        ).bind(targetTs.id).run();
      }
      if (targetTs.status === "rejected") {
        await env.DB.prepare(
          `UPDATE timesheets SET status='open', updated_at=datetime('now') WHERE id = ?`
        ).bind(targetTs.id).run();
      }
      newTimesheetId = targetTs.id;
    }
  }
  const changes = [];
  if (next.project_task !== cur.project_task) changes.push({ field: "project_task", old: cur.project_task, new: next.project_task });
  if (next.entry_date !== cur.entry_date) changes.push({ field: "entry_date", old: cur.entry_date, new: next.entry_date });
  if (next.hours !== cur.hours) changes.push({ field: "hours", old: String(cur.hours), new: String(next.hours) });
  if (next.rate_cents !== cur.rate_cents) changes.push({ field: "rate_cents", old: String(cur.rate_cents), new: String(next.rate_cents) });
  if (next.is_billable !== cur.is_billable) changes.push({ field: "is_billable", old: String(cur.is_billable), new: String(next.is_billable) });
  if (next.notes !== cur.notes) changes.push({ field: "notes", old: cur.notes, new: next.notes });
  if (next.entry_type !== (cur.entry_type || "work")) changes.push({ field: "entry_type", old: cur.entry_type || "work", new: next.entry_type });
  const updateStmt = env.DB.prepare(
    `UPDATE time_entries SET project_task=?,project_id=?,entry_date=?,hours=?,rate_cents=?,is_billable=?,notes=?,
       timesheet_id=?, entry_type=?, updated_at=datetime('now') WHERE id=?`
  ).bind(
    next.project_task,
    next.project_id,
    next.entry_date,
    next.hours,
    next.rate_cents,
    next.is_billable,
    next.notes,
    newTimesheetId,
    next.entry_type,
    id
  );
  const auditReason = perm.override ? `[admin edit of approved entry] ${reason}` : perm.scheduled_lock ? `[admin edit of scheduled-locked entry] ${reason}` : reason;
  const auditStmts = changes.map((c) => env.DB.prepare(
    `INSERT INTO entry_edits (id, entry_id, user_id, field_name, old_value, new_value, reason)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(uuid(), id, p.userId, c.field, c.old, c.new, auditReason));
  if (perm.override) {
    try {
      await env.DB.batch([
        env.DB.prepare("INSERT INTO entry_edit_override (entry_id, user_id) VALUES (?, ?)").bind(id, p.userId),
        updateStmt,
        ...auditStmts,
        env.DB.prepare("DELETE FROM entry_edit_override WHERE entry_id = ?").bind(id)
      ]);
    } catch (e) {
      if (isMissingOverrideSupport(e)) return err(request, MIGRATION_MSG, 409, "migration_required");
      throw e;
    }
  } else {
    await updateStmt.run();
    for (const st of auditStmts) await st.run();
    await reopenSubmittedWeek(env, p, cur, tsStatus, { resetEntry: true });
  }
  const row = await env.DB.prepare("SELECT * FROM time_entries WHERE id = ?").bind(id).first();
  await checkBudgetAlerts(env, cur.client_id);
  return json(request, { ok: true, entry: row });
}
export async function listEntryEdits(request, env, p, id) {
  const cur = await fetchScoped(env, p, id);
  if (!cur) return err(request, "not found", 404);
  const rows = (await env.DB.prepare(
    `SELECT ee.*, u.email AS user_email, u.display_name AS user_name
       FROM entry_edits ee
       JOIN users u ON u.id = ee.user_id
      WHERE ee.entry_id = ?
      ORDER BY ee.created_at DESC`
  ).bind(id).all()).results || [];
  let edits = rows;
  if (isClient(p)) {
    edits = rows.map((ed) => {
      const { user_id, user_email, user_name, ...safe } = ed;
      return safe;
    });
  }
  return json(request, { ok: true, edits });
}
export async function deleteEntry(request, env, p, id) {
  if (isClient(p)) return err(request, "read-only role cannot delete", 403);
  const cur = await fetchScoped(env, p, id);
  if (!cur) return err(request, "not found", 404);
  const tsStatus = await timesheetStatus(env, cur.timesheet_id);
  const lockedThrough = await readLockedThrough(env);
  const perm = entryEditability(p, cur, tsStatus, lockedThrough);
  if (!perm.ok) return err(request, perm.message, perm.status, perm.code);
  let reason = "";
  try {
    reason = String((await readJson(request) || {}).reason || "").trim();
  } catch {
  }
  if (perm.override && !reason) {
    return err(request, "reason is required when deleting an approved entry", 422, "reason_required");
  }
  if (perm.scheduled_lock && !reason) {
    return err(request, "reason is required when deleting a locked entry", 422, "reason_required");
  }
  const deleteReason = perm.override ? `[admin delete of approved entry] ${reason}` : perm.scheduled_lock ? `[admin delete of scheduled-locked entry] ${reason}` : reason;
  const snap = env.DB.prepare(
    `INSERT INTO entry_deletions (id, entry_id, deleted_by, reason, was_approved, snapshot)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(
    uuid(),
    id,
    p.userId,
    deleteReason,
    perm.override ? 1 : 0,
    JSON.stringify(cur)
  );
  const del = env.DB.prepare("DELETE FROM time_entries WHERE id = ?").bind(id);
  if (perm.override) {
    try {
      await env.DB.batch([
        env.DB.prepare("INSERT INTO entry_edit_override (entry_id, user_id) VALUES (?, ?)").bind(id, p.userId),
        snap,
        del,
        env.DB.prepare("DELETE FROM entry_edit_override WHERE entry_id = ?").bind(id)
      ]);
    } catch (e) {
      if (isMissingOverrideSupport(e)) return err(request, MIGRATION_MSG, 409, "migration_required");
      throw e;
    }
  } else {
    try {
      await env.DB.batch([snap, del]);
    } catch (e) {
      if (!/entry_deletions|no such table/i.test(String(e && e.message || e))) throw e;
      await del.run();
    }
    await reopenSubmittedWeek(env, p, cur, tsStatus, { resetEntry: false });
  }
  return json(request, { ok: true, deleted: id });
}
export async function submitEntry(request, env, p, id) {
  if (isClient(p)) return err(request, "forbidden", 403);
  const cur = await fetchScoped(env, p, id);
  if (!cur) return err(request, "not found", 404);
  if (!isAdmin(p) && cur.user_id !== p.userId) return err(request, "forbidden", 403);
  if (cur.locked === 1) return err(request, "already approved+locked", 409, "locked");
  await env.DB.prepare(
    `UPDATE time_entries SET approval_status='submitted', updated_at=datetime('now') WHERE id=?`
  ).bind(id).run();
  return json(request, { ok: true, id, approval_status: "submitted" });
}
export async function reviewEntry(request, env, p, id) {
  if (!isAdmin(p)) return err(request, "admin only", 403);
  const b = await readJson(request);
  const decision = b.decision;
  if (decision !== "approve" && decision !== "reject") return err(request, "decision must be 'approve' or 'reject'", 422);
  const cur = await env.DB.prepare("SELECT * FROM time_entries WHERE id = ?").bind(id).first();
  if (!cur) return err(request, "not found", 404);
  if (cur.locked === 1) return err(request, "already approved+locked", 409, "locked");
  if (decision === "approve") {
    await env.DB.prepare(
      `UPDATE time_entries SET approval_status='approved', locked=1, approved_by=?, approved_at=datetime('now'),
         updated_at=datetime('now') WHERE id=?`
    ).bind(p.userId, id).run();
    return json(request, { ok: true, id, approval_status: "approved", locked: true });
  }
  await env.DB.prepare(
    `UPDATE time_entries SET approval_status='rejected', updated_at=datetime('now') WHERE id=?`
  ).bind(id).run();
  return json(request, { ok: true, id, approval_status: "rejected" });
}
