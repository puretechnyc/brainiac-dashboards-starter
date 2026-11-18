(function(root) {
  "use strict";
  function normalizeTime(raw) {
    if (raw === null || raw === void 0) return { ok: true, value: "" };
    const s = String(raw).replace(/\s+/g, "");
    if (s === "") return { ok: true, value: "" };
    let h, m;
    if (s.indexOf(":") !== -1) {
      const parts = s.split(":");
      if (parts.length !== 2) return { ok: false };
      if (!/^\d{1,2}$/.test(parts[0]) || !/^\d{1,2}$/.test(parts[1])) return { ok: false };
      h = parseInt(parts[0], 10);
      m = parseInt(parts[1], 10);
    } else {
      if (!/^\d+$/.test(s)) return { ok: false };
      if (s.length <= 2) {
        h = parseInt(s, 10);
        m = 0;
      } else if (s.length === 3) {
        h = parseInt(s.slice(0, 1), 10);
        m = parseInt(s.slice(1), 10);
      } else if (s.length === 4) {
        h = parseInt(s.slice(0, 2), 10);
        m = parseInt(s.slice(2), 10);
      } else return { ok: false };
    }
    if (!Number.isInteger(h) || !Number.isInteger(m)) return { ok: false };
    if (h > 23 || m > 59) return { ok: false };
    return { ok: true, value: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}` };
  }
  function parseTimeToMinutes(raw) {
    const r = normalizeTime(raw);
    if (!r.ok || r.value === "") return null;
    const [h, m] = r.value.split(":").map(Number);
    return h * 60 + m;
  }
  const api = { normalizeTime, parseTimeToMinutes };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TTApp = api;
})(typeof self !== "undefined" ? self : this);
