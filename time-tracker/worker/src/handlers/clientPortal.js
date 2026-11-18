import { json, err } from "../util.js";
import { isClient } from "../auth.js";
import { clientBillingSnapshot } from "../billingSnapshot.js";
export async function clientDashboard(request, env, p) {
  if (!isClient(p)) return err(request, "client portal is for client users only", 403);
  if (!p.clientId) return err(request, "no client_id bound to this user", 403);
  const snap = await clientBillingSnapshot(env, p.clientId, { activityLimit: 10, invoiceLimit: 10 });
  if (!snap) return err(request, "client not found", 404);
  return json(request, {
    ok: true,
    dashboard: {
      client_name: snap.client.name,
      currency: snap.client.currency,
      this_week_hours: snap.this_week_hours,
      this_month_hours: snap.this_month_hours,
      total_hours: snap.total_hours,
      week_start: snap.week_start,
      month_start: snap.month_start,
      cap: snap.cap,
      recent_activity: snap.recent_activity,
      invoices: snap.invoices
    }
  });
}
export async function clientActivity(request, env, p, url) {
  if (!isClient(p)) return err(request, "client portal is for client users only", 403);
  if (!p.clientId) return err(request, "no client_id bound to this user", 403);
  const clientId = p.clientId;
  const limit = Math.min(Math.max(1, parseInt(url.searchParams.get("limit"), 10) || 25), 100);
  const offset = Math.max(0, parseInt(url.searchParams.get("offset"), 10) || 0);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const clauses = ["client_id = ?", "is_billable = 1"];
  const params = [clientId];
  if (from) {
    clauses.push("entry_date >= ?");
    params.push(from);
  }
  if (to) {
    clauses.push("entry_date <= ?");
    params.push(to);
  }
  const rows = (await env.DB.prepare(
    `SELECT entry_date, project_task, hours, notes FROM time_entries
      WHERE ${clauses.join(" AND ")}
      ORDER BY entry_date DESC, created_at DESC
      LIMIT ? OFFSET ?`
  ).bind(...params, limit, offset).all()).results || [];
  const entries = rows.map((r) => ({
    entry_date: r.entry_date,
    project_task: r.project_task || "",
    hours: r.hours,
    description: r.notes || ""
  }));
  return json(request, { ok: true, entries, limit, offset });
}
export async function clientHoursSummary(request, env, p) {
  if (!isClient(p)) return err(request, "client portal is for client users only", 403);
  if (!p.clientId) return err(request, "no client_id bound to this user", 403);
  const snap = await clientBillingSnapshot(env, p.clientId, { activityLimit: 0, invoiceLimit: 0 });
  if (!snap) return err(request, "client not found", 404);
  return json(request, {
    ok: true,
    summary: {
      client_name: snap.client.name,
      currency: snap.client.currency,
      this_week_hours: snap.this_week_hours,
      this_month_hours: snap.this_month_hours,
      total_hours: snap.total_hours,
      cap: snap.cap
    }
  });
}
