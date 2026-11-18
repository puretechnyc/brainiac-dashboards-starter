import { json, err, weekStartForDay } from "../util.js";
import { timingSafeEqual, loadAllStaffRoles } from "../auth.js";
import { clientBillingSnapshot } from "../billingSnapshot.js";
import { isValidSlug } from "../slugs.js";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function presentedIntegrationToken(request) {
  const dedicated = request.headers.get("x-integration-token");
  if (dedicated && dedicated.trim()) return dedicated.trim();
  const auth = request.headers.get("authorization") || "";
  const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
  return m ? m[1].trim() : null;
}
export async function integrationAuth(request, env) {
  const token = env && env.INTEGRATION_TOKEN;
  if (!token || typeof token !== "string" || token.trim() === "") {
    return { ok: false, status: 503, message: "the service integration is not configured", code: "integration_not_configured" };
  }
  const presented = presentedIntegrationToken(request);
  if (!presented) return { ok: false, status: 401, message: "unauthorized", code: "unauthorized" };
  const ok = await timingSafeEqual(presented, token);
  if (!ok) return { ok: false, status: 401, message: "unauthorized", code: "unauthorized" };
  return { ok: true };
}
export async function isServiceToken(request, env) {
  const token = env && env.INTEGRATION_TOKEN;
  if (!token || typeof token !== "string" || token.trim() === "") return false;
  const auth = request.headers.get("authorization") || "";
  const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
  if (!m) return false;
  return timingSafeEqual(m[1].trim(), token);
}
async function hasSlugColumn(env) {
  const cols = (await env.DB.prepare("PRAGMA table_info(clients)").all()).results || [];
  return cols.some((c) => c.name === "slug");
}
export async function integrationHealth(request, env) {
  return json(request, { ok: true, service: "time-tracker-integration", authenticated: true });
}
export async function listIntegrationClients(request, env) {
  if (!await hasSlugColumn(env)) {
    return err(request, "the service feed needs database migration 018 (POST /api/admin/apply-migration-018)", 409, "migration_required");
  }
  const clients = (await env.DB.prepare(
    `SELECT id, name, slug, billing_model, currency, hours_cap, week_start_day
       FROM clients WHERE archived = 0 ORDER BY name`
  ).all()).results || [];
  const now = /* @__PURE__ */ new Date();
  const today = now.toISOString().slice(0, 10);
  const monthStart = today.slice(0, 7) + "-01";
  const weekDaily = (await env.DB.prepare(
    `SELECT client_id, entry_date, COALESCE(SUM(hours), 0) AS total FROM time_entries
      WHERE is_billable = 1 AND approval_status = 'approved'
        AND entry_date >= date(?, '-6 days') AND entry_date <= ?
      GROUP BY client_id, entry_date`
  ).bind(today, today).all()).results || [];
  const pendingDaily = (await env.DB.prepare(
    `SELECT client_id, entry_date, COALESCE(SUM(hours), 0) AS total FROM time_entries
      WHERE is_billable = 1 AND approval_status IN ('open','submitted')
        AND entry_date >= date(?, '-6 days') AND entry_date <= ?
      GROUP BY client_id, entry_date`
  ).bind(today, today).all()).results || [];
  const monthTotals = new Map(((await env.DB.prepare(
    `SELECT client_id, COALESCE(SUM(hours), 0) AS total FROM time_entries
      WHERE is_billable = 1 AND approval_status = 'approved'
        AND entry_date >= ? AND entry_date <= ?
      GROUP BY client_id`
  ).bind(monthStart, today).all()).results || []).map((r) => [r.client_id, Number(r.total || 0)]));
  const allTotals = new Map(((await env.DB.prepare(
    `SELECT client_id, COALESCE(SUM(hours), 0) AS total FROM time_entries
      WHERE is_billable = 1 AND approval_status = 'approved'
      GROUP BY client_id`
  ).all()).results || []).map((r) => [r.client_id, Number(r.total || 0)]));
  const out = clients.map((c) => {
    const startDay = typeof c.week_start_day === "number" ? c.week_start_day : 1;
    const weekStart = weekStartForDay(today, startDay) || today;
    const weekEnd = addDays(weekStart, 6);
    let weekHours = 0;
    let pendingHours = 0;
    for (const row of weekDaily) {
      if (row.client_id !== c.id) continue;
      if (row.entry_date < weekStart || row.entry_date > weekEnd) continue;
      weekHours += Number(row.total || 0);
    }
    for (const row of pendingDaily) {
      if (row.client_id !== c.id) continue;
      if (row.entry_date < weekStart || row.entry_date > weekEnd) continue;
      pendingHours += Number(row.total || 0);
    }
    const cap = c.hours_cap == null ? null : Number(c.hours_cap);
    const month = Number((monthTotals.get(c.id) || 0).toFixed(2));
    const total = Number((allTotals.get(c.id) || 0).toFixed(2));
    const week = Number(weekHours.toFixed(2));
    return {
      ref: c.slug || null,
      id: c.id,
      name: c.name,
      billing_model: c.billing_model || "hourly",
      currency: c.currency || "USD",
      hours: {
        week,
        month,
        total,
        pending_week: Number(pendingHours.toFixed(2)),
        cap,
        week_remaining: cap == null ? null : Number((cap - week).toFixed(2)),
        week_used_pct: cap == null ? null : cap > 0 ? Number((week / cap * 100).toFixed(1)) : 0,
        over_cap: cap == null ? false : week > cap,
        basis: "week",
        week_start: weekStart
      }
    };
  });
  return json(request, { ok: true, generated_at: now.toISOString(), clients: out, count: out.length });
}
export async function listIntegrationAssignments(request, env) {
  const tables = (await env.DB.prepare(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'client_assignments'`
  ).all()).results || [];
  if (!tables.length) {
    return err(request, "client assignments need database migration 019 (POST /api/admin/apply-migration-019)", 409, "migration_required");
  }
  const roleMap = await loadAllStaffRoles(env);
  const staffRows = (await env.DB.prepare(
    `SELECT id, email, display_name, role
       FROM users WHERE role <> 'client' AND active = 1 ORDER BY email`
  ).all()).results || [];
  const assignmentRows = (await env.DB.prepare(
    `SELECT a.user_id, a.client_id, c.slug, c.name, c.archived
       FROM client_assignments a
       JOIN clients c ON c.id = a.client_id`
  ).all()).results || [];
  const byUser = /* @__PURE__ */ new Map();
  const byClient = /* @__PURE__ */ new Map();
  const dropped = /* @__PURE__ */ new Map();
  for (const r of assignmentRows) {
    const clientId = r.client_id;
    const email = (staffRows.find((s) => s.id === r.user_id) || {}).email;
    if (!r.slug) {
      if (!dropped.has(clientId)) dropped.set(clientId, { client_id: clientId, name: r.name, reason: "no slug", staff: [] });
      if (email) dropped.get(clientId).staff.push(email);
      continue;
    }
    if (r.archived === 1) {
      if (!dropped.has(clientId)) dropped.set(clientId, { client_id: clientId, name: r.name, reason: "archived client", staff: [] });
      if (email) dropped.get(clientId).staff.push(email);
      continue;
    }
    if (!byUser.has(r.user_id)) byUser.set(r.user_id, []);
    byUser.get(r.user_id).push(r.slug);
    if (!byClient.has(r.slug)) byClient.set(r.slug, []);
    if (email && !byClient.get(r.slug).includes(email)) byClient.get(r.slug).push(email);
  }
  const assignments = staffRows.map((s) => {
    const roles = roleMap.get(s.id) || [];
    const manager = s.role === "employee" && roles.includes("manager");
    return {
      email: s.email,
      name: s.display_name || s.email,
      role: s.role,
      manager,
      effective_role: manager ? "manager" : s.role,
      roles,
      clients: (byUser.get(s.id) || []).slice().sort()
    };
  });
  return json(request, {
    ok: true,
    generated_at: (/* @__PURE__ */ new Date()).toISOString(),
    assignments,
    by_client: Object.fromEntries([...byClient.entries()].map(([k, v]) => [k, v.slice().sort()])),
    unmapped_clients: [...dropped.values()]
  });
}
export async function getIntegrationClient(request, env, ref, url) {
  if (!await hasSlugColumn(env)) {
    return err(request, "the service feed needs database migration 018 (POST /api/admin/apply-migration-018)", 409, "migration_required");
  }
  const wanted = String(ref || "").trim();
  if (!wanted) return err(request, "client ref required", 422);
  const entryLimit = Math.min(Math.max(1, parseInt(url && url.searchParams.get("limit"), 10) || 100), 500);
  const invoiceLimit = Math.min(Math.max(1, parseInt(url && url.searchParams.get("invoices"), 10) || 20), 100);
  let row = null;
  if (isValidSlug(wanted)) {
    row = await env.DB.prepare("SELECT id FROM clients WHERE slug = ? AND archived = 0").bind(wanted).first();
  }
  if (!row && UUID_RE.test(wanted)) {
    row = await env.DB.prepare("SELECT id FROM clients WHERE id = ? AND archived = 0").bind(wanted).first();
  }
  if (!row) return err(request, "no client with that ref", 404);
  const snap = await clientBillingSnapshot(env, row.id, {
    approvedOnly: true,
    includePending: true,
    activityLimit: entryLimit,
    invoiceLimit
  });
  if (!snap) return err(request, "no client with that ref", 404);
  const cap = snap.cap;
  return json(request, {
    ok: true,
    generated_at: (/* @__PURE__ */ new Date()).toISOString(),
    client: {
      ref: wanted,
      id: snap.client.id,
      name: snap.client.name,
      billing_model: snap.client.billing_model,
      currency: snap.client.currency,
      hours: {
        week: snap.this_week_hours,
        month: snap.this_month_hours,
        total: snap.total_hours,
        pending_week: snap.pending_week_hours,
        cap: cap ? cap.hours_cap : null,
        week_remaining: cap ? cap.hours_remaining : null,
        week_used_pct: cap ? cap.hours_used_pct : null,
        over_cap: cap ? cap.over_cap : false,
        basis: "week",
        week_start: snap.week_start,
        month_start: snap.month_start
      },
      time_report: snap.recent_activity.map((e) => ({
        date: e.entry_date,
        task: e.project_task,
        hours: e.hours,
        description: e.description
      })),
      invoices: snap.invoices.map((inv) => ({
        id: inv.id,
        number: inv.invoice_number,
        status: inv.status,
        amount_cents: inv.total_cents,
        amount_due_cents: inv.total_cents - (inv.paid_amount_cents || 0),
        currency: inv.currency,
        date: inv.created_at,
        period_start: inv.period_start,
        period_end: inv.period_end,
        due_date: inv.due_date,
        paid_date: inv.paid_at,
        paid_amount_cents: inv.paid_amount_cents || 0,
        pay_url: null
      })),
      assigned_staff: []
    }
  });
}
function addDays(isoDate, days) {
  const d = /* @__PURE__ */ new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
