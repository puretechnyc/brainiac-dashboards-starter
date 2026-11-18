import { json, err, centsToStr, SECURITY_HEADERS, corsHeaders } from "../util.js";
import {
  isAdmin,
  isClient,
  isEmployee,
  isManager,
  timeEntryReadScope,
  clientReadScope,
  assignedClientScope
} from "../auth.js";
import { buildStaffReportPdf } from "../pdf.js";
function csvEscape(val) {
  let s = String(val || "");
  if (/^[=+\-@|]/.test(s)) s = "	" + s;
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("	")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
export async function clientReport(request, env, p, clientId, url) {
  const cScope = isManager(p) ? await assignedClientScope(env, p, "c", "id") : clientReadScope(p, "c");
  const client = await env.DB.prepare(
    `SELECT * FROM clients c WHERE c.id = ? AND ${cScope.sql}`
  ).bind(clientId, ...cScope.params).first();
  if (!client) return err(request, "not found", 404);
  if (client.archived && !isAdmin(p)) return err(request, "not found", 404);
  const scope = isManager(p) ? await assignedClientScope(env, p, "t", "client_id") : timeEntryReadScope(p, "t");
  const clauses = [scope.sql, "t.client_id = ?"];
  const params = [...scope.params, clientId];
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (from) {
    clauses.push("t.entry_date >= ?");
    params.push(from);
  }
  if (to) {
    clauses.push("t.entry_date <= ?");
    params.push(to);
  }
  const rows = (await env.DB.prepare(
    `SELECT t.* FROM time_entries t WHERE ${clauses.join(" AND ")} ORDER BY t.entry_date`
  ).bind(...params).all()).results || [];
  let billableHours = 0, internalHours = 0, billableCents = 0;
  const lines = rows.map((r) => {
    const amt = Math.round(r.hours * r.rate_cents);
    if (r.is_billable) {
      billableHours += r.hours;
      billableCents += amt;
    } else internalHours += r.hours;
    return {
      id: r.id,
      entry_date: r.entry_date,
      project_task: r.project_task,
      hours: r.hours,
      is_billable: !!r.is_billable,
      rate_cents: r.rate_cents,
      amount_cents: r.is_billable ? amt : 0,
      approval_status: r.approval_status,
      locked: !!r.locked,
      invoiced: !!r.invoice_id,
      notes: r.notes
    };
  });
  const cap = client.hours_cap;
  if (isEmployee(p)) {
    return json(request, {
      ok: true,
      generated_at: (/* @__PURE__ */ new Date()).toISOString(),
      client: { id: client.id, name: client.name, color: client.color },
      period: { from: from || null, to: to || null },
      totals: {
        billable_hours: Number(billableHours.toFixed(2)),
        internal_hours: Number(internalHours.toFixed(2))
      },
      entries: lines.map(({ rate_cents, amount_cents, ...rest }) => rest)
    });
  }
  const isClientUser = isClient(p);
  const sanitizedLines = isClientUser ? lines.map(({ rate_cents, amount_cents, ...rest }) => rest) : lines;
  const clientInfo = isClientUser ? { id: client.id, name: client.name, color: client.color, currency: client.currency, hours_cap: cap } : { id: client.id, name: client.name, color: client.color, rate_cents: client.rate_cents, currency: client.currency, hours_cap: cap };
  const totalsObj = {
    billable_hours: Number(billableHours.toFixed(2)),
    internal_hours: Number(internalHours.toFixed(2)),
    cap_hours: cap,
    hours_remaining: cap == null ? null : Number((cap - billableHours).toFixed(2)),
    over_cap: cap == null ? false : billableHours > cap
  };
  if (!isClientUser) {
    totalsObj.billable_amount_cents = billableCents;
    totalsObj.billable_amount = centsToStr(billableCents);
  }
  return json(request, {
    ok: true,
    generated_at: (/* @__PURE__ */ new Date()).toISOString(),
    client: clientInfo,
    period: { from: from || null, to: to || null },
    totals: totalsObj,
    entries: sanitizedLines
  });
}
export async function summaryReport(request, env, p, url) {
  if (!isAdmin(p) && !isManager(p)) return err(request, "admin only", 403);
  const managerView = isManager(p);
  const entryScope = await assignedClientScope(env, p, "t", "client_id");
  const listScope = await assignedClientScope(env, p, "c", "id");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const clauses = [entryScope.sql];
  const params = [...entryScope.params];
  if (from) {
    clauses.push("t.entry_date >= ?");
    params.push(from);
  }
  if (to) {
    clauses.push("t.entry_date <= ?");
    params.push(to);
  }
  if (url.searchParams.get("include_archived") !== "1") {
    clauses.push("t.client_id IN (SELECT id FROM clients WHERE archived = 0)");
  }
  const cid = url.searchParams.get("client_id") || "";
  const eid = url.searchParams.get("employee_id") || "";
  if (cid) {
    clauses.push("t.client_id = ?");
    params.push(cid);
  }
  if (eid) {
    clauses.push("t.user_id = ?");
    params.push(eid);
  }
  const totals = await env.DB.prepare(
    `SELECT
       COALESCE(SUM(t.hours), 0) AS total_hours,
       COALESCE(SUM(CASE WHEN t.is_billable = 1 THEN t.hours ELSE 0 END), 0) AS billable_hours,
       COALESCE(SUM(CASE WHEN t.is_billable = 0 THEN t.hours ELSE 0 END), 0) AS internal_hours,
       COALESCE(SUM(CASE WHEN t.is_billable = 1 THEN CAST(ROUND(t.hours * t.rate_cents) AS INTEGER) ELSE 0 END), 0) AS billable_cents
     FROM time_entries t WHERE ${clauses.join(" AND ")}`
  ).bind(...params).first();
  const clientRows = (await env.DB.prepare(
    `SELECT c.id, c.name, c.hours_cap, c.currency,
       COALESCE(SUM(t.hours), 0) AS total_hours,
       COALESCE(SUM(CASE WHEN t.is_billable = 1 THEN t.hours ELSE 0 END), 0) AS billable_hours,
       COALESCE(SUM(CASE WHEN t.is_billable = 0 THEN t.hours ELSE 0 END), 0) AS internal_hours,
       COALESCE(SUM(CASE WHEN t.is_billable = 1 THEN CAST(ROUND(t.hours * t.rate_cents) AS INTEGER) ELSE 0 END), 0) AS billable_cents
     FROM clients c
     LEFT JOIN time_entries t ON t.client_id = c.id AND ${clauses.join(" AND ")}
     WHERE c.archived = 0 AND ${listScope.sql}${cid ? " AND c.id = ?" : ""}
     GROUP BY c.id
     ORDER BY billable_hours DESC`
  ).bind(...params, ...listScope.params, ...cid ? [cid] : []).all()).results || [];
  const employeeRows = (await env.DB.prepare(
    `SELECT u.id, u.email, u.display_name,
       COALESCE(SUM(t.hours), 0) AS total_hours,
       COUNT(DISTINCT t.client_id) AS client_count
     FROM users u
     LEFT JOIN time_entries t ON t.user_id = u.id AND ${clauses.join(" AND ")}
     WHERE u.role IN ('admin', 'employee') AND u.active = 1${eid ? " AND u.id = ?" : ""}
     GROUP BY u.id
     ${managerView ? "HAVING COALESCE(SUM(t.hours), 0) > 0" : ""}
     ORDER BY total_hours DESC`
  ).bind(...params, ...eid ? [eid] : []).all()).results || [];
  const empClientRows = (await env.DB.prepare(
    `SELECT t.user_id, c.name AS client_name,
       COALESCE(SUM(t.hours), 0) AS hours
     FROM time_entries t
     JOIN clients c ON c.id = t.client_id
     WHERE ${clauses.join(" AND ")}
     GROUP BY t.user_id, t.client_id
     ORDER BY hours DESC`
  ).bind(...params).all()).results || [];
  const empClientMap = /* @__PURE__ */ new Map();
  for (const r of empClientRows) {
    if (!empClientMap.has(r.user_id)) empClientMap.set(r.user_id, []);
    empClientMap.get(r.user_id).push({ client_name: r.client_name, hours: Number(r.hours.toFixed(2)) });
  }
  const totalsObj = {
    total_hours: Number((totals?.total_hours || 0).toFixed(2)),
    billable_hours: Number((totals?.billable_hours || 0).toFixed(2)),
    internal_hours: Number((totals?.internal_hours || 0).toFixed(2))
  };
  if (!managerView) {
    totalsObj.billable_cents = totals?.billable_cents || 0;
    totalsObj.billable_amount = centsToStr(totals?.billable_cents || 0);
  }
  return json(request, {
    ok: true,
    generated_at: (/* @__PURE__ */ new Date()).toISOString(),
    period: { from: from || null, to: to || null },
    scope: managerView ? "assigned_clients" : "all_clients",
    totals: totalsObj,
    clients: clientRows.map((c) => {
      const row = {
        id: c.id,
        name: c.name,
        currency: c.currency,
        hours_cap: c.hours_cap,
        total_hours: Number(c.total_hours.toFixed(2)),
        billable_hours: Number(c.billable_hours.toFixed(2)),
        internal_hours: Number(c.internal_hours.toFixed(2)),
        cap_utilization: c.hours_cap ? Number((c.billable_hours / c.hours_cap * 100).toFixed(1)) : null
      };
      if (!managerView) {
        row.billable_cents = c.billable_cents;
        row.billable_amount = centsToStr(c.billable_cents);
      }
      return row;
    }),
    employees: employeeRows.map((e) => ({
      id: e.id,
      email: e.email,
      display_name: e.display_name,
      total_hours: Number(e.total_hours.toFixed(2)),
      client_count: e.client_count,
      clients: empClientMap.get(e.id) || []
    }))
  });
}
const STAFF_TASK_TOP_N = 12;
const STAFF_ROW_LIMIT = 500;
const STAFF_PDF_ROW_LIMIT = 5e3;
const STAFF_SCOPE_LABEL = {
  own_rows: "Your own entries for the chosen range.",
  assigned_clients: "The hours on the clients you are assigned to, for the chosen range.",
  all: "Every entry for the chosen range."
};
function pdfFile(request, bytes, filename) {
  const safe = String(filename || "report.pdf").replace(/[^\w.\- ]+/g, "_").slice(0, 120);
  return new Response(bytes, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${safe}"`,
      "Cache-Control": "private, no-store",
      ...SECURITY_HEADERS,
      ...corsHeaders(request)
    }
  });
}
export async function staffReport(request, env, p, url) {
  if (isClient(p)) return err(request, "no staff report for a client login", 403);
  const wantPdf = url.searchParams.get("format") === "pdf";
  const scope = isManager(p) ? await assignedClientScope(env, p, "t", "client_id") : timeEntryReadScope(p, "t");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const clauses = [scope.sql];
  const params = [...scope.params];
  if (from) {
    clauses.push("t.entry_date >= ?");
    params.push(from);
  }
  if (to) {
    clauses.push("t.entry_date <= ?");
    params.push(to);
  }
  const cid = url.searchParams.get("client_id");
  if (cid) {
    clauses.push("t.client_id = ?");
    params.push(cid);
  }
  const employeeId = url.searchParams.get("employee_id");
  if (employeeId && isAdmin(p)) {
    clauses.push("t.user_id = ?");
    params.push(employeeId);
  }
  const whereAll = clauses.join(" AND ");
  const includeArchived = url.searchParams.get("include_archived") === "1";
  const where = includeArchived ? whereAll : `${whereAll} AND t.client_id IN (SELECT id FROM clients WHERE archived = 0)`;
  const HOURS = `
       COALESCE(SUM(t.hours), 0) AS total_hours,
       COALESCE(SUM(CASE WHEN t.is_billable = 1 THEN t.hours ELSE 0 END), 0) AS billable_hours,
       COALESCE(SUM(CASE WHEN t.is_billable = 0 THEN t.hours ELSE 0 END), 0) AS non_billable_hours,
       COUNT(*) AS entry_count`;
  const totals = await env.DB.prepare(
    `SELECT${HOURS},
       COALESCE(SUM(CASE WHEN t.is_billable = 1 THEN CAST(ROUND(t.hours * t.rate_cents) AS INTEGER) ELSE 0 END), 0) AS billable_cents
     FROM time_entries t WHERE ${where}`
  ).bind(...params).first();
  const clientRows = (await env.DB.prepare(
    `SELECT t.client_id, c.name AS client_name, c.archived,${HOURS}
     FROM time_entries t JOIN clients c ON c.id = t.client_id
     WHERE ${where}
     GROUP BY t.client_id
     ORDER BY total_hours DESC, client_name ASC`
  ).bind(...params).all()).results || [];
  const taskRows = (await env.DB.prepare(
    `SELECT COALESCE(NULLIF(TRIM(t.project_task), ''), '(no task)') AS task,${HOURS}
     FROM time_entries t WHERE ${where}
     GROUP BY task
     ORDER BY total_hours DESC, task ASC`
  ).bind(...params).all()).results || [];
  const dayRows = (await env.DB.prepare(
    `SELECT t.entry_date AS day,${HOURS}
     FROM time_entries t WHERE ${where}
     GROUP BY t.entry_date
     ORDER BY t.entry_date ASC`
  ).bind(...params).all()).results || [];
  const clientDayRows = (await env.DB.prepare(
    `SELECT t.client_id, c.name AS client_name, t.entry_date AS day,
       COALESCE(SUM(t.hours), 0) AS hours
     FROM time_entries t JOIN clients c ON c.id = t.client_id
     WHERE ${where}
     GROUP BY t.client_id, t.entry_date
     ORDER BY t.entry_date ASC, client_name ASC`
  ).bind(...params).all()).results || [];
  const adminCols = isAdmin(p) ? `, u.display_name AS employee_name, u.email AS employee_email, t.rate_cents,
         CASE WHEN t.is_billable = 1 THEN CAST(ROUND(t.hours * t.rate_cents) AS INTEGER) ELSE 0 END AS amount_cents` : "";
  const adminJoin = isAdmin(p) ? "LEFT JOIN users u ON u.id = t.user_id" : "";
  const rowRows = (await env.DB.prepare(
    `SELECT t.id, t.entry_date, t.client_id, c.name AS client_name, t.project_task,
       t.hours, t.entry_type, t.is_billable, t.notes, t.approval_status${adminCols}
     FROM time_entries t JOIN clients c ON c.id = t.client_id ${adminJoin}
     WHERE ${where}
     ORDER BY t.entry_date DESC, t.created_at DESC
     LIMIT ${wantPdf ? STAFF_PDF_ROW_LIMIT : STAFF_ROW_LIMIT}`
  ).bind(...params).all()).results || [];
  let employees = null;
  if (isAdmin(p)) {
    const empTotals = (await env.DB.prepare(
      `SELECT t.user_id, u.display_name, u.email,${HOURS}
       FROM time_entries t JOIN users u ON u.id = t.user_id
       WHERE ${where}
       GROUP BY t.user_id
       ORDER BY total_hours DESC, u.display_name ASC`
    ).bind(...params).all()).results || [];
    const empClients = (await env.DB.prepare(
      `SELECT t.user_id, c.name AS client_name, COALESCE(SUM(t.hours), 0) AS hours
       FROM time_entries t JOIN clients c ON c.id = t.client_id
       WHERE ${where}
       GROUP BY t.user_id, t.client_id
       ORDER BY t.user_id, hours DESC`
    ).bind(...params).all()).results || [];
    employees = empTotals.map((e) => ({
      key: e.user_id,
      name: e.display_name || e.email,
      email: e.email,
      total_hours: Number(e.total_hours || 0),
      billable_hours: Number(e.billable_hours || 0),
      non_billable_hours: Number(e.non_billable_hours || 0),
      entry_count: e.entry_count || 0,
      clients: empClients.filter((c) => c.user_id === e.user_id).map((c) => ({ client_name: c.client_name, hours: Number(c.hours || 0) }))
    }));
  }
  const groupOf = (r) => ({
    key: r.task,
    name: r.task,
    total_hours: Number(r.total_hours || 0),
    billable_hours: Number(r.billable_hours || 0),
    non_billable_hours: Number(r.non_billable_hours || 0),
    entry_count: r.entry_count || 0
  });
  const tasks = taskRows.slice(0, STAFF_TASK_TOP_N).map(groupOf);
  const rest = taskRows.slice(STAFF_TASK_TOP_N);
  if (rest.length) {
    const sum = (k) => rest.reduce((s, r) => s + Number(r[k] || 0), 0);
    tasks.push({
      key: "__other__",
      name: `Other tasks (${rest.length})`,
      total_hours: sum("total_hours"),
      billable_hours: sum("billable_hours"),
      non_billable_hours: sum("non_billable_hours"),
      entry_count: rest.reduce((s, r) => s + (r.entry_count || 0), 0)
    });
  }
  let excluded = null;
  if (!includeArchived) {
    const exRows = (await env.DB.prepare(
      `SELECT t.client_id, c.name AS client_name, COUNT(*) AS entry_count,
         COALESCE(SUM(t.hours), 0) AS total_hours,
         COALESCE(SUM(CASE WHEN t.is_billable = 1 THEN t.hours ELSE 0 END), 0) AS billable_hours
       FROM time_entries t JOIN clients c ON c.id = t.client_id
       WHERE ${whereAll} AND c.archived = 1
       GROUP BY t.client_id
       ORDER BY total_hours DESC, client_name ASC`
    ).bind(...params).all()).results || [];
    const r2 = (n) => Number(Number(n || 0).toFixed(2));
    excluded = {
      total_hours: r2(exRows.reduce((s, r) => s + Number(r.total_hours || 0), 0)),
      billable_hours: r2(exRows.reduce((s, r) => s + Number(r.billable_hours || 0), 0)),
      entry_count: exRows.reduce((s, r) => s + (r.entry_count || 0), 0),
      client_count: exRows.length,
      clients: exRows.map((r) => ({
        client_id: r.client_id,
        client_name: r.client_name,
        hours: r2(r.total_hours),
        entry_count: r.entry_count || 0
      }))
    };
  }
  const totalsObj = {
    total_hours: Number(Number(totals?.total_hours || 0).toFixed(2)),
    billable_hours: Number(Number(totals?.billable_hours || 0).toFixed(2)),
    non_billable_hours: Number(Number(totals?.non_billable_hours || 0).toFixed(2)),
    entry_count: totals?.entry_count || 0
  };
  if (isAdmin(p)) {
    totalsObj.billable_cents = totals?.billable_cents || 0;
    totalsObj.billable_amount = centsToStr(totals?.billable_cents || 0);
  }
  const groups = {
    client: clientRows.map((c) => ({
      key: c.client_id,
      name: c.client_name,
      archived: c.archived === 1,
      total_hours: Number(c.total_hours || 0),
      billable_hours: Number(c.billable_hours || 0),
      non_billable_hours: Number(c.non_billable_hours || 0),
      entry_count: c.entry_count || 0
    })),
    task: tasks,
    day: dayRows.map((d) => ({
      key: d.day,
      name: d.day,
      total_hours: Number(d.total_hours || 0),
      billable_hours: Number(d.billable_hours || 0),
      non_billable_hours: Number(d.non_billable_hours || 0),
      entry_count: d.entry_count || 0
    })),
    client_day: clientDayRows.map((r) => ({
      client_id: r.client_id,
      client_name: r.client_name,
      day: r.day,
      hours: Number(r.hours || 0)
    }))
  };
  if (employees) groups.employee = employees;
  const payload = {
    ok: true,
    generated_at: (/* @__PURE__ */ new Date()).toISOString(),
    period: { from: from || null, to: to || null },
    scope: isManager(p) ? "assigned_clients" : isAdmin(p) ? "all" : "own_rows",
    columns: { employee: isAdmin(p), money: isAdmin(p) },
    totals: totalsObj,
    excluded,
    groups,
    rows: rowRows.map((r) => ({
      id: r.id,
      date: r.entry_date,
      client_id: r.client_id,
      client_name: r.client_name,
      task: r.project_task || "",
      hours: Number(Number(r.hours || 0).toFixed(2)),
      entry_type: r.entry_type || "work",
      billable: r.is_billable ? 1 : 0,
      notes: r.notes || "",
      status: r.approval_status || "",
      ...isAdmin(p) ? {
        employee_name: r.employee_name || r.employee_email || "",
        rate_cents: Number(r.rate_cents || 0),
        amount_cents: Number(r.amount_cents || 0)
      } : {}
    })),
    rows_total: totals?.entry_count || 0,
    rows_truncated: (totals?.entry_count || 0) > rowRows.length
  };
  if (wantPdf) {
    const labels = [];
    if (STAFF_SCOPE_LABEL[payload.scope]) labels.push(STAFF_SCOPE_LABEL[payload.scope]);
    if (isAdmin(p) && employeeId) {
      const who = (employees || []).find((e) => String(e.key) === String(employeeId));
      labels.push(`Employee: ${who ? who.name : "one employee"}`);
    }
    const bytes = await buildStaffReportPdf(payload, {
      title: "Time Tracker - time report",
      scopeLabel: labels.join(" · ")
    });
    const name = `time-report-${payload.period.from || "all"}_to_${payload.period.to || "today"}.pdf`;
    return pdfFile(request, bytes, name);
  }
  return json(request, payload);
}
export async function exportCsv(request, env, p, url) {
  const scope = isManager(p) ? await assignedClientScope(env, p, "t", "client_id") : timeEntryReadScope(p, "t");
  const clauses = [scope.sql];
  const params = [...scope.params];
  const cid = url.searchParams.get("client_id");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const employeeId = url.searchParams.get("employee_id");
  if (cid) {
    clauses.push("t.client_id = ?");
    params.push(cid);
  }
  if (from) {
    clauses.push("t.entry_date >= ?");
    params.push(from);
  }
  if (to) {
    clauses.push("t.entry_date <= ?");
    params.push(to);
  }
  if (employeeId && isAdmin(p)) {
    clauses.push("t.user_id = ?");
    params.push(employeeId);
  }
  if (url.searchParams.get("include_archived") !== "1") {
    clauses.push("t.client_id IN (SELECT id FROM clients WHERE archived = 0)");
  }
  const rows = (await env.DB.prepare(
    `SELECT t.*, c.name AS client_name, u.display_name AS employee_name, u.email AS employee_email
       FROM time_entries t
       JOIN clients c ON c.id = t.client_id
       JOIN users u ON u.id = t.user_id
      WHERE ${clauses.join(" AND ")}
      ORDER BY t.entry_date DESC, t.created_at DESC
      LIMIT 10000`
  ).bind(...params).all()).results || [];
  const isAdminUser = isAdmin(p);
  const isClientUser = isClient(p);
  let headers;
  if (isAdminUser) {
    headers = ["Date", "Client", "Employee", "Task", "Hours", "Entry Type", "Billable", "Rate", "Amount", "Notes", "Status"];
  } else if (isClientUser) {
    headers = ["Date", "Client", "Task", "Hours", "Notes"];
  } else {
    headers = ["Date", "Client", "Task", "Hours", "Entry Type", "Billable", "Notes", "Status"];
  }
  const csvRows = rows.map((r) => {
    if (isAdminUser) {
      return [
        r.entry_date,
        csvEscape(r.client_name),
        csvEscape(r.employee_name || r.employee_email || ""),
        csvEscape(r.project_task || ""),
        r.hours.toFixed(2),
        r.entry_type || "work",
        r.is_billable ? "Yes" : "No",
        (r.rate_cents / 100).toFixed(2),
        (r.hours * r.rate_cents / 100).toFixed(2),
        csvEscape(r.notes || ""),
        r.approval_status
      ].join(",");
    } else if (isClientUser) {
      return [
        r.entry_date,
        csvEscape(r.client_name),
        csvEscape(r.project_task || ""),
        r.hours.toFixed(2),
        csvEscape(r.notes || "")
      ].join(",");
    } else {
      return [
        r.entry_date,
        csvEscape(r.client_name),
        csvEscape(r.project_task || ""),
        r.hours.toFixed(2),
        r.entry_type || "work",
        r.is_billable ? "Yes" : "No",
        csvEscape(r.notes || ""),
        r.approval_status
      ].join(",");
    }
  });
  const csv = [headers.join(","), ...csvRows].join("\n");
  const dateStr = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const filename = `time-entries-${dateStr}.csv`;
  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`
    }
  });
}
