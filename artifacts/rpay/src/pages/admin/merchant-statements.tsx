import { useState, useCallback } from "react";
import { format, subDays, startOfMonth, endOfMonth, subMonths } from "date-fns";
import { Download, FileText, RefreshCw, TrendingUp, TrendingDown, Wallet, ArrowUpRight, ArrowDownLeft, AlertCircle, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { useListMerchants } from "@workspace/api-client-react";

const TOKEN_KEY = "rasokart_token";

type StatementEntry = {
  id: number;
  createdAt: string;
  txnType: string;
  typeLabel: string;
  referenceType: string | null;
  referenceId: number | null;
  description: string;
  credit: number | null;
  debit: number | null;
  availableAfter: number;
};

type StatementData = {
  merchant: { businessName: string; email: string };
  openingBalance: number;
  closingBalance: number;
  totalCredits: number;
  totalDebits: number;
  totalDeposits: number;
  totalPayouts: number;
  totalCharges: number;
  totalRefunds: number;
  entries: StatementEntry[];
};

const PRESETS = [
  { key: "today",     label: "Today" },
  { key: "7d",        label: "Last 7 Days" },
  { key: "15d",       label: "Last 15 Days" },
  { key: "30d",       label: "Last 30 Days" },
  { key: "thisMonth", label: "This Month" },
  { key: "lastMonth", label: "Last Month" },
  { key: "custom",    label: "Custom" },
] as const;
type PresetKey = (typeof PRESETS)[number]["key"];

function presetDates(key: PresetKey) {
  const now = new Date();
  const fmt = (d: Date) => format(d, "yyyy-MM-dd");
  switch (key) {
    case "today":     return { from: fmt(now), to: fmt(now) };
    case "7d":        return { from: fmt(subDays(now, 7)), to: fmt(now) };
    case "15d":       return { from: fmt(subDays(now, 15)), to: fmt(now) };
    case "30d":       return { from: fmt(subDays(now, 30)), to: fmt(now) };
    case "thisMonth": return { from: fmt(startOfMonth(now)), to: fmt(endOfMonth(now)) };
    case "lastMonth": return { from: fmt(startOfMonth(subMonths(now, 1))), to: fmt(endOfMonth(subMonths(now, 1))) };
    case "custom":    return { from: fmt(subDays(now, 30)), to: fmt(now) };
  }
}

function fmtInr(n: number) {
  return "₹" + Math.abs(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function txnTypeVariant(t: string): "default" | "secondary" | "outline" | "destructive" {
  if (["pending_credit", "refund", "reversal", "manual_credit", "hold_released"].includes(t)) return "default";
  if (t === "settlement_transfer") return "secondary";
  if (["withdrawal_debit", "hold_created", "manual_debit"].includes(t)) return "destructive";
  return "outline";
}

const PAGE_SIZE = 25;

export default function AdminMerchantStatements() {
  const [preset, setPreset] = useState<PresetKey>("30d");
  const [from, setFrom] = useState(() => presetDates("30d").from);
  const [to, setTo]     = useState(() => presetDates("30d").to);
  const [merchantSearch, setMerchantSearch] = useState("");
  const [selectedMerchantId, setSelectedMerchantId] = useState<number | null>(null);
  const [selectedMerchantName, setSelectedMerchantName] = useState("");
  const [data, setData] = useState<StatementData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [downloading, setDownloading] = useState(false);
  const [exporting, setExporting] = useState(false);

  const { data: merchantsData } = useListMerchants({ search: merchantSearch || undefined, limit: 20 });
  const merchants = merchantsData?.data ?? [];

  const fetchStatement = useCallback(async (merchantId: number, f: string, t: string) => {
    setLoading(true); setError(null);
    try {
      const token = localStorage.getItem(TOKEN_KEY);
      const res = await fetch(`/api/account-statement/admin?merchantId=${merchantId}&from=${f}&to=${t}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error((j as any).error ?? "Failed to load statement");
      }
      setData(await res.json());
      setPage(1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  const applyPreset = (key: PresetKey) => {
    setPreset(key);
    if (key !== "custom") {
      const { from: f, to: t } = presetDates(key);
      setFrom(f); setTo(t);
      if (selectedMerchantId) fetchStatement(selectedMerchantId, f, t);
    }
  };

  const handleMerchantSelect = (id: number, name: string) => {
    setSelectedMerchantId(id);
    setSelectedMerchantName(name);
    setMerchantSearch(name);
    fetchStatement(id, from, to);
  };

  const downloadPdf = async () => {
    if (!selectedMerchantId) { toast.error("Select a merchant first"); return; }
    setDownloading(true);
    try {
      const token = localStorage.getItem(TOKEN_KEY);
      const res = await fetch(`/api/account-statement/admin/pdf?merchantId=${selectedMerchantId}&from=${from}&to=${to}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error("Failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url;
      a.download = `rasokart-statement-${selectedMerchantId}-${from}-${to}.pdf`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch { toast.error("Unable to download PDF. Please try again."); }
    finally { setDownloading(false); }
  };

  const exportCsv = async () => {
    if (!selectedMerchantId) { toast.error("Select a merchant first"); return; }
    setExporting(true);
    try {
      const token = localStorage.getItem(TOKEN_KEY);
      const res = await fetch(`/api/account-statement/admin?merchantId=${selectedMerchantId}&from=${from}&to=${to}&format=csv`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error("Failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url;
      a.download = `rasokart-statement-${selectedMerchantId}-${from}-${to}.csv`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("CSV exported");
    } catch { toast.error("Unable to export CSV. Please try again."); }
    finally { setExporting(false); }
  };

  const paged = data ? data.entries.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) : [];
  const totalPages = data ? Math.ceil(data.entries.length / PAGE_SIZE) : 0;
  const showDropdown = merchantSearch && merchants.length > 0 && !selectedMerchantId;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Merchant Statements</h1>
          <p className="text-muted-foreground mt-1">Account statements for any merchant</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={!data || exporting}>
            {exporting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <FileText className="w-4 h-4 mr-2" />}
            Export CSV
          </Button>
          <Button size="sm" onClick={downloadPdf} disabled={!selectedMerchantId || downloading}>
            {downloading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
            Download PDF
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card className="border-border/50 bg-card/50">
        <CardContent className="pt-4 pb-4 space-y-4">
          {/* Merchant search */}
          <div className="relative">
            <Label className="text-xs mb-1 block">Merchant</Label>
            <div className="relative">
              <Search className="absolute left-2.5 top-2 w-4 h-4 text-muted-foreground" />
              <Input
                className="pl-8 h-8 text-sm"
                placeholder="Search merchants…"
                value={merchantSearch}
                onChange={e => {
                  setMerchantSearch(e.target.value);
                  if (selectedMerchantId && e.target.value !== selectedMerchantName) {
                    setSelectedMerchantId(null);
                    setData(null);
                  }
                }}
              />
            </div>
            {showDropdown && (
              <div className="absolute z-50 mt-1 w-full rounded-md border border-border bg-popover shadow-lg max-h-48 overflow-y-auto">
                {merchants.map((m: any) => (
                  <button
                    key={m.id}
                    className="w-full flex items-start gap-2 px-3 py-2 text-left hover:bg-muted/50 text-sm"
                    onClick={() => handleMerchantSelect(m.id, m.businessName)}
                  >
                    <div>
                      <p className="font-medium text-foreground">{m.businessName}</p>
                      <p className="text-[11px] text-muted-foreground">{m.email}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Date presets */}
          <div>
            <Label className="text-xs mb-1 block">Date Range</Label>
            <div className="flex flex-wrap gap-2">
              {PRESETS.map(p => (
                <Button key={p.key} size="sm" variant={preset === p.key ? "default" : "outline"} onClick={() => applyPreset(p.key)} className="h-7 text-xs">
                  {p.label}
                </Button>
              ))}
            </div>
            {preset === "custom" && (
              <div className="flex flex-wrap items-end gap-3 mt-3">
                <div className="space-y-1">
                  <Label className="text-xs">From</Label>
                  <Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="h-8 w-36 text-sm" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">To</Label>
                  <Input type="date" value={to} onChange={e => setTo(e.target.value)} className="h-8 w-36 text-sm" />
                </div>
                <Button size="sm" className="h-8" disabled={!selectedMerchantId || loading}
                  onClick={() => { if (selectedMerchantId) fetchStatement(selectedMerchantId, from, to); }}>
                  {loading ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-1" />}
                  Apply
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {!selectedMerchantId && !loading && (
        <div className="text-center text-muted-foreground py-12 text-sm">
          Search and select a merchant above to view their account statement.
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertCircle className="w-4 h-4 shrink-0" /><span>{error}</span>
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-16 text-muted-foreground gap-3">
          <Loader2 className="w-5 h-5 animate-spin" /><span>Loading statement…</span>
        </div>
      )}

      {data && !loading && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {[
              { label: "Opening Balance", value: data.openingBalance, icon: Wallet,        color: "text-foreground" },
              { label: "Total Deposits",  value: data.totalDeposits,  icon: ArrowDownLeft, color: "text-emerald-400" },
              { label: "Total Credits",   value: data.totalCredits,   icon: TrendingUp,    color: "text-emerald-400" },
              { label: "Total Debits",    value: data.totalDebits,    icon: TrendingDown,  color: "text-rose-400" },
              { label: "Fees & Charges",  value: data.totalCharges,   icon: ArrowUpRight,  color: "text-amber-400" },
              { label: "Closing Balance", value: data.closingBalance, icon: Wallet,        color: "text-primary" },
            ].map(item => (
              <Card key={item.label} className="border-border/50 bg-card/50">
                <CardContent className="pt-4 pb-3">
                  <div className="flex items-center gap-2 mb-2">
                    <item.icon className={`w-4 h-4 ${item.color}`} />
                    <p className="text-[11px] text-muted-foreground leading-none">{item.label}</p>
                  </div>
                  <p className={`text-lg font-bold font-mono ${item.color}`}>{fmtInr(item.value)}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card className="border-border/50 bg-card/50">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-semibold">
                  Ledger — {data.merchant.businessName}
                </CardTitle>
                <span className="text-xs text-muted-foreground">{data.entries.length} entries</span>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-border/50">
                      <TableHead className="text-xs w-36">Date / Time</TableHead>
                      <TableHead className="text-xs w-32">Type</TableHead>
                      <TableHead className="text-xs w-24">Reference</TableHead>
                      <TableHead className="text-xs">Description</TableHead>
                      <TableHead className="text-xs text-right w-28">Credit</TableHead>
                      <TableHead className="text-xs text-right w-28">Debit</TableHead>
                      <TableHead className="text-xs text-right w-28">Balance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paged.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center text-muted-foreground py-12 text-sm">
                          No transactions found.
                        </TableCell>
                      </TableRow>
                    )}
                    {paged.map(entry => (
                      <TableRow key={entry.id} className="border-border/30 hover:bg-muted/20">
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {new Date(entry.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}{" "}
                          {new Date(entry.createdAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true })}
                        </TableCell>
                        <TableCell>
                          <Badge variant={txnTypeVariant(entry.txnType)} className="text-[10px] whitespace-nowrap">
                            {entry.typeLabel}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs font-mono text-muted-foreground">
                          {entry.referenceId ? `${entry.referenceType?.slice(0, 4) ?? ""}#${entry.referenceId}` : "—"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-xs truncate">{entry.description}</TableCell>
                        <TableCell className="text-right text-xs font-mono">
                          {entry.credit != null ? <span className="text-emerald-400 font-semibold">+{fmtInr(entry.credit)}</span> : "—"}
                        </TableCell>
                        <TableCell className="text-right text-xs font-mono">
                          {entry.debit != null ? <span className="text-rose-400 font-semibold">−{fmtInr(entry.debit)}</span> : "—"}
                        </TableCell>
                        <TableCell className="text-right text-xs font-mono font-semibold">
                          {fmtInr(entry.availableAfter)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {totalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-border/40">
                  <span className="text-xs text-muted-foreground">Page {page} of {totalPages}</span>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" className="h-7 text-xs" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
                    <Button variant="outline" size="sm" className="h-7 text-xs" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
