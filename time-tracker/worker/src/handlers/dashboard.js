import { json, weekStart } from "../util.js";
import { isAdmin, isClient } from "../auth.js";
import { clientWeekProgress, checkUnderTargetAlerts } from "./budget.js";
export async function meSummary(request, env, p) {
  if (isClient(p)) {
    return json(request, {
      ok: true,
      summary: { role: "client", today_hours: 0, week_hours: 0, timer: null, recent: [], pending_timesheets: 0 }
    });
  }
  const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const thisWeek = weekStart(today);
  const todayRow = await env.DB.prepare(
    `SELECT COALESCE(SUM(hours), 0) AS total FROM time_entries WHERE user_id = ? AND entry_date = ?`
  ).bind(p.userId, today).first();
  const weekRow = await env.DB.prepare(
    `SELECT COALESCE(SUM(hours), 0) AS total FROM time_entries
      WHERE user_id = ? AND entry_date >= ? AND entry_date <= date(?, '+6 days')`
  ).bind(p.userId, thisWeek, thisWeek).first();
  const timer = await env.DB.prepare(
    `SELECT at.*, c.name AS client_name
       FROM active_timers at
       JOIN clients c ON c.id = at.client_id
      WHERE at.user_id = ?`
  ).bind(p.userId).first();
  const recent = (await env.DB.prepare(
    `SELECT t.*, c.name AS client_name FROM time_entries t
       JOIN clients c ON c.id = t.client_id
      WHERE t.user_id = ?
      ORDER BY t.entry_date DESC, t.created_at DESC
      LIMIT 5`
  ).bind(p.userId).all()).results || [];
  const pendingTs = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM timesheets
      WHERE user_id = ? AND status IN ('open', 'rejected')
        AND id IN (SELECT DISTINCT timesheet_id FROM time_entries WHERE timesheet_id IS NOT NULL)`
  ).bind(p.userId).first();
  const summary = {
    role: p.role,
    today_hours: todayRow?.total || 0,
    week_hours: weekRow?.total || 0,
    week_start: thisWeek,
    timer: timer || null,
    recent,
    pending_timesheets: pendingTs?.n || 0
  };
  if (isAdmin(p)) {
    const pendingApproval = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM timesheets WHERE status = 'submitted'`
    ).first();
    const teamWeek = await env.DB.prepare(
      `SELECT COALESCE(SUM(hours), 0) AS total FROM time_entries
        WHERE entry_date >= ? AND entry_date <= date(?, '+6 days')`
    ).bind(thisWeek, thisWeek).first();
    summary.pending_approvals = pendingApproval?.n || 0;
    summary.team_week_hours = teamWeek?.total || 0;
    const prog = await clientWeekProgress(env);
    if (prog.clients.length > 0) {
      await checkUnderTargetAlerts(env, prog);
      let mostCritical = null;
      let mostCriticalPct = 0;
      for (const c of prog.clients) {
        if (c.pct_of_cap > mostCriticalPct || !mostCritical) {
          mostCriticalPct = c.pct_of_cap;
          mostCritical = { client_name: c.client_name, pct_used: c.pct_of_cap, over_budget: c.effective_hours > c.hours_cap };
        }
      }
      summary.budget = {
        over_budget_count: prog.clients.filter((c) => c.effective_hours > c.hours_cap).length,
        behind_pace_count: prog.clients.filter((c) => c.status === "behind").length,
        most_critical: mostCritical
      };
    }
  }
  return json(request, { ok: true, summary });
}
