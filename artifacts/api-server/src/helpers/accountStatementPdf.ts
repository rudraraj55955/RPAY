import PDFDocument from "pdfkit";

export interface StatementEntry {
  id: number;
  createdAt: Date | string;
  txnType: string;
  typeLabel: string;
  referenceType: string | null;
  referenceId: number | null;
  description: string;
  credit: number | null;
  debit: number | null;
  availableAfter: number;
}

export interface AccountStatementData {
  merchant: { businessName: string; email: string; phone?: string | null };
  period: { from: Date; to: Date };
  openingBalance: number;
  closingBalance: number;
  totalCredits: number;
  totalDebits: number;
  totalDeposits: number;
  totalPayouts: number;
  totalCharges: number;
  totalRefunds: number;
  entries: StatementEntry[];
}

const C = {
  navy:       "#0f172a",
  navyLight:  "#1e293b",
  border:     "#334155",
  mutedText:  "#64748b",
  bodyText:   "#1e293b",
  white:      "#ffffff",
  accent:     "#3b82f6",
  green:      "#166534",
  greenBg:    "#f0fdf4",
  red:        "#991b1b",
  redBg:      "#fff1f2",
  altRow:     "#f8fafc",
};

function fmtInr(n: number) {
  return "Rs." + Math.abs(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(d: Date | string) {
  const dt = d instanceof Date ? d : new Date(d);
  return dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) +
    " " + dt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

export function buildAccountStatementPdf(data: AccountStatementData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ size: "A4", margin: 0, bufferPages: true });
    doc.on("data", c => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const W = 595.28;
    const margin = 32;
    const inner = W - margin * 2;

    // ── Header ──────────────────────────────────────────────────────────────
    doc.rect(0, 0, W, 64).fill(C.navy);
    doc.fillColor(C.white).fontSize(16).font("Helvetica-Bold")
       .text("RasoKart", margin, 20, { continued: true })
       .font("Helvetica").fontSize(10).fillColor("#94a3b8")
       .text("  Account Statement", { continued: false });
    doc.fillColor("#64748b").fontSize(8).font("Helvetica")
       .text(`Generated: ${new Date().toLocaleString("en-IN")}`, margin, 40, { width: inner, align: "left" });

    // ── Merchant Info Bar ────────────────────────────────────────────────────
    doc.rect(0, 64, W, 40).fill(C.navyLight);
    doc.fillColor(C.white).fontSize(10).font("Helvetica-Bold")
       .text(data.merchant.businessName || "—", margin, 74, { continued: true })
       .font("Helvetica").fontSize(8).fillColor("#94a3b8")
       .text(`   ${data.merchant.email}`, { continued: false });
    const periodStr = `${data.period.from.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })} — ${data.period.to.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}`;
    doc.fillColor("#64748b").fontSize(8).font("Helvetica")
       .text(`Period: ${periodStr}`, W - margin - 200, 74, { width: 200, align: "right" });

    let y = 116;

    // ── Summary Grid ─────────────────────────────────────────────────────────
    const summaryItems = [
      { label: "Opening Balance",  value: fmtInr(data.openingBalance), color: C.bodyText },
      { label: "Total Credits",    value: fmtInr(data.totalCredits),   color: C.green },
      { label: "Total Debits",     value: fmtInr(data.totalDebits),    color: C.red },
      { label: "Total Payouts",    value: fmtInr(data.totalPayouts),   color: C.red },
      { label: "Fees & Charges",   value: fmtInr(data.totalCharges),   color: C.mutedText },
      { label: "Closing Balance",  value: fmtInr(data.closingBalance), color: C.bodyText },
    ];

    const colW = inner / 3;
    const cardH = 52;
    const cols = 3;
    summaryItems.forEach((item, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = margin + col * colW;
      const cy = y + row * (cardH + 4);
      doc.rect(x, cy, colW - 4, cardH).fillAndStroke("#f8fafc", C.border).lineWidth(0.5);
      doc.fillColor(C.mutedText).fontSize(7).font("Helvetica")
         .text(item.label, x + 8, cy + 10, { width: colW - 20 });
      doc.fillColor(item.color).fontSize(12).font("Helvetica-Bold")
         .text(item.value, x + 8, cy + 24, { width: colW - 20 });
    });

    y += Math.ceil(summaryItems.length / cols) * (cardH + 4) + 16;

    // ── Table Header ─────────────────────────────────────────────────────────
    const colDefs = [
      { label: "Date / Time",    w: 88 },
      { label: "Type",           w: 90 },
      { label: "Reference",      w: 72 },
      { label: "Description",    w: 120 },
      { label: "Credit",         w: 52 },
      { label: "Debit",          w: 52 },
      { label: "Balance",        w: 57 },
    ];
    const totalW = colDefs.reduce((s, c) => s + c.w, 0);
    const scale = inner / totalW;
    const scaledCols = colDefs.map(c => ({ ...c, w: c.w * scale }));

    doc.rect(margin, y, inner, 18).fill(C.navyLight);
    let cx = margin;
    for (const col of scaledCols) {
      doc.fillColor(C.white).fontSize(7).font("Helvetica-Bold")
         .text(col.label, cx + 4, y + 5, { width: col.w - 8 });
      cx += col.w;
    }
    y += 18;

    // ── Table Rows ────────────────────────────────────────────────────────────
    const pageH = 841.89;
    const footerH = 40;

    for (let i = 0; i < data.entries.length; i++) {
      const e = data.entries[i];
      const rowH = 18;

      if (y + rowH + footerH > pageH) {
        doc.addPage({ size: "A4", margin: 0 });
        y = margin;
        // Re-draw table header on new page
        doc.rect(margin, y, inner, 18).fill(C.navyLight);
        cx = margin;
        for (const col of scaledCols) {
          doc.fillColor(C.white).fontSize(7).font("Helvetica-Bold")
             .text(col.label, cx + 4, y + 5, { width: col.w - 8 });
          cx += col.w;
        }
        y += 18;
      }

      const rowBg = i % 2 === 0 ? C.white : C.altRow;
      doc.rect(margin, y, inner, rowH).fill(rowBg);

      cx = margin;
      const cells = [
        fmtDate(e.createdAt),
        e.typeLabel,
        e.referenceId ? `${e.referenceType?.slice(0, 3) ?? ""}#${e.referenceId}` : "",
        truncate(e.description, 38),
        e.credit != null ? fmtInr(e.credit) : "",
        e.debit != null ? fmtInr(e.debit) : "",
        fmtInr(e.availableAfter),
      ];

      for (let ci = 0; ci < scaledCols.length; ci++) {
        const col = scaledCols[ci];
        let fg = C.bodyText;
        if (ci === 4 && e.credit != null) fg = C.green;
        if (ci === 5 && e.debit != null) fg = C.red;
        doc.fillColor(fg).fontSize(6.5).font(ci === 4 || ci === 5 ? "Helvetica-Bold" : "Helvetica")
           .text(cells[ci], cx + 4, y + 5, { width: col.w - 8, ellipsis: true });
        cx += col.w;
      }

      // Light border
      doc.moveTo(margin, y + rowH).lineTo(margin + inner, y + rowH)
         .strokeColor("#e2e8f0").lineWidth(0.3).stroke();
      y += rowH;
    }

    if (data.entries.length === 0) {
      doc.rect(margin, y, inner, 32).fill(C.altRow);
      doc.fillColor(C.mutedText).fontSize(9).font("Helvetica")
         .text("No transactions found in this date range.", margin, y + 11, { width: inner, align: "center" });
      y += 32;
    }

    // ── Footer ────────────────────────────────────────────────────────────────
    const totalPages = doc.bufferedPageRange().count;
    for (let pi = 0; pi < totalPages; pi++) {
      doc.switchToPage(pi);
      doc.rect(0, pageH - 32, W, 32).fill(C.navyLight);
      doc.fillColor("#64748b").fontSize(7).font("Helvetica")
         .text("System-generated RasoKart Account Statement — Confidential. This is not a tax invoice.", margin, pageH - 22, { width: inner - 60, align: "left" })
         .text(`Page ${pi + 1} of ${totalPages}`, margin, pageH - 22, { width: inner, align: "right" });
    }

    doc.end();
  });
}
