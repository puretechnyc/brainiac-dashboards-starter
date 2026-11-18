import { json, err, readJson, uuid, weekStart, etToday } from "../util.js";
import { canWrite, isClient } from "../auth.js";
import { ensureTimesheet, clientWeekStart } from "./timesheets.js";
import { checkBudgetAlerts, checkUnderTargetAlerts } from "./budget.js";
import { tagEntrySource } from "./weekly.js";
import { checkClientAssignment, resolveDepartment, columnExists } from "./timeEntries.js";
import { checkHourBudgetWarning, checkHourBudgetAlerts } from "./hourBudget.js";
export const MAX_ENTRY_MINUTES = 24 * 60;
export function timerElapsedToHours(elapsedMs) {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 6e4) return null;
  const minutes = Math.min(Math.round(elapsedMs / 6e4), MAX_ENTRY_MINUTES);
  return { minutes, hours: minutes / 60 };
}
export async function startTimer(request, env, p) {
  if (!canWrite(p)) return err(request, "read-only role cannot start timer", 403);
  const b = await readJson(request);
  if (!b.client_id) return err(request, "client_id required", 422);
  const client = await env.DB.prepare("SELECT * FROM clients WHERE id = ?").bind(b.client_id).first();
  if (!client) return err(request, "client not found", 404);
  if (client.archived) return err(request, "client is archived; timer cannot be started", 409, "client_archived");
  if (client.paused) return err(request, "This client is paused; ask an admin.", 409, "client_paused");
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
  if (!await columnExists(env, "active_timers", "department_id")) {
    return err(
      request,
      "timer departments need database migration 031 (POST /api/admin/apply-migration-031) — nothing was created",
      409,
      "migration_required"
    );
  }
  const dep = await resolveDepartment(request, env, b.department_id, { required: true });
  if (!dep.ok) return dep.response;
  const departmentId = dep.departmentId;
  const budgetWeek = weekStart(etToday());
  const budget = await checkHourBudgetWarning(env, p, budgetWeek);
  const existing = await env.DB.prepare(
    "SELECT id FROM active_timers WHERE user_id = ?"
  ).bind(p.userId).first();
  if (existing) return err(request, "a timer is already running — stop it first", 409, "timer_active");
  const id = uuid();
  const startedAt = (/* @__PURE__ */ new Date()).toISOString();
  await env.DB.prepare(
    `INSERT INTO active_timers (id, user_id, client_id, department_id, project_task, notes, started_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, p.userId, b.client_id, departmentId, b.project_task || "", b.notes || "", startedAt).run();
  return json(request, {
    ok: true,
    timer: {
      id,
      user_id: p.userId,
      client_id: b.client_id,
      client_name: client.name,
      department_id: departmentId,
      project_task: b.project_task || "",
      notes: b.notes || "",
      started_at: startedAt
    },
    warning: budget.warning
  }, 201);
}
export async function stopTimer(request, env, p) {
  if (!canWrite(p)) return err(request, "read-only role cannot stop timer", 403);
  const timer = await env.DB.prepare(
    `SELECT at.*, c.name AS client_name, c.rate_cents AS client_rate_cents
       FROM active_timers at
       JOIN clients c ON c.id = at.client_id
      WHERE at.user_id = ?`
  ).bind(p.userId).first();
  if (!timer) return err(request, "no active timer", 404, "no_timer");
  const started = new Date(timer.started_at);
  const now = /* @__PURE__ */ new Date();
  const elapsedMs = now.getTime() - started.getTime();
  const conv = timerElapsedToHours(elapsedMs);
  if (!conv) {
    await env.DB.prepare("DELETE FROM active_timers WHERE id = ?").bind(timer.id).run();
    return json(request, {
      ok: true,
      discarded: true,
      elapsed_seconds: Math.max(0, Math.floor(elapsedMs / 1e3)),
      elapsed_minutes: Math.max(0, Math.floor(elapsedMs / 6e4))
    });
  }
  const cappedHours = conv.hours;
  const loggedMinutes = conv.minutes;
  const assignment = await checkClientAssignment(env, p, timer.client_id);
  if (!assignment.ok) {
    return json(request, {
      ok: false,
      error: `you are not assigned to ${timer.client_name} — the timer is still running; request access and stop it again once it is approved`,
      code: assignment.code,
      client_id: timer.client_id,
      client_name: timer.client_name,
      pending_request_id: assignment.pending_request_id,
      request_hint: 'POST /api/work-requests { "client_id": "' + timer.client_id + '" } to request access',
      timer_still_running: true
    }, 403);
  }
  if (!await columnExists(env, "active_timers", "department_id")) {
    return json(request, {
      ok: false,
      error: "timer departments need database migration 031 (POST /api/admin/apply-migration-031) — the timer is still running",
      code: "migration_required",
      timer_still_running: true
    }, 409);
  }
  const stopBody = await readJson(request).catch(() => ({}));
  const captured = timer.department_id || null;
  const picked = stopBody.department_id == null ? "" : String(stopBody.department_id).trim();
  const look = async (id) => {
    let row;
    try {
      row = await env.DB.prepare("SELECT id, hidden FROM departments WHERE id = ?").bind(id).first();
    } catch (e) {
      if (!/no such table: departments/i.test(String(e && e.message || e))) throw e;
      return { state: "table_missing" };
    }
    if (!row) return { state: "not_found" };
    if (row.hidden) return { state: "hidden" };
    return { state: "ok" };
  };
  const migration025 = () => json(request, {
    ok: false,
    error: "departments need database migration 025 (POST /api/admin/apply-migration-025) — the timer is still running",
    code: "migration_required",
    timer_still_running: true
  }, 409);
  let entryDepartmentId = null;
  if (captured) {
    const cap = await look(captured);
    if (cap.state === "table_missing") return migration025();
    if (cap.state === "ok") entryDepartmentId = captured;
  }
  if (!entryDepartmentId) {
    if (!picked) {
      if (!captured) {
        return json(request, { ok: false, error: "department_required", code: "department_required", timer_still_running: true }, 422);
      }
      const cap = await look(captured);
      if (cap.state === "hidden") {
        return json(request, { ok: false, error: "that department was archived — pick a department to log this time under; the timer is still running", code: "department_hidden", timer_still_running: true }, 409);
      }
      return json(request, { ok: false, error: "that department no longer exists — pick a department to log this time under; the timer is still running", code: "bad_department", timer_still_running: true }, 404);
    }
    const pick = await look(picked);
    if (pick.state === "table_missing") return migration025();
    if (pick.state === "not_found") {
      return json(request, { ok: false, error: "that department does not exist — pick a department to log this time under; the timer is still running", code: "bad_department", timer_still_running: true }, 404);
    }
    if (pick.state === "hidden") {
      return json(request, { ok: false, error: "that department is archived — pick a department to log this time under; the timer is still running", code: "department_hidden", timer_still_running: true }, 409);
    }
    entryDepartmentId = picked;
  }
  const entryDate = etToday(started);
  const rate = timer.client_rate_cents || 0;
  const isBillable = 1;
  const wk = await clientWeekStart(env, timer.client_id, entryDate);
  const ts = await ensureTimesheet(env, p.userId, timer.client_id, wk);
  let timesheetId = ts.id;
  let actualDate = entryDate;
  if (ts.status === "submitted" || ts.status === "approved") {
    actualDate = etToday(now);
    const todayWk = await clientWeekStart(env, timer.client_id, actualDate);
    const todayTs = await ensureTimesheet(env, p.userId, timer.client_id, todayWk);
    timesheetId = todayTs.id;
  }
  if (ts.status === "rejected") {
    await env.DB.prepare(
      `UPDATE timesheets SET status='open', updated_at=datetime('now') WHERE id = ?`
    ).bind(ts.id).run();
  }
  const entryId = uuid();
  const cols = ["id", "user_id", "client_id", "project_task", "entry_date", "hours", "rate_cents", "is_billable", "notes", "timesheet_id"];
  const vals = [entryId, p.userId, timer.client_id, timer.project_task || "", actualDate, cappedHours, rate, isBillable, timer.notes || "", timesheetId];
  if (await columnExists(env, "time_entries", "department_id")) {
    cols.push("department_id");
    vals.push(entryDepartmentId);
  }
  await env.DB.prepare(
    `INSERT INTO time_entries (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`
  ).bind(...vals).run();
  await tagEntrySource(env, entryId, "timer");
  await env.DB.prepare("DELETE FROM active_timers WHERE id = ?").bind(timer.id).run();
  const entry = await env.DB.prepare("SELECT * FROM time_entries WHERE id = ?").bind(entryId).first();
  await checkBudgetAlerts(env, timer.client_id);
  await checkUnderTargetAlerts(env);
  await checkHourBudgetAlerts(env, p.userId, weekStart(actualDate));
  return json(request, {
    ok: true,
    entry,
    elapsed_hours: cappedHours,
    elapsed_minutes: loggedMinutes
  });
}
export async function currentTimer(request, env, p) {
  if (isClient(p)) return json(request, { ok: true, timer: null });
  const timer = await env.DB.prepare(
    `SELECT at.*, c.name AS client_name
       FROM active_timers at
       JOIN clients c ON c.id = at.client_id
      WHERE at.user_id = ?`
  ).bind(p.userId).first();
  return json(request, { ok: true, timer: timer || null });
}
