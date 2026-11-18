import { json, err, uuid, weekStart, readJson } from "../util.js";
import { isAdmin, isClient } from "../auth.js";
import { notifyAllAdmins } from "./notifications.js";
import { allotmentConsumedHours } from "../billing.js";
export async function loadMemberWeights(env) {
  const map = /* @__PURE__ */ new Map();
  try {
    const rows = (await env.DB.prepare("SELECT user_id, weight FROM member_weights").all()).results || [];
    for (const r of rows) {
      const n = Number(r.weight);
      if (Number.isFinite(n) && n > 0) map.set(r.user_id, n);
    }
  } catch (e) {
    if (!/no such table/i.test(String(e && e.message || e))) throw e;
  }
  return map;
}
export function currentWeekBoundaries() {
  const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const ws = weekStart(today);
  return { today, weekStartDate: ws };
}
export function workDaysElapsed(today, weekStartDate) {
  const todayDate = /* @__PURE__ */ new Date(`${today}T12:00:00Z`);
  const wsDate = /* @__PURE__ */ new Date(`${weekStartDate}T12:00:00Z`);
  const diffDays = Math.floor((todayDate - wsDate) / (1e3 * 60 * 60 * 24));
  return Math.min(diffDays + 1, 5);
}
function dayOfWeek(dateStr) {
  return (/* @__PURE__ */ new Date(`${dateStr}T12:00:00Z`)).getUTCDay();
}
export async function weeklyClientHours(env, weekStartDate, clients) {
  const out = /* @__PURE__ */ new Map();
  if (!clients || clients.length === 0) return out;
  const rows = (await env.DB.prepare(
    `SELECT client_id, user_id, hours, is_billable
       FROM time_entries
      WHERE is_billable = 1
        AND entry_date >= ? AND entry_date <= date(?, '+6 days')`
  ).bind(weekStartDate, weekStartDate).all()).results || [];
  const weights = (await env.DB.prepare("SELECT * FROM member_client_weights").all()).results || [];
  const memberWeights2 = await loadMemberWeights(env);
  const byClient = /* @__PURE__ */ new Map();
  for (const r of rows) {
    if (!byClient.has(r.client_id)) byClient.set(r.client_id, []);
    byClient.get(r.client_id).push(r);
  }
  for (const c of clients) {
    const entries = byClient.get(c.id) || [];
    const raw = entries.reduce((sum, e) => sum + Number(e.hours), 0);
    const cw = weights.filter((w) => w.client_id === c.id);
    const isHourly = c.billing_model === "hourly" || !c.billing_model;
    const anyMemberWeighted = isHourly && memberWeights2.size > 0 && entries.some((e) => memberWeights2.has(e.user_id));
    const useWeights = isHourly && (cw.length > 0 || anyMemberWeighted);
    const weighted = useWeights ? allotmentConsumedHours(entries, cw, c.id, memberWeights2) : null;
    out.set(c.id, { raw, weighted, effective: weighted !== null ? weighted : raw });
  }
  return out;
}
export const BEHIND_PACE_FACTOR = 0.8;
export function progressStatus(effective, cap, elapsedDays) {
  const expected = cap / 5 * elapsedDays;
  let status = "on_track";
  if (effective >= cap) status = "met";
  else if (effective + 1e-9 < expected * BEHIND_PACE_FACTOR) status = "behind";
  return { expected, status };
}
export async function clientWeekProgress(env, { today, weekStartDate } = currentWeekBoundaries()) {
  const elapsed = workDaysElapsed(today, weekStartDate);
  const clients = (await env.DB.prepare(
    `SELECT id, name, hours_cap, billing_model, currency
       FROM clients WHERE archived = 0 AND hours_cap IS NOT NULL AND hours_cap > 0
       ORDER BY name`
  ).all()).results || [];
  const colors = /* @__PURE__ */ new Map();
  try {
    for (const r of (await env.DB.prepare("SELECT id, color FROM clients").all()).results || []) colors.set(r.id, r.color);
  } catch {
  }
  const hours = await weeklyClientHours(env, weekStartDate, clients);
  const rows = clients.map((c) => {
    const h = hours.get(c.id);
    const { expected, status } = progressStatus(h.effective, c.hours_cap, elapsed);
    return {
      client_id: c.id,
      client_name: c.name,
      color: colors.get(c.id) || null,
      currency: c.currency,
      hours_cap: c.hours_cap,
      effective_hours: Number(h.effective.toFixed(2)),
      raw_hours: Number(h.raw.toFixed(2)),
      weighted_hours: h.weighted === null ? null : Number(h.weighted.toFixed(2)),
      uses_weights: h.weighted !== null,
      expected_pace: Number(expected.toFixed(2)),
      pct_of_cap: Number((h.effective / c.hours_cap * 100).toFixed(1)),
      pct_of_pace: expected > 0 ? Number((h.effective / expected * 100).toFixed(1)) : 0,
      shortfall: Number(Math.max(0, expected - h.effective).toFixed(2)),
      status
    };
  });
  return { today, weekStartDate, elapsed, clients: rows };
}
export async function progressTab(request, env, p) {
  if (!isAdmin(p)) return err(request, "admin only", 403);
  const prog = await clientWeekProgress(env);
  const flagged = await checkUnderTargetAlerts(env, prog);
  const order = { behind: 0, on_track: 1, met: 2 };
  prog.clients.sort((a, b) => order[a.status] - order[b.status] || b.shortfall - a.shortfall || a.client_name.localeCompare(b.client_name));
  return json(request, {
    ok: true,
    week_start: prog.weekStartDate,
    today: prog.today,
    work_days_elapsed: prog.elapsed,
    behind_count: prog.clients.filter((c) => c.status === "behind").length,
    newly_flagged: flagged,
    clients: prog.clients
  });
}
export async function weeklyBudgetAll(request, env, p) {
  if (!isAdmin(p)) return err(request, "admin only", 403);
  const { today, weekStartDate } = currentWeekBoundaries();
  const elapsed = workDaysElapsed(today, weekStartDate);
  const clients = (await env.DB.prepare(
    `SELECT id, name, hours_cap, billing_model, currency
       FROM clients WHERE archived = 0 AND hours_cap IS NOT NULL
       ORDER BY name`
  ).all()).results || [];
  if (clients.length === 0) {
    return json(request, { ok: true, week_start: weekStartDate, clients: [] });
  }
  const hoursByClient = await weeklyClientHours(env, weekStartDate, clients);
  const result = clients.map((c) => {
    const hb = hoursByClient.get(c.id);
    const rawHours = Number(hb.raw.toFixed(2));
    const weightedHours = hb.weighted === null ? null : Number(hb.weighted.toFixed(2));
    const effectiveHours = weightedHours !== null ? weightedHours : rawHours;
    const cap = c.hours_cap;
    const remaining = Number((cap - effectiveHours).toFixed(2));
    const pctUsed = Number((effectiveHours / cap * 100).toFixed(1));
    const expectedPace = cap / 5 * elapsed;
    const behindPace = effectiveHours < expectedPace * 0.8;
    return {
      client_id: c.id,
      client_name: c.name,
      currency: c.currency,
      hours_cap: cap,
      raw_hours: rawHours,
      weighted_hours: weightedHours,
      effective_hours: effectiveHours,
      remaining,
      pct_used: pctUsed,
      over_budget: effectiveHours > cap,
      behind_pace: behindPace,
      expected_pace: Number(expectedPace.toFixed(2)),
      projected_hours: elapsed > 0 ? Number((effectiveHours / elapsed * 5).toFixed(2)) : 0
    };
  });
  result.sort((a, b) => b.pct_used - a.pct_used);
  return json(request, {
    ok: true,
    week_start: weekStartDate,
    today,
    work_days_elapsed: elapsed,
    clients: result
  });
}
export async function weeklyBudgetDetail(request, env, p, clientId) {
  if (!isAdmin(p)) return err(request, "admin only", 403);
  const { today, weekStartDate } = currentWeekBoundaries();
  const elapsed = workDaysElapsed(today, weekStartDate);
  const client = await env.DB.prepare(
    "SELECT * FROM clients WHERE id = ? AND archived = 0"
  ).bind(clientId).first();
  if (!client) return err(request, "client not found", 404);
  const dayRows = (await env.DB.prepare(
    `SELECT entry_date, COALESCE(SUM(hours), 0) AS total_hours
       FROM time_entries
      WHERE client_id = ? AND is_billable = 1
        AND entry_date >= ? AND entry_date <= date(?, '+6 days')
      GROUP BY entry_date ORDER BY entry_date`
  ).bind(clientId, weekStartDate, weekStartDate).all()).results || [];
  const empRows = (await env.DB.prepare(
    `SELECT t.user_id, u.display_name, u.email,
            COALESCE(SUM(t.hours), 0) AS total_hours
       FROM time_entries t
       JOIN users u ON u.id = t.user_id
      WHERE t.client_id = ? AND t.is_billable = 1
        AND t.entry_date >= ? AND t.entry_date <= date(?, '+6 days')
      GROUP BY t.user_id ORDER BY total_hours DESC`
  ).bind(clientId, weekStartDate, weekStartDate).all()).results || [];
  const rawTotal = dayRows.reduce((s, r) => s + r.total_hours, 0);
  const weights = (await env.DB.prepare(
    "SELECT * FROM member_client_weights WHERE client_id = ?"
  ).bind(clientId).all()).results || [];
  let weightedTotal = null;
  if (weights.length > 0) {
    const entries = (await env.DB.prepare(
      `SELECT user_id, hours, is_billable FROM time_entries
        WHERE client_id = ? AND is_billable = 1
          AND entry_date >= ? AND entry_date <= date(?, '+6 days')`
    ).bind(clientId, weekStartDate, weekStartDate).all()).results || [];
    weightedTotal = Number(allotmentConsumedHours(entries, weights, clientId).toFixed(2));
  }
  const effectiveHours = weightedTotal !== null ? weightedTotal : Number(rawTotal.toFixed(2));
  const cap = client.hours_cap;
  const projected = elapsed > 0 ? Number((effectiveHours / elapsed * 5).toFixed(2)) : 0;
  return json(request, {
    ok: true,
    client: {
      id: client.id,
      name: client.name,
      hours_cap: cap,
      billing_model: client.billing_model || "hourly",
      currency: client.currency
    },
    week_start: weekStartDate,
    today,
    work_days_elapsed: elapsed,
    raw_hours: Number(rawTotal.toFixed(2)),
    weighted_hours: weightedTotal,
    effective_hours: effectiveHours,
    remaining: cap != null ? Number((cap - effectiveHours).toFixed(2)) : null,
    pct_used: cap ? Number((effectiveHours / cap * 100).toFixed(1)) : null,
    over_budget: cap ? effectiveHours > cap : false,
    projected_hours: projected,
    daily: dayRows.map((d) => ({
      date: d.entry_date,
      hours: Number(d.total_hours.toFixed(2))
    })),
    employees: empRows.map((e) => ({
      user_id: e.user_id,
      display_name: e.display_name || "",
      email: e.email,
      hours: Number(e.total_hours.toFixed(2))
    })),
    weights: weights.map((w) => ({
      user_id: w.user_id,
      logged_hours_per_allotment_hour: w.logged_hours_per_allotment_hour
    }))
  });
}
export async function underTarget(request, env, p) {
  if (!isAdmin(p)) return err(request, "admin only", 403);
  const prog = await clientWeekProgress(env);
  const result = prog.clients.filter((c) => c.status === "behind").map((c) => ({
    client_id: c.client_id,
    client_name: c.client_name,
    currency: c.currency,
    hours_cap: c.hours_cap,
    actual_hours: c.effective_hours,
    raw_hours: c.raw_hours,
    weighted_hours: c.weighted_hours,
    expected_pace: c.expected_pace,
    shortfall: c.shortfall,
    pct_of_pace: c.pct_of_pace
  }));
  result.sort((a, b) => b.shortfall - a.shortfall);
  return json(request, {
    ok: true,
    week_start: prog.weekStartDate,
    today: prog.today,
    work_days_elapsed: prog.elapsed,
    clients: result
  });
}
export async function clientWeights(request, env, p, clientId) {
  if (!isAdmin(p)) return err(request, "admin only", 403);
  const client = await env.DB.prepare(
    "SELECT id, name FROM clients WHERE id = ?"
  ).bind(clientId).first();
  if (!client) return err(request, "client not found", 404);
  const weights = (await env.DB.prepare(
    `SELECT w.user_id, w.logged_hours_per_allotment_hour, w.created_at, w.updated_at,
            u.display_name, u.email
       FROM member_client_weights w
       JOIN users u ON u.id = w.user_id
      WHERE w.client_id = ?
      ORDER BY u.display_name, u.email`
  ).bind(clientId).all()).results || [];
  return json(request, {
    ok: true,
    client_id: clientId,
    client_name: client.name,
    weights: weights.map((w) => ({
      user_id: w.user_id,
      display_name: w.display_name || "",
      email: w.email,
      logged_hours_per_allotment_hour: w.logged_hours_per_allotment_hour,
      weight_display: `${w.logged_hours_per_allotment_hour}:1`
    }))
  });
}
export async function setClientWeights(request, env, p, clientId) {
  if (!isAdmin(p)) return err(request, "admin only", 403);
  const client = await env.DB.prepare("SELECT id FROM clients WHERE id = ?").bind(clientId).first();
  if (!client) return err(request, "client not found", 404);
  const b = await readJson(request);
  const weights = b.weights === void 0 ? [] : b.weights;
  const remove = b.remove === void 0 ? [] : b.remove;
  if (!Array.isArray(weights) || !Array.isArray(remove)) return err(request, "weights and remove must be arrays", 422);
  for (const w of weights) {
    const n = Number(w && w.logged_hours_per_allotment_hour);
    if (!w || !w.user_id || !Number.isFinite(n) || n <= 0) {
      return err(request, "each weight needs a user_id and a number greater than 0", 422, "bad_weight");
    }
    const user = await env.DB.prepare("SELECT id FROM users WHERE id = ?").bind(w.user_id).first();
    if (!user) return err(request, `unknown team member ${w.user_id}`, 422, "bad_user");
  }
  for (const userId of remove) {
    await env.DB.prepare("DELETE FROM member_client_weights WHERE client_id = ? AND user_id = ?").bind(clientId, userId).run();
  }
  for (const w of weights) {
    await env.DB.prepare(
      `INSERT INTO member_client_weights (user_id, client_id, logged_hours_per_allotment_hour, updated_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(user_id, client_id) DO UPDATE SET
         logged_hours_per_allotment_hour = excluded.logged_hours_per_allotment_hour,
         updated_at = datetime('now')`
    ).bind(w.user_id, clientId, Number(w.logged_hours_per_allotment_hour)).run();
  }
  return await clientWeights(request, env, p, clientId);
}
export async function memberWeights(request, env, p) {
  if (!isAdmin(p)) return err(request, "admin only", 403);
  let rows = [];
  try {
    rows = (await env.DB.prepare(
      `SELECT u.id AS user_id, u.display_name, u.email, u.role, mw.weight, mw.updated_at
         FROM users u
         LEFT JOIN member_weights mw ON mw.user_id = u.id
        WHERE u.role IN ('admin','employee') AND u.active = 1
        ORDER BY u.display_name, u.email`
    ).all()).results || [];
  } catch (e) {
    if (/no such table/i.test(String(e && e.message || e))) {
      return err(request, "migration 022 is not applied yet (POST /api/admin/apply-migration-022)", 409, "migration_needed");
    }
    throw e;
  }
  return json(request, {
    ok: true,
    members: rows.map((r) => ({
      user_id: r.user_id,
      display_name: r.display_name || "",
      email: r.email,
      role: r.role,
      weight: r.weight === null || r.weight === void 0 ? null : Number(r.weight),
      weight_display: r.weight === null || r.weight === void 0 ? "1:1 (default)" : `${Number(r.weight)}:1`
    }))
  });
}
export async function setMemberWeights(request, env, p) {
  if (!isAdmin(p)) return err(request, "admin only", 403);
  const b = await readJson(request);
  const weights = b.weights === void 0 ? [] : b.weights;
  const remove = b.remove === void 0 ? [] : b.remove;
  if (!Array.isArray(weights) || !Array.isArray(remove)) return err(request, "weights and remove must be arrays", 422);
  for (const w of weights) {
    const n = Number(w && w.weight);
    if (!w || !w.user_id || !Number.isFinite(n) || n <= 0) {
      return err(request, "each weight needs a user_id and a number greater than 0", 422, "bad_weight");
    }
    const user = await env.DB.prepare("SELECT id FROM users WHERE id = ?").bind(w.user_id).first();
    if (!user) return err(request, `unknown team member ${w.user_id}`, 422, "bad_user");
  }
  try {
    for (const userId of remove) {
      await env.DB.prepare("DELETE FROM member_weights WHERE user_id = ?").bind(userId).run();
    }
    for (const w of weights) {
      await env.DB.prepare(
        `INSERT INTO member_weights (user_id, weight, updated_by, updated_at)
         VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(user_id) DO UPDATE SET
           weight = excluded.weight, updated_by = excluded.updated_by, updated_at = datetime('now')`
      ).bind(w.user_id, Number(w.weight), p.userId).run();
    }
  } catch (e) {
    if (/no such table/i.test(String(e && e.message || e))) {
      return err(request, "migration 022 is not applied yet (POST /api/admin/apply-migration-022)", 409, "migration_needed");
    }
    throw e;
  }
  return await memberWeights(request, env, p);
}
export async function clientBudgetHistory(request, env, p) {
  if (!isClient(p)) return err(request, "client portal is for client users only", 403);
  if (!p.clientId) return err(request, "no client_id bound to this user", 403);
  const clientId = p.clientId;
  const client = await env.DB.prepare(
    "SELECT id, name, hours_cap FROM clients WHERE id = ?"
  ).bind(clientId).first();
  if (!client) return err(request, "client not found", 404);
  const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const ws = weekStart(today);
  const weeks = [];
  for (let i = 0; i < 4; i++) {
    const d = /* @__PURE__ */ new Date(`${ws}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - i * 7);
    weeks.push(d.toISOString().slice(0, 10));
  }
  const result = [];
  for (const wk of weeks) {
    const row = await env.DB.prepare(
      `SELECT COALESCE(SUM(hours), 0) AS total_hours
         FROM time_entries
        WHERE client_id = ? AND is_billable = 1
          AND entry_date >= ? AND entry_date <= date(?, '+6 days')`
    ).bind(clientId, wk, wk).first();
    result.push({
      week_start: wk,
      hours: Number((row?.total_hours || 0).toFixed(2))
    });
  }
  result.reverse();
  return json(request, {
    ok: true,
    client_name: client.name,
    hours_cap: client.hours_cap,
    weeks: result
  });
}
export async function checkBudgetAlerts(env, clientId) {
  try {
    const client = await env.DB.prepare(
      "SELECT id, name, hours_cap, billing_model FROM clients WHERE id = ?"
    ).bind(clientId).first();
    if (!client || client.hours_cap == null) return;
    const { today, weekStartDate } = currentWeekBoundaries();
    const cap = client.hours_cap;
    const hb = (await weeklyClientHours(env, weekStartDate, [client])).get(client.id);
    const totalHours = hb ? hb.effective : 0;
    if (totalHours >= cap * 0.8 && totalHours < cap) {
      await fireBudgetAlert(
        env,
        clientId,
        client.name,
        weekStartDate,
        "warning_80",
        `Budget Warning: ${client.name} is at ${Math.round(totalHours / cap * 100)}% of weekly cap (${totalHours.toFixed(1)}h / ${cap}h)`
      );
    }
    if (totalHours >= cap) {
      await fireBudgetAlert(
        env,
        clientId,
        client.name,
        weekStartDate,
        "warning_80",
        `Budget Warning: ${client.name} reached 80% of weekly cap`
      );
      await fireBudgetAlert(
        env,
        clientId,
        client.name,
        weekStartDate,
        "exceeded_100",
        `Budget EXCEEDED: ${client.name} has exceeded weekly cap (${totalHours.toFixed(1)}h / ${cap}h)`
      );
    }
  } catch (_) {
  }
}
async function fireBudgetAlert(env, clientId, clientName, weekStartDate, threshold, message) {
  try {
    const existing = await env.DB.prepare(
      `SELECT id FROM budget_alerts_sent
        WHERE client_id = ? AND week_start = ? AND threshold = ?`
    ).bind(clientId, weekStartDate, threshold).first();
    if (existing) return;
    const alertId = uuid();
    try {
      await env.DB.prepare(
        `INSERT INTO budget_alerts_sent (id, client_id, week_start, threshold)
         VALUES (?, ?, ?, ?)`
      ).bind(alertId, clientId, weekStartDate, threshold).run();
    } catch (e) {
      if (String(e).includes("UNIQUE")) return;
      throw e;
    }
    const type = threshold === "exceeded_100" ? "budget_exceeded" : "budget_warning";
    await notifyAllAdmins(env, type, message);
  } catch (_) {
  }
}
export const FLAG_FROM_WORK_DAY = 3;
export async function checkUnderTargetAlerts(env, progress) {
  try {
    const prog = progress || await clientWeekProgress(env);
    if (prog.elapsed < FLAG_FROM_WORK_DAY) return 0;
    let fired = 0;
    for (const c of prog.clients) {
      if (c.status !== "behind") continue;
      const before = await env.DB.prepare(
        "SELECT 1 AS x FROM budget_alerts_sent WHERE client_id = ? AND week_start = ? AND threshold = ?"
      ).bind(c.client_id, prog.weekStartDate, "under_target_friday").first();
      if (before) continue;
      await fireBudgetAlert(
        env,
        c.client_id,
        c.client_name,
        prog.weekStartDate,
        "under_target_friday",
        `Behind pace: ${c.client_name} has ${c.effective_hours}h of its ${c.hours_cap}h weekly target (${c.pct_of_cap}%); expected about ${c.expected_pace}h by now` + (c.uses_weights ? ` (weighted hours; ${c.raw_hours}h raw)` : "")
      );
      fired += 1;
    }
    return fired;
  } catch (_) {
    return 0;
  }
}
