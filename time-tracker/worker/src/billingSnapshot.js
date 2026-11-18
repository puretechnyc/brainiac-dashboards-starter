import { weekStartForDay } from "./util.js";
const round2 = (n) => Number(Number(n || 0).toFixed(2));
export async function clientBillingSnapshot(env, clientId, opts = {}) {
  const {
    approvedOnly = false,
    includePending = false,
    activityLimit = 10,
    invoiceLimit = 10,
    now = /* @__PURE__ */ new Date()
  } = opts;
  const client = await env.DB.prepare(
    "SELECT * FROM clients WHERE id = ?"
  ).bind(clientId).first();
  if (!client) return null;
  const today = now.toISOString().slice(0, 10);
  const startDay = typeof client.week_start_day === "number" ? client.week_start_day : 1;
  const thisWeekStart = weekStartForDay(today, startDay) || today;
  const monthStart = today.slice(0, 7) + "-01";
  const approvalClause = approvedOnly ? " AND approval_status = 'approved'" : "";
  const where = `client_id = ? AND is_billable = 1${approvalClause}`;
  const weekRow = await env.DB.prepare(
    `SELECT COALESCE(SUM(hours), 0) AS total FROM time_entries
      WHERE ${where} AND entry_date >= ? AND entry_date <= date(?, '+6 days')`
  ).bind(clientId, thisWeekStart, thisWeekStart).first();
  const monthRow = await env.DB.prepare(
    `SELECT COALESCE(SUM(hours), 0) AS total FROM time_entries
      WHERE ${where} AND entry_date >= ? AND entry_date <= ?`
  ).bind(clientId, monthStart, today).first();
  const totalRow = await env.DB.prepare(
    `SELECT COALESCE(SUM(hours), 0) AS total FROM time_entries WHERE ${where}`
  ).bind(clientId).first();
  const thisWeek = round2(weekRow?.total);
  const thisMonth = round2(monthRow?.total);
  const total = round2(totalRow?.total);
  const cap = client.hours_cap == null ? null : Number(client.hours_cap);
  let capInfo = null;
  if (cap != null) {
    const remaining = round2(cap - thisWeek);
    const usedPct = cap > 0 ? Number((thisWeek / cap * 100).toFixed(1)) : 0;
    capInfo = {
      hours_cap: cap,
      hours_remaining: remaining,
      hours_used_pct: usedPct,
      over_cap: thisWeek > cap,
      basis: "week"
    };
  }
  let pendingWeek = 0;
  if (includePending) {
    const pendingRow = await env.DB.prepare(
      `SELECT COALESCE(SUM(hours), 0) AS total FROM time_entries
        WHERE client_id = ? AND is_billable = 1
          AND approval_status IN ('open','submitted')
          AND entry_date >= ? AND entry_date <= date(?, '+6 days')`
    ).bind(clientId, thisWeekStart, thisWeekStart).first();
    pendingWeek = round2(pendingRow?.total);
  }
  let recentActivity = [];
  if (activityLimit > 0) {
    const rows = (await env.DB.prepare(
      `SELECT entry_date, project_task, hours, notes FROM time_entries
        WHERE ${where}
        ORDER BY entry_date DESC, created_at DESC
        LIMIT ?`
    ).bind(clientId, activityLimit).all()).results || [];
    recentActivity = rows.map((r) => ({
      entry_date: r.entry_date,
      project_task: r.project_task || "",
      hours: r.hours,
      description: r.notes || ""
    }));
  }
  let invoices = [];
  if (invoiceLimit > 0) {
    const rows = (await env.DB.prepare(
      `SELECT id, invoice_number, period_start, period_end, status, currency,
              total_hours, total_cents, due_date, paid_at, paid_amount_cents, created_at
         FROM invoices WHERE client_id = ?
        ORDER BY created_at DESC LIMIT ?`
    ).bind(clientId, invoiceLimit).all()).results || [];
    invoices = rows.map((inv) => ({
      id: inv.id,
      invoice_number: inv.invoice_number,
      period_start: inv.period_start,
      period_end: inv.period_end,
      status: inv.status,
      currency: inv.currency,
      total_hours: inv.total_hours,
      total_cents: inv.total_cents,
      due_date: inv.due_date,
      paid_at: inv.paid_at,
      paid_amount_cents: inv.paid_amount_cents,
      created_at: inv.created_at
    }));
  }
  return {
    client: {
      id: client.id,
      name: client.name,
      currency: client.currency,
      billing_model: client.billing_model || "hourly",
      hours_cap: cap,
      week_start_day: startDay
    },
    today,
    week_start: thisWeekStart,
    month_start: monthStart,
    this_week_hours: thisWeek,
    this_month_hours: thisMonth,
    total_hours: total,
    pending_week_hours: pendingWeek,
    cap: capInfo,
    recent_activity: recentActivity,
    invoices
  };
}
