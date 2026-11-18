import { json, err, readJson, uuid, centsToStr, weekStartForDay } from "../util.js";
import { isAdmin, isClient, timesheetReadScope } from "../auth.js";
import { notifyAllAdmins, createNotification } from "./notifications.js";
import { sendReportEmail, brevoConfigured } from "../email.js";
import { readLockedThrough, weekLocked } from "./lock-schedule.js";
export async function ensureTimesheet(env, userId, clientId, weekStartDate) {
  const found = await env.DB.prepare(
    "SELECT * FROM timesheets WHERE user_id = ? AND client_id = ? AND week_start = ?"
  ).bind(userId, clientId, weekStartDate).first();
  if (found) return found;
  const id = uuid();
  try {
    await env.DB.prepare(
      `INSERT INTO timesheets (id, user_id, client_id, week_start, status)
       VALUES (?,?,?,?, 'open')`
    ).bind(id, userId, clientId, weekStartDate).run();
  } catch (e) {
    if (String(e).includes("UNIQUE")) {
      return env.DB.prepare(
        "SELECT * FROM timesheets WHERE user_id = ? AND client_id = ? AND week_start = ?"
      ).bind(userId, clientId, weekStartDate).first();
    }
    throw e;
  }
  return env.DB.prepare("SELECT * FROM timesheets WHERE id = ?").bind(id).first();
}
export async function clientWeekStart(env, clientId, entryDate) {
  const client = await env.DB.prepare(
    "SELECT week_start_day FROM clients WHERE id = ?"
  ).bind(clientId).first();
  const startDay = client && typeof client.week_start_day === "number" ? client.week_start_day : 1;
  return weekStartForDay(entryDate, startDay);
}
export async function listTimesheets(request, env, p, url) {
  const scope = timesheetReadScope(p, "ts");
  const clauses = [scope.sql];
  const params = [...scope.params];
  const cid = url.searchParams.get("client_id");
  const wk = url.searchParams.get("week_start");
  const st = url.searchParams.get("status");
  if (cid) {
    clauses.push("ts.client_id = ?");
    params.push(cid);
  }
  if (wk) {
    clauses.push("ts.week_start = ?");
    params.push(wk);
  }
  if (st) {
    clauses.push("ts.status = ?");
    params.push(st);
  }
  const entryVis = p.role === "client" ? "AND t.is_billable = 1" : "";
  const limit = Math.min(Math.max(1, parseInt(url.searchParams.get("limit"), 10) || 50), 200);
  const offset = Math.max(0, parseInt(url.searchParams.get("offset"), 10) || 0);
  const rows = (await env.DB.prepare(
    `SELECT ts.*, c.name AS client_name, c.currency,
            u.email AS user_email, u.display_name AS user_name,
            COUNT(t.id) AS entry_count,
            COALESCE(SUM(t.hours), 0) AS total_hours,
            COALESCE(SUM(CASE WHEN t.is_billable = 1 THEN t.hours ELSE 0 END), 0) AS billable_hours,
            COALESCE(SUM(CASE WHEN t.is_billable = 1
                              THEN CAST(ROUND(t.hours * t.rate_cents) AS INTEGER) ELSE 0 END), 0) AS billable_cents
       FROM timesheets ts
       JOIN clients c ON c.id = ts.client_id
       JOIN users   u ON u.id = ts.user_id
       LEFT JOIN time_entries t ON t.timesheet_id = ts.id ${entryVis}
      WHERE ${clauses.join(" AND ")}
      GROUP BY ts.id
      ORDER BY ts.week_start DESC, c.name
      LIMIT ? OFFSET ?`
  ).bind(...params, limit, offset).all()).results || [];
  const lockedThrough = await readLockedThrough(env);
  const timesheets = rows.map((r) => {
    const ts = {
      ...r,
      billable_amount: centsToStr(r.billable_cents),
      locked_by_schedule: weekLocked(r.week_start, lockedThrough)
    };
    if (isClient(p)) {
      delete ts.user_email;
      delete ts.user_name;
      delete ts.user_id;
    }
    return ts;
  });
  return json(request, { ok: true, timesheets, limit, offset });
}
export async function getTimesheet(request, env, p, id) {
  const scope = timesheetReadScope(p, "ts");
  const ts = await env.DB.prepare(
    `SELECT ts.*, c.name AS client_name, c.currency,
            u.email AS user_email, u.display_name AS user_name
       FROM timesheets ts
       JOIN clients c ON c.id = ts.client_id
       JOIN users   u ON u.id = ts.user_id
      WHERE ts.id = ? AND ${scope.sql}`
  ).bind(id, ...scope.params).first();
  if (!ts) return err(request, "not found", 404);
  const billableOnly = p.role === "client" ? "AND is_billable = 1" : "";
  const entries = (await env.DB.prepare(
    `SELECT * FROM time_entries WHERE timesheet_id = ? ${billableOnly}
      ORDER BY entry_date, created_at`
  ).bind(id).all()).results || [];
  let billableHours = 0, internalHours = 0, billableCents = 0;
  const lines = entries.map((r) => {
    const amt = Math.round(r.hours * r.rate_cents);
    if (r.is_billable) {
      billableHours += r.hours;
      billableCents += amt;
    } else internalHours += r.hours;
    const line = {
      id: r.id,
      entry_date: r.entry_date,
      project_task: r.project_task,
      hours: r.hours,
      is_billable: !!r.is_billable,
      rate_cents: r.rate_cents,
      amount_cents: r.is_billable ? amt : 0,
      amount: centsToStr(r.is_billable ? amt : 0),
      approval_status: r.approval_status,
      locked: !!r.locked,
      invoiced: !!r.invoice_id,
      notes: r.notes
    };
    if (isClient(p)) {
      delete line.rate_cents;
    }
    return line;
  });
  const user = isClient(p) ? {} : { id: ts.user_id, email: ts.user_email, name: ts.user_name };
  return json(request, {
    ok: true,
    timesheet: {
      id: ts.id,
      week_start: ts.week_start,
      status: ts.status,
      client: { id: ts.client_id, name: ts.client_name, currency: ts.currency },
      user,
      submitted_at: ts.submitted_at,
      approved_by: ts.approved_by,
      approved_at: ts.approved_at,
      reject_reason: ts.reject_reason || null,
      totals: {
        billable_hours: Number(billableHours.toFixed(2)),
        internal_hours: Number(internalHours.toFixed(2)),
        billable_amount_cents: billableCents,
        billable_amount: centsToStr(billableCents)
      },
      entries: lines
    }
  });
}
export async function submitTimesheet(request, env, p, id) {
  if (isClient(p)) return err(request, "read-only role cannot submit", 403);
  const scope = timesheetReadScope(p, "ts");
  const ts = await env.DB.prepare(
    `SELECT ts.* FROM timesheets ts WHERE ts.id = ? AND ${scope.sql}`
  ).bind(id, ...scope.params).first();
  if (!ts) return err(request, "not found", 404);
  if (!isAdmin(p) && ts.user_id !== p.userId) return err(request, "forbidden", 403);
  if (ts.status === "approved") return err(request, "week already approved+locked", 409, "locked");
  if (ts.status === "submitted") return err(request, "week already submitted", 409, "submitted");
  if (!isAdmin(p)) {
    const lockedThrough = await readLockedThrough(env);
    if (weekLocked(ts.week_start, lockedThrough)) {
      return err(request, "this week is locked. Ask an admin to change.", 409, "locked");
    }
  }
  const cnt = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM time_entries WHERE timesheet_id = ?"
  ).bind(id).first();
  if ((cnt?.n || 0) === 0) return err(request, "cannot submit an empty week", 422, "empty");
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE timesheets SET status='submitted', submitted_at=datetime('now'),
         updated_at=datetime('now') WHERE id = ?`
    ).bind(id),
    env.DB.prepare(
      `UPDATE time_entries SET approval_status='submitted', updated_at=datetime('now')
        WHERE timesheet_id = ? AND locked = 0 AND approval_status IN ('open','rejected')`
    ).bind(id)
  ]);
  const client = await env.DB.prepare("SELECT name FROM clients WHERE id = ?").bind(ts.client_id).first();
  const user = await env.DB.prepare("SELECT email, display_name FROM users WHERE id = ?").bind(ts.user_id).first();
  const userName = user?.display_name || user?.email || "Unknown";
  const clientName = client?.name || "Unknown";
  const weekLabel = ts.week_start;
  await notifyAllAdmins(
    env,
    "timesheet_submitted",
    `${userName} submitted timesheet for ${clientName}, week of ${weekLabel}`
  );
  return json(request, { ok: true, id, status: "submitted" });
}
export async function approveTimesheet(request, env, p, id) {
  if (!isAdmin(p)) return err(request, "admin only", 403);
  const b = await readJson(request);
  const decision = b.decision === void 0 ? "approve" : b.decision;
  if (decision !== "approve" && decision !== "reject") {
    return err(request, "decision must be 'approve' or 'reject'", 422);
  }
  const ts = await env.DB.prepare("SELECT * FROM timesheets WHERE id = ?").bind(id).first();
  if (!ts) return err(request, "not found", 404);
  if (ts.status === "approved") return err(request, "week already approved+locked", 409, "locked");
  if (ts.status !== "submitted") {
    return err(request, "week must be submitted before review", 409, "not_submitted");
  }
  if (decision === "reject") {
    const reason = (b.reason || "").trim();
    if (!reason) return err(request, "reason is required when rejecting", 422);
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE timesheets SET status='rejected', reject_reason=?, updated_at=datetime('now') WHERE id = ?`
      ).bind(reason, id),
      env.DB.prepare(
        `UPDATE time_entries SET approval_status='rejected', updated_at=datetime('now')
          WHERE timesheet_id = ? AND locked = 0`
      ).bind(id)
    ]);
    return json(request, { ok: true, id, status: "rejected", reason });
  }
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE time_entries SET approval_status='approved', locked=1, approved_by=?,
         approved_at=datetime('now'), updated_at=datetime('now')
        WHERE timesheet_id = ? AND locked = 0`
    ).bind(p.userId, id),
    env.DB.prepare(
      `UPDATE timesheets SET status='approved', approved_by=?, approved_at=datetime('now'),
         updated_at=datetime('now') WHERE id = ?`
    ).bind(p.userId, id)
  ]);
  const locked = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM time_entries WHERE timesheet_id = ? AND locked = 1"
  ).bind(id).first();
  let reportSent = false;
  try {
    const client = await env.DB.prepare(
      "SELECT * FROM clients WHERE id = ?"
    ).bind(ts.client_id).first();
    if (client && client.auto_send_report && client.contact_email) {
      const weekEntries = await env.DB.prepare(
        `SELECT COALESCE(SUM(hours), 0) AS total_hours,
                COALESCE(SUM(CASE WHEN is_billable = 1 THEN hours ELSE 0 END), 0) AS billable_hours
           FROM time_entries WHERE timesheet_id = ?`
      ).bind(id).first();
      const baseUrl = env && env.APP_BASE_URL || "";
      const result = await sendReportEmail(env, {
        recipientEmail: client.contact_email,
        recipientName: client.contact_name || "",
        clientName: client.name,
        weekStart: ts.week_start,
        totalHours: Number((weekEntries?.total_hours || 0).toFixed(2)),
        billableHours: Number((weekEntries?.billable_hours || 0).toFixed(2)),
        reportUrl: baseUrl ? `${baseUrl}/api/clients/${client.id}/report?from=${ts.week_start}` : ""
      });
      reportSent = result.sent || result.stubbed;
      if (reportSent) {
        await createNotification(
          env,
          p.userId,
          "report_sent",
          `Weekly report sent to ${client.contact_email} for ${client.name}, week of ${ts.week_start}`
        );
      }
    }
  } catch (_) {
  }
  return json(request, { ok: true, id, status: "approved", locked_entries: locked?.n || 0, report_sent: reportSent });
}
