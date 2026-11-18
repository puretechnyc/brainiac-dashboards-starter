export const BILL_ON_WEIGHTED_HOURS = true;
const billable = (e) => Number(e.is_billable) !== 0;
export function weightFor(weights, clientId, userId) {
  const row = (weights || []).find(
    (w) => w.client_id === clientId && w.user_id === userId
  );
  const n = row && Number(row.logged_hours_per_allotment_hour);
  return typeof n === "number" && n > 0 ? n : 1;
}
export function memberWeightFor(memberWeights, userId) {
  if (!memberWeights) return void 0;
  let n;
  if (typeof memberWeights.get === "function") {
    const v = memberWeights.get(userId);
    n = v && typeof v === "object" ? Number(v.weight) : Number(v);
  } else if (Array.isArray(memberWeights)) {
    const row = memberWeights.find((w) => w.user_id === userId);
    n = row && Number(row.weight);
  }
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : void 0;
}
export function effectiveWeight(perClientWeights, clientId, userId, memberWeights) {
  const mw = memberWeightFor(memberWeights, userId);
  if (mw !== void 0) return mw;
  return weightFor(perClientWeights, clientId, userId);
}
export function rawBillableHours(entries) {
  return (entries || []).reduce((s, e) => billable(e) ? s + Number(e.hours) : s, 0);
}
export function allotmentConsumedHours(entries, weights, clientId, memberWeights) {
  const byUser = /* @__PURE__ */ new Map();
  for (const e of entries || []) {
    if (!billable(e)) continue;
    byUser.set(e.user_id, (byUser.get(e.user_id) || 0) + Number(e.hours));
  }
  let consumed = 0;
  for (const [userId, h] of byUser) consumed += h / effectiveWeight(weights, clientId, userId, memberWeights);
  return consumed;
}
export function perWeekBillableHours(entriesInWeek, client, weights, billOnWeighted = BILL_ON_WEIGHTED_HOURS, memberWeights) {
  let h = billOnWeighted ? allotmentConsumedHours(entriesInWeek, weights, client.id, memberWeights) : rawBillableHours(entriesInWeek);
  if (client.hours_cap !== null && client.hours_cap !== void 0) {
    h = Math.min(h, Number(client.hours_cap));
  }
  return h;
}
export function invoiceAmountCents(client, weeks, weights, billOnWeighted = BILL_ON_WEIGHTED_HOURS, memberWeights) {
  const model = client.billing_model || "hourly";
  const coveredWeeks = (weeks || []).filter((w) => rawBillableHours(w) > 0).length;
  if (model === "monthly_retainer") {
    return { billing_model: model, billed_hours: 0, amount_cents: Number(client.monthly_retainer_cents || 0) };
  }
  if (model === "milestone_weekly") {
    return {
      billing_model: model,
      billed_hours: 0,
      amount_cents: Number(client.weekly_rate_cents || 0) * coveredWeeks
    };
  }
  let hours = 0;
  for (const w of weeks || []) hours += perWeekBillableHours(w, client, weights, billOnWeighted, memberWeights);
  return {
    billing_model: model,
    billed_hours: hours,
    amount_cents: Math.round(hours * Number(client.rate_cents || 0))
  };
}
export const RETAINER_WEEKS_PER_YEAR = 52;
export function retainerWeeklyRateCents(monthlyCents) {
  if (monthlyCents === null || monthlyCents === void 0) return null;
  return Math.round(Number(monthlyCents) * 12 / RETAINER_WEEKS_PER_YEAR);
}
export function retainerWeekCents(monthlyCents, elapsed) {
  if (monthlyCents === null || monthlyCents === void 0) return 0;
  return Math.round(Number(monthlyCents) * 12 / RETAINER_WEEKS_PER_YEAR * Number(elapsed || 0));
}
export function retainerMonthCents(monthlyCents, elapsed) {
  if (monthlyCents === null || monthlyCents === void 0) return 0;
  return Math.round(Number(monthlyCents) * Number(elapsed || 0));
}
export const MILESTONE_PENDING = "pending";
export const MILESTONE_RELEASED = "released";
export const MILESTONE_LATE = "late";
export function milestoneState(m) {
  if (!m) return MILESTONE_PENDING;
  if (!Number(m.released)) return MILESTONE_PENDING;
  const landed = m.landed_date || m.release_date;
  return String(landed) > String(m.release_date) ? MILESTONE_LATE : MILESTONE_RELEASED;
}
export function milestonesInPeriod(milestones, start, end) {
  if (!start || !end) return [];
  return (milestones || []).filter((m) => m && m.release_date && String(m.release_date) >= String(start) && String(m.release_date) <= String(end));
}
export function fixedProjectPeriodCents(milestones, start, end) {
  let total = 0;
  for (const m of milestonesInPeriod(milestones, start, end)) {
    total += Number(m.amount_cents || 0);
  }
  return total;
}
export function fixedProjectPeriodMilestones(milestones, start, end) {
  return milestonesInPeriod(milestones, start, end).slice().sort((a, b) => String(a.release_date).localeCompare(String(b.release_date))).map((m) => ({
    id: m.id,
    label: m.label || "",
    amount_cents: Number(m.amount_cents || 0),
    release_date: m.release_date,
    released: Number(m.released || 0),
    landed_date: m.landed_date || null,
    state: milestoneState(m)
  }));
}
export function fixedProjectTotalCents(milestones) {
  let total = 0;
  for (const m of milestones || []) total += Number(m.amount_cents || 0);
  return total;
}
