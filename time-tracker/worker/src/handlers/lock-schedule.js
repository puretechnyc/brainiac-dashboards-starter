import { json, err, readJson, isIsoDate } from "../util.js";
import { isAdmin } from "../auth.js";
export const LOCK_CADENCES = ["off", "weekly", "biweekly", "monthly"];
export const LOCK_TIMEZONE = "America/New_York";
export const DEFAULT_LOCK_SCHEDULE = {
  cadence: "weekly",
  weekday: 0,
  time: "23:59",
  timezone: LOCK_TIMEZONE
};
const K_SCHEDULE = "lock_schedule";
const K_THROUGH = "locked_through";
const K_LAST_RUN = "lock_last_run_at";
const K_SET_AT = "lock_schedule_set_at";
const K_ANCHOR = "lock_schedule_anchor";
export const SCHEDULED_LOCK_MSG = "locked by the schedule, ask an admin to change";
const DOW = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
export function zoneParts(date, tz) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    weekday: "short"
  }).formatToParts(date);
  const v = (t) => (parts.find((p) => p.type === t) || {}).value;
  const y = Number(v("year"));
  const m = Number(v("month"));
  const d = Number(v("day"));
  return {
    y,
    m,
    d,
    hh: Number(v("hour")) % 24,
    mi: Number(v("minute")),
    ss: Number(v("second")),
    wd: DOW[v("weekday")],
    date: `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`
  };
}
export function zoneOffsetMinutes(date, tz) {
  const p = zoneParts(date, tz);
  const asUTC = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mi, p.ss);
  const whole = Math.floor(date.getTime() / 1e3) * 1e3;
  return Math.round((asUTC - whole) / 6e4);
}
export function zoneInstant(y, m, d, hh, mi, tz) {
  const guess = Date.UTC(y, m - 1, d, hh, mi, 0);
  const off1 = zoneOffsetMinutes(new Date(guess), tz);
  let t = guess - off1 * 6e4;
  const off2 = zoneOffsetMinutes(new Date(t), tz);
  if (off2 !== off1) t = guess - off2 * 6e4;
  return new Date(t);
}
function dateMs(iso) {
  const [y, m, d] = String(iso).split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}
function msDate(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
function msDow(ms) {
  return new Date(ms).getUTCDay();
}
function lastDayOfMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
function mondayOf(iso) {
  const ms = dateMs(iso);
  const wd = msDow(ms);
  const back = wd === 0 ? 6 : wd - 1;
  return ms - back * 864e5;
}
function schedClock(sched) {
  const [hh, mi] = String(sched.time || "23:59").split(":").map(Number);
  return { hh: Number.isFinite(hh) ? hh : 23, mi: Number.isFinite(mi) ? mi : 59 };
}
function occurrenceAt(dateIso, sched) {
  const { hh, mi } = schedClock(sched);
  const [y, m, d] = dateIso.split("-").map(Number);
  return { date: dateIso, instant: zoneInstant(y, m, d, hh, mi, sched.timezone) };
}
export function occurrences(sched, now = /* @__PURE__ */ new Date()) {
  if (!sched || sched.cadence === "off") return { prev: null, next: null };
  const tz = sched.timezone || LOCK_TIMEZONE;
  const s = { ...sched, timezone: tz };
  const { hh, mi } = schedClock(s);
  const np = zoneParts(now, tz);
  const nowClock = np.hh * 60 + np.mi;
  if (s.cadence === "monthly") {
    let y = np.y;
    let m = np.m;
    let day = lastDayOfMonth(y, m);
    let cand2 = `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const today = np.date;
    if (cand2 > today || cand2 === today && nowClock < hh * 60 + mi) {
      m -= 1;
      if (m < 1) {
        m = 12;
        y -= 1;
      }
      day = lastDayOfMonth(y, m);
      cand2 = `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
    let ny = y;
    let nm = m + 1;
    if (nm > 12) {
      nm = 1;
      ny += 1;
    }
    const nextCand = `${ny}-${String(nm).padStart(2, "0")}-${String(lastDayOfMonth(ny, nm)).padStart(2, "0")}`;
    return { prev: occurrenceAt(cand2, s), next: occurrenceAt(nextCand, s) };
  }
  const todayMs = dateMs(np.date);
  const back = (msDow(todayMs) - Number(s.weekday || 0) + 7) % 7;
  let candMs = todayMs - back * 864e5;
  let cand = msDate(candMs);
  if (cand === np.date && nowClock < hh * 60 + mi) {
    candMs -= 7 * 864e5;
    cand = msDate(candMs);
  }
  if (s.cadence === "biweekly" && s.anchor) {
    const anchor = mondayOf(s.anchor);
    const weeks = Math.round((mondayOf(cand) - anchor) / (7 * 864e5));
    if (weeks % 2 !== 0) {
      candMs -= 7 * 864e5;
      cand = msDate(candMs);
    }
  }
  const nextMs = candMs + (s.cadence === "biweekly" ? 14 : 7) * 864e5;
  return { prev: occurrenceAt(cand, s), next: occurrenceAt(msDate(nextMs), s) };
}
async function readSetting(env, key) {
  try {
    const row = await env.DB.prepare("SELECT value FROM app_settings WHERE key = ?").bind(key).first();
    return row ? row.value : null;
  } catch (e) {
    if (/no such table/i.test(String(e && e.message || e))) return null;
    throw e;
  }
}
async function writeSetting(env, key, value, updatedBy) {
  await env.DB.prepare(
    `INSERT INTO app_settings (key, value, updated_by, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value,
                                    updated_by = excluded.updated_by,
                                    updated_at = datetime('now')`
  ).bind(key, String(value), updatedBy || null).run();
}
export function parseSchedule(raw) {
  const s = { ...DEFAULT_LOCK_SCHEDULE };
  if (raw) {
    try {
      const v = JSON.parse(raw);
      if (v && typeof v === "object") {
        if (LOCK_CADENCES.includes(v.cadence)) s.cadence = v.cadence;
        if (Number.isInteger(v.weekday) && v.weekday >= 0 && v.weekday <= 6) s.weekday = v.weekday;
        if (typeof v.time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v.time)) s.time = v.time;
        if (typeof v.timezone === "string" && v.timezone) s.timezone = v.timezone;
      }
    } catch (e) {
    }
  }
  return s;
}
export function nextLockOccurrence(sched, setAt, lastRun) {
  const base = [setAt, lastRun].filter(Boolean).sort().pop();
  if (!base) return null;
  const after = occurrences(sched, new Date(base)).next;
  return after || null;
}
export async function readScheduleState(env) {
  const raw = await readSetting(env, K_SCHEDULE);
  const sched = parseSchedule(raw);
  const anchor = await readSetting(env, K_ANCHOR);
  if (anchor) sched.anchor = anchor;
  const through = await readSetting(env, K_THROUGH);
  const lastRun = await readSetting(env, K_LAST_RUN);
  const setAt = await readSetting(env, K_SET_AT);
  const next = nextLockOccurrence(sched, setAt, lastRun);
  return {
    cadence: sched.cadence,
    weekday: sched.weekday,
    time: sched.time,
    timezone: sched.timezone,
    enabled: sched.cadence !== "off",
    armed: Boolean(setAt),
    locked_through: through || null,
    last_locked_at: lastRun || null,
    set_at: setAt || null,
    next_lock_at: next ? next.instant.toISOString() : null,
    next_lock_date: next ? next.date : null
  };
}
export async function readLockedThrough(env) {
  const v = await readSetting(env, K_THROUGH);
  return v && isIsoDate(v) ? v : null;
}
export function effectiveLock(entry, tsStatus, lockedThrough) {
  const approved = entry.locked === 1 || entry.approval_status === "approved" || tsStatus === "approved";
  const scheduled = Boolean(
    lockedThrough && entry && entry.entry_date && String(entry.entry_date) <= String(lockedThrough)
  );
  return {
    locked: Boolean(approved || scheduled),
    approved,
    scheduled,
    kind: approved ? "approved" : scheduled ? "scheduled" : null
  };
}
export function weekLocked(weekStart, lockedThrough) {
  if (!lockedThrough || !weekStart) return false;
  const end = msDate(dateMs(weekStart) + 6 * 864e5);
  return end <= String(lockedThrough);
}
export async function lockEntriesThrough(env, throughDate, actorId, source) {
  const entries = await env.DB.prepare(
    `UPDATE time_entries
        SET locked = 1,
            approval_status = 'approved',
            approved_by = ?,
            approved_at = datetime('now'),
            updated_at = datetime('now')
      WHERE entry_date <= ? AND locked = 0`
  ).bind(actorId || null, throughDate).run();
  const sheets = await env.DB.prepare(
    `UPDATE timesheets
        SET status = 'approved',
            approved_by = ?,
            approved_at = datetime('now'),
            updated_at = datetime('now')
      WHERE week_start <= date(?, '-6 days')
        AND status IN ('open', 'submitted')`
  ).bind(actorId || null, throughDate).run();
  const lockedEntries = Number(entries && entries.meta && entries.meta.changes || 0);
  const lockedSheets = Number(sheets && sheets.meta && sheets.meta.changes || 0);
  let audited = true;
  try {
    await env.DB.prepare(
      `INSERT INTO lock_runs (through_date, entries_locked, timesheets_locked, source, ran_at, ran_by)
       VALUES (?, ?, ?, ?, datetime('now'), ?)`
    ).bind(throughDate, lockedEntries, lockedSheets, source || "manual", actorId || null).run();
  } catch (e) {
    if (!/no such table/i.test(String(e && e.message || e))) throw e;
    audited = false;
  }
  return {
    through_date: throughDate,
    entries_locked: lockedEntries,
    timesheets_locked: lockedSheets,
    audited
  };
}
export async function getLockSchedule(request, env, p) {
  if (!isAdmin(p)) return err(request, "admin only", 403);
  const state = await readScheduleState(env);
  let runs = [];
  try {
    runs = (await env.DB.prepare(
      `SELECT through_date, entries_locked, timesheets_locked, source, ran_at
         FROM lock_runs ORDER BY id DESC LIMIT 10`
    ).all()).results || [];
  } catch (e) {
    if (!/no such table/i.test(String(e && e.message || e))) throw e;
    runs = [];
  }
  return json(request, { ok: true, ...state, runs });
}
export async function putLockSchedule(request, env, p) {
  if (!isAdmin(p)) return err(request, "admin only", 403);
  const b = await readJson(request);
  const cadence = String(b.cadence || "").trim();
  if (!LOCK_CADENCES.includes(cadence)) {
    return err(request, `cadence must be one of ${LOCK_CADENCES.join(", ")}`, 422, "bad_cadence");
  }
  let weekday = b.weekday === void 0 || b.weekday === null ? DEFAULT_LOCK_SCHEDULE.weekday : Number(b.weekday);
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
    return err(request, "weekday must be 0 (Sunday) to 6 (Saturday)", 422, "bad_weekday");
  }
  const time = String(b.time === void 0 || b.time === null ? DEFAULT_LOCK_SCHEDULE.time : b.time).trim();
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    return err(request, "time must be HH:MM (24-hour)", 422, "bad_time");
  }
  const timezone = String(b.timezone || LOCK_TIMEZONE).trim();
  if (timezone !== LOCK_TIMEZONE) {
    return err(request, `the lock schedule runs in ${LOCK_TIMEZONE}`, 422, "bad_timezone");
  }
  const sched = { cadence, weekday, time, timezone };
  try {
    await writeSetting(env, K_SCHEDULE, JSON.stringify(sched), p.userId);
    await writeSetting(env, K_SET_AT, (/* @__PURE__ */ new Date()).toISOString(), p.userId);
    await writeSetting(env, K_ANCHOR, msDate(mondayOf(zoneParts(/* @__PURE__ */ new Date(), timezone).date)), p.userId);
  } catch (e) {
    if (/no such table/i.test(String(e && e.message || e))) {
      return err(request, "the lock schedule needs database migration 020 (POST /api/admin/apply-migration-020)", 409, "migration_needed");
    }
    throw e;
  }
  const state = await readScheduleState(env);
  return json(request, { ok: true, ...state });
}
export async function runLockSchedule(env, nowMs) {
  const now = nowMs ? new Date(nowMs) : /* @__PURE__ */ new Date();
  const raw = await readSetting(env, K_SCHEDULE);
  const sched = parseSchedule(raw);
  const anchor = await readSetting(env, K_ANCHOR);
  if (anchor) sched.anchor = anchor;
  if (sched.cadence === "off") return { ok: true, skipped: "off" };
  const setAt = await readSetting(env, K_SET_AT);
  if (!setAt) return { ok: true, skipped: "not_armed" };
  const occ = occurrences(sched, now);
  if (!occ.prev) return { ok: true, skipped: "no_occurrence" };
  const prevInstant = occ.prev.instant.getTime();
  if (prevInstant <= new Date(setAt).getTime()) {
    return { ok: true, skipped: "before_first_occurrence", next: occ.next ? occ.next.instant.toISOString() : null };
  }
  const lastRun = await readSetting(env, K_LAST_RUN);
  if (lastRun && prevInstant <= new Date(lastRun).getTime()) {
    return { ok: true, skipped: "already_locked", locked_through: await readLockedThrough(env) };
  }
  try {
    await env.DB.prepare("SELECT 1 FROM lock_runs LIMIT 1").first();
  } catch (e) {
    if (/no such table/i.test(String(e && e.message || e))) {
      return { ok: true, skipped: "migration_required" };
    }
    throw e;
  }
  await writeSetting(env, K_THROUGH, occ.prev.date, null);
  await writeSetting(env, K_LAST_RUN, occ.prev.instant.toISOString(), null);
  await env.DB.prepare(
    `INSERT INTO lock_runs (through_date, entries_locked, timesheets_locked, source, ran_at, ran_by)
     VALUES (?, 0, 0, 'schedule', ?, NULL)`
  ).bind(occ.prev.date, occ.prev.instant.toISOString()).run();
  return {
    ok: true,
    locked_through: occ.prev.date,
    last_locked_at: occ.prev.instant.toISOString(),
    next_lock_at: occ.next ? occ.next.instant.toISOString() : null
  };
}
