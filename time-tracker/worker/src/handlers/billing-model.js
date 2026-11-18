export const LEGACY_BILLING_MODELS = ["hourly", "milestone_weekly", "monthly_retainer"];
export const NEW_BILLING_MODELS = ["fixed_project", "profit_share"];
export const BILLING_GROUPS = [
  { key: "hourly", label: "Hourly" },
  { key: "milestone_weekly", label: "Weekly milestone" },
  { key: "monthly_retainer", label: "Monthly retainer" },
  { key: "fixed_project", label: "Fixed project" },
  { key: "profit_share", label: "Profit share" }
];
function blankFacts(client) {
  return {
    billing_model: client.billing_model || "hourly",
    is_new_model: false,
    fixed_amount_cents: null,
    fixed_start: null,
    fixed_end: null,
    profit_pct: null,
    profit_base: null,
    paused: Boolean(client.paused)
  };
}
export async function loadBillingFacts(env, clients) {
  const facts = /* @__PURE__ */ new Map();
  for (const c of clients) facts.set(c.id, blankFacts(c));
  if (!clients.length) return facts;
  let rows = [];
  try {
    rows = (await env.DB.prepare("SELECT * FROM client_billing").all()).results || [];
  } catch (e) {
    const msg = String(e && e.message || e);
    if (!/no such table/i.test(msg)) throw e;
    return facts;
  }
  for (const r of rows) {
    const f = facts.get(r.client_id);
    if (!f) continue;
    if (NEW_BILLING_MODELS.includes(r.billing_model)) {
      f.billing_model = r.billing_model;
      f.is_new_model = true;
    }
    if (r.fixed_amount_cents !== null && r.fixed_amount_cents !== void 0) {
      f.fixed_amount_cents = Number(r.fixed_amount_cents);
    }
    f.fixed_start = r.fixed_start || null;
    f.fixed_end = r.fixed_end || null;
    if (r.profit_pct !== null && r.profit_pct !== void 0) f.profit_pct = Number(r.profit_pct);
    f.profit_base = r.profit_base || null;
  }
  return facts;
}
export async function effectiveBilling(env, client) {
  const map = await loadBillingFacts(env, [client]);
  return map.get(client.id) || blankFacts(client);
}
export function hasWeeklyAmount(model) {
  return model === "hourly" || model === "milestone_weekly";
}
