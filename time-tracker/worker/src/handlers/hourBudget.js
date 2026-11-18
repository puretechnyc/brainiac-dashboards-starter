import { json, err, readJson, uuid, weekStart, etToday, isIsoDate } from "../util.js";
import { isAdmin, isManager, isClient, loadAllStaffRoles } from "../auth.js";
import { createNotification, notifyAllAdmins } from "./notifications.js";
const BUDGET_TABLES = [
  "user_weekly_budgets",
  "hour_budget_grants",
  "hour_budget_requests",
  "hour_budget_alerts_sent"
];
export async function hasHourBudgetTables(env) {
  const placeholders = BUDGET_TABLES.map(() => "?").join(",");
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM sqlite_master
      WHERE type = 'table' AND name IN (${placeholders})`
  ).bind(...BUDGET_TABLES).first();
  return Number(row?.n || 0) === BUDGET_TABLES.length;
}
export function budgetWeek(dateStr) {
  if (dateStr === void 0 || dateStr === null || dateStr === "") {
    return weekStart(etToday());
  }
  const s = String(dateStr).slice(0, 10);
  if (!isIsoDate(s)) return null;
  return weekStart(s);
}
export function weekEnd(weekStartDate) {
  if (!weekStartDate) return null;
  const d = /* @__PURE__ */ new Date(`${weekStartDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 6);
  return d.toISOString().slice(0, 10);
}
export async function countedHours(env, userId, weekStartDate) {
  const row = await env.DB.prepare(
    `SELECT COALESCE(SUM(hours), 0) AS h
       FROM time_entries
      WHERE user_id = ?
        AND entry_type = 'work'
        AND entry_date >= ? AND entry_date <= date(?, '+6 days')`
  ).bind(userId, weekStartDate, weekStartDate).first();
  return Number(row?.h || 0);
}
export async function effectiveBudget(env, userId, weekStartDate) {
  const weekRow = await env.DB.prepare(
    "SELECT budget_hours FROM user_weekly_budgets WHERE user_id = ? AND week_start = ?"
  ).bind(userId, weekStartDate).first();
  const standing = await env.DB.prepare(
    "SELECT budget_hours FROM user_weekly_budgets WHERE user_id = ? AND week_start IS NULL"
  ).bind(userId).first();
  const base = weekRow?.budget_hours ?? standing?.budget_hours ?? null;
  const grantedRow = await env.DB.prepare(
    `SELECT COALESCE(SUM(extra_hours), 0) AS h
       FROM hour_budget_grants WHERE user_id = ? AND week_start = ?`
  ).bind(userId, weekStartDate).first();
  const granted = Number(grantedRow?.h || 0);
  return {
    base: base === null ? null : Number(base),
    granted,
    effective: base === null ? null : Number(base) + granted
  };
}
export async function budgetStatus(env, userId, weekStartDate) {
  const { base, granted, effective } = await effectiveBudget(env, userId, weekStartDate);
  const used = await countedHours(env, userId, weekStartDate);
  const hasBudget = effective !== null && effective > 0;
  const remaining = hasBudget ? Number((effective - used).toFixed(2)) : null;
  const pctUsed = hasBudget ? Number((used / effective * 100).toFixed(1)) : null;
  return {
    week_start: weekStartDate,
    base_budget_hours: base,
    granted_hours: Number(granted.toFixed(2)),
    effective_budget_hours: effective === null ? null : Number(effective.toFixed(2)),
    used_hours: Number(used.toFixed(2)),
    remaining_hours: remaining,
    pct_used: pctUsed,
    has_budget: hasBudget,
    over_budget: hasBudget ? used > effective + 1e-9 : false,
    at_limit: hasBudget ? used >= effective - 1e-9 : false
  };
}
export async function pendingRequestFor(env, userId, weekStartDate) {
  return env.DB.prepare(
    `SELECT id, user_id, week_start, hours, reason, status, created_at
       FROM hour_budget_requests
      WHERE user_id = ? AND week_start = ? AND status = 'pending'`
  ).bind(userId, weekStartDate).first();
}
export const HOUR_BUDGET_WARNING_PCT = 80;
export function hourBudgetState(st) {
  if (!st.has_budget) return "no_budget";
  if (st.over_budget) return "over_budget";
  if (st.at_limit) return "at_limit";
  if (st.pct_used !== null && st.pct_used !== void 0 && st.pct_used >= HOUR_BUDGET_WARNING_PCT) return "near_limit";
  return "on_track";
}
export async function checkHourBudgetWarning(env, p, weekStartDate, subject) {
  if (!p || isClient(p)) return { warning: null };
  if (!await hasHourBudgetTables(env)) return { warning: null };
  const st = await budgetStatus(env, p.userId, weekStartDate);
  const state = hourBudgetState(st);
  if (state === "no_budget" || state === "on_track") return { warning: null };
  const pending = await pendingRequestFor(env, p.userId, weekStartDate);
  const budget = st.effective_budget_hours;
  const used = st.used_hours;
  const other = !!(subject && subject.id);
  const who = other ? subject.name || "that person" : null;
  const message = state === "near_limit" ? other ? `${who} has used ${used}h of their ${budget}h weekly budget for the week of ${weekStartDate} — an admin can grant more hours if they need them` : `you have used ${used}h of your ${budget}h weekly budget for the week of ${weekStartDate} — ask an admin for more hours if you need them` : other ? `${who} has used their weekly hour budget (${used}h of ${budget}h for the week of ${weekStartDate}) — an admin can grant more hours` : `you have used your weekly hour budget (${used}h of ${budget}h for the week of ${weekStartDate}) — an admin can grant more hours`;
  return {
    warning: {
      code: "hour_budget_warning",
      state,
      week_start: weekStartDate,
      budget_hours: budget,
      used_hours: used,
      remaining_hours: st.remaining_hours,
      pct_used: st.pct_used,
      message,
      pending_request_id: pending ? pending.id : null,
      request_hint: other ? `POST /api/hour-budget/budget { "user_id": "${subject.id}", "week_start": "${weekStartDate}", "budget_hours": <n> } — an admin can raise ${who}'s budget` : `POST /api/hour-budget/request { "week_start": "${weekStartDate}", "hours": <n>, "reason": "..." } to ask an admin for more hours`
    }
  };
}
export async function checkHourBudgetAlerts(env, userId, weekStartDate, subjectName) {
  try {
    if (!await hasHourBudgetTables(env)) return;
    const st = await budgetStatus(env, userId, weekStartDate);
    if (!st.has_budget) return;
    const budget = st.effective_budget_hours;
    const used = st.used_hours;
    const usedText = subjectName ? `${subjectName} has used ${used}h of their ${budget}h budget` : `you have used ${used}h of your ${budget}h budget`;
    const limitText = subjectName ? `${subjectName} has reached their ${budget}h budget` : `you have reached your ${budget}h budget`;
    if (st.pct_used >= HOUR_BUDGET_WARNING_PCT) {
      await fireHourBudgetAlert(
        env,
        userId,
        weekStartDate,
        "warning_80",
        `Weekly hours: ${usedText} for the week of ${weekStartDate} (${st.pct_used}%).`
      );
    }
    if (st.at_limit) {
      await fireHourBudgetAlert(
        env,
        userId,
        weekStartDate,
        "warning_80",
        `Weekly hours: ${usedText} for the week of ${weekStartDate}.`
      );
      await fireHourBudgetAlert(
        env,
        userId,
        weekStartDate,
        "limit_100",
        `Weekly hours: ${limitText} for the week of ${weekStartDate}. An admin can grant more hours.`
      );
    }
  } catch (_) {
  }
}
async function fireHourBudgetAlert(env, userId, weekStartDate, threshold, message) {
  try {
    const existing = await env.DB.prepare(
      "SELECT id FROM hour_budget_alerts_sent WHERE user_id = ? AND week_start = ? AND threshold = ?"
    ).bind(userId, weekStartDate, threshold).first();
    if (existing) return;
    try {
      await env.DB.prepare(
        `INSERT INTO hour_budget_alerts_sent (id, user_id, week_start, threshold)
         VALUES (?, ?, ?, ?)`
      ).bind(uuid(), userId, weekStartDate, threshold).run();
    } catch (e) {
      if (String(e).includes("UNIQUE")) return;
      throw e;
    }
    const type = threshold === "limit_100" ? "hour_budget_limit" : "hour_budget_warning";
    await createNotification(env, userId, type, message);
    await notifyAllAdmins(env, type, message);
  } catch (_) {
  }
}
export async function myHourBudget(request, env, p, url) {
  if (isClient(p)) return err(request, "not available for client accounts", 403);
  if (!await hasHourBudgetTables(env)) {
    return err(request, "weekly hour budgets need database migration 023", 409, "migration_required");
  }
  const week = budgetWeek(url.searchParams.get("week_start"));
  if (!week) return err(request, "week_start must be a date (YYYY-MM-DD)", 422);
  const st = await budgetStatus(env, p.userId, week);
  const pending = await pendingRequestFor(env, p.userId, week);
  return json(request, {
    ok: true,
    ...st,
    week_end: weekEnd(week),
    pending_request: pending ? {
      id: pending.id,
      hours: pending.hours,
      reason: pending.reason,
      status: pending.status,
      created_at: pending.created_at
    } : null
  });
}
export async function requestHourBudget(request, env, p) {
  if (isClient(p)) return err(request, "not available for client accounts", 403);
  if (!await hasHourBudgetTables(env)) {
    return err(request, "weekly hour budgets need database migration 023", 409, "migration_required");
  }
  const b = await readJson(request);
  const week = budgetWeek(b.week_start);
  if (!week) return err(request, "week_start must be a date (YYYY-MM-DD)", 422);
  const hours = Number(b.hours);
  if (!Number.isFinite(hours) || hours <= 0) return err(request, "hours must be greater than 0", 422);
  if (hours > 168) return err(request, "hours cannot exceed 168 (a week)", 422);
  const reason = String(b.reason || "").trim();
  if (!reason) return err(request, "a reason is required — the admin approves this by hand", 422);
  const st = await budgetStatus(env, p.userId, week);
  if (!st.has_budget) {
    return err(request, "you have no weekly hour budget set, so there is nothing to ask for more of", 409, "no_budget");
  }
  const existing = await pendingRequestFor(env, p.userId, week);
  if (existing) {
    return json(request, {
      ok: false,
      error: "you already have a request pending for this week",
      code: "already_pending",
      pending_request_id: existing.id
    }, 409);
  }
  const id = uuid();
  try {
    await env.DB.prepare(
      `INSERT INTO hour_budget_requests (id, user_id, week_start, hours, reason, status)
       VALUES (?, ?, ?, ?, ?, 'pending')`
    ).bind(id, p.userId, week, hours, reason).run();
  } catch (e) {
    if (String(e).includes("UNIQUE")) {
      return err(request, "you already have a request pending for this week", 409, "already_pending");
    }
    throw e;
  }
  const row = await env.DB.prepare("SELECT * FROM hour_budget_requests WHERE id = ?").bind(id).first();
  await notifyAllAdmins(
    env,
    "hour_budget_request",
    `Weekly hours: ${p.email || "a staff member"} asked for ${hours} more hours for the week of ${week}. Reason: ${reason}`
  );
  return json(request, { ok: true, request: row }, 201);
}
export async function listHourBudgetRequests(request, env, p, url) {
  if (!isAdmin(p)) return err(request, "admin only", 403);
  if (!await hasHourBudgetTables(env)) {
    return err(request, "weekly hour budgets need database migration 023", 409, "migration_required");
  }
  const week = budgetWeek(url.searchParams.get("week_start"));
  if (!week) return err(request, "week_start must be a date (YYYY-MM-DD)", 422);
  const rows = (await env.DB.prepare(
    `SELECT r.*, u.email AS user_email, u.display_name AS user_display_name,
            d.email AS decided_by_email
       FROM hour_budget_requests r
       JOIN users u ON u.id = r.user_id
       LEFT JOIN users d ON d.id = r.decided_by
      WHERE r.week_start = ?
      ORDER BY (r.status = 'pending') DESC, r.created_at DESC`
  ).bind(week).all()).results || [];
  const pendingCount = rows.filter((r) => r.status === "pending").length;
  return json(request, { ok: true, week_start: week, requests: rows, pending_count: pendingCount });
}
export async function decideHourBudgetRequest(request, env, p, id) {
  if (!isAdmin(p)) return err(request, "admin only", 403);
  if (!await hasHourBudgetTables(env)) {
    return err(request, "weekly hour budgets need database migration 023", 409, "migration_required");
  }
  const b = await readJson(request);
  const decision = String(b.decision || "").toLowerCase();
  if (!["approve", "deny"].includes(decision)) return err(request, "decision must be approve or deny", 422);
  const cur = await env.DB.prepare("SELECT * FROM hour_budget_requests WHERE id = ?").bind(id).first();
  if (!cur) return err(request, "request not found", 404);
  if (cur.status !== "pending") {
    return err(request, `this request was already ${cur.status}`, 409, "already_decided");
  }
  if (cur.user_id === p.userId) {
    return err(request, "you cannot approve your own request — another admin must do it", 403, "self_decision");
  }
  const note = String(b.note || "").trim();
  const now = (/* @__PURE__ */ new Date()).toISOString();
  if (decision === "deny") {
    await env.DB.prepare(
      `UPDATE hour_budget_requests
          SET status = 'denied', decided_by = ?, decided_at = ?, decision_note = ?
        WHERE id = ?`
    ).bind(p.userId, now, note, id).run();
    const row2 = await env.DB.prepare("SELECT * FROM hour_budget_requests WHERE id = ?").bind(id).first();
    await createNotification(
      env,
      cur.user_id,
      "hour_budget_denied",
      `Weekly hours: your request for the week of ${cur.week_start} was declined${note ? ` — ${note}` : ""}.`
    );
    return json(request, { ok: true, decision: "denied", request: row2, granted: false });
  }
  const asked = Number(cur.hours);
  let extra = Number(b.extra_hours);
  if (!Number.isFinite(extra) || extra <= 0) extra = asked;
  if (extra > 168) return err(request, "extra_hours cannot exceed 168 (a week)", 422);
  const grantId = uuid();
  const stmts = [
    env.DB.prepare(
      `INSERT INTO hour_budget_grants (id, user_id, week_start, extra_hours, request_id, granted_by)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(grantId, cur.user_id, cur.week_start, extra, id, p.userId),
    env.DB.prepare(
      `UPDATE hour_budget_requests
          SET status = 'approved', granted_hours = ?, decided_by = ?, decided_at = ?, decision_note = ?
        WHERE id = ?`
    ).bind(extra, p.userId, now, note, id)
  ];
  await env.DB.batch(stmts);
  const row = await env.DB.prepare("SELECT * FROM hour_budget_requests WHERE id = ?").bind(id).first();
  await createNotification(
    env,
    cur.user_id,
    "hour_budget_approved",
    `Weekly hours: you were granted ${extra} extra hours for the week of ${cur.week_start}. Your total is now ${extra} more than your budget.`
  );
  const after = await budgetStatus(env, cur.user_id, cur.week_start);
  return json(request, {
    ok: true,
    decision: "approved",
    request: row,
    granted: true,
    granted_hours: extra,
    effective_budget_hours: after.effective_budget_hours
  });
}
export async function hourBudgetOverview(request, env, p, url) {
  if (!isAdmin(p) && !isManager(p)) return err(request, "admin or manager only", 403);
  if (!await hasHourBudgetTables(env)) {
    return err(request, "weekly hour budgets need database migration 023", 409, "migration_required");
  }
  const week = budgetWeek(url.searchParams.get("week_start"));
  if (!week) return err(request, "week_start must be a date (YYYY-MM-DD)", 422);
  const roleMap = await loadAllStaffRoles(env);
  const staff = (await env.DB.prepare(
    `SELECT id, email, display_name, role, active
       FROM users WHERE role <> 'client' ORDER BY display_name, email`
  ).all()).results || [];
  const budgets = (await env.DB.prepare("SELECT * FROM user_weekly_budgets").all()).results || [];
  const grants = (await env.DB.prepare(
    "SELECT user_id, week_start, COALESCE(SUM(extra_hours),0) AS h FROM hour_budget_grants GROUP BY user_id, week_start"
  ).all()).results || [];
  const used = (await env.DB.prepare(
    `SELECT user_id, COALESCE(SUM(hours),0) AS h
       FROM time_entries
      WHERE entry_type = 'work' AND entry_date >= ? AND entry_date <= date(?, '+6 days')
      GROUP BY user_id`
  ).bind(week, week).all()).results || [];
  const pendings = (await env.DB.prepare(
    `SELECT id, user_id, hours FROM hour_budget_requests
      WHERE week_start = ? AND status = 'pending'`
  ).bind(week).all()).results || [];
  const budgetByUserWeek = new Map(budgets.filter((b) => b.week_start === week).map((b) => [b.user_id, Number(b.budget_hours)]));
  const standingByUser = new Map(budgets.filter((b) => b.week_start === null).map((b) => [b.user_id, Number(b.budget_hours)]));
  const grantByUser = new Map(grants.filter((g) => g.week_start === week).map((g) => [g.user_id, Number(g.h)]));
  const usedByUser = new Map(used.map((u) => [u.user_id, Number(u.h)]));
  const pendingByUser = new Map(pendings.map((r) => [r.user_id, r]));
  const rows = staff.map((s) => {
    const roles = roleMap.get(s.id) || [];
    const manager = s.role === "employee" && roles.includes("manager");
    const base = budgetByUserWeek.has(s.id) ? budgetByUserWeek.get(s.id) : standingByUser.get(s.id) ?? null;
    const granted = grantByUser.get(s.id) || 0;
    const effective = base === null ? null : base + granted;
    const u = usedByUser.get(s.id) || 0;
    const hasBudget = effective !== null && effective > 0;
    const pending = pendingByUser.get(s.id);
    return {
      user_id: s.id,
      email: s.email,
      name: s.display_name || s.email,
      role: s.role,
      roles,
      manager,
      effective_role: manager ? "manager" : s.role,
      active: s.active === 1 || s.active === void 0,
      base_budget_hours: base,
      granted_hours: Number(granted.toFixed(2)),
      effective_budget_hours: hasBudget ? Number(effective.toFixed(2)) : null,
      used_hours: Number(u.toFixed(2)),
      remaining_hours: hasBudget ? Number((effective - u).toFixed(2)) : null,
      pct_used: hasBudget ? Number((u / effective * 100).toFixed(1)) : null,
      over_budget: hasBudget ? u > effective + 1e-9 : false,
      at_limit: hasBudget ? u >= effective - 1e-9 : false,
      has_budget: hasBudget,
      has_pending_request: !!pending
    };
  });
  return json(request, {
    ok: true,
    week_start: week,
    week_end: weekEnd(week),
    can_decide: isAdmin(p),
    staff: rows,
    staff_count: rows.length,
    pending_count: pendings.length
  });
}
export async function setHourBudget(request, env, p) {
  if (!isAdmin(p)) return err(request, "admin only", 403);
  if (!await hasHourBudgetTables(env)) {
    return err(request, "weekly hour budgets need database migration 023", 409, "migration_required");
  }
  const b = await readJson(request);
  const userId = b.user_id ? String(b.user_id) : "";
  if (!userId) return err(request, "user_id required", 422);
  const target = await env.DB.prepare(
    "SELECT id, email, display_name, role, active FROM users WHERE id = ?"
  ).bind(userId).first();
  if (!target) return err(request, "no user with that id", 404);
  if (target.role === "client") {
    return err(request, "a client login never logs time, so it cannot have an hour budget", 422, "not_staff");
  }
  const week = b.week_start === void 0 || b.week_start === null || b.week_start === "" ? null : budgetWeek(b.week_start);
  if (b.week_start !== void 0 && b.week_start !== null && b.week_start !== "" && !week) {
    return err(request, "week_start must be a date (YYYY-MM-DD)", 422);
  }
  const hours = Number(b.budget_hours);
  if (!Number.isFinite(hours) || hours < 0) return err(request, "budget_hours must be zero or more", 422);
  if (hours > 168) return err(request, "budget_hours cannot exceed 168 (a week)", 422);
  if (hours === 0) {
    if (week === null) {
      await env.DB.prepare("DELETE FROM user_weekly_budgets WHERE user_id = ? AND week_start IS NULL").bind(userId).run();
    } else {
      await env.DB.prepare("DELETE FROM user_weekly_budgets WHERE user_id = ? AND week_start = ?").bind(userId, week).run();
    }
    const st2 = await budgetStatus(env, userId, week || budgetWeek(null));
    return json(request, { ok: true, cleared: true, user_id: userId, week_start: week, budget: st2 });
  }
  const id = uuid();
  if (week === null) {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM user_weekly_budgets WHERE user_id = ? AND week_start IS NULL").bind(userId),
      env.DB.prepare(
        `INSERT INTO user_weekly_budgets (id, user_id, week_start, budget_hours, set_by)
         VALUES (?, ?, NULL, ?, ?)`
      ).bind(id, userId, hours, p.userId)
    ]);
  } else {
    const existing = await env.DB.prepare(
      "SELECT id FROM user_weekly_budgets WHERE user_id = ? AND week_start = ?"
    ).bind(userId, week).first();
    if (existing) {
      await env.DB.prepare(
        `UPDATE user_weekly_budgets
            SET budget_hours = ?, set_by = ?, updated_at = datetime('now')
          WHERE id = ?`
      ).bind(hours, p.userId, existing.id).run();
    } else {
      await env.DB.prepare(
        `INSERT INTO user_weekly_budgets (id, user_id, week_start, budget_hours, set_by)
         VALUES (?, ?, ?, ?, ?)`
      ).bind(id, userId, week, hours, p.userId).run();
    }
  }
  const st = await budgetStatus(env, userId, week || budgetWeek(null));
  return json(request, { ok: true, user_id: userId, week_start: week, standing: week === null, budget: st });
}
