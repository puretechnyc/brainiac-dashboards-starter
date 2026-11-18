(function() {
  "use strict";
  if (!window.APP_VP || typeof window.APP_VP.register !== "function") return;
  const API = (window.APP_API_BASE || "").replace(/\/$/, "");
  const TOKEN_KEY = "tt_token";
  const PREF_KEY = "tt_vp_team_weekly";
  const ic = (n) => typeof window.ic === "function" ? window.ic(n) : "";
  const WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
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
  async function getJson(path) {
    const headers = { "Content-Type": "application/json" };
    let t = null;
    try {
      t = localStorage.getItem(TOKEN_KEY);
    } catch (e) {
    }
    if (t) headers.Authorization = "Bearer " + t;
    const res = await fetch(API + "/api" + path, { headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const e = new Error(data.error || "HTTP " + res.status);
      e.status = res.status;
      e.code = data.code || null;
      throw e;
    }
    return data;
  }
  const STYLE_ID = "vp-team-weekly-style";
  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement("style");
    s.id = STYLE_ID;
    s.textContent = `
      .vp-tw .vp-tw-ctl{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
      .vp-tw .vp-state{padding:28px 20px;color:var(--muted)}
      .vp-tw .vp-state.err{color:var(--bad)}
      .vp-tw .vp-filterbar{display:flex;gap:8px;align-items:center;padding:12px 20px;border-bottom:1px solid var(--line);flex-wrap:wrap}
      .vp-tw .vp-filterbar .note{flex:1;min-width:160px}
      .vp-tw .vp-warnchip{margin-left:8px}
    `;
    document.head.appendChild(s);
  }
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
    let target;
    if (c.target_hours === null || c.target_hours === void 0) {
      target = '<span class="muted">No cap</span>';
    } else {
      const w = Math.max(0, Math.min(100, Number(c.target_pct || 0)));
      const cls = c.target_status === "under" ? "watch" : "good";
      target = `<div class="tgt" title="Counted hours against the weekly cap."><div class="bar"><i class="${cls}" style="width:${w}%"></i></div><span class="tx mono">${fmtHM(c.effective_hours * 60)} / ${fmtHM(c.target_hours * 60)}</span></div>`;
    }
    const tag = c.paused ? ' <span class="tag">Paused</span>' : "";
    const arch = c.archived ? ' <span class="muted">(archived)</span>' : "";
    return `<tr class="row"><td class="cl"><div class="nm">` + (safeColor(c.color) ? `<span class="cdot" style="background:${esc(safeColor(c.color))}" aria-hidden="true"></span>` : "") + `<span>${esc(c.client_name)}</span></div><div class="mt">${esc(billingModelName(c.billing_model))}${tag}${arch}</div>${statusChip(c, d)}</td>` + cells + `<td class="tot"><span class="mono">${fmtHM(c.total_minutes)}</span></td><td class="tg">${target}</td></tr>`;
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
      return `<tr class="grp"><td class="cl"><div class="gl"><span class="eyebrow">${esc(g.label)}</span><span class="tag">${n} client${n === 1 ? "" : "s"}</span><span class="muted">${fmtHM(g.subtotal_minutes)} hrs</span></div></td><td class="gs" colspan="9"></td></tr>` + rs.map((c) => rowHtml(c, d)).join("");
    }).join("");
    const t = d.totals || {};
    const head = `<thead><tr><th class="cl">Client</th>` + d.days.map((x, i) => `<th class="day${x.is_today ? " today" : ""}${x.is_future ? " future" : ""}">${WD[i]}<span class="d">${dShort(x.date)}</span></th>`).join("") + `<th>Hours</th><th class="tg">Billed / target</th></tr></thead>`;
    const foot = `<tfoot><tr><td class="cl">Total</td>` + (t.day_minutes || []).map((m) => `<td class="day${m ? "" : " zero"}">${m ? fmtHM(m) : "0:00"}</td>`).join("") + `<td class="tot"><span class="mono">${fmtHM(t.minutes)}</span></td><td></td></tr></tfoot>`;
    const legend = `<div class="wk-legend"><span><i class="sw"></i>Today</span><span><i class="man"></i>Manual time</span></div>`;
    if (!rows.length) {
      return `<div class="empty">${ic("sheet")}<div>${st.onlyUnder ? "No client is under its weekly target this week." : "No client to show for this week."}</div></div>`;
    }
    return `<div class="wk-wrap"><table class="wk">${head}<tbody>${groups}</tbody>${foot}</table></div>${legend}`;
  }
  function kpisHtml(d, st) {
    const t = d.totals || {};
    const clients = d.clients || [];
    const under = clients.filter((c) => c.target_status === "under");
    const names = under.slice(0, 2).map((c) => c.client_name).join(", ") + (under.length > 2 ? ` and ${under.length - 2} more` : "");
    const hours = `<div class="kpi goal">
      <div class="k"><span>Hours this week</span></div>
      <div class="v">${fmtHM(t.minutes)}</div>
      <div class="s">${clients.length} client${clients.length === 1 ? "" : "s"} on the grid${d.scoped ? ", scoped to the clients you are assigned to" : ""}.</div>
    </div>`;
    const manual = `<div class="kpi">
      <div class="k"><span>Manual time</span></div>
      <div class="v">${fmtHM(t.manual_minutes)}</div>
      <div class="s">${t.unclassified_minutes ? fmtHM(t.unclassified_minutes) + " of older entries have an unknown origin and are not counted as manual." : "Entered by hand rather than timed."}</div>
    </div>`;
    const days = `<div class="kpi">
      <div class="k"><span>Days logged</span></div>
      <div class="v">${(t.day_minutes || []).filter((m) => m > 0).length}<small>of 7</small></div>
      <div class="s">${d.is_current ? "The week is still running." : "A finished week."}</div>
    </div>`;
    const underCard = `<button type="button" class="kpi${under.length ? " warn" : ""}" data-a="underfilter" aria-pressed="${String(!!st.onlyUnder)}">
      <div class="k"><span>Under weekly target</span></div>
      <div class="v">${under.length}<small>client${under.length === 1 ? "" : "s"}</small></div>
      <div class="s">${names ? esc(names) : "Every client with a cap is on target."}${under.length ? "<br>Click to filter the grid to these clients." : ""}</div>
    </button>`;
    return `<div class="kpis">${hours}${manual}${days}${underCard}</div>`;
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
      seq: 0
    };
    root.innerHTML = `<section class="sec card vp-tw" aria-labelledby="vp-tw-h">
      <div class="card-h"><div><h2 id="vp-tw-h">Team week</h2><div class="hint" style="margin-top:2px" data-r="sub">Hours only.</div></div>
        <div class="vp-tw-ctl">
          <div class="weeksw"><button type="button" class="iconbtn" data-a="prev" aria-label="Previous week">${ic("chevL") || "&lsaquo;"}</button>
            <span class="lbl2" data-r="wklabel">This week</span>
            <button type="button" class="iconbtn" data-a="next" aria-label="Next week">${ic("chevR") || "&rsaquo;"}</button></div>
          <button type="button" class="btn sm ghost" data-a="thisweek">This week</button>
          <span data-r="status"></span>
        </div></div>
      <div data-r="body"><div class="vp-state" aria-live="polite">Loading the team week...</div></div>
    </section>`;
    const q = (s) => root.querySelector(s);
    const body = q('[data-r="body"]');
    async function load() {
      const mySeq = ++st.seq;
      body.innerHTML = '<div class="vp-state" aria-live="polite">Loading the team week...</div>';
      let d;
      try {
        d = await getJson("/team/weekly" + (st.week ? `?week=${encodeURIComponent(st.week)}` : ""));
      } catch (e) {
        if (mySeq !== st.seq) return;
        const msg = e.status === 401 ? "Your session has ended. Sign in again to see the team week." : e.status === 403 ? "The team week is for admins and managers." : "Could not load the team week: " + e.message;
        body.innerHTML = `<div class="vp-state err" role="alert">${ic("alert")} ${esc(msg)} <button type="button" class="btn sm ghost" data-a="retry">Try again</button></div>`;
        return;
      }
      if (mySeq !== st.seq) return;
      st.week = d.week_start;
      writePref({ week: st.week });
      q('[data-r="wklabel"]').textContent = `${dShort(d.week_start)} to ${dShort(d.week_end)}`;
      q('[data-r="status"]').innerHTML = statusPill(d);
      q('[data-r="sub"]').textContent = `Week of ${dShort(d.week_start)} to ${dShort(d.week_end)}. Hours only, no money.`;
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
  window.APP_VP.register({ key: "team-weekly", label: "Team week", icon: "team", group: "Weekly", managerOnly: true, mount });
})();
