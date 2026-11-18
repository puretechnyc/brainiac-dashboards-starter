import { json, err, readJson, uuid, isRealIsoDate } from "../util.js";
import { isValidColor, normalizeColor, pickUnusedColor } from "../colors.js";
import { isAdmin, isClient, isEmployee, isManager, clientReadScope, assignedClientScope, tableExists } from "../auth.js";
import { normalizeSlug, slugRejectionReason } from "../slugs.js";
import { effectiveBilling, loadBillingFacts } from "./billing-model.js";
import { fixedProjectTotalCents } from "../billing.js";
import { loadMilestones, milestonesOf, fixedProjectSummary } from "./fixed-project.js";
export const EMPLOYEE_CLIENT_FIELDS = ["id", "name", "archived", "color", "paused"];
async function attachPausedBy(env, rows) {
  const ids = [...new Set(rows.map((c) => c.paused_by).filter(Boolean))];
  if (!ids.length) return rows;
  const placeholders = ids.map(() => "?").join(",");
  const users = (await env.DB.prepare(
    `SELECT id, display_name, email FROM users WHERE id IN (${placeholders})`
  ).bind(...ids).all()).results || [];
  const byId = new Map(users.map((u) => [u.id, u.display_name || u.email || u.id]));
  return rows.map((c) => c.paused_by ? { ...c, paused_by_name: byId.get(c.paused_by) || c.paused_by } : c);
}
export function clientForEmployee(row) {
  if (!row) return row;
  const out = {};
  for (const k of EMPLOYEE_CLIENT_FIELDS) out[k] = row[k];
  return out;
}
function sanitizeClientForClient(row) {
  if (!row) return row;
  const {
    rate_cents,
    billing_model,
    weekly_rate_cents,
    monthly_retainer_cents,
    paypal_email,
    created_by,
    week_start_day,
    ...safe
  } = row;
  return safe;
}
export async function listClients(request, env, p, url) {
  const scope = isManager(p) ? await assignedClientScope(env, p, "c", "id") : clientReadScope(p, "c");
  const limit = Math.min(Math.max(1, parseInt(url && url.searchParams.get("limit") || "", 10) || 50), 200);
  const offset = Math.max(0, parseInt(url && url.searchParams.get("offset") || "", 10) || 0);
  const includeArchived = isAdmin(p) && url && url.searchParams.get("include_archived") === "1";
  const archivedClause = includeArchived ? "" : "AND c.archived = 0";
  const rows = await env.DB.prepare(
    `SELECT * FROM clients c WHERE ${scope.sql} ${archivedClause} ORDER BY c.name
     LIMIT ? OFFSET ?`
  ).bind(...scope.params, limit, offset).all();
  let clients = rows.results || [];
  if (isClient(p)) {
    clients = clients.map(sanitizeClientForClient);
  } else if (isEmployee(p)) {
    clients = clients.map(clientForEmployee);
  } else if (isAdmin(p)) {
    const facts = await loadBillingFacts(env, clients);
    const milestonesByClient = await loadMilestones(env);
    clients = clients.map((c) => {
      const f = facts.get(c.id);
      if (!f) return c;
      const ms = milestonesOf(milestonesByClient, c.id);
      const summary = fixedProjectSummary(ms);
      const isFixed = f.billing_model === "fixed_project";
      return {
        ...c,
        billing_model: f.billing_model,
        is_new_model: f.is_new_model,
        fixed_amount_cents: isFixed && summary.mode === "milestones" ? summary.milestone_total_cents : f.fixed_amount_cents,
        fixed_start: f.fixed_start,
        fixed_end: f.fixed_end,
        profit_pct: f.profit_pct,
        profit_base: f.profit_base,
        fixed_mode: isFixed ? summary.mode : null,
        milestone_count: isFixed ? summary.milestone_count : 0,
        milestone_pending_count: isFixed ? summary.milestone_pending_count : 0
      };
    });
    clients = await attachPausedBy(env, clients);
  }
  return json(request, { ok: true, clients, limit, offset });
}
export async function getClient(request, env, p, id) {
  const scope = isManager(p) ? await assignedClientScope(env, p, "c", "id") : clientReadScope(p, "c");
  const row = await env.DB.prepare(
    `SELECT * FROM clients c WHERE c.id = ? AND ${scope.sql}`
  ).bind(id, ...scope.params).first();
  if (!row) return err(request, "not found", 404);
  if (row.archived && !isAdmin(p)) return err(request, "not found", 404);
  const adminRow = isAdmin(p) ? (await attachPausedBy(env, [row]))[0] : row;
  const client = isClient(p) ? sanitizeClientForClient(row) : isEmployee(p) ? clientForEmployee(row) : adminRow;
  return json(request, { ok: true, client });
}
export const MAX_PROJECTS_PER_REQUEST = 100;
export const MAX_PROJECT_NAME = 120;
export function parseProjectNames(list) {
  if (list === void 0 || list === null) return { names: [] };
  if (!Array.isArray(list)) return { error: "projects must be a list of names" };
  if (list.length > MAX_PROJECTS_PER_REQUEST) return { error: `at most ${MAX_PROJECTS_PER_REQUEST} projects at a time` };
  const names = [];
  const seen = /* @__PURE__ */ new Set();
  for (const raw of list) {
    const n = (typeof raw === "string" ? raw : raw && raw.name || "").trim();
    if (!n) continue;
    if (n.length > MAX_PROJECT_NAME) return { error: `project name too long (max ${MAX_PROJECT_NAME} characters)` };
    const key = n.toLowerCase();
    if (seen.has(key)) return { error: `project "${n}" is listed twice` };
    seen.add(key);
    names.push(n);
  }
  return { names };
}
export async function createClient(request, env, p) {
  if (!isAdmin(p)) return err(request, "admin only", 403);
  const b = await readJson(request);
  if (!b.name || typeof b.name !== "string") return err(request, "name required", 422);
  const rate = Number.isFinite(b.rate_cents) ? Math.max(0, Math.round(b.rate_cents)) : 0;
  const cap = b.hours_cap == null ? null : Number(b.hours_cap);
  if (cap != null && (!Number.isFinite(cap) || cap < 0)) return err(request, "hours_cap invalid", 422);
  const weekStartDay = typeof b.week_start_day === "number" && b.week_start_day >= 0 && b.week_start_day <= 6 ? b.week_start_day : 1;
  const billingModel = ["hourly", "milestone_weekly", "monthly_retainer"].includes(b.billing_model) ? b.billing_model : "hourly";
  const weeklyRateCents = Number.isFinite(b.weekly_rate_cents) ? Math.max(0, Math.round(b.weekly_rate_cents)) : null;
  const monthlyRetainerCents = Number.isFinite(b.monthly_retainer_cents) ? Math.max(0, Math.round(b.monthly_retainer_cents)) : null;
  const autoSendReport = b.auto_send_report ? 1 : 0;
  if (b.color != null && b.color !== "" && !isValidColor(b.color)) return err(request, "color must be #RRGGBB", 422);
  let color = normalizeColor(b.color);
  let hasColorColumn = true;
  if (!color) {
    try {
      const used = (await env.DB.prepare("SELECT color FROM clients").all()).results || [];
      color = pickUnusedColor(used.map((r) => r.color));
    } catch {
      hasColorColumn = false;
    }
  }
  let slug = null;
  if (b.slug !== void 0 && b.slug !== null && b.slug !== "") {
    const reason = slugRejectionReason(b.slug);
    if (reason) return err(request, reason, 422);
    slug = normalizeSlug(b.slug);
    let hasSlugColumn = true;
    try {
      const clash = await env.DB.prepare("SELECT id FROM clients WHERE slug = ?").bind(slug).first();
      if (clash) return err(request, "that slug is already used by another client", 409, "slug_taken");
    } catch (e) {
      if (/no such column/i.test(String(e && e.message || e))) hasSlugColumn = false;
      else throw e;
    }
    if (!hasSlugColumn) {
      return err(request, "client slugs need database migration 018 (POST /api/admin/apply-migration-018)", 409, "migration_required");
    }
  }
  const parsed = parseProjectNames(b.projects);
  if (parsed.error) return err(request, parsed.error, 422);
  const id = uuid();
  const build = (withColor) => [
    env.DB.prepare(
      `INSERT INTO clients (id,name,rate_cents,hours_cap,contact_name,contact_email,paypal_email,currency,week_start_day,billing_model,weekly_rate_cents,monthly_retainer_cents,auto_send_report,created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      id,
      b.name.trim(),
      rate,
      cap,
      b.contact_name || "",
      b.contact_email || "",
      b.paypal_email || "",
      b.currency || "USD",
      weekStartDay,
      billingModel,
      weeklyRateCents,
      monthlyRetainerCents,
      autoSendReport,
      p.userId
    ),
    ...withColor && color ? [env.DB.prepare("UPDATE clients SET color = ? WHERE id = ?").bind(color, id)] : [],
    ...slug ? [env.DB.prepare("UPDATE clients SET slug = ? WHERE id = ?").bind(slug, id)] : [],
    ...parsed.names.map((n) => env.DB.prepare(
      "INSERT INTO projects (id, client_id, name, description, created_by) VALUES (?, ?, ?, ?, ?)"
    ).bind(uuid(), id, n, "", p.userId))
  ];
  try {
    try {
      await env.DB.batch(build(hasColorColumn));
    } catch (e) {
      if (hasColorColumn && /color/i.test(String(e && e.message || e)) && !/UNIQUE/i.test(String(e))) await env.DB.batch(build(false));
      else throw e;
    }
  } catch (e) {
    const msg = String(e && e.message || e);
    if (msg.includes("clients.slug")) return err(request, "that slug is already used by another client", 409, "slug_taken");
    if (msg.includes("UNIQUE")) return err(request, "client name already exists", 409);
    throw e;
  }
  const row = await env.DB.prepare("SELECT * FROM clients WHERE id = ?").bind(id).first();
  const projects = (await env.DB.prepare("SELECT id, name, client_id FROM projects WHERE client_id = ? ORDER BY name").bind(id).all()).results || [];
  return json(request, { ok: true, client: row, projects }, 201);
}
export async function updateClient(request, env, p, id) {
  if (!isAdmin(p)) return err(request, "admin only", 403);
  const b = await readJson(request);
  const cur = await env.DB.prepare("SELECT * FROM clients WHERE id = ?").bind(id).first();
  if (!cur) return err(request, "not found", 404);
  if (b.color !== void 0 && !isValidColor(b.color)) return err(request, "color must be #RRGGBB", 422);
  let paused = cur.paused ? 1 : 0;
  if (b.paused !== void 0) {
    if (typeof b.paused === "boolean") paused = b.paused ? 1 : 0;
    else if (b.paused === 0 || b.paused === 1) paused = b.paused;
    else return err(request, "paused must be true or false", 422);
  }
  const pauseFeeRequested = b.paused !== void 0;
  const pausedChanging = b.paused !== void 0 && paused !== (cur.paused ? 1 : 0);
  const freshPause = pausedChanging && paused === 1;
  if (pauseFeeRequested || freshPause) {
    const clientCols = ((await env.DB.prepare("PRAGMA table_info(clients)").all()).results || []).map((c) => c.name);
    if (pauseFeeRequested && !clientCols.includes("paused")) {
      return err(request, "pausing a client needs database migration 025 (POST /api/admin/apply-migration-025)", 409, "migration_required");
    }
    if (freshPause && (!clientCols.includes("paused_at") || !clientCols.includes("paused_by"))) {
      return err(request, "the client pause audit needs database migration 032 (POST /api/admin/apply-migration-032)", 409, "migration_required");
    }
  }
  const addParsed = parseProjectNames(b.add_projects);
  if (addParsed.error) return err(request, addParsed.error, 422);
  if (addParsed.names.length) {
    if (cur.archived && b.archived !== false) return err(request, "client is archived; restore it first", 409, "client_archived");
    const have = ((await env.DB.prepare("SELECT name FROM projects WHERE client_id = ?").bind(id).all()).results || []).map((r) => r.name.toLowerCase());
    const dup = addParsed.names.find((n) => have.includes(n.toLowerCase()));
    if (dup) return err(request, `a project named "${dup}" already exists for this client`, 409, "project_exists");
  }
  const next = {
    name: b.name ?? cur.name,
    rate_cents: Number.isFinite(b.rate_cents) ? Math.max(0, Math.round(b.rate_cents)) : cur.rate_cents,
    hours_cap: b.hours_cap === void 0 ? cur.hours_cap : b.hours_cap == null ? null : Number(b.hours_cap),
    contact_name: b.contact_name ?? cur.contact_name,
    contact_email: b.contact_email ?? cur.contact_email,
    paypal_email: b.paypal_email ?? cur.paypal_email,
    currency: b.currency ?? cur.currency,
    archived: b.archived === void 0 ? cur.archived : b.archived ? 1 : 0,
    week_start_day: typeof b.week_start_day === "number" && b.week_start_day >= 0 && b.week_start_day <= 6 ? b.week_start_day : cur.week_start_day ?? 1,
    billing_model: ["hourly", "milestone_weekly", "monthly_retainer"].includes(b.billing_model) ? b.billing_model : cur.billing_model || "hourly",
    weekly_rate_cents: b.weekly_rate_cents !== void 0 ? Number.isFinite(b.weekly_rate_cents) ? Math.max(0, Math.round(b.weekly_rate_cents)) : null : cur.weekly_rate_cents ?? null,
    monthly_retainer_cents: b.monthly_retainer_cents !== void 0 ? Number.isFinite(b.monthly_retainer_cents) ? Math.max(0, Math.round(b.monthly_retainer_cents)) : null : cur.monthly_retainer_cents ?? null,
    auto_send_report: b.auto_send_report !== void 0 ? b.auto_send_report ? 1 : 0 : cur.auto_send_report || 0
  };
  await env.DB.prepare(
    `UPDATE clients SET name=?,rate_cents=?,hours_cap=?,contact_name=?,contact_email=?,
       paypal_email=?,currency=?,archived=?,week_start_day=?,billing_model=?,weekly_rate_cents=?,monthly_retainer_cents=?,
       auto_send_report=?,updated_at=datetime('now') WHERE id=?`
  ).bind(
    next.name,
    next.rate_cents,
    next.hours_cap,
    next.contact_name,
    next.contact_email,
    next.paypal_email,
    next.currency,
    next.archived,
    next.week_start_day,
    next.billing_model,
    next.weekly_rate_cents,
    next.monthly_retainer_cents,
    next.auto_send_report,
    id
  ).run();
  if (pauseFeeRequested) {
    if (freshPause) {
      await env.DB.prepare(
        `UPDATE clients SET paused = ?, paused_at = datetime('now'), paused_by = ?,
           updated_at = datetime('now') WHERE id = ?`
      ).bind(paused, p.userId, id).run();
    } else {
      await env.DB.prepare(
        `UPDATE clients SET paused = ?, updated_at = datetime('now') WHERE id = ?`
      ).bind(paused, id).run();
    }
  }
  if (b.color !== void 0) {
    try {
      await env.DB.prepare("UPDATE clients SET color = ? WHERE id = ?").bind(normalizeColor(b.color), id).run();
    } catch {
      return err(request, "client colours need database migration 017 (POST /api/admin/apply-migration-017)", 409, "migration_required");
    }
  }
  if (b.slug !== void 0) {
    let slug = null;
    if (b.slug !== null && b.slug !== "") {
      const reason = slugRejectionReason(b.slug);
      if (reason) return err(request, reason, 422);
      slug = normalizeSlug(b.slug);
      try {
        const clash = await env.DB.prepare("SELECT id FROM clients WHERE slug = ? AND id <> ?").bind(slug, id).first();
        if (clash) return err(request, "that slug is already used by another client", 409, "slug_taken");
      } catch (e) {
        if (/no such column/i.test(String(e && e.message || e))) {
          return err(request, "client slugs need database migration 018 (POST /api/admin/apply-migration-018)", 409, "migration_required");
        }
        throw e;
      }
    }
    try {
      await env.DB.prepare("UPDATE clients SET slug = ? WHERE id = ?").bind(slug, id).run();
    } catch (e) {
      const msg = String(e && e.message || e);
      if (/no such column/i.test(msg)) {
        return err(request, "client slugs need database migration 018 (POST /api/admin/apply-migration-018)", 409, "migration_required");
      }
      if (msg.includes("clients.slug")) return err(request, "that slug is already used by another client", 409, "slug_taken");
      throw e;
    }
  }
  if (addParsed.names.length) {
    await env.DB.batch(addParsed.names.map((n) => env.DB.prepare(
      "INSERT INTO projects (id, client_id, name, description, created_by) VALUES (?, ?, ?, ?, ?)"
    ).bind(uuid(), id, n, "", p.userId)));
  }
  const row = await env.DB.prepare("SELECT * FROM clients WHERE id = ?").bind(id).first();
  return json(request, { ok: true, client: row });
}
export async function getClientBilling(request, env, p, id) {
  if (!isAdmin(p)) return err(request, "admin only", 403);
  const client = await env.DB.prepare("SELECT * FROM clients WHERE id = ?").bind(id).first();
  if (!client) return err(request, "not found", 404);
  const facts = await effectiveBilling(env, client);
  const byClient = await loadMilestones(env, [id]);
  const summary = fixedProjectSummary(milestonesOf(byClient, id));
  const isFixed = facts.billing_model === "fixed_project";
  return json(request, {
    ok: true,
    client_id: id,
    billing_model: facts.billing_model,
    is_new_model: facts.is_new_model,
    fixed_amount_cents: isFixed && summary.mode === "milestones" ? summary.milestone_total_cents : facts.fixed_amount_cents,
    fixed_start: facts.fixed_start,
    fixed_end: facts.fixed_end,
    profit_pct: facts.profit_pct,
    profit_base: facts.profit_base,
    weekly_rate_cents: client.weekly_rate_cents == null ? null : Number(client.weekly_rate_cents),
    monthly_retainer_cents: client.monthly_retainer_cents == null ? null : Number(client.monthly_retainer_cents),
    paused: facts.paused,
    fixed_mode: isFixed ? summary.mode : null,
    milestone_count: isFixed ? summary.milestone_count : 0,
    milestone_total_cents: isFixed ? summary.milestone_total_cents : null,
    milestone_pending_count: isFixed ? summary.milestone_pending_count : 0,
    milestone_late_count: isFixed ? summary.milestone_late_count : 0,
    next_release_date: isFixed ? summary.next_release_date : null
  });
}
export async function setClientBilling(request, env, p, id) {
  if (!isAdmin(p)) return err(request, "admin only", 403);
  const cur = await env.DB.prepare("SELECT * FROM clients WHERE id = ?").bind(id).first();
  if (!cur) return err(request, "not found", 404);
  const b = await readJson(request);
  const model = String(b.billing_model || "");
  const LEGACY = ["hourly", "milestone_weekly", "monthly_retainer"];
  const NEW = ["fixed_project", "profit_share"];
  if (!LEGACY.includes(model) && !NEW.includes(model)) {
    return err(request, `billing_model must be one of ${LEGACY.concat(NEW).join(", ")}`, 422);
  }
  const hasSideTable = await tableExists(env, "client_billing");
  if (NEW.includes(model) && !hasSideTable) {
    return err(request, "the new billing models need database migration 025 (POST /api/admin/apply-migration-025)", 409, "migration_required");
  }
  const side = hasSideTable ? await env.DB.prepare("SELECT * FROM client_billing WHERE client_id = ?").bind(id).first() : null;
  const byClient = await loadMilestones(env, [id]);
  const ms = milestonesOf(byClient, id);
  let fixedAmount = null;
  let fixedStart = null;
  let fixedEnd = null;
  let profitPct = null;
  let profitBase = null;
  if (model === "fixed_project") {
    if (ms.length) {
      const derived = fixedProjectTotalCents(ms);
      const sent = b.fixed_amount_cents;
      if (sent !== void 0 && sent !== null && Number(sent) !== derived) {
        return err(request, "a fixed project with milestones takes its amount from the milestones; change a milestone instead of the amount", 422);
      }
      fixedAmount = derived;
      const sentStart = b.fixed_start === void 0 || b.fixed_start === null ? null : String(b.fixed_start).trim();
      const sentEnd = b.fixed_end === void 0 || b.fixed_end === null ? null : String(b.fixed_end).trim();
      if (sentStart !== null && sentStart !== "") {
        if (!isRealIsoDate(sentStart)) return err(request, "fixed_start must be a real date, YYYY-MM-DD", 422);
        fixedStart = sentStart;
      } else {
        fixedStart = side && side.fixed_start ? side.fixed_start : null;
      }
      if (sentEnd !== null && sentEnd !== "") {
        if (!isRealIsoDate(sentEnd)) return err(request, "fixed_end must be a real date, YYYY-MM-DD", 422);
        fixedEnd = sentEnd;
      } else {
        fixedEnd = side && side.fixed_end ? side.fixed_end : null;
      }
      if (fixedStart && fixedEnd && String(fixedEnd) < String(fixedStart)) {
        return err(request, "fixed_end cannot be before fixed_start", 422);
      }
    } else {
      const amt = Number(b.fixed_amount_cents);
      if (!Number.isInteger(amt) || amt < 0) {
        return err(request, "fixed_amount_cents is required for a fixed project: a whole number of cents, 0 or more", 422);
      }
      if (!isRealIsoDate(String(b.fixed_start || ""))) {
        return err(request, "fixed_start is required for a fixed project: a real date, YYYY-MM-DD", 422);
      }
      if (!isRealIsoDate(String(b.fixed_end || ""))) {
        return err(request, "fixed_end is required for a fixed project: a real date, YYYY-MM-DD", 422);
      }
      if (String(b.fixed_end) < String(b.fixed_start)) {
        return err(request, "fixed_end cannot be before fixed_start", 422);
      }
      fixedAmount = amt;
      fixedStart = String(b.fixed_start);
      fixedEnd = String(b.fixed_end);
    }
  }
  if (model === "profit_share") {
    const pct = Number(b.profit_pct);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      return err(request, "profit_pct is required for a profit share: a number between 0 and 100", 422);
    }
    profitPct = pct;
    profitBase = b.profit_base === void 0 || b.profit_base === null ? null : String(b.profit_base).trim() || null;
  }
  const next = {
    billing_model: NEW.includes(model) ? model : null,
    fixed_amount_cents: model === "fixed_project" ? fixedAmount : side ? side.fixed_amount_cents : null,
    fixed_start: model === "fixed_project" ? fixedStart : side ? side.fixed_start : null,
    fixed_end: model === "fixed_project" ? fixedEnd : side ? side.fixed_end : null,
    profit_pct: model === "profit_share" ? profitPct : side ? side.profit_pct : null,
    profit_base: model === "profit_share" ? profitBase : side ? side.profit_base : null
  };
  if (LEGACY.includes(model)) {
    await env.DB.prepare(
      `UPDATE clients SET billing_model = ?, updated_at = datetime('now') WHERE id = ?`
    ).bind(model, id).run();
  }
  if (hasSideTable) {
    await env.DB.prepare(
      `INSERT INTO client_billing (client_id, billing_model, fixed_amount_cents, fixed_start, fixed_end, profit_pct, profit_base, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(client_id) DO UPDATE SET
         billing_model = excluded.billing_model,
         fixed_amount_cents = excluded.fixed_amount_cents,
         fixed_start = excluded.fixed_start,
         fixed_end = excluded.fixed_end,
         profit_pct = excluded.profit_pct,
         profit_base = excluded.profit_base,
         updated_by = excluded.updated_by,
         updated_at = excluded.updated_at`
    ).bind(
      id,
      next.billing_model,
      next.fixed_amount_cents,
      next.fixed_start,
      next.fixed_end,
      next.profit_pct,
      next.profit_base,
      p.userId
    ).run();
  }
  const client = await env.DB.prepare("SELECT * FROM clients WHERE id = ?").bind(id).first();
  const facts = await effectiveBilling(env, client);
  const after = await loadMilestones(env, [id]);
  const summary = fixedProjectSummary(milestonesOf(after, id));
  const isFixed = facts.billing_model === "fixed_project";
  return json(request, {
    ok: true,
    client_id: id,
    billing_model: facts.billing_model,
    is_new_model: facts.is_new_model,
    fixed_amount_cents: isFixed && summary.mode === "milestones" ? summary.milestone_total_cents : facts.fixed_amount_cents,
    fixed_start: facts.fixed_start,
    fixed_end: facts.fixed_end,
    profit_pct: facts.profit_pct,
    profit_base: facts.profit_base,
    weekly_rate_cents: client.weekly_rate_cents == null ? null : Number(client.weekly_rate_cents),
    monthly_retainer_cents: client.monthly_retainer_cents == null ? null : Number(client.monthly_retainer_cents),
    paused: facts.paused,
    fixed_mode: isFixed ? summary.mode : null,
    milestone_count: isFixed ? summary.milestone_count : 0,
    milestone_total_cents: isFixed ? summary.milestone_total_cents : null,
    milestone_pending_count: isFixed ? summary.milestone_pending_count : 0,
    milestone_late_count: isFixed ? summary.milestone_late_count : 0,
    next_release_date: isFixed ? summary.next_release_date : null
  });
}
