import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getToken } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { History, Plus, ArrowLeft, CreditCard, Building2, UserCog } from "lucide-react";
import { format } from "date-fns";
import { Link } from "wouter";

async function apiFetch<T>(url: string): Promise<T> {
  const token = getToken();
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any).error ?? "Request failed");
  return data;
}

function fmtAmount(v: string | number | null | undefined): string {
  const n = Number(v ?? 0);
  return "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  SUCCESS:              { label: "Credited",    cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
  PENDING_VERIFICATION: { label: "Pending",     cls: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
  PROCESSING:           { label: "Processing",  cls: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
  CREATED:              { label: "Initiated",   cls: "bg-muted text-muted-foreground" },
  REJECTED:             { label: "Rejected",    cls: "bg-rose-500/10 text-rose-400 border-rose-500/20" },
  FAILED:               { label: "Failed",      cls: "bg-rose-500/10 text-rose-400 border-rose-500/20" },
  EXPIRED:              { label: "Expired",     cls: "bg-muted text-muted-foreground" },
};

function MethodIcon({ method }: { method: string }) {
  if (method === "ONLINE") return <CreditCard className="h-4 w-4 text-primary" />;
  if (method === "ADMIN_TOPUP") return <UserCog className="h-4 w-4 text-violet-400" />;
  return <Building2 className="h-4 w-4 text-cyan-400" />;
}

const METHOD_LABEL: Record<string, string> = {
  ONLINE:            "Online Payment",
  BANK_TRANSFER_UTR: "Bank Transfer / UTR",
  ADMIN_TOPUP:       "Admin Top-up",
};

export default function LoadHistory() {
  const [page, setPage] = useState(0);
  const limit = 20;

  const { data, isLoading } = useQuery({
    queryKey: ["wallet-load-history", page],
    queryFn: () => apiFetch<any>(`/api/payout-merchant/wallet/load-history?limit=${limit}&offset=${page * limit}`),
  });

  const rows: any[] = data?.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/payout-merchant/wallet">
            <Button variant="ghost" size="sm" className="gap-2 -ml-2 mb-2"><ArrowLeft className="w-4 h-4" /> Back to Wallet</Button>
          </Link>
          <h1 className="text-2xl font-bold">Fund Load History</h1>
          <p className="text-sm text-muted-foreground mt-1">All your wallet load requests</p>
        </div>
        <Link href="/payout-merchant/wallet/load-funds">
          <Button size="sm" className="gap-2">
            <Plus className="w-4 h-4" /> Load Funds
          </Button>
        </Link>
      </div>

      <Card className="border-border/50">
        <CardHeader className="px-4 py-3 border-b border-border/40">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <History className="h-4 w-4 text-primary" />
            Load Requests
            {rows.length > 0 && <Badge variant="outline" className="ml-1 text-xs">{rows.length}</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-12"><Spinner className="w-6 h-6 text-primary" /></div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
              <History className="h-10 w-10 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">No fund load requests yet.</p>
              <Link href="/payout-merchant/wallet/load-funds">
                <Button variant="outline" size="sm" className="gap-2"><Plus className="w-3.5 h-3.5" /> Load Funds</Button>
              </Link>
            </div>
          ) : (
            <>
              <div className="divide-y divide-border/40">
                {rows.map((r) => {
                  const badge = STATUS_BADGE[r.status] ?? STATUS_BADGE["CREATED"];
                  const hasFee = Number(r.feeAmount) > 0;
                  return (
                    <div key={r.id} className="px-4 py-4 hover:bg-muted/10 transition-colors">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3 min-w-0 flex-1">
                          <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${
                            r.method === "ONLINE" ? "bg-primary/10" :
                            r.method === "ADMIN_TOPUP" ? "bg-violet-500/10" : "bg-cyan-500/10"
                          }`}>
                            <MethodIcon method={r.method} />
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-medium">{METHOD_LABEL[r.method] ?? r.method}</span>
                              <Badge variant="outline" className={`text-xs py-0 ${badge.cls}`}>{badge.label}</Badge>
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {format(new Date(r.createdAt), "dd MMM yyyy, HH:mm")}
                            </p>
                            {r.utr && (
                              <p className="text-xs text-muted-foreground mt-0.5">
                                UTR: <span className="font-mono">{r.utr}</span>
                              </p>
                            )}
                            {r.status === "PENDING_VERIFICATION" && (
                              <p className="text-xs text-amber-400 mt-1">Awaiting admin verification</p>
                            )}
                            {r.status === "REJECTED" && r.rejectionReason && (
                              <p className="text-xs text-rose-400 mt-1">Rejected: {r.rejectionReason}</p>
                            )}
                            {r.status === "SUCCESS" && r.creditedAt && (
                              <p className="text-xs text-emerald-400 mt-1">
                                Credited on {format(new Date(r.creditedAt), "dd MMM yyyy, HH:mm")}
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-sm font-bold">{fmtAmount(r.amount)}</p>
                          {hasFee && (
                            <p className="text-xs text-muted-foreground">Net: {fmtAmount(r.netCreditAmount)}</p>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="flex justify-between items-center px-4 py-3 border-t border-border/40">
                <Button
                  variant="outline" size="sm"
                  disabled={page === 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                >Previous</Button>
                <span className="text-xs text-muted-foreground">Page {page + 1}</span>
                <Button
                  variant="outline" size="sm"
                  disabled={rows.length < limit}
                  onClick={() => setPage((p) => p + 1)}
                >Next</Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
