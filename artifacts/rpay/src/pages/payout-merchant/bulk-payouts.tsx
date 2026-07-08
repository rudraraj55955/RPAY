import { useState, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { getToken } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Upload, FileText, CheckCircle2, XCircle, AlertCircle, Download } from "lucide-react";
import { toast } from "sonner";

async function apiFetch<T>(url: string, opts?: RequestInit): Promise<T> {
  const token = getToken();
  const res = await fetch(url, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(opts?.headers ?? {}) },
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error((e as any).error ?? "Request failed"); }
  return res.json();
}

interface BulkRow {
  idx: number;
  payoutMode: string;
  accountHolder?: string;
  bankAccount?: string;
  ifscCode?: string;
  bankName?: string;
  upiId?: string;
  amount: number;
  remarks?: string;
  status: "pending" | "success" | "error";
  error?: string;
}

function parseCsv(text: string): BulkRow[] {
  const lines = text.trim().split("\n").filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map(h => h.trim().toLowerCase());
  return lines.slice(1).map((line, idx) => {
    const cols = line.split(",").map(c => c.trim());
    const get = (h: string) => cols[headers.indexOf(h)] ?? "";
    const mode = (get("mode") || get("payoutmode") || "IMPS").toUpperCase();
    return {
      idx,
      payoutMode: mode,
      accountHolder: get("accountholder") || get("account_holder") || get("name") || undefined,
      bankAccount: get("bankaccount") || get("bank_account") || get("account") || undefined,
      ifscCode: get("ifsc") || get("ifsccode") || undefined,
      bankName: get("bankname") || get("bank_name") || undefined,
      upiId: get("upiid") || get("upi_id") || get("upi") || undefined,
      amount: Number(get("amount") || "0"),
      remarks: get("remarks") || get("note") || undefined,
      status: "pending" as const,
    };
  }).filter(r => r.amount > 0);
}

const SAMPLE_CSV = `mode,accountHolder,bankAccount,ifscCode,bankName,amount,remarks
IMPS,John Smith,50100123456789,HDFC0001234,HDFC Bank,1000,Salary
UPI,,,,,500,Bonus
UPI,Jane Doe,,,,750,Incentive
NEFT,Alice Kumar,012345678901234,ICIC0001234,ICICI Bank,2500,Commission`;

function downloadSample() {
  const blob = new Blob([SAMPLE_CSV], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "bulk-payouts-template.csv";
  a.click();
}

export default function PayoutMerchantBulkPayouts() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<BulkRow[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const parsed = parseCsv(text);
      if (parsed.length === 0) { toast.error("No valid rows found. Check the CSV format."); return; }
      setRows(parsed);
      setDone(false);
    };
    reader.readAsText(file);
  };

  const handleSubmit = async () => {
    if (rows.length === 0) return;
    const validRows = rows.filter(r => r.status === "pending");
    if (validRows.length === 0) { toast.error("No pending rows to submit"); return; }
    setSubmitting(true);

    const updated = [...rows];
    for (const row of validRows) {
      try {
        await apiFetch<any>("/api/withdrawals", {
          method: "POST",
          body: JSON.stringify({
            amount: row.amount,
            payoutMode: row.payoutMode,
            accountHolder: row.accountHolder,
            bankAccount: row.bankAccount,
            ifscCode: row.ifscCode,
            bankName: row.bankName,
            upiId: row.upiId,
            remarks: row.remarks,
          }),
        });
        updated[row.idx] = { ...updated[row.idx], status: "success" };
      } catch (err: any) {
        updated[row.idx] = { ...updated[row.idx], status: "error", error: err.message ?? "Failed" };
      }
      setRows([...updated]);
    }
    setSubmitting(false);
    setDone(true);
    qc.invalidateQueries({ queryKey: ["payout-merchant-payouts"] });
    qc.invalidateQueries({ queryKey: ["payout-merchant-stats"] });
    qc.invalidateQueries({ queryKey: ["payout-merchant-wallet"] });
    const succeeded = updated.filter(r => r.status === "success").length;
    const failed = updated.filter(r => r.status === "error").length;
    toast.success(`${succeeded} payouts submitted${failed > 0 ? `, ${failed} failed` : ""}`);
  };

  const successCount = rows.filter(r => r.status === "success").length;
  const errorCount = rows.filter(r => r.status === "error").length;
  const totalAmount = rows.filter(r => r.status !== "error").reduce((s, r) => s + r.amount, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Bulk Payouts</h1>
        <p className="text-sm text-muted-foreground mt-1">Upload a CSV to send multiple payouts at once</p>
      </div>

      {rows.length === 0 ? (
        <Card className="bg-card border-border/50">
          <CardContent className="p-8 text-center">
            <Upload className="w-10 h-10 text-muted-foreground/40 mx-auto mb-4" />
            <p className="text-sm font-medium text-foreground mb-1">Upload a CSV file</p>
            <p className="text-xs text-muted-foreground mb-6 max-w-sm mx-auto">
              Required columns: <span className="font-mono text-primary">mode, amount</span>. For bank transfers also include accountHolder, bankAccount, ifscCode. For UPI include upiId.
            </p>
            <div className="flex items-center justify-center gap-3 flex-wrap">
              <Button onClick={() => fileRef.current?.click()} className="gap-2">
                <Upload className="w-4 h-4" /> Choose CSV File
              </Button>
              <Button variant="outline" onClick={downloadSample} className="gap-2">
                <Download className="w-4 h-4" /> Download Template
              </Button>
            </div>
            <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleFile} />
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <Card className="bg-card border-border/50"><CardContent className="p-4">
              <p className="text-xs text-muted-foreground mb-1">Total Rows</p>
              <p className="text-2xl font-bold text-foreground">{rows.length}</p>
            </CardContent></Card>
            <Card className="bg-card border-border/50"><CardContent className="p-4">
              <p className="text-xs text-muted-foreground mb-1">Total Amount</p>
              <p className="text-2xl font-bold text-foreground">₹{totalAmount.toLocaleString("en-IN")}</p>
            </CardContent></Card>
            <Card className="bg-card border-border/50"><CardContent className="p-4">
              <p className="text-xs text-muted-foreground mb-1">Submitted</p>
              <p className="text-2xl font-bold text-emerald-400">{successCount}</p>
            </CardContent></Card>
            <Card className="bg-card border-border/50"><CardContent className="p-4">
              <p className="text-xs text-muted-foreground mb-1">Failed</p>
              <p className="text-2xl font-bold text-red-400">{errorCount}</p>
            </CardContent></Card>
          </div>

          {/* Preview table */}
          <Card className="bg-card border-border/50">
            <CardHeader className="flex flex-row items-center justify-between px-4 py-3 border-b border-border/40">
              <CardTitle className="text-sm font-semibold">Preview ({rows.length} rows)</CardTitle>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => { setRows([]); setDone(false); if (fileRef.current) fileRef.current.value = ""; }}>
                  Clear
                </Button>
                {!done && (
                  <Button size="sm" onClick={handleSubmit} disabled={submitting} className="gap-2">
                    {submitting ? <Spinner className="w-3 h-3" /> : null}
                    Submit All
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="border-b border-border/40">
                  <tr className="text-muted-foreground">
                    <th className="text-left px-4 py-2 font-medium">#</th>
                    <th className="text-left px-4 py-2 font-medium">Mode</th>
                    <th className="text-left px-4 py-2 font-medium">Recipient</th>
                    <th className="text-left px-4 py-2 font-medium">Account / UPI</th>
                    <th className="text-right px-4 py-2 font-medium">Amount</th>
                    <th className="text-left px-4 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/30">
                  {rows.map((r) => (
                    <tr key={r.idx} className="hover:bg-muted/5 transition-colors">
                      <td className="px-4 py-2 text-muted-foreground">{r.idx + 1}</td>
                      <td className="px-4 py-2"><Badge variant="outline" className="text-[10px] border border-border">{r.payoutMode}</Badge></td>
                      <td className="px-4 py-2 text-foreground">{r.accountHolder ?? r.upiId ?? "—"}</td>
                      <td className="px-4 py-2 text-muted-foreground font-mono">{r.bankAccount ? `${r.bankAccount} / ${r.ifscCode}` : r.upiId ?? "—"}</td>
                      <td className="px-4 py-2 text-right font-semibold text-foreground">₹{r.amount.toLocaleString("en-IN")}</td>
                      <td className="px-4 py-2">
                        {r.status === "pending" && <Badge variant="outline" className="text-[10px] border border-border text-muted-foreground">Pending</Badge>}
                        {r.status === "success" && <Badge variant="outline" className="text-[10px] border bg-emerald-500/15 text-emerald-400 border-emerald-500/30 gap-1"><CheckCircle2 className="w-2.5 h-2.5" />Submitted</Badge>}
                        {r.status === "error" && (
                          <div>
                            <Badge variant="outline" className="text-[10px] border bg-red-500/15 text-red-400 border-red-500/30 gap-1"><XCircle className="w-2.5 h-2.5" />Failed</Badge>
                            {r.error && <p className="text-[10px] text-red-400/70 mt-0.5 max-w-[200px] truncate">{r.error}</p>}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
