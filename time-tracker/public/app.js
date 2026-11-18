"use strict";
const API = (window.APP_API_BASE || "").replace(/\/$/, "");
const TOKEN_KEY = "tt_token";
const TIMER_KEY = "tt_timer_state";
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
let ME = null;
let CLIENTS = [];
let timerInterval = null;
let trackerMode = "timer";
const BILLING_MODEL_NAMES = {
  hourly: "Hourly",
  milestone_weekly: "Weekly milestone",
  monthly_retainer: "Monthly retainer",
  fixed_project: "Fixed project",
  profit_share: "Profit share"
};
const billingModelName = (key) => BILLING_MODEL_NAMES[key] || key || "";
const IC = {
  dash: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  sheet: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/>',
  invoice: '<path d="M6 2h9l5 5v15H6z"/><path d="M14 2v6h6"/><path d="M9 13h6M9 17h6"/>',
  receipt: '<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 17.5v-11"/>',
  reports: '<path d="M3 3v18h18"/><path d="M8 16v-5M13 16V8M18 16V9"/>',
  clients: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/><path d="M3 13h18"/>',
  team: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7"/><path d="M21.5 20a6.5 6.5 0 0 0-4-6"/>',
  req: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M19 8v6M16 11h6"/>',
  budget: '<path d="M6 2h12M6 22h12"/><path d="M7 2c0 5 10 5 10 10S7 17 7 22"/><path d="M17 2c0 5-10 5-10 10s10 5 10 10"/>',
  admin: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  bell: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
  chevL: '<path d="m15 18-6-6 6-6"/>',
  chevR: '<path d="m9 18 6-6-6-6"/>',
  chevD: '<path d="m6 9 6 6 6-6"/>',
  chevU: '<path d="m18 15-6-6-6 6"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
  more: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  alert: '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  play: '<path d="M7 4v16l13-8z" fill="currentColor" stroke="none"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M9 2h6"/>',
  hand: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
  up: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  down: '<path d="M12 5v14M19 12l-7 7-7-7"/>',
  ban: '<circle cx="12" cy="12" r="9"/><path d="m5.7 5.7 12.6 12.6"/>',
  print: '<path d="M6 9V2h12v7"/><rect x="2" y="9" width="20" height="9" rx="2"/><path d="M6 14h12v8H6z"/>',
  send: '<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>',
  dollar: '<path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
  layers: '<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 17 10 5 10-5M2 12l10 5 10-5"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  scale: '<path d="M12 3v18M7 21h10M4 7h16M7 7l-3 7a3 3 0 0 0 6 0zM17 7l-3 7a3 3 0 0 0 6 0z"/>',
  msg: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 9.8-9.8M17 6l3 3"/>',
  archive: '<rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8M10 12h4"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  cal: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>'
};
const ic = (n, cls = "") => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${IC[n] || ""}</svg>`;
window.ic = ic;
window.IC = IC;
function token() {
  return localStorage.getItem(TOKEN_KEY);
}
function setToken(t) {
  t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY);
}
async function api(path, { method = "GET", body } = {}) {
  const headers = { "Content-Type": "application/json" };
  const t = token();
  if (t) headers.Authorization = `Bearer ${t}`;
  const res = await fetch(`${API}/api${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : void 0
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(data.error || `HTTP ${res.status}`);
    e.code = data.code || null;
    e.status = res.status;
    e.data = data;
    throw e;
  }
  return data;
}
const PAUSED_MSG = "This client is paused; ask an admin.";
function money(cents, currency = "USD") {
  const sym = currency === "USD" ? "$" : currency + " ";
  const neg = Number(cents) < 0 ? "-" : "";
  return `${neg}${sym}${Math.abs(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
const COLOR_PALETTE = [
  "#03A9F4",
  "#4CAF50",
  "#FF9800",
  "#F44336",
  "#9C27B0",
  "#E91E63",
  "#00BCD4",
  "#8BC34A",
  "#FFC107",
  "#795548",
  "#607D8B",
  "#3F51B5",
  "#009688",
  "#CDDC39",
  "#FF5722",
  "#673AB7",
  "#2196F3",
  "#FFEB3B",
  "#9E9E9E",
  "#E040FB"
];
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
function safeColor(c) {
  return typeof c === "string" && HEX_RE.test(c) ? c : "";
}
function textOn(hex) {
  const c = safeColor(hex);
  if (!c) return "inherit";
  const n = parseInt(c.slice(1), 16);
  const f = (v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const L = 0.2126 * f(n >> 16) + 0.7152 * f(n >> 8 & 255) + 0.0722 * f(n & 255);
  return (L + 0.05) / 0.05 > 1.05 / (L + 0.05) ? "#111111" : "#ffffff";
}
function clientColorById(id) {
  const c = (typeof CLIENTS !== "undefined" ? CLIENTS : []).find((x) => x.id === id);
  return safeColor(c && c.color);
}
function clientColorByName(name) {
  const c = (typeof CLIENTS !== "undefined" ? CLIENTS : []).find((x) => x.name === name);
  return safeColor(c && c.color);
}
function cdot(color) {
  const c = safeColor(color);
  return c ? `<span class="cdot" style="background:${c}"></span>` : "";
}
function pausedBadge(id, name) {
  const list = typeof CLIENTS !== "undefined" ? CLIENTS : [];
  const c = list.find((x) => id && x.id === id || name && x.name === name);
  return c && c.paused ? ' <span class="client-status-paused">Paused</span>' : "";
}
function pausedWhoWhen(c) {
  if (!c || !c.paused) return "";
  const date = c.paused_at ? String(c.paused_at).slice(0, 10) : "";
  const who = c.paused_by_name ? `by ${escapeHtml(c.paused_by_name)}` : "";
  const tail = [who, date ? `on ${date}` : ""].filter(Boolean).join(" ");
  return tail ? ` (${tail})` : "";
}
function cdotName(name) {
  return cdot(clientColorByName(name));
}
function leftBarStyle(color) {
  const c = safeColor(color);
  return c ? `border-left:5px solid ${c};` : "";
}
function paintSelectByClient(selectEl, clientId) {
  if (!selectEl) return;
  const c = clientColorById(clientId);
  selectEl.style.borderLeft = c ? `6px solid ${c}` : "";
}
function renderColorBoard(container, selected, onChange) {
  if (!container) return;
  const cur = safeColor(selected) || COLOR_PALETTE[0];
  container.dataset.color = cur;
  container.innerHTML = `
    <div class="cboard" role="radiogroup" aria-label="Client colour">
      ${COLOR_PALETTE.map((c) => `<button type="button" class="cswatch${c.toLowerCase() === cur.toLowerCase() ? " on" : ""}" data-c="${c}"
          style="background:${c};color:${textOn(c)}" title="${c}" aria-label="Colour ${c}">${c.toLowerCase() === cur.toLowerCase() ? "&#10003;" : ""}</button>`).join("")}
    </div>
    <div class="cboard-custom">
      <input type="color" class="cboard-picker" value="${cur.toLowerCase()}" aria-label="Pick a custom colour" />
      <input type="text" class="cboard-hex" maxlength="7" value="${cur}" placeholder="#RRGGBB" aria-label="Hex colour" />
      <span class="cboard-err err small"></span>
    </div>`;
  const setColor = (c) => {
    renderColorBoard(container, c, onChange);
    if (onChange) onChange(c);
  };
  container.querySelectorAll(".cswatch").forEach((b) => {
    b.onclick = () => setColor(b.dataset.c);
  });
  const picker = container.querySelector(".cboard-picker");
  if (picker) picker.onchange = () => setColor(picker.value.toUpperCase());
  const hex = container.querySelector(".cboard-hex");
  if (hex) hex.oninput = () => {
    const v = hex.value.trim();
    const errEl = container.querySelector(".cboard-err");
    if (HEX_RE.test(v)) {
      if (errEl) errEl.textContent = "";
      container.dataset.color = v.toUpperCase();
      if (onChange) onChange(v.toUpperCase());
    } else if (errEl) errEl.textContent = "Use #RRGGBB";
  };
}
function boardColor(container) {
  return safeColor(container && container.dataset.color);
}
function pickUnusedClientColor() {
  const known = (typeof CLIENTS_TAB_DATA !== "undefined" && CLIENTS_TAB_DATA.length ? CLIENTS_TAB_DATA : CLIENTS) || [];
  const used = known.map((c) => safeColor(c.color).toUpperCase()).filter(Boolean);
  return COLOR_PALETTE.find((c) => !used.includes(c)) || COLOR_PALETTE[known.length % COLOR_PALETTE.length];
}
function todayISO() {
  return (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
}
function easternMonth() {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit"
    }).formatToParts(/* @__PURE__ */ new Date());
    const y = (parts.find((p) => p.type === "year") || {}).value;
    const m = (parts.find((p) => p.type === "month") || {}).value;
    if (y && m) return `${y}-${m}`;
  } catch (e) {
  }
  const d = /* @__PURE__ */ new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
}
function monthLabel(month) {
  const m = String(month || "");
  if (!/^\d{4}-\d{2}$/.test(m)) return m;
  const names = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December"
  ];
  return `${names[Number(m.slice(5, 7)) - 1] || m} ${m.slice(0, 4)}`;
}
function show(view) {
  $("#view-login").classList.toggle("hidden", view !== "login");
  $("#view-app").classList.toggle("hidden", view !== "app");
  $("#whoami").classList.toggle("hidden", view !== "app");
}
function tab(name) {
  if (name === "progress") name = "dashboard";
  if (name === "projects") {
    name = "admin";
    __focusDepartments = true;
  }
  $$(".tabpane").forEach((p) => p.classList.add("hidden"));
  const vp = window.APP_VP && window.APP_VP.views[name];
  let pane = null;
  if (vp) {
    const old = document.getElementById("tab-" + name);
    if (old) old.remove();
    pane = document.createElement("div");
    pane.id = "tab-" + name;
    pane.className = "tabpane";
    const content = $("#main-content");
    if (content) content.appendChild(pane);
  } else {
    pane = $(`#tab-${name}`);
    if (pane) pane.classList.remove("hidden");
  }
  $$(".tab").forEach((b) => {
    const on = b.dataset.tab === name;
    b.classList.toggle("active", on);
    b.classList.toggle("cur", on);
  });
  setCrumb(name);
  if (vp && typeof vp.mount === "function" && pane) {
    try {
      vp.mount(pane);
    } catch (e) {
      console.error("view " + name + " failed to mount", e);
    }
  }
  if (name === "admin" && typeof renderDepartmentsAdmin === "function") {
    renderDepartmentsAdmin();
    if (__focusDepartments) {
      __focusDepartments = false;
      const card = document.querySelector("#departments-card");
      if (card && card.scrollIntoView) setTimeout(() => card.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
    }
  }
  if (name === "progress" && typeof loadProgress === "function") loadProgress();
}
function captureAuthHash() {
  const h = (location.hash || "").replace(/^#/, "");
  if (!h) return null;
  const p = new URLSearchParams(h);
  const tok = p.get("token");
  const authErr = p.get("auth_error");
  if (!tok && !authErr) return null;
  try {
    history.replaceState(null, "", location.pathname + location.search);
  } catch (_) {
    location.hash = "";
  }
  if (tok) {
    setToken(tok);
    return { token: tok };
  }
  return { error: authErr };
}
const GOOGLE_AUTH_ERRORS = {
  not_authorised: "That Google account is not authorised. Ask an admin to provision your tt account first.",
  state: "Sign-in session expired or was invalid. Please try again.",
  exchange_failed: "Could not complete Google sign-in. Please try again.",
  google_declined: "Google sign-in was cancelled.",
  bad_request: "Google sign-in failed. Please try again."
};
async function boot() {
  const hashAuth = captureAuthHash();
  if (hashAuth && hashAuth.error) {
    show("login");
    const el = $("#login-err");
    if (el) el.textContent = GOOGLE_AUTH_ERRORS[hashAuth.error] || "Google sign-in failed. Please try again.";
    return;
  }
  if (!token()) return show("login");
  try {
    const { user } = await api("/me");
    ME = user;
    await afterLogin();
  } catch (_) {
    setToken(null);
    show("login");
  }
}
async function afterLogin() {
  $("#who-text").textContent = `${ME.email} · ${ME.role}`;
  const meName = $("#me-name");
  if (meName) meName.textContent = ME.displayName || ME.email || "";
  const meAvatar = $("#me-avatar");
  if (meAvatar) meAvatar.textContent = initialsOf(ME.displayName || ME.email || "");
  show("app");
  const { clients } = await api("/clients");
  CLIENTS = clients;
  fillClientSelects();
  const isClientRole = ME.role === "client";
  const isAdminRole = ME.role === "admin";
  $$(".emp-tab").forEach((el) => {
    el.style.display = isClientRole ? "none" : "";
  });
  $$(".client-tab").forEach((el) => {
    el.style.display = isClientRole ? "" : "none";
  });
  if (!isClientRole) {
    $('[data-tab="invoices"]').style.display = isAdminRole ? "" : "none";
    $('[data-tab="reports"]').style.display = isAdminRole || ME.role === "employee" ? "" : "none";
    const progTab = $('[data-tab="progress"]');
    if (progTab) progTab.style.display = isAdminRole ? "" : "none";
    $('[data-tab="admin"]').style.display = isAdminRole ? "" : "none";
    $('[data-tab="clients"]').style.display = isAdminRole ? "" : "none";
    $('[data-tab="team"]').style.display = isAdminRole ? "" : "none";
    const assignTab = $('[data-tab="assignments"]');
    if (assignTab) assignTab.style.display = isAdminRole || ME.manager ? "" : "none";
    const reqTab = $('[data-tab="requests"]');
    if (reqTab) reqTab.style.display = "";
    const hbTab = $('[data-tab="hour-budgets"]');
    if (hbTab) hbTab.style.display = "";
    const projTab = $('[data-tab="projects"]');
    if (projTab) projTab.style.display = "";
    const genSection = $("#invoice-generate-section");
    if (genSection) genSection.style.display = isAdminRole ? "" : "none";
  }
  syncNav();
  _rptSyncRoleOnlyParts();
  if (window.APP_VP) window.APP_VP.render();
  const tw = $("#timer-widget");
  if (tw) tw.classList.add("hidden");
  const nb = $("#notif-bell");
  if (nb) nb.classList.toggle("hidden", isClientRole);
  const dateInput = $("#entry-date");
  if (dateInput) {
    dateInput.value = todayISO();
    dateInput.max = todayISO();
  }
  if (!isClientRole) {
    enhanceSearchableSelect($("#entry-client"), { placeholder: "Search clients..." });
    enhanceSearchableSelect($("#entry-department"), { placeholder: "Search departments..." });
  }
  if (isClientRole) {
    tab("client-dashboard");
    loadClientDashboard();
  } else {
    tab("dashboard");
    loadDashboard();
    initTimer();
    loadNotifications();
    if (typeof initDepartmentsUI === "function") initDepartmentsUI();
  }
}
function fillClientSelects() {
  const makeOpts = (disablePaused) => CLIENTS.map((c) => {
    const paused = !!c.paused;
    const col = paused ? "var(--muted, #888)" : safeColor(c.color) || "inherit";
    const label = escapeHtml(c.name) + (paused ? " (paused)" : "");
    const dis = paused && disablePaused ? " disabled" : "";
    return `<option value="${c.id}" style="color:${col}"${dis}>&#9679; ${label}</option>`;
  }).join("");
  const opts = makeOpts(false);
  const pickerOpts = makeOpts(true);
  const disableIn = /* @__PURE__ */ new Set(["#entry-client", "#timer-client", "#request-client"]);
  ["#entry-client", "#report-client", "#invoice-client", "#timer-client", "#request-client"].forEach((sel) => {
    const el = $(sel);
    if (!el) return;
    el.innerHTML = disableIn.has(sel) ? pickerOpts : opts;
    paintSelectByClient(el, el.value);
    if (!el.__paintHooked) {
      el.__paintHooked = true;
      el.addEventListener("change", () => paintSelectByClient(el, el.value));
    }
  });
  const invFilterClient = $("#inv-filter-client");
  if (invFilterClient) {
    invFilterClient.innerHTML = `<option value="">All clients</option>` + opts;
  }
  const rptFilterClient = $("#rpt-filter-client");
  if (rptFilterClient) {
    rptFilterClient.innerHTML = `<option value="">All clients</option>` + opts;
  }
}
function enhanceSearchableSelect(selectEl, { placeholder = "Search..." } = {}) {
  if (!selectEl || selectEl.__searchable) return;
  const wrap = document.createElement("div");
  wrap.className = "ss-wrap";
  const input = document.createElement("input");
  input.type = "text";
  input.className = "ss-input";
  input.autocomplete = "off";
  input.placeholder = placeholder;
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-expanded", "false");
  const list = document.createElement("ul");
  list.className = "ss-list hidden";
  list.setAttribute("role", "listbox");
  selectEl.parentNode.insertBefore(wrap, selectEl);
  wrap.appendChild(input);
  wrap.appendChild(list);
  wrap.appendChild(selectEl);
  selectEl.classList.add("ss-native");
  selectEl.removeAttribute("required");
  let open = false;
  let activeIdx = -1;
  let filtered = [];
  const opts = () => Array.from(selectEl.options).map((o) => ({ value: o.value, label: (o.textContent || "").trim() }));
  const currentLabel = () => {
    const o = selectEl.options[selectEl.selectedIndex];
    return o ? (o.textContent || "").trim() : "";
  };
  const syncTint = () => {
    input.style.borderLeft = selectEl.style.borderLeft || "";
  };
  const syncDisplay = () => {
    if (!open) {
      input.value = currentLabel();
      syncTint();
    }
  };
  function render(q) {
    const all = opts();
    const needle = (q || "").toLowerCase();
    filtered = needle ? all.filter((o) => o.label.toLowerCase().includes(needle)) : all;
    if (activeIdx >= filtered.length) activeIdx = filtered.length - 1;
    list.innerHTML = filtered.length ? filtered.map((o, i) => `<li role="option" class="ss-opt${i === activeIdx ? " active" : ""}" data-v="${escapeHtml(o.value)}" aria-selected="${o.value === selectEl.value}">${escapeHtml(o.label)}</li>`).join("") : '<li class="ss-empty" aria-disabled="true">No matches</li>';
  }
  function openList() {
    open = true;
    input.setAttribute("aria-expanded", "true");
    list.classList.remove("hidden");
    activeIdx = filtered.findIndex((o) => o.value === selectEl.value);
    render("");
  }
  function closeList() {
    open = false;
    input.setAttribute("aria-expanded", "false");
    list.classList.add("hidden");
    syncDisplay();
  }
  function choose(value) {
    if (selectEl.value !== value) {
      selectEl.value = value;
      selectEl.dispatchEvent(new Event("change", { bubbles: true }));
    }
    closeList();
  }
  input.addEventListener("focus", () => {
    openList();
    input.select();
  });
  input.addEventListener("input", () => {
    if (!open) openList();
    activeIdx = 0;
    render(input.value);
  });
  list.addEventListener("mousedown", (e) => {
    const li = e.target.closest(".ss-opt");
    if (!li) return;
    e.preventDefault();
    choose(li.dataset.v);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) openList();
      activeIdx = Math.min(activeIdx + 1, filtered.length - 1);
      render(input.value);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      activeIdx = Math.max(activeIdx - 1, 0);
      render(input.value);
    } else if (e.key === "Enter") {
      if (open && filtered[activeIdx]) {
        e.preventDefault();
        choose(filtered[activeIdx].value);
      }
    } else if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        closeList();
      }
    } else if (e.key === "Tab") {
      if (open) closeList();
    }
  });
  input.addEventListener("blur", () => {
    setTimeout(() => {
      if (open) closeList();
    }, 120);
  });
  new MutationObserver(() => {
    if (open) render(input.value);
    else syncDisplay();
  }).observe(selectEl, { childList: true });
  selectEl.__searchable = { refresh: syncDisplay };
  syncDisplay();
}
function getWeekRange() {
  const today = /* @__PURE__ */ new Date();
  const dayOfWeek = today.getDay();
  const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const monday = new Date(today);
  monday.setDate(today.getDate() - mondayOffset);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const fmt = (d) => d.toISOString().slice(0, 10);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const label = `${days[monday.getDay()]} ${months[monday.getMonth()]} ${monday.getDate()} - ${days[sunday.getDay()]} ${months[sunday.getMonth()]} ${sunday.getDate()}`;
  return { monday: fmt(monday), sunday: fmt(sunday), label };
}
async function loadDashboard() {
  const out = $("#dashboard-out");
  if (!out) return;
  const isAdmin = ME.role === "admin";
  if (isAdmin) loadWeekly(WEEKLY_WEEK);
  else {
    const w = $("#weekly-out");
    if (w) w.innerHTML = "";
  }
  try {
    const week = getWeekRange();
    if (isAdmin) {
      const lastMonday = /* @__PURE__ */ new Date(week.monday + "T12:00:00Z");
      lastMonday.setUTCDate(lastMonday.getUTCDate() - 7);
      const lastSunday = new Date(lastMonday);
      lastSunday.setUTCDate(lastMonday.getUTCDate() + 6);
      const lastWeek = { monday: lastMonday.toISOString().slice(0, 10), sunday: lastSunday.toISOString().slice(0, 10) };
      let reportData, meData, lastWeekCents = 0;
      try {
        const [curRes, meRes, lwRes] = await Promise.all([
          api(`/reports/summary?from=${week.monday}&to=${week.sunday}`),
          api("/me/summary"),
          api(`/reports/summary?from=${lastWeek.monday}&to=${lastWeek.sunday}`).catch(() => null)
        ]);
        reportData = curRes;
        meData = meRes;
        if (lwRes && lwRes.totals) lastWeekCents = lwRes.totals.billable_cents || 0;
      } catch (_) {
        const entries = (await api(`/time-entries?limit=200`)).entries || [];
        const lwEntries = entries.filter((e) => e.entry_date >= lastWeek.monday && e.entry_date <= lastWeek.sunday);
        for (const e of lwEntries) {
          if (e.is_billable) lastWeekCents += Math.round((Number(e.hours) || 0) * (e.rate_cents || 0));
        }
        const weekEntries = entries.filter((e) => e.entry_date >= week.monday && e.entry_date <= week.sunday);
        let billH = 0, intH = 0, billCents = 0;
        const clientMap = {}, empMap = {};
        for (const e of weekEntries) {
          const h = Number(e.hours) || 0;
          if (e.is_billable) {
            billH += h;
            billCents += Math.round(h * (e.rate_cents || 0));
          } else intH += h;
          const cn = e.client_name || "Unknown";
          if (!clientMap[cn]) clientMap[cn] = { name: cn, total_hours: 0, billable_hours: 0, internal_hours: 0, billable_cents: 0, hours_cap: null };
          clientMap[cn].total_hours += h;
          if (e.is_billable) {
            clientMap[cn].billable_hours += h;
            clientMap[cn].billable_cents += Math.round(h * (e.rate_cents || 0));
          } else clientMap[cn].internal_hours += h;
          const en = e.user_display_name || e.user_email || "Unknown";
          if (!empMap[en]) empMap[en] = { display_name: en, total_hours: 0, clients: {}, client_count: 0 };
          empMap[en].total_hours += h;
          if (!empMap[en].clients[cn]) empMap[en].clients[cn] = 0;
          empMap[en].clients[cn] += h;
        }
        for (const emp of Object.values(empMap)) {
          emp.client_count = Object.keys(emp.clients).length;
          emp.clients = Object.entries(emp.clients).map(([n, h]) => ({ client_name: n, hours: Number(h.toFixed(2)) }));
        }
        for (const c of Object.values(clientMap)) {
          const match = CLIENTS.find((cl) => cl.name === c.name);
          if (match) {
            c.hours_cap = match.hours_cap;
            c.currency = match.currency;
          }
          c.billable_amount = (c.billable_cents / 100).toFixed(2);
          c.cap_utilization = c.hours_cap ? c.billable_hours / c.hours_cap * 100 : null;
        }
        reportData = {
          totals: { total_hours: billH + intH, billable_hours: billH, internal_hours: intH, billable_cents: billCents, billable_amount: (billCents / 100).toFixed(2) },
          clients: Object.values(clientMap).sort((a, b) => b.billable_hours - a.billable_hours),
          employees: Object.values(empMap).sort((a, b) => b.total_hours - a.total_hours)
        };
        meData = { summary: {} };
      }
      const t = reportData.totals || {};
      const clients = reportData.clients || [];
      const employees = reportData.employees || [];
      const summary = meData.summary || {};
      const maxEmpHours = Math.max(...employees.map((e) => Number(e.total_hours) || 0), 1);
      let teamHtml = "";
      if (employees.length > 0) {
        const teamRows = employees.map((emp) => {
          const hours = Number(emp.total_hours) || 0;
          const parts = (emp.clients || []).slice().sort((a, b) => Number(b.hours) - Number(a.hours));
          const segTotal = parts.reduce((s, c) => s + (Number(c.hours) || 0), 0) || hours || 1;
          const segs = parts.map((c) => {
            const col = clientColorByName(c.client_name) || "var(--accent)";
            const w = (Number(c.hours) || 0) / segTotal * 100;
            const h = (Number(c.hours) || 0).toFixed(2);
            return `<div class="stack-seg" style="width:${w}%;background:${col}" tabindex="0" title="${escapeHtml(c.client_name)} — ${h}h" aria-label="${escapeHtml(c.client_name)}: ${h} hours"></div>`;
          }).join("");
          const clientChips = parts.map((c) => {
            const col = clientColorByName(c.client_name) || "var(--accent)";
            return `<span class="client-chip"><span class="cdot" style="background:${col}"></span>${escapeHtml(c.client_name)} ${(Number(c.hours) || 0).toFixed(2)}h</span>`;
          }).join("");
          return `<tr>
            <td>${escapeHtml(emp.display_name || emp.email)}</td>
            <td>
              <div class="dash-team-hours-bar">
                <div class="bar-track stacked" title="${hours.toFixed(2)}h across ${parts.length} client${parts.length === 1 ? "" : "s"}">${segs || '<div class="stack-seg stack-seg-empty"></div>'}</div>
                <span class="bar-value">${hours.toFixed(1)}h</span>
              </div>
              ${clientChips ? `<div class="dash-team-clients">${clientChips}</div>` : ""}
            </td>
            <td class="num">${emp.client_count || 0}</td>
          </tr>`;
        }).join("");
        teamHtml = `
          <div class="dash-section-header">Team Member Hours</div>
          <table class="dash-team-table">
            <thead><tr><th>Team Member</th><th>Hours</th><th class="num">Clients</th></tr></thead>
            <tbody>${teamRows}</tbody>
          </table>
        `;
      }
      let clientCapHtml = "";
      if (clients.length > 0) {
        const dayOfWeek = (/* @__PURE__ */ new Date()).getDay();
        const isWedOrLater = dayOfWeek >= 3 || dayOfWeek === 0;
        const clientRows = clients.map((c) => {
          const hours = Number(c.total_hours) || 0;
          const cap = Number(c.hours_cap) || 0;
          const util = cap > 0 ? Number(c.cap_utilization) || hours / cap * 100 : 0;
          const barColor = cap === 0 ? "var(--accent)" : util > 90 ? "var(--danger)" : util > 70 ? "var(--warn)" : "var(--ok)";
          const pctColor = barColor;
          const barWidth = cap > 0 ? Math.min(util, 100) : 0;
          const capLabel = cap > 0 ? `${hours.toFixed(1)}h / ${cap}h` : `${hours.toFixed(1)}h (no cap)`;
          let warningHtml = "";
          if (cap > 0 && isWedOrLater) {
            if (util >= 90) {
              warningHtml = ' <span class="dash-warning dash-warning-red">Approaching Max Hours</span>';
            } else if (util < 50) {
              warningHtml = ' <span class="dash-warning dash-warning-yellow">Low Work Reported</span>';
            }
          }
          return `
            <div class="dash-client-row">
              <span class="dash-client-name">${cdotName(c.name)}${escapeHtml(c.name)}${warningHtml}</span>
              <div class="dash-client-progress">
                ${cap > 0 ? `
                  <div class="dash-client-bar-track">
                    <div class="dash-client-bar-fill" style="width:${barWidth}%;background:${barColor}"></div>
                  </div>
                  <div class="dash-client-bar-labels">
                    <span>${capLabel}</span>
                  </div>
                ` : `<div class="dash-client-bar-labels"><span>${capLabel}</span></div>`}
              </div>
              ${cap > 0 ? `<span class="dash-client-pct" style="color:${pctColor}">${util.toFixed(0)}%</span>` : '<span class="dash-client-pct" style="color:var(--muted)">--</span>'}
              <span class="dash-client-revenue">$${escapeHtml(c.billable_amount || "0.00")}</span>
            </div>
          `;
        }).join("");
        clientCapHtml = `
          <div class="dash-section-header">Client Projects vs Weekly Cap</div>
          <div class="dash-client-grid">${clientRows}</div>
        `;
      }
      out.innerHTML = teamHtml + clientCapHtml;
    } else {
      let summary = {};
      try {
        summary = (await api("/me/summary")).summary || {};
      } catch (_) {
        const entries = (await api("/time-entries?limit=200")).entries || [];
        const todayStr = todayISO();
        const todayH = entries.filter((e) => e.entry_date === todayStr).reduce((s, e) => s + Number(e.hours), 0);
        const weekH = entries.filter((e) => e.entry_date >= getWeekRange().monday).reduce((s, e) => s + Number(e.hours), 0);
        summary = { today_hours: todayH, week_hours: weekH, pending_timesheets: 0, recent: entries.slice(0, 5) };
      }
      const week2 = getWeekRange();
      let empClients = [];
      try {
        if (tsIsManager() !== true) throw new Error("employees use their own entries");
        const reportData = await api(`/reports/summary?from=${week2.monday}&to=${week2.sunday}`);
        const myEmp = (reportData.employees || []).find((e) => e.email === ME.email);
        if (myEmp) empClients = myEmp.clients || [];
      } catch (_) {
        const entries = (await api("/time-entries?limit=200")).entries || [];
        const weekEntries = entries.filter((e) => e.entry_date >= week2.monday && e.entry_date <= week2.sunday);
        const byClient = {};
        for (const e of weekEntries) {
          const n = e.client_name || "Unknown";
          byClient[n] = (byClient[n] || 0) + Number(e.hours);
        }
        empClients = Object.entries(byClient).map(([client_name, hours]) => ({ client_name, hours: Number(hours.toFixed(2)) }));
      }
      const timerHtml = summary.timer ? `
        <div class="dash-emp-card" style="border-color:var(--ok)">
          <div class="dash-emp-card-value" style="color:var(--ok)">Active</div>
          <div class="dash-emp-card-label">Timer: ${escapeHtml(summary.timer.client_name || "")}</div>
        </div>` : "";
      const clientBreakdown = empClients.length > 0 ? `
        <div class="dash-section-header">Your Hours by Client</div>
        <div class="dash-client-grid">
          ${empClients.map((c) => `
            <div class="dash-client-row">
              <span class="dash-client-name">${cdotName(c.client_name)}${escapeHtml(c.client_name)}</span>
              <span class="dash-client-revenue" style="font-size:15px">${Number(c.hours).toFixed(1)}h</span>
            </div>
          `).join("")}
        </div>` : "";
      out.innerHTML = `
        <div class="dash-emp-cards">
          <div class="dash-emp-card">
            <div class="dash-emp-card-value">${Number(summary.today_hours || 0).toFixed(1)}h</div>
            <div class="dash-emp-card-label">Today</div>
          </div>
          <div class="dash-emp-card">
            <div class="dash-emp-card-value">${Number(summary.week_hours || 0).toFixed(1)}h</div>
            <div class="dash-emp-card-label">This Week</div>
          </div>
          <div class="dash-emp-card">
            <div class="dash-emp-card-value">${summary.pending_timesheets || 0}</div>
            <div class="dash-emp-card-label">Pending Timesheets</div>
          </div>
          ${timerHtml}
        </div>
        <div class="dash-revenue-label" style="text-align:center;margin-bottom:16px">Week of ${week2.label}</div>
        ${clientBreakdown}
        ${summary.recent && summary.recent.length > 0 ? `
          <div class="dash-section-header">Recent Entries</div>
          <table class="dash-team-table">
            <thead><tr><th>Date</th><th>Client</th><th>Task</th><th class="num">Hours</th><th>Status</th></tr></thead>
            <tbody>
            ${summary.recent.map((e) => `<tr>
              <td>${e.entry_date}</td>
              <td>${cdotName(e.client_name)}${escapeHtml(e.client_name || "")}</td>
              <td>${escapeHtml(e.project_task || "")}</td>
              <td class="num">${e.hours}</td>
              <td><span class="status-badge ${e.approval_status}">${e.approval_status}</span>${e.locked ? " locked" : ""}</td>
            </tr>`).join("")}
            </tbody>
          </table>` : ""}
      `;
    }
  } catch (e) {
    out.innerHTML = `<p class="err">${escapeHtml(e.message)}</p>`;
  }
  await renderMyHourBudget();
}
function initTimer() {
  loadTimerState();
  checkServerTimer();
}
function loadTimerState() {
  const saved = localStorage.getItem(TIMER_KEY);
  if (saved) {
    try {
      const state = JSON.parse(saved);
      if (state && state.started_at) {
        showTimerRunning(state);
      }
    } catch (_) {
    }
  }
}
async function checkServerTimer() {
  try {
    const { timer } = await api("/timer/current");
    if (timer) {
      localStorage.setItem(TIMER_KEY, JSON.stringify(timer));
      showTimerRunning(timer);
    } else {
      localStorage.removeItem(TIMER_KEY);
      showTimerIdle();
    }
  } catch (_) {
  }
}
function showTimerIdle() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  const idle = $("#timer-idle");
  const running = $("#timer-running");
  if (idle) idle.classList.remove("hidden");
  if (running) running.classList.add("hidden");
  const stopBtn = $("#tracker-stop-btn");
  const timerDisplay = $("#tracker-timer-display");
  if (stopBtn) stopBtn.classList.add("hidden");
  if (timerDisplay) {
    timerDisplay.textContent = "00:00:00";
    timerDisplay.classList.remove("running");
  }
  const pill = $("#timer-pill");
  if (pill) pill.classList.remove("on");
  const pillClient = $("#pill-client");
  if (pillClient) pillClient.textContent = "No timer";
  const pillClock = $("#pill-clock");
  if (pillClock) pillClock.textContent = "0:00:00";
  const pillStop = $("#pill-stop");
  if (pillStop) pillStop.classList.add("hidden");
  applyTrackerMode();
}
function showTimerRunning(timer) {
  const idle = $("#timer-idle");
  const running = $("#timer-running");
  if (idle) idle.classList.add("hidden");
  if (running) running.classList.remove("hidden");
  const cn = $("#timer-client-name");
  const tn = $("#timer-task-name");
  if (cn) cn.innerHTML = cdot(clientColorById(timer.client_id)) + escapeHtml(timer.client_name || "");
  paintSelectByClient($("#entry-client"), timer.client_id);
  if (tn) tn.textContent = timer.project_task || "";
  const pill = $("#timer-pill");
  if (pill) pill.classList.add("on");
  const pillClient = $("#pill-client");
  if (pillClient) pillClient.textContent = timer.client_name || timer.project_task || "Timer running";
  const pillStop = $("#pill-stop");
  if (pillStop) pillStop.classList.remove("hidden");
  trackerMode = "timer";
  const startBtn = $("#tracker-start-btn");
  const stopBtn = $("#tracker-stop-btn");
  const logBtn = $("#tracker-log-btn");
  const timerDisplay = $("#tracker-timer-display");
  const taskInput = $("#tracker-task");
  const clientSelect = $("#entry-client");
  const timePickers = $("#tracker-time-pickers");
  const modeToggle = $("#tracker-mode-toggle");
  if (startBtn) startBtn.classList.add("hidden");
  if (stopBtn) stopBtn.classList.remove("hidden");
  if (logBtn) logBtn.classList.add("hidden");
  if (timePickers) timePickers.classList.add("hidden");
  if (modeToggle) modeToggle.classList.add("hidden");
  if (timerDisplay) {
    timerDisplay.classList.add("running");
    timerDisplay.classList.remove("manual-calc", "hidden");
  }
  if (taskInput && timer.project_task) taskInput.value = timer.project_task;
  if (clientSelect && timer.client_id) clientSelect.value = timer.client_id;
  if (timerInterval) clearInterval(timerInterval);
  const startedMs = new Date(timer.started_at).getTime();
  function tick() {
    const elapsed = Date.now() - startedMs;
    if (timerDisplay) timerDisplay.textContent = formatElapsed(elapsed);
    const el = $("#timer-elapsed");
    if (el) el.textContent = formatElapsed(elapsed);
    const pillClock = $("#pill-clock");
    if (pillClock) pillClock.textContent = formatElapsed(elapsed);
  }
  tick();
  timerInterval = setInterval(tick, 1e3);
}
function formatElapsed(ms) {
  const totalSec = Math.floor(ms / 1e3);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor(totalSec % 3600 / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
async function handleTimerStart() {
  const clientId = ($("#entry-client") || $("#timer-client"))?.value;
  const departmentId = ($("#entry-department") || {}).value || "";
  const task = ($("#tracker-task") || $("#timer-task"))?.value || "";
  if (!clientId) return;
  if (!departmentId) {
    const errEl = $("#entry-err");
    if (errEl) errEl.textContent = "Pick a department before starting the timer.";
    else alert("Pick a department before starting the timer.");
    return;
  }
  try {
    const { timer } = await api("/timer/start", {
      method: "POST",
      body: { client_id: clientId, department_id: departmentId, project_task: task }
    });
    localStorage.setItem(TIMER_KEY, JSON.stringify(timer));
    showTimerRunning(timer);
  } catch (e) {
    alert(e.code === "client_paused" ? PAUSED_MSG : e.message);
  }
}
function finishTimerStop(result) {
  localStorage.removeItem(TIMER_KEY);
  showTimerIdle();
  if (result.discarded) {
    alert("Timer discarded: it ran for less than 1 minute, so nothing was logged.");
  } else {
    alert(`Logged ${result.elapsed_minutes} min (${formatHoursAsDuration(result.elapsed_hours)}).`);
    loadEntries();
  }
  loadDashboard();
}
async function handleTimerStop() {
  try {
    finishTimerStop(await api("/timer/stop", { method: "POST" }));
  } catch (e) {
    if (e.code === "department_required" || e.code === "department_hidden") {
      if (typeof loadDepartments === "function") await loadDepartments();
      const choice = pickDepartmentForStop();
      if (!choice) return;
      try {
        finishTimerStop(await api("/timer/stop", { method: "POST", body: { department_id: choice } }));
      } catch (e2) {
        alert(e2.message);
      }
      return;
    }
    alert(e.message);
  }
}
let ENTRY_FOR_STAFF = null;
let ENTRY_FOR_STAFF_LOADED = false;
function isAdminMe() {
  return !!(ME && ME.role === "admin");
}
function entryForDisplay(s) {
  const name = s && s.name || "";
  const email = s && s.email || "";
  if (!email || email.toLowerCase() === name.toLowerCase()) return name;
  return name + " — " + email;
}
async function ensureEntryForStaff() {
  if (ENTRY_FOR_STAFF_LOADED) return ENTRY_FOR_STAFF || [];
  ENTRY_FOR_STAFF_LOADED = true;
  try {
    const { users } = await api("/admin/users");
    ENTRY_FOR_STAFF = (users || []).filter((u) => u && u.role !== "client" && u.active !== 0 && u.active !== false).map((u) => ({ id: u.id, name: u.display_name || u.email || "", email: u.email || "" })).filter((s) => s.name);
    const list = document.querySelector("#entry-for-staff");
    if (list) {
      list.innerHTML = ENTRY_FOR_STAFF.map((s) => `<option value="${escapeHtml(entryForDisplay(s))}" label="${escapeHtml(s.email)}"></option>`).join("");
    }
  } catch (_) {
    ENTRY_FOR_STAFF = [];
  }
  return ENTRY_FOR_STAFF || [];
}
function resolveEntryFor() {
  const el = document.querySelector("#entry-for");
  const text = (el && el.value || "").trim();
  if (!text) return { ok: true, userId: null };
  const staff = ENTRY_FOR_STAFF || [];
  const low = text.toLowerCase();
  const hits = staff.filter((s) => entryForDisplay(s).toLowerCase() === low || s.name.toLowerCase() === low || (s.email || "").toLowerCase() === low);
  if (hits.length === 1) return { ok: true, userId: hits[0].id };
  if (hits.length > 1) {
    return { ok: false, error: "More than one person has that name — pick the one you mean from the list." };
  }
  return { ok: false, error: "Pick a person from the list (or clear the field to log for yourself)." };
}
function refreshEntryForPicker() {
  const wrap = document.querySelector("#entry-for-wrap");
  if (!wrap) return;
  const show2 = isAdminMe() && trackerMode === "manual";
  wrap.classList.toggle("hidden", !show2);
  if (show2) ensureEntryForStaff();
}
function applyTrackerMode() {
  const startBtn = $("#tracker-start-btn");
  const logBtn = $("#tracker-log-btn");
  const timePickers = $("#tracker-time-pickers");
  const quick = $("#tracker-quick");
  const timerDisplay = $("#tracker-timer-display");
  const modeToggle = $("#tracker-mode-toggle");
  const iconTimer = $("#mode-icon-timer");
  const iconManual = $("#mode-icon-manual");
  if (modeToggle) modeToggle.classList.remove("hidden");
  if (trackerMode === "manual") {
    if (startBtn) startBtn.classList.add("hidden");
    if (logBtn) logBtn.classList.remove("hidden");
    if (timePickers) timePickers.classList.remove("hidden");
    if (quick) quick.classList.remove("hidden");
    if (timerDisplay) {
      timerDisplay.classList.remove("running", "hidden");
      timerDisplay.classList.add("manual-calc");
    }
    if (modeToggle) modeToggle.classList.add("active");
    if (iconTimer) iconTimer.classList.add("hidden");
    if (iconManual) iconManual.classList.remove("hidden");
    calculateManualHours();
    setTimeHint("");
  } else {
    if (startBtn) startBtn.classList.remove("hidden");
    if (logBtn) logBtn.classList.add("hidden");
    if (timePickers) timePickers.classList.add("hidden");
    if (quick) quick.classList.add("hidden");
    if (timerDisplay) {
      timerDisplay.textContent = "00:00:00";
      timerDisplay.classList.remove("manual-calc", "hidden");
    }
    if (modeToggle) modeToggle.classList.remove("active");
    if (iconTimer) iconTimer.classList.remove("hidden");
    if (iconManual) iconManual.classList.add("hidden");
  }
  refreshEntryForPicker();
}
function toggleTrackerMode() {
  trackerMode = trackerMode === "timer" ? "manual" : "timer";
  applyTrackerMode();
}
function parseTimeToMinutes(str) {
  if (typeof TTApp !== "undefined") return TTApp.parseTimeToMinutes(str);
  const m = String(str || "").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = +m[1];
  const mi = +m[2];
  return h > 23 || mi > 59 ? null : h * 60 + mi;
}
function calculateManualHours() {
  const startStr = ($("#tracker-start-time") || {}).value || "";
  const endStr = ($("#tracker-end-time") || {}).value || "";
  const timerDisplay = $("#tracker-timer-display");
  const hoursInput = $("#tracker-hours");
  const startMin = parseTimeToMinutes(startStr);
  const endMin = parseTimeToMinutes(endStr);
  if (startMin === null || endMin === null) {
    if (timerDisplay) timerDisplay.textContent = "00:00:00";
    if (hoursInput) hoursInput.value = "";
    return;
  }
  let diffMin = endMin - startMin;
  if (diffMin < 0) diffMin += 24 * 60;
  const hours = diffMin / 60;
  const h = Math.floor(diffMin / 60);
  const m = diffMin % 60;
  if (timerDisplay) timerDisplay.textContent = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;
  if (hoursInput) hoursInput.value = hours.toFixed(4);
}
function setTimeHint(msg) {
  const el = $("#tracker-time-hint");
  if (el) el.textContent = msg || "";
}
function formatTimeInput(input) {
  let val = input.value.replace(/[^\d:]/g, "");
  const firstColon = val.indexOf(":");
  if (firstColon !== -1) {
    val = val.slice(0, firstColon + 1) + val.slice(firstColon + 1).replace(/:/g, "");
  }
  if (val !== input.value) input.value = val;
  const r = typeof TTApp !== "undefined" ? TTApp.normalizeTime(val) : { ok: true };
  input.classList.toggle("invalid", !r.ok);
  if (r.ok) setTimeHint("");
}
function normalizeTimeField(input) {
  if (typeof TTApp === "undefined") return;
  const r = TTApp.normalizeTime(input.value);
  if (!r.ok) {
    input.classList.add("invalid");
    setTimeHint("Use 24-hour time, e.g. 0930 or 18:00 (00:00-23:59).");
    return;
  }
  input.classList.remove("invalid");
  input.value = r.value;
  setTimeHint("");
}
async function logManualEntry(hours, { clearTimes = false } = {}) {
  const errEl = $("#entry-err");
  if (errEl) errEl.textContent = "";
  const clientId = ($("#entry-client") || {}).value || "";
  const departmentId = ($("#entry-department") || {}).value || "";
  const task = (($("#tracker-task") || {}).value || "").trim();
  const isBillable = !!($('#entry-form input[name="is_billable"]') || {}).checked;
  const entryType = ($("#entry-type") || {}).value || "work";
  const entryDate = ($("#entry-date") || {}).value || todayISO();
  const forTarget = resolveEntryFor();
  if (!forTarget.ok) {
    if (errEl) errEl.textContent = forTarget.error;
    return false;
  }
  if (!clientId) {
    if (errEl) errEl.textContent = "Pick a client first.";
    return false;
  }
  if (!departmentId) {
    if (errEl) errEl.textContent = "Pick a department before logging hours.";
    return false;
  }
  if (!hours || hours <= 0) {
    if (errEl) errEl.textContent = "Nothing to log.";
    return false;
  }
  const effectiveNotes = task;
  if (isBillable && entryType === "work" && !effectiveNotes) {
    if (errEl) errEl.textContent = "A task description is required for billable entries.";
    return false;
  }
  try {
    const body = {
      client_id: clientId,
      department_id: departmentId || null,
      project_task: task,
      entry_date: entryDate,
      hours,
      is_billable: isBillable,
      entry_type: entryType,
      notes: effectiveNotes
    };
    if (forTarget.userId) body.user_id = forTarget.userId;
    await api("/time-entries", { method: "POST", body });
    const taskInput = $("#tracker-task");
    if (taskInput) taskInput.value = "";
    const hoursInput = $("#tracker-hours");
    if (hoursInput) hoursInput.value = "";
    const timerDisplay = $("#tracker-timer-display");
    if (timerDisplay) timerDisplay.textContent = "00:00:00";
    if (clearTimes) {
      const s = $("#tracker-start-time");
      if (s) s.value = "";
      const e = $("#tracker-end-time");
      if (e) e.value = "";
      setTimeHint("");
    }
    loadEntries();
    loadTimesheets();
    return true;
  } catch (e) {
    if (errEl) errEl.textContent = e.code === "client_paused" ? PAUSED_MSG : e.message;
    if (e.code === "client_not_assigned" && e.data && e.data.client_id && errEl) {
      const btn = document.createElement("button");
      btn.className = "act-btn";
      btn.type = "button";
      btn.textContent = "Request access";
      btn.onclick = async () => {
        try {
          await api("/work-requests", {
            method: "POST",
            body: { client_id: e.data.client_id, note: `Requested from the time tracker (${e.data.client_name || e.data.client_id})` }
          });
          btn.textContent = "Requested, waiting for approval";
          btn.disabled = true;
        } catch (err2) {
          alert(err2.message);
        }
      };
      errEl.appendChild(document.createElement("br"));
      errEl.appendChild(btn);
    }
    return false;
  }
}
async function loadNotifications() {
  try {
    const { notifications, unread_count } = await api("/notifications");
    const countEl = $("#notif-count");
    const listEl = $("#notif-list");
    if (countEl) {
      const n = Number(unread_count) || 0;
      countEl.textContent = String(n);
      countEl.classList.toggle("hidden", n === 0);
    }
    if (listEl) {
      if (!notifications || notifications.length === 0) {
        listEl.innerHTML = '<div class="notif-empty">No notifications</div>';
      } else {
        listEl.innerHTML = notifications.map((n) => `
          <div class="notif-item ${n.read ? "" : "unread"}" data-nid="${n.id}" data-read="${n.read}">
            <div>${escapeHtml(n.message)}</div>
            <div class="notif-time">${timeAgo(n.created_at)}</div>
          </div>
        `).join("");
        listEl.querySelectorAll(".notif-item").forEach((item) => {
          item.onclick = async () => {
            if (item.dataset.read === "0") {
              try {
                await api(`/notifications/${item.dataset.nid}/read`, { method: "PATCH" });
                item.classList.remove("unread");
                item.dataset.read = "1";
                const countEl2 = $("#notif-count");
                if (countEl2) {
                  const cur = parseInt(countEl2.textContent, 10) || 0;
                  const next = Math.max(0, cur - 1);
                  countEl2.textContent = String(next);
                  countEl2.classList.toggle("hidden", next === 0);
                }
              } catch (_) {
              }
            }
          };
        });
      }
    }
  } catch (_) {
  }
}
function timeAgo(isoStr) {
  if (!isoStr) return "";
  const diff = Date.now() - (/* @__PURE__ */ new Date(isoStr + "Z")).getTime();
  const mins = Math.floor(diff / 6e4);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}
let entriesOffset = 0;
const ENTRIES_LIMIT = 200;
function formatHoursAsDuration(hours) {
  const totalMin = Math.round(hours * 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}:${String(m).padStart(2, "0")}:00`;
}
function formatDayHeader(dateStr) {
  const parts = dateStr.split("-");
  const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const today = todayISO();
  const yesterday = /* @__PURE__ */ new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayISO = yesterday.toISOString().slice(0, 10);
  let label = `${days[d.getDay()]}, ${months[d.getMonth()]} ${d.getDate()}`;
  if (dateStr === today) label = `Today - ${label}`;
  else if (dateStr === yesterdayISO) label = `Yesterday - ${label}`;
  return label;
}
function groupEntriesByDate(entries) {
  const groups = {};
  for (const e of entries) {
    const date = e.entry_date;
    if (!groups[date]) groups[date] = [];
    groups[date].push(e);
  }
  const sortedDates = Object.keys(groups).sort((a, b) => b.localeCompare(a));
  return sortedDates.map((date) => ({
    date,
    entries: groups[date].sort((a, b) => (b.created_at || "").localeCompare(a.created_at || "")),
    totalHours: groups[date].reduce((sum, e) => sum + Number(e.hours), 0)
  }));
}
const PIE_COLORS = ["#2A93C1", "#F1420B", "#3fb950", "#ED6626", "#3B9BD5", "#A78BFA", "#3A60AB", "#009DD9", "#34D399", "#E879F9"];
function renderWeeklyPie(entries) {
  const container = $("#weekly-pie-container");
  const svg = $("#weekly-pie-svg");
  const legend = $("#weekly-pie-legend");
  if (!container || !svg || !legend) return;
  const now = /* @__PURE__ */ new Date();
  const dow = now.getDay();
  const monOff = dow === 0 ? 6 : dow - 1;
  const monday = new Date(now);
  monday.setDate(now.getDate() - monOff);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const monStr = monday.toISOString().slice(0, 10);
  const sunStr = sunday.toISOString().slice(0, 10);
  const weekEntries = entries.filter((e) => e.entry_date >= monStr && e.entry_date <= sunStr);
  if (weekEntries.length === 0) {
    container.classList.add("hidden");
    return;
  }
  const byClient = {};
  for (const e of weekEntries) {
    const name = e.client_name || "Unknown";
    if (!byClient[name]) byClient[name] = 0;
    byClient[name] += Number(e.hours);
  }
  const sorted = Object.entries(byClient).sort((a, b) => b[1] - a[1]);
  const total = sorted.reduce((s, [, h]) => s + h, 0);
  const rangeEl = $("#weekly-pie-range");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  if (rangeEl) rangeEl.textContent = `${months[monday.getMonth()]} ${monday.getDate()} - ${months[sunday.getMonth()]} ${sunday.getDate()}`;
  const cx = 100, cy = 100, r = 85;
  let startAngle = -Math.PI / 2;
  let paths = "";
  if (sorted.length === 1) {
    paths = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${PIE_COLORS[0]}" />`;
  } else {
    sorted.forEach(([, hours], i) => {
      const pct = hours / total;
      const angle = pct * 2 * Math.PI;
      const endAngle = startAngle + angle;
      const largeArc = angle > Math.PI ? 1 : 0;
      const x1 = cx + r * Math.cos(startAngle);
      const y1 = cy + r * Math.sin(startAngle);
      const x2 = cx + r * Math.cos(endAngle);
      const y2 = cy + r * Math.sin(endAngle);
      const color = PIE_COLORS[i % PIE_COLORS.length];
      paths += `<path d="M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${largeArc},1 ${x2},${y2} Z" fill="${color}" />`;
      startAngle = endAngle;
    });
  }
  paths += `<circle cx="${cx}" cy="${cy}" r="50" fill="var(--panel)" />`;
  const totalH = Math.floor(total);
  const totalM = Math.round((total - totalH) * 60);
  paths += `<text x="${cx}" y="${cy - 4}" text-anchor="middle" fill="var(--ink)" font-size="18" font-weight="700">${totalH}:${String(totalM).padStart(2, "0")}</text>`;
  paths += `<text x="${cx}" y="${cy + 14}" text-anchor="middle" fill="var(--muted)" font-size="11">total</text>`;
  svg.innerHTML = paths;
  legend.innerHTML = sorted.map(([name, hours], i) => {
    const pct = (hours / total * 100).toFixed(0);
    return `<div class="pie-legend-item">
      <span class="pie-legend-swatch" style="background:${PIE_COLORS[i % PIE_COLORS.length]}"></span>
      <span class="pie-legend-name">${escapeHtml(name)}</span>
      <span class="pie-legend-hours">${formatHoursAsDuration(hours)}</span>
      <span class="pie-legend-pct">${pct}%</span>
    </div>`;
  }).join("");
  container.classList.remove("hidden");
}
function enteredByLabel(e) {
  if (!e || !e.entered_by || e.entered_by === e.user_id) return "";
  const who = e.entered_by_name || e.entered_by_email || "an admin";
  return ` <span class="entry-entered-by muted small" title="Typed by ${escapeHtml(who)}">entered by ${escapeHtml(who)}</span>`;
}
async function loadEntries(offset) {
  if (offset !== void 0) entriesOffset = offset;
  const raw = await api(`/time-entries?limit=${ENTRIES_LIMIT}&offset=${entriesOffset}`);
  rememberEntries(raw.entries);
  const entries = (raw.entries || []).filter((e) => e.user_id === ME.userId);
  const container = $("#entries-grouped");
  if (!container) return;
  if (!entries || entries.length === 0) {
    container.innerHTML = '<div class="entries-empty"><p>No time entries yet.</p><p class="muted small">Start the timer or add a manual entry above.</p></div>';
    const pg2 = $("#entries-pagination");
    if (pg2) pg2.innerHTML = "";
    const pieC = $("#weekly-pie-container");
    if (pieC) pieC.classList.add("hidden");
    return;
  }
  const dayGroups = groupEntriesByDate(entries);
  renderWeeklyPie(entries);
  const weekTotal = entries.reduce((sum, e) => {
    const today = /* @__PURE__ */ new Date();
    const dayOfWeek = today.getDay();
    const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const monday = new Date(today);
    monday.setDate(today.getDate() - mondayOffset);
    const mondayStr = monday.toISOString().slice(0, 10);
    if (e.entry_date >= mondayStr) return sum + Number(e.hours);
    return sum;
  }, 0);
  const weekEl = $("#tracker-week-hours");
  if (weekEl) weekEl.textContent = formatHoursAsDuration(weekTotal);
  container.innerHTML = dayGroups.map((group) => `
    <div class="day-group">
      <div class="day-header">
        <span class="day-header-date">${formatDayHeader(group.date)}</span>
        <span class="day-header-total">${formatHoursAsDuration(group.totalHours)}</span>
      </div>
      ${group.entries.map((e) => `
        <div class="entry-row" data-eid="${e.id}" style="${leftBarStyle(clientColorById(e.client_id))}">
          <div class="entry-desc">${e.project_task ? escapeHtml(e.project_task) : '<span class="no-desc">No description</span>'}${enteredByLabel(e)}</div>
          <span class="entry-tag" style="${clientColorById(e.client_id) ? `background:${clientColorById(e.client_id)};color:${textOn(clientColorById(e.client_id))};` : ""}">${escapeHtml(e.client_name || "")}</span>
          <span class="entry-type-badge ${e.entry_type || "work"}">${(e.entry_type || "work").replace("_", " ")}</span>
          <span class="entry-billable-indicator ${e.is_billable ? "billable" : "internal"}" title="${e.is_billable ? "Billable" : "Internal"}">${e.is_billable ? "$" : "-"}</span>
          <span class="entry-status-col"><span class="status-badge ${e.approval_status}">${e.approval_status}</span>${e.locked || e.locked_kind ? ` <span class="muted small">${ic("lock")} locked</span>` : ""}</span>
          <span class="entry-hours">${formatHoursAsDuration(e.hours)}</span>
          <div class="entry-actions">
            ${renderEntryPlayBtn(e)}
            ${renderEntryActions(e)}
          </div>
        </div>
      `).join("")}
    </div>
  `).join("");
  bindEntryActions();
  bindEntryPlayBtns();
  const pg = $("#entries-pagination");
  if (pg) {
    const hasPrev = entriesOffset > 0;
    const hasNext = entries.length >= ENTRIES_LIMIT;
    pg.innerHTML = `
      ${hasPrev ? `<button class="link" id="entries-prev">Previous</button>` : ""}
      <span class="muted small">Showing ${entriesOffset + 1}-${entriesOffset + entries.length}</span>
      ${hasNext ? `<button class="link" id="entries-next">Next</button>` : ""}
    `;
    const prev = $("#entries-prev");
    const next = $("#entries-next");
    if (prev) prev.onclick = () => loadEntries(Math.max(0, entriesOffset - ENTRIES_LIMIT));
    if (next) next.onclick = () => loadEntries(entriesOffset + ENTRIES_LIMIT);
  }
}
function renderEntryPlayBtn(e) {
  if (e.locked) return "";
  return `<button class="entry-play-btn" data-act="replay" data-client="${e.client_id || ""}" data-dept="${e.department_id || ""}" data-task="${escapeHtml(e.project_task || "")}" title="Start this task again">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
  </button>`;
}
function bindEntryPlayBtns() {
  $$('.entry-play-btn[data-act="replay"]').forEach((b) => {
    b.onclick = async () => {
      const clientId = b.dataset.client;
      const task = b.dataset.task;
      const dept = b.dataset.dept;
      if (!clientId) return;
      if (!dept) {
        alert("This entry has no department. Start the timer from the tracker bar and pick a department.");
        return;
      }
      try {
        const { timer } = await api("/timer/start", {
          method: "POST",
          body: { client_id: clientId, department_id: dept, project_task: task }
        });
        localStorage.setItem(TIMER_KEY, JSON.stringify(timer));
        showTimerRunning(timer);
      } catch (e) {
        alert(e.code === "client_paused" ? PAUSED_MSG : e.message);
      }
    };
  });
}
const ENTRY_CACHE = {};
function rememberEntries(list) {
  (list || []).forEach((e) => {
    ENTRY_CACHE[e.id] = e;
  });
}
function renderEntryActions(e) {
  const btns = [];
  const approved = e.locked || e.approval_status === "approved";
  const scheduled = e.locked_kind === "scheduled";
  if (e.can_edit) {
    const title = scheduled ? "Locked, admin edit" : approved ? "Approved, admin edit" : "Edit this entry";
    btns.push(`<button class="act-btn" data-act="edit" data-id="${e.id}" title="${title}">Edit</button>`);
    btns.push(`<button class="act-btn act-danger" data-act="delete" data-id="${e.id}" title="Delete this entry">Delete</button>`);
    if (!approved && (e.approval_status === "open" || e.approval_status === "rejected") && e.user_id === ME.userId) {
      btns.push(`<button class="act-btn act-primary" data-act="submit" data-id="${e.id}">Submit</button>`);
    }
    if (scheduled) btns.push('<span class="act-note">Locked, admin edit</span>');
    else if (approved) btns.push('<span class="act-note">Approved, admin edit</span>');
  } else if (e.edit_blocked === "invoiced") {
    btns.push('<span class="act-note">Invoiced</span>');
  } else if (e.edit_blocked === "locked" || e.locked) {
    btns.push(`<span class="act-note" title="A locked entry can only be changed by an admin">${ic("lock")} Locked. Ask an admin to change.</span>`);
  }
  if (ME.role === "admin" && e.approval_status === "submitted" && !e.locked) {
    btns.push(`<button class="act-btn act-primary" data-act="approve" data-id="${e.id}">Approve</button>`);
    btns.push(`<button class="act-btn act-danger" data-act="reject" data-id="${e.id}">Reject</button>`);
  }
  return btns.join(" ");
}
function refreshEntryViews() {
  loadEntries();
  if (typeof loadTimesheets === "function" && $("#timesheets-out") && $("#timesheets-out").children.length) loadTimesheets();
}
function bindEntryActions() {
  $$("#entries-grouped button[data-act], #timesheets-out button[data-act]").forEach((b) => {
    b.onclick = async () => {
      const id = b.dataset.id;
      const e = ENTRY_CACHE[id] || {};
      try {
        if (b.dataset.act === "edit") {
          openEditModal(id);
        } else if (b.dataset.act === "submit") {
          await api(`/time-entries/${id}/submit`, { method: "POST" });
          refreshEntryViews();
        } else if (b.dataset.act === "delete") {
          const approved = e.locked || e.approval_status === "approved";
          const scheduled = e.locked_kind === "scheduled";
          if (approved || scheduled) {
            const why = scheduled ? "This entry is LOCKED by the schedule." : "This entry is APPROVED.";
            const reason = prompt(why + " Deleting it is an admin action and is logged.\nReason for deleting:");
            if (!reason || !reason.trim()) return;
            await api(`/time-entries/${id}`, { method: "DELETE", body: { reason: reason.trim() } });
          } else {
            if (!confirm("Delete this entry? This cannot be undone.")) return;
            await api(`/time-entries/${id}`, { method: "DELETE" });
          }
          refreshEntryViews();
        } else if (b.dataset.act === "approve") {
          await api(`/time-entries/${id}/review`, { method: "POST", body: { decision: "approve" } });
          refreshEntryViews();
        } else if (b.dataset.act === "reject") {
          await api(`/time-entries/${id}/review`, { method: "POST", body: { decision: "reject" } });
          refreshEntryViews();
        }
      } catch (err) {
        alert(err.message);
      }
    };
  });
}
function renderProjectRows(container, initialCount = 1) {
  if (!container) return;
  container.innerHTML = "";
  const addRow = (focus) => {
    const row = document.createElement("div");
    row.className = "proj-row";
    row.innerHTML = '<input type="text" class="proj-name-input" maxlength="120" placeholder="Project name" aria-label="Project name" /><button type="button" class="act-btn act-danger proj-row-remove" aria-label="Remove this project row">Remove</button>';
    row.querySelector(".proj-row-remove").onclick = () => row.remove();
    row.querySelector("input").addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        addRow(true);
      }
    });
    container.insertBefore(row, container.querySelector(".proj-add-btn"));
    if (focus) row.querySelector("input").focus();
  };
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "act-btn proj-add-btn";
  btn.textContent = "+ Add project";
  btn.onclick = () => addRow(true);
  container.appendChild(btn);
  for (let i = 0; i < initialCount; i++) addRow(false);
}
function projectRowNames(container) {
  return Array.from((container || document).querySelectorAll(".proj-name-input")).map((i) => i.value.trim()).filter(Boolean);
}
function openClientAddModal() {
  const modal = $("#client-add-modal");
  const form = $("#client-add-form");
  if (!modal || !form) return;
  form.reset();
  $("#client-add-err").textContent = "";
  renderProjectRows($("#client-add-projects"), 1);
  renderColorBoard($("#client-add-color-board"), pickUnusedClientColor());
  modal.classList.remove("hidden");
  form.querySelector('[name="name"]').focus();
}
async function handleClientAddSubmit(ev) {
  ev.preventDefault();
  const form = ev.target;
  const errEl = $("#client-add-err");
  errEl.textContent = "";
  const btn = form.querySelector("button[type=submit]");
  btn.disabled = true;
  try {
    const fd = new FormData(form);
    const body = {
      name: String(fd.get("name") || "").trim(),
      currency: fd.get("currency"),
      color: boardColor($("#client-add-color-board")),
      projects: projectRowNames($("#client-add-projects"))
    };
    const r = await api("/clients", { method: "POST", body });
    $("#client-add-modal").classList.add("hidden");
    const { clients } = await api("/clients");
    CLIENTS = clients;
    fillClientSelects();
    await loadClientsTab();
    if (typeof loadProjects === "function") {
      await loadProjects();
    }
    const n = (r.projects || []).length;
    if (n) alert(`Added ${r.client.name} with ${n} project${n === 1 ? "" : "s"}. They are in the Projects tab.`);
  } catch (e) {
    errEl.textContent = e.message;
  } finally {
    btn.disabled = false;
  }
}
async function loadProgress() {
  const out = $("#progress-out");
  if (!out) return;
  out.innerHTML = '<p class="muted small">Loading...</p>';
  try {
    const d = await api("/progress");
    $("#progress-week").textContent = `Week of ${d.week_start} (work day ${d.work_days_elapsed} of 5)`;
    if (!d.clients.length) {
      out.innerHTML = '<p class="muted">No clients with a weekly hours cap yet. Set one in Clients > Edit.</p>';
      return;
    }
    const label = { behind: "Behind", on_track: "On track", met: "Met" };
    out.innerHTML = (d.behind_count ? `<p class="err"><strong>${d.behind_count} client${d.behind_count === 1 ? " is" : "s are"} behind pace this week.</strong></p>` : '<p class="muted">Nobody is behind pace.</p>') + d.clients.map((c) => {
      const col = safeColor(c.color) || "#888888";
      const fill = Math.max(0, Math.min(100, c.pct_of_cap));
      const pace = Math.max(0, Math.min(100, c.expected_pace / c.hours_cap * 100));
      return `<div class="progress-card" data-status="${c.status}" style="border-left-color:${col}">
          <div class="progress-head">
            <span class="progress-name">${cdot(col)}${escapeHtml(c.client_name)}</span>
            <span class="progress-status ${c.status}">${label[c.status]}</span>
          </div>
          <div class="progress-bar" title="${c.effective_hours}h of ${c.hours_cap}h; white line = expected by today (${c.expected_pace}h)">
            <div class="progress-bar-fill" style="width:${fill}%;background:${col}"></div>
            <div class="progress-bar-pace" style="left:${pace}%"></div>
          </div>
          <div class="progress-meta">
            <span><strong>${c.effective_hours}h</strong> of ${c.hours_cap}h (${c.pct_of_cap}%)</span>
            <span>Expected by today: <strong>${c.expected_pace}h</strong></span>
            ${c.status === "behind" ? `<span>Short by <strong>${c.shortfall}h</strong></span>` : ""}
            ${c.uses_weights ? `<span class="muted">weighted; raw logged ${c.raw_hours}h</span>` : `<span class="muted">raw ${c.raw_hours}h</span>`}
          </div>
        </div>`;
    }).join("");
    if (typeof loadNotifications === "function") loadNotifications();
  } catch (e) {
    out.innerHTML = `<p class="err">${escapeHtml(e.message)}</p>`;
  }
}
let WEEKLY_WEEK = null;
const WK_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
function fmtHM(min) {
  const m = Math.max(0, Math.round(min || 0));
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
}
function wkDate(iso, opts) {
  return (/* @__PURE__ */ new Date(`${iso}T12:00:00Z`)).toLocaleDateString("en-US", { timeZone: "UTC", ...opts });
}
function wkMoney(cents) {
  return cents === null || cents === void 0 ? "n/a" : money(cents);
}
function wkDelta(d, fmt) {
  if (!d) return "";
  const up = d.delta > 0, flat = d.delta === 0;
  const pct = d.pct === null ? "" : ` (${up ? "+" : ""}${d.pct}%)`;
  return `<span class="wk-delta ${flat ? "" : up ? "up" : "down"}">${flat ? "no change" : `${up ? "+" : "-"}${fmt(Math.abs(d.delta))}${pct}`}</span>`;
}
async function loadWeekly(week) {
  const out = $("#weekly-out");
  if (!out) return;
  WEEKLY_WEEK = week || null;
  out.innerHTML = '<p class="muted small">Loading...</p>';
  try {
    const d = await api("/admin/weekly" + (WEEKLY_WEEK ? `?week=${encodeURIComponent(WEEKLY_WEEK)}` : ""));
    WEEKLY_WEEK = d.week_start;
    out.innerHTML = renderWeekly(d);
    $$("#weekly-out [data-wk-week]").forEach((b) => b.addEventListener("click", () => loadWeekly(b.dataset.wkWeek === "now" ? null : b.dataset.wkWeek)));
    const g = $("#wk-edit-goal");
    if (g) g.addEventListener("click", () => editWeeklyGoal(d.kpis.goal.goal_cents));
  } catch (e) {
    out.innerHTML = `<p class="err">${escapeHtml(e.message)}</p>`;
  }
}
async function editWeeklyGoal(currentCents) {
  const v = prompt("Weekly revenue goal, in dollars", String(Math.round(currentCents / 100)));
  if (v === null) return;
  const dollars = Number(String(v).replace(/[$,\s]/g, ""));
  if (!Number.isFinite(dollars) || dollars < 0) {
    alert("Enter a dollar amount, for example 3000.");
    return;
  }
  try {
    await api("/admin/weekly/goal", { method: "POST", body: { goal_cents: Math.round(dollars * 100) } });
    loadWeekly(WEEKLY_WEEK);
  } catch (e) {
    alert(e.message);
  }
}
function renderWeekly(d) {
  const k = d.kpis, tot = d.totals;
  const status = d.is_current ? "in progress" : d.week_start > d.today ? "upcoming" : "past week";
  const title = `Timesheet for ${wkDate(d.week_start, { month: "short", day: "numeric" })} - ${wkDate(d.week_end, { month: "short", day: "numeric" })}${d.is_current ? " (this week)" : ""}`;
  const goalPct = k.goal.pct === null ? 0 : Math.min(100, k.goal.pct);
  const wow = k.week_over_week;
  const kpis = `<div class="wk-kpis">
      <div class="wk-kpi wk-kpi-goal">
        <div class="wk-kpi-label">Week total vs goal <button id="wk-edit-goal" class="link small" title="Change the weekly revenue goal${k.goal.source === "default" ? " (default)" : ""}">edit goal</button></div>
        <div class="wk-kpi-val">${money(tot.amount_cents)} <span class="muted">of ${money(k.goal.goal_cents)}${k.goal.pct === null ? "" : ` (${k.goal.pct}%)`}</span></div>
        <div class="progress-bar" title="${money(k.goal.remaining_cents)} to go"><div class="progress-bar-fill" style="width:${goalPct}%"></div></div>
      </div>
      <div class="wk-kpi"><div class="wk-kpi-label" title="Week amount / logged hours, excluding monthly-retainer clients">Effective $/hr <span class="wk-help" aria-hidden="true">?</span></div>
        <div class="wk-kpi-val" title="Week amount divided by logged hours, i.e. amount / hours in the Hours column, after member weights and weekly caps. Excludes monthly-retainer clients (their weekly share is a contract amount, not a rate for their hours, so they are left out of both sides).">${tot.effective_rate_cents === null ? "n/a" : money(tot.effective_rate_cents) + "/hr"}</div></div>
      <div class="wk-kpi"><div class="wk-kpi-label">vs previous week</div>
        <div class="wk-kpi-val">${wkDelta(wow.amount, money)}</div>
        <div class="wk-kpi-sub muted">${fmtHM(wow.prev_minutes)} hrs, ${money(wow.prev_amount_cents)} last week ${wkDelta(wow.minutes, (m) => fmtHM(m) + " hrs")}</div></div>
      <div class="wk-kpi"><div class="wk-kpi-label">Under weekly target</div>
        <div class="wk-kpi-val ${k.clients_under_target ? "wk-warn" : ""}">${k.clients_under_target} client${k.clients_under_target === 1 ? "" : "s"}</div></div>
    </div>`;
  const head = d.days.map((x, i) => `<th class="wk-day ${x.is_today ? "today" : ""} ${x.is_future ? "future" : ""}">${WK_DAYS[i]}<br><span>${wkDate(x.date, { month: "numeric", day: "numeric" })}</span></th>`).join("");
  const renderWkRow = (c) => {
    const cells = c.days.map((x, i) => {
      const f = d.days[i];
      const cls = `wk-cell ${f.is_today ? "today" : ""} ${f.is_future ? "future" : ""} ${x.manual_minutes > 0 ? "wk-manual" : ""}`;
      const tip = x.manual_minutes > 0 ? ` title="${fmtHM(x.manual_minutes)} of this is manual time"` : "";
      return `<td class="${cls}"${tip}>${x.minutes > 0 ? fmtHM(x.minutes) : "&mdash;"}</td>`;
    }).join("");
    const rateLabel = { retainer: "no amount", project: "Project", profit: "Profit" }[c.rate_unit];
    const rate = rateLabel || `${money(c.rate_cents)}/${c.rate_unit === "week" ? "wk" : "hr"}`;
    let target = '<span class="muted" title="No weekly hours cap set for this client">no target</span>';
    if (c.target_hours !== null) {
      const cls = { under: "wk-warn", met: "wk-ok", over: "wk-ok" }[c.target_status] || "";
      const why = c.uses_weights ? `Weighted: ${fmtHM(c.total_minutes)} logged hrs became ${fmtHM(c.effective_hours * 60)} billed hrs because member weights apply (each member's logged hours are divided by their weight; e.g. a weight of 3 means 3 logged hrs = 1 billed hr). ` : "";
      target = `<span class="${cls}" title="${escapeHtml(why)}${c.effective_hours}h counted of ${c.target_hours}h target (same basis as Progress and invoices)">${fmtHM(c.effective_hours * 60)} / ${fmtHM(c.target_hours * 60)}</span> <span class="muted">${c.target_pct}%</span>`;
    }
    const manualNote = c.manual_minutes > 0 ? ` <span class="wk-manual-tag" title="${fmtHM(c.manual_minutes)} manual">M</span>` : "";
    return `<tr><td class="wk-client">${cdot(c.color)}${escapeHtml(c.client_name)}${c.archived ? ' <span class="muted">(archived)</span>' : ""}${manualNote}</td>${cells}
      <td class="num">${fmtHM(c.total_minutes)}</td><td class="num">${rate}</td>
      <td class="num" ${c.amount_cents === null ? 'title="No weekly amount, so it is not counted in the weekly total"' : ""}>${wkMoney(c.amount_cents)}</td>
      <td class="wk-target">${target}</td></tr>`;
  };
  const WK_GROUPS = Object.keys(BILLING_MODEL_NAMES).map((key) => ({ key, label: BILLING_MODEL_NAMES[key] }));
  const hoursLeft = (c) => c.target_hours === null || c.target_hours === void 0 ? Infinity : Number(c.target_hours) - Number(c.effective_hours);
  const body = WK_GROUPS.map((g) => {
    let rows = d.clients.filter((c) => (c.billing_model || "hourly") === g.key);
    if (!rows.length) return "";
    rows = rows.slice().sort(g.key === "hourly" ? (a, b) => hoursLeft(a) - hoursLeft(b) || a.client_name.localeCompare(b.client_name) : (a, b) => a.client_name.localeCompare(b.client_name));
    return `<tr class="wk-group-head"><td colspan="12">${g.label} <span class="muted">(${rows.length})</span></td></tr>` + rows.map(renderWkRow).join("");
  }).join("");
  const foot = `<tr class="wk-total"><td>Total</td>${tot.day_minutes.map((m) => `<td class="wk-cell">${m > 0 ? fmtHM(m) : "&mdash;"}</td>`).join("")}
      <td class="num">${fmtHM(tot.minutes)}</td><td class="num">${tot.effective_rate_cents === null ? "" : money(tot.effective_rate_cents) + "/hr"}</td><td class="num">${money(tot.amount_cents)}</td><td></td></tr>`;
  const manualLine = `<div class="wk-manual-line"><span class="wk-tri"></span>This timesheet includes ${fmtHM(tot.manual_minutes)} hrs manual time` + (tot.unclassified_minutes ? ` <span class="muted" title="Logged before manual vs timer was recorded, so the origin is unknown and not counted as manual">(+ ${fmtHM(tot.unclassified_minutes)} of unclassified older entries)</span>` : "") + (tot.retainer_minutes_excluded ? ` <span class="muted">${fmtHM(tot.retainer_minutes_excluded)} hrs on retainers that earn nothing (no amount, paused or archived) is not in the weekly total</span>` : "") + "</div>";
  return `<h3 class="wk-heading">Weekly overview</h3>
    <div class="wk-titlebar">
      <button class="wk-nav" data-wk-week="${d.prev_week_start}" aria-label="Previous week">&#8249;</button>
      <h3>${escapeHtml(title)} <span class="wk-status">| ${status}</span></h3>
      <button class="wk-nav" data-wk-week="${d.next_week_start}" aria-label="Next week">&#8250;</button>
      ${d.is_current ? "" : '<button class="link small" data-wk-week="now">This week</button>'}
    </div>
    ${kpis}
    ${manualLine}
    <div class="wk-scroll"><table class="wk-table ${d.is_current ? "is-current" : ""}">
      <thead><tr><th class="wk-client-h">Client / contract</th>${head}<th class="num">Hours</th><th class="num">Rate</th><th class="num">Amount</th><th title="Billed hours vs the weekly hours cap. For clients with member weights, billed hours are weighted: logged hours divided by each member's weight (3 logged hrs = 1 billed hr for a weight-3 member), so they can be lower than the Hours column.">Billed (weighted) / target</th></tr></thead>
      <tbody>${body || '<tr><td colspan="12" class="muted">No clients with time or a weekly target yet.</td></tr>'}</tbody>
      <tfoot>${foot}</tfoot></table></div>`;
}
function openChangePassword() {
  const m = $("#change-pw-modal");
  if (!m) return;
  $("#change-pw-form").reset();
  $("#change-pw-msg").textContent = "";
  m.classList.remove("hidden");
  $('#change-pw-form [name="current_password"]').focus();
}
async function handleChangePassword(ev) {
  ev.preventDefault();
  const form = ev.target;
  const msg = $("#change-pw-msg");
  msg.textContent = "";
  msg.style.color = "";
  const fd = new FormData(form);
  const cur = fd.get("current_password");
  const nw = fd.get("new_password");
  const rep = fd.get("repeat");
  if (nw !== rep) {
    msg.textContent = "The new passwords do not match.";
    return;
  }
  if (String(nw).length < 12) {
    msg.textContent = "The new password must be at least 12 characters.";
    return;
  }
  try {
    const r = await api("/auth/change-password", { method: "POST", body: { current_password: cur, new_password: nw } });
    if (r.token) setToken(r.token);
    msg.style.color = "var(--ok)";
    msg.textContent = "Password changed. Other devices were signed out.";
    setTimeout(() => $("#change-pw-modal").classList.add("hidden"), 1500);
  } catch (e) {
    msg.textContent = e.message;
  }
}
function resetTeamPassword(uid) {
  const u = (TEAM_TAB_DATA || []).find((x) => x.id === uid) || {};
  const m = $("#reset-pw-modal");
  if (!m) return;
  $("#reset-pw-who").textContent = u.display_name ? `${u.display_name} (${u.email})` : u.email || "";
  const form = $("#reset-pw-form");
  form.reset();
  form.querySelector('[name="uid"]').value = uid;
  $("#reset-pw-input").type = "password";
  $("#reset-pw-err").textContent = "";
  $("#reset-pw-err").style.color = "";
  m.classList.remove("hidden");
  $("#reset-pw-input").focus();
}
async function submitResetPassword(generate) {
  const form = $("#reset-pw-form");
  const errEl = $("#reset-pw-err");
  errEl.textContent = "";
  const uid = form.querySelector('[name="uid"]').value;
  const typed = $("#reset-pw-input").value;
  if (!generate && typed.length < 12) {
    errEl.textContent = "The password must be at least 12 characters.";
    return;
  }
  const who = $("#reset-pw-who").textContent;
  const btns = $$("#reset-pw-form button");
  btns.forEach((b) => {
    b.disabled = true;
  });
  errEl.style.color = "var(--muted)";
  errEl.textContent = "Saving... (checking the password against known breaches)";
  try {
    const r = await api(`/admin/users/${uid}/reset-password`, { method: "POST", body: generate ? {} : { new_password: typed } });
    $("#reset-pw-modal").classList.add("hidden");
    form.reset();
    if (generate) {
      $("#temp-pw-who").textContent = r.email || who;
      $("#temp-pw-value").textContent = r.temp_password || "";
      $("#temp-pw-modal").classList.remove("hidden");
    } else {
      alert(`Password set for ${r.email || who}. They were signed out everywhere and can sign in with it now.`);
    }
  } catch (e) {
    errEl.style.color = "";
    errEl.textContent = e.message;
  } finally {
    btns.forEach((b) => {
      b.disabled = false;
    });
  }
}
async function openEditModal(entryId) {
  const modal = $("#edit-modal");
  const form = $("#edit-entry-form");
  if (!modal || !form) return;
  let entry = ENTRY_CACHE[entryId];
  if (!entry) {
    const all = await api(`/time-entries?limit=200&offset=0`);
    rememberEntries(all.entries);
    entry = ENTRY_CACHE[entryId];
  }
  if (!entry) {
    alert("Entry not found");
    return;
  }
  form.querySelector('[name="entry_id"]').value = entryId;
  form.querySelector('[name="project_task"]').value = entry.project_task || "";
  form.querySelector('[name="entry_date"]').value = entry.entry_date || "";
  form.querySelector('[name="hours"]').value = entry.hours || "";
  form.querySelector('[name="is_billable"]').checked = !!entry.is_billable;
  const editEntryTypeSelect = form.querySelector('[name="entry_type"]');
  if (editEntryTypeSelect) editEntryTypeSelect.value = entry.entry_type || "work";
  form.querySelector('[name="notes"]').value = entry.notes || "";
  form.querySelector('[name="reason"]').value = "";
  $("#edit-err").textContent = "";
  const historyEl = $("#edit-history");
  if (historyEl) {
    try {
      const { edits } = await api(`/time-entries/${entryId}/edits`);
      if (edits && edits.length > 0) {
        historyEl.innerHTML = `
          <h4>Edit History (${edits.length} changes)</h4>
          ${edits.map((ed) => `
            <div class="edit-record">
              <span class="field">${escapeHtml(ed.field_name)}</span>:
              <span class="old-val">${escapeHtml(ed.old_value || "(empty)")}</span> ->
              <span class="new-val">${escapeHtml(ed.new_value || "(empty)")}</span>
              <br/><span class="edit-reason">"${escapeHtml(ed.reason)}"</span>
              · ${escapeHtml(ed.user_name || ed.user_email || "")} ${timeAgo(ed.created_at)}
            </div>
          `).join("")}
        `;
      } else {
        historyEl.innerHTML = "<h4>No edit history</h4>";
      }
    } catch (_) {
      historyEl.innerHTML = "";
    }
  }
  modal.classList.remove("hidden");
}
function closeEditModal() {
  const modal = $("#edit-modal");
  if (modal) modal.classList.add("hidden");
}
async function handleEditSubmit(ev) {
  ev.preventDefault();
  const form = $("#edit-entry-form");
  const errEl = $("#edit-err");
  if (errEl) errEl.textContent = "";
  const entryId = form.querySelector('[name="entry_id"]').value;
  const body = {
    project_task: form.querySelector('[name="project_task"]').value,
    entry_date: form.querySelector('[name="entry_date"]').value,
    hours: Number(form.querySelector('[name="hours"]').value),
    is_billable: form.querySelector('[name="is_billable"]').checked,
    entry_type: form.querySelector('[name="entry_type"]')?.value || "work",
    notes: form.querySelector('[name="notes"]').value,
    reason: form.querySelector('[name="reason"]').value
  };
  try {
    await api(`/time-entries/${entryId}`, { method: "PATCH", body });
    closeEditModal();
    refreshEntryViews();
  } catch (e) {
    if (errEl) errEl.textContent = e.message;
  }
}
let tsOffset = 0;
const TS_LIMIT = 50;
async function loadTimesheets() {
  const out = $("#timesheets-out");
  const headerEl = $("#ts-week-header");
  const week = getWeekRange();
  if (headerEl) {
    headerEl.innerHTML = `<span class="ts-week-label">Week of ${week.label}, ${(/* @__PURE__ */ new Date()).getFullYear()}</span>`;
  }
  let timesheets = [];
  let entries = [];
  try {
    const [tsRes, enRes] = await Promise.allSettled([
      api(`/timesheets?limit=${TS_LIMIT}&offset=0`),
      api(`/time-entries?limit=500`)
    ]);
    if (tsRes.status === "fulfilled" && tsRes.value.timesheets) {
      timesheets = tsRes.value.timesheets;
    }
    if (enRes.status === "fulfilled" && enRes.value.entries) {
      entries = enRes.value.entries;
      rememberEntries(entries);
    }
  } catch (e) {
    out.innerHTML = `<p class="err">${escapeHtml(e.message)}</p>`;
    return;
  }
  const weekEntries = entries.filter(
    (e) => e.entry_date >= week.monday && e.entry_date <= week.sunday && (ME.role === "admin" || e.user_id === ME.userId)
  );
  const tsLookup = {};
  for (const ts of timesheets) {
    const key = `${ts.client_name || ""}__${ts.week_start}`;
    if (!tsLookup[key]) tsLookup[key] = [];
    tsLookup[key].push(ts);
  }
  const byClient = {};
  for (const e of weekEntries) {
    const cname = e.client_name || "Unknown";
    if (!byClient[cname]) byClient[cname] = { entries: [], clientId: e.client_id };
    byClient[cname].entries.push(e);
  }
  const clientNames = Object.keys(byClient).sort();
  if (clientNames.length === 0) {
    out.innerHTML = '<p class="muted small">No time entries for this week yet. Log hours to get started.</p>';
    return;
  }
  renderTimesheetAccordion(clientNames, byClient, tsLookup, week);
}
function renderTimesheetAccordion(clientNames, byClient, tsLookup, week) {
  const out = $("#timesheets-out");
  const admin = ME.role === "admin";
  const cards = clientNames.map((cname) => {
    const data = byClient[cname];
    const allEntries = data.entries;
    const totalHours = allEntries.reduce((s, e) => s + Number(e.hours), 0);
    const billableHours = allEntries.filter((e) => e.is_billable).reduce((s, e) => s + Number(e.hours), 0);
    const byMember = {};
    for (const e of allEntries) {
      const name = e.user_display_name || e.user_email || "Unknown";
      const uid = e.user_id || name;
      if (!byMember[uid]) byMember[uid] = { name, email: e.user_email || "", entries: [], hours: 0 };
      byMember[uid].entries.push(e);
      byMember[uid].hours += Number(e.hours);
    }
    const members = Object.values(byMember).sort((a, b) => b.hours - a.hours);
    const memberCount = members.length;
    const matchingTs = tsLookup[`${cname}__${week.monday}`] || [];
    const pieId = `ts-pie-${cname.replace(/[^a-zA-Z0-9]/g, "_")}`;
    const pieSvg = buildTeamPieSvg(members, totalHours, pieId);
    const memberRows = members.map((m, i) => {
      const pct = totalHours > 0 ? (m.hours / totalHours * 100).toFixed(0) : 0;
      const color = PIE_COLORS[i % PIE_COLORS.length];
      const memberId = `ts-member-${cname.replace(/[^a-zA-Z0-9]/g, "_")}_${(m.email || m.name).replace(/[^a-zA-Z0-9]/g, "_")}`;
      const detailId = `${memberId}-detail`;
      const detailRows = m.entries.sort((a, b) => a.entry_date.localeCompare(b.entry_date)).map((e) => `<tr>
          <td>${e.entry_date}</td>
          <td>${escapeHtml(e.project_task || "(no task)")}${enteredByLabel(e)}</td>
          <td class="ts-detail-hours">${Number(e.hours).toFixed(2)}h</td>
          <td><span class="status-badge ${e.approval_status}">${e.approval_status}</span></td>
          <td class="ts-detail-actions">${renderEntryActions(e)}</td>
        </tr>`).join("");
      return `
        <div class="ts-member-row" data-member-id="${memberId}">
          <span class="ts-member-swatch" style="background:${color}"></span>
          <span class="ts-member-name" data-toggle-detail="${detailId}">${escapeHtml(m.name)}</span>
          <span class="ts-member-hours">${m.hours.toFixed(2)}h</span>
          <span class="ts-member-pct">${pct}%</span>
        </div>
        <div class="ts-member-detail hidden" id="${detailId}">
          <table class="ts-detail-table">
            <thead><tr><th>Date</th><th>Task</th><th>Hours</th><th>Status</th><th></th></tr></thead>
            <tbody>${detailRows}</tbody>
          </table>
        </div>`;
    }).join("");
    let actionsHtml = "";
    if (matchingTs.length > 0) {
      const acts = matchingTs.map((ts) => {
        const btns = [];
        const lockedWeek = Boolean(ts.locked_by_schedule);
        if (ME.role !== "client" && (ts.status === "open" || ts.status === "rejected")) {
          if (lockedWeek && !admin) {
            btns.push(`<span class="act-note">${ic("lock")} Locked. Ask an admin to change.</span>`);
          } else {
            btns.push(`<button class="link" data-tsact="submit" data-id="${ts.id}">Submit Week</button>`);
          }
        }
        if (admin && ts.status === "submitted") {
          btns.push(`<button class="link" data-tsact="approve" data-id="${ts.id}">Approve</button>`);
          btns.push(`<button class="link danger" data-tsact="reject" data-id="${ts.id}">Reject</button>`);
        }
        const rejectReason = ts.reject_reason ? `<span class="ts-reject-reason">Rejected: ${escapeHtml(ts.reject_reason)}</span>` : "";
        const lockMark = lockedWeek ? ` <span class="muted small">${ic("lock")} locked</span>` : "";
        const statusBadge = `<span class="status-badge ${ts.status}">${ts.status}</span>${lockMark}`;
        if (btns.length > 0 || rejectReason) {
          return `<div class="ts-actions-row">${statusBadge} ${btns.join(" ")} ${rejectReason}</div>`;
        }
        return `<div class="ts-actions-row">${statusBadge}</div>`;
      });
      actionsHtml = `<div class="ts-actions">${acts.join("")}</div>`;
    }
    const cardId = `ts-card-${cname.replace(/[^a-zA-Z0-9]/g, "_")}`;
    return `
      <div class="ts-client-card" id="${cardId}" style="${leftBarStyle(clientColorByName(cname))}">
        <div class="ts-client-header" data-toggle-card="${cardId}">
          <div class="ts-client-info">
            <span class="ts-client-name">${cdotName(cname)}${escapeHtml(cname)}</span>
            <span class="ts-client-meta">${memberCount} member${memberCount !== 1 ? "s" : ""} &middot; ${totalHours.toFixed(2)}h total &middot; ${billableHours.toFixed(2)}h billable</span>
          </div>
          <svg class="ts-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
        </div>
        <div class="ts-client-body hidden">
          <div class="ts-client-content">
            <div class="ts-pie-col">
              ${pieSvg}
            </div>
            <div class="ts-members-col">
              <div class="ts-members-header">Team Breakdown</div>
              ${memberRows}
            </div>
          </div>
          ${actionsHtml}
        </div>
      </div>`;
  }).join("");
  out.innerHTML = cards;
  $$(".ts-client-header[data-toggle-card]").forEach((hdr) => {
    hdr.onclick = () => {
      const card = $(`#${hdr.dataset.toggleCard}`);
      if (!card) return;
      const body = card.querySelector(".ts-client-body");
      const chevron = card.querySelector(".ts-chevron");
      if (body) body.classList.toggle("hidden");
      if (chevron) chevron.classList.toggle("ts-chevron-open");
    };
  });
  $$(".ts-member-name[data-toggle-detail]").forEach((nameEl) => {
    nameEl.onclick = (ev) => {
      ev.stopPropagation();
      const detailEl = $(`#${nameEl.dataset.toggleDetail}`);
      if (detailEl) detailEl.classList.toggle("hidden");
    };
  });
  bindEntryActions();
  bindTimesheetActions();
}
function buildTeamPieSvg(members, totalHours, id) {
  if (members.length === 0 || totalHours === 0) {
    return '<div class="ts-pie-empty muted small">No hours</div>';
  }
  const cx = 60, cy = 60, r = 50;
  let startAngle = -Math.PI / 2;
  let paths = "";
  if (members.length === 1) {
    paths = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${PIE_COLORS[0]}" />`;
  } else {
    members.forEach((m, i) => {
      const pct = m.hours / totalHours;
      const angle = pct * 2 * Math.PI;
      const endAngle = startAngle + angle;
      const largeArc = angle > Math.PI ? 1 : 0;
      const x1 = cx + r * Math.cos(startAngle);
      const y1 = cy + r * Math.sin(startAngle);
      const x2 = cx + r * Math.cos(endAngle);
      const y2 = cy + r * Math.sin(endAngle);
      const color = PIE_COLORS[i % PIE_COLORS.length];
      paths += `<path d="M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${largeArc},1 ${x2},${y2} Z" fill="${color}" />`;
      startAngle = endAngle;
    });
  }
  paths += `<circle cx="${cx}" cy="${cy}" r="30" fill="var(--panel)" />`;
  const totalH = Math.floor(totalHours);
  const totalM = Math.round((totalHours - totalH) * 60);
  paths += `<text x="${cx}" y="${cy - 2}" text-anchor="middle" fill="var(--ink)" font-size="14" font-weight="700" font-family="Oswald, sans-serif">${totalH}:${String(totalM).padStart(2, "0")}</text>`;
  paths += `<text x="${cx}" y="${cy + 11}" text-anchor="middle" fill="var(--muted)" font-size="9" font-family="Oswald, sans-serif">hrs</text>`;
  return `<svg id="${id}" viewBox="0 0 120 120" width="120" height="120">${paths}</svg>`;
}
function bindTimesheetActions() {
  $$("#timesheets-out button[data-tsact]").forEach((b) => {
    b.onclick = async () => {
      const id = b.dataset.id;
      try {
        if (b.dataset.tsact === "submit") {
          await api(`/timesheets/${id}/submit`, { method: "POST" });
          await loadTimesheets();
          if (ME.role !== "client") loadEntries();
          loadNotifications();
        } else if (b.dataset.tsact === "approve") {
          await api(`/timesheets/${id}/approve`, { method: "POST", body: { decision: "approve" } });
          await loadTimesheets();
          if (ME.role !== "client") loadEntries();
        } else if (b.dataset.tsact === "reject") {
          openRejectModal(id);
        }
      } catch (e) {
        alert(e.message);
      }
    };
  });
}
function openRejectModal(timesheetId) {
  const modal = $("#reject-modal");
  const form = $("#reject-ts-form");
  if (!modal || !form) return;
  form.querySelector('[name="timesheet_id"]').value = timesheetId;
  form.querySelector('[name="reason"]').value = "";
  modal.classList.remove("hidden");
}
function closeRejectModal() {
  const modal = $("#reject-modal");
  if (modal) modal.classList.add("hidden");
}
async function handleRejectSubmit(ev) {
  ev.preventDefault();
  const form = $("#reject-ts-form");
  const tsId = form.querySelector('[name="timesheet_id"]').value;
  const reason = form.querySelector('[name="reason"]').value.trim();
  if (!reason) {
    alert("Reason is required");
    return;
  }
  try {
    await api(`/timesheets/${tsId}/approve`, { method: "POST", body: { decision: "reject", reason } });
    closeRejectModal();
    await loadTimesheets();
    if (ME.role !== "client") loadEntries();
  } catch (e) {
    alert(e.message);
  }
}
async function loadAdminUsers() {
  const out = $("#admin-users-out");
  if (!out) return;
  try {
    const { users } = await api("/admin/users");
    if (!users || users.length === 0) {
      out.innerHTML = '<p class="muted small">No users found.</p>';
      return;
    }
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    out.innerHTML = `
      <table class="grid admin-table"><thead><tr>
        <th>Email</th><th>Name</th><th>Role</th><th>Status</th><th></th>
      </tr></thead><tbody>
      ${users.map((u) => `<tr data-uid="${u.id}">
        <td>${escapeHtml(u.email)}</td>
        <td>${escapeHtml(u.display_name || "")}</td>
        <td>
          <select class="user-role-select" data-uid="${u.id}">
            <option value="admin" ${u.role === "admin" ? "selected" : ""}>admin</option>
            <option value="employee" ${u.role === "employee" ? "selected" : ""}>employee</option>
            <option value="client" ${u.role === "client" ? "selected" : ""}>client</option>
          </select>
        </td>
        <td class="${u.active !== 0 ? "user-active" : "user-inactive"}">
          ${u.active !== 0 ? "Active" : "Deactivated"}
        </td>
        <td>
          ${u.active !== 0 ? `<button class="link danger" data-uact="deactivate" data-uid="${u.id}">deactivate</button>` : `<button class="link" data-uact="activate" data-uid="${u.id}">activate</button>`}
          <button class="link danger" data-uact="force-logout" data-uid="${u.id}">force logout</button>
        </td>
      </tr>`).join("")}
      </tbody></table>
    `;
    bindAdminUserActions();
  } catch (e) {
    out.innerHTML = `<p class="err">${escapeHtml(e.message)}</p>`;
  }
}
function bindAdminUserActions() {
  $$(".user-role-select").forEach((sel) => {
    sel.onchange = async () => {
      try {
        await api(`/admin/users/${sel.dataset.uid}`, {
          method: "PATCH",
          body: { role: sel.value }
        });
        loadAdminUsers();
      } catch (e) {
        alert(e.message);
        sel.value = sel.dataset.originalRole || sel.value;
      }
    };
  });
  $$("button[data-uact]").forEach((b) => {
    b.onclick = async () => {
      const uid = b.dataset.uid;
      try {
        if (b.dataset.uact === "deactivate") {
          if (confirm("Deactivate this user? They will be logged out immediately.")) {
            await api(`/admin/users/${uid}`, { method: "PATCH", body: { active: false } });
            loadAdminUsers();
          }
        } else if (b.dataset.uact === "activate") {
          await api(`/admin/users/${uid}`, { method: "PATCH", body: { active: true } });
          loadAdminUsers();
        } else if (b.dataset.uact === "force-logout") {
          if (confirm("Force logout this user? All their sessions will be revoked.")) {
            const result = await api(`/admin/users/${uid}/sessions`, { method: "DELETE" });
            alert(`Revoked ${result.sessions_revoked} session(s).`);
          }
        }
      } catch (e) {
        alert(e.message);
      }
    };
  });
}
let ADMIN_USERS_CACHE = null;
async function loadWeightsPanel() {
  const sel = $("#weights-client-select");
  if (!sel) return;
  sel.innerHTML = '<option value="">-- select client --</option>' + CLIENTS.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("");
}
async function loadClientWeights(clientId) {
  const out = $("#weights-out");
  if (!out) return;
  if (!clientId) {
    out.innerHTML = "";
    return;
  }
  try {
    const [wData, uData] = await Promise.all([
      api(`/clients/${clientId}/weights`),
      ADMIN_USERS_CACHE ? Promise.resolve(ADMIN_USERS_CACHE) : api("/admin/users")
    ]);
    if (!ADMIN_USERS_CACHE) ADMIN_USERS_CACHE = uData;
    const weights = wData.weights || [];
    const users = (uData.users || []).filter((u) => u.role !== "client" && u.active !== 0);
    const weightMap = {};
    weights.forEach((w) => {
      weightMap[w.user_id] = w;
    });
    const assignedIds = new Set(weights.map((w) => w.user_id));
    const unassigned = users.filter((u) => !assignedIds.has(u.id));
    let html = '<table class="grid"><thead><tr><th>Team Member</th><th>Weight (x:1)</th><th></th></tr></thead><tbody>';
    weights.forEach((w) => {
      html += `<tr>
        <td>${escapeHtml(w.display_name || w.email)}</td>
        <td><input type="number" step="0.1" min="0.1" class="wt-input" data-uid="${w.user_id}" value="${w.logged_hours_per_allotment_hour}" style="width:80px" aria-label="Weight for ${escapeHtml(w.display_name || w.email)}" /> <span class="wt-state small"></span></td>
        <td><button class="act-btn act-danger wt-remove" data-uid="${w.user_id}">Remove</button></td>
      </tr>`;
    });
    html += "</tbody></table>";
    if (unassigned.length) {
      html += `<div style="margin-top:10px;display:flex;gap:8px;align-items:end;flex-wrap:wrap">
        <label class="small">Add member
          <select id="wt-add-user">
            <option value="">-- select --</option>
            ${unassigned.map((u) => `<option value="${u.id}">${escapeHtml(u.display_name || u.email)}</option>`).join("")}
          </select>
        </label>
        <label class="small">Weight
          <input type="number" id="wt-add-value" step="0.1" min="0.1" value="1" style="width:70px" />
        </label>
        <button id="wt-add-btn" class="act-btn act-primary">+ Add member</button>
      </div>`;
    }
    html += '<div style="margin-top:12px"><button id="wt-save-btn">Save all weights</button> <span id="wt-save-result" class="small">Changes save when you leave the box.</span></div>';
    out.innerHTML = html;
    const resultEl = $("#wt-save-result");
    const flash = (msg, ok) => {
      if (resultEl) {
        resultEl.textContent = msg;
        resultEl.style.color = ok ? "var(--ok)" : "var(--danger)";
      }
    };
    const markRow = (inp, state) => {
      const cell = inp.closest("tr") && inp.closest("tr").querySelector(".wt-state");
      if (!cell) return;
      cell.textContent = state === "unsaved" ? "unsaved change" : state === "saved" ? "saved" : state === "error" ? "not saved" : "";
      cell.style.color = state === "saved" ? "var(--ok)" : state === "error" ? "var(--danger)" : "#d98a00";
      inp.style.outline = state === "unsaved" ? "2px solid #d98a00" : state === "error" ? "2px solid var(--danger)" : "";
    };
    const dirty = () => $$(".wt-input").some((i) => i.dataset.orig !== i.value);
    const saveOne = async (inp) => {
      const v = parseFloat(inp.value);
      if (!(v > 0)) {
        markRow(inp, "error");
        flash("Weight must be a number greater than 0.", false);
        return false;
      }
      try {
        await api(`/clients/${clientId}/weights`, { method: "PUT", body: { weights: [{ user_id: inp.dataset.uid, logged_hours_per_allotment_hour: v }] } });
        inp.dataset.orig = inp.value;
        markRow(inp, "saved");
        flash(dirty() ? "Some changes are not saved yet." : "All changes saved.", !dirty());
        return true;
      } catch (e) {
        markRow(inp, "error");
        flash(e.message, false);
        return false;
      }
    };
    $$(".wt-input").forEach((inp) => {
      inp.dataset.orig = inp.value;
      inp.addEventListener("input", () => {
        markRow(inp, inp.dataset.orig === inp.value ? "" : "unsaved");
        if (dirty()) flash("Unsaved changes. They save when you leave the box, or press Save all.", false);
      });
      inp.addEventListener("change", () => {
        if (inp.dataset.orig !== inp.value) saveOne(inp);
      });
      inp.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") {
          ev.preventDefault();
          inp.blur();
        }
      });
    });
    const saveBtn = $("#wt-save-btn");
    if (saveBtn) {
      saveBtn.onclick = async () => {
        let ok = true;
        for (const inp of $$(".wt-input")) {
          if (inp.dataset.orig !== inp.value) ok = await saveOne(inp) && ok;
        }
        if (ok) {
          flash("Saved.", true);
          loadClientWeights(clientId);
        }
      };
    }
    $$(".wt-remove").forEach((btn) => {
      btn.onclick = async () => {
        if (!confirm("Remove this member from the weights?")) return;
        try {
          for (const inp of $$(".wt-input")) {
            if (inp.dataset.orig !== inp.value && inp.dataset.uid !== btn.dataset.uid) await saveOne(inp);
          }
          await api(`/clients/${clientId}/weights`, { method: "PUT", body: { remove: [btn.dataset.uid] } });
          loadClientWeights(clientId);
        } catch (e) {
          alert(e.message);
        }
      };
    });
    const addBtn = $("#wt-add-btn");
    if (addBtn) {
      addBtn.onclick = async () => {
        const uid = $("#wt-add-user")?.value;
        const val = parseFloat($("#wt-add-value")?.value);
        if (!uid) {
          alert("Select a team member");
          return;
        }
        if (!val || val <= 0) {
          alert("Enter a positive weight");
          return;
        }
        try {
          for (const inp of $$(".wt-input")) {
            if (inp.dataset.orig !== inp.value) await saveOne(inp);
          }
          await api(`/clients/${clientId}/weights`, {
            method: "PUT",
            body: { weights: [{ user_id: uid, logged_hours_per_allotment_hour: val }] }
          });
          loadClientWeights(clientId);
        } catch (e) {
          alert(e.message);
        }
      };
    }
  } catch (e) {
    out.innerHTML = `<p class="err">${escapeHtml(e.message)}</p>`;
  }
}
async function handleLockBefore() {
  const dateInput = $("#lock-before-date");
  const resultEl = $("#lock-before-result");
  if (!dateInput || !dateInput.value) {
    alert("Select a date");
    return;
  }
  if (!confirm(`Lock ALL entries before ${dateInput.value}? This cannot be undone.`)) return;
  try {
    const result = await api("/admin/lock-before", {
      method: "POST",
      body: { before_date: dateInput.value }
    });
    if (resultEl) {
      resultEl.textContent = `Locked ${result.entries_locked} entries before ${result.before_date}.`;
      resultEl.style.color = "var(--ok)";
    }
  } catch (e) {
    if (resultEl) {
      resultEl.textContent = e.message;
      resultEl.style.color = "var(--danger)";
    }
  }
}
async function runReport(clientId, from, to) {
  const q = new URLSearchParams();
  if (from) q.set("from", from);
  if (to) q.set("to", to);
  const r = await api(`/clients/${clientId}/report?${q}`);
  const t = r.totals;
  const capLine = t.cap_hours == null ? "no cap" : `${t.billable_hours} / ${t.cap_hours} h ${t.over_cap ? "OVER CAP" : `(${t.hours_remaining} h left)`}`;
  $("#report-out").innerHTML = `
    <div class="card">
      <h3>${cdot(r.client.color || clientColorById(r.client.id))}${escapeHtml(r.client.name)}</h3>
      <p>Billable: <strong>${t.billable_hours} h</strong> · Internal: ${t.internal_hours} h</p>
      <p>Cap: ${capLine}</p>
      <p>Billable amount: <strong>${money(t.billable_amount_cents, r.client.currency)}</strong></p>
    </div>
    <table class="grid"><thead><tr><th>Date</th><th>Task</th><th>Hours</th><th>Amount</th><th>Status</th></tr></thead>
    <tbody>${r.entries.map((e) => `<tr>
      <td>${e.entry_date}</td><td>${escapeHtml(e.project_task || "")}</td><td>${e.hours}</td>
      <td>${money(e.amount_cents, r.client.currency)}</td>
      <td><span class="status-badge ${e.approval_status}">${e.approval_status}</span>${e.invoiced ? " · invoiced" : ""}</td></tr>`).join("")}</tbody></table>`;
}
async function genInvoice(clientId, start, end, dueDate, notes) {
  const body = { client_id: clientId, period_start: start, period_end: end };
  if (dueDate) body.due_date = dueDate;
  if (notes) body.notes = notes;
  const { invoice } = await api("/invoices", { method: "POST", body });
  $("#invoice-out").innerHTML = `
    <div class="card">
      <h3>${invoice.invoice_number} · ${escapeHtml(invoice.client_name)}</h3>
      <p>${invoice.period_start} to ${invoice.period_end} · status ${invoice.status}
        ${invoice.billing_model ? ` · billing: ${invoice.billing_model}` : ""}</p>
      <p>Total: <strong>${money(invoice.total_cents, invoice.currency)}</strong> (${invoice.total_hours} h)</p>
      <table class="grid"><thead><tr><th>Description</th><th>Hours</th><th>Rate</th><th>Amount</th></tr></thead>
      <tbody>${invoice.line_items.map((l) => `<tr>
        <td>${escapeHtml(l.description)}</td><td>${l.hours}</td>
        <td>${money(l.rate_cents, invoice.currency)}</td>
        <td>${money(l.amount_cents, invoice.currency)}</td></tr>`).join("")}</tbody></table>
    </div>
    <div style="margin-top:10px">
      <button class="link" data-invoice-url="${API}/api/invoices/${invoice.id}/html">View Printable Invoice</button>
    </div>`;
  loadInvoices();
}
let invOffset = 0;
const INV_LIMIT = 50;
async function loadInvoices(offset) {
  if (offset !== void 0) invOffset = offset;
  const out = $("#invoices-list-out");
  if (!out) return;
  try {
    const q = new URLSearchParams();
    q.set("limit", String(INV_LIMIT));
    q.set("offset", String(invOffset));
    q.set("sort", "created_at");
    q.set("order", "desc");
    const clientId = $("#inv-filter-client")?.value;
    const status = $("#inv-filter-status")?.value;
    const dateFrom = $("#inv-filter-from")?.value;
    const dateTo = $("#inv-filter-to")?.value;
    if (clientId) q.set("client_id", clientId);
    if (status) q.set("status", status);
    if (dateFrom) q.set("date_from", dateFrom);
    if (dateTo) q.set("date_to", dateTo);
    const { invoices } = await api(`/invoices?${q}`);
    if (!invoices || invoices.length === 0) {
      out.innerHTML = '<p class="muted small">No invoices found.</p>';
      $("#invoices-pagination").innerHTML = "";
      return;
    }
    out.innerHTML = `
      <table class="grid"><thead><tr>
        <th>Invoice #</th><th>Client</th><th>Period</th><th>Total</th><th>Status</th><th>Due</th><th></th>
      </tr></thead><tbody>
      ${invoices.map((inv) => `<tr>
        <td>${escapeHtml(inv.invoice_number)}</td>
        <td>${escapeHtml(inv.client_name || "")}${pausedBadge(inv.client_id, inv.client_name)}</td>
        <td>${inv.period_start} to ${inv.period_end}</td>
        <td>${money(inv.total_cents, inv.currency)}</td>
        <td><span class="status-badge inv-${inv.status}">${inv.status.replace("_", " ")}</span></td>
        <td>${inv.due_date || "-"}</td>
        <td>
          <button class="link" data-invact="view" data-iid="${inv.id}">view</button>
          <button class="link" data-invact="html" data-iid="${inv.id}">print</button>
          ${inv.status === "draft" ? `<button class="link" data-invact="send" data-iid="${inv.id}">mark sent</button>` : ""}
          ${inv.status === "sent" || inv.status === "partially_paid" ? `<button class="link" data-invact="payment" data-iid="${inv.id}">record payment</button>` : ""}
        </td>
      </tr>`).join("")}
      </tbody></table>`;
    bindInvoiceListActions();
    const pg = $("#invoices-pagination");
    if (pg) {
      const hasPrev = invOffset > 0;
      const hasNext = invoices.length >= INV_LIMIT;
      pg.innerHTML = `
        ${hasPrev ? `<button class="link" id="inv-prev">Previous</button>` : ""}
        <span class="muted small">Showing ${invOffset + 1}-${invOffset + invoices.length}</span>
        ${hasNext ? `<button class="link" id="inv-next">Next</button>` : ""}
      `;
      const prev = $("#inv-prev");
      const next = $("#inv-next");
      if (prev) prev.onclick = () => loadInvoices(Math.max(0, invOffset - INV_LIMIT));
      if (next) next.onclick = () => loadInvoices(invOffset + INV_LIMIT);
    }
  } catch (e) {
    out.innerHTML = `<p class="err">${escapeHtml(e.message)}</p>`;
  }
}
function bindInvoiceListActions() {
  $$("#invoices-list-out button[data-invact]").forEach((b) => {
    b.onclick = async () => {
      const iid = b.dataset.iid;
      try {
        if (b.dataset.invact === "view") {
          await showInvoiceDetail(iid);
        } else if (b.dataset.invact === "html") {
          window.open(`${API}/api/invoices/${iid}/html`, "_blank");
        } else if (b.dataset.invact === "send") {
          const recipientEmail = prompt("Send invoice email to (leave empty to just mark as sent):");
          const sendBody = {};
          if (recipientEmail && recipientEmail.trim()) {
            sendBody.recipient_email = recipientEmail.trim();
          }
          if (confirm(`Mark this invoice as sent${recipientEmail ? " and email to " + recipientEmail : ""}?`)) {
            await api(`/invoices/${iid}/send`, { method: "POST", body: sendBody });
            loadInvoices();
          }
        } else if (b.dataset.invact === "payment") {
          const amtStr = prompt("Payment amount (in dollars, e.g. 150.00):");
          if (!amtStr) return;
          const amtCents = Math.round(parseFloat(amtStr) * 100);
          if (!amtCents || amtCents <= 0) {
            alert("Invalid amount");
            return;
          }
          const method = prompt("Payment method (e.g. paypal, check, wire):") || "";
          const ref = prompt("Reference number (optional):") || "";
          await api(`/invoices/${iid}/payments`, {
            method: "POST",
            body: { amount_cents: amtCents, payment_method: method, reference: ref }
          });
          loadInvoices();
        }
      } catch (e) {
        alert(e.message);
      }
    };
  });
}
async function showInvoiceDetail(invoiceId) {
  const out = $("#invoices-list-out");
  if (!out) return;
  try {
    const { invoice } = await api(`/invoices/${invoiceId}`);
    const inv = invoice;
    const lineRows = inv.line_items.map((l) => `
      <tr>
        <td>${escapeHtml(l.description)}</td>
        <td>${l.hours}</td>
        <td>${money(l.rate_cents, inv.currency)}</td>
        <td>${money(l.amount_cents, inv.currency)}</td>
        <td>${inv.status === "draft" && !l.time_entry_id ? `<button class="link danger" data-rmline="${l.id}" data-rminv="${inv.id}">remove</button>` : l.time_entry_id ? "" : "manual"}</td>
      </tr>`).join("");
    const paymentRows = (inv.payments || []).map((pm) => `
      <tr>
        <td>${(pm.paid_at || "").slice(0, 10)}</td>
        <td>${escapeHtml(pm.payment_method || "-")}</td>
        <td>${escapeHtml(pm.reference || "-")}</td>
        <td>${pm.amount}</td>
      </tr>`).join("");
    const balanceDue = inv.total_cents - (inv.paid_amount_cents || 0);
    out.innerHTML = `
      <div style="margin-bottom:12px">
        <button class="link" id="inv-back-btn">Back to list</button>
      </div>
      <div class="card">
        <h3>${escapeHtml(inv.invoice_number)} · ${escapeHtml(inv.client?.name || "")}</h3>
        <p>Period: ${inv.period_start} to ${inv.period_end}</p>
        <p>Status: <span class="status-badge inv-${inv.status}">${inv.status.replace("_", " ")}</span>
          ${inv.due_date ? ` · Due: ${inv.due_date}` : ""}
          ${inv.sent_at ? ` · Sent: ${inv.sent_at.slice(0, 10)} to ${escapeHtml(inv.sent_to || "")}` : ""}</p>
        <p>Total: <strong>${money(inv.total_cents, inv.currency)}</strong> (${inv.total_hours} h)
          ${(inv.paid_amount_cents || 0) > 0 ? ` · Paid: ${money(inv.paid_amount_cents, inv.currency)} · Balance: ${money(balanceDue, inv.currency)}` : ""}</p>
        ${inv.notes ? `<p class="muted small">Notes: ${escapeHtml(inv.notes)}</p>` : ""}
      </div>

      <table class="grid"><thead><tr>
        <th>Description</th><th>Hours</th><th>Rate</th><th>Amount</th><th></th>
      </tr></thead><tbody>${lineRows}</tbody></table>

      ${inv.status === "draft" ? `
        <div class="card" style="margin-top:12px">
          <h4 style="margin:0">Add Manual Line Item</h4>
          <div class="row" style="display:flex;gap:10px;flex-wrap:wrap;align-items:end">
            <label>Description <input id="add-line-desc" type="text" required /></label>
            <label>Hours <input id="add-line-hours" type="number" step="0.25" min="0" value="0" /></label>
            <label>Rate (cents) <input id="add-line-rate" type="number" min="0" value="0" /></label>
            <label>Amount (cents) <input id="add-line-amount" type="number" min="0" /></label>
            <button id="add-line-btn">Add</button>
          </div>
        </div>` : ""}

      ${paymentRows ? `
        <h4 style="margin-top:16px">Payment History</h4>
        <table class="grid"><thead><tr>
          <th>Date</th><th>Method</th><th>Reference</th><th>Amount</th>
        </tr></thead><tbody>${paymentRows}</tbody></table>` : ""}

      <div style="margin-top:16px;display:flex;gap:10px;flex-wrap:wrap">
        <button class="link" data-invoice-url="${API}/api/invoices/${inv.id}/html">View Printable Invoice</button>
        ${inv.status === "draft" ? `<button class="link" id="inv-send-btn">Mark as Sent</button>` : ""}
        <button class="link" id="inv-csv-export-btn">Export CSV</button>
        ${inv.status === "sent" || inv.status === "draft" ? `<button class="link" id="inv-paypal-btn">PayPal Invoice</button>` : ""}
      </div>
    `;
    const backBtn = $("#inv-back-btn");
    if (backBtn) backBtn.onclick = () => loadInvoices();
    const csvExportBtn = $("#inv-csv-export-btn");
    if (csvExportBtn) csvExportBtn.onclick = () => handleInvoiceCsvExport(invoiceId);
    const paypalBtn = $("#inv-paypal-btn");
    if (paypalBtn) paypalBtn.onclick = () => handlePaypalInvoice(invoiceId);
    $$("button[data-rmline]").forEach((b) => {
      b.onclick = async () => {
        if (!confirm("Remove this line item?")) return;
        try {
          await api(`/invoices/${b.dataset.rminv}/line-items/${b.dataset.rmline}`, { method: "DELETE" });
          showInvoiceDetail(invoiceId);
        } catch (e) {
          alert(e.message);
        }
      };
    });
    const addLineBtn = $("#add-line-btn");
    if (addLineBtn) {
      addLineBtn.onclick = async () => {
        const desc = $("#add-line-desc")?.value;
        if (!desc) {
          alert("Description required");
          return;
        }
        const hours = parseFloat($("#add-line-hours")?.value) || 0;
        const rateCents = parseInt($("#add-line-rate")?.value, 10) || 0;
        const amtVal = $("#add-line-amount")?.value;
        const body = { description: desc, hours, rate_cents: rateCents };
        if (amtVal) body.amount_cents = parseInt(amtVal, 10);
        try {
          await api(`/invoices/${invoiceId}/line-items`, { method: "POST", body });
          showInvoiceDetail(invoiceId);
        } catch (e) {
          alert(e.message);
        }
      };
    }
    const sendBtn = $("#inv-send-btn");
    if (sendBtn) {
      sendBtn.onclick = async () => {
        const recipientEmail = prompt("Send invoice email to (leave empty to just mark as sent):");
        const sendBody = {};
        if (recipientEmail && recipientEmail.trim()) {
          sendBody.recipient_email = recipientEmail.trim();
        }
        if (!confirm(`Mark this invoice as sent${recipientEmail ? " and email to " + recipientEmail : ""}?`)) return;
        try {
          const result = await api(`/invoices/${invoiceId}/send`, { method: "POST", body: sendBody });
          if (result.email_sent) {
            alert("Invoice sent via email.");
          } else if (result.email_stubbed) {
            alert("Invoice marked as sent (email provider not configured · stub mode).");
          }
          showInvoiceDetail(invoiceId);
        } catch (e) {
          alert(e.message);
        }
      };
    }
  } catch (e) {
    out.innerHTML = `<p class="err">${escapeHtml(e.message)}</p>`;
  }
}
let _rptData = null;
let _rptEntries = null;
let _rptStaff = null;
let _rptActiveTab = "summary";
let _rptLoadId = 0;
let _rptDetailId = 0;
const RPT_ROW_LIMIT = 200;
function _rptIsStaffMode() {
  return !!(ME && ME.role === "employee");
}
function _rptIsoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function _rptHoursToHMS(h) {
  const totalSec = Math.round(h * 3600);
  const hh = Math.floor(totalSec / 3600);
  const mm = Math.floor(totalSec % 3600 / 60);
  const ss = totalSec % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}
function _rptGetFilters() {
  const from = $("#report-sum-from")?.value || "";
  const to = $("#report-sum-to")?.value || "";
  const clientId = $("#rpt-filter-client")?.value || "";
  const employeeId = $("#rpt-filter-employee")?.value || "";
  return { from, to, clientId, employeeId };
}
function _rptPresetRange(kind) {
  const now = /* @__PURE__ */ new Date();
  const mondayOf = (d) => {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const off = x.getDay() === 0 ? 6 : x.getDay() - 1;
    x.setDate(x.getDate() - off);
    return x;
  };
  if (kind === "this-week") {
    const mon = mondayOf(now);
    const sun = new Date(mon);
    sun.setDate(sun.getDate() + 6);
    return { from: _rptIsoDate(mon), to: _rptIsoDate(sun) };
  }
  if (kind === "last-week") {
    const mon = mondayOf(now);
    mon.setDate(mon.getDate() - 7);
    const sun = new Date(mon);
    sun.setDate(sun.getDate() + 6);
    return { from: _rptIsoDate(mon), to: _rptIsoDate(sun) };
  }
  if (kind === "this-month") {
    return { from: _rptIsoDate(new Date(now.getFullYear(), now.getMonth(), 1)), to: _rptIsoDate(now) };
  }
  if (kind === "last-month") {
    return {
      from: _rptIsoDate(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
      to: _rptIsoDate(new Date(now.getFullYear(), now.getMonth(), 0))
    };
  }
  return null;
}
async function _rptFetchStaff(from, to, clientId) {
  const q = new URLSearchParams();
  if (from) q.set("from", from);
  if (to) q.set("to", to);
  if (clientId) q.set("client_id", clientId);
  return await api(`/reports/staff?${q}`);
}
function _rptSyncRoleOnlyParts() {
  if (!ME) return;
  const staff = _rptIsStaffMode();
  const empFilter = $("#rpt-filter-employee");
  if (empFilter) empFilter.style.display = staff ? "none" : "";
  const groupBy = $("#rpt-group-by");
  if (groupBy) {
    const empOpt = groupBy.querySelector('option[value="employee"]');
    if (staff && empOpt) empOpt.remove();
    else if (!staff && !empOpt) {
      const opt = document.createElement("option");
      opt.value = "employee";
      opt.textContent = "Employee";
      groupBy.appendChild(opt);
    }
    if (staff && groupBy.value === "employee") groupBy.value = "client";
  }
  const csvBtn = $("#report-export-csv-btn");
  if (csvBtn) {
    const isMgr = tsIsManager() === true;
    if (staff) {
      csvBtn.textContent = isMgr ? "Export my clients' hours" : "Export my timesheet";
      csvBtn.title = isMgr ? "The hours on your assigned clients for the chosen range, as CSV." : "Your own entries for the chosen range, as CSV.";
    } else {
      csvBtn.textContent = "Export CSV";
      csvBtn.title = "Export time entries as CSV";
    }
  }
  const pdfBtn = $("#report-export-pdf-btn");
  if (pdfBtn) {
    pdfBtn.title = staff ? "Download your time report for the chosen range as a PDF file." : "Download the client report for the chosen range as a PDF file.";
  }
}
function _rptVisibleRows() {
  const { clientId, employeeId } = _rptGetFilters();
  return RptMath.filterRows(_rptEntries || [], { clientId, employeeId });
}
function _rptCurrency() {
  const { clientId } = _rptGetFilters();
  if (!clientId) return "USD";
  const c = CLIENTS.find((cl) => String(cl.id) === String(clientId));
  return c && c.currency || "USD";
}
function _rptSetDefaultDates() {
  const fromEl = $("#report-sum-from");
  const toEl = $("#report-sum-to");
  if (fromEl && !fromEl.value) {
    const now = /* @__PURE__ */ new Date();
    fromEl.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  }
  if (toEl && !toEl.value) {
    toEl.value = todayISO();
  }
}
function _rptRenderStats(t) {
  const row = $("#rpt-stats-row");
  if (!row) return;
  const amountCard = _rptIsStaffMode() ? "" : `
    <div class="rpt-stat-card">
      <div class="rpt-stat-value">$${Number(t.billable_amount || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}</div>
      <div class="rpt-stat-label">Amount (USD)</div>
    </div>`;
  const nonBillableCard = _rptIsStaffMode() ? `
    <div class="rpt-stat-card">
      <div class="rpt-stat-value">${_rptHoursToHMS(t.non_billable_hours || 0)}</div>
      <div class="rpt-stat-label">Non-billable Hours</div>
    </div>` : "";
  row.innerHTML = `
    <div class="rpt-stat-card">
      <div class="rpt-stat-value">${_rptHoursToHMS(t.total_hours || 0)}</div>
      <div class="rpt-stat-label">Total Hours</div>
    </div>
    <div class="rpt-stat-card">
      <div class="rpt-stat-value">${_rptHoursToHMS(t.billable_hours || 0)}</div>
      <div class="rpt-stat-label">Billable Hours</div>
    </div>
    ${nonBillableCard}
    ${amountCard}
  `;
}
function _rptRenderRowsNote(cardTotals) {
  const el = $("#rpt-rows-note");
  if (!el) return;
  if (_rptIsStaffMode() && _rptStaff) {
    const t2 = _rptStaff.totals || {};
    const shown = (_rptStaff.rows || []).length;
    const total = _rptStaff.rows_total || 0;
    const text = `Rows in this period: ${total} · ${Number(t2.total_hours || 0).toFixed(2)} h · ${Number(t2.billable_hours || 0).toFixed(2)} h billable`;
    el.innerHTML = total > shown ? `<span class="muted small">${text} — the table shows the first ${shown}. Export CSV for the complete set.${_rptExcludedText()}</span>` : `<span class="muted small">${text} — the cards above are these rows.${_rptExcludedText()}</span>`;
    return;
  }
  const t = RptMath.sumRows(_rptVisibleRows());
  const cur = _rptCurrency();
  const cardHours = Number(cardTotals.total_hours) || 0;
  const cardCents = Math.round((Number(cardTotals.billable_amount) || 0) * 100);
  const same = Math.abs(cardHours - t.total_hours) < 5e-3 && Math.abs(cardCents - t.amount_cents) < 1;
  const rowText = `Rows on this tab: ${t.count} · ${t.total_hours.toFixed(2)} h · ${money(t.amount_cents, cur)}`;
  if (same) {
    el.innerHTML = `<span class="muted small">${rowText} — the cards above are these rows.${_rptExcludedText()}</span>`;
  } else {
    const fetched = (_rptEntries || []).length;
    const howMany = fetched >= RPT_ROW_LIMIT ? `the first ${t.count} entries` : `${t.count} of the ${fetched} entries the server sent`;
    el.innerHTML = `<span class="muted small">${rowText} — the cards above cover more (${cardHours.toFixed(2)} h · ${money(cardCents, cur)}); this view shows ${howMany}. Export CSV for the complete set.${_rptExcludedText()}</span>`;
  }
}
function _rptExcludedText() {
  const ex = _rptStaff && _rptStaff.excluded || null;
  if (!ex || !ex.entry_count) return "";
  const n = Number(ex.client_count) || 0;
  return ` — ${Number(ex.total_hours || 0).toFixed(2)} h on ${n} archived client${n === 1 ? "" : "s"} are not counted (a client that is gone earns nothing)`;
}
function _rptRenderChart() {
  const chartEl = $("#rpt-chart");
  const dayEl = $("#rpt-chart-days");
  if (!chartEl) return;
  const { from, to } = _rptGetFilters();
  const staffDays = _rptStaff && _rptStaff.groups && _rptStaff.groups.day || null;
  if (!from || !to) {
    chartEl.innerHTML = '<div class="rpt-chart-empty">Set a date range to see the chart</div>';
    if (dayEl) dayEl.innerHTML = "";
    return;
  }
  if (!staffDays) {
    chartEl.innerHTML = '<div class="rpt-chart-empty">The chart could not be drawn — the report did not answer</div>';
    if (dayEl) dayEl.innerHTML = "";
    return;
  }
  const days = staffDays;
  if (!days.length) {
    chartEl.innerHTML = '<div class="rpt-chart-empty">No hours in this period</div>';
    if (dayEl) dayEl.innerHTML = "";
    return;
  }
  const startDate = /* @__PURE__ */ new Date(from + "T00:00:00");
  const endDate = /* @__PURE__ */ new Date(to + "T23:59:59");
  const weeks = [];
  const cur = new Date(startDate);
  const dayOff = cur.getDay() === 0 ? 6 : cur.getDay() - 1;
  cur.setDate(cur.getDate() - dayOff);
  while (cur <= endDate) {
    const weekStart = new Date(cur);
    const weekEnd = new Date(cur);
    weekEnd.setDate(weekEnd.getDate() + 6);
    weeks.push({ start: weekStart, end: weekEnd, hours: 0 });
    cur.setDate(cur.getDate() + 7);
  }
  for (const d of days) {
    const dayDate = /* @__PURE__ */ new Date(d.key + "T12:00:00");
    for (const w of weeks) {
      if (dayDate >= w.start && dayDate <= w.end) {
        w.hours += Number(d.total_hours) || 0;
        break;
      }
    }
  }
  const maxH = Math.max(...weeks.map((w) => w.hours), 1);
  if (weeks.length === 0) {
    chartEl.innerHTML = '<div class="rpt-chart-empty">No data for chart</div>';
    if (dayEl) dayEl.innerHTML = "";
    return;
  }
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const bars = weeks.map((w) => {
    const pct = Math.max(w.hours / maxH * 100, w.hours > 0 ? 3 : 0);
    const label = `${monthNames[w.start.getMonth()]} ${w.start.getDate()}`;
    const val = w.hours > 0 ? w.hours.toFixed(1) + "h" : "";
    const floor = w.hours > 0 ? 4 : 0;
    return `<div class="rpt-bar-col">
      <span class="rpt-bar-val">${val}</span>
      <div class="rpt-bar-track"><div class="rpt-bar" style="height:${pct}%;min-height:${floor}px"></div></div>
      <span class="rpt-bar-label">${label}</span>
    </div>`;
  }).join("");
  chartEl.innerHTML = `
    <div class="rpt-chart-title">HOURS PER WEEK</div>
    <div class="rpt-chart-bars">${bars}</div>
  `;
  if (dayEl) {
    const maxDay = Math.max(...days.map((d) => Number(d.total_hours) || 0), 1);
    const dayBars = days.map((d) => {
      const h = Number(d.total_hours) || 0;
      const pct = Math.max(h / maxDay * 100, h > 0 ? 3 : 0);
      const dt = /* @__PURE__ */ new Date(d.key + "T12:00:00");
      const val = h > 0 ? h.toFixed(1) + "h" : "";
      const floor = h > 0 ? 4 : 0;
      return `<div class="rpt-bar-col">
        <span class="rpt-bar-val">${val}</span>
        <div class="rpt-bar-track"><div class="rpt-bar" style="height:${pct}%;min-height:${floor}px"></div></div>
        <span class="rpt-bar-label">${dt.getDate()}</span>
      </div>`;
    }).join("");
    dayEl.innerHTML = `
      <div class="rpt-chart-title">HOURS PER DAY</div>
      <div class="rpt-chart-bars">${dayBars}</div>
    `;
  }
}
function _rptRenderGrouped(data) {
  const el = $("#rpt-grouped-table");
  if (!el) return;
  const groupBy = $("#rpt-group-by")?.value || "client";
  const staffGroups = _rptStaff && _rptStaff.groups || {};
  let groups = [];
  if (groupBy === "task" || groupBy === "day") {
    groups = (staffGroups[groupBy] || []).map((g) => ({
      name: g.name,
      hours: g.total_hours || 0,
      billable: g.billable_hours || 0,
      nonbillable: g.non_billable_hours || 0,
      amount: "",
      children: []
    }));
  } else if (groupBy === "client") {
    if (_rptIsStaffMode()) {
      groups = (staffGroups.client || []).map((c) => ({
        name: c.name,
        hours: c.total_hours || 0,
        billable: c.billable_hours || 0,
        nonbillable: c.non_billable_hours || 0,
        amount: "",
        children: []
      }));
    } else {
      groups = (data.clients || []).map((c) => ({
        name: c.name,
        hours: c.total_hours || 0,
        billable: c.billable_hours || 0,
        nonbillable: c.internal_hours || 0,
        amount: c.billable_amount || "0.00",
        children: (data.employees || []).flatMap(
          (emp) => (emp.clients || []).filter((ec) => ec.client_name === c.name).map((ec) => ({
            name: emp.display_name || emp.email,
            hours: ec.hours || 0
          }))
        )
      }));
    }
  } else {
    const split = new Map((staffGroups.employee || []).map((e) => [e.key, e]));
    groups = (data.employees || []).map((e) => {
      const se = split.get(e.id);
      return {
        name: e.display_name || e.email,
        hours: e.total_hours || 0,
        billable: se ? se.billable_hours : null,
        nonbillable: se ? se.non_billable_hours : null,
        amount: "",
        children: (e.clients || []).map((c) => ({
          name: c.client_name,
          hours: c.hours || 0
        }))
      };
    });
  }
  groups.sort((a, b) => b.hours - a.hours);
  if (groups.length === 0) {
    el.innerHTML = '<div class="rpt-empty">No data to display</div>';
    return;
  }
  el.innerHTML = groups.map((g, i) => {
    const childRows = g.children.map(
      (c) => `<div class="rpt-detail-row">
        <div class="rpt-detail-name">${cdotName(c.name)}${escapeHtml(c.name)}</div>
        <div class="rpt-detail-dur">${_rptHoursToHMS(c.hours)}</div>
        <div class="rpt-detail-amt"></div>
      </div>`
    ).join("");
    const amtStr = g.amount ? `$${Number(g.amount).toLocaleString("en-US", { minimumFractionDigits: 2 })}` : "";
    const split = g.billable === null || g.billable === void 0 ? "" : `<span class="rpt-group-split">${Number(g.billable).toFixed(2)} h billable · ${Number(g.nonbillable || 0).toFixed(2)} h non-billable</span>`;
    return `
      <div class="rpt-group-row" data-rptg="${i}">
        <span class="rpt-group-arrow" id="rptg-arrow-${i}">&#9654;</span>
        <span class="rpt-group-name">
          <span class="rpt-group-title">${cdotName(g.name)}${escapeHtml(g.name)}</span>
          ${split}
        </span>
        <span class="rpt-group-dur">${_rptHoursToHMS(g.hours)}</span>
        <span class="rpt-group-amt">${amtStr}</span>
      </div>
      <div class="rpt-group-detail" id="rptg-detail-${i}">${childRows}</div>
    `;
  }).join("");
  el.querySelectorAll(".rpt-group-row").forEach((row) => {
    row.onclick = () => {
      const idx = row.dataset.rptg;
      const detail = $(`#rptg-detail-${idx}`);
      const arrow = $(`#rptg-arrow-${idx}`);
      if (detail) detail.classList.toggle("open");
      if (arrow) arrow.classList.toggle("open");
    };
  });
}
async function _rptRenderDetailed() {
  const el = $("#rpt-detailed-table");
  if (!el) return;
  const detailId = ++_rptDetailId;
  if (_rptIsStaffMode()) return _rptRenderStaffDetailed(el);
  const { from, to, clientId, employeeId } = _rptGetFilters();
  const q = new URLSearchParams();
  if (from) q.set("from", from);
  if (to) q.set("to", to);
  if (clientId) q.set("client_id", clientId);
  q.set("limit", String(RPT_ROW_LIMIT));
  q.set("exclude_archived", "1");
  el.innerHTML = '<p class="muted small">Loading entries...</p>';
  try {
    const data = await api(`/time-entries?${q}`);
    if (detailId !== _rptDetailId) return;
    const all = data.entries || data || [];
    const entries = RptMath.filterRows(all, { employeeId });
    if (!entries.length) {
      el.innerHTML = '<div class="rpt-empty">No entries found</div>';
      return;
    }
    const cur = _rptCurrency();
    const t = RptMath.sumRows(entries);
    const rows = entries.map((e) => {
      const cents = RptMath.amountCents(e);
      const client = CLIENTS.find((c) => String(c.id) === String(e.client_id));
      const clientRate = Number(client && client.rate_cents) || 0;
      let title = "";
      if (e.is_billable && !RptMath.hasRate(e)) {
        title = clientRate ? `No rate on this entry (the client's current rate is ${money(clientRate, cur)})` : "No rate set on this entry";
      }
      return `<tr>
      <td>${e.entry_date}</td>
      <td>${escapeHtml(e.user_name || e.user_display_name || e.user_email || "")}</td>
      <td>${cdotName(e.client_name)}${escapeHtml(e.client_name || "")}</td>
      <td>${escapeHtml(e.project_task || "")}</td>
      <td style="text-align:right">${_rptHoursToHMS(Number(e.hours) || 0)}</td>
      <td style="text-align:right"${title ? ` title="${escapeHtml(title)}"` : ""}>${e.is_billable ? money(cents, cur) : "—"}</td>
    </tr>`;
    }).join("");
    const capNote = all.length >= RPT_ROW_LIMIT ? `<p class="muted small">Showing the first ${RPT_ROW_LIMIT} entries. Export CSV for the complete set.</p>` : "";
    el.innerHTML = `${capNote}<table class="grid"><thead><tr>
      <th>Date</th><th>Employee</th><th>Client</th><th>Task</th><th style="text-align:right">Duration</th><th style="text-align:right">Amount</th>
    </tr></thead><tbody>${rows}</tbody>
    <tfoot><tr>
      <td colspan="4">Total (${t.count} rows)</td>
      <td style="text-align:right">${t.total_hours.toFixed(2)} h</td>
      <td style="text-align:right">${money(t.amount_cents, cur)}</td>
    </tr></tfoot></table>`;
  } catch (err) {
    el.innerHTML = `<p class="err">${escapeHtml(err.message)}</p>`;
  }
}
async function _rptRenderWeekly() {
  const el = $("#rpt-weekly-table");
  if (!el) return;
  if (_rptIsStaffMode()) return _rptRenderStaffWeekly(el);
  const matrix = _rptStaff && _rptStaff.groups && _rptStaff.groups.client_day || null;
  if (matrix) return _rptRenderPivotFromMatrix(el, matrix);
  const { from, to, clientId } = _rptGetFilters();
  const q = new URLSearchParams();
  if (from) q.set("from", from);
  if (to) q.set("to", to);
  if (clientId) q.set("client_id", clientId);
  q.set("limit", String(RPT_ROW_LIMIT));
  q.set("exclude_archived", "1");
  el.innerHTML = '<p class="muted small">Loading weekly view...</p>';
  try {
    const data = await api(`/time-entries?${q}`);
    const all = data.entries || data || [];
    if (!all.length) {
      el.innerHTML = '<div class="rpt-empty">No entries found</div>';
      return;
    }
    const rows = all.map((e) => ({
      client_name: e.client_name,
      day: e.entry_date,
      hours: Number(e.hours) || 0
    }));
    _rptRenderPivotFromMatrix(el, rows, all.length >= RPT_ROW_LIMIT);
  } catch (err) {
    el.innerHTML = `<p class="err">${escapeHtml(err.message)}</p>`;
  }
}
function _rptPivotColumns(from, to) {
  const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const startDate = /* @__PURE__ */ new Date((from || todayISO()) + "T00:00:00");
  const endDate = /* @__PURE__ */ new Date((to || todayISO()) + "T23:59:59");
  const dayOff = startDate.getDay() === 0 ? 6 : startDate.getDay() - 1;
  startDate.setDate(startDate.getDate() - dayOff);
  const totalDays = Math.round((endDate - startDate) / (1e3 * 60 * 60 * 24)) + 1;
  const cols = [];
  if (totalDays > 7) {
    const cur = new Date(startDate);
    while (cur <= endDate) {
      const ws = new Date(cur);
      const we = new Date(cur);
      we.setDate(we.getDate() + 6);
      cols.push({ start: _rptIsoDate(ws), end: _rptIsoDate(we), label: monthNames[ws.getMonth()] + " " + ws.getDate() });
      cur.setDate(cur.getDate() + 7);
    }
  } else {
    const d = new Date(startDate);
    for (let i = 0; i < 7 && d <= endDate; i++) {
      cols.push({ start: _rptIsoDate(d), end: _rptIsoDate(d), label: dayNames[i] + " " + (d.getMonth() + 1) + "/" + d.getDate() });
      d.setDate(d.getDate() + 1);
    }
  }
  return cols;
}
function _rptRenderStaffDetailed(el) {
  const staff = _rptStaff;
  if (!staff) {
    el.innerHTML = '<div class="rpt-empty">No data to display</div>';
    return;
  }
  const rows = staff.rows || [];
  if (!rows.length) {
    el.innerHTML = '<div class="rpt-empty">No entries in this period</div>';
    return;
  }
  const t = staff.totals || {};
  const body = rows.map((r) => `<tr>
    <td>${escapeHtml(r.date || "")}</td>
    <td>${cdotName(r.client_name)}${escapeHtml(r.client_name || "")}</td>
    <td>${escapeHtml(r.task || "")}</td>
    <td style="text-align:right">${_rptHoursToHMS(Number(r.hours) || 0)}</td>
    <td>${r.billable ? "Billable" : "Not billable"}</td>
    <td>${escapeHtml(r.notes || "")}</td>
    <td>${escapeHtml(r.status || "")}</td>
  </tr>`).join("");
  const capNote = staff.rows_truncated ? `<p class="muted small">Showing the first ${rows.length} of ${staff.rows_total} entries. Export CSV for the complete set.</p>` : "";
  el.innerHTML = `${capNote}<table class="grid"><thead><tr>
    <th>Date</th><th>Client</th><th>Task</th><th style="text-align:right">Duration</th><th>Billable</th><th>Notes</th><th>Status</th>
  </tr></thead><tbody>${body}</tbody>
  <tfoot><tr>
    <td colspan="3">Total (${staff.rows_total} rows)</td>
    <td style="text-align:right">${Number(t.total_hours || 0).toFixed(2)} h</td>
    <td colspan="2">${Number(t.billable_hours || 0).toFixed(2)} h billable</td>
    <td></td>
  </tr></tfoot></table>`;
}
function _rptRenderPivotFromMatrix(el, matrix, truncated) {
  const { from, to } = _rptGetFilters();
  const cols = _rptPivotColumns(from, to);
  if (!matrix || !matrix.length || !cols.length) {
    el.innerHTML = '<div class="rpt-empty">No entries in this period</div>';
    return;
  }
  const byClient = {};
  for (const r of matrix) {
    const cname = r.client_name || "(no client)";
    if (!byClient[cname]) byClient[cname] = {};
    for (const col of cols) {
      if (r.day >= col.start && r.day <= col.end) {
        byClient[cname][col.start] = (byClient[cname][col.start] || 0) + (Number(r.hours) || 0);
        break;
      }
    }
  }
  const clientNames = Object.keys(byClient).sort();
  const thCols = cols.map((c) => `<th>${c.label}</th>`).join("");
  const rows = clientNames.map((cname) => {
    let total = 0;
    const cells = cols.map((c) => {
      const h = byClient[cname][c.start] || 0;
      total += h;
      return `<td>${h > 0 ? h.toFixed(2) : ""}</td>`;
    }).join("");
    return `<tr><td>${cdotName(cname)}${escapeHtml(cname)}</td>${cells}<td class="rpt-weekly-total-cell">${total.toFixed(2)}</td></tr>`;
  }).join("");
  const grandCells = cols.map((c) => {
    const h = clientNames.reduce((sum, cn) => sum + (byClient[cn][c.start] || 0), 0);
    return `<td class="rpt-weekly-total-cell">${h > 0 ? h.toFixed(2) : ""}</td>`;
  }).join("");
  const grandTotal = clientNames.reduce((sum, cn) => sum + Object.values(byClient[cn]).reduce((s, v) => s + v, 0), 0);
  const capNote = truncated ? `<p class="muted small">The report did not answer, so this view is built from the first ${RPT_ROW_LIMIT} entries. Export CSV for the complete set.</p>` : "";
  el.innerHTML = `${capNote}<div class="rpt-weekly-wrap"><table class="grid">
    <thead><tr><th>Client</th>${thCols}<th>Total</th></tr></thead>
    <tbody>${rows}
      <tr style="border-top:2px solid var(--line);font-weight:700">
        <td>Total</td>${grandCells}<td class="rpt-weekly-total-cell">${grandTotal.toFixed(2)}</td>
      </tr>
    </tbody>
  </table></div>`;
}
function _rptRenderStaffWeekly(el) {
  const staff = _rptStaff;
  if (!staff) {
    el.innerHTML = '<div class="rpt-empty">No data to display</div>';
    return;
  }
  _rptRenderPivotFromMatrix(el, staff.groups && staff.groups.client_day || []);
}
async function loadSummaryReport() {
  _rptSetDefaultDates();
  const loadId = ++_rptLoadId;
  const stale = () => loadId !== _rptLoadId;
  const wantedEmployee = $("#rpt-filter-employee")?.value || "";
  const empSelect = $("#rpt-filter-employee");
  if (empSelect && ME.role === "admin") {
    try {
      const { users } = await api("/admin/users");
      if (stale()) return;
      const empOpts = (users || []).filter((u) => u.role !== "client" && u.active !== false).map((u) => `<option value="${u.id}">${escapeHtml(u.display_name || u.email)}</option>`).join("");
      empSelect.innerHTML = `<option value="">All team</option>` + empOpts;
      if (wantedEmployee) empSelect.value = wantedEmployee;
    } catch (_) {
    }
  }
  const { from, to, clientId, employeeId } = _rptGetFilters();
  let staffData = null;
  try {
    staffData = await _rptFetchStaff(from, to, clientId);
  } catch (e) {
    staffData = null;
    if (_rptIsStaffMode()) {
      const statsRow = $("#rpt-stats-row");
      if (statsRow) statsRow.innerHTML = `<p class="err">${escapeHtml(e.message)}</p>`;
      return;
    }
  }
  if (stale()) return;
  _rptStaff = staffData;
  if (_rptIsStaffMode()) {
    const t = staffData && staffData.totals || {};
    _rptRenderStats(t);
    _rptRenderRowsNote(t);
    _rptRenderChart();
    _rptRenderGrouped({});
    if (_rptActiveTab === "detailed") _rptRenderDetailed();
    if (_rptActiveTab === "weekly") _rptRenderWeekly();
    return;
  }
  const q = new URLSearchParams();
  if (from) q.set("from", from);
  if (to) q.set("to", to);
  if (clientId) q.set("client_id", clientId);
  if (employeeId) q.set("employee_id", employeeId);
  try {
    let data;
    const eq = new URLSearchParams();
    if (from) eq.set("from", from);
    if (to) eq.set("to", to);
    if (clientId) eq.set("client_id", clientId);
    eq.set("limit", String(RPT_ROW_LIMIT));
    eq.set("exclude_archived", "1");
    let entries = [];
    try {
      const eData = await api(`/time-entries?${eq}`);
      entries = eData.entries || eData || [];
    } catch (_) {
      entries = [];
    }
    if (stale()) return;
    _rptEntries = entries;
    try {
      if (_rptIsStaffMode() && tsIsManager() !== true) throw new Error("employees use their own entries");
      data = await api(`/reports/summary?${q}`);
    } catch (_) {
      let billH = 0, intH = 0, billCents = 0;
      const cMap = {}, eMap = {};
      for (const e of entries) {
        const h = Number(e.hours) || 0;
        if (e.is_billable) {
          billH += h;
          billCents += Math.round(h * (e.rate_cents || 0));
        } else intH += h;
        const cn = e.client_name || "Unknown";
        if (!cMap[cn]) cMap[cn] = { id: e.client_id, name: cn, total_hours: 0, billable_hours: 0, internal_hours: 0, billable_cents: 0, hours_cap: null };
        cMap[cn].total_hours += h;
        if (e.is_billable) {
          cMap[cn].billable_hours += h;
          cMap[cn].billable_cents += Math.round(h * (e.rate_cents || 0));
        } else cMap[cn].internal_hours += h;
        const en = e.user_display_name || e.user_email || "Unknown";
        if (!eMap[en]) eMap[en] = { id: e.user_id, email: e.user_email, display_name: en, total_hours: 0, clients: {}, client_count: 0 };
        eMap[en].total_hours += h;
        if (!eMap[en].clients[cn]) eMap[en].clients[cn] = 0;
        eMap[en].clients[cn] += h;
      }
      for (const emp of Object.values(eMap)) {
        emp.client_count = Object.keys(emp.clients).length;
        emp.clients = Object.entries(emp.clients).map(([n, h2]) => ({ client_name: n, hours: Number(h2.toFixed(2)) }));
      }
      for (const c of Object.values(cMap)) {
        const match = CLIENTS.find((cl) => cl.name === c.name);
        if (match) {
          c.hours_cap = match.hours_cap;
          c.currency = match.currency;
        }
        c.billable_amount = (c.billable_cents / 100).toFixed(2);
        c.cap_utilization = c.hours_cap ? c.billable_hours / c.hours_cap * 100 : null;
      }
      data = {
        ok: true,
        totals: { total_hours: billH + intH, billable_hours: billH, internal_hours: intH, billable_cents: billCents, billable_amount: (billCents / 100).toFixed(2) },
        clients: Object.values(cMap).sort((a, b) => b.billable_hours - a.billable_hours),
        employees: Object.values(eMap).sort((a, b) => b.total_hours - a.total_hours)
      };
    }
    if (stale()) return;
    _rptData = data;
    const excludedIds = new Set((((_rptStaff || {}).excluded || {}).clients || []).map((c) => String(c.client_id)));
    if (excludedIds.size && Array.isArray(_rptEntries)) {
      _rptEntries = _rptEntries.filter((e) => !excludedIds.has(String(e.client_id)));
    }
    let filteredData = data;
    if (clientId) {
      const cid = String(clientId);
      const cidName = (CLIENTS.find((cl) => String(cl.id) === cid) || {}).name;
      const isForClient = (c) => String(c.client_id) === cid || !!cidName && c.client_name === cidName;
      const clientsForCid = (data.clients || []).filter((c) => String(c.id) === cid);
      filteredData = {
        ...data,
        clients: clientsForCid,
        employees: (data.employees || []).map((e) => ({
          ...e,
          clients: (e.clients || []).filter(isForClient),
          total_hours: (e.clients || []).filter(isForClient).reduce((s, c) => s + c.hours, 0)
        })).filter((e) => e.total_hours > 0),
        totals: {
          ...data.totals,
          total_hours: clientsForCid.reduce((s, c) => s + (Number(c.total_hours) || 0), 0),
          billable_hours: clientsForCid.reduce((s, c) => s + (Number(c.billable_hours) || 0), 0),
          billable_amount: clientsForCid.reduce((s, c) => s + (Number(c.billable_amount) || 0), 0).toFixed(2)
        }
      };
    }
    if (employeeId) {
      const eid = String(employeeId);
      filteredData = {
        ...filteredData,
        employees: (filteredData.employees || []).filter((e) => String(e.id) === eid)
      };
      _rptEntries = (_rptEntries || []).filter((e) => String(e.user_id) === eid);
    }
    _rptRenderStats(filteredData.totals || {});
    _rptRenderRowsNote(filteredData.totals || {});
    _rptRenderChart();
    _rptRenderGrouped(filteredData);
    if (_rptActiveTab === "detailed") _rptRenderDetailed();
    if (_rptActiveTab === "weekly") _rptRenderWeekly();
  } catch (e) {
    const statsRow = $("#rpt-stats-row");
    if (statsRow) statsRow.innerHTML = `<p class="err">${escapeHtml(e.message)}</p>`;
  }
}
async function loadBudget() {
  const summaryCards = $("#budget-summary-cards");
  const tableOut = $("#budget-table-out");
  const detailOut = $("#budget-detail-out");
  if (!tableOut) return;
  if (detailOut) detailOut.classList.add("hidden");
  try {
    const data = await api("/budget/weekly");
    const clients = data.clients || [];
    let underTargetIds = /* @__PURE__ */ new Set();
    try {
      const ut = await api("/budget/under-target");
      for (const c of ut.clients || []) underTargetIds.add(c.client_id);
    } catch (_) {
    }
    const overCount = clients.filter((c) => c.over_budget).length;
    const behindCount = clients.filter((c) => c.behind_pace).length;
    const okCount = clients.length - overCount - behindCount;
    if (summaryCards) {
      summaryCards.innerHTML = `
        <div class="dash-card">
          <div class="dash-value">${clients.length}</div>
          <div class="dash-label">Tracked Clients</div>
        </div>
        <div class="dash-card" style="border-color:var(--ok)">
          <div class="dash-value" style="color:var(--ok)">${okCount}</div>
          <div class="dash-label">On Track</div>
        </div>
        ${overCount > 0 ? `
          <div class="dash-card" style="border-color:var(--danger)">
            <div class="dash-value" style="color:var(--danger)">${overCount}</div>
            <div class="dash-label">Over Budget</div>
          </div>` : ""}
        ${behindCount > 0 ? `
          <div class="dash-card" style="border-color:var(--warn)">
            <div class="dash-value" style="color:var(--warn)">${behindCount}</div>
            <div class="dash-label">Behind Pace</div>
          </div>` : ""}
      `;
    }
    if (clients.length === 0) {
      tableOut.innerHTML = '<p class="muted small">No clients with weekly hour caps configured.</p>';
      return;
    }
    const rows = clients.map((c) => {
      const pctClass = c.pct_used > 100 ? "budget-pct-red" : c.pct_used >= 80 ? "budget-pct-yellow" : "budget-pct-green";
      const rowClass = c.over_budget ? "budget-row-red" : c.behind_pace ? "budget-row-amber" : c.pct_used >= 80 ? "budget-row-yellow" : "budget-row-green";
      const barColor = c.pct_used > 100 ? "var(--danger)" : c.pct_used >= 80 ? "var(--warn)" : "var(--ok)";
      const barWidth = Math.min(c.pct_used, 120);
      const flags = [];
      if (c.over_budget) flags.push('<span class="budget-over-badge">Over</span>');
      if (c.behind_pace) flags.push('<span class="budget-behind-badge">Behind</span>');
      return `<tr class="clickable-row ${rowClass}" data-budget-cid="${c.client_id}">
        <td>${cdotName(c.client_name)}${escapeHtml(c.client_name)}</td>
        <td class="num">${c.effective_hours}h</td>
        <td class="num">${c.hours_cap}h</td>
        <td class="num">${c.remaining}h</td>
        <td>
          <div class="budget-mini-bar">
            <div class="bar-container">
              <div class="bar-fill" style="width:${Math.min(barWidth, 100)}%;background:${barColor}"></div>
            </div>
            <span class="budget-pct ${pctClass}">${c.pct_used}%</span>
          </div>
        </td>
        <td class="num">${c.projected_hours}h</td>
        <td>${flags.join(" ")}</td>
      </tr>`;
    }).join("");
    tableOut.innerHTML = `
      <p class="muted small">Week of ${data.week_start} · ${data.work_days_elapsed} work day(s) elapsed. Click a row for detail.</p>
      <table class="budget-table"><thead><tr>
        <th>Client</th><th class="num">Used</th><th class="num">Cap</th>
        <th class="num">Remaining</th><th>Usage</th><th class="num">Projected</th><th>Status</th>
      </tr></thead><tbody>${rows}</tbody></table>
    `;
    $$(".clickable-row[data-budget-cid]").forEach((row) => {
      row.onclick = () => loadBudgetDetail(row.dataset.budgetCid);
    });
  } catch (e) {
    tableOut.innerHTML = `<p class="err">${escapeHtml(e.message)}</p>`;
  }
}
async function loadBudgetDetail(clientId) {
  const detailOut = $("#budget-detail-out");
  const tableOut = $("#budget-table-out");
  if (!detailOut) return;
  try {
    const data = await api(`/budget/weekly/${clientId}`);
    const c = data.client;
    const pctUsed = data.pct_used || 0;
    const barColor = pctUsed > 100 ? "var(--danger)" : pctUsed >= 80 ? "var(--warn)" : "var(--ok)";
    let weightsHtml = "";
    if (data.weights && data.weights.length > 0) {
      try {
        const wData = await api(`/clients/${clientId}/weights`);
        if (wData.weights && wData.weights.length > 0) {
          weightsHtml = `
            <div class="budget-detail-card">
              <h3>Team Member Weights</h3>
              <p class="muted small">Weighted allotment: team members' logged hours are divided by their weight to calculate allotment hours.</p>
              <table class="grid"><thead><tr>
                <th>Member</th><th>Weight</th><th>Meaning</th>
              </tr></thead><tbody>
              ${wData.weights.map((w) => `<tr>
                <td>${escapeHtml(w.display_name || w.email)}</td>
                <td>${w.weight_display}</td>
                <td>${w.logged_hours_per_allotment_hour === 1 ? "1 logged hour = 1 allotment hour" : `${w.logged_hours_per_allotment_hour} logged hours = 1 allotment hour`}</td>
              </tr>`).join("")}
              </tbody></table>
            </div>
          `;
        }
      } catch (_) {
      }
    }
    detailOut.innerHTML = `
      <div style="margin-bottom:12px">
        <button class="link" id="budget-back-btn">Back to budget overview</button>
      </div>

      <div class="budget-detail-card">
        <h3>${cdotName(c.name)}${escapeHtml(c.name)} · Week of ${data.week_start}</h3>
        <div class="dashboard-grid">
          <div class="dash-card">
            <div class="dash-value">${data.effective_hours}h</div>
            <div class="dash-label">${data.weighted_hours !== null ? "Weighted Hours" : "Hours Used"}</div>
          </div>
          ${data.weighted_hours !== null ? `
            <div class="dash-card">
              <div class="dash-value">${data.raw_hours}h</div>
              <div class="dash-label">Raw Hours</div>
            </div>` : ""}
          <div class="dash-card">
            <div class="dash-value">${c.hours_cap || "-"}h</div>
            <div class="dash-label">Weekly Cap</div>
          </div>
          <div class="dash-card">
            <div class="dash-value">${data.remaining !== null ? data.remaining + "h" : "-"}</div>
            <div class="dash-label">Remaining</div>
          </div>
          <div class="dash-card">
            <div class="dash-value">${data.projected_hours}h</div>
            <div class="dash-label">Projected (5-day)</div>
          </div>
        </div>

        ${c.hours_cap ? `
          <div style="margin-top:12px">
            <div class="budget-bar-track">
              <div class="budget-bar-fill" style="width:${Math.min(pctUsed, 100)}%;background:${barColor}"></div>
            </div>
            <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--muted);margin-top:4px">
              <span>${data.effective_hours}h used</span>
              <span style="font-weight:700;color:${barColor}">${pctUsed}%</span>
              <span>${c.hours_cap}h cap</span>
            </div>
          </div>` : ""}
      </div>

      ${data.daily && data.daily.length > 0 ? `
        <div class="budget-detail-card">
          <h3>Hours by Day</h3>
          <table class="grid"><thead><tr>
            <th>Date</th><th class="num">Hours</th>
          </tr></thead><tbody>
          ${data.daily.map((d) => `<tr>
            <td>${d.date}</td>
            <td class="num">${d.hours}h</td>
          </tr>`).join("")}
          </tbody></table>
        </div>` : '<p class="muted small">No entries this week.</p>'}

      ${data.employees && data.employees.length > 0 ? `
        <div class="budget-detail-card">
          <h3>Hours by Team Member</h3>
          <table class="grid"><thead><tr>
            <th>Member</th><th>Email</th><th class="num">Hours</th>
          </tr></thead><tbody>
          ${data.employees.map((e) => `<tr>
            <td>${escapeHtml(e.display_name || "-")}</td>
            <td>${escapeHtml(e.email)}</td>
            <td class="num">${e.hours}h</td>
          </tr>`).join("")}
          </tbody></table>
        </div>` : ""}

      ${weightsHtml}
    `;
    detailOut.classList.remove("hidden");
    if (tableOut) tableOut.classList.add("hidden");
    if ($("#budget-summary-cards")) $("#budget-summary-cards").classList.add("hidden");
    const backBtn = $("#budget-back-btn");
    if (backBtn) {
      backBtn.onclick = () => {
        detailOut.classList.add("hidden");
        if (tableOut) tableOut.classList.remove("hidden");
        if ($("#budget-summary-cards")) $("#budget-summary-cards").classList.remove("hidden");
      };
    }
  } catch (e) {
    detailOut.innerHTML = `<p class="err">${escapeHtml(e.message)}</p>`;
    detailOut.classList.remove("hidden");
  }
}
async function loadClientDashboard() {
  const dashOut = $("#client-dashboard-out");
  const barContainer = $("#client-hours-bar-container");
  const recentOut = $("#client-recent-activity");
  const invoicesOut = $("#client-invoices-preview");
  if (!dashOut) return;
  try {
    const { dashboard } = await api("/client/dashboard");
    const d = dashboard;
    dashOut.innerHTML = `
      <div class="dash-card">
        <div class="dash-value">${d.this_week_hours}h</div>
        <div class="dash-label">This Week</div>
      </div>
      <div class="dash-card">
        <div class="dash-value">${d.this_month_hours}h</div>
        <div class="dash-label">This Month</div>
      </div>
      <div class="dash-card">
        <div class="dash-value">${d.total_hours}h</div>
        <div class="dash-label">Total Hours</div>
      </div>
    `;
    if (barContainer && d.cap) {
      const weeklyPctVal = Number(d.cap.hours_used_pct);
      const weeklyPct = Math.min(weeklyPctVal, 120);
      const weeklyBarColor = weeklyPctVal > 100 ? "var(--danger)" : weeklyPctVal >= 80 ? "var(--warn)" : "var(--ok)";
      const weeklyRemaining = Number(d.cap.hours_remaining);
      const weeklyStatusText = d.cap.over_cap ? `OVER CAP by ${Math.abs(weeklyRemaining).toFixed(1)}h` : `${weeklyRemaining.toFixed(1)}h remaining`;
      barContainer.innerHTML = `
        <div class="card hours-cap-card">
          <h3>Weekly Hours Budget</h3>
          <div class="hours-bar-track">
            <div class="hours-bar-fill" style="width:${Math.min(weeklyPct, 100)}%;background:${weeklyBarColor}"></div>
          </div>
          <div class="hours-bar-labels">
            <span>${d.this_week_hours}h used</span>
            <span>${d.cap.hours_cap}h cap</span>
          </div>
          <p class="hours-bar-status" style="color:${weeklyBarColor}">${weeklyStatusText} (${weeklyPctVal}% used)</p>
        </div>
      `;
    } else if (barContainer) {
      barContainer.innerHTML = "";
    }
    const trendOut = $("#client-weekly-trend");
    if (trendOut) {
      try {
        const histData = await api("/client/budget-history");
        const weeks = histData.weeks || [];
        if (weeks.length > 0) {
          const maxHours = Math.max(...weeks.map((w) => w.hours), histData.hours_cap || 0, 1);
          trendOut.innerHTML = `
            <div class="card">
              <h3>Weekly Trend (Last 4 Weeks)</h3>
              <table class="weekly-trend-table"><thead><tr>
                <th>Week Starting</th><th class="num">Hours</th><th class="trend-bar-cell"></th>
              </tr></thead><tbody>
              ${weeks.map((w) => {
            const pct = w.hours / maxHours * 100;
            const barColor = histData.hours_cap && w.hours > histData.hours_cap ? "var(--danger)" : "var(--accent)";
            return `<tr>
                  <td>${w.week_start}</td>
                  <td class="num">${w.hours}h</td>
                  <td class="trend-bar-cell">
                    <div class="trend-bar-track">
                      <div class="trend-bar-fill" style="width:${pct}%;background:${barColor}"></div>
                    </div>
                  </td>
                </tr>`;
          }).join("")}
              </tbody></table>
              ${histData.hours_cap ? `<p class="muted small" style="margin-top:6px">Weekly cap: ${histData.hours_cap}h</p>` : ""}
            </div>
          `;
        } else {
          trendOut.innerHTML = "";
        }
      } catch (_) {
        trendOut.innerHTML = "";
      }
    }
    const goalsOut = $("#client-goals-updates");
    if (goalsOut) {
      try {
        const goalsData = await api("/client/updates?limit=20");
        const updates = goalsData.updates || [];
        if (updates.length > 0) {
          const weekLabel = updates[0].week_label || updates[0].week_start;
          const goalsHtml = updates.filter((u) => u.goals).map((u) => `<li>${escapeHtml(u.goals).replace(/\n/g, "<br>")}</li>`).join("");
          const achievementsHtml = updates.filter((u) => u.achievements).map((u) => `<li>${escapeHtml(u.achievements).replace(/\n/g, "<br>")}</li>`).join("");
          goalsOut.innerHTML = `
            <div class="card">
              <h3>Weekly Update · ${escapeHtml(weekLabel)}</h3>
              ${goalsData.north_star ? `<p class="muted small" style="margin-bottom:12px"><strong>North Star:</strong> ${escapeHtml(goalsData.north_star)}</p>` : ""}
              ${goalsHtml ? `<h4 style="margin:8px 0 4px">Goals</h4><ul class="goals-list">${goalsHtml}</ul>` : ""}
              ${achievementsHtml ? `<h4 style="margin:12px 0 4px">Achievements</h4><ul class="goals-list">${achievementsHtml}</ul>` : ""}
            </div>
          `;
        } else {
          goalsOut.innerHTML = "";
        }
      } catch (_) {
        goalsOut.innerHTML = "";
      }
    }
    if (recentOut && d.recent_activity && d.recent_activity.length > 0) {
      recentOut.innerHTML = `
        <div class="card">
          <h3>Recent Activity</h3>
          <table class="grid"><thead><tr>
            <th>Date</th><th>Task</th><th>Hours</th><th>Description</th>
          </tr></thead><tbody>
          ${d.recent_activity.map((a) => `<tr>
            <td>${a.entry_date}</td>
            <td>${escapeHtml(a.project_task)}</td>
            <td>${a.hours}</td>
            <td>${escapeHtml(a.description)}</td>
          </tr>`).join("")}
          </tbody></table>
        </div>
      `;
    } else if (recentOut) {
      recentOut.innerHTML = '<p class="muted small">No recent activity.</p>';
    }
    if (invoicesOut && d.invoices && d.invoices.length > 0) {
      invoicesOut.innerHTML = `
        <div class="card">
          <h3>Recent Invoices</h3>
          <table class="grid"><thead><tr>
            <th>Invoice #</th><th>Period</th><th>Hours</th><th>Total</th><th>Status</th>
          </tr></thead><tbody>
          ${d.invoices.map((inv) => `<tr>
            <td>${escapeHtml(inv.invoice_number)}</td>
            <td>${inv.period_start} to ${inv.period_end}</td>
            <td>${inv.total_hours}</td>
            <td>${money(inv.total_cents, inv.currency)}</td>
            <td><span class="status-badge inv-${inv.status}">${inv.status.replace("_", " ")}</span></td>
          </tr>`).join("")}
          </tbody></table>
        </div>
      `;
    } else if (invoicesOut) {
      invoicesOut.innerHTML = '<p class="muted small">No invoices yet.</p>';
    }
  } catch (e) {
    dashOut.innerHTML = `<p class="err">${escapeHtml(e.message)}</p>`;
  }
}
let clientActOffset = 0;
const CLIENT_ACT_LIMIT = 25;
async function loadClientActivity(offset) {
  if (offset !== void 0) clientActOffset = offset;
  const out = $("#client-activity-out");
  if (!out) return;
  try {
    const q = new URLSearchParams();
    q.set("limit", String(CLIENT_ACT_LIMIT));
    q.set("offset", String(clientActOffset));
    const from = $("#client-act-from")?.value;
    const to = $("#client-act-to")?.value;
    if (from) q.set("from", from);
    if (to) q.set("to", to);
    const { entries, limit } = await api(`/client/activity?${q}`);
    if (!entries || entries.length === 0) {
      out.innerHTML = '<p class="muted small">No activity found.</p>';
      const pg2 = $("#client-activity-pagination");
      if (pg2) pg2.innerHTML = "";
      return;
    }
    out.innerHTML = `
      <table class="grid"><thead><tr>
        <th>Date</th><th>Task</th><th>Hours</th><th>Description</th>
      </tr></thead><tbody>
      ${entries.map((e) => `<tr>
        <td>${e.entry_date}</td>
        <td>${escapeHtml(e.project_task)}</td>
        <td>${e.hours}</td>
        <td>${escapeHtml(e.description)}</td>
      </tr>`).join("")}
      </tbody></table>
    `;
    const pg = $("#client-activity-pagination");
    if (pg) {
      const hasPrev = clientActOffset > 0;
      const hasNext = entries.length >= CLIENT_ACT_LIMIT;
      pg.innerHTML = `
        ${hasPrev ? '<button class="link" id="client-act-prev">Previous</button>' : ""}
        <span class="muted small">Showing ${clientActOffset + 1}-${clientActOffset + entries.length}</span>
        ${hasNext ? '<button class="link" id="client-act-next">Next</button>' : ""}
      `;
      const prev = $("#client-act-prev");
      const next = $("#client-act-next");
      if (prev) prev.onclick = () => loadClientActivity(Math.max(0, clientActOffset - CLIENT_ACT_LIMIT));
      if (next) next.onclick = () => loadClientActivity(clientActOffset + CLIENT_ACT_LIMIT);
    }
  } catch (e) {
    out.innerHTML = `<p class="err">${escapeHtml(e.message)}</p>`;
  }
}
let clientInvOffset = 0;
const CLIENT_INV_LIMIT = 25;
async function loadClientInvoices(offset) {
  if (offset !== void 0) clientInvOffset = offset;
  const out = $("#client-invoices-out");
  if (!out) return;
  try {
    const q = new URLSearchParams();
    q.set("limit", String(CLIENT_INV_LIMIT));
    q.set("offset", String(clientInvOffset));
    q.set("sort", "created_at");
    q.set("order", "desc");
    const { invoices } = await api(`/invoices?${q}`);
    if (!invoices || invoices.length === 0) {
      out.innerHTML = '<p class="muted small">No invoices found.</p>';
      const pg2 = $("#client-invoices-pagination");
      if (pg2) pg2.innerHTML = "";
      return;
    }
    out.innerHTML = `
      <table class="grid"><thead><tr>
        <th>Invoice #</th><th>Period</th><th>Hours</th><th>Total</th><th>Status</th><th>Due</th><th></th>
      </tr></thead><tbody>
      ${invoices.map((inv) => `<tr>
        <td>${escapeHtml(inv.invoice_number)}</td>
        <td>${inv.period_start} to ${inv.period_end}</td>
        <td>${inv.total_hours || "-"}</td>
        <td>${money(inv.total_cents, inv.currency)}</td>
        <td><span class="status-badge inv-${inv.status}">${inv.status.replace("_", " ")}</span></td>
        <td>${inv.due_date || "-"}</td>
        <td>
          <button class="link" data-clinvact="view" data-ciid="${inv.id}">view</button>
          <button class="link" data-clinvact="print" data-ciid="${inv.id}">print</button>
        </td>
      </tr>`).join("")}
      </tbody></table>
    `;
    $$("#client-invoices-out button[data-clinvact]").forEach((b) => {
      b.onclick = async () => {
        const iid = b.dataset.ciid;
        if (b.dataset.clinvact === "view") {
          await showClientInvoiceDetail(iid);
        } else if (b.dataset.clinvact === "print") {
          window.open(`${API}/api/invoices/${iid}/html`, "_blank");
        }
      };
    });
    const pg = $("#client-invoices-pagination");
    if (pg) {
      const hasPrev = clientInvOffset > 0;
      const hasNext = invoices.length >= CLIENT_INV_LIMIT;
      pg.innerHTML = `
        ${hasPrev ? '<button class="link" id="client-inv-prev">Previous</button>' : ""}
        <span class="muted small">Showing ${clientInvOffset + 1}-${clientInvOffset + invoices.length}</span>
        ${hasNext ? '<button class="link" id="client-inv-next">Next</button>' : ""}
      `;
      const prev = $("#client-inv-prev");
      const next = $("#client-inv-next");
      if (prev) prev.onclick = () => loadClientInvoices(Math.max(0, clientInvOffset - CLIENT_INV_LIMIT));
      if (next) next.onclick = () => loadClientInvoices(clientInvOffset + CLIENT_INV_LIMIT);
    }
  } catch (e) {
    out.innerHTML = `<p class="err">${escapeHtml(e.message)}</p>`;
  }
}
async function showClientInvoiceDetail(invoiceId) {
  const out = $("#client-invoices-out");
  if (!out) return;
  try {
    const { invoice } = await api(`/invoices/${invoiceId}`);
    const inv = invoice;
    const lineRows = inv.line_items.map((l) => `
      <tr>
        <td>${escapeHtml(l.description)}</td>
        <td>${l.hours}</td>
        <td>${money(l.amount_cents, inv.currency)}</td>
      </tr>`).join("");
    const paymentRows = (inv.payments || []).map((pm) => `
      <tr>
        <td>${(pm.paid_at || "").slice(0, 10)}</td>
        <td>${escapeHtml(pm.payment_method || "-")}</td>
        <td>${pm.amount}</td>
      </tr>`).join("");
    const balanceDue = inv.total_cents - (inv.paid_amount_cents || 0);
    out.innerHTML = `
      <div style="margin-bottom:12px">
        <button class="link" id="client-inv-back-btn">Back to list</button>
      </div>
      <div class="card">
        <h3>${escapeHtml(inv.invoice_number)}</h3>
        <p>Period: ${inv.period_start} to ${inv.period_end}</p>
        <p>Status: <span class="status-badge inv-${inv.status}">${inv.status.replace("_", " ")}</span>
          ${inv.due_date ? ` · Due: ${inv.due_date}` : ""}</p>
        <p>Total: <strong>${money(inv.total_cents, inv.currency)}</strong> (${inv.total_hours} h)
          ${(inv.paid_amount_cents || 0) > 0 ? ` · Paid: ${money(inv.paid_amount_cents, inv.currency)} · Balance: ${money(balanceDue, inv.currency)}` : ""}</p>
        ${inv.notes ? `<p class="muted small">Notes: ${escapeHtml(inv.notes)}</p>` : ""}
      </div>

      <table class="grid"><thead><tr>
        <th>Description</th><th>Hours</th><th>Amount</th>
      </tr></thead><tbody>${lineRows}</tbody></table>

      ${paymentRows ? `
        <h4 style="margin-top:16px">Payment History</h4>
        <table class="grid"><thead><tr>
          <th>Date</th><th>Method</th><th>Amount</th>
        </tr></thead><tbody>${paymentRows}</tbody></table>` : ""}

      <div style="margin-top:16px">
        <button class="link" data-invoice-url="${API}/api/invoices/${inv.id}/html">View Printable Invoice</button>
      </div>
    `;
    const backBtn = $("#client-inv-back-btn");
    if (backBtn) backBtn.onclick = () => loadClientInvoices();
  } catch (e) {
    out.innerHTML = `<p class="err">${escapeHtml(e.message)}</p>`;
  }
}
async function handleReportExportCsv() {
  const { from, to, clientId, employeeId } = _rptGetFilters();
  const staff = _rptIsStaffMode();
  const q = new URLSearchParams();
  if (from) q.set("from", from);
  if (to) q.set("to", to);
  if (clientId) q.set("client_id", clientId);
  if (!staff && employeeId) q.set("employee_id", employeeId);
  const t = token();
  try {
    const res = await fetch(`${API}/api/reports/export?${q}`, {
      headers: { Authorization: `Bearer ${t}` }
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || `Export failed: HTTP ${res.status}`);
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const isMgr = _rptIsStaffMode() && tsIsManager() === true;
    a.download = _rptIsStaffMode() ? isMgr ? `client-hours-${from || todayISO()}.csv` : `my-timesheet-${from || todayISO()}.csv` : `time-entries-${todayISO()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    alert("CSV export failed: " + e.message);
  }
}
function tsIsManager() {
  if (!ME) return null;
  if (typeof ME.manager === "boolean") return ME.manager;
  if (Array.isArray(ME.roles)) return ME.roles.includes("manager");
  if (typeof ME.effectiveRole === "string") return ME.effectiveRole === "manager";
  return null;
}
async function _rptDownloadReportPdf() {
  const { from, to, clientId, employeeId } = _rptGetFilters();
  const q = new URLSearchParams();
  if (from) q.set("from", from);
  if (to) q.set("to", to);
  if (clientId) q.set("client_id", clientId);
  if (!_rptIsStaffMode() && employeeId) q.set("employee_id", employeeId);
  q.set("format", "pdf");
  const t = token();
  try {
    const res = await fetch(`${API}/api/reports/staff?${q}`, {
      headers: { Authorization: `Bearer ${t}` }
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || `PDF export failed: HTTP ${res.status}`);
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const isMgr = tsIsManager() === true;
    a.download = _rptIsStaffMode() ? isMgr ? `client-hours-${from || todayISO()}.pdf` : `my-timesheet-${from || todayISO()}.pdf` : `client-report-${from || todayISO()}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    alert("PDF export failed: " + e.message);
  }
}
async function handleReportExportPdf() {
  return _rptDownloadReportPdf();
}
async function handleInvoiceCsvExport(invoiceId) {
  const t = token();
  try {
    const res = await fetch(`${API}/api/invoices/${invoiceId}/export`, {
      headers: { Authorization: `Bearer ${t}` }
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || `Export failed: HTTP ${res.status}`);
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `invoice-${invoiceId.slice(0, 8)}-${todayISO()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    alert("CSV export failed: " + e.message);
  }
}
async function handlePaypalInvoice(invoiceId) {
  try {
    const data = await api(`/invoices/${invoiceId}/paypal`, { method: "POST" });
    if (data.paypal_invoice_id) {
      alert(`PayPal invoice created: ${data.paypal_invoice_id}

PayPal Link: ${data.paypal_link || "(check PayPal dashboard)"}`);
    } else if (data.stubbed) {
      const payloadStr = JSON.stringify(data.payload, null, 2);
      const win = window.open("", "_blank");
      if (win) {
        win.document.write(`<pre style="font-size:13px;padding:20px">${escapeHtml(payloadStr)}</pre>`);
        win.document.title = "PayPal Invoice Payload (Manual Use)";
      } else {
        alert("PayPal not configured. Invoice payload logged to console.");
        console.log("PayPal Invoice Payload:", data.payload);
      }
    }
  } catch (e) {
    alert("PayPal invoice error: " + e.message);
  }
}
let CLIENTS_TAB_DATA = [];
async function loadClientsTab() {
  const out = $("#clients-list-out");
  if (!out) return;
  out.innerHTML = '<p class="muted small">Loading clients...</p>';
  try {
    const { clients } = await api("/clients?limit=200&include_archived=1");
    CLIENTS_TAB_DATA = clients;
    renderClientsTable();
  } catch (e) {
    out.innerHTML = `<p class="err">${escapeHtml(e.message)}</p>`;
  }
}
function clientAmountCell(c) {
  const m = c.billing_model || "hourly";
  const cur = c.currency || "USD";
  const amount = (cents, unit, missingTitle) => cents == null ? { text: "no amount", title: missingTitle } : { text: money(cents, cur) + unit, title: "" };
  if (m === "hourly") {
    return c.rate_cents == null ? { text: "-", title: "No hourly rate has been entered." } : { text: money(c.rate_cents, cur) + "/hr", title: "" };
  }
  if (m === "milestone_weekly") {
    return amount(c.weekly_rate_cents, "/wk", "No weekly amount has been entered, so this client earns nothing.");
  }
  if (m === "monthly_retainer") {
    return amount(c.monthly_retainer_cents, "/mo", "No monthly retainer has been entered, so this client earns nothing.");
  }
  if (m === "fixed_project") {
    return amount(c.fixed_amount_cents, " total", "No project amount has been entered, so this client earns nothing.");
  }
  if (m === "profit_share") {
    return c.profit_pct == null ? { text: "no commission", title: "No commission has been entered for this client." } : { text: String(c.profit_pct) + "%", title: "" };
  }
  return { text: "-", title: "" };
}
function renderClientsTable() {
  const out = $("#clients-list-out");
  if (!out) return;
  const filterStatus = $("#clients-filter-status")?.value || "active";
  const search = ($("#clients-search")?.value || "").toLowerCase().trim();
  let filtered = CLIENTS_TAB_DATA;
  if (filterStatus === "active") filtered = filtered.filter((c) => !c.archived);
  else if (filterStatus === "archived") filtered = filtered.filter((c) => c.archived);
  if (search) filtered = filtered.filter((c) => (c.name || "").toLowerCase().includes(search));
  if (filtered.length === 0) {
    out.innerHTML = '<p class="muted small">No clients found.</p>';
    return;
  }
  out.innerHTML = `
    <table class="grid clients-table"><thead><tr>
      <th>NAME</th><th>BILLING</th><th>RATE</th><th>WEEKLY CAP</th><th>CURRENCY</th><th>STATUS</th><th></th>
    </tr></thead><tbody>
    ${filtered.map((c) => {
    const amountCell = clientAmountCell(c);
    const rate = amountCell.text;
    const cap = (c.billing_model || "hourly") === "hourly" && c.hours_cap != null ? c.hours_cap + "h" : "-";
    const model = billingModelName(c.billing_model || "hourly");
    const status = (c.archived ? "Archived" : c.paused ? "Paused" : "Active") + (c.archived ? "" : pausedWhoWhen(c));
    const statusClass = c.archived ? "client-status-archived" : c.paused ? "client-status-paused" : "client-status-active";
    return `<tr data-cid="${c.id}">
        <td class="client-name-cell" style="${leftBarStyle(c.color)}">${cdot(c.color)}${escapeHtml(c.name)}</td>
        <td class="muted">${escapeHtml(model)}</td>
        <td title="${escapeHtml(amountCell.title)}">${escapeHtml(rate)}</td>
        <td>${cap}</td>
        <td>${escapeHtml(c.currency || "USD")}</td>
        <td><span class="${statusClass}">${status}</span></td>
        <td class="client-actions-cell">
          <button class="link client-edit-btn" data-cid="${c.id}" title="Edit">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          ${c.archived ? `<button class="link client-unarchive-btn" data-cid="${c.id}" title="Restore">restore</button>` : `<button class="link danger client-archive-btn" data-cid="${c.id}" title="Delete (can be restored)">delete</button>`}
        </td>
      </tr>`;
  }).join("")}
    </tbody></table>
  `;
  bindClientActions();
}
function bindClientActions() {
  $$(".client-edit-btn").forEach((btn) => {
    btn.onclick = () => openClientEditModal(btn.dataset.cid);
  });
  $$(".client-archive-btn").forEach((btn) => {
    btn.onclick = async () => {
      if (!confirm("Delete this client? They will be hidden everywhere (lists, timer, reports). Past time entries and invoices are kept, and an admin can restore them later (Clients > Show archived).")) return;
      try {
        await api(`/clients/${btn.dataset.cid}`, { method: "PATCH", body: { archived: true } });
        loadClientsTab();
        const { clients } = await api("/clients");
        CLIENTS = clients;
        fillClientSelects();
      } catch (e) {
        alert(e.message);
      }
    };
  });
  $$(".client-unarchive-btn").forEach((btn) => {
    btn.onclick = async () => {
      try {
        await api(`/clients/${btn.dataset.cid}`, { method: "PATCH", body: { archived: false } });
        loadClientsTab();
        const { clients } = await api("/clients");
        CLIENTS = clients;
        fillClientSelects();
      } catch (e) {
        alert(e.message);
      }
    };
  });
}
const CLIENT_MODELS = ["hourly", "milestone_weekly", "monthly_retainer", "fixed_project", "profit_share"];
function clientModelValue() {
  const el = document.querySelector('#client-edit-modelpick input[name="billing_model"]:checked');
  return el && el.value ? el.value : "hourly";
}
function setClientModel(model) {
  const m = CLIENT_MODELS.includes(model) ? model : "hourly";
  const pick = document.querySelector("#client-edit-modelpick");
  if (pick) {
    for (const input of pick.querySelectorAll('input[name="billing_model"]')) {
      input.checked = input.value === m;
    }
  }
  syncClientModelFields();
}
function syncClientModelFields() {
  const m = clientModelValue();
  const hourly = document.querySelector("#client-edit-hourly");
  const weekly = document.querySelector("#client-edit-weekly");
  const retainer = document.querySelector("#client-edit-retainer");
  const fixed = document.querySelector("#client-edit-fixed");
  const profit = document.querySelector("#client-edit-profit");
  if (hourly) hourly.classList.toggle("hidden", m !== "hourly");
  if (weekly) weekly.classList.toggle("hidden", m !== "milestone_weekly");
  if (retainer) retainer.classList.toggle("hidden", m !== "monthly_retainer");
  if (fixed) fixed.classList.toggle("hidden", m !== "fixed_project");
  if (profit) profit.classList.toggle("hidden", m !== "profit_share");
}
function dollarsToCents(raw) {
  const s = String(raw == null ? "" : raw).replace(/[$,\s]/g, "");
  if (s === "") return 0;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : 0;
}
function dollarsFieldToCents(raw) {
  const s = String(raw == null ? "" : raw).replace(/[$,\s]/g, "");
  if (s === "") return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return NaN;
  return Math.round(n * 100);
}
let CLIENT_FIXED_MODE = "window";
let CLIENT_FIXED_MILESTONES = [];
let CLIENT_FIXED_CLIENT_ID = null;
let CLIENT_FIXED_DRAFT = null;
const MILESTONE_STATE_LABEL = { pending: "Pending", released: "Released", late: "Landed late" };
function clientMilestoneTotalCents() {
  return CLIENT_FIXED_MILESTONES.reduce((s, m) => s + Number(m.amount_cents || 0), 0);
}
function applyClientFixedMode() {
  const note = document.querySelector("#client-edit-fixed-note");
  const modeNote = document.querySelector("#client-edit-milestone-mode");
  const amount = document.querySelector('#client-edit-form [name="fixed_amount_dollars"]');
  const isMilestones = CLIENT_FIXED_MODE === "milestones";
  if (note) {
    note.textContent = isMilestones ? "The project's money is the sum of its milestones below. The window is a label." : "This project has no milestones yet: its amount is spread over the project's dates. Add a milestone and the milestones become the project's money.";
  }
  if (modeNote) {
    modeNote.textContent = isMilestones ? `${CLIENT_FIXED_MILESTONES.length} milestone(s). Each one counts once, in the week of its release date.` : "No milestones yet — this project is on the window rule.";
  }
  if (amount) {
    amount.disabled = isMilestones;
    amount.readOnly = isMilestones;
    amount.title = isMilestones ? "The amount of a project with milestones is the sum of the milestones — change a milestone to change it." : "";
    if (isMilestones) amount.value = (clientMilestoneTotalCents() / 100).toFixed(2);
  }
}
function renderClientMilestones() {
  const tbody = document.querySelector("#client-edit-milestone-rows");
  const total = document.querySelector("#client-edit-milestone-total");
  if (!tbody) return;
  const row = (m, isDraft) => {
    const id = isDraft ? "" : ` data-mid="${escapeHtml(m.id)}"`;
    const released = Number(m.released) ? " checked" : "";
    const landed = isDraft ? "" : m.landed_date ? escapeHtml(m.landed_date) : "";
    const state = isDraft ? "Not saved yet" : escapeHtml(MILESTONE_STATE_LABEL[m.state] || m.state || "");
    return `<tr${id}>
      <td data-l="Milestone"><input class="in" data-f="label" value="${escapeHtml(m.label || "")}" placeholder="e.g. Design sign-off" /></td>
      <td data-l="Amount"><span class="in-pre"><em>$</em><input class="in" type="number" data-f="amount" min="0" step="0.01" value="${isDraft ? "" : (Number(m.amount_cents || 0) / 100).toFixed(2)}" /></span></td>
      <td data-l="Release date"><input class="in" type="date" data-f="release" value="${escapeHtml(m.release_date || "")}" /></td>
      <td data-l="Funds">
        <label class="ms-check"><input type="checkbox" data-f="released"${released} /> released</label>
      </td>
      <td data-l="State"><span class="muted small">${state}</span></td>
      <td data-l="Landed"><input class="in" type="date" data-f="landed" value="${landed}" ${Number(m.released) ? "" : "disabled"} /></td>
      <td class="ms-actions">
        <button type="button" data-act="save">Save</button>
        ${isDraft ? '<button type="button" data-act="cancel">Cancel</button>' : '<button type="button" data-act="del">Delete</button>'}
      </td>
    </tr>`;
  };
  const saved = CLIENT_FIXED_MILESTONES.map((m) => row(m, false)).join("");
  const draft = CLIENT_FIXED_DRAFT ? row({ label: "", amount_cents: 0, release_date: "", released: 0, landed_date: null }, true) : "";
  tbody.innerHTML = saved + draft || '<tr><td colspan="7" class="muted">No milestones yet.</td></tr>';
  if (total) {
    const sum = clientMilestoneTotalCents();
    total.textContent = CLIENT_FIXED_MILESTONES.length ? `The project's money: ${money(sum)} (${CLIENT_FIXED_MILESTONES.length} milestone${CLIENT_FIXED_MILESTONES.length === 1 ? "" : "s"}).` : "";
  }
}
async function loadClientMilestones(clientId) {
  CLIENT_FIXED_CLIENT_ID = clientId;
  const errEl = document.querySelector("#client-edit-milestone-err");
  if (errEl) errEl.textContent = "";
  try {
    const r = await api(`/clients/${encodeURIComponent(clientId)}/milestones`);
    CLIENT_FIXED_MODE = r.mode || "window";
    CLIENT_FIXED_MILESTONES = r.milestones || [];
  } catch (e) {
    CLIENT_FIXED_MODE = "window";
    CLIENT_FIXED_MILESTONES = [];
    if (errEl) errEl.textContent = "The milestones could not be read: " + e.message;
  }
  renderClientMilestones();
  applyClientFixedMode();
}
async function saveClientMilestoneRow(tr, isDraft) {
  const errEl = document.querySelector("#client-edit-milestone-err");
  if (errEl) errEl.textContent = "";
  const q = (f) => tr.querySelector(`[data-f="${f}"]`);
  const label = String(q("label").value || "").trim();
  const rawAmount = String(q("amount").value || "").replace(/[$,\s]/g, "");
  const dollars = Number(rawAmount);
  if (rawAmount === "" || !Number.isFinite(dollars) || dollars < 0) {
    if (errEl) errEl.textContent = "The milestone amount must be a number, 0 or more.";
    return;
  }
  const release = String(q("release").value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(release)) {
    if (errEl) errEl.textContent = "The milestone needs a release date.";
    return;
  }
  const released = q("released").checked ? 1 : 0;
  const landed = released ? String(q("landed").value || "") || null : null;
  const body = {
    label,
    amount_cents: Math.round(dollars * 100),
    release_date: release,
    released,
    landed_date: landed
  };
  try {
    if (isDraft) {
      await api(`/clients/${encodeURIComponent(CLIENT_FIXED_CLIENT_ID)}/milestones`, { method: "POST", body });
      CLIENT_FIXED_DRAFT = null;
    } else {
      const mid = tr.getAttribute("data-mid");
      await api(`/clients/${encodeURIComponent(CLIENT_FIXED_CLIENT_ID)}/milestones/${encodeURIComponent(mid)}`, { method: "PATCH", body });
    }
    await loadClientMilestones(CLIENT_FIXED_CLIENT_ID);
  } catch (e) {
    if (errEl) errEl.textContent = e.message;
  }
}
async function deleteClientMilestoneRow(tr) {
  const errEl = document.querySelector("#client-edit-milestone-err");
  if (errEl) errEl.textContent = "";
  const mid = tr.getAttribute("data-mid");
  if (!mid) return;
  if (!confirm("Delete this milestone? The project's money changes.")) return;
  try {
    await api(`/clients/${encodeURIComponent(CLIENT_FIXED_CLIENT_ID)}/milestones/${encodeURIComponent(mid)}`, { method: "DELETE" });
    await loadClientMilestones(CLIENT_FIXED_CLIENT_ID);
  } catch (e) {
    if (errEl) errEl.textContent = e.message;
  }
}
function openClientEditModal(clientId) {
  const c = CLIENTS_TAB_DATA.find((x) => x.id === clientId);
  if (!c) return;
  const modal = $("#client-edit-modal");
  const form = $("#client-edit-form");
  if (!modal || !form) return;
  CLIENT_FIXED_MODE = "window";
  CLIENT_FIXED_MILESTONES = [];
  CLIENT_FIXED_DRAFT = null;
  CLIENT_FIXED_CLIENT_ID = c.id;
  $("#client-edit-title").textContent = `Edit: ${c.name}`;
  form.querySelector('[name="client_id"]').value = c.id;
  form.querySelector('[name="name"]').value = c.name || "";
  const rateEl = form.querySelector('[name="rate_dollars"]');
  if (rateEl) rateEl.value = c.rate_cents ? (Number(c.rate_cents) / 100).toFixed(2) : "";
  const weeklyEl = form.querySelector('[name="weekly_amount_dollars"]');
  if (weeklyEl) weeklyEl.value = c.weekly_rate_cents == null ? "" : (Number(c.weekly_rate_cents) / 100).toFixed(2);
  const retainerEl = form.querySelector('[name="monthly_amount_dollars"]');
  if (retainerEl) retainerEl.value = c.monthly_retainer_cents == null ? "" : (Number(c.monthly_retainer_cents) / 100).toFixed(2);
  form.querySelector('[name="hours_cap"]').value = c.hours_cap || "";
  form.querySelector('[name="contact_name"]').value = c.contact_name || "";
  form.querySelector('[name="contact_email"]').value = c.contact_email || "";
  form.querySelector('[name="currency"]').value = c.currency || "USD";
  const statusSel = form.querySelector('[name="status"]');
  if (statusSel) statusSel.value = c.paused ? "paused" : "active";
  const statusNote = $("#client-edit-status-note");
  if (statusNote) statusNote.textContent = c.paused && (c.paused_by_name || c.paused_at) ? `Currently paused${pausedWhoWhen(c)}.` : "";
  renderColorBoard($("#client-edit-color-board"), c.color || pickUnusedClientColor());
  renderProjectRows($("#client-edit-new-projects"), 1);
  const ex = $("#client-edit-existing-projects");
  ex.innerHTML = '<li class="muted small">Loading projects...</li>';
  api(`/projects?client_id=${encodeURIComponent(c.id)}&include_archived=1`).then((r) => {
    const list = r.projects || [];
    ex.innerHTML = list.length ? list.map((p) => `<li>${cdot(c.color)}${escapeHtml(p.name)}${p.archived ? ' <span class="muted">(archived)</span>' : ""}</li>`).join("") : '<li class="muted small">No projects yet.</li>';
  }).catch(() => {
    ex.innerHTML = "";
  });
  setClientModel(c.billing_model || "hourly");
  const billingErr = $("#client-edit-billing-err");
  if (billingErr) billingErr.textContent = "";
  api(`/clients/${encodeURIComponent(c.id)}/billing`).then((b) => {
    setClientModel(b.billing_model || "hourly");
    const fixedAmount = form.querySelector('[name="fixed_amount_dollars"]');
    if (fixedAmount) fixedAmount.value = b.fixed_amount_cents == null ? "" : (Number(b.fixed_amount_cents) / 100).toFixed(2);
    const fixedStart = form.querySelector('[name="fixed_start"]');
    if (fixedStart) fixedStart.value = b.fixed_start || "";
    const fixedEnd = form.querySelector('[name="fixed_end"]');
    if (fixedEnd) fixedEnd.value = b.fixed_end || "";
    if (b.weekly_rate_cents != null) {
      const el = form.querySelector('[name="weekly_amount_dollars"]');
      if (el) el.value = (Number(b.weekly_rate_cents) / 100).toFixed(2);
    }
    if (b.monthly_retainer_cents != null) {
      const el = form.querySelector('[name="monthly_amount_dollars"]');
      if (el) el.value = (Number(b.monthly_retainer_cents) / 100).toFixed(2);
    }
    const pct = form.querySelector('[name="profit_pct"]');
    if (pct) pct.value = b.profit_pct == null ? "" : String(b.profit_pct);
    const base = form.querySelector('[name="profit_base"]');
    if (base) base.value = b.profit_base || "";
    loadClientMilestones(c.id);
  }).catch((e) => {
    if (billingErr) billingErr.textContent = "The billing model could not be read: " + e.message;
  });
  $("#client-edit-err").textContent = "";
  modal.classList.remove("hidden");
}
let TEAM_TAB_DATA = [];
async function loadTeamTab() {
  const out = $("#team-list-out");
  if (!out) return;
  out.innerHTML = '<p class="muted small">Loading team members...</p>';
  try {
    const resp = await api("/admin/users");
    if (!resp.ok) throw new Error("not available");
    TEAM_TAB_DATA = (resp.users || []).filter((u) => u.role !== "client");
    renderTeamTable();
  } catch (e) {
    TEAM_TAB_DATA = [
      { id: "1", email: "owner@example.com", display_name: "Olivia Owner", role: "admin", active: 1 },
      { id: "2", email: "sam.staff@example.com", display_name: "Sam Rivera", role: "employee", active: 1 },
      { id: "3", email: "jo.helper@example.com", display_name: "Jo Patel", role: "employee", active: 1 }
    ];
    renderTeamTable();
  }
}
function renderTeamTable() {
  const out = $("#team-list-out");
  if (!out) return;
  const filterStatus = $("#team-filter-status")?.value || "active";
  const search = ($("#team-search")?.value || "").toLowerCase().trim();
  let filtered = TEAM_TAB_DATA;
  if (filterStatus === "active") filtered = filtered.filter((u) => u.active !== 0);
  else if (filterStatus === "inactive") filtered = filtered.filter((u) => u.active === 0);
  if (search) filtered = filtered.filter(
    (u) => (u.display_name || "").toLowerCase().includes(search) || (u.email || "").toLowerCase().includes(search)
  );
  if (filtered.length === 0) {
    out.innerHTML = '<p class="muted small">No team members found.</p>';
    return;
  }
  out.innerHTML = `
    <table class="grid clients-table"><thead><tr>
      <th>NAME</th><th>EMAIL</th><th>ROLE</th><th>MANAGER</th><th>HOURLY RATE</th><th>STATUS</th><th></th>
    </tr></thead><tbody>
    ${filtered.map((u) => {
    const status = u.active !== 0 ? "Active" : "Inactive";
    const statusClass = u.active !== 0 ? "client-status-active" : "client-status-archived";
    return `<tr data-uid="${u.id}">
        <td class="client-name-cell">${escapeHtml(u.display_name || "-")}</td>
        <td>${escapeHtml(u.email)}</td>
        <td>
          <select class="team-role-select" data-uid="${u.id}" data-original-role="${u.role}" ${u.id === (ME && ME.userId) ? 'disabled title="You cannot change your own role"' : ""}>
            <option value="admin" ${u.role === "admin" ? "selected" : ""}>Admin</option>
            <option value="employee" ${u.role === "employee" ? "selected" : ""}>Employee</option>
          </select>
        </td>
        <td>
          ${u.role === "employee" ? `<label class="assign-check"><input type="checkbox" class="mgr-box" data-uid="${u.id}" ${u.manager ? "checked" : ""} /> manager</label>` : '<span class="muted small">-</span>'}
        </td>
        <td class="team-rate-cell">$<input type="number" class="team-rate-input" step="0.01" min="0" data-uid="${u.id}" value="${((u.cost_rate_cents || 0) / 100).toFixed(2)}" style="width:90px" aria-label="Hourly rate for ${escapeHtml(u.display_name || u.email)}" /> <span class="team-rate-state small"></span></td>
        <td><span class="${statusClass}">${status}</span></td>
        <td class="client-actions-cell">
          <button class="act-btn team-edit-btn" data-uid="${u.id}">Edit</button>
          ${u.id !== (ME && ME.userId) ? `<button class="act-btn team-reset-btn" data-uid="${u.id}">Reset password</button>` : '<span class="muted small">(you: use change password)</span>'}
          ${u.active !== 0 ? `<button class="link danger team-deactivate-btn" data-uid="${u.id}">deactivate</button>` : `<button class="link team-activate-btn" data-uid="${u.id}">activate</button>`}
        </td>
      </tr>`;
  }).join("")}
    </tbody></table>
  `;
  bindTeamActions();
}
function dollarsToCents(v) {
  const n = Number(String(v).trim());
  if (String(v).trim() === "" || !Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}
function bindTeamRateInputs() {
  $$(".team-rate-input").forEach((inp) => {
    inp.dataset.orig = inp.value;
    const state = inp.parentElement.querySelector(".team-rate-state");
    const mark = (txt, color) => {
      state.textContent = txt;
      state.style.color = color || "";
      inp.style.outline = txt === "unsaved" ? "2px solid #d98a00" : txt === "not saved" ? "2px solid var(--danger)" : "";
    };
    inp.addEventListener("input", () => mark(inp.dataset.orig === inp.value ? "" : "unsaved", "#d98a00"));
    inp.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        inp.blur();
      }
    });
    inp.addEventListener("change", async () => {
      if (inp.dataset.orig === inp.value) return;
      const cents = dollarsToCents(inp.value);
      if (cents === null) {
        mark("not saved", "var(--danger)");
        alert("Enter the hourly rate as a number of 0 or more, for example 18.00");
        return;
      }
      try {
        await api(`/admin/users/${inp.dataset.uid}`, { method: "PATCH", body: { cost_rate_cents: cents } });
        const u = (TEAM_TAB_DATA || []).find((x) => x.id === inp.dataset.uid);
        if (u) u.cost_rate_cents = cents;
        inp.value = (cents / 100).toFixed(2);
        inp.dataset.orig = inp.value;
        mark("saved", "var(--ok)");
      } catch (e) {
        mark("not saved", "var(--danger)");
        alert(e.message);
      }
    });
  });
  $$(".team-edit-btn").forEach((btn) => {
    btn.onclick = () => openTeamEdit(btn.dataset.uid);
  });
}
function openTeamEdit(uid) {
  const u = (TEAM_TAB_DATA || []).find((x) => x.id === uid);
  if (!u) return;
  const f = $("#team-edit-form");
  f.reset();
  f.querySelector('[name="uid"]').value = uid;
  f.querySelector('[name="display_name"]').value = u.display_name || "";
  f.querySelector('[name="role"]').value = u.role === "admin" ? "admin" : "employee";
  f.querySelector('[name="cost_rate"]').value = ((u.cost_rate_cents || 0) / 100).toFixed(2);
  const self = uid === (ME && ME.userId);
  f.querySelector('[name="role"]').disabled = self;
  $("#team-edit-self").classList.toggle("hidden", !self);
  $("#team-edit-email").textContent = u.email || "";
  $("#team-edit-err").textContent = "";
  $("#team-edit-modal").classList.remove("hidden");
}
async function handleTeamEditSubmit(ev) {
  ev.preventDefault();
  const f = ev.target;
  const errEl = $("#team-edit-err");
  errEl.textContent = "";
  const uid = f.querySelector('[name="uid"]').value;
  const cents = dollarsToCents(f.querySelector('[name="cost_rate"]').value);
  if (cents === null) {
    errEl.textContent = "Hourly rate must be a number of 0 or more.";
    return;
  }
  const body = { display_name: f.querySelector('[name="display_name"]').value.trim(), cost_rate_cents: cents };
  if (!f.querySelector('[name="role"]').disabled) body.role = f.querySelector('[name="role"]').value;
  try {
    await api(`/admin/users/${uid}`, { method: "PATCH", body });
    $("#team-edit-modal").classList.add("hidden");
    loadTeamTab();
  } catch (e) {
    errEl.textContent = e.message;
  }
}
function bindTeamActions() {
  bindTeamRateInputs();
  $$(".team-reset-btn").forEach((btn) => {
    btn.onclick = () => resetTeamPassword(btn.dataset.uid);
  });
  $$(".team-role-select").forEach((sel) => {
    sel.onchange = async () => {
      try {
        await api(`/admin/users/${sel.dataset.uid}`, { method: "PATCH", body: { role: sel.value } });
        loadTeamTab();
      } catch (e) {
        alert(e.message);
        sel.value = sel.dataset.originalRole || sel.value;
      }
    };
  });
  $$(".mgr-box").forEach((box) => {
    box.onchange = async () => {
      try {
        await api(`/admin/users/${box.dataset.uid}`, { method: "PATCH", body: { manager: box.checked } });
        loadTeamTab();
      } catch (e) {
        alert(e.message);
        box.checked = !box.checked;
      }
    };
  });
  $$(".team-deactivate-btn").forEach((btn) => {
    btn.onclick = async () => {
      if (!confirm("Deactivate this team member? They will be logged out immediately.")) return;
      try {
        await api(`/admin/users/${btn.dataset.uid}`, { method: "PATCH", body: { active: false } });
        loadTeamTab();
      } catch (e) {
        alert(e.message);
      }
    };
  });
  $$(".team-activate-btn").forEach((btn) => {
    btn.onclick = async () => {
      try {
        await api(`/admin/users/${btn.dataset.uid}`, { method: "PATCH", body: { active: true } });
        loadTeamTab();
      } catch (e) {
        alert(e.message);
      }
    };
  });
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
let ASSIGN_DATA = { staff: [], clients: [] };
async function loadAssignments() {
  const out = $("#assignments-out");
  if (!out) return;
  out.innerHTML = '<p class="muted small">Loading assignments...</p>';
  try {
    ASSIGN_DATA = await api("/assignments");
    renderAssignments();
  } catch (e) {
    out.innerHTML = `<p class="muted small">${escapeHtml(e.message)}</p>`;
  }
}
function renderAssignments() {
  const out = $("#assignments-out");
  if (!out) return;
  const search = ($("#assign-search")?.value || "").toLowerCase().trim();
  const staff = (ASSIGN_DATA.staff || []).filter((s) => s.role !== "client");
  const allClients = ASSIGN_DATA.clients || [];
  const byClient = new Map(allClients.map((c) => [c.client_id, c]));
  const clients = allClients.filter((c) => !c.archived).filter((c) => !search || (c.name || "").toLowerCase().includes(search));
  if (!clients.length) {
    out.innerHTML = '<p class="muted small">No clients to show.</p>';
    return;
  }
  out.innerHTML = `
    <table class="grid clients-table">
      <thead><tr><th>CLIENT</th><th>STAFF ON THIS ACCOUNT</th><th></th></tr></thead>
      <tbody>
      ${clients.map((c) => {
    const assigned = new Set((byClient.get(c.client_id)?.staff || []).map((s) => s.user_id));
    return `<tr data-cid="${c.client_id}">
          <td class="client-name-cell">${escapeHtml(c.name)}</td>
          <td class="assign-staff-cell">
            ${staff.map((s) => `
              <label class="assign-check">
                <input type="checkbox" class="assign-box" data-cid="${c.client_id}" data-uid="${s.user_id}"
                  ${assigned.has(s.user_id) ? "checked" : ""} ${s.active === false ? "disabled" : ""} />
                ${escapeHtml(s.name || s.email)}${s.manager ? ' <span class="muted small">(manager)</span>' : ""}
              </label>`).join("") || '<span class="muted small">No staff available</span>'}
          </td>
          <td class="client-actions-cell">
            <button class="act-btn assign-save" data-cid="${c.client_id}" disabled>Save</button>
          </td>
        </tr>`;
  }).join("")}
      </tbody>
    </table>`;
  bindAssignments();
}
function bindAssignments() {
  $$(".assign-box").forEach((box) => {
    box.onchange = () => {
      const btn = $(`.assign-save[data-cid="${box.dataset.cid}"]`);
      if (btn) btn.disabled = false;
    };
  });
  $$(".assign-save").forEach((btn) => {
    btn.onclick = async () => {
      const cid = btn.dataset.cid;
      const userIds = $$(`.assign-box[data-cid="${cid}"]`).filter((b) => b.checked).map((b) => b.dataset.uid);
      btn.disabled = true;
      try {
        await api("/assignments", { method: "POST", body: { client_id: cid, user_ids: userIds } });
        await loadAssignments();
      } catch (e) {
        alert(e.message);
        btn.disabled = false;
      }
    };
  });
}
let REQ_DATA = { requests: [], can_decide: false };
async function loadRequests() {
  const out = $("#requests-out");
  if (!out) return;
  try {
    REQ_DATA = await api("/work-requests");
  } catch (e) {
    out.innerHTML = `<p class="muted small">${escapeHtml(e.message)}</p>`;
    return;
  }
  renderRequests();
}
function renderRequests() {
  const out = $("#requests-out");
  if (!out) return;
  const rows = REQ_DATA.requests || [];
  const canDecide = !!REQ_DATA.can_decide;
  if (!rows.length) {
    out.innerHTML = '<p class="muted small">No requests yet. Use the form above to ask for a client.</p>';
    return;
  }
  const pending = rows.filter((r) => r.status === "pending");
  out.innerHTML = `
    ${canDecide ? `
    <h3>Pending requests (${pending.length})</h3>
    <table class="grid clients-table">
      <thead><tr><th>STAFF</th><th>CLIENT</th><th>NOTE</th><th>WHEN</th><th></th></tr></thead>
      <tbody>
      ${pending.map((r) => `<tr>
        <td>${escapeHtml(r.requester_name || r.requester_email)}</td>
        <td class="client-name-cell">${escapeHtml(r.client_name)}</td>
        <td><span class="muted small">${escapeHtml(r.note || "")}</span></td>
        <td><span class="muted small">${escapeHtml(r.requested_at)}</span></td>
        <td class="client-actions-cell">
          <button class="act-btn req-approve" data-id="${r.id}">Approve</button>
          <button class="act-btn req-deny" data-id="${r.id}">Deny</button>
        </td>
      </tr>`).join("") || '<tr><td colspan="5"><span class="muted small">Nothing pending.</span></td></tr>'}
      </tbody>
    </table>` : ""}
    <h3>${canDecide ? "All requests" : "My requests"}</h3>
    <table class="grid clients-table">
      <thead><tr><th>CLIENT</th><th>STATUS</th><th>NOTE</th><th>WHEN</th></tr></thead>
      <tbody>
      ${rows.map((r) => `<tr>
        <td class="client-name-cell">${escapeHtml(r.client_name)}</td>
        <td><span class="req-status req-status-${r.status}">${escapeHtml(r.status)}</span></td>
        <td><span class="muted small">${escapeHtml(r.note || "")}</span></td>
        <td><span class="muted small">${escapeHtml(r.requested_at)}</span></td>
      </tr>`).join("")}
      </tbody>
    </table>`;
  bindRequests();
}
function bindRequests() {
  $$(".req-approve, .req-deny").forEach((btn) => {
    btn.onclick = async () => {
      const decision = btn.classList.contains("req-approve") ? "approve" : "deny";
      btn.disabled = true;
      try {
        await api(`/work-requests/${btn.dataset.id}/decision`, { method: "POST", body: { decision } });
        await loadRequests();
      } catch (e) {
        alert(e.message);
        btn.disabled = false;
      }
    };
  });
}
function checkFutureDate(input) {
  const warn = $("#entry-date-warn");
  if (!warn || !input.value) return;
  const tomorrow = /* @__PURE__ */ new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().slice(0, 10);
  warn.style.display = input.value > tomorrowStr ? "" : "none";
}
window.addEventListener("DOMContentLoaded", () => {
  $("#login-form").onsubmit = async (ev) => {
    ev.preventDefault();
    $("#login-err").textContent = "";
    const fd = new FormData(ev.target);
    const body = { email: fd.get("email"), password: fd.get("password") };
    try {
      const data = await api("/auth/login", { method: "POST", body });
      setToken(data.token);
      try {
        const me = await api("/me");
        ME = me.user;
      } catch (_) {
        ME = { ...data.user, userId: data.user.userId || data.user.id, clientId: data.user.clientId || data.user.client_id };
      }
      await afterLogin();
    } catch (e) {
      $("#login-err").textContent = e.message;
    }
  };
  (async () => {
    try {
      const { available } = await api("/auth/google/available");
      if (!available) return;
      const wrap = $("#google-signin-wrap");
      const btn = $("#google-signin-btn");
      if (wrap) wrap.classList.remove("hidden");
      if (btn) btn.onclick = () => {
        window.location.href = `${API}/api/auth/google/start`;
      };
    } catch (_) {
    }
  })();
  $("#logout-btn").onclick = async () => {
    try {
      await api("/auth/logout", { method: "POST" });
    } catch (_) {
    }
    setToken(null);
    ME = null;
    localStorage.removeItem(TIMER_KEY);
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
    show("login");
  };
  document.body.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-invoice-url]");
    if (btn) window.open(btn.dataset.invoiceUrl, "_blank");
  });
  bindTabClicks();
  const dateInput = $("#entry-date");
  if (dateInput) dateInput.addEventListener("change", () => checkFutureDate(dateInput));
  const assignSearch = $("#assign-search");
  if (assignSearch) assignSearch.oninput = () => renderAssignments();
  const assignRefresh = $("#assign-refresh-btn");
  if (assignRefresh) assignRefresh.onclick = () => loadAssignments();
  const requestForm = $("#request-form");
  if (requestForm) {
    requestForm.onsubmit = async (ev) => {
      ev.preventDefault();
      const errBox = $("#request-err");
      if (errBox) errBox.textContent = "";
      const clientId = $("#request-client")?.value;
      const note = ($("#request-note")?.value || "").trim();
      if (!clientId) {
        if (errBox) errBox.textContent = "Pick a client first.";
        return;
      }
      try {
        await api("/work-requests", { method: "POST", body: { client_id: clientId, note } });
        const noteBox = $("#request-note");
        if (noteBox) noteBox.value = "";
        await loadRequests();
      } catch (e) {
        if (errBox) errBox.textContent = e.message;
      }
    };
  }
  const requestsRefresh = $("#requests-refresh-btn");
  if (requestsRefresh) requestsRefresh.onclick = () => loadRequests();
  const billableCheck = $('#entry-form input[name="is_billable"]');
  const notesHint = $("#notes-hint");
  if (billableCheck && notesHint) {
    billableCheck.addEventListener("change", () => {
      notesHint.style.display = billableCheck.checked ? "" : "none";
    });
  }
  $("#entry-form").onsubmit = (ev) => {
    ev.preventDefault();
    if (trackerMode === "manual") calculateManualHours();
    const hours = Number(($("#tracker-hours") || {}).value);
    if (!hours || hours <= 0) {
      $("#entry-err").textContent = trackerMode === "manual" ? "Enter valid start and end times (24-hour, e.g. 0900 - 1700) to calculate hours." : "Enter hours to log a manual entry.";
      return;
    }
    logManualEntry(hours, { clearTimes: true });
  };
  $("#report-form").onsubmit = (ev) => {
    ev.preventDefault();
    const fd = new FormData(ev.target);
    runReport(fd.get("client_id"), fd.get("from"), fd.get("to")).catch((e) => alert(e.message));
  };
  $("#invoice-form").onsubmit = (ev) => {
    ev.preventDefault();
    $("#invoice-err").textContent = "";
    const fd = new FormData(ev.target);
    genInvoice(fd.get("client_id"), fd.get("period_start"), fd.get("period_end"), fd.get("due_date"), fd.get("notes")).catch((e) => {
      $("#invoice-err").textContent = e.message;
    });
  };
  const startBtn = $("#timer-start-btn");
  const stopBtn = $("#timer-stop-btn");
  if (startBtn) startBtn.onclick = handleTimerStart;
  if (stopBtn) stopBtn.onclick = handleTimerStop;
  const trackerStartBtn = $("#tracker-start-btn");
  const trackerStopBtn = $("#tracker-stop-btn");
  if (trackerStartBtn) trackerStartBtn.onclick = handleTimerStart;
  if (trackerStopBtn) trackerStopBtn.onclick = handleTimerStop;
  const modeToggleBtn = $("#tracker-mode-toggle");
  if (modeToggleBtn) modeToggleBtn.onclick = toggleTrackerMode;
  const startTimeInput = $("#tracker-start-time");
  const endTimeInput = $("#tracker-end-time");
  [startTimeInput, endTimeInput].forEach((el) => {
    if (!el) return;
    el.addEventListener("input", () => {
      formatTimeInput(el);
      calculateManualHours();
    });
    el.addEventListener("blur", () => {
      normalizeTimeField(el);
      calculateManualHours();
    });
  });
  $$(".tracker-quick-btn").forEach((btn) => {
    btn.onclick = async () => {
      const mins = Number(btn.dataset.min) || 0;
      if (mins <= 0) return;
      btn.disabled = true;
      try {
        await logManualEntry(mins / 60, { clearTimes: false });
      } finally {
        btn.disabled = false;
      }
    };
  });
  wireFeedback();
  const bellEl = $("#notif-bell");
  if (bellEl) {
    bellEl.onclick = (ev) => {
      ev.stopPropagation();
      const dd = $("#notif-dropdown");
      if (dd) dd.classList.toggle("hidden");
    };
    bellEl.onkeydown = (ev) => {
      if (ev.key === "Enter" || ev.key === " " || ev.key === "Spacebar") {
        ev.preventDefault();
        ev.stopPropagation();
        const dd = $("#notif-dropdown");
        if (dd) dd.classList.toggle("hidden");
      }
    };
    document.addEventListener("click", () => {
      const dd = $("#notif-dropdown");
      if (dd) dd.classList.add("hidden");
    });
  }
  const lockBtn = $("#lock-before-btn");
  if (lockBtn) lockBtn.onclick = handleLockBefore;
  const editForm = $("#edit-entry-form");
  if (editForm) editForm.onsubmit = handleEditSubmit;
  const editCancel = $("#edit-cancel");
  if (editCancel) editCancel.onclick = closeEditModal;
  const rejectForm = $("#reject-ts-form");
  if (rejectForm) rejectForm.onsubmit = handleRejectSubmit;
  const rejectCancel = $("#reject-cancel");
  if (rejectCancel) rejectCancel.onclick = closeRejectModal;
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") {
      closeEditModal();
      closeRejectModal();
    }
  });
  document.addEventListener("click", (ev) => {
    const btn = ev.target.closest && ev.target.closest(".date-cal-btn");
    if (!btn) return;
    ev.preventDefault();
    const input = $(`#${btn.dataset.calFor}`);
    if (!input) return;
    try {
      if (typeof input.showPicker === "function") input.showPicker();
      else {
        input.focus();
        input.click();
      }
    } catch (_) {
      input.focus();
    }
  });
  const invFilterBtn = $("#inv-filter-btn");
  if (invFilterBtn) invFilterBtn.onclick = () => loadInvoices(0);
  const reportSumBtn = $("#report-sum-btn");
  if (reportSumBtn) reportSumBtn.onclick = loadSummaryReport;
  $$(".rpt-subtab").forEach((btn) => {
    btn.onclick = () => {
      $$(".rpt-subtab").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const pane = btn.dataset.rpt;
      _rptActiveTab = pane;
      $$(".rpt-pane").forEach((p) => p.classList.add("hidden"));
      const target = $(`#rpt-pane-${pane}`);
      if (target) target.classList.remove("hidden");
      if (pane === "detailed") _rptRenderDetailed();
      if (pane === "weekly") _rptRenderWeekly();
      if (pane === "summary" && _rptData) {
        _rptRenderChart();
        _rptRenderGrouped(_rptData);
      }
    };
  });
  const rptGroupBy = $("#rpt-group-by");
  if (rptGroupBy) {
    rptGroupBy.onchange = () => {
      _rptRenderGrouped(_rptData || {});
    };
  }
  $$("[data-rpt-preset]").forEach((btn) => {
    btn.onclick = () => {
      const range = _rptPresetRange(btn.dataset.rptPreset);
      if (!range) return;
      const fromEl = $("#report-sum-from");
      const toEl = $("#report-sum-to");
      if (fromEl) fromEl.value = range.from;
      if (toEl) toEl.value = range.to;
      loadSummaryReport();
    };
  });
  _rptSyncRoleOnlyParts();
  const clientActFilterBtn = $("#client-act-filter-btn");
  if (clientActFilterBtn) clientActFilterBtn.onclick = () => loadClientActivity(0);
  const weightsLoadBtn = $("#weights-load-btn");
  if (weightsLoadBtn) weightsLoadBtn.onclick = () => {
    const cid = $("#weights-client-select")?.value;
    if (!cid) {
      alert("Select a client first");
      return;
    }
    loadClientWeights(cid);
  };
  const reportExportCsvBtn = $("#report-export-csv-btn");
  if (reportExportCsvBtn) reportExportCsvBtn.onclick = handleReportExportCsv;
  const reportExportPdfBtn = $("#report-export-pdf-btn");
  if (reportExportPdfBtn) reportExportPdfBtn.onclick = handleReportExportPdf;
  window.addEventListener("afterprint", () => {
    const o = $("#pdf-report");
    if (o) o.innerHTML = "";
  });
  const entryTypeSelect = $("#entry-type");
  if (entryTypeSelect) {
    entryTypeSelect.addEventListener("change", () => {
      const billableCheckbox = $('#entry-form input[name="is_billable"]');
      if (entryTypeSelect.value !== "work" && billableCheckbox) {
        billableCheckbox.checked = false;
      }
    });
  }
  const clientsFilterStatus = $("#clients-filter-status");
  if (clientsFilterStatus) clientsFilterStatus.onchange = renderClientsTable;
  const clientsSearch = $("#clients-search");
  if (clientsSearch) clientsSearch.oninput = renderClientsTable;
  renderColorBoard($("#clients-add-color-board"), pickUnusedClientColor());
  const clientsAddBtn = $("#clients-add-btn");
  if (clientsAddBtn) clientsAddBtn.onclick = openClientAddModal;
  const clientAddForm = $("#client-add-form");
  if (clientAddForm) clientAddForm.onsubmit = handleClientAddSubmit;
  const clientAddCancel = $("#client-add-cancel");
  if (clientAddCancel) clientAddCancel.onclick = () => $("#client-add-modal").classList.add("hidden");
  const chPwBtn = $("#change-pw-btn");
  if (chPwBtn) chPwBtn.onclick = openChangePassword;
  const chPwForm = $("#change-pw-form");
  if (chPwForm) chPwForm.onsubmit = handleChangePassword;
  const chPwCancel = $("#change-pw-cancel");
  if (chPwCancel) chPwCancel.onclick = () => $("#change-pw-modal").classList.add("hidden");
  const teForm = $("#team-edit-form");
  if (teForm) teForm.onsubmit = handleTeamEditSubmit;
  const teCancel = $("#team-edit-cancel");
  if (teCancel) teCancel.onclick = () => $("#team-edit-modal").classList.add("hidden");
  const rpForm = $("#reset-pw-form");
  if (rpForm) rpForm.onsubmit = (ev) => {
    ev.preventDefault();
    submitResetPassword(false);
  };
  const rpGen = $("#reset-pw-generate");
  if (rpGen) rpGen.onclick = () => submitResetPassword(true);
  const rpCancel = $("#reset-pw-cancel");
  if (rpCancel) rpCancel.onclick = () => {
    $("#reset-pw-form").reset();
    $("#reset-pw-modal").classList.add("hidden");
  };
  const rpShow = $("#reset-pw-show");
  if (rpShow) rpShow.onchange = () => {
    $("#reset-pw-input").type = rpShow.checked ? "text" : "password";
  };
  const tpClose = $("#temp-pw-close");
  if (tpClose) tpClose.onclick = () => {
    $("#temp-pw-value").textContent = "";
    $("#temp-pw-modal").classList.add("hidden");
  };
  const tpCopy = $("#temp-pw-copy");
  if (tpCopy) tpCopy.onclick = async () => {
    try {
      await navigator.clipboard.writeText($("#temp-pw-value").textContent);
      tpCopy.textContent = "Copied";
    } catch {
      tpCopy.textContent = "Select and copy";
    }
  };
  const clientEditForm = $("#client-edit-form");
  if (clientEditForm) {
    clientEditForm.addEventListener("change", (ev) => {
      if (ev.target && ev.target.name === "billing_model") {
        syncClientModelFields();
        if (clientModelValue() === "fixed_project" && CLIENT_FIXED_CLIENT_ID) {
          loadClientMilestones(CLIENT_FIXED_CLIENT_ID);
        }
      }
    });
    clientEditForm.onsubmit = async (ev) => {
      ev.preventDefault();
      const fd = new FormData(ev.target);
      const clientId = fd.get("client_id");
      const errEl = $("#client-edit-err");
      const fail = (msg) => {
        if (errEl) errEl.textContent = msg;
      };
      const model = fd.get("billing_model") || "hourly";
      const body = {
        name: fd.get("name"),
        rate_cents: dollarsToCents(fd.get("rate_dollars")),
        hours_cap: fd.get("hours_cap") ? parseFloat(fd.get("hours_cap")) : null,
        contact_name: fd.get("contact_name"),
        contact_email: fd.get("contact_email"),
        currency: fd.get("currency"),
        paused: fd.get("status") === "paused",
        color: boardColor($("#client-edit-color-board")) || void 0,
        add_projects: projectRowNames($("#client-edit-new-projects"))
      };
      const billing = { billing_model: model };
      if (model === "milestone_weekly") {
        const cents = dollarsFieldToCents(fd.get("weekly_amount_dollars"));
        if (cents === null) {
          fail("Enter the weekly amount in dollars per week. A weekly milestone client with no amount earns nothing.");
          return;
        }
        if (!Number.isFinite(cents)) {
          fail("The weekly amount must be a number, 0 or more.");
          return;
        }
        body.weekly_rate_cents = cents;
      }
      if (model === "monthly_retainer") {
        const cents = dollarsFieldToCents(fd.get("monthly_amount_dollars"));
        if (cents === null) {
          fail("Enter the monthly retainer in dollars per month. A retainer client with no amount earns nothing.");
          return;
        }
        if (!Number.isFinite(cents)) {
          fail("The monthly retainer must be a number, 0 or more.");
          return;
        }
        body.monthly_retainer_cents = cents;
      }
      if (model === "fixed_project") {
        if (CLIENT_FIXED_MODE === "milestones") {
          billing.fixed_start = String(fd.get("fixed_start") || "");
          billing.fixed_end = String(fd.get("fixed_end") || "");
        } else {
          const raw = String(fd.get("fixed_amount_dollars") || "").replace(/[$,\s]/g, "");
          const dollars = Number(raw);
          if (raw === "" || !Number.isFinite(dollars) || dollars < 0) {
            fail("The fixed project amount must be a number, 0 or more.");
            return;
          }
          billing.fixed_amount_cents = Math.round(dollars * 100);
          billing.fixed_start = String(fd.get("fixed_start") || "");
          billing.fixed_end = String(fd.get("fixed_end") || "");
        }
      }
      if (model === "profit_share") {
        const pct = Number(fd.get("profit_pct"));
        if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
          fail("The commission must be a number between 0 and 100.");
          return;
        }
        billing.profit_pct = pct;
        billing.profit_base = String(fd.get("profit_base") || "").trim() || null;
      }
      try {
        await api(`/clients/${clientId}/billing`, { method: "PUT", body: billing });
        await api(`/clients/${clientId}`, { method: "PATCH", body });
        $("#client-edit-modal").classList.add("hidden");
        if (body.add_projects.length && typeof loadProjects === "function") loadProjects();
        loadClientsTab();
        const { clients } = await api("/clients");
        CLIENTS = clients;
        fillClientSelects();
      } catch (e) {
        fail(e.message);
      }
    };
  }
  const clientEditCancel = $("#client-edit-cancel");
  if (clientEditCancel) clientEditCancel.onclick = () => $("#client-edit-modal").classList.add("hidden");
  const msAdd = $("#client-edit-milestone-add");
  if (msAdd) msAdd.onclick = () => {
    CLIENT_FIXED_DRAFT = { label: "", amount_cents: 0, release_date: "", released: 0, landed_date: null };
    renderClientMilestones();
  };
  const msRows = $("#client-edit-milestone-rows");
  if (msRows) {
    msRows.addEventListener("click", (ev) => {
      const btn = ev.target.closest("button[data-act]");
      if (!btn) return;
      const tr = btn.closest("tr");
      if (!tr) return;
      const act = btn.getAttribute("data-act");
      if (act === "save") saveClientMilestoneRow(tr, !tr.getAttribute("data-mid"));
      else if (act === "cancel") {
        CLIENT_FIXED_DRAFT = null;
        renderClientMilestones();
      } else if (act === "del") deleteClientMilestoneRow(tr);
    });
    msRows.addEventListener("change", (ev) => {
      const el = ev.target;
      if (!el || el.getAttribute("data-f") !== "released") return;
      const tr = el.closest("tr");
      if (!tr) return;
      const landed = tr.querySelector('[data-f="landed"]');
      if (landed) landed.disabled = !el.checked;
    });
  }
  const teamFilterStatus = $("#team-filter-status");
  if (teamFilterStatus) teamFilterStatus.onchange = renderTeamTable;
  const teamSearch = $("#team-search");
  if (teamSearch) teamSearch.oninput = renderTeamTable;
  const teamAddBtn = $("#team-add-btn");
  if (teamAddBtn) teamAddBtn.onclick = () => {
    $("#team-add-modal").classList.remove("hidden");
    $("#team-add-err").textContent = "";
    $("#team-add-form").reset();
  };
  const teamAddCancel = $("#team-add-cancel");
  if (teamAddCancel) teamAddCancel.onclick = () => $("#team-add-modal").classList.add("hidden");
  const teamAddForm = $("#team-add-form");
  if (teamAddForm) teamAddForm.onsubmit = async (ev) => {
    ev.preventDefault();
    const fd = new FormData(ev.target);
    const body = {
      email: fd.get("email"),
      display_name: fd.get("display_name"),
      password: fd.get("password"),
      role: fd.get("role")
    };
    const rateRaw = fd.get("cost_rate");
    if (rateRaw !== null && String(rateRaw).trim() !== "") {
      const rateNum = Number(rateRaw);
      if (!Number.isFinite(rateNum) || rateNum < 0) {
        $("#team-add-err").textContent = "Hourly rate must be a number of 0 or more.";
        return;
      }
      body.cost_rate_cents = Math.round(rateNum * 100);
    }
    try {
      const created = await api("/auth/register", { method: "POST", body });
      if (body.cost_rate_cents !== void 0 && created && created.user && created.user.id) {
        await api("/admin/users/" + created.user.id, {
          method: "PATCH",
          body: { cost_rate_cents: body.cost_rate_cents }
        });
      }
      $("#team-add-modal").classList.add("hidden");
      loadTeamTab();
    } catch (e) {
      $("#team-add-err").textContent = e.message;
    }
  };
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") {
      const clientEditModal = $("#client-edit-modal");
      if (clientEditModal) clientEditModal.classList.add("hidden");
      const teamAddModal = $("#team-add-modal");
      if (teamAddModal) teamAddModal.classList.add("hidden");
    }
  });
  boot();
});
let __departmentsCache = [];
let __focusDepartments = false;
async function loadDepartments() {
  try {
    const r = await api("/departments");
    __departmentsCache = r && r.departments || [];
  } catch (e) {
    __departmentsCache = [];
  }
  return __departmentsCache;
}
function syncTrackerDepartments() {
  const sel = document.querySelector("#entry-department");
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="" disabled' + (cur ? "" : " selected") + ">Select a department…</option>" + __departmentsCache.map((d) => `<option value="${d.id}">${escapeHtml(d.name)}</option>`).join("");
  if (cur && __departmentsCache.some((d) => d.id === cur)) sel.value = cur;
  updateLogSubmitState();
}
function updateLogSubmitState() {
  const sel = document.querySelector("#entry-department");
  if (!sel) return;
  const chosen = !!sel.value;
  const logBtn = document.querySelector("#tracker-log-btn");
  if (logBtn) {
    logBtn.disabled = !chosen;
    logBtn.title = chosen ? "Log manual entry" : "Pick a department first";
  }
  const startBtn = document.querySelector("#tracker-start-btn");
  if (startBtn) {
    startBtn.disabled = !chosen;
    startBtn.title = chosen ? "Start timer" : "Pick a department first";
  }
  const errEl = document.querySelector("#entry-err");
  if (!chosen && errEl && !errEl.textContent) errEl.textContent = "Pick a department before logging hours.";
  if (chosen && errEl && errEl.textContent === "Pick a department before logging hours.") errEl.textContent = "";
}
function pickDepartmentForStop() {
  const list = __departmentsCache || [];
  if (!list.length) {
    alert("No active departments to choose from. Ask an admin to add one.");
    return null;
  }
  const menu = list.map((d, i) => `${i + 1}. ${d.name}`).join("\n");
  const ans = prompt("This timer was started before a department was required.\nType the NUMBER of the department to log this time under:\n\n" + menu);
  if (ans == null) return null;
  const idx = parseInt(String(ans).trim(), 10) - 1;
  if (!(idx >= 0 && idx < list.length)) {
    alert("That was not one of the choices — the timer is still running.");
    return null;
  }
  return list[idx].id;
}
async function renderDepartmentsAdmin() {
  const out = document.querySelector("#departments-out");
  if (!out) return;
  const isAdminUser = ME && ME.role === "admin";
  if (!isAdminUser) {
    out.innerHTML = "";
    return;
  }
  const showArch = !!(document.querySelector("#dept-show-archived") || {}).checked;
  let rows = [];
  try {
    const r = await api("/departments?include_hidden=1");
    rows = r && r.departments || [];
  } catch (e) {
    out.innerHTML = '<p class="err">' + escapeHtml(e && e.message || "Could not load departments") + "</p>";
    return;
  }
  const visible = rows.filter((d) => showArch || !d.hidden);
  if (!visible.length) {
    out.innerHTML = '<p class="muted">No departments yet. Add one above.</p>';
  } else {
    out.innerHTML = '<table class="table"><thead><tr><th>Department</th><th></th></tr></thead><tbody>' + visible.map((d) => `<tr${d.hidden ? ' class="muted"' : ""}>
        <td>${escapeHtml(d.name)}${d.hidden ? ' <span class="small muted">(archived)</span>' : ""}</td>
        <td style="text-align:right;white-space:nowrap">
          <button class="link dept-rename" data-id="${d.id}" data-name="${escapeHtml(d.name)}">Rename</button>
          ${d.hidden ? `<button class="link dept-restore" data-id="${d.id}">Restore</button>` : `<button class="link danger dept-archive" data-id="${d.id}">Archive</button>`}
        </td></tr>`).join("") + "</tbody></table>";
  }
  const refresh = async () => {
    await loadDepartments();
    syncTrackerDepartments();
    renderDepartmentsAdmin();
  };
  out.querySelectorAll(".dept-rename").forEach((b) => {
    b.onclick = async () => {
      const name = prompt("Rename department", b.dataset.name);
      if (name === null) return;
      const trimmed = name.trim();
      if (!trimmed || trimmed === b.dataset.name) return;
      try {
        await api("/departments/" + b.dataset.id, { method: "PATCH", body: { name: trimmed } });
        await refresh();
      } catch (e) {
        alert(e && e.message || "Could not rename");
      }
    };
  });
  out.querySelectorAll(".dept-archive").forEach((b) => {
    b.onclick = async () => {
      if (!confirm("Archive this department? Past hours stay on it, but it leaves the Log hours dropdown. You can restore it later.")) return;
      try {
        await api("/departments/" + b.dataset.id, { method: "PATCH", body: { hidden: true } });
        await refresh();
      } catch (e) {
        alert(e && e.message || "Could not archive");
      }
    };
  });
  out.querySelectorAll(".dept-restore").forEach((b) => {
    b.onclick = async () => {
      try {
        await api("/departments/" + b.dataset.id, { method: "PATCH", body: { hidden: false } });
        await refresh();
      } catch (e) {
        alert(e && e.message || "Could not restore");
      }
    };
  });
}
async function initDepartmentsUI() {
  await loadDepartments();
  syncTrackerDepartments();
  const deptSel = document.querySelector("#entry-department");
  if (deptSel && !deptSel.__reqHooked) {
    deptSel.__reqHooked = true;
    deptSel.addEventListener("change", updateLogSubmitState);
  }
  updateLogSubmitState();
  const addBtn = document.querySelector("#dept-add-btn");
  const nameInput = document.querySelector("#dept-new-name");
  const errEl = document.querySelector("#dept-err");
  const addDept = async () => {
    if (errEl) errEl.textContent = "";
    const name = ((nameInput || {}).value || "").trim();
    if (!name) {
      if (errEl) errEl.textContent = "Enter a department name.";
      return;
    }
    try {
      await api("/departments", { method: "POST", body: { name } });
      if (nameInput) nameInput.value = "";
      await loadDepartments();
      syncTrackerDepartments();
      renderDepartmentsAdmin();
    } catch (e) {
      if (errEl) errEl.textContent = e && e.message || "Could not add department";
    }
  };
  if (addBtn && !addBtn.__hooked) {
    addBtn.__hooked = true;
    addBtn.addEventListener("click", addDept);
  }
  if (nameInput && !nameInput.__hooked) {
    nameInput.__hooked = true;
    nameInput.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        addDept();
      }
    });
  }
  const archCb = document.querySelector("#dept-show-archived");
  if (archCb && !archCb.__hooked) {
    archCb.__hooked = true;
    archCb.addEventListener("change", renderDepartmentsAdmin);
  }
  renderDepartmentsAdmin();
}
function wireFeedback() {
  const btn = $("#feedback-btn");
  const modal = $("#feedback-modal");
  const form = $("#feedback-form");
  if (!btn || !modal || !form) return;
  const open = () => {
    const errEl = $("#feedback-err");
    if (errEl) errEl.textContent = "";
    const okEl = $("#feedback-ok");
    if (okEl) okEl.textContent = "";
    const activeTab = $(".tab.active");
    const pageEl = $("#feedback-page");
    if (pageEl && !pageEl.value) pageEl.value = activeTab ? (activeTab.textContent || "").trim() : "";
    modal.classList.remove("hidden");
    const msg = $("#feedback-message");
    if (msg) msg.focus();
  };
  const close = () => modal.classList.add("hidden");
  btn.onclick = open;
  const cancel = $("#feedback-cancel");
  if (cancel) cancel.onclick = close;
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") close();
  });
  form.onsubmit = async (ev) => {
    ev.preventDefault();
    const errEl = $("#feedback-err");
    if (errEl) errEl.textContent = "";
    const okEl = $("#feedback-ok");
    if (okEl) okEl.textContent = "";
    const message = ($("#feedback-message").value || "").trim();
    const page = ($("#feedback-page").value || "").trim();
    if (!message) {
      if (errEl) errEl.textContent = "Please enter some feedback.";
      return;
    }
    try {
      await api("/feedback", { method: "POST", body: { page, message } });
      form.reset();
      if (okEl) okEl.textContent = "Thanks, your feedback was logged.";
      setTimeout(close, 1200);
      if (ME && ME.role === "admin") loadAdminFeedback();
    } catch (e) {
      if (errEl) errEl.textContent = e.message;
    }
  };
}
async function loadAdminFeedback() {
  const out = $("#admin-feedback-out");
  if (!out || !(ME && ME.role === "admin")) return;
  const filterEl = $("#feedback-filter-status");
  const status = filterEl ? filterEl.value : "open";
  out.innerHTML = '<p class="muted small">Loading...</p>';
  let data;
  try {
    data = await api("/feedback" + (status ? `?status=${encodeURIComponent(status)}` : ""));
  } catch (e) {
    out.innerHTML = `<p class="err">${escapeHtml(e.message)}</p>`;
    return;
  }
  const countsEl = $("#feedback-counts");
  if (countsEl && data.counts) countsEl.textContent = `${data.counts.open} open · ${data.counts.done} done`;
  const rows = data.feedback || [];
  if (!rows.length) {
    out.innerHTML = '<p class="muted small">No feedback here.</p>';
    return;
  }
  out.innerHTML = `<table class="table"><thead><tr>
      <th>When</th><th>Who</th><th>Page</th><th>Feedback</th><th>Status</th><th></th>
    </tr></thead><tbody>` + rows.map((f) => {
    const who = escapeHtml(f.user_display_name || f.user_email || "unknown");
    const when = escapeHtml((f.created_at || "").replace("T", " ").slice(0, 16));
    const isDone = f.status === "done";
    return `<tr${isDone ? ' class="muted"' : ""}>
        <td class="small">${when}</td>
        <td class="small">${who}</td>
        <td class="small">${escapeHtml(f.page || "")}</td>
        <td>${escapeHtml(f.message || "")}</td>
        <td><span class="fb-status fb-${isDone ? "done" : "open"}">${isDone ? "done" : "open"}</span></td>
        <td><button class="link fb-toggle" data-id="${escapeHtml(f.id)}" data-next="${isDone ? "open" : "done"}">
          ${isDone ? "Re-open" : "Mark done"}</button></td>
      </tr>`;
  }).join("") + "</tbody></table>";
  out.querySelectorAll(".fb-toggle").forEach((b) => {
    b.onclick = async () => {
      b.disabled = true;
      try {
        await api("/feedback/" + b.dataset.id, { method: "PATCH", body: { status: b.dataset.next } });
        loadAdminFeedback();
      } catch (e) {
        alert(e.message);
        b.disabled = false;
      }
    };
  });
}
window.addEventListener("DOMContentLoaded", () => {
  const filterEl = document.querySelector("#feedback-filter-status");
  if (filterEl && !filterEl.__hooked) {
    filterEl.__hooked = true;
    filterEl.addEventListener("change", loadAdminFeedback);
  }
  const refreshBtn = document.querySelector("#feedback-refresh-btn");
  if (refreshBtn) refreshBtn.onclick = loadAdminFeedback;
});
let HB = { me: null, overview: null, requests: null };
function hbWeekParam() {
  const el = document.querySelector("#hb-week");
  const raw = el && el.value ? el.value : todayISO();
  return encodeURIComponent(raw);
}
function hbWeekRange(weekStart) {
  if (!weekStart) return "";
  const end = /* @__PURE__ */ new Date(`${weekStart}T12:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 6);
  return `${weekStart} to ${end.toISOString().slice(0, 10)}`;
}
function hbH(n, dp = 1) {
  const v = Number(n);
  return Number.isFinite(v) ? v.toFixed(dp) : "0.0";
}
function hbState(d) {
  if (!d || !d.has_budget) return { cls: "budget-row-amber", pctCls: "budget-pct-green", color: "var(--muted)", word: "No budget set" };
  if (d.over_budget) return { cls: "budget-row-red", pctCls: "budget-pct-red", color: "var(--danger)", word: "Over budget" };
  if (d.at_limit) return { cls: "budget-row-red", pctCls: "budget-pct-red", color: "var(--danger)", word: "At the limit" };
  if (Number(d.pct_used) >= 80) return { cls: "budget-row-yellow", pctCls: "budget-pct-yellow", color: "var(--warn)", word: "Near the limit" };
  return { cls: "budget-row-green", pctCls: "budget-pct-green", color: "var(--ok)", word: "On track" };
}
function hbMeCardHtml(d, withLink = false) {
  if (!d) return "";
  const link = withLink ? ` <button class="act-btn hb-open-budgets">Ask for more hours</button>` : "";
  if (!d.has_budget) {
    return `<div class="dash-emp-cards">
      <div class="dash-emp-card">
        <div class="dash-emp-card-value">No budget</div>
        <div class="dash-emp-card-label">Weekly hours</div>
      </div>
    </div>
    <p class="muted small">No weekly hour budget is set for you, so there is no cap and no lock.${link}</p>`;
  }
  const st = hbState(d);
  const left = d.over_budget ? `over by ${hbH(Math.abs(d.remaining_hours))}h` : `${hbH(d.remaining_hours)}h left`;
  return `<div class="dash-emp-cards">
    <div class="dash-emp-card">
      <div class="dash-emp-card-value">${hbH(d.effective_budget_hours)}h</div>
      <div class="dash-emp-card-label">Weekly budget</div>
    </div>
    <div class="dash-emp-card">
      <div class="dash-emp-card-value">${hbH(d.used_hours)}h</div>
      <div class="dash-emp-card-label">Counted this week</div>
    </div>
    <div class="dash-emp-card" style="border-color:${st.color}">
      <div class="dash-emp-card-value" style="color:${st.color}">${escapeHtml(left)}</div>
      <div class="dash-emp-card-label">${escapeHtml(st.word)}</div>
    </div>
  </div>
  <p class="muted small">Week of ${escapeHtml(d.week_start)} · only work hours count, breaks and leave do not.${link}</p>`;
}
async function renderMyHourBudget() {
  const out = document.querySelector("#hour-budget-out");
  if (!out) return;
  try {
    const d = await api("/hour-budget/me");
    HB.me = d;
    out.innerHTML = hbMeCardHtml(d, true);
    bindHbOpenButton(out);
  } catch (e) {
    HB.me = null;
    out.innerHTML = e && e.code === "migration_required" ? "" : `<p class="err">${escapeHtml(e.message)}</p>`;
  }
}
function bindHbOpenButton(root) {
  root.querySelectorAll(".hb-open-budgets").forEach((btn) => {
    btn.onclick = () => {
      tab("hour-budgets");
      loadHourBudgets();
    };
  });
}
function hbOverviewHtml(d) {
  const rows = d.staff || [];
  if (!rows.length) return '<p class="muted small">Nobody to show.</p>';
  const body = rows.map((r) => {
    const st = hbState(r);
    const budget = r.has_budget ? `${hbH(r.effective_budget_hours)}h` : "—";
    const used = `${hbH(r.used_hours)}h`;
    const left = !r.has_budget ? "—" : r.over_budget ? `over by ${hbH(Math.abs(r.remaining_hours))}h` : `${hbH(r.remaining_hours)}h left`;
    const pct = r.has_budget ? `${Math.round(Number(r.pct_used) || 0)}%` : "—";
    const granted = Number(r.granted_hours) > 0 ? `<span class="muted small">(+${hbH(r.granted_hours)}h granted)</span>` : "";
    const pending = r.has_pending_request ? ' <span class="muted small">· request pending</span>' : "";
    return `<tr class="${st.cls}">
      <td>${escapeHtml(r.name || r.email)}</td>
      <td class="num">${budget} ${granted}</td>
      <td class="num">${used}</td>
      <td class="num">${left}</td>
      <td class="num"><span class="budget-pct ${st.pctCls}">${pct}</span>${pending}</td>
      <td>${escapeHtml(st.word)}</td>
    </tr>`;
  }).join("");
  return `<h3>Budget against hours used — week of ${escapeHtml(d.week_start)}</h3>
    <p class="muted small">Every member of staff, for the week on screen. Hours against a budget — nothing else.</p>
    <table class="budget-table">
      <thead><tr><th>STAFF</th><th class="num">BUDGET</th><th class="num">COUNTED</th><th class="num">LEFT</th><th class="num">USED</th><th>STATE</th></tr></thead>
      <tbody>${body}</tbody>
    </table>`;
}
function hbQueueHtml(d) {
  const rows = d.requests || [];
  const pending = rows.filter((r) => r.status === "pending");
  const decided = rows.filter((r) => r.status !== "pending");
  const pendingHtml = pending.length ? `
    <h3>Pending requests (${pending.length})</h3>
    <p class="muted small">Approving grants extra hours for that week only and unlocks clock-in to the new total. Nobody approves their own request.</p>
    <table class="budget-table">
      <thead><tr><th>STAFF</th><th class="num">ASKED</th><th>REASON</th><th class="num">GRANT</th><th>NOTE</th><th></th></tr></thead>
      <tbody>
      ${pending.map((r) => `<tr>
        <td>${escapeHtml(r.user_display_name || r.user_email)}</td>
        <td class="num">${hbH(r.hours)}h</td>
        <td><span class="muted small">${escapeHtml(r.reason || "")}</span></td>
        <td class="num"><input type="number" min="0.25" step="0.25" id="hb-extra-${escapeHtml(r.id)}" value="${hbH(r.hours)}" style="width:90px" /></td>
        <td><input type="text" id="hb-note-${escapeHtml(r.id)}" placeholder="Note" /></td>
        <td>
          <button class="act-btn hb-approve" data-id="${escapeHtml(r.id)}">Approve</button>
          <button class="act-btn hb-deny" data-id="${escapeHtml(r.id)}">Deny</button>
        </td>
      </tr>`).join("")}
      </tbody>
    </table>` : '<p class="muted small">No pending requests for this week.</p>';
  const decidedHtml = decided.length ? `
    <h3>Decided</h3>
    <table class="budget-table">
      <thead><tr><th>STAFF</th><th class="num">ASKED</th><th class="num">GRANTED</th><th>STATUS</th><th>WHEN</th></tr></thead>
      <tbody>
      ${decided.map((r) => `<tr>
        <td>${escapeHtml(r.user_display_name || r.user_email)}</td>
        <td class="num">${hbH(r.hours)}h</td>
        <td class="num">${r.granted_hours === null || r.granted_hours === void 0 ? "—" : `${hbH(r.granted_hours)}h`}</td>
        <td>${escapeHtml(r.status)}</td>
        <td><span class="muted small">${escapeHtml(String(r.decided_at || "").slice(0, 16).replace("T", " "))}</span></td>
      </tr>`).join("")}
      </tbody>
    </table>` : "";
  return pendingHtml + decidedHtml;
}
function hbSetFormHtml(d) {
  const rows = d.staff || [];
  if (!rows.length) return "";
  const options = rows.map((r) => `<option value="${escapeHtml(r.user_id)}">${escapeHtml(r.name || r.email)}</option>`).join("");
  return `<h3>Set a budget</h3>
    <p class="muted small">A standing budget applies every week until it is changed. A budget for one week overrides it for that week only. Setting 0 removes the budget — no cap, no lock, no alerts.</p>
    <form id="hb-set-form" class="request-form">
      <select id="hb-set-user">${options}</select>
      <input type="number" id="hb-set-hours" min="0" step="0.25" placeholder="Hours (0 removes)" />
      <label class="muted small"><input type="checkbox" id="hb-set-standing" checked /> standing (every week)</label>
      <button type="submit" class="act-btn">Save budget</button>
    </form>`;
}
function bindHbSetForm() {
  const form = document.querySelector("#hb-set-form");
  if (!form) return;
  form.onsubmit = async (ev) => {
    ev.preventDefault();
    const userId = (document.querySelector("#hb-set-user") || {}).value;
    const hoursEl = document.querySelector("#hb-set-hours");
    const hours = Number(hoursEl && hoursEl.value);
    const standing = (document.querySelector("#hb-set-standing") || {}).checked;
    if (!userId) return;
    if (!Number.isFinite(hours) || hours < 0) {
      alert("Enter the number of hours (0 removes the budget).");
      return;
    }
    const body = { user_id: userId, budget_hours: hours };
    if (!standing) body.week_start = (document.querySelector("#hb-week") || {}).value || todayISO();
    try {
      await api("/hour-budget/budget", { method: "POST", body });
      if (hoursEl) hoursEl.value = "";
      await loadHourBudgets();
    } catch (e) {
      alert(e.message);
    }
  };
}
function bindHbQueue() {
  document.querySelectorAll(".hb-approve, .hb-deny").forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.dataset.id;
      const approve = btn.classList.contains("hb-approve");
      const extraEl = document.getElementById(`hb-extra-${id}`);
      const noteEl = document.getElementById(`hb-note-${id}`);
      const body = { decision: approve ? "approve" : "deny", note: (noteEl && noteEl.value || "").trim() };
      if (approve) {
        const extra = Number(extraEl && extraEl.value);
        if (!Number.isFinite(extra) || extra <= 0) {
          alert("Enter how many extra hours to grant.");
          return;
        }
        body.extra_hours = extra;
      }
      btn.disabled = true;
      try {
        await api(`/hour-budget/requests/${encodeURIComponent(id)}/decision`, { method: "POST", body });
        await loadHourBudgets();
      } catch (e) {
        alert(e.message);
        btn.disabled = false;
      }
    };
  });
}
function bindHbRequestForm() {
  const form = document.querySelector("#hb-request-form");
  if (!form) return;
  form.onsubmit = async (ev) => {
    ev.preventDefault();
    const errBox = document.querySelector("#hb-err");
    if (errBox) errBox.textContent = "";
    const hours = Number((document.querySelector("#hb-request-hours") || {}).value);
    const reason = ((document.querySelector("#hb-request-reason") || {}).value || "").trim();
    if (!Number.isFinite(hours) || hours <= 0) {
      if (errBox) errBox.textContent = "Enter how many extra hours you need.";
      return;
    }
    if (!reason) {
      if (errBox) errBox.textContent = "Say why you need more hours — an admin approves this by hand.";
      return;
    }
    const week = (document.querySelector("#hb-week") || {}).value || todayISO();
    try {
      await api("/hour-budget/request", { method: "POST", body: { week_start: week, hours, reason } });
      const hoursEl = document.querySelector("#hb-request-hours");
      const reasonEl = document.querySelector("#hb-request-reason");
      if (hoursEl) hoursEl.value = "";
      if (reasonEl) reasonEl.value = "";
      await loadHourBudgets();
    } catch (e) {
      if (errBox) errBox.textContent = e.message;
    }
  };
}
async function loadHourBudgets() {
  const isAdmin = ME.role === "admin";
  const isMgr = !!ME.manager;
  const errBox = document.querySelector("#hb-err");
  if (errBox) errBox.textContent = "";
  const week = hbWeekParam();
  const meOut = document.querySelector("#hb-me");
  if (meOut) {
    try {
      HB.me = await api(`/hour-budget/me?week_start=${week}`);
      meOut.innerHTML = hbMeCardHtml(HB.me);
    } catch (e) {
      HB.me = null;
      meOut.innerHTML = e && e.code === "migration_required" ? '<p class="muted small">Weekly hour budgets are not switched on yet.</p>' : `<p class="err">${escapeHtml(e.message)}</p>`;
    }
  }
  const ovOut = document.querySelector("#hb-overview");
  const setOut = document.querySelector("#hb-set");
  if (isAdmin || isMgr) {
    try {
      HB.overview = await api(`/hour-budget/overview?week_start=${week}`);
      if (ovOut) ovOut.innerHTML = hbOverviewHtml(HB.overview);
      if (isAdmin && setOut) {
        setOut.innerHTML = hbSetFormHtml(HB.overview);
        bindHbSetForm();
      } else if (setOut) setOut.innerHTML = "";
    } catch (e) {
      HB.overview = null;
      if (ovOut) {
        ovOut.innerHTML = e && e.code === "migration_required" ? '<p class="muted small">Weekly hour budgets are not switched on yet.</p>' : `<p class="err">${escapeHtml(e.message)}</p>`;
      }
      if (setOut) setOut.innerHTML = "";
    }
  } else {
    HB.overview = null;
    if (ovOut) ovOut.innerHTML = "";
    if (setOut) setOut.innerHTML = "";
  }
  const qOut = document.querySelector("#hb-queue");
  if (isAdmin) {
    try {
      HB.requests = await api(`/hour-budget/requests?week_start=${week}`);
      if (qOut) {
        qOut.innerHTML = hbQueueHtml(HB.requests);
        bindHbQueue();
      }
    } catch (e) {
      HB.requests = null;
      if (qOut) qOut.innerHTML = e && e.code === "migration_required" ? "" : `<p class="err">${escapeHtml(e.message)}</p>`;
    }
  } else {
    HB.requests = null;
    if (qOut) qOut.innerHTML = "";
  }
}
window.addEventListener("DOMContentLoaded", () => {
  const weekEl = document.querySelector("#hb-week");
  if (weekEl && !weekEl.value) weekEl.value = todayISO();
  if (weekEl) weekEl.onchange = () => loadHourBudgets();
  const refreshBtn = document.querySelector("#hb-refresh-btn");
  if (refreshBtn) refreshBtn.onclick = () => loadHourBudgets();
  bindHbRequestForm();
});
const THEME_KEY = "tt-theme";
function currentTheme() {
  try {
    return localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark";
  } catch (_) {
    return "dark";
  }
}
function applyTheme(theme) {
  const t = theme === "light" ? "light" : "dark";
  try {
    localStorage.setItem(THEME_KEY, t);
  } catch (_) {
  }
  if (t === "light") document.documentElement.setAttribute("data-theme", "light");
  else document.documentElement.removeAttribute("data-theme");
  const btn = $("#theme-btn");
  if (btn) {
    btn.innerHTML = ic(t === "light" ? "moon" : "sun");
    btn.setAttribute("aria-label", t === "light" ? "Switch to the dark theme" : "Switch to the light theme");
  }
}
function toggleTheme() {
  applyTheme(currentTheme() === "light" ? "dark" : "light");
}
function initialsOf(name) {
  const parts = String(name || "").trim().split(/[\s@._-]+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
function renderNavIcons() {
  $$("#nav a[data-icon]").forEach((a) => {
    if (a.querySelector("svg.i")) return;
    a.insertAdjacentHTML("afterbegin", ic(a.dataset.icon));
  });
}
function hideEmptyGroups(container) {
  if (!container) return;
  Array.from(container.children).forEach((g) => {
    if (!g.classList || !g.classList.contains("nav-grp")) return;
    let n = g.nextElementSibling;
    let visible = false;
    while (n && !(n.classList && n.classList.contains("nav-grp"))) {
      if (n.classList && n.classList.contains("tab") && n.style.display !== "none") {
        visible = true;
        break;
      }
      n = n.nextElementSibling;
    }
    g.style.display = visible ? "" : "none";
  });
}
function syncNav() {
  hideEmptyGroups($("#nav"));
  hideEmptyGroups($("#nav-registered"));
  renderNavIcons();
}
function setCrumb(name) {
  const el = $("#crumb-text");
  if (!el) return;
  let label = name || "";
  const item = $$("#nav a.tab").find((a) => a.dataset.tab === name);
  if (item) label = item.textContent.trim();
  el.textContent = label;
}
function openSide() {
  const side = $("#side");
  if (!side) return;
  side.classList.add("open");
  const b = $("#burger");
  if (b) b.setAttribute("aria-expanded", "true");
  if (!$(".side-scrim")) {
    const scrim = document.createElement("div");
    scrim.className = "side-scrim";
    scrim.addEventListener("click", closeSide);
    document.body.appendChild(scrim);
  }
}
function closeSide() {
  const side = $("#side");
  if (side) side.classList.remove("open");
  const b = $("#burger");
  if (b) b.setAttribute("aria-expanded", "false");
  const scrim = $(".side-scrim");
  if (scrim) scrim.remove();
}
const APP_VP = {
  views: {},
  order: [],
  register(view) {
    if (!view || !view.key || typeof view.mount !== "function") return;
    if (!this.views[view.key]) this.order.push(view.key);
    this.views[view.key] = view;
    this.render();
  },
  go(key) {
    onTabClick(key);
  },
  visible(view) {
    const role = ME && ME.role;
    if (view.adminOnly && role !== "admin") return false;
    if (view.managerOnly && role !== "admin" && tsIsManager() !== true) return false;
    if (role === "client" && !view.clientVisible) return false;
    return true;
  },
  render() {
    const host = $("#nav-registered");
    if (!host) return;
    const content = $("#main-content");
    const mine = this.order.map((k) => this.views[k]).filter((v) => v && this.visible(v));
    if (!mine.length) {
      host.innerHTML = "";
      return;
    }
    const groups = [];
    mine.forEach((v) => {
      const name = v.group || "More";
      let g = groups.find((x) => x.name === name);
      if (!g) {
        g = { name, items: [] };
        groups.push(g);
      }
      g.items.push(v);
    });
    host.innerHTML = groups.map((g) => '<div class="nav-grp eyebrow">' + escapeHtml(g.name) + "</div>" + g.items.map((v) => '<a href="#' + escapeHtml(v.key) + '" class="tab" data-tab="' + escapeHtml(v.key) + '" data-icon="' + escapeHtml(v.icon || "dash") + '">' + escapeHtml(v.label || v.key) + "</a>").join("")).join("");
    mine.forEach((v) => {
      if (!content) return;
      if (!document.getElementById("tab-" + v.key)) {
        const pane = document.createElement("div");
        pane.id = "tab-" + v.key;
        pane.className = "tabpane hidden";
        content.appendChild(pane);
      }
    });
    renderNavIcons();
    bindTabClicks();
    syncNav();
  }
};
window.APP_VP = APP_VP;
APP_VP.billingModelNames = BILLING_MODEL_NAMES;
async function loadVpFiles() {
  let names = [];
  try {
    const res = await fetch("./vp-screens.json", { cache: "no-cache" });
    if (!res.ok) return;
    const data = await res.json();
    if (data && Array.isArray(data.screens)) names = data.screens;
  } catch (_) {
  }
  for (const n of names) {
    try {
      const res = await fetch("./" + n, { cache: "no-cache" });
      if (!res.ok) continue;
      const code = await res.text();
      const s = document.createElement("script");
      s.textContent = code;
      document.head.appendChild(s);
    } catch (_) {
    }
  }
}
function onTabClick(name) {
  tab(name);
  if (name === "timesheets") loadTimesheets();
  if (name === "dashboard") loadDashboard();
  if (name === "log") loadEntries();
  if (name === "admin") {
    loadAdminUsers();
    loadWeightsPanel();
    loadAdminFeedback();
  }
  if (name === "invoices") loadInvoices();
  if (name === "reports") loadSummaryReport();
  if (name === "clients") loadClientsTab();
  if (name === "team") loadTeamTab();
  if (name === "assignments") loadAssignments();
  if (name === "requests") loadRequests();
  if (name === "hour-budgets") loadHourBudgets();
  if (name === "client-dashboard") loadClientDashboard();
  if (name === "client-activity") loadClientActivity(0);
  if (name === "client-invoices") loadClientInvoices(0);
}
function bindTabClicks() {
  $$(".tab").forEach((b) => {
    b.onclick = () => onTabClick(b.dataset.tab);
  });
}
document.addEventListener("click", (e) => {
  const link = e.target && e.target.closest && e.target.closest("a[data-goto]");
  if (!link) return;
  e.preventDefault();
  onTabClick(link.dataset.goto);
});
window.addEventListener("DOMContentLoaded", () => {
  applyTheme(currentTheme());
  renderNavIcons();
  syncNav();
  const burger = $("#burger");
  if (burger) {
    burger.innerHTML = ic("menu");
    burger.onclick = () => {
      const side = $("#side");
      if (side && side.classList.contains("open")) closeSide();
      else openSide();
    };
  }
  const themeBtn = $("#theme-btn");
  if (themeBtn) themeBtn.onclick = toggleTheme;
  const pillStop = $("#pill-stop");
  if (pillStop) {
    pillStop.innerHTML = ic("stop");
    pillStop.setAttribute("title", "Stop the timer");
    pillStop.onclick = handleTimerStop;
  }
  loadVpFiles().then(() => {
    if (window.APP_VP) window.APP_VP.render();
  });
});
