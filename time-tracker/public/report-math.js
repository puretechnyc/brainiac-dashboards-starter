(function(root) {
  "use strict";
  function round2(n) {
    return Math.round((Number(n) || 0) * 100) / 100;
  }
  function amountCents(entry) {
    if (!entry || !entry.is_billable) return 0;
    const hours = Number(entry.hours) || 0;
    const rate = Number(entry.rate_cents) || 0;
    return Math.round(hours * rate);
  }
  function hasRate(entry) {
    return !!(entry && Number(entry.rate_cents) > 0);
  }
  function filterRows(rows, filters) {
    const f = filters || {};
    const clientId = f.clientId ? String(f.clientId) : "";
    const employeeId = f.employeeId ? String(f.employeeId) : "";
    return (rows || []).filter((r) => {
      if (clientId && String(r.client_id) !== clientId) return false;
      if (employeeId && String(r.user_id) !== employeeId) return false;
      return true;
    });
  }
  function sumRows(rows) {
    const list = rows || [];
    let totalHours = 0;
    let billableHours = 0;
    let amountTotal = 0;
    for (const r of list) {
      const hours = Number(r.hours) || 0;
      totalHours += hours;
      if (r.is_billable) {
        billableHours += hours;
        amountTotal += amountCents(r);
      }
    }
    return {
      count: list.length,
      total_hours: round2(totalHours),
      billable_hours: round2(billableHours),
      amount_cents: amountTotal,
      amount: (amountTotal / 100).toFixed(2)
    };
  }
  const api = { round2, amountCents, hasRate, filterRows, sumRows };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.RptMath = api;
})(typeof self !== "undefined" ? self : this);
