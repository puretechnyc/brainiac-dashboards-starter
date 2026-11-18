import { json, err, readJson, weekStart, weekStartForDay, etToday, isIsoDate, elapsedFraction } from "../util.js";
import { isAdmin, isManager, assignedClientIds } from "../auth.js";
import { invoiceAmountCents, retainerWeeklyRateCents, retainerWeekCents, fixedProjectPeriodCents, fixedProjectPeriodMilestones, fixedProjectTotalCents } from "../billing.js";
import { weeklyClientHours, loadMemberWeights } from "./budget.js";
import { loadBillingFacts, BILLING_GROUPS, hasWeeklyAmount } from "./billing-model.js";
import { loadMilestones, milestonesOf, fixedProjectMode } from "./fixed-project.js";
export const DEFAULT_WEEKLY_GOAL_CENTS = 3e5;
export const WEEKLY_GOAL_KEY = "weekly_revenue_goal_cents";
export const GOAL_MODE_KEY = "goal_mode";
export const GOAL_MODES = ["auto", "manual"];
const MAX_GOAL_CENTS = 1e8;
const addDays = (iso, n) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const isManual = (src) => src === "manual" || src === "import";
export async function tagEntrySource(env, entryId, source) {
  try {
    await env.DB.prepare("UPDATE time_entries SET source = ? WHERE id = ?").bind(source, entryId).run();
  } catch (e) {
    if (!/no such column/i.test(String(e && e.message || e))) throw e;
  }
}
export function resolveWeek(param, now = /* @__PURE__ */ new Date()) {
  if (param === null || param === void 0 || param === "") return weekStart(etToday(now));
  return isIsoDate(param) ? weekStart(param) : null;
}
async function readGoal(env) {
  try {
    const row = await env.DB.prepare("SELECT value FROM app_settings WHERE key = ?").bind(WEEKLY_GOAL_KEY).first();
    const n = row ? Number(row.value) : NaN;
    if (Number.isInteger(n) && n >= 0) return { goal_cents: n, source: "setting" };
  } catch (e) {
    if (!/no such table/i.test(String(e && e.message || e))) throw e;
  }
  return { goal_cents: DEFAULT_WEEKLY_GOAL_CENTS, source: "default" };
}
export async function readGoalMode(env) {
  try {
    const row = await env.DB.prepare("SELECT value FROM app_settings WHERE key = ?").bind(GOAL_MODE_KEY).first();
    const v = row ? String(row.value) : "";
    if (GOAL_MODES.includes(v)) return v;
  } catch (e) {
    if (!/no such table/i.test(String(e && e.message || e))) throw e;
  }
  return "auto";
}
async function weekEntries(env, monday) {
  const sql = (sel) => `SELECT client_id, user_id, entry_date, hours, rate_cents, is_billable, ${sel} AS source
      FROM time_entries WHERE is_billable = 1 AND entry_date >= ? AND entry_date <= date(?, '+6 days')`;
  try {
    return (await env.DB.prepare(sql("source")).bind(monday, monday).all()).results || [];
  } catch (e) {
    if (!/no such column/i.test(String(e && e.message || e))) throw e;
    return (await env.DB.prepare(sql("NULL")).bind(monday, monday).all()).results || [];
  }
}
export async function computeWeek(env, monday, today = etToday()) {
  const dates = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const weekElapsed = elapsedFraction(monday, addDays(monday, 6), today);
  const entries = await weekEntries(env, monday);
  const allClients = (await env.DB.prepare("SELECT * FROM clients ORDER BY name").all()).results || [];
  const weights = (await env.DB.prepare("SELECT * FROM member_client_weights").all()).results || [];
  const memberWeights = await loadMemberWeights(env);
  const byClient = /* @__PURE__ */ new Map();
  for (const e of entries) {
    if (!byClient.has(e.client_id)) byClient.set(e.client_id, []);
    byClient.get(e.client_id).push(e);
  }
  const listed = allClients.filter((c) => !c.archived || byClient.has(c.id));
  const hoursBasis = await weeklyClientHours(env, monday, listed);
  const facts = await loadBillingFacts(env, listed);
  const milestonesByClient = await loadMilestones(env);
  const rows = listed.map((c) => {
    const es = byClient.get(c.id) || [];
    const f = facts.get(c.id);
    const model = f.billing_model;
    const hoursByDay = /* @__PURE__ */ new Map();
    const manualByDay = /* @__PURE__ */ new Map();
    const unclassByDay = /* @__PURE__ */ new Map();
    for (const e of es) {
      const h = Number(e.hours);
      hoursByDay.set(e.entry_date, (hoursByDay.get(e.entry_date) || 0) + h);
      if (isManual(e.source)) manualByDay.set(e.entry_date, (manualByDay.get(e.entry_date) || 0) + h);
      else if (e.source === null || e.source === void 0) unclassByDay.set(e.entry_date, (unclassByDay.get(e.entry_date) || 0) + h);
    }
    const mins = (m, d) => Math.round((m.get(d) || 0) * 60);
    const days = dates.map((d) => ({
      date: d,
      minutes: mins(hoursByDay, d),
      manual_minutes: mins(manualByDay, d),
      unclassified_minutes: mins(unclassByDay, d)
    }));
    const sum = (k) => days.reduce((s, d) => s + d[k], 0);
    const totalMinutes = sum("minutes");
    let amount = null;
    let billedHours = 0;
    if (hasWeeklyAmount(model)) {
      const r = invoiceAmountCents(c, [es], weights, void 0, memberWeights);
      amount = r.amount_cents;
      billedHours = model === "hourly" ? r.billed_hours : totalMinutes / 60;
    }
    const monthlyCents = model === "monthly_retainer" ? c.monthly_retainer_cents === null || c.monthly_retainer_cents === void 0 ? null : Number(c.monthly_retainer_cents) : null;
    const contractLive = !f.paused && !c.archived;
    const retainerWeekly = model === "monthly_retainer" ? retainerWeeklyRateCents(monthlyCents) : null;
    if (model === "monthly_retainer" && contractLive && retainerWeekly !== null) {
      amount = retainerWeekCents(monthlyCents, weekElapsed);
    }
    let fixedMilestones = null;
    let milestoneTotalCents = null;
    let milestoneCount = 0;
    let fixedMode = null;
    if (model === "fixed_project") {
      const ms = milestonesOf(milestonesByClient, c.id);
      milestoneCount = ms.length;
      fixedMode = fixedProjectMode(ms);
      if (fixedMode === "milestones") {
        milestoneTotalCents = fixedProjectTotalCents(ms);
        fixedMilestones = fixedProjectPeriodMilestones(ms, monday, dates[6]);
        amount = fixedProjectPeriodCents(ms, monday, dates[6]);
      }
    }
    const basis = hoursBasis.get(c.id) || { raw: 0, weighted: null, effective: 0 };
    const hourlyBasis = model === "hourly";
    const target = c.hours_cap === null || c.hours_cap === void 0 ? null : Number(c.hours_cap);
    const eff = Number((hourlyBasis ? basis.effective : basis.raw).toFixed(2));
    let targetStatus = "no_target";
    if (target !== null && target > 0) {
      targetStatus = eff > target + 1e-9 ? "over" : eff >= target - 1e-9 ? "met" : "under";
    }
    const chaseable = !f.paused && !c.archived;
    const missedHours = chaseable && hourlyBasis && target !== null && target > 0 ? Math.max(0, target - billedHours) : 0;
    const missedCents = hourlyBasis ? Math.round(missedHours * Number(c.rate_cents || 0)) : 0;
    return {
      client_id: c.id,
      client_name: c.name,
      color: c.color || null,
      archived: Boolean(c.archived),
      billing_model: model,
      rate_cents: model === "milestone_weekly" ? Number(c.weekly_rate_cents || 0) : model === "hourly" ? Number(c.rate_cents || 0) : model === "monthly_retainer" ? retainerWeekly : null,
      rate_unit: model === "milestone_weekly" ? "week" : model === "hourly" ? "hour" : model === "monthly_retainer" ? retainerWeekly !== null ? "week" : "retainer" : model === "fixed_project" ? "project" : "profit",
      fixed_amount_cents: model === "fixed_project" ? milestoneTotalCents !== null ? milestoneTotalCents : f.fixed_amount_cents : f.fixed_amount_cents,
      fixed_mode: fixedMode,
      milestones: fixedMilestones,
      milestone_total_cents: milestoneTotalCents,
      milestone_count: milestoneCount,
      profit_pct: f.profit_pct,
      paused: f.paused,
      monthly_amount_cents: monthlyCents,
      days,
      total_minutes: totalMinutes,
      manual_minutes: sum("manual_minutes"),
      unclassified_minutes: sum("unclassified_minutes"),
      billed_hours: Number(billedHours.toFixed(2)),
      amount_cents: amount,
      missed_hours: Number(missedHours.toFixed(2)),
      missed_cents: missedCents,
      effective_rate_cents: model === "monthly_retainer" ? null : amount !== null && totalMinutes > 0 ? Math.round(amount / (totalMinutes / 60)) : null,
      target_hours: target,
      effective_hours: eff,
      uses_weights: hourlyBasis && basis.weighted !== null && basis.weighted !== void 0,
      target_pct: target ? Number((eff / target * 100).toFixed(1)) : null,
      target_status: targetStatus
    };
  });
  const { total, groups } = summarizeRows(rows, dates);
  return {
    week_start: monday,
    week_end: addDays(monday, 6),
    is_current: monday === weekStart(today),
    today,
    days: dates.map((d) => ({ date: d, is_today: d === today, is_future: d > today })),
    clients: rows,
    groups,
    totals: total
  };
}
export function summarizeRows(rows, dates) {
  const priced = rows.filter((r) => r.amount_cents !== null);
  const billedByRate = priced.filter((r) => r.billing_model !== "monthly_retainer");
  const total = {
    minutes: rows.reduce((s, r) => s + r.total_minutes, 0),
    manual_minutes: rows.reduce((s, r) => s + r.manual_minutes, 0),
    unclassified_minutes: rows.reduce((s, r) => s + r.unclassified_minutes, 0),
    amount_cents: priced.reduce((s, r) => s + r.amount_cents, 0),
    missed_cents: rows.reduce((s, r) => s + (r.missed_cents || 0), 0),
    retainer_minutes_excluded: rows.filter((r) => r.amount_cents === null && r.billing_model === "monthly_retainer").reduce((s, r) => s + r.total_minutes, 0),
    no_weekly_amount_minutes: rows.filter((r) => r.amount_cents === null).reduce((s, r) => s + r.total_minutes, 0),
    day_minutes: dates.map((_, i) => rows.reduce((s, r) => s + r.days[i].minutes, 0))
  };
  const pricedMin = billedByRate.reduce((s, r) => s + r.total_minutes, 0);
  const pricedCents = billedByRate.reduce((s, r) => s + r.amount_cents, 0);
  total.effective_rate_cents = pricedMin > 0 ? Math.round(pricedCents / (pricedMin / 60)) : null;
  const groups = BILLING_GROUPS.map((g) => {
    const rs = rows.filter((r) => r.billing_model === g.key);
    return {
      key: g.key,
      label: g.label,
      client_count: rs.length,
      subtotal_minutes: rs.reduce((s, r) => s + r.total_minutes, 0),
      subtotal_amount_cents: rs.reduce((s, r) => s + (r.amount_cents || 0), 0),
      subtotal_missed_cents: rs.reduce((s, r) => s + (r.missed_cents || 0), 0)
    };
  });
  return { total, groups };
}
export async function computeTiles(env) {
  const clientList = (await env.DB.prepare("SELECT * FROM clients").all()).results || [];
  const clients = new Map(clientList.map((c) => [c.id, c]));
  const facts = await loadBillingFacts(env, clientList);
  const weights = (await env.DB.prepare("SELECT * FROM member_client_weights").all()).results || [];
  const memberWeights = await loadMemberWeights(env);
  const rows = (await env.DB.prepare(
    `SELECT client_id, user_id, entry_date, hours, rate_cents, is_billable, approval_status
       FROM time_entries WHERE is_billable = 1 AND invoice_id IS NULL`
  ).all()).results || [];
  const bucketAmount = (statuses) => {
    const per = /* @__PURE__ */ new Map();
    for (const r of rows) {
      if (!statuses.includes(r.approval_status)) continue;
      const c = clients.get(r.client_id);
      if (!c) continue;
      const model = (facts.get(r.client_id) || {}).billing_model || "hourly";
      if (!hasWeeklyAmount(model)) continue;
      const wk = weekStartForDay(r.entry_date, typeof c.week_start_day === "number" ? c.week_start_day : 1);
      if (!per.has(c.id)) per.set(c.id, /* @__PURE__ */ new Map());
      const w = per.get(c.id);
      if (!w.has(wk)) w.set(wk, []);
      w.get(wk).push(r);
    }
    let cents = 0;
    for (const [cid, w] of per) cents += invoiceAmountCents(clients.get(cid), [...w.values()], weights.filter((x) => x.client_id === cid), void 0, memberWeights).amount_cents;
    return cents;
  };
  const inProgress = bucketAmount(["open", "rejected"]);
  const inReview = bucketAmount(["submitted"]);
  const approvedUninvoiced = bucketAmount(["approved"]);
  const outstanding = (await env.DB.prepare(
    `SELECT COALESCE(SUM(total_cents - paid_amount_cents), 0) AS n FROM invoices
      WHERE status IN ('draft','sent','partially_paid')`
  ).first())?.n || 0;
  const last = await env.DB.prepare(
    `SELECT p.amount_cents, p.paid_at, c.name AS client_name, i.invoice_number
       FROM invoice_payments p JOIN invoices i ON i.id = p.invoice_id JOIN clients c ON c.id = i.client_id
      ORDER BY p.paid_at DESC, p.created_at DESC LIMIT 1`
  ).first();
  return {
    in_progress: {
      cents: inProgress,
      label: "Work in progress",
      note: "Billable time not yet submitted (open or rejected entries, not on an invoice)."
    },
    in_review: {
      cents: inReview,
      label: "In review",
      note: "Billable time submitted and awaiting admin approval."
    },
    pending: {
      cents: approvedUninvoiced + Number(outstanding),
      label: "Pending",
      approved_uninvoiced_cents: approvedUninvoiced,
      invoices_outstanding_cents: Number(outstanding),
      note: "Approved time not yet invoiced, plus the unpaid balance of draft, sent and partially paid invoices."
    },
    available: {
      cents: null,
      label: "Available",
      note: "n/a: this app has no payout or withdrawal step. Payments are recorded against invoices as they are received."
    },
    last_payment: last ? { cents: last.amount_cents, paid_at: last.paid_at, client_name: last.client_name, invoice_number: last.invoice_number } : null
  };
}
export function computeAutoGoal(rows) {
  const breakdown = { hourly_cents: 0, milestone_cents: 0, retainer_cents: 0, fixed_cents: 0 };
  const excluded = { paused: 0, archived: 0, fixed_project: 0, profit_share: 0, no_cap: 0, other: 0 };
  for (const r of rows) {
    if (r.archived) {
      excluded.archived += 1;
      continue;
    }
    if (r.paused) {
      excluded.paused += 1;
      continue;
    }
    if (r.billing_model === "fixed_project") {
      if (r.amount_cents !== null && r.amount_cents !== void 0) {
        breakdown.fixed_cents += Number(r.amount_cents || 0);
        continue;
      }
      excluded.fixed_project += 1;
      continue;
    }
    if (r.billing_model === "profit_share") {
      excluded.profit_share += 1;
      continue;
    }
    if (r.billing_model === "hourly") {
      if (r.target_hours === null || r.target_hours === void 0) {
        excluded.no_cap += 1;
        continue;
      }
      breakdown.hourly_cents += Math.round(Number(r.target_hours) * Number(r.rate_cents || 0));
      continue;
    }
    if (r.billing_model === "milestone_weekly") {
      breakdown.milestone_cents += Number(r.rate_cents || 0);
      continue;
    }
    if (r.billing_model === "monthly_retainer") {
      breakdown.retainer_cents += retainerWeeklyRateCents(r.monthly_amount_cents) || 0;
      continue;
    }
    excluded.other += 1;
  }
  return {
    total_cents: breakdown.hourly_cents + breakdown.milestone_cents + breakdown.retainer_cents + breakdown.fixed_cents,
    breakdown,
    excluded
  };
}
export async function weeklyOverview(request, env, p, url) {
  if (!isAdmin(p)) return err(request, "admin only", 403);
  const monday = resolveWeek(url.searchParams.get("week"));
  if (!monday) return err(request, "week must be a date, YYYY-MM-DD", 400);
  const today = etToday();
  const cur = await computeWeek(env, monday, today);
  const prev = await computeWeek(env, addDays(monday, -7), today);
  const goalMode = await readGoalMode(env);
  const manualGoal = await readGoal(env);
  const autoGoal = computeAutoGoal(cur.clients);
  const goal = goalMode === "manual" ? { goal_cents: manualGoal.goal_cents, source: manualGoal.source } : { goal_cents: autoGoal.total_cents, source: "auto" };
  const delta = (a, b) => ({ delta: a - b, pct: b > 0 ? Number(((a - b) / b * 100).toFixed(1)) : null });
  const pausedRows = cur.clients.filter((c) => c.paused);
  const goalBaseCents = cur.clients.reduce((s, c) => c.paused ? s : s + (c.amount_cents || 0), 0);
  const missedCents = cur.totals.missed_cents;
  const missedExcludedClients = cur.clients.filter((c) => c.paused || c.archived).length;
  return json(request, {
    ok: true,
    ...cur,
    prev_week_start: prev.week_start,
    next_week_start: addDays(monday, 7),
    tiles: await computeTiles(env),
    kpis: {
      goal: {
        goal_cents: goal.goal_cents,
        source: goal.source,
        goal_mode: goalMode,
        manual_goal_cents: manualGoal.goal_cents,
        auto_goal_cents: autoGoal.total_cents,
        auto_goal_breakdown: autoGoal.breakdown,
        auto_goal_excluded: autoGoal.excluded,
        goal_base_cents: goalBaseCents,
        paused_clients: pausedRows.length,
        paused_cents_excluded: cur.totals.amount_cents - goalBaseCents,
        missed_cents: missedCents,
        missed_clients_excluded: missedExcludedClients,
        missed_label: cur.is_current ? "so far" : null,
        pct: goal.goal_cents > 0 ? Number((goalBaseCents / goal.goal_cents * 100).toFixed(1)) : null,
        remaining_cents: Math.max(0, goal.goal_cents - goalBaseCents)
      },
      effective_rate_cents: cur.totals.effective_rate_cents,
      week_over_week: {
        prev_week_start: prev.week_start,
        prev_amount_cents: prev.totals.amount_cents,
        prev_minutes: prev.totals.minutes,
        amount: delta(cur.totals.amount_cents, prev.totals.amount_cents),
        minutes: delta(cur.totals.minutes, prev.totals.minutes)
      },
      clients_under_target: cur.clients.filter((c) => c.target_status === "under").length
    }
  });
}
export async function setWeeklyGoal(request, env, p) {
  if (!isAdmin(p)) return err(request, "admin only", 403);
  const b = await readJson(request);
  const hasCents = b.goal_cents !== void 0 && b.goal_cents !== null;
  const hasMode = b.goal_mode !== void 0 && b.goal_mode !== null;
  if (!hasCents && !hasMode) {
    return err(request, "send goal_cents, goal_mode, or both", 422);
  }
  let n = null;
  if (hasCents) {
    n = b.goal_cents;
    if (!Number.isInteger(n) || n < 0 || n > MAX_GOAL_CENTS) {
      return err(request, "goal_cents must be a whole number of cents, 0 or more", 422);
    }
  }
  let mode = null;
  if (hasMode) {
    mode = String(b.goal_mode);
    if (!GOAL_MODES.includes(mode)) return err(request, "goal_mode must be 'auto' or 'manual'", 422);
  } else if (hasCents) {
    mode = "manual";
  }
  try {
    if (n !== null) {
      await env.DB.prepare(
        `INSERT INTO app_settings (key, value, updated_by, updated_at) VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`
      ).bind(WEEKLY_GOAL_KEY, String(n), p.userId).run();
    }
    if (mode !== null) {
      await env.DB.prepare(
        `INSERT INTO app_settings (key, value, updated_by, updated_at) VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`
      ).bind(GOAL_MODE_KEY, mode, p.userId).run();
    }
  } catch (e) {
    if (/no such table/i.test(String(e && e.message || e))) return err(request, "migration 020 is not applied yet (POST /api/admin/apply-migration-020)", 409, "migration_needed");
    throw e;
  }
  return json(request, {
    ok: true,
    goal_cents: n !== null ? n : (await readGoal(env)).goal_cents,
    goal_mode: mode !== null ? mode : await readGoalMode(env)
  });
}
const TEAM_ROW_FIELDS = [
  "client_id",
  "client_name",
  "color",
  "archived",
  "billing_model",
  "rate_unit",
  "paused",
  "days",
  "total_minutes",
  "manual_minutes",
  "unclassified_minutes",
  "billed_hours",
  "target_hours",
  "effective_hours",
  "uses_weights",
  "target_pct",
  "target_status"
];
function teamRow(row) {
  const out = {};
  for (const k of TEAM_ROW_FIELDS) out[k] = row[k];
  return out;
}
export async function teamWeekly(request, env, p, url) {
  if (!isAdmin(p) && !isManager(p)) return err(request, "admin or manager only", 403);
  const monday = resolveWeek(url.searchParams.get("week"));
  if (!monday) return err(request, "week must be a date, YYYY-MM-DD", 400);
  const today = etToday();
  const week = await computeWeek(env, monday, today);
  const dates = week.days.map((d) => d.date);
  let rows = week.clients;
  if (isManager(p)) {
    const assigned = await assignedClientIds(env, p.userId);
    const set = new Set(assigned);
    rows = week.clients.filter((c) => set.has(c.client_id));
  }
  const { total, groups } = summarizeRows(rows, dates);
  return json(request, {
    ok: true,
    week_start: week.week_start,
    week_end: week.week_end,
    is_current: week.is_current,
    today: week.today,
    days: week.days,
    totals: {
      minutes: total.minutes,
      manual_minutes: total.manual_minutes,
      unclassified_minutes: total.unclassified_minutes,
      day_minutes: total.day_minutes
    },
    groups: groups.map((g) => ({
      key: g.key,
      label: g.label,
      client_count: g.client_count,
      subtotal_minutes: g.subtotal_minutes
    })),
    clients: rows.map(teamRow),
    scoped: isManager(p)
  });
}
