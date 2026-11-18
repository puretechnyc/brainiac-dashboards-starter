import { json, err, readJson, uuid, amountCents, centsToStr, weekStartForDay, etYear } from "../util.js";
import { isAdmin, isClient, isManager, invoiceReadScope, tableExists } from "../auth.js";
import { invoiceAmountCents } from "../billing.js";
import { loadMemberWeights } from "./budget.js";
import { effectiveBilling, NEW_BILLING_MODELS } from "./billing-model.js";
import { sendInvoiceEmail, brevoConfigured } from "../email.js";
const INVOICE_APPROVED_ONLY_DEFAULT = true;
export async function generateInvoice(request, env, p) {
  if (!isAdmin(p)) return err(request, "admin only", 403);
  const b = await readJson(request);
  if (!b.client_id) return err(request, "client_id required", 422);
  if (!b.period_start || !b.period_end) return err(request, "period_start and period_end required", 422);
  const client = await env.DB.prepare("SELECT * FROM clients WHERE id = ?").bind(b.client_id).first();
  if (!client) return err(request, "client not found", 404);
  const facts = await effectiveBilling(env, client);
  if (NEW_BILLING_MODELS.includes(facts.billing_model)) {
    return err(
      request,
      `this client bills as ${facts.billing_model}, which this endpoint does not bill yet — no invoice was created`,
      409,
      "billing_model_not_supported"
    );
  }
  const billingModel = facts.billing_model;
  const approvedOnly = b.require_approved === void 0 ? INVOICE_APPROVED_ONLY_DEFAULT : b.require_approved !== false;
  const rows = (await env.DB.prepare(
    `SELECT * FROM time_entries
      WHERE client_id = ? AND is_billable = 1 AND invoice_id IS NULL
        AND entry_date >= ? AND entry_date <= ?
        ${approvedOnly ? "AND approval_status = 'approved'" : ""}
      ORDER BY entry_date`
  ).bind(b.client_id, b.period_start, b.period_end).all()).results || [];
  if (rows.length === 0) return err(request, "no billable, un-invoiced entries in period", 422, "empty");
  let totalHours = 0;
  let subtotal = 0;
  let lines;
  if (billingModel === "hourly") {
    const weights = (await env.DB.prepare(
      "SELECT * FROM member_client_weights WHERE client_id = ?"
    ).bind(b.client_id).all()).results || [];
    const memberWeights = await loadMemberWeights(env);
    const weekStartDay = typeof client.week_start_day === "number" ? client.week_start_day : 1;
    const weekBuckets = /* @__PURE__ */ new Map();
    for (const r of rows) {
      const wk = weekStartForDay(r.entry_date, weekStartDay);
      if (!weekBuckets.has(wk)) weekBuckets.set(wk, []);
      weekBuckets.get(wk).push(r);
    }
    const weeks = [...weekBuckets.values()];
    const result = invoiceAmountCents(client, weeks, weights, void 0, memberWeights);
    totalHours = result.billed_hours;
    subtotal = result.amount_cents;
    lines = rows.map((r) => {
      const amt = amountCents(r.hours, r.rate_cents);
      return {
        id: uuid(),
        time_entry_id: r.id,
        description: `${r.entry_date} — ${r.project_task || "work"}`.trim(),
        hours: r.hours,
        rate_cents: r.rate_cents,
        amount_cents: amt
      };
    });
    const lineSum = lines.reduce((s, l) => s + l.amount_cents, 0);
    if (lineSum > 0 && lineSum !== subtotal) {
      const ratio = subtotal / lineSum;
      let adjusted = 0;
      for (let i = 0; i < lines.length; i++) {
        if (i === lines.length - 1) {
          lines[i].amount_cents = subtotal - adjusted;
        } else {
          lines[i].amount_cents = Math.round(lines[i].amount_cents * ratio);
          adjusted += lines[i].amount_cents;
        }
      }
    }
    totalHours = Number(totalHours.toFixed(2));
  } else if (billingModel === "milestone_weekly") {
    const weekStartDay = typeof client.week_start_day === "number" ? client.week_start_day : 1;
    const activeWeeks = /* @__PURE__ */ new Set();
    for (const r of rows) {
      activeWeeks.add(weekStartForDay(r.entry_date, weekStartDay));
    }
    const coveredWeeks = activeWeeks.size;
    subtotal = Number(client.weekly_rate_cents || 0) * coveredWeeks;
    totalHours = rows.reduce((s, r) => s + r.hours, 0);
    totalHours = Number(totalHours.toFixed(2));
    lines = [{
      id: uuid(),
      time_entry_id: null,
      description: `Weekly milestone x ${coveredWeeks} week(s)`,
      hours: totalHours,
      rate_cents: client.weekly_rate_cents || 0,
      amount_cents: subtotal
    }];
  } else if (billingModel === "monthly_retainer") {
    subtotal = Number(client.monthly_retainer_cents || 0);
    totalHours = rows.reduce((s, r) => s + r.hours, 0);
    totalHours = Number(totalHours.toFixed(2));
    lines = [{
      id: uuid(),
      time_entry_id: null,
      description: `Monthly retainer (${b.period_start} to ${b.period_end})`,
      hours: totalHours,
      rate_cents: 0,
      amount_cents: subtotal
    }];
  } else {
    lines = rows.map((r) => {
      const amt = amountCents(r.hours, r.rate_cents);
      totalHours += r.hours;
      subtotal += amt;
      return {
        id: uuid(),
        time_entry_id: r.id,
        description: `${r.entry_date} — ${r.project_task || "work"}`.trim(),
        hours: r.hours,
        rate_cents: r.rate_cents,
        amount_cents: amt
      };
    });
    totalHours = Number(totalHours.toFixed(2));
  }
  const invoiceId = uuid();
  const invoiceNumber = await nextInvoiceNumber(env);
  const stmts = [];
  stmts.push(env.DB.prepare(
    `INSERT INTO invoices (id,client_id,created_by,invoice_number,period_start,period_end,status,currency,total_hours,subtotal_cents,total_cents,notes,due_date)
     VALUES (?,?,?,?,?,?, 'draft', ?, ?, ?, ?, ?, ?)`
  ).bind(
    invoiceId,
    b.client_id,
    p.userId,
    invoiceNumber,
    b.period_start,
    b.period_end,
    client.currency,
    totalHours,
    subtotal,
    subtotal,
    b.notes || "",
    b.due_date || null
  ));
  for (const ln of lines) {
    stmts.push(env.DB.prepare(
      `INSERT INTO invoice_line_items (id,invoice_id,time_entry_id,description,hours,rate_cents,amount_cents)
       VALUES (?,?,?,?,?,?,?)`
    ).bind(ln.id, invoiceId, ln.time_entry_id, ln.description, ln.hours, ln.rate_cents, ln.amount_cents));
  }
  for (const ln of lines) {
    if (ln.time_entry_id) {
      stmts.push(env.DB.prepare(
        `UPDATE time_entries SET invoice_id = ?, updated_at = datetime('now')
          WHERE id = ? AND invoice_id IS NULL`
      ).bind(invoiceId, ln.time_entry_id));
    }
  }
  await env.DB.batch(stmts);
  const entryLines = lines.filter((l) => l.time_entry_id);
  if (entryLines.length > 0) {
    const stampedRow = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM time_entries WHERE invoice_id = ?"
    ).bind(invoiceId).first();
    const stampedCount = stampedRow?.n || 0;
    if (stampedCount !== entryLines.length) {
      await env.DB.batch([
        env.DB.prepare("DELETE FROM invoice_line_items WHERE invoice_id = ?").bind(invoiceId),
        env.DB.prepare("UPDATE invoices SET status = 'void' WHERE id = ?").bind(invoiceId)
      ]);
      console.log(`invoice ${invoiceId} voided (TOCTOU): stamped ${stampedCount} of ${entryLines.length} lines`);
      return err(
        request,
        "concurrent invoicing detected — some entries were invoiced by another request; please retry",
        409,
        "toctou"
      );
    }
  }
  return json(request, {
    ok: true,
    invoice: {
      id: invoiceId,
      invoice_number: invoiceNumber,
      client_id: b.client_id,
      client_name: client.name,
      currency: client.currency,
      period_start: b.period_start,
      period_end: b.period_end,
      status: "draft",
      billing_model: billingModel,
      total_hours: totalHours,
      subtotal_cents: subtotal,
      total_cents: subtotal,
      total: centsToStr(subtotal),
      line_items: lines
    }
  }, 201);
}
async function nextInvoiceNumber(env) {
  const year = etYear();
  await env.DB.prepare(
    "INSERT INTO invoice_counters (year, next_seq) VALUES (?, 1) ON CONFLICT(year) DO NOTHING"
  ).bind(year).run();
  const row = await env.DB.prepare(
    "UPDATE invoice_counters SET next_seq = next_seq + 1 WHERE year = ? RETURNING next_seq"
  ).bind(year).first();
  const seq = (row?.next_seq || 2) - 1;
  return `INV-${year}-${String(seq).padStart(4, "0")}`;
}
export async function listInvoices(request, env, p, url) {
  if (isManager(p)) return err(request, "invoices are admin-only", 403, "admin_only");
  const scope = invoiceReadScope(p, "i");
  const clauses = [scope.sql];
  const params = [...scope.params];
  const cid = url.searchParams.get("client_id");
  const status = url.searchParams.get("status");
  const dateFrom = url.searchParams.get("date_from");
  const dateTo = url.searchParams.get("date_to");
  if (cid) {
    clauses.push("i.client_id = ?");
    params.push(cid);
  }
  if (status) {
    clauses.push("i.status = ?");
    params.push(status);
  }
  if (dateFrom) {
    clauses.push("i.created_at >= ?");
    params.push(dateFrom);
  }
  if (dateTo) {
    clauses.push("i.created_at <= ?");
    params.push(dateTo + "T23:59:59");
  }
  const allowedSorts = ["created_at", "total_cents", "period_start", "period_end", "due_date", "invoice_number"];
  const sortCol = allowedSorts.includes(url.searchParams.get("sort")) ? url.searchParams.get("sort") : "created_at";
  const sortOrder = url.searchParams.get("order") === "asc" ? "ASC" : "DESC";
  const limit = Math.min(Math.max(1, parseInt(url.searchParams.get("limit"), 10) || 50), 200);
  const offset = Math.max(0, parseInt(url.searchParams.get("offset"), 10) || 0);
  const rawRows = (await env.DB.prepare(
    `SELECT i.*, c.name AS client_name FROM invoices i JOIN clients c ON c.id = i.client_id
      WHERE ${clauses.join(" AND ")} ORDER BY i.${sortCol} ${sortOrder}
      LIMIT ? OFFSET ?`
  ).bind(...params, limit, offset).all()).results || [];
  let rows = rawRows;
  if (isClient(p)) {
    rows = rawRows.map((inv) => {
      const { created_by, ...safe } = inv;
      return safe;
    });
  }
  return json(request, { ok: true, invoices: rows, limit, offset });
}
export async function getInvoice(request, env, p, id) {
  const scope = invoiceReadScope(p, "i");
  const inv = await env.DB.prepare(
    `SELECT i.*, c.name AS client_name, c.contact_name, c.contact_email, c.paypal_email,
            c.billing_model AS client_billing_model
       FROM invoices i JOIN clients c ON c.id = i.client_id
      WHERE i.id = ? AND ${scope.sql}`
  ).bind(id, ...scope.params).first();
  if (!inv) return err(request, "not found", 404);
  const items = (await env.DB.prepare(
    "SELECT * FROM invoice_line_items WHERE invoice_id = ? ORDER BY hours DESC"
  ).bind(id).all()).results || [];
  let line_items = items.map((it) => ({
    ...it,
    rate: centsToStr(it.rate_cents),
    amount: centsToStr(it.amount_cents)
  }));
  const payments = (await env.DB.prepare(
    "SELECT * FROM invoice_payments WHERE invoice_id = ? ORDER BY paid_at DESC"
  ).bind(id).all()).results || [];
  if (isClient(p)) {
    line_items = line_items.map((li) => {
      const { rate_cents, rate, time_entry_id, ...safe } = li;
      return safe;
    });
  }
  const clientInfo = isClient(p) ? { id: inv.client_id, name: inv.client_name } : {
    id: inv.client_id,
    name: inv.client_name,
    contact_name: inv.contact_name,
    contact_email: inv.contact_email,
    paypal_email: inv.paypal_email
  };
  const invoiceData = {
    id: inv.id,
    invoice_number: inv.invoice_number,
    status: inv.status,
    currency: inv.currency,
    period_start: inv.period_start,
    period_end: inv.period_end,
    created_at: inv.created_at,
    notes: inv.notes,
    due_date: inv.due_date,
    sent_at: inv.sent_at,
    sent_to: inv.sent_to,
    paid_at: inv.paid_at,
    paid_amount_cents: inv.paid_amount_cents,
    client: clientInfo,
    total_hours: inv.total_hours,
    subtotal_cents: inv.subtotal_cents,
    subtotal: centsToStr(inv.subtotal_cents),
    total_cents: inv.total_cents,
    total: centsToStr(inv.total_cents),
    line_items,
    payments: payments.map((pm) => ({
      ...pm,
      amount: centsToStr(pm.amount_cents)
    }))
  };
  return json(request, { ok: true, invoice: invoiceData });
}
export async function updateInvoice(request, env, p, id) {
  if (!isAdmin(p)) return err(request, "admin only", 403);
  const inv = await env.DB.prepare("SELECT * FROM invoices WHERE id = ?").bind(id).first();
  if (!inv) return err(request, "not found", 404);
  if (inv.status !== "draft") return err(request, "only draft invoices can be modified", 409, "not_draft");
  const b = await readJson(request);
  const notes = b.notes !== void 0 ? b.notes : inv.notes;
  const dueDate = b.due_date !== void 0 ? b.due_date : inv.due_date;
  await env.DB.prepare(
    `UPDATE invoices SET notes = ?, due_date = ? WHERE id = ?`
  ).bind(notes, dueDate, id).run();
  return json(request, { ok: true, id, notes, due_date: dueDate });
}
export async function addLineItem(request, env, p, invoiceId) {
  if (!isAdmin(p)) return err(request, "admin only", 403);
  const inv = await env.DB.prepare("SELECT * FROM invoices WHERE id = ?").bind(invoiceId).first();
  if (!inv) return err(request, "invoice not found", 404);
  if (inv.status !== "draft") return err(request, "only draft invoices can be modified", 409, "not_draft");
  const b = await readJson(request);
  if (!b.description) return err(request, "description required", 422);
  const hours = Number(b.hours) || 0;
  const rateCents = Number.isFinite(b.rate_cents) ? Math.round(b.rate_cents) : 0;
  const amtCents = Number.isFinite(b.amount_cents) ? Math.round(b.amount_cents) : amountCents(hours, rateCents);
  const lineId = uuid();
  await env.DB.prepare(
    `INSERT INTO invoice_line_items (id, invoice_id, time_entry_id, description, hours, rate_cents, amount_cents)
     VALUES (?, ?, NULL, ?, ?, ?, ?)`
  ).bind(lineId, invoiceId, b.description, hours, rateCents, amtCents).run();
  await recalcInvoiceTotals(env, invoiceId);
  const updated = await env.DB.prepare("SELECT * FROM invoices WHERE id = ?").bind(invoiceId).first();
  return json(request, {
    ok: true,
    line_item: { id: lineId, invoice_id: invoiceId, description: b.description, hours, rate_cents: rateCents, amount_cents: amtCents },
    total_cents: updated.total_cents,
    subtotal_cents: updated.subtotal_cents
  }, 201);
}
export async function removeLineItem(request, env, p, invoiceId, lineId) {
  if (!isAdmin(p)) return err(request, "admin only", 403);
  const inv = await env.DB.prepare("SELECT * FROM invoices WHERE id = ?").bind(invoiceId).first();
  if (!inv) return err(request, "invoice not found", 404);
  if (inv.status !== "draft") return err(request, "only draft invoices can be modified", 409, "not_draft");
  const line = await env.DB.prepare(
    "SELECT * FROM invoice_line_items WHERE id = ? AND invoice_id = ?"
  ).bind(lineId, invoiceId).first();
  if (!line) return err(request, "line item not found", 404);
  if (line.time_entry_id) {
    await env.DB.prepare(
      `UPDATE time_entries SET invoice_id = NULL, updated_at = datetime('now')
        WHERE id = ? AND invoice_id = ? AND locked = 0`
    ).bind(line.time_entry_id, invoiceId).run();
  }
  await env.DB.prepare("DELETE FROM invoice_line_items WHERE id = ?").bind(lineId).run();
  await recalcInvoiceTotals(env, invoiceId);
  const updated = await env.DB.prepare("SELECT * FROM invoices WHERE id = ?").bind(invoiceId).first();
  return json(request, {
    ok: true,
    deleted: lineId,
    total_cents: updated.total_cents,
    subtotal_cents: updated.subtotal_cents
  });
}
async function recalcInvoiceTotals(env, invoiceId) {
  const sum = await env.DB.prepare(
    "SELECT COALESCE(SUM(amount_cents), 0) AS total, COALESCE(SUM(hours), 0) AS hours FROM invoice_line_items WHERE invoice_id = ?"
  ).bind(invoiceId).first();
  await env.DB.prepare(
    `UPDATE invoices SET subtotal_cents = ?, total_cents = ?, total_hours = ? WHERE id = ?`
  ).bind(sum.total, sum.total, Number(Number(sum.hours).toFixed(2)), invoiceId).run();
}
export async function updateInvoiceStatus(request, env, p, id) {
  if (!isAdmin(p)) return err(request, "admin only", 403);
  const inv = await env.DB.prepare("SELECT * FROM invoices WHERE id = ?").bind(id).first();
  if (!inv) return err(request, "not found", 404);
  const b = await readJson(request);
  const newStatus = b.status;
  if (!newStatus) return err(request, "status required", 422);
  const validTransitions = {
    draft: ["sent", "void"],
    sent: ["paid", "void", "partially_paid"],
    partially_paid: ["paid", "void"],
    paid: ["void"],
    void: []
  };
  const allowed = validTransitions[inv.status] || [];
  if (!allowed.includes(newStatus)) {
    return err(request, `cannot transition from '${inv.status}' to '${newStatus}'`, 422, "invalid_transition");
  }
  if (newStatus === "void") {
    return await voidInvoice(request, env, p, id, b);
  }
  const updates = [`status = ?`];
  const binds = [newStatus];
  if (newStatus === "paid") {
    updates.push(`paid_at = datetime('now')`);
  }
  updates.push(`id = id`);
  await env.DB.prepare(
    `UPDATE invoices SET ${updates.join(", ")} WHERE id = ?`
  ).bind(...binds, id).run();
  return json(request, { ok: true, id, status: newStatus });
}
export async function voidReleaseSupported(env) {
  const row = await env.DB.prepare(
    "SELECT sql FROM sqlite_master WHERE type='trigger' AND name='trg_time_entries_locked_no_update'"
  ).first();
  return Boolean(row && /invoice_voids/.test(row.sql));
}
export async function voidInvoice(request, env, p, id, body = null) {
  if (!isAdmin(p)) return err(request, "admin only", 403);
  if (!await tableExists(env, "invoice_voids")) {
    return err(
      request,
      "voiding an invoice needs database migration 025 (POST /api/admin/apply-migration-025) — nothing was changed",
      409,
      "migration_required"
    );
  }
  if (!await voidReleaseSupported(env)) {
    return err(
      request,
      "voiding an invoice needs database migration 026 (POST /api/admin/apply-migration-026) — nothing was changed",
      409,
      "migration_required"
    );
  }
  const inv = await env.DB.prepare("SELECT * FROM invoices WHERE id = ?").bind(id).first();
  if (!inv) return err(request, "not found", 404);
  if (inv.status === "void") return err(request, "this invoice is already void", 409, "already_void");
  const b = body || await readJson(request);
  const reason = String(b && b.reason || "").trim();
  const entries = (await env.DB.prepare(
    "SELECT id, hours, rate_cents, is_billable FROM time_entries WHERE invoice_id = ?"
  ).bind(id).all()).results || [];
  const hoursReleased = Number(entries.reduce((s, e) => s + Number(e.hours || 0), 0).toFixed(2));
  const amountReleasedCents = entries.reduce((s, e) => e.is_billable ? s + Math.round(Number(e.hours || 0) * Number(e.rate_cents || 0)) : s, 0);
  const voidId = uuid();
  const snapshot = JSON.stringify({
    invoice: inv,
    released: {
      entries_released: entries.length,
      hours_released: hoursReleased,
      amount_released_cents: amountReleasedCents
    }
  });
  await env.DB.batch([
    env.DB.prepare("UPDATE invoices SET status = ? WHERE id = ?").bind("void", id),
    env.DB.prepare(
      `INSERT INTO invoice_voids
         (id,invoice_id,invoice_number,client_id,voided_by,voided_by_email,reason,
          hours_released,entries_released,amount_released_cents,snapshot)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      voidId,
      id,
      inv.invoice_number || "",
      inv.client_id || null,
      p.userId,
      p.email || "",
      reason,
      hoursReleased,
      entries.length,
      amountReleasedCents,
      snapshot
    ),
    env.DB.prepare(
      `UPDATE time_entries SET invoice_id = NULL, updated_at = datetime('now') WHERE invoice_id = ?`
    ).bind(id)
  ]);
  return json(request, {
    ok: true,
    id,
    invoice_id: id,
    invoice_number: inv.invoice_number,
    status: "void",
    hours_released: hoursReleased,
    entries_released: entries.length,
    amount_released_cents: amountReleasedCents,
    void_id: voidId
  });
}
export async function recordPayment(request, env, p, id) {
  if (!isAdmin(p)) return err(request, "admin only", 403);
  const inv = await env.DB.prepare("SELECT * FROM invoices WHERE id = ?").bind(id).first();
  if (!inv) return err(request, "not found", 404);
  if (inv.status === "void") return err(request, "cannot record payment on a voided invoice", 409, "void");
  if (inv.status === "draft") return err(request, "invoice must be sent before recording payments", 409, "not_sent");
  const b = await readJson(request);
  const amtCents = Number(b.amount_cents);
  if (!Number.isFinite(amtCents) || amtCents <= 0) return err(request, "amount_cents must be > 0", 422);
  const paymentId = uuid();
  const paidAt = b.paid_at || (/* @__PURE__ */ new Date()).toISOString();
  await env.DB.prepare(
    `INSERT INTO invoice_payments (id, invoice_id, amount_cents, payment_method, reference, paid_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(paymentId, id, amtCents, b.payment_method || "", b.reference || "", paidAt).run();
  const totalPaid = await env.DB.prepare(
    "SELECT COALESCE(SUM(amount_cents), 0) AS total FROM invoice_payments WHERE invoice_id = ?"
  ).bind(id).first();
  const paidTotal = totalPaid?.total || 0;
  let newStatus = inv.status;
  if (paidTotal >= inv.total_cents) {
    newStatus = "paid";
  } else if (paidTotal > 0 && inv.status !== "paid") {
    newStatus = "partially_paid";
  }
  await env.DB.prepare(
    `UPDATE invoices SET paid_amount_cents = ?, status = ?, paid_at = CASE WHEN ? >= total_cents THEN datetime('now') ELSE paid_at END WHERE id = ?`
  ).bind(paidTotal, newStatus, paidTotal, id).run();
  return json(request, {
    ok: true,
    payment: {
      id: paymentId,
      invoice_id: id,
      amount_cents: amtCents,
      payment_method: b.payment_method || "",
      reference: b.reference || "",
      paid_at: paidAt
    },
    invoice_status: newStatus,
    paid_amount_cents: paidTotal,
    total_cents: inv.total_cents
  }, 201);
}
export async function sendInvoice(request, env, p, id) {
  if (!isAdmin(p)) return err(request, "admin only", 403);
  const inv = await env.DB.prepare(
    `SELECT i.*, c.contact_email, c.contact_name, c.name AS client_name
       FROM invoices i JOIN clients c ON c.id = i.client_id WHERE i.id = ?`
  ).bind(id).first();
  if (!inv) return err(request, "not found", 404);
  if (inv.status !== "draft") return err(request, "only draft invoices can be sent", 409, "not_draft");
  const b = await readJson(request);
  const sentTo = b.recipient_email || b.sent_to || inv.contact_email || "";
  let emailResult = { sent: false, stubbed: true };
  if (sentTo) {
    const baseUrl = env && env.APP_BASE_URL || "";
    const invoiceUrl = baseUrl ? `${baseUrl}/api/invoices/${id}/html` : "";
    const totalFormatted = `$${centsToStr(inv.total_cents)}`;
    emailResult = await sendInvoiceEmail(env, {
      recipientEmail: sentTo,
      recipientName: inv.contact_name || "",
      invoiceNumber: inv.invoice_number,
      totalFormatted,
      dueDate: inv.due_date || null,
      periodStart: inv.period_start,
      periodEnd: inv.period_end,
      invoiceUrl
    });
  }
  await env.DB.prepare(
    `UPDATE invoices SET status = 'sent', sent_at = datetime('now'), sent_to = ? WHERE id = ?`
  ).bind(sentTo, id).run();
  return json(request, {
    ok: true,
    id,
    status: "sent",
    sent_at: (/* @__PURE__ */ new Date()).toISOString(),
    sent_to: sentTo,
    email_sent: emailResult.sent,
    email_stubbed: emailResult.stubbed || false,
    email_error: emailResult.error || null
  });
}
export async function paypalInvoice(request, env, p, id) {
  if (!isAdmin(p)) return err(request, "admin only", 403);
  const inv = await env.DB.prepare(
    `SELECT i.*, c.name AS client_name, c.contact_name, c.contact_email, c.paypal_email, c.currency AS client_currency
       FROM invoices i JOIN clients c ON c.id = i.client_id
      WHERE i.id = ?`
  ).bind(id).first();
  if (!inv) return err(request, "not found", 404);
  if (!inv.paypal_email) return err(request, "client has no paypal_email configured", 422, "no_paypal");
  const items = (await env.DB.prepare(
    "SELECT * FROM invoice_line_items WHERE invoice_id = ? ORDER BY hours DESC"
  ).bind(id).all()).results || [];
  const paypalPayload = {
    detail: {
      invoice_number: inv.invoice_number,
      invoice_date: (inv.created_at || (/* @__PURE__ */ new Date()).toISOString()).slice(0, 10),
      currency_code: inv.currency || inv.client_currency || "USD",
      note: inv.notes || "",
      payment_term: inv.due_date ? {
        term_type: "DUE_ON_DATE_SPECIFIED",
        due_date: inv.due_date
      } : { term_type: "NET_30" }
    },
    invoicer: {
      name: { given_name: "Your", surname: "Company" },
      email_address: env && env.PAYPAL_INVOICER_EMAIL || "billing@example.com"
    },
    primary_recipients: [{
      billing_info: {
        name: { given_name: inv.contact_name || inv.client_name || "" },
        email_address: inv.paypal_email
      }
    }],
    items: items.map((it) => ({
      name: it.description || "Service",
      quantity: it.hours > 0 ? String(it.hours) : "1",
      unit_amount: {
        currency_code: inv.currency || "USD",
        value: it.hours > 0 && it.rate_cents > 0 ? (it.rate_cents / 100).toFixed(2) : (it.amount_cents / 100).toFixed(2)
      },
      unit_of_measure: it.hours > 0 ? "HOURS" : "AMOUNT"
    })),
    amount: {
      currency_code: inv.currency || "USD",
      value: (inv.total_cents / 100).toFixed(2)
    }
  };
  const paypalConfigured = !!(env && env.PAYPAL_CLIENT_ID && env.PAYPAL_SECRET);
  if (!paypalConfigured) {
    return json(request, {
      ok: true,
      paypal_configured: false,
      message: "PayPal credentials not configured. Payload generated for manual use.",
      payload: paypalPayload
    });
  }
  try {
    const paypalBase = env.PAYPAL_SANDBOX === "true" || env.PAYPAL_SANDBOX === "1" ? "https://api-m.sandbox.paypal.com" : "https://api-m.paypal.com";
    const authRes = await fetch(`${paypalBase}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${btoa(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_SECRET}`)}`
      },
      body: "grant_type=client_credentials"
    });
    if (!authRes.ok) {
      const authErr = await authRes.text();
      return json(request, {
        ok: false,
        error: "PayPal auth failed",
        paypal_error: authErr,
        payload: paypalPayload
      }, 502);
    }
    const authData = await authRes.json();
    const accessToken = authData.access_token;
    const createRes = await fetch(`${paypalBase}/v2/invoicing/invoices`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`
      },
      body: JSON.stringify(paypalPayload)
    });
    const createData = await createRes.json();
    if (!createRes.ok) {
      return json(request, {
        ok: false,
        error: "PayPal invoice creation failed",
        paypal_error: createData,
        payload: paypalPayload
      }, 502);
    }
    const paypalInvoiceId = createData.id || (createData.href || "").split("/").pop() || "";
    return json(request, {
      ok: true,
      paypal_configured: true,
      paypal_invoice_id: paypalInvoiceId,
      paypal_response: createData,
      payload: paypalPayload
    }, 201);
  } catch (e) {
    return json(request, {
      ok: false,
      error: `PayPal API error: ${e.message}`,
      payload: paypalPayload
    }, 502);
  }
}
export async function exportInvoiceCsv(request, env, p, id) {
  const scope = invoiceReadScope(p, "i");
  const inv = await env.DB.prepare(
    `SELECT i.*, c.name AS client_name FROM invoices i JOIN clients c ON c.id = i.client_id
      WHERE i.id = ? AND ${scope.sql}`
  ).bind(id, ...scope.params).first();
  if (!inv) return err(request, "not found", 404);
  const items = (await env.DB.prepare(
    "SELECT * FROM invoice_line_items WHERE invoice_id = ? ORDER BY hours DESC"
  ).bind(id).all()).results || [];
  const clientView = isClient(p);
  const headers = clientView ? ["Description", "Hours", "Amount"] : ["Description", "Hours", "Rate", "Amount"];
  const rows = items.map((it) => {
    const base = [
      csvEscape(it.description),
      it.hours.toFixed(2)
    ];
    if (!clientView) base.push((it.rate_cents / 100).toFixed(2));
    base.push((it.amount_cents / 100).toFixed(2));
    return base.join(",");
  });
  const csv = [headers.join(","), ...rows].join("\n");
  const filename = `${inv.invoice_number || "invoice"}.csv`;
  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`
    }
  });
}
function csvEscape(val) {
  const s = String(val || "");
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
export async function invoiceHtml(request, env, p, id) {
  const nonceBytes = crypto.getRandomValues(new Uint8Array(16));
  const nonce = Array.from(nonceBytes, (b) => b.toString(16).padStart(2, "0")).join("");
  const scope = invoiceReadScope(p, "i");
  const inv = await env.DB.prepare(
    `SELECT i.*, c.name AS client_name, c.contact_name, c.contact_email, c.paypal_email, c.currency AS client_currency
       FROM invoices i JOIN clients c ON c.id = i.client_id
      WHERE i.id = ? AND ${scope.sql}`
  ).bind(id, ...scope.params).first();
  if (!inv) return err(request, "not found", 404);
  const items = (await env.DB.prepare(
    "SELECT * FROM invoice_line_items WHERE invoice_id = ? ORDER BY hours DESC"
  ).bind(id).all()).results || [];
  const payments = (await env.DB.prepare(
    "SELECT * FROM invoice_payments WHERE invoice_id = ? ORDER BY paid_at ASC"
  ).bind(id).all()).results || [];
  const esc = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  const fmtMoney = (cents) => {
    const sign = cents < 0 ? "-" : "";
    const a = Math.abs(cents);
    return `${sign}$${Math.floor(a / 100)}.${String(a % 100).padStart(2, "0")}`;
  };
  const clientView = isClient(p);
  const lineRows = items.map((it) => `
    <tr>
      <td>${esc(it.description)}</td>
      <td class="num">${it.hours > 0 ? it.hours.toFixed(2) : "-"}</td>
      ${clientView ? "" : `<td class="num">${it.rate_cents > 0 ? fmtMoney(it.rate_cents) + "/hr" : "-"}</td>`}
      <td class="num">${fmtMoney(it.amount_cents)}</td>
    </tr>
  `).join("");
  const paymentRows = payments.length > 0 ? payments.map((pm) => `
        <tr>
          <td>${esc(pm.paid_at?.slice(0, 10) || "")}</td>
          <td>${esc(pm.payment_method || "-")}</td>
          <td>${esc(pm.reference || "-")}</td>
          <td class="num">${fmtMoney(pm.amount_cents)}</td>
        </tr>
      `).join("") : "";
  const balanceDue = inv.total_cents - (inv.paid_amount_cents || 0);
  const statusLabel = inv.status.replace("_", " ").toUpperCase();
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Invoice ${esc(inv.invoice_number)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 14px; color: #1a1a1a; max-width: 800px; margin: 0 auto; padding: 40px 32px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 40px; }
  .company { font-size: 18px; font-weight: 700; color: #1a1a1a; }
  .company-sub { font-size: 12px; color: #666; margin-top: 4px; }
  .invoice-meta { text-align: right; }
  .invoice-number { font-size: 24px; font-weight: 700; color: #2563eb; }
  .meta-row { font-size: 12px; color: #666; margin-top: 2px; }
  .status-badge { display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
  .status-draft { background: #f3f4f6; color: #6b7280; }
  .status-sent { background: #dbeafe; color: #2563eb; }
  .status-paid { background: #dcfce7; color: #16a34a; }
  .status-void { background: #fee2e2; color: #dc2626; }
  .status-partially_paid { background: #fef3c7; color: #d97706; }
  .bill-to { margin-bottom: 30px; }
  .bill-to-label { font-size: 11px; font-weight: 700; text-transform: uppercase; color: #9ca3af; margin-bottom: 4px; }
  .bill-to-name { font-size: 16px; font-weight: 600; }
  .bill-to-detail { font-size: 13px; color: #666; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
  thead th { background: #f9fafb; text-align: left; padding: 10px 12px; font-size: 12px; font-weight: 600; color: #6b7280; border-bottom: 2px solid #e5e7eb; }
  tbody td { padding: 10px 12px; border-bottom: 1px solid #f3f4f6; font-size: 13px; }
  .num { text-align: right; }
  .totals { margin-top: 16px; display: flex; justify-content: flex-end; }
  .totals-table { width: 260px; }
  .totals-table td { padding: 6px 12px; font-size: 13px; }
  .totals-table .total-row td { font-weight: 700; font-size: 16px; border-top: 2px solid #1a1a1a; padding-top: 10px; }
  .totals-table .balance-row td { font-weight: 700; font-size: 16px; color: #2563eb; }
  .notes { margin-top: 30px; padding: 16px; background: #f9fafb; border-radius: 8px; font-size: 13px; color: #666; }
  .notes-label { font-weight: 600; color: #1a1a1a; margin-bottom: 4px; }
  .payments-section { margin-top: 24px; }
  .payments-section h3 { font-size: 14px; margin-bottom: 8px; }
  .print-bar { text-align: center; margin: 30px 0; }
  .print-bar button { background: #2563eb; color: #fff; border: none; border-radius: 6px; padding: 10px 24px; font-size: 14px; font-weight: 600; cursor: pointer; }
  .print-bar button:hover { background: #1d4ed8; }
  @media print {
    .print-bar { display: none; }
    body { padding: 20px; }
  }
</style>
</head>
<body>
  <div class="header">
    <div>
      <div class="company">Your Company</div>
      <div class="company-sub">billing@example.com</div>
    </div>
    <div class="invoice-meta">
      <div class="invoice-number">${esc(inv.invoice_number)}</div>
      <div class="meta-row">Date: ${esc(inv.created_at?.slice(0, 10) || "")}</div>
      ${inv.due_date ? `<div class="meta-row">Due: ${esc(inv.due_date)}</div>` : ""}
      <div class="meta-row">Period: ${esc(inv.period_start)} to ${esc(inv.period_end)}</div>
      <div style="margin-top:6px"><span class="status-badge status-${esc(inv.status)}">${statusLabel}</span></div>
    </div>
  </div>

  <div class="bill-to">
    <div class="bill-to-label">Bill To</div>
    <div class="bill-to-name">${esc(inv.client_name)}</div>
    ${inv.contact_name ? `<div class="bill-to-detail">${esc(inv.contact_name)}</div>` : ""}
    ${inv.contact_email ? `<div class="bill-to-detail">${esc(inv.contact_email)}</div>` : ""}
  </div>

  <table>
    <thead>
      <tr><th>Description</th><th class="num">Hours</th>${clientView ? "" : '<th class="num">Rate</th>'}<th class="num">Amount</th></tr>
    </thead>
    <tbody>
      ${lineRows}
    </tbody>
  </table>

  <div class="totals">
    <table class="totals-table">
      <tr><td>Subtotal</td><td class="num">${fmtMoney(inv.subtotal_cents)}</td></tr>
      <tr class="total-row"><td>Total</td><td class="num">${fmtMoney(inv.total_cents)}</td></tr>
      ${(inv.paid_amount_cents || 0) > 0 ? `<tr><td>Paid</td><td class="num">-${fmtMoney(inv.paid_amount_cents)}</td></tr>` : ""}
      ${balanceDue !== inv.total_cents ? `<tr class="balance-row"><td>Balance Due</td><td class="num">${fmtMoney(balanceDue)}</td></tr>` : ""}
    </table>
  </div>

  ${inv.notes ? `<div class="notes"><div class="notes-label">Notes</div>${esc(inv.notes)}</div>` : ""}

  ${paymentRows ? `
  <div class="payments-section">
    <h3>Payment History</h3>
    <table>
      <thead><tr><th>Date</th><th>Method</th><th>Reference</th><th class="num">Amount</th></tr></thead>
      <tbody>${paymentRows}</tbody>
    </table>
  </div>` : ""}

  <div class="print-bar">
    <button id="printBtn">Print / Save as PDF</button>
  </div>
  <script nonce="${nonce}">document.getElementById('printBtn').addEventListener('click',function(){window.print()})<\/script>
</body>
</html>`;
  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'`,
      "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
      "X-Frame-Options": "DENY",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer"
    }
  });
}
