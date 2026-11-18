export const CLIENT_COLORS = [
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
const HEX = /^#[0-9a-fA-F]{6}$/;
export function isValidColor(v) {
  return typeof v === "string" && HEX.test(v);
}
export function normalizeColor(v) {
  return isValidColor(v) ? v.toUpperCase() : null;
}
export function pickUnusedColor(used) {
  const counts = new Map(CLIENT_COLORS.map((c) => [c, 0]));
  for (const u of used || []) {
    const n = normalizeColor(u);
    if (n && counts.has(n)) counts.set(n, counts.get(n) + 1);
  }
  let best = CLIENT_COLORS[0];
  for (const c of CLIENT_COLORS) if (counts.get(c) < counts.get(best)) best = c;
  return best;
}
