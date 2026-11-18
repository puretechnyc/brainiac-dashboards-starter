import { json, err, readJson, uuid, isRealIsoDate } from "../util.js";
import { isAdmin, tableExists } from "../auth.js";
import { fixedProjectTotalCents, milestoneState } from "../billing.js";
export const MILESTONES_TABLE = "client_project_milestones";
export const MAX_MILESTONE_LABEL = 120;
export const MAX_MILESTONE_CENTS = 1e8;
export const FIXED_MODE_MILESTONES = "milestones";
export const FIXED_MODE_WINDOW = "window";
export async function loadMilestones(env, clientIds = null) {
  const byClient = /* @__PURE__ */ new Map();
  let rows = [];
  const sql = clientIds && clientIds.length ? `SELECT * FROM ${MILESTONES_TABLE} WHERE client_id IN (${clientIds.map(() => "?").join(",")})
         ORDER BY client_id, release_date, created_at` : `SELECT * FROM ${MILESTONES_TABLE} ORDER BY client_id, release_date, created_at`;
  try {
    rows = (await env.DB.prepare(sql).bind(...clientIds || []).all()).results || [];
  } catch (e) {
    if (!/no such table/i.test(String(e && e.message || e))) throw e;
    return byClient;
  }
  for (const r of rows) {
    if (!byClient.has(r.client_id)) byClient.set(r.client_id, []);
    byClient.get(r.client_id).push(r);
  }
  return byClient;
}
export function milestonesOf(byClient, clientId) {
  return byClient && byClient.get(clientId) || [];
}
export function fixedProjectMode(milestones) {
  return milestones && milestones.length ? FIXED_MODE_MILESTONES : FIXED_MODE_WINDOW;
}
export function fixedProjectMilestoneCents(milestones) {
  return fixedProjectTotalCents(milestones || []);
}
export function fixedProjectSummary(milestones) {
  const list = milestones || [];
  const total = fixedProjectTotalCents(list);
  let pending = 0;
  let late = 0;
  let next = null;
  for (const m of list) {
    const st = milestoneState(m);
    if (st === "pending") pending += 1;
    if (st === "late") late += 1;
    if (!next || String(m.release_date) < String(next)) next = m.release_date;
  }
  return {
    mode: fixedProjectMode(list),
    milestone_count: list.length,
    milestone_total_cents: total,
    milestone_pending_count: pending,
    milestone_late_count: late,
    next_release_date: next
  };
}
export function milestoneView(m) {
  return {
    id: m.id,
    client_id: m.client_id,
    label: m.label || "",
    amount_cents: Number(m.amount_cents || 0),
    release_date: m.release_date,
    released: Number(m.released || 0),
    landed_date: m.landed_date || null,
    state: milestoneState(m),
    created_at: m.created_at || null,
    updated_at: m.updated_at || null
  };
}
export async function syncFixedAmount(env, clientId) {
  const byClient = await loadMilestones(env, [clientId]);
  const list = milestonesOf(byClient, clientId);
  const total = fixedProjectTotalCents(list);
  const hasSideTable = await tableExists(env, "client_billing");
  if (!hasSideTable) return null;
  const side = await env.DB.prepare("SELECT billing_model FROM client_billing WHERE client_id = ?").bind(clientId).first();
  if (!side || side.billing_model !== "fixed_project") return null;
  await env.DB.prepare(
    `UPDATE client_billing SET fixed_amount_cents = ?, updated_at = datetime('now') WHERE client_id = ?`
  ).bind(total, clientId).run();
  return total;
}
async function requireMilestonesTable(env) {
  return tableExists(env, MILESTONES_TABLE);
}
export async function createMilestone(request, env, p, clientId) {
  if (!isAdmin(p)) return err(request, "admin only", 403);
  if (!await requireMilestonesTable(env)) {
    return err(request, "milestones need database migration 036 (POST /api/admin/apply-migration-036)", 409, "migration_required");
  }
  const client = await env.DB.prepare("SELECT id, name, archived FROM clients WHERE id = ?").bind(clientId).first();
  if (!client) return err(request, "not found", 404);
  if (client.archived) return err(request, "client is archived; restore it first", 409, "client_archived");
  const b = await readJson(request);
  const parsed = parseMilestoneBody(b, null);
  if (parsed.error) return err(request, parsed.error, 422);
  const id = uuid();
  await env.DB.prepare(
    `INSERT INTO ${MILESTONES_TABLE}
       (id, client_id, label, amount_cents, release_date, released, landed_date, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id,
    clientId,
    parsed.label,
    parsed.amount_cents,
    parsed.release_date,
    parsed.released,
    parsed.landed_date,
    p.userId
  ).run();
  const total = await syncFixedAmount(env, clientId);
  const row = await env.DB.prepare(`SELECT * FROM ${MILESTONES_TABLE} WHERE id = ?`).bind(id).first();
  return json(request, {
    ok: true,
    milestone: milestoneView(row),
    client_id: clientId,
    fixed_amount_cents: total
  }, 201);
}
export async function updateMilestone(request, env, p, clientId, milestoneId) {
  if (!isAdmin(p)) return err(request, "admin only", 403);
  if (!await requireMilestonesTable(env)) {
    return err(request, "milestones need database migration 036 (POST /api/admin/apply-migration-036)", 409, "migration_required");
  }
  const cur = await env.DB.prepare(`SELECT * FROM ${MILESTONES_TABLE} WHERE id = ?`).bind(milestoneId).first();
  if (!cur || cur.client_id !== clientId) return err(request, "milestone not found", 404);
  const b = await readJson(request);
  const parsed = parseMilestoneBody(b, cur);
  if (parsed.error) return err(request, parsed.error, 422);
  await env.DB.prepare(
    `UPDATE ${MILESTONES_TABLE}
        SET label = ?, amount_cents = ?, release_date = ?, released = ?, landed_date = ?,
            updated_at = datetime('now')
      WHERE id = ?`
  ).bind(
    parsed.label,
    parsed.amount_cents,
    parsed.release_date,
    parsed.released,
    parsed.landed_date,
    milestoneId
  ).run();
  const total = await syncFixedAmount(env, clientId);
  const row = await env.DB.prepare(`SELECT * FROM ${MILESTONES_TABLE} WHERE id = ?`).bind(milestoneId).first();
  return json(request, {
    ok: true,
    milestone: milestoneView(row),
    client_id: clientId,
    fixed_amount_cents: total
  });
}
export async function deleteMilestone(request, env, p, clientId, milestoneId) {
  if (!isAdmin(p)) return err(request, "admin only", 403);
  if (!await requireMilestonesTable(env)) {
    return err(request, "milestones need database migration 036 (POST /api/admin/apply-migration-036)", 409, "migration_required");
  }
  const cur = await env.DB.prepare(`SELECT * FROM ${MILESTONES_TABLE} WHERE id = ?`).bind(milestoneId).first();
  if (!cur || cur.client_id !== clientId) return err(request, "milestone not found", 404);
  await env.DB.prepare(`DELETE FROM ${MILESTONES_TABLE} WHERE id = ?`).bind(milestoneId).run();
  const total = await syncFixedAmount(env, clientId);
  return json(request, { ok: true, deleted_id: milestoneId, client_id: clientId, fixed_amount_cents: total });
}
export async function listMilestones(request, env, p, clientId) {
  if (!isAdmin(p)) return err(request, "admin only", 403);
  const client = await env.DB.prepare("SELECT id, name FROM clients WHERE id = ?").bind(clientId).first();
  if (!client) return err(request, "not found", 404);
  const byClient = await loadMilestones(env, [clientId]);
  const list = milestonesOf(byClient, clientId);
  const summary = fixedProjectSummary(list);
  return json(request, {
    ok: true,
    client_id: clientId,
    client_name: client.name,
    milestones: list.map(milestoneView),
    ...summary
  });
}
export function parseMilestoneBody(b, cur) {
  const out = {
    label: "",
    amount_cents: 0,
    release_date: "",
    released: 0,
    landed_date: null
  };
  if (cur) {
    out.label = cur.label || "";
    out.amount_cents = Number(cur.amount_cents || 0);
    out.release_date = cur.release_date;
    out.released = Number(cur.released || 0);
    out.landed_date = cur.landed_date || null;
  }
  if (b.label !== void 0 && b.label !== null) {
    const label = String(b.label).trim();
    if (label.length > MAX_MILESTONE_LABEL) {
      return { error: `label is too long (max ${MAX_MILESTONE_LABEL} characters)` };
    }
    out.label = label;
  }
  if (b.amount_cents !== void 0 && b.amount_cents !== null) {
    const amt = Number(b.amount_cents);
    if (!Number.isInteger(amt) || amt < 0) {
      return { error: "amount_cents must be a whole number of cents, 0 or more" };
    }
    if (amt > MAX_MILESTONE_CENTS) {
      return { error: `amount_cents is too large (max ${MAX_MILESTONE_CENTS})` };
    }
    out.amount_cents = amt;
  } else if (!cur) {
    return { error: "amount_cents is required: a whole number of cents, 0 or more" };
  }
  if (b.release_date !== void 0 && b.release_date !== null) {
    const d = String(b.release_date).trim();
    if (!isRealIsoDate(d)) {
      return { error: "release_date must be a real date, YYYY-MM-DD" };
    }
    out.release_date = d;
  } else if (!cur) {
    return { error: "release_date is required: a real date, YYYY-MM-DD" };
  }
  if (b.released !== void 0 && b.released !== null) {
    const flag = Number(b.released);
    if (flag !== 0 && flag !== 1) {
      return { error: "released must be 0 (pending) or 1 (the funds landed)" };
    }
    out.released = flag;
  }
  if (b.landed_date !== void 0) {
    const raw = b.landed_date;
    if (raw === null || raw === "") {
      out.landed_date = null;
    } else {
      const d = String(raw).trim();
      if (!isRealIsoDate(d)) {
        return { error: "landed_date must be a real date, YYYY-MM-DD" };
      }
      out.landed_date = d;
    }
  }
  if (!out.released && out.landed_date) {
    return { error: 'landed_date only applies to a released milestone — tick "released" first' };
  }
  return out;
}
