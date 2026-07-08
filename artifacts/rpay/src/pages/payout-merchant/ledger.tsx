import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getToken } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { BookOpen, ArrowDownLeft, ArrowUpRight, ChevronLeft, ChevronRight } from "lucide-react";
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

function isCredit(type: string): boolean {
  return type.includes("credit") || type === "withdrawal_refund" || type === "payout_reversal";
}

export default function PayoutMerchantLedger() {
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ["payout-merchant-ledger-page", page],
    queryFn: () => apiFetch<any>(`/api/payout-merchant/ledger?page=${page}&limit=50`),
  });

  const entries = data?.entries ?? [];
  const totalPages = data?.totalPages ?? 1;
  const total = data?.total ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Ledger</h1>
        <p className="text-sm text-muted-foreground mt-1">Complete payout transaction history</p>
      </div>

      <Card className="bg-card border-border/50">
        <CardHeader className="flex flex-row items-center justify-between px-4 py-3 border-b border-border/40">
          <CardTitle className="text-sm font-semibold">
            Transactions {total > 0 && <span className="text-muted-foreground font-normal">({total.toLocaleString()} total)</span>}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-10"><Spinner className="w-6 h-6 text-muted-foreground" /></div>
          ) : entries.length === 0 ? (
            <div className="py-14 text-center">
              <BookOpen className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No transactions yet</p>
            </div>
          ) : (
            <>
              {/* Table header */}
              <div className="hidden md:grid grid-cols-[200px_1fr_100px_120px_120px] gap-4 px-4 py-2 text-xs text-muted-foreground font-medium border-b border-border/40">
                <span>Type</span>
                <span>Description</span>
                <span className="text-right">Amount</span>
                <span className="text-right">Balance After</span>
                <span>Date</span>
              </div>
              <div className="divide-y divide-border/40">
                {entries.map((e: any) => {
                  const credit = isCredit(e.txnType);
                  return (
                    <div key={e.id} className="flex md:grid md:grid-cols-[200px_1fr_100px_120px_120px] gap-4 px-4 py-3 items-center hover:bg-muted/10 transition-colors">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${credit ? "bg-emerald-500/10" : "bg-red-500/10"}`}>
                          {credit
                            ? <ArrowDownLeft className="w-3 h-3 text-emerald-400" />
                            : <ArrowUpRight className="w-3 h-3 text-red-400" />}
                        </div>
                        <span className="text-xs text-foreground truncate">{txnLabel(e.txnType)}</span>
                      </div>
                      <p className="text-xs text-muted-foreground truncate hidden md:block">{e.description ?? "—"}</p>
                      <p className={`text-sm font-semibold text-right ${credit ? "text-emerald-400" : "text-red-400"}`}>
                        {credit ? "+" : "-"}{fmtAmount(e.amount)}
                      </p>
                      <p className="text-xs text-foreground text-right hidden md:block">{fmtAmount(e.availableAfter)}</p>
                      <p className="text-xs text-muted-foreground">{format(new Date(e.createdAt), "dd MMM yy, HH:mm")}</p>
                    </div>
                  );
                })}
              </div>
              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-border/40">
                  <p className="text-xs text-muted-foreground">Page {page} of {totalPages}</p>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}><ChevronLeft className="w-4 h-4" /></Button>
                    <Button size="sm" variant="outline" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}><ChevronRight className="w-4 h-4" /></Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
