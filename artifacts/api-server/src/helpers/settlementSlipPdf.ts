import PDFDocument from "pdfkit";

export interface SettlementSlipData {
  id: number;
  merchantName: string;
  merchantEmail: string;
  status: string;
  requestedAmount: number;
  amount: number;
  currency: string;
  requestedNote?: string | null;
  adminRemark?: string | null;
  referenceNumber?: string | null;
  periodFrom?: string | null;
  periodTo?: string | null;
  transactionCount: number;
  createdAt: Date | string;
  processedAt?: Date | null;
  paidAt?: Date | null;
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
  amber:      "#92400e",
  amberBg:    "#fffbeb",
  red:        "#991b1b",
  redBg:      "#fff1f2",
};

function fmtInr(n: number) {
  return "Rs." + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const dt = d instanceof Date ? d : new Date(d);
  return dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) +
    " " + dt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
}

function statusLabel(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function statusColors(s: string): { bg: string; text: string } {
  if (s === "paid")       return { bg: C.greenBg,  text: C.green };
  if (s === "approved")   return { bg: C.greenBg,  text: C.green };
  if (s === "rejected")   return { bg: C.redBg,    text: C.red };
  if (s === "cancelled")  return { bg: C.redBg,    text: C.red };
  if (s === "processing") return { bg: C.amberBg,  text: C.amber };
  return { bg: "#f1f5f9", text: C.navy };
}

export function buildSettlementSlipPdf(data: SettlementSlipData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: "A4" });
    const chunks: Buffer[] = [];
    doc.on("data", c => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const W = doc.page.width - 100;

    // ── Header bar ──────────────────────────────────────────────────
    doc.rect(50, 50, W, 56).fill(C.navy);

    doc.fillColor(C.white).fontSize(18).font("Helvetica-Bold")
      .text("Settlement Slip", 66, 64, { width: W - 20 });

    doc.fillColor("#94a3b8").fontSize(9).font("Helvetica")
      .text("RasoKart Payment Gateway", 66, 86);

    // Generated + slip ID top-right
    doc.fillColor("#94a3b8").fontSize(8)
      .text(`Generated: ${fmtDate(new Date())}`, 50, 60, { width: W, align: "right" });
    doc.fillColor(C.white).fontSize(9).font("Helvetica-Bold")
      .text(`Slip #${data.id}`, 50, 74, { width: W, align: "right" });

    let y = 126;

    // ── Status badge row ─────────────────────────────────────────────
    const sc = statusColors(data.status);
    doc.roundedRect(50, y, 90, 20, 4).fill(sc.bg);
    doc.fillColor(sc.text).fontSize(10).font("Helvetica-Bold")
      .text(statusLabel(data.status), 50, y + 5, { width: 90, align: "center" });
    y += 30;

    // ── Two-column info block ────────────────────────────────────────
    const col1 = 50, col2 = 50 + W / 2 + 10;
    const colW = W / 2 - 15;

    function infoRow(label: string, value: string, x: number, yPos: number, wide = false): number {
      doc.fillColor(C.mutedText).fontSize(8).font("Helvetica")
        .text(label.toUpperCase(), x, yPos, { width: wide ? W : colW });
      doc.fillColor(C.bodyText).fontSize(10).font("Helvetica-Bold")
        .text(value, x, yPos + 11, { width: wide ? W : colW });
      return yPos + 30;
    }

    let y1 = y, y2 = y;
    y1 = infoRow("Merchant", data.merchantName, col1, y1, false);
    y2 = infoRow("Email", data.merchantEmail, col2, y2, false);
    y1 = infoRow("Settlement ID", `#${data.id}`, col1, y1, false);
    y2 = infoRow("Currency", data.currency, col2, y2, false);
    y1 = infoRow("Submitted", fmtDate(data.createdAt), col1, y1, false);
    y2 = infoRow("Paid On", fmtDate(data.paidAt), col2, y2, false);

    if (data.periodFrom || data.periodTo) {
      const period = [data.periodFrom, data.periodTo].filter(Boolean).join(" → ");
      y1 = infoRow("Settlement Period", period, col1, y1, false);
    }

    y = Math.max(y1, y2) + 6;

    // Divider
    doc.moveTo(50, y).lineTo(50 + W, y).lineWidth(0.5).strokeColor(C.border).stroke();
    y += 14;

    // ── Amount box ───────────────────────────────────────────────────
    doc.rect(50, y, W, 64).fill("#f8fafc");
    doc.rect(50, y, W, 64).lineWidth(0.5).strokeColor(C.border).stroke();

    doc.fillColor(C.mutedText).fontSize(8).font("Helvetica")
      .text("REQUESTED AMOUNT", 66, y + 10);
    doc.fillColor(C.navy).fontSize(22).font("Helvetica-Bold")
      .text(fmtInr(data.requestedAmount), 66, y + 22);

    if (Math.abs(data.amount - data.requestedAmount) > 0.001) {
      doc.fillColor(C.mutedText).fontSize(8).font("Helvetica")
        .text("APPROVED AMOUNT", col2, y + 10);
      doc.fillColor(C.green).fontSize(16).font("Helvetica-Bold")
        .text(fmtInr(data.amount), col2, y + 22);
    }

    if (data.transactionCount > 0) {
      doc.fillColor(C.mutedText).fontSize(8).font("Helvetica")
        .text("TRANSACTIONS COVERED", 66, y + 46);
      doc.fillColor(C.navy).fontSize(9).font("Helvetica-Bold")
        .text(String(data.transactionCount), 66 + 130, y + 46);
    }

    y += 80;

    // ── Reference number ─────────────────────────────────────────────
    if (data.referenceNumber) {
      doc.fillColor(C.mutedText).fontSize(8).font("Helvetica")
        .text("PAYMENT REFERENCE / UTR", 50, y);
      doc.fillColor(C.navy).fontSize(11).font("Helvetica-Bold")
        .text(data.referenceNumber, 50, y + 11, { width: W });
      y += 36;
    }

    // ── Notes & remarks ──────────────────────────────────────────────
    if (data.requestedNote) {
      doc.fillColor(C.mutedText).fontSize(8).font("Helvetica")
        .text("MERCHANT NOTE", 50, y);
      doc.fillColor(C.bodyText).fontSize(9).font("Helvetica")
        .text(data.requestedNote, 50, y + 11, { width: W });
      y += Math.max(28, 11 + doc.heightOfString(data.requestedNote, { width: W }) + 8);
    }

    if (data.adminRemark) {
      doc.fillColor(C.mutedText).fontSize(8).font("Helvetica")
        .text("ADMIN REMARK", 50, y);
      doc.fillColor(C.bodyText).fontSize(9).font("Helvetica")
        .text(data.adminRemark, 50, y + 11, { width: W });
      y += Math.max(28, 11 + doc.heightOfString(data.adminRemark, { width: W }) + 8);
    }

    // ── Footer ───────────────────────────────────────────────────────
    const footerY = doc.page.height - 60;
    doc.moveTo(50, footerY).lineTo(50 + W, footerY).lineWidth(0.5).strokeColor(C.border).stroke();
    doc.fillColor(C.mutedText).fontSize(8).font("Helvetica")
      .text("This document is system-generated. No signature required.", 50, footerY + 8, { width: W, align: "center" });
    doc.text("RasoKart — Payment Gateway", 50, footerY + 20, { width: W, align: "center" });

    doc.end();
  });
}
