(function() {
  "use strict";
  if (!window.APP_VP || typeof window.APP_VP.register !== "function") return;
  const API = (window.APP_API_BASE || "").replace(/\/$/, "");
  const TOKEN_KEY = "tt_token";
  const PREF_KEY = "tt_vp_weekly";
  const ic = (n) => typeof window.ic === "function" ? window.ic(n) : "";
  const WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const $c = (cents) => {
    if (cents == null) return "n/a";
    const v = Math.abs(cents) / 100;
    return (cents < 0 ? "-" : "") + "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };
  const $c0 = (cents) => cents ? $c(cents) : "0";
  const fmtHM = (m) => {
    m = Math.max(0, Math.round(m || 0));
    return Math.floor(m / 60) + ":" + String(m % 60).padStart(2, "0");
  };
  const dShort = (iso) => iso ? (/* @__PURE__ */ new Date(iso + "T12:00:00Z")).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : "";
  const etToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(/* @__PURE__ */ new Date());
  const shiftIso = (iso, n) => {
    const d = /* @__PURE__ */ new Date(iso + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const openClient = (id) => {
    if (typeof window.openClientEditModal === "function") window.openClientEditModal(id);
  };
  const safeColor = (c) => /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(String(c || "")) ? c : "";
  const billingModelName = (key) => {
    const names = window.APP_VP && window.APP_VP.billingModelNames || {};
    return names[key] || key || "";
  };
  function readPref() {
    try {
      return JSON.parse(localStorage.getItem(PREF_KEY) || "{}") || {};
    } catch (e) {
      return {};
    }
  }
  function writePref(p) {
    try {
      localStorage.setItem(PREF_KEY, JSON.stringify(p));
    } catch (e) {
    }
  }
  async function getJson(path, opts) {
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
  const STYLE_ID = "vp-weekly-style";
  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement("style");
    s.id = STYLE_ID;
    s.textContent = `
      .vp-wk .vp-wk-ctl{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
      .vp-wk .vp-wk-body{padding:0 0 4px}
      .vp-wk .vp-state{padding:28px 20px;color:var(--muted)}
      .vp-wk .vp-state.err{color:var(--bad)}
      .vp-wk .vp-kpi-pad{padding:18px 20px 0}
      .vp-wk .vp-goal-note{padding:0 20px 14px}
      .vp-wk .vp-filterbar{display:flex;gap:8px;align-items:center;padding:12px 20px;border-bottom:1px solid var(--line);flex-wrap:wrap}
      .vp-wk .vp-filterbar .note{flex:1;min-width:160px}
      .vp-wk .vp-warnchip{margin-left:8px}
      .vp-wk .vp-brk{display:grid;gap:8px;margin:10px 0 16px}
      .vp-wk .vp-brk .r{display:flex;justify-content:space-between;gap:12px;font-size:13px;padding:7px 10px;background:var(--sunk);border-radius:9px}
      .vp-wk .vp-brk .r b{font-variant-numeric:tabular-nums}
      .vp-wk .vp-brk .r.tot{background:var(--brand-tint);color:var(--ink)}
      .vp-wk .vp-excl{font-size:12px;color:var(--muted);line-height:1.5}
      .vp-wk .vp-goalinput{margin-top:12px}
      .vp-wk .vp-goalinput[disabled]{opacity:.6}
      .vp-wk .vp-modal-err{color:var(--bad);font-size:12.5px;margin-top:8px}
      .vp-wk .wk td.amt .lbl2{display:inline-block}
      .vp-wk .vp-toast{position:fixed;z-index:95;left:50%;bottom:24px;transform:translateX(-50%);background:var(--ink);color:var(--bg);padding:11px 16px;border-radius:12px;box-shadow:var(--shadow-pop);font-weight:600;font-size:13px}
    `;
    document.head.appendChild(s);
  }
  function toast(text) {
    const t = document.createElement("div");
    t.className = "vp-toast";
    t.setAttribute("role", "status");
    t.textContent = text;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3200);
  }
  function openGoalModal(d, st, onSaved) {
    const g = d.kpis && d.kpis.goal || {};
    const bk = g.auto_goal_breakdown || {};
    const ex = g.auto_goal_excluded || {};
    const bd = [
      ["Hourly clients, cap x rate", bk.hourly_cents],
      ["Weekly milestones", bk.milestone_cents],
      ["Monthly retainers, monthly x 12/52", bk.retainer_cents]
    ];
    if (bk.fixed_cents) bd.push(["Fixed projects, milestones in the week", bk.fixed_cents]);
    const excluded = Object.keys(ex).filter((k) => (ex[k] || 0) > 0).map((k) => `${ex[k]} ${{ paused: "paused", archived: "archived", fixed_project: "fixed project", profit_share: "profit share", no_cap: "without an hours cap", other: "other" }[k]}`);
    const scrim = document.createElement("div");
    scrim.className = "scrim";
    scrim.setAttribute("data-r", "scrim");
    const m = document.createElement("div");
    m.className = "modal";
    m.setAttribute("role", "dialog");
    m.setAttribute("aria-modal", "true");
    m.setAttribute("aria-labelledby", "vp-goal-t");
    m.innerHTML = `<div class="mb">
        <h2 id="vp-goal-t">Weekly goal</h2>
        <p class="note" style="margin:0 0 14px">Auto is the cap the week could earn at full capacity, computed from the clients. Manual overrides it with a number you type. The typed number is kept when you switch back to auto.</p>
        <div class="seg" role="group" aria-label="Goal mode" style="margin-bottom:12px">
          <button type="button" data-a="gm" data-v="auto">Auto from client caps</button>
          <button type="button" data-a="gm" data-v="manual">Manual override</button>
        </div>
        <div class="vp-brk" data-r="brk">
          ${bd.map(([l, v]) => `<div class="r"><span>${esc(l)}</span><b class="mono">${$c(v || 0)}</b></div>`).join("")}
          <div class="r tot"><span>Auto goal</span><b class="mono">${$c(g.auto_goal_cents || 0)}</b></div>
        </div>
        ${excluded.length ? `<p class="vp-excl">Not in the goal: ${esc(excluded.join(", "))}.</p>` : ""}
        <label class="field vp-goalinput"><span>Weekly goal in dollars</span>
          <input class="in" type="number" min="0" step="1" data-r="goalin" inputmode="decimal"></label>
        <p class="vp-modal-err" data-r="gerr" role="alert"></p>
      </div>
      <div class="mf"><button type="button" class="btn ghost" data-a="goalclose">Cancel</button>
        <button type="button" class="btn primary" data-a="goalsave">Save goal</button></div>`;
    document.body.appendChild(scrim);
    document.body.appendChild(m);
    let mode = g.goal_mode === "manual" ? "manual" : "auto";
    const goalIn = m.querySelector('[data-r="goalin"]');
    const err = m.querySelector('[data-r="gerr"]');
    const brk = m.querySelector('[data-r="brk"]');
    function sync() {
      m.querySelectorAll('[data-a="gm"]').forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === mode)));
      goalIn.disabled = mode === "auto";
      goalIn.value = mode === "auto" ? String(Math.round((g.auto_goal_cents || 0) / 100)) : String(Math.round((g.manual_goal_cents || 0) / 100));
      brk.style.opacity = mode === "auto" ? "1" : ".55";
      err.textContent = "";
    }
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
      const a = b.dataset.a;
      if (a === "gm") {
        mode = b.dataset.v;
        sync();
        return;
      }
      if (a === "goalclose") {
        close();
        return;
      }
      if (a !== "goalsave") return;
      const dollars = Number(String(goalIn.value).replace(/[$,\s]/g, ""));
      if (!Number.isFinite(dollars) || dollars < 0) {
        err.textContent = "Enter a dollar amount, for example 3000.";
        goalIn.focus();
        return;
      }
      const cents = Math.round(dollars * 100);
      b.disabled = true;
      try {
        await getJson("/admin/weekly/goal", { method: "POST", body: JSON.stringify({ goal_cents: cents, goal_mode: mode }) });
        close();
        toast(mode === "auto" ? "Goal set to auto, from the client caps." : "Goal saved: " + $c(cents) + " a week.");
        onSaved();
      } catch (e) {
        err.textContent = e.message || "The goal could not be saved.";
        b.disabled = false;
      }
    });
    scrim.addEventListener("click", close);
    document.addEventListener("keydown", onKey);
    sync();
    if (mode === "manual") goalIn.focus();
    goalIn.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        m.querySelector('[data-a="goalsave"]').click();
      }
    });
  }
  function deltaHtml(d, fmt) {
    if (!d) return '<span class="delta flat">n/a</span>';
    const up = d.delta > 0, flat = d.delta === 0;
    const p = d.pct === null || d.pct === void 0 ? "" : ` (${up ? "+" : ""}${d.pct}%)`;
    if (flat) return `<span class="delta flat">no change</span>`;
    return `<span class="delta ${up ? "good" : "bad"}">${ic(up ? "up" : "down")}${up ? "+" : "-"}${esc(fmt(Math.abs(d.delta)))}${p}</span>`;
  }
  const NO_WEEKLY = { retainer: "no amount", project: "Project", profit: "Profit" };
  const noMoneyLabel = (c) => {
    if (c.rate_cents === null || c.rate_cents === void 0) return NO_WEEKLY[c.rate_unit] || "";
    return c.paused ? "Paused" : c.archived ? "Archived" : "No amount";
  };
  const noMoneyTitle = (label) => label === "Paused" ? "A paused contract earns nothing" : label === "Archived" ? "An archived contract earns nothing" : "Not part of the weekly total";
  function statusChip(c, d) {
    if (c.billing_model !== "hourly") return "";
    if (c.target_hours === null || c.target_hours === void 0) return "";
    const pctv = c.target_pct;
    if (pctv === null || pctv === void 0) return "";
    const fromWed = !d.is_current || d.today >= d.days[2].date;
    if (!fromWed) return "";
    if (pctv >= 90) return `<span class="st watch vp-warnchip" title="${pctv}% of the weekly cap">${ic("alert")}Approaching max hours</span>`;
    if (pctv < 50) return `<span class="st none vp-warnchip" title="${pctv}% of the weekly cap">${ic("info")}Low work reported</span>`;
    return "";
  }
  function rowHtml(c, d) {
    const cells = c.days.map((x, i) => {
      const f = d.days[i];
      const cls = ["day"];
      if (!x.minutes) cls.push("zero");
      if (f.is_today) cls.push("today");
      if (f.is_future) cls.push("future");
      const tip = x.manual_minutes > 0 ? ` title="${fmtHM(x.manual_minutes)} of this is manual time"` : "";
      const man = x.manual_minutes > 0 ? '<span class="man" aria-label="manual time"></span>' : "";
      return `<td class="${cls.join(" ")}"${tip}>${x.minutes ? fmtHM(x.minutes) : "0:00"}${man}</td>`;
    }).join("");
    const noWeekly = NO_WEEKLY[c.rate_unit] || "";
    const rate = c.rate_cents === null || c.rate_cents === void 0 ? `<span class="muted">${esc(noWeekly)}</span>` : `<span class="mono">${$c(c.rate_cents)}</span><span class="muted">/${c.rate_unit === "week" ? "wk" : "hr"}</span>`;
    let msNote = "";
    if (c.billing_model === "fixed_project" && c.milestones && c.milestones.length) {
      const parts = c.milestones.map((m) => {
        const st = m.state === "pending" ? " (pending)" : m.state === "late" ? " (landed late)" : "";
        return `${m.label || "Milestone"} ${$c(m.amount_cents)}${st}`;
      });
      msNote = `<div class="muted small" title="The milestones that land in this week">${esc(parts.join(" · "))}</div>`;
    }
    const amountLabel = noMoneyLabel(c);
    const amount = c.amount_cents === null || c.amount_cents === void 0 ? `<span class="lbl2" title="${noMoneyTitle(amountLabel)}">${esc(amountLabel)}</span>` : `<span class="mono">${$c(c.amount_cents)}</span>${msNote}`;
    let target;
    if (c.target_hours === null || c.target_hours === void 0) {
      target = '<span class="muted">No cap</span>';
    } else {
      const w = Math.max(0, Math.min(100, Number(c.target_pct || 0)));
      const cls = c.target_status === "under" ? "watch" : "good";
      const why = c.uses_weights ? "Weighted: the hours are counted through the member weights, the same basis as invoices." : "Counted hours against the weekly cap.";
      target = `<div class="tgt" title="${esc(why)}"><div class="bar"><i class="${cls}" style="width:${w}%"></i></div><span class="tx mono">${fmtHM(c.effective_hours * 60)} / ${fmtHM(c.target_hours * 60)}</span></div>`;
    }
    const isHourly = (c.billing_model || "hourly") === "hourly";
    const missed = !isHourly ? '<span class="muted">&#8212;</span>' : c.missed_cents ? `<span class="mono">${$c(c.missed_cents)}</span>` : '<span class="zero">0</span>';
    const tag = c.paused ? ' <span class="tag">Paused</span>' : "";
    const arch = c.archived ? ' <span class="muted">(archived)</span>' : "";
    return `<tr class="row"><td class="cl"><div class="nm">` + (safeColor(c.color) ? `<span class="cdot" style="background:${esc(safeColor(c.color))}" aria-hidden="true"></span>` : "") + `<span><a href="#" data-a="client" data-id="${esc(c.client_id)}" style="color:inherit;text-decoration:none">${esc(c.client_name)}</a></span></div><div class="mt">${esc(billingModelName(c.billing_model))}${tag}${arch}</div>${statusChip(c, d)}</td>` + cells + `<td class="tot"><span class="mono">${fmtHM(c.total_minutes)}</span></td><td>${rate}</td><td class="amt">${amount}</td><td>${missed}</td><td class="tg">${target}</td></tr>`;
  }
  function gridHtml(d, st) {
    const hoursLeft = (c) => c.target_hours === null || c.target_hours === void 0 ? Infinity : Number(c.target_hours) - Number(c.effective_hours);
    let rows = d.clients.slice();
    if (st.onlyUnder) rows = rows.filter((c) => c.target_status === "under");
    const groups = (d.groups || []).map((g) => {
      let rs = rows.filter((c) => (c.billing_model || "hourly") === g.key);
      if (!rs.length) return "";
      rs = rs.slice().sort(g.key === "hourly" ? (a, b) => hoursLeft(a) - hoursLeft(b) || String(a.client_name).localeCompare(String(b.client_name)) : (a, b) => String(a.client_name).localeCompare(String(b.client_name)));
      const n = rs.length;
      const head2 = `<tr class="grp"><td class="cl"><div class="gl"><span class="eyebrow">${esc(g.label)}</span><span class="tag">${n} client${n === 1 ? "" : "s"}</span><span class="muted">${fmtHM(g.subtotal_minutes)} hrs${g.subtotal_amount_cents ? " and " + $c(g.subtotal_amount_cents) : ""}</span></div></td><td class="gs" colspan="12"></td></tr>`;
      return head2 + rs.map((c) => rowHtml(c, d)).join("");
    }).join("");
    const t = d.totals || {};
    const head = `<thead><tr><th class="cl">Client</th>` + d.days.map((x, i) => `<th class="day${x.is_today ? " today" : ""}${x.is_future ? " future" : ""}">${WD[i]}<span class="d">${dShort(x.date)}</span></th>`).join("") + `<th>Hours</th><th>Rate</th><th>Amount</th><th>Missed</th><th class="tg">Billed / target</th></tr></thead>`;
    const foot = `<tfoot><tr><td class="cl">Total</td>` + (t.day_minutes || []).map((m) => `<td class="day${m ? "" : " zero"}">${m ? fmtHM(m) : "0:00"}</td>`).join("") + `<td class="tot"><span class="mono">${fmtHM(t.minutes)}</span></td><td>${t.effective_rate_cents === null || t.effective_rate_cents === void 0 ? "" : `<span class="mono">${$c(t.effective_rate_cents)}</span><span class="muted">/hr</span>`}</td><td class="amt"><span class="mono">${$c(t.amount_cents)}</span></td><td>${t.missed_cents ? `<span class="mono">${$c(t.missed_cents)}</span>` : '<span class="zero">0</span>'}</td><td></td></tr></tfoot>`;
    const legend = `<div class="wk-legend"><span><i class="sw"></i>Today</span><span><i class="man"></i>Manual time</span><span>${ic("info")} A retainer earns its weekly share (monthly &times; 12/52), prorated by the days elapsed in the week. A fixed project counts the milestones that land in the week. A fixed project with no milestones yet keeps its old window rule and has no weekly amount. Profit shares have no weekly amount, so their hours are not in the amount.</span></div>`;
    if (!rows.length) {
      return `<div class="empty">${ic("sheet")}<div>${st.onlyUnder ? "No client is under its weekly target this week." : "No client to show for this week."}</div></div>`;
    }
    return `<div class="wk-wrap"><table class="wk">${head}<tbody>${groups}</tbody>${foot}</table></div>${legend}`;
  }
  function kpisHtml(d, st) {
    const k = d.kpis || {};
    const g = k.goal || {};
    const t = d.totals || {};
    const pctv = g.pct === null || g.pct === void 0 ? 0 : Math.max(0, Math.min(100, Number(g.pct)));
    const modeTag = g.goal_mode === "manual" ? '<span class="tag">Manual</span>' : '<span class="tag">Auto from client caps</span>';
    const missedNote = g.missed_label ? ` ${esc(g.missed_label)}` : "";
    const pausedNote = g.paused_clients ? `<br>${g.paused_clients} paused client${g.paused_clients === 1 ? "" : "s"} (${$c(g.paused_cents_excluded || 0)}) are not counted against the goal.` : "";
    const goalCard = `<div class="kpi goal">
      <div class="k"><span>Week total vs goal</span>${modeTag}</div>
      <div class="v">${$c(g.goal_base_cents || 0)}<small>of ${$c(g.goal_cents || 0)}</small></div>
      <div class="bar"><i class="brand" style="width:${pctv}%"></i></div>
      <div class="scale"><span>${g.pct === null || g.pct === void 0 ? "" : pctv + "%"}</span><span>${$c(g.remaining_cents || 0)} to go</span></div>
      <div class="s">${fmtHM(t.minutes)} hrs logged. Missed vs max: <b>${$c(g.missed_cents || 0)}</b>${missedNote}.${pausedNote}
        <br><button type="button" class="btn sm ghost" data-a="editgoal" style="padding:0;height:auto">Edit goal</button></div>
    </div>`;
    const rateCard = `<div class="kpi">
      <div class="k"><span>Effective $/hr</span><span title="The week's amount divided by the logged hours, after member weights and weekly caps. Retainer, fixed and internal hours are left out of both sides." style="cursor:help;color:var(--faint)">${ic("info")}</span></div>
      <div class="v">${k.effective_rate_cents === null || k.effective_rate_cents === void 0 ? "n/a" : $c(k.effective_rate_cents)}<small>per hour</small></div>
      <div class="s">What the week earned per logged hour, after member weights and weekly caps.</div>
    </div>`;
    const wow = k.week_over_week || {};
    const wowCard = `<div class="kpi">
      <div class="k"><span>vs previous week</span></div>
      <div class="v">${deltaHtml(wow.amount, (v) => $c(v))}</div>
      <div class="s">Last week ${$c(wow.prev_amount_cents || 0)} and ${fmtHM(wow.prev_minutes)} hrs ${deltaHtml(wow.minutes, (v) => fmtHM(v) + " hrs")}${d.is_current ? ". Week in progress." : "."}</div>
    </div>`;
    const under = (d.clients || []).filter((c) => c.target_status === "under");
    const names = under.slice(0, 2).map((c) => c.client_name).join(", ") + (under.length > 2 ? ` and ${under.length - 2} more` : "");
    const underCard = `<button type="button" class="kpi${under.length ? " warn" : ""}" data-a="underfilter" aria-pressed="${String(!!st.onlyUnder)}">
      <div class="k"><span>Under weekly target</span></div>
      <div class="v">${under.length}<small>client${under.length === 1 ? "" : "s"}</small></div>
      <div class="s">${names ? esc(names) : "Every client with a cap is on target."}<br>${under.length ? "Click to filter the grid to these clients." : ""}</div>
    </button>`;
    return `<div class="kpis">${goalCard}${rateCard}${wowCard}${underCard}</div>`;
  }
  function statusPill(d) {
    if (d.is_current) return '<span class="st info">In progress</span>';
    if (d.week_start > d.today) return '<span class="st none">Upcoming</span>';
    return '<span class="st good">Past week</span>';
  }
  function mount(root) {
    injectStyle();
    const pref = readPref();
    const st = {
      week: /^\d{4}-\d{2}-\d{2}$/.test(pref.week || "") ? pref.week : null,
      onlyUnder: false,
      last: null,
      seq: 0
    };
    root.innerHTML = `<section class="sec card vp-wk" aria-labelledby="vp-wk-h">
      <div class="card-h"><div><h2 id="vp-wk-h">Weekly board</h2><div class="hint" style="margin-top:2px" data-r="sub">Admin only.</div></div>
        <div class="vp-wk-ctl">
          <div class="weeksw"><button type="button" class="iconbtn" data-a="prev" aria-label="Previous week">${ic("chevL") || "&lsaquo;"}</button>
            <span class="lbl2" data-r="wklabel">This week</span>
            <button type="button" class="iconbtn" data-a="next" aria-label="Next week">${ic("chevR") || "&rsaquo;"}</button></div>
          <button type="button" class="btn sm ghost" data-a="thisweek">This week</button>
          <span data-r="status"></span>
        </div></div>
      <div data-r="body"><div class="vp-state" aria-live="polite">Loading the weekly board...</div></div>
    </section>`;
    const q = (s) => root.querySelector(s);
    const body = q('[data-r="body"]');
    async function load() {
      const mySeq = ++st.seq;
      body.innerHTML = '<div class="vp-state" aria-live="polite">Loading the weekly board...</div>';
      let d;
      try {
        d = await getJson("/admin/weekly" + (st.week ? `?week=${encodeURIComponent(st.week)}` : ""));
      } catch (e) {
        if (mySeq !== st.seq) return;
        const msg = e.status === 401 ? "Your session has ended. Sign in again to see the weekly board." : e.status === 403 ? "The weekly board is for admins only." : e.code === "migration_required" ? "The weekly board needs a database update before it can show figures. " + e.message : "Could not load the weekly board: " + e.message;
        body.innerHTML = `<div class="vp-state err" role="alert">${ic("alert")} ${esc(msg)} <button type="button" class="btn sm ghost" data-a="retry">Try again</button></div>`;
        return;
      }
      if (mySeq !== st.seq) return;
      st.week = d.week_start;
      st.last = d;
      writePref({ week: st.week });
      q('[data-r="wklabel"]').textContent = `${dShort(d.week_start)} to ${dShort(d.week_end)}`;
      q('[data-r="status"]').innerHTML = statusPill(d);
      q('[data-r="sub"]').textContent = `Week of ${dShort(d.week_start)} to ${dShort(d.week_end)}. Admin only.`;
      const filterBar = st.onlyUnder ? `<div class="vp-filterbar">${ic("target")}<span class="note">Showing only the clients under their weekly target.</span>
             <button type="button" class="btn sm ghost" data-a="clearfilter">Show all clients</button></div>` : "";
      body.innerHTML = filterBar + kpisHtml(d, st) + gridHtml(d, st);
    }
    root.addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-a]");
      if (!b || !root.contains(b)) return;
      const a = b.dataset.a;
      if (a === "prev") {
        st.week = shiftIso(st.week || weekMonday(etToday()), -7);
        load();
      } else if (a === "next") {
        st.week = shiftIso(st.week || weekMonday(etToday()), 7);
        load();
      } else if (a === "thisweek") {
        st.week = null;
        load();
      } else if (a === "underfilter") {
        st.onlyUnder = !st.onlyUnder;
        load();
      } else if (a === "clearfilter") {
        st.onlyUnder = false;
        load();
      } else if (a === "client") {
        ev.preventDefault();
        openClient(b.dataset.id);
      } else if (a === "editgoal") {
        const d = st.last;
        if (d) openGoalModal(d, st, load);
      } else if (a !== "retry") return;
    });
    load();
  }
  function weekMonday(iso) {
    const d = /* @__PURE__ */ new Date(iso + "T12:00:00Z");
    const dow = (d.getUTCDay() + 6) % 7;
    d.setUTCDate(d.getUTCDate() - dow);
    return d.toISOString().slice(0, 10);
  }
  window.APP_VP.register({ key: "weekly", label: "Weekly board", icon: "sheet", group: "Weekly", adminOnly: true, mount });
})();
