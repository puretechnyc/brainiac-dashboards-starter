(function() {
  "use strict";
  if (!window.APP_VP || typeof window.APP_VP.register !== "function") return;
  const API = (window.APP_API_BASE || "").replace(/\/$/, "");
  const TOKEN_KEY = "tt_token";
  const ic = (n) => typeof window.ic === "function" ? window.ic(n) : "";
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const ET_FMT = (iso) => {
    if (!iso) return null;
    const d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true
    }).formatToParts(d);
    const v = (t) => (parts.find((x) => x.type === t) || {}).value;
    if (!v("weekday")) return null;
    return `${v("weekday")}, ${v("month")} ${v("day")}, ${v("hour")}:${v("minute")} ${v("dayPeriod")} ET`;
  };
  const CADENCES = [
    ["weekly", "Every week"],
    ["biweekly", "Every 2 weeks"],
    ["monthly", "Monthly (last day)"],
    ["off", "Off"]
  ];
  const DAYS = [
    ["0", "Sunday"],
    ["1", "Monday"],
    ["2", "Tuesday"],
    ["3", "Wednesday"],
    ["4", "Thursday"],
    ["5", "Friday"],
    ["6", "Saturday"]
  ];
  async function api(path, opts) {
    const headers = { "Content-Type": "application/json" };
    let t = null;
    try {
      t = localStorage.getItem(TOKEN_KEY);
    } catch (e) {
    }
    if (t) headers.Authorization = "Bearer " + t;
    const res = await fetch(API + "/api" + path, Object.assign({ headers }, opts || {}));
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const e = new Error(data.error || "HTTP " + res.status);
      e.status = res.status;
      e.code = data.code || null;
      throw e;
    }
    return data;
  }
  const getJson = (p) => api(p);
  const postJson = (p, body) => api(p, { method: "POST", body: JSON.stringify(body) });
  const putJson = (p, body) => api(p, { method: "PUT", body: JSON.stringify(body) });
  const STYLE_ID = "vp-lock-settings-style";
  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement("style");
    s.id = STYLE_ID;
    s.textContent = `
      .vp-fa .vp-fa-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:14px;align-items:start}
      .vp-fa .vp-fa-card{background:var(--surface);border:1px solid var(--line);border-radius:var(--r);box-shadow:var(--shadow);min-width:0}
      .vp-fa .vp-fa-h{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:16px 18px;border-bottom:1px solid var(--line)}
      .vp-fa .vp-fa-h h3{margin:0;font-size:14.5px;font-weight:650}
      .vp-fa .vp-fa-b{padding:16px 18px}
      .vp-fa .vp-fa-row{display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;margin-bottom:12px}
      .vp-fa .vp-fa-row .field{flex:1;min-width:120px}
      .vp-fa .vp-fa-note{color:var(--muted);font-size:12.5px;line-height:1.55;margin:0 0 12px}
      .vp-fa .vp-list{list-style:none;margin:0;padding:0}
      .vp-fa .vp-list li{display:flex;justify-content:space-between;gap:12px;align-items:center;padding:9px 0;border-bottom:1px solid var(--line);font-size:13px}
      .vp-fa .vp-list li:last-child{border-bottom:0}
      .vp-fa .vp-list .nm{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .vp-fa .vp-list .nm small{display:block;color:var(--muted);font-size:11.5px}
      .vp-fa .vp-list .vl{font-variant-numeric:tabular-nums;font-weight:600;white-space:nowrap}
      .vp-fa .vp-err{color:var(--bad);font-size:12.5px;margin-top:8px}
      .vp-fa .vp-ok{color:var(--good);font-size:12.5px;margin-top:8px}
      .vp-fa .vp-state{padding:24px 18px;color:var(--muted)}
      .vp-fa .vp-state.err{color:var(--bad)}
      .vp-fa .vp-inline{display:flex;gap:6px;align-items:center}
      .vp-fa .vp-inline .in{width:120px;height:32px}
      .vp-fa .vp-fa-stack{display:grid;gap:14px;min-width:0}
      .vp-fa .vp-fa-row select.in{padding-right:26px}
    `;
    document.head.appendChild(s);
  }
  function toast(text) {
    const t = document.createElement("div");
    t.className = "toast";
    t.setAttribute("role", "status");
    t.textContent = text;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3200);
  }
  function confirmModal(opts) {
    const scrim = document.createElement("div");
    scrim.className = "scrim";
    const m = document.createElement("div");
    m.className = "modal";
    m.setAttribute("role", "dialog");
    m.setAttribute("aria-modal", "true");
    m.innerHTML = `<div class="mb"><div class="ic bad">${ic("lock")}</div>
        <h2>${esc(opts.title)}</h2>
        <p class="note" style="margin:0 0 8px">${esc(opts.body || "")}</p>
        ${opts.detail ? `<p class="note" style="margin:0">${esc(opts.detail)}</p>` : ""}
        <p class="vp-err" data-r="err" role="alert"></p>
      </div>
      <div class="mf"><button type="button" class="btn ghost" data-a="cancel">Cancel</button>
        <button type="button" class="btn ${opts.danger ? "danger" : "primary"}" data-a="ok">${esc(opts.confirm || "Confirm")}</button></div>`;
    document.body.appendChild(scrim);
    document.body.appendChild(m);
    const err = m.querySelector('[data-r="err"]');
    function close() {
      document.removeEventListener("keydown", onKey);
      scrim.remove();
      m.remove();
    }
    function onKey(e) {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    }
    m.addEventListener("click", async (ev) => {
      const b = ev.target.closest("[data-a]");
      if (!b) return;
      if (b.dataset.a === "cancel") {
        close();
        return;
      }
      if (b.dataset.a !== "ok") return;
      b.disabled = true;
      try {
        await opts.onConfirm();
        close();
      } catch (e) {
        err.textContent = e.message || "That did not work.";
        b.disabled = false;
      }
    });
    scrim.addEventListener("click", close);
    document.addEventListener("keydown", onKey);
    const ok = m.querySelector('[data-a="ok"]');
    if (ok) ok.focus();
    return { close };
  }
  function scheduleCard(d) {
    const cadence = d.cadence || "off";
    const weekday = String(d.weekday == null ? 0 : d.weekday);
    const time = d.time || "23:59";
    const next = ET_FMT(d.next_lock_at);
    const last = ET_FMT(d.last_locked_at);
    const label = (CADENCES.find((c) => c[0] === cadence) || ["off", "Off"])[1];
    const monthly = cadence === "monthly";
    return `<div class="vp-fa-card">
      <div class="vp-fa-h"><h3>Automatic lock schedule</h3><span class="tag">${esc(label)}</span></div>
      <div class="vp-fa-b">
        <p class="vp-fa-note">The past closes on its own. On the day and time you choose, every entry dated on or before that day is locked for managers and team members. An admin can still edit or delete a locked entry, and every admin change is written to the audit log. Saving the schedule never locks the past: the first lock happens at the next scheduled moment after you save, and it lands within a quarter of an hour of that time.</p>
        <div class="vp-fa-row">
          <label class="field"><span>Cadence</span><select class="in" data-r="cadence">${CADENCES.map((c) => `<option value="${c[0]}"${c[0] === cadence ? " selected" : ""}>${esc(c[1])}</option>`).join("")}</select></label>
          <label class="field" data-r="dayfield"><span>Day</span><select class="in" data-r="weekday"${monthly ? " disabled" : ""}>${DAYS.map((x) => `<option value="${x[0]}"${x[0] === weekday ? " selected" : ""}>${esc(x[1])}</option>`).join("")}</select></label>
          <label class="field"><span>Time (ET)</span><input class="in" type="time" data-r="locktime" value="${esc(time)}"></label>
          <button type="button" class="btn primary" data-a="savesched">Save schedule</button>
        </div>
        <p class="vp-err" data-r="schederr" role="alert"></p>
        <ul class="vp-list">
          <li><span class="nm">Next lock</span><span class="vl">${next ? esc(next) : '<span class="muted">not scheduled</span>'}</span></li>
          <li><span class="nm">Last locked</span><span class="vl">${last ? esc(last) : '<span class="muted">never</span>'}</span></li>
          <li><span class="nm">Locked through</span><span class="vl">${d.locked_through ? esc(d.locked_through) : '<span class="muted">nothing locked yet</span>'}</span></li>
        </ul>
        ${d.armed ? "" : '<p class="vp-fa-note" data-r="unarmed">Not armed yet: save the schedule to turn it on. Until then the schedule locks nothing.</p>'}
      </div>
    </div>`;
  }
  function lockCard() {
    return `<div class="vp-fa-card">
      <div class="vp-fa-h"><h3>Lock entries before a date</h3>${ic("lock")}</div>
      <div class="vp-fa-b">
        <p class="vp-fa-note">A one-off action: every entry dated before the day you choose is approved and locked. A locked entry cannot be edited or deleted by a manager or a team member; an admin can still change it, and that change is written to the audit log.</p>
        <div class="vp-fa-row">
          <label class="field"><span>Lock entries before</span><input class="in" type="date" data-r="lockdate"></label>
          <button type="button" class="btn" data-a="lock">Lock entries</button>
        </div>
        <p class="vp-ok" data-r="lockok"></p>
        <p class="vp-err" data-r="lockerr" role="alert"></p>
      </div>
    </div>`;
  }
  function mount(root) {
    injectStyle();
    const st = { seq: 0 };
    root.innerHTML = `<section class="sec card vp-fa" aria-labelledby="vp-fa-h">
      <div class="card-h"><div><h2 id="vp-fa-h">Lock settings</h2><div class="hint" style="margin-top:2px">Admin only. Close past weeks so finished timesheets stop changing.</div></div>
        <button type="button" class="btn sm ghost" data-a="reload">${ic("refresh")} Refresh</button></div>
      <div data-r="body"><div class="vp-state" aria-live="polite">Loading lock settings...</div></div>
    </section>`;
    const q = (s) => root.querySelector(s);
    const body = q('[data-r="body"]');
    async function load() {
      const mySeq = ++st.seq;
      body.innerHTML = '<div class="vp-state" aria-live="polite">Loading lock settings...</div>';
      let sched;
      try {
        sched = await getJson("/admin/lock-schedule");
      } catch (e) {
        if (mySeq !== st.seq) return;
        const msg = e.status === 401 ? "Your session has ended. Sign in again." : e.status === 403 ? "Lock settings are for admins only." : e.code === "migration_required" ? "Lock settings need a database update first. " + e.message : "Could not load lock settings: " + e.message;
        body.innerHTML = `<div class="vp-state err" role="alert">${ic("alert")} ${esc(msg)} <button type="button" class="btn sm ghost" data-a="reload">Try again</button></div>`;
        return;
      }
      if (mySeq !== st.seq) return;
      body.innerHTML = `<div class="vp-fa-grid">${scheduleCard(sched)}${lockCard()}</div>`;
    }
    root.addEventListener("change", (ev) => {
      const el = ev.target.closest('[data-r="cadence"]');
      if (!el || !root.contains(el)) return;
      const monthly = el.value === "monthly";
      const daySel = q('[data-r="weekday"]');
      if (daySel) daySel.disabled = monthly;
      const dayField = q('[data-r="dayfield"]');
      if (dayField) dayField.style.opacity = monthly ? "0.55" : "";
    });
    root.addEventListener("click", async (ev) => {
      const b = ev.target.closest("[data-a]");
      if (!b || !root.contains(b)) return;
      const a = b.dataset.a;
      if (a === "reload") {
        load();
        return;
      }
      if (a === "savesched") {
        const cadence = q('[data-r="cadence"]').value;
        const weekday = Number(q('[data-r="weekday"]').value);
        const time = String(q('[data-r="locktime"]').value || "");
        const err = q('[data-r="schederr"]');
        err.textContent = "";
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
          err.textContent = "Choose the time of day the lock runs at.";
          return;
        }
        b.disabled = true;
        try {
          await putJson("/admin/lock-schedule", { cadence, weekday, time });
          toast(cadence === "off" ? "Automatic locking is off." : "Lock schedule saved.");
          load();
        } catch (e) {
          err.textContent = e.message;
          b.disabled = false;
        }
        return;
      }
      if (a === "lock") {
        const date = q('[data-r="lockdate"]').value;
        const okEl = q('[data-r="lockok"]');
        const errEl = q('[data-r="lockerr"]');
        okEl.textContent = "";
        errEl.textContent = "";
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          errEl.textContent = "Choose the day the lock starts from.";
          return;
        }
        confirmModal({
          title: "Lock every entry before this date?",
          body: "Every entry dated before " + date + " will be approved and locked.",
          detail: "Managers and team members can no longer edit or delete those entries. An admin still can, and that change is written to the audit log.",
          confirm: "Lock the entries",
          danger: true,
          onConfirm: async () => {
            const r = await postJson("/admin/lock-before", { before_date: date });
            toast((r.entries_locked || 0) + " entries locked.");
            load();
          }
        });
        return;
      }
    });
    load();
  }
  window.APP_VP.register({ key: "lock-settings", label: "Lock settings", icon: "lock", group: "Admin", adminOnly: true, mount });
})();
