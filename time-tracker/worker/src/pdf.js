import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
const LETTER = [612, 792];
const MARGIN = 40;
export function pdfText(s) {
  if (s == null) return "";
  const t = String(s).replace(/[‘’‚‛]/g, "'").replace(/[“”„‟]/g, '"').replace(/[–—―]/g, "-").replace(/…/g, "...").replace(/ /g, " ").replace(/₱/g, "PHP").replace(/€/g, "EUR");
  let out = "";
  for (const ch of t) {
    const c = ch.codePointAt(0);
    if (c === 9 || c === 10 || c === 13) {
      out += " ";
      continue;
    }
    if (c >= 32 && c <= 126 || c >= 160 && c <= 255) out += ch;
  }
  return out;
}
function line(page, font, text, x, y, size = 11, color = rgb(0.1, 0.1, 0.1)) {
  page.drawText(pdfText(text), { x, y, size, font, color });
  return y - (size + 5);
}
function money(cents, currency) {
  const n = (Number(cents || 0) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${currency || "USD"} ${n}`;
}
const STAFF_PDF_COLS = {
  date: MARGIN,
  client: MARGIN + 56,
  task: MARGIN + 180,
  hoursRight: MARGIN + 440,
  billable: MARGIN + 452
};
const STAFF_PDF_COLS_ADMIN = {
  date: MARGIN,
  employee: MARGIN + 52,
  client: MARGIN + 146,
  task: MARGIN + 246,
  hoursRight: MARGIN + 384,
  rateRight: MARGIN + 446,
  amountRight: MARGIN + 532
};
function two(n) {
  return Number(n || 0).toFixed(2);
}
export async function buildStaffReportPdf(payload = {}, opts = {}) {
  const totals = payload.totals || {};
  const rows = payload.rows || [];
  const excluded = payload.excluded || null;
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page = doc.addPage(LETTER);
  let y = LETTER[1] - MARGIN;
  y = line(page, bold, opts.title || "Time Tracker - time report", MARGIN, y, 18);
  const period = payload.period || {};
  y = line(
    page,
    font,
    `Period: ${period.from || "the beginning"} to ${period.to || "today"}`,
    MARGIN,
    y,
    11,
    rgb(0.4, 0.4, 0.4)
  );
  if (opts.scopeLabel) {
    y = line(page, font, opts.scopeLabel, MARGIN, y, 11, rgb(0.4, 0.4, 0.4));
  }
  const generated = String(payload.generated_at || "").replace("T", " ").slice(0, 16);
  if (generated) y = line(page, font, `Generated ${generated}`, MARGIN, y, 11, rgb(0.4, 0.4, 0.4));
  y -= 10;
  y = line(page, bold, "Totals", MARGIN, y, 12);
  y = line(
    page,
    font,
    `Total hours ${two(totals.total_hours)}   Billable ${two(totals.billable_hours)}   Non-billable ${two(totals.non_billable_hours)}   Entries ${Number(totals.entry_count || 0)}`,
    MARGIN,
    y,
    11
  );
  if (totals.billable_amount != null) {
    y = line(page, font, `Billable amount USD ${totals.billable_amount}`, MARGIN, y, 11);
  }
  if (excluded && excluded.entry_count) {
    const n = Number(excluded.client_count || 0);
    y = line(
      page,
      font,
      `Not counted: ${two(excluded.total_hours)} h on ${n} archived client${n === 1 ? "" : "s"} (a deleted client earns nothing)`,
      MARGIN,
      y,
      10,
      rgb(0.35, 0.35, 0.35)
    );
  }
  y -= 10;
  const cols = payload.columns || {};
  const adminFile = cols.employee === true || cols.money === true;
  const C = adminFile ? STAFF_PDF_COLS_ADMIN : STAFF_PDF_COLS;
  const header = () => {
    page.drawText("Date", { x: C.date, y, size: 9, font: bold });
    if (adminFile) page.drawText("Employee", { x: C.employee, y, size: 9, font: bold });
    page.drawText("Client", { x: C.client, y, size: 9, font: bold });
    page.drawText("Task", { x: C.task, y, size: 9, font: bold });
    const hw = bold.widthOfTextAtSize("Hours", 9);
    page.drawText("Hours", { x: C.hoursRight - hw, y, size: 9, font: bold });
    if (adminFile) {
      const rw = bold.widthOfTextAtSize("Rate", 9);
      page.drawText("Rate", { x: C.rateRight - rw, y, size: 9, font: bold });
      const aw = bold.widthOfTextAtSize("Amount", 9);
      page.drawText("Amount", { x: C.amountRight - aw, y, size: 9, font: bold });
    } else {
      page.drawText("Billable", { x: C.billable, y, size: 9, font: bold });
    }
    y -= 15;
  };
  header();
  for (const r of rows) {
    if (y < MARGIN + 30) {
      page = doc.addPage(LETTER);
      y = LETTER[1] - MARGIN;
      header();
    }
    const hours = two(r.hours);
    page.drawText(pdfText(String(r.date || "")).slice(0, 10), { x: C.date, y, size: 9, font });
    if (adminFile) {
      page.drawText(pdfText(r.employee_name || "").slice(0, 18), { x: C.employee, y, size: 9, font });
    }
    page.drawText(pdfText(r.client_name || "").slice(0, adminFile ? 20 : 26), { x: C.client, y, size: 9, font });
    page.drawText(pdfText(r.task || "").slice(0, adminFile ? 28 : 46), { x: C.task, y, size: 9, font });
    const hw = font.widthOfTextAtSize(hours, 9);
    page.drawText(hours, { x: C.hoursRight - hw, y, size: 9, font });
    if (adminFile) {
      const rate = r.billable ? Number(r.rate_cents || 0) > 0 ? `${money(r.rate_cents, "USD")}/hr` : "no rate" : "—";
      const rw = font.widthOfTextAtSize(rate, 9);
      page.drawText(rate, { x: C.rateRight - rw, y, size: 9, font });
      const amount = r.billable ? money(r.amount_cents, "USD") : "—";
      const aw = font.widthOfTextAtSize(amount, 9);
      page.drawText(amount, { x: C.amountRight - aw, y, size: 9, font });
    } else {
      page.drawText(r.billable ? "Billable" : "Not billable", { x: C.billable, y, size: 9, font });
    }
    y -= 13;
  }
  y -= 4;
  if (y < MARGIN + 40) {
    page = doc.addPage(LETTER);
    y = LETTER[1] - MARGIN;
  }
  y = line(
    page,
    bold,
    `Total ${two(totals.total_hours)} h over ${rows.length} row${rows.length === 1 ? "" : "s"}`,
    MARGIN,
    y,
    10
  );
  const rowsTotal = Number(payload.rows_total || 0);
  if (rowsTotal > rows.length) {
    y = line(
      page,
      font,
      `This file holds the first ${rows.length} of ${rowsTotal} entries. Narrow the range for the rest.`,
      MARGIN,
      y,
      10,
      rgb(0.35, 0.35, 0.35)
    );
  }
  return doc.save();
}
