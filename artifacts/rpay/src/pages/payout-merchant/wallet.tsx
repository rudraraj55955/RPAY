import { useQuery } from "@tanstack/react-query";
import { getToken } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { Wallet, TrendingDown, ArrowDownLeft, ArrowUpRight, Clock } from "lucide-react";
import { format } from "date-fns";

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
    withdrawal_request: "Payout Requested",
    payout_hold: "Payout Hold",
    withdrawal_debit: "Payout Sent",
    withdrawal_refund: "Payout Refund",
    payout_reversal: "Payout Reversed",
    admin_credit: "Admin Credit",
    admin_debit: "Admin Debit",
    wallet_credit: "Wallet Credit",
    wallet_debit: "Wallet Debit",
  };
  return map[type] ?? type.replace(/_/g, " ");
}

export default function PayoutMerchantWallet() {
  const { data: wallet, isLoading: walletLoading } = useQuery({
    queryKey: ["payout-merchant-wallet"],
    queryFn: () => apiFetch<any>("/api/payout-merchant/wallet"),
  });
  const { data: ledger, isLoading: ledgerLoading } = useQuery({
    queryKey: ["payout-merchant-ledger", 1],
    queryFn: () => apiFetch<any>("/api/payout-merchant/ledger?limit=20"),
  });

  if (walletLoading) {
    return <div className="flex items-center justify-center h-64"><Spinner className="w-8 h-8 text-primary" /></div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Wallet</h1>
        <p className="text-sm text-muted-foreground mt-1">Your payout wallet balance and history</p>
      </div>

      {/* Balance cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <Card className="bg-card border-border/50">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Wallet className="w-4 h-4 text-primary" />
              <span className="text-xs text-muted-foreground">Available Balance</span>
            </div>
            <p className="text-3xl font-bold text-foreground">{fmtAmount(wallet?.availableBalance)}</p>
          </CardContent>
        </Card>
        <Card className="bg-card border-border/50">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Clock className="w-4 h-4 text-amber-400" />
              <span className="text-xs text-muted-foreground">On Hold</span>
            </div>
            <p className="text-3xl font-bold text-foreground">{fmtAmount(wallet?.holdBalance)}</p>
          </CardContent>
        </Card>
        <Card className="bg-card border-border/50">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <TrendingDown className="w-4 h-4 text-blue-400" />
              <span className="text-xs text-muted-foreground">Total Sent (All-time)</span>
            </div>
            <p className="text-3xl font-bold text-foreground">{fmtAmount(wallet?.totalPayout)}</p>
          </CardContent>
        </Card>
      </div>

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
