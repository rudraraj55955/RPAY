import { useQuery } from "@tanstack/react-query";
import { getToken } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Wallet, TrendingDown, ArrowDownLeft, ArrowUpRight, Clock, Plus, History } from "lucide-react";
import { format } from "date-fns";
import { Link } from "wouter";

async function apiFetch<T>(url: string): Promise<T> {
  const token = getToken();
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error((e as any).error ?? "Request failed"); }
  return res.json();
}

function fmtAmount(v: string | number | null | undefined): string {
  const n = Number(v ?? 0);
  return "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function TxnIcon({ type }: { type: string }) {
  const isCredit = type.includes("credit") || type === "withdrawal_refund" || type === "payout_reversal";
  return isCredit
    ? <ArrowDownLeft className="w-4 h-4 text-emerald-400" />
    : <ArrowUpRight className="w-4 h-4 text-red-400" />;
}

function txnLabel(type: string): string {
  const map: Record<string, string> = {
    withdrawal_request:      "Payout Requested",
    payout_hold:             "Payout Hold",
    withdrawal_debit:        "Payout Sent",
    withdrawal_refund:       "Payout Refund",
    payout_reversal:         "Payout Reversed",
    admin_credit:            "Admin Credit",
    admin_debit:             "Admin Debit",
    wallet_credit:           "Wallet Credit",
    wallet_debit:            "Wallet Debit",
    wallet_load_credit:      "Wallet Loaded",
    wallet_load_manual_credit: "Wallet Loaded (Verified)",
    wallet_load_admin_topup: "Admin Top-up",
    wallet_load_fee_debit:   "Load Fee",
    wallet_load_gst_debit:   "GST on Fee",
  };
  return map[type] ?? type.replace(/_/g, " ");
}

const LOAD_STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  SUCCESS:              { label: "Credited",   cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
  PENDING_VERIFICATION: { label: "Pending",    cls: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
  PROCESSING:           { label: "Processing", cls: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
  CREATED:              { label: "Initiated",  cls: "bg-muted text-muted-foreground" },
  REJECTED:             { label: "Rejected",   cls: "bg-rose-500/10 text-rose-400 border-rose-500/20" },
  FAILED:               { label: "Failed",     cls: "bg-rose-500/10 text-rose-400 border-rose-500/20" },
  EXPIRED:              { label: "Expired",    cls: "bg-muted text-muted-foreground" },
};

const METHOD_LABEL: Record<string, string> = {
  ONLINE:            "Online Payment",
  BANK_TRANSFER_UTR: "Bank Transfer",
  ADMIN_TOPUP:       "Admin Top-up",
};

export default function PayoutMerchantWallet() {
  const { data: wallet, isLoading: walletLoading } = useQuery({
    queryKey: ["payout-merchant-wallet"],
    queryFn: () => apiFetch<any>("/api/payout-merchant/wallet"),
  });
  const { data: ledger, isLoading: ledgerLoading } = useQuery({
    queryKey: ["payout-merchant-ledger", 1],
    queryFn: () => apiFetch<any>("/api/payout-merchant/ledger?limit=10"),
  });
  const { data: loadHistory, isLoading: loadLoading } = useQuery({
    queryKey: ["payout-merchant-load-history"],
    queryFn: () => apiFetch<any>("/api/payout-merchant/wallet/load-history?limit=5"),
  });

  if (walletLoading) {
    return <div className="flex items-center justify-center h-64"><Spinner className="w-8 h-8 text-primary" /></div>;
  }

  const recentLoads: any[] = loadHistory?.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Payout Wallet</h1>
          <p className="text-sm text-muted-foreground mt-1">Your payout wallet balance and history</p>
        </div>
        <div className="flex gap-2">
          <Link href="/payout-merchant/wallet/load-history">
            <Button variant="outline" size="sm" className="gap-2">
              <History className="w-4 h-4" /> Load History
            </Button>
          </Link>
          <Link href="/payout-merchant/wallet/load-funds">
            <Button size="sm" className="gap-2 bg-primary hover:bg-primary/90">
              <Plus className="w-4 h-4" /> Load Funds
            </Button>
          </Link>
        </div>
      </div>

      {/* Balance cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <Card className="bg-card border-border/50">
          <CardContent className="p-5">
            <div className="flex items-center gap-2 mb-2">
              <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
                <Wallet className="w-4 h-4 text-primary" />
              </div>
              <span className="text-xs text-muted-foreground font-medium">Available Balance</span>
            </div>
            <p className="text-3xl font-bold text-foreground">{fmtAmount(wallet?.availableBalance)}</p>
            <p className="text-xs text-muted-foreground mt-1">Ready for payouts</p>
          </CardContent>
        </Card>
        <Card className="bg-card border-border/50">
          <CardContent className="p-5">
            <div className="flex items-center gap-2 mb-2">
              <div className="h-8 w-8 rounded-lg bg-amber-500/10 flex items-center justify-center">
                <Clock className="w-4 h-4 text-amber-400" />
              </div>
              <span className="text-xs text-muted-foreground font-medium">On Hold</span>
            </div>
            <p className="text-3xl font-bold text-foreground">{fmtAmount(wallet?.holdBalance)}</p>
            <p className="text-xs text-muted-foreground mt-1">Pending payouts</p>
          </CardContent>
        </Card>
        <Card className="bg-card border-border/50">
          <CardContent className="p-5">
            <div className="flex items-center gap-2 mb-2">
              <div className="h-8 w-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <TrendingDown className="w-4 h-4 text-blue-400" />
              </div>
              <span className="text-xs text-muted-foreground font-medium">Total Sent</span>
            </div>
            <p className="text-3xl font-bold text-foreground">{fmtAmount(wallet?.totalPayout)}</p>
            <p className="text-xs text-muted-foreground mt-1">All-time payouts</p>
          </CardContent>
        </Card>
      </div>

      {/* Recent fund loads */}
      {(recentLoads.length > 0 || loadLoading) && (
        <Card className="bg-card border-border/50">
          <CardHeader className="px-4 py-3 border-b border-border/40 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Plus className="w-3.5 h-3.5 text-primary" />
              Recent Fund Loads
            </CardTitle>
            <Link href="/payout-merchant/wallet/load-history">
              <Button variant="ghost" size="sm" className="text-xs h-7 px-2">View all</Button>
            </Link>
          </CardHeader>
          <CardContent className="p-0">
            {loadLoading ? (
              <div className="py-6 text-center"><Spinner className="w-4 h-4 text-muted-foreground mx-auto" /></div>
            ) : (
              <div className="divide-y divide-border/40">
                {recentLoads.map((load) => {
                  const badge = LOAD_STATUS_BADGE[load.status] ?? LOAD_STATUS_BADGE["CREATED"];
                  return (
                    <div key={load.id} className="flex items-center justify-between px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium">{METHOD_LABEL[load.method] ?? load.method}</span>
                          <Badge variant="outline" className={`text-xs py-0 ${badge.cls}`}>{badge.label}</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {format(new Date(load.createdAt), "dd MMM yyyy, HH:mm")}
                          {load.utr && ` · UTR: ${load.utr}`}
                          {load.status === "REJECTED" && load.rejectionReason && (
                            <span className="text-rose-400"> · {load.rejectionReason}</span>
                          )}
                        </p>
                      </div>
                      <div className="text-right shrink-0 ml-4">
                        <p className="text-sm font-semibold text-foreground">{fmtAmount(load.amount)}</p>
                        {Number(load.feeAmount) > 0 && (
                          <p className="text-xs text-muted-foreground">Net: {fmtAmount(load.netCreditAmount)}</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Ledger */}
      <Card className="bg-card border-border/50">
        <CardHeader className="px-4 py-3 border-b border-border/40">
          <CardTitle className="text-sm font-semibold">Transaction History</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {ledgerLoading ? (
            <div className="flex items-center justify-center py-8"><Spinner className="w-5 h-5 text-muted-foreground" /></div>
          ) : (ledger?.entries ?? []).length === 0 ? (
            <div className="py-10 text-center">
              <Wallet className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">No transactions yet</p>
              <Link href="/payout-merchant/wallet/load-funds">
                <Button variant="outline" size="sm" className="mt-3 gap-2">
                  <Plus className="w-3.5 h-3.5" /> Load funds to get started
                </Button>
              </Link>
            </div>
          ) : (
            <div className="divide-y divide-border/40">
              {(ledger?.entries ?? []).map((e: any) => {
                const isCredit = e.txnType.includes("credit") || e.txnType === "withdrawal_refund" || e.txnType === "payout_reversal";
                return (
                  <div key={e.id} className="flex items-center justify-between px-4 py-3">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${isCredit ? "bg-emerald-500/10" : "bg-red-500/10"}`}>
                        <TxnIcon type={e.txnType} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm text-foreground font-medium truncate">{txnLabel(e.txnType)}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {e.description ?? "—"} · {format(new Date(e.createdAt), "dd MMM yyyy, HH:mm")}
                        </p>
                      </div>
                    </div>
                    <div className="text-right shrink-0 ml-4">
                      <p className={`text-sm font-semibold ${isCredit ? "text-emerald-400" : "text-red-400"}`}>
                        {isCredit ? "+" : "-"}₹{Number(e.amount ?? 0).toFixed(2)}
                      </p>
                      <p className="text-xs text-muted-foreground">Bal: {fmtAmount(e.availableAfter)}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
