import { useState } from "react";
import { useListLedgerEntries } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Wallet, TrendingUp, TrendingDown, ArrowUpRight, ArrowDownRight, RefreshCw, ChevronRight } from "lucide-react";

const TYPE_LABELS: Record<string, { label: string; color: string }> = {
  deposit:    { label: "Deposit",    color: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
  settlement: { label: "Settlement", color: "bg-rose-500/10 text-rose-400 border-rose-500/20" },
  adjustment: { label: "Adjustment", color: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
  fee:        { label: "Fee",        color: "bg-orange-500/10 text-orange-400 border-orange-500/20" },
  refund:     { label: "Refund",     color: "bg-sky-500/10 text-sky-400 border-sky-500/20" },
};

function fmt(v: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2 }).format(v);
}

function fmtDate(s: string) {
  return new Date(s).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const PAGE_SIZE = 50;

type Preset = "all" | "mtd" | "30d" | "7d" | "custom";

function getPresetDates(preset: Preset): { dateFrom: string; dateTo: string } {
  const now = new Date();
  if (preset === "mtd") {
    return { dateFrom: toDateStr(new Date(now.getFullYear(), now.getMonth(), 1)), dateTo: toDateStr(now) };
  }
  if (preset === "30d") {
    const from = new Date(now); from.setDate(from.getDate() - 30);
    return { dateFrom: toDateStr(from), dateTo: toDateStr(now) };
  }
  if (preset === "7d") {
    const from = new Date(now); from.setDate(from.getDate() - 7);
    return { dateFrom: toDateStr(from), dateTo: toDateStr(now) };
  }
  return { dateFrom: "", dateTo: "" };
}

export default function MerchantLedger() {
  const [type, setType] = useState("all");
  const [preset, setPreset] = useState<Preset>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);

  function applyPreset(p: Preset) {
    setPreset(p);
    setPage(1);
    if (p !== "custom") {
      const { dateFrom: f, dateTo: t } = getPresetDates(p);
      setDateFrom(f);
      setDateTo(t);
    }
  }

  const params = {
    type: type !== "all" ? type : undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    page,
    limit: PAGE_SIZE,
  };

  const { data, isLoading, refetch } = useListLedgerEntries(params);

  const entries = data?.data ?? [];
  const total = data?.total ?? 0;
  const currentBalance = data?.currentBalance ?? 0;
  const openingBalance = data?.openingBalance ?? 0;
  const closingBalance = data?.closingBalance ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  const PRESETS: { key: Preset; label: string }[] = [
    { key: "all",    label: "All Time" },
    { key: "mtd",    label: "This Month" },
    { key: "30d",    label: "Last 30 Days" },
    { key: "7d",     label: "Last 7 Days" },
    { key: "custom", label: "Custom" },
  ];

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Balance Ledger</h1>
          <p className="text-sm text-muted-foreground mt-1">Full audit trail of every balance-affecting event</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-2">
          <RefreshCw className="w-4 h-4" />
          Refresh
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-card border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <Wallet className="w-3.5 h-3.5" /> Current Balance
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xl font-bold text-foreground">{fmt(currentBalance)}</p>
          </CardContent>
        </Card>
        <Card className="bg-card border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">Opening Balance</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xl font-bold text-muted-foreground">{fmt(openingBalance)}</p>
          </CardContent>
        </Card>
        <Card className="bg-card border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">Closing Balance</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xl font-bold">{fmt(closingBalance)}</p>
          </CardContent>
        </Card>
        <Card className="bg-card border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <ChevronRight className="w-3.5 h-3.5" /> Net Movement
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className={`text-xl font-bold ${closingBalance - openingBalance >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
              {closingBalance - openingBalance >= 0 ? "+" : ""}{fmt(closingBalance - openingBalance)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card className="bg-card border-border/50">
        <CardContent className="pt-4 space-y-3">
          {/* Period presets */}
          <div className="flex flex-wrap gap-2">
            {PRESETS.map(p => (
              <Button
                key={p.key}
                variant={preset === p.key ? "default" : "outline"}
                size="sm"
                onClick={() => applyPreset(p.key)}
              >
                {p.label}
              </Button>
            ))}
          </div>
          {/* Filters row */}
          <div className="flex flex-wrap gap-3">
            <Select value={type} onValueChange={(v) => { setType(v); setPage(1); }}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="All types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="deposit">Deposit</SelectItem>
                <SelectItem value="settlement">Settlement</SelectItem>
                <SelectItem value="adjustment">Adjustment</SelectItem>
                <SelectItem value="fee">Fee</SelectItem>
                <SelectItem value="refund">Refund</SelectItem>
              </SelectContent>
            </Select>
            {(preset === "custom" || preset === "all") && (
              <>
                <Input
                  type="date"
                  value={dateFrom}
                  onChange={e => { setDateFrom(e.target.value); setPreset("custom"); setPage(1); }}
                  className="w-40"
                />
                <Input
                  type="date"
                  value={dateTo}
                  onChange={e => { setDateTo(e.target.value); setPreset("custom"); setPage(1); }}
                  className="w-40"
                />
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card className="bg-card border-border/50">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="border-border/50">
                <TableHead className="text-muted-foreground">#</TableHead>
                <TableHead className="text-muted-foreground">Type</TableHead>
                <TableHead className="text-muted-foreground">Description</TableHead>
                <TableHead className="text-muted-foreground text-right">Amount</TableHead>
                <TableHead className="text-muted-foreground text-right">Balance Before</TableHead>
                <TableHead className="text-muted-foreground text-right">Balance After</TableHead>
                <TableHead className="text-muted-foreground">Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-12 text-muted-foreground">Loading…</TableCell>
                </TableRow>
              ) : entries.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-12 text-muted-foreground">No ledger entries found</TableCell>
                </TableRow>
              ) : (
                entries.map(entry => {
                  const meta = TYPE_LABELS[entry.type] ?? { label: entry.type, color: "bg-muted text-muted-foreground border-border" };
                  const isCredit = entry.amount > 0;
                  return (
                    <TableRow key={entry.id} className="border-border/30 hover:bg-muted/30">
                      <TableCell className="text-muted-foreground text-sm">{entry.id}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-xs ${meta.color}`}>{meta.label}</Badge>
                      </TableCell>
                      <TableCell className="max-w-xs truncate text-sm text-foreground">{entry.description}</TableCell>
                      <TableCell className="text-right font-mono font-medium">
                        <span className={`flex items-center justify-end gap-1 ${isCredit ? "text-emerald-400" : "text-rose-400"}`}>
                          {isCredit ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                          {isCredit ? "+" : ""}{fmt(entry.amount)}
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-mono text-muted-foreground text-sm">{fmt(entry.balanceBefore)}</TableCell>
                      <TableCell className="text-right font-mono text-sm font-semibold">{fmt(entry.balanceAfter)}</TableCell>
                      <TableCell className="text-muted-foreground text-sm whitespace-nowrap">{fmtDate(entry.createdAt)}</TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>{total} entries</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Prev</Button>
            <span className="flex items-center px-2">Page {page} of {totalPages}</span>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
          </div>
        </div>
      )}
    </div>
  );
}
