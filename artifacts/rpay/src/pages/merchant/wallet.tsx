import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Wallet, TrendingUp, TrendingDown, Lock, ArrowUpRight, ArrowDownLeft, ChevronLeft, ChevronRight, FileDown, RotateCcw, Landmark } from "lucide-react";
import { format } from "date-fns";

function getToken() { return localStorage.getItem("rasokart_token") ?? ""; }
async function apiGet(path: string) {
  const r = await fetch(`/api${path}`, { headers: { Authorization: `Bearer ${getToken()}` } });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

const INR = (v: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2 }).format(v);
const fmtDate = (s: string) => format(new Date(s), "dd MMM yyyy, HH:mm");

type MerchantWallet = {
  merchantId: number;
  currency: string;
  availableBalance: number;
  pendingBalance: number;
  holdBalance: number;
  settlementBalance: number;
  payoutBalance: number;
  totalCollection: number;
  totalPayout: number;
  totalCharges: number;
  totalRefunds: number;
  totalReversals: number;
  updatedAt: string;
};

type LedgerEntry = {
  id: number;
  txnType: string;
  bucket: string;
  amount: number;
  availableBefore: number;
  availableAfter: number;
  pendingBefore: number;
  pendingAfter: number;
  description: string;
  createdAt: string;
};

const TXN_META: Record<string, { label: string; icon: React.ComponentType<{ className?: string }>; color: string }> = {
  pending_credit:      { label: "Payment Received",  icon: TrendingUp,    color: "text-emerald-400" },
  settlement_transfer: { label: "Settlement",         icon: ArrowDownLeft, color: "text-sky-400" },
  withdrawal_debit:    { label: "Payout",              icon: ArrowUpRight,  color: "text-rose-400" },
  reversal:            { label: "Reversal",           icon: RotateCcw,     color: "text-amber-400" },
  hold_created:        { label: "Hold Applied",       icon: Lock,          color: "text-orange-400" },
  hold_released:       { label: "Hold Released",      icon: Lock,          color: "text-teal-400" },
  charge:              { label: "Charge",             icon: TrendingDown,  color: "text-rose-400" },
  refund:              { label: "Refund",             icon: RotateCcw,     color: "text-sky-400" },
  manual_credit:       { label: "Credit",             icon: TrendingUp,    color: "text-emerald-400" },
  manual_debit:        { label: "Debit",              icon: TrendingDown,  color: "text-rose-400" },
};

function buildCsv(rows: LedgerEntry[]): string {
  const lines = [["#", "Type", "Description", "Amount", "Available After", "Pending After", "Date"].join(",")];
  rows.forEach(e => lines.push([
    String(e.id), e.txnType, `"${e.description.replace(/"/g, '""')}"`,
    String(e.amount), String(e.availableAfter), String(e.pendingAfter), e.createdAt,
  ].join(",")));
  return lines.join("\n");
}

const LIMIT = 50;

export default function MerchantWallet() {
  const [page, setPage] = useState(1);
  const [txnType, setTxnType] = useState("all");

  const { data: wallet, isLoading: walletLoading } = useQuery<MerchantWallet>({
    queryKey: ["merchant-wallet"],
    queryFn: () => apiGet("/wallets/me"),
  });

  const { data: ledgerData, isLoading: ledgerLoading } = useQuery<{ data: LedgerEntry[]; total: number }>({
    queryKey: ["merchant-wallet-ledger", page, txnType],
    queryFn: () => apiGet(`/wallets/me/ledger?page=${page}&limit=${LIMIT}&txnType=${txnType}`),
  });

  const ledgerRows = ledgerData?.data ?? [];
  const ledgerTotal = ledgerData?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(ledgerTotal / LIMIT));

  function downloadCsv() {
    const csv = buildCsv(ledgerRows);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `rasokart-wallet-ledger-${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  const primaryCards = [
    { label: "Available Balance",  value: wallet?.availableBalance  ?? 0, icon: Wallet,      color: "text-emerald-400", desc: "Ready for payout" },
    { label: "Pending Balance",    value: wallet?.pendingBalance    ?? 0, icon: TrendingUp,  color: "text-amber-400",  desc: "Awaiting settlement" },
    { label: "On Hold",            value: wallet?.holdBalance       ?? 0, icon: Lock,        color: "text-orange-400", desc: "Temporarily locked" },
    { label: "Settlement Balance", value: wallet?.settlementBalance ?? 0, icon: ArrowDownLeft, color: "text-sky-400", desc: "In settlement process" },
    { label: "Payout Balance",     value: wallet?.payoutBalance     ?? 0, icon: ArrowUpRight, color: "text-violet-400", desc: "Being disbursed" },
  ];

  const statCards = [
    { label: "Total Collection",  value: wallet?.totalCollection ?? 0, icon: TrendingUp,   color: "text-emerald-300" },
    { label: "Total Payout",      value: wallet?.totalPayout     ?? 0, icon: TrendingDown, color: "text-rose-300" },
    { label: "Total Charges",     value: wallet?.totalCharges    ?? 0, icon: Landmark,     color: "text-orange-300" },
    { label: "Total Refunds",     value: wallet?.totalRefunds    ?? 0, icon: RotateCcw,    color: "text-sky-300" },
    { label: "Total Reversals",   value: wallet?.totalReversals  ?? 0, icon: RotateCcw,    color: "text-violet-300" },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">My Wallet</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            {wallet ? `Last updated: ${fmtDate(wallet.updatedAt)}` : "Real-time wallet balances and transaction history"}
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/merchant/payouts">
            <Button size="sm" variant="outline" className="gap-1.5 border-border/60">
              <ArrowUpRight className="w-3.5 h-3.5" />Request Payout
            </Button>
          </Link>
          <Link href="/merchant/settlements">
            <Button size="sm" variant="outline" className="gap-1.5 border-border/60">
              <Landmark className="w-3.5 h-3.5" />Settlements
            </Button>
          </Link>
        </div>
      </div>

      {/* Primary balance cards */}
      {walletLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Card key={i} className="border-border/60 bg-card animate-pulse"><CardContent className="p-4 h-20" /></Card>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {primaryCards.map(c => (
            <Card key={c.label} className="border-border/60 bg-card hover:bg-card/80 transition-colors">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <c.icon className={`w-4 h-4 ${c.color}`} />
                  <p className="text-xs text-muted-foreground">{c.label}</p>
                </div>
                <p className={`text-lg font-bold ${c.color}`}>{INR(c.value)}</p>
                <p className="text-[11px] text-muted-foreground/70 mt-0.5">{c.desc}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {statCards.map(c => (
          <Card key={c.label} className="border-border/40 bg-card/50">
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground mb-1">{c.label}</p>
              <p className={`text-base font-bold ${c.color}`}>{INR(c.value)}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Ledger */}
      <Card className="border-border/60 bg-card">
        <CardHeader className="py-3 px-4 border-b border-border/40 flex flex-row items-center justify-between">
          <span className="text-sm font-medium text-foreground">Wallet Ledger</span>
          <div className="flex items-center gap-2">
            <Select value={txnType} onValueChange={v => { setTxnType(v); setPage(1); }}>
              <SelectTrigger className="h-8 w-[160px] border-border/60 bg-background text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Transactions</SelectItem>
                {Object.entries(TXN_META).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" variant="outline" className="h-8 gap-1.5 border-border/60 text-xs" onClick={downloadCsv} disabled={ledgerRows.length === 0}>
              <FileDown className="w-3.5 h-3.5" />Export
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent border-b border-border/40">
                {["Type", "Description", "Amount", "Available Balance", "Date"].map(h => (
                  <TableHead key={h} className="text-xs text-muted-foreground py-2">{h}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {ledgerLoading ? (
                <TableRow><TableCell colSpan={5} className="text-center py-10 text-muted-foreground text-sm">Loading…</TableCell></TableRow>
              ) : ledgerRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-10">
                    <p className="text-muted-foreground text-sm">No transactions yet</p>
                    <p className="text-muted-foreground/60 text-xs mt-1">Wallet entries appear here once you start accepting payments</p>
                  </TableCell>
                </TableRow>
              ) : ledgerRows.map(e => {
                const meta = TXN_META[e.txnType] ?? { label: e.txnType, icon: Wallet, color: "text-muted-foreground" };
                const Icon = meta.icon;
                return (
                  <TableRow key={e.id} className="hover:bg-muted/20 border-border/30">
                    <TableCell className="py-3">
                      <div className={`flex items-center gap-1.5 ${meta.color}`}>
                        <Icon className="w-3.5 h-3.5 shrink-0" />
                        <span className="text-xs font-medium">{meta.label}</span>
                      </div>
                    </TableCell>
                    <TableCell className="py-3 text-xs text-muted-foreground max-w-[220px] truncate">{e.description}</TableCell>
                    <TableCell className={`py-3 text-sm font-medium ${e.amount >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                      {e.amount >= 0 ? "+" : ""}{INR(e.amount)}
                    </TableCell>
                    <TableCell className="py-3 text-sm text-foreground">{INR(e.availableAfter)}</TableCell>
                    <TableCell className="py-3 text-xs text-muted-foreground">{fmtDate(e.createdAt)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          {ledgerTotal > LIMIT && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-border/40">
              <span className="text-xs text-muted-foreground">{ledgerTotal} entries</span>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" className="h-7 w-7 p-0" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
                  <ChevronLeft className="w-3.5 h-3.5" />
                </Button>
                <span className="text-xs text-muted-foreground">{page} / {totalPages}</span>
                <Button size="sm" variant="outline" className="h-7 w-7 p-0" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
                  <ChevronRight className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
