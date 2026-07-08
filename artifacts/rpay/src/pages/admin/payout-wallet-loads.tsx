import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getToken } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Wallet, Search, CheckCircle2, XCircle, Eye, RefreshCw,
  Building2, CreditCard, UserCog, Filter, Download,
} from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

async function apiFetch<T>(url: string, opts?: RequestInit): Promise<T> {
  const token = getToken();
  const res = await fetch(url, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(opts?.headers ?? {}) },
  });
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
  CREATED:              { label: "Created",     cls: "bg-muted text-muted-foreground" },
  REJECTED:             { label: "Rejected",    cls: "bg-rose-500/10 text-rose-400 border-rose-500/20" },
  FAILED:               { label: "Failed",      cls: "bg-rose-500/10 text-rose-400 border-rose-500/20" },
  EXPIRED:              { label: "Expired",     cls: "bg-muted text-muted-foreground" },
};

const METHOD_LABEL: Record<string, string> = {
  ONLINE:            "Online",
  BANK_TRANSFER_UTR: "Bank / UTR",
  ADMIN_TOPUP:       "Admin Top-up",
};

function MethodIcon({ method }: { method: string }) {
  if (method === "ONLINE") return <CreditCard className="h-3.5 w-3.5" />;
  if (method === "ADMIN_TOPUP") return <UserCog className="h-3.5 w-3.5" />;
  return <Building2 className="h-3.5 w-3.5" />;
}

export default function AdminPayoutWalletLoads() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [methodFilter, setMethodFilter] = useState("ALL");
  const [page, setPage] = useState(0);
  const [viewOrder, setViewOrder] = useState<any>(null);
  const [approving, setApproving] = useState<any>(null);
  const [rejecting, setRejecting] = useState<any>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [topupDialog, setTopupDialog] = useState(false);
  const [topupMerchantId, setTopupMerchantId] = useState("");
  const [topupAmount, setTopupAmount] = useState("");
  const [topupReason, setTopupReason] = useState("");
  const limit = 50;

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["admin-payout-wallet-loads", statusFilter, methodFilter, search, page],
    queryFn: () => {
      const p = new URLSearchParams({ limit: String(limit), offset: String(page * limit) });
      if (statusFilter !== "ALL") p.set("status", statusFilter);
      if (methodFilter !== "ALL") p.set("method", methodFilter);
      if (search.trim()) p.set("search", search.trim());
      return apiFetch<any>(`/api/admin/payout-wallet-loads?${p}`);
    },
  });

  const rows: any[] = data?.data ?? [];

  const approveMut = useMutation({
    mutationFn: ({ id, adminNote }: { id: number; adminNote?: string }) =>
      apiFetch(`/api/admin/payout-wallet-loads/${id}/approve`, { method: "POST", body: JSON.stringify({ adminNote }) }),
    onSuccess: () => { toast.success("Wallet load approved and credited"); setApproving(null); qc.invalidateQueries({ queryKey: ["admin-payout-wallet-loads"] }); },
    onError: (e: any) => toast.error(e.message ?? "Approval failed"),
  });

  const rejectMut = useMutation({
    mutationFn: ({ id, rejectionReason }: { id: number; rejectionReason: string }) =>
      apiFetch(`/api/admin/payout-wallet-loads/${id}/reject`, { method: "POST", body: JSON.stringify({ rejectionReason }) }),
    onSuccess: () => { toast.success("Load request rejected"); setRejecting(null); setRejectReason(""); qc.invalidateQueries({ queryKey: ["admin-payout-wallet-loads"] }); },
    onError: (e: any) => toast.error(e.message ?? "Rejection failed"),
  });

  const topupMut = useMutation({
    mutationFn: ({ merchantId, amount, reason }: { merchantId: number; amount: number; reason: string }) =>
      apiFetch(`/api/admin/payout-wallet-loads/topup`, { method: "POST", body: JSON.stringify({ merchantId, amount, reason }) }),
    onSuccess: (d: any) => { toast.success(d.message ?? "Top-up successful"); setTopupDialog(false); setTopupMerchantId(""); setTopupAmount(""); setTopupReason(""); qc.invalidateQueries({ queryKey: ["admin-payout-wallet-loads"] }); },
    onError: (e: any) => toast.error(e.message ?? "Top-up failed"),
  });

  function exportCsv() {
    const headers = ["ID", "Load ID", "Merchant", "Amount", "Fee", "Net Credit", "Method", "Status", "UTR", "Payer", "Created", "Credited"];
    const csvRows = rows.map((r) => [
      r.id, r.loadId, r.businessName ?? r.merchantId, r.amount, r.feeAmount, r.netCreditAmount,
      r.method, r.status, r.utr ?? "", r.payerName ?? "",
      r.createdAt ? format(new Date(r.createdAt), "dd/MM/yyyy HH:mm") : "",
      r.creditedAt ? format(new Date(r.creditedAt), "dd/MM/yyyy HH:mm") : "",
    ]);
    const csv = [headers, ...csvRows].map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "wallet_loads.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Payout Wallet Loads</h1>
          <p className="text-muted-foreground text-sm mt-1">Manage fund load requests for payout merchants</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="gap-2" onClick={() => setTopupDialog(true)}>
            <UserCog className="h-4 w-4" /> Admin Top-up
          </Button>
          <Button variant="outline" size="sm" className="gap-2" onClick={exportCsv}>
            <Download className="h-4 w-4" /> Export CSV
          </Button>
          <Button variant="outline" size="sm" className="gap-2" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search UTR, merchant, load ID…" className="pl-9" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} />
        </div>
        <select
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }}
        >
          <option value="ALL">All Status</option>
          <option value="PENDING_VERIFICATION">Pending Verification</option>
          <option value="SUCCESS">Credited</option>
          <option value="REJECTED">Rejected</option>
          <option value="PROCESSING">Processing</option>
          <option value="FAILED">Failed</option>
        </select>
        <select
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          value={methodFilter}
          onChange={(e) => { setMethodFilter(e.target.value); setPage(0); }}
        >
          <option value="ALL">All Methods</option>
          <option value="ONLINE">Online</option>
          <option value="BANK_TRANSFER_UTR">Bank / UTR</option>
          <option value="ADMIN_TOPUP">Admin Top-up</option>
        </select>
      </div>

      <Card className="border-border/50">
        <CardHeader className="px-4 py-3 border-b border-border/40">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Wallet className="h-4 w-4 text-primary" />
            Load Orders
            <Badge variant="outline" className="ml-1 text-xs">{rows.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-12"><Spinner className="w-6 h-6 text-primary" /></div>
          ) : rows.length === 0 ? (
            <div className="py-16 text-center text-sm text-muted-foreground">No load orders found.</div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/40 text-left">
                      <th className="px-4 py-2.5 text-xs font-medium text-muted-foreground">Merchant</th>
                      <th className="px-4 py-2.5 text-xs font-medium text-muted-foreground">Amount</th>
                      <th className="px-4 py-2.5 text-xs font-medium text-muted-foreground">Method</th>
                      <th className="px-4 py-2.5 text-xs font-medium text-muted-foreground">UTR</th>
                      <th className="px-4 py-2.5 text-xs font-medium text-muted-foreground">Status</th>
                      <th className="px-4 py-2.5 text-xs font-medium text-muted-foreground">Submitted</th>
                      <th className="px-4 py-2.5 text-xs font-medium text-muted-foreground">Approved By</th>
                      <th className="px-4 py-2.5 text-xs font-medium text-muted-foreground">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/30">
                    {rows.map((r) => {
                      const badge = STATUS_BADGE[r.status] ?? STATUS_BADGE["CREATED"];
                      return (
                        <tr key={r.id} className="hover:bg-muted/10 transition-colors">
                          <td className="px-4 py-3">
                            <p className="font-medium truncate max-w-[140px]">{r.businessName ?? `Merchant #${r.merchantId}`}</p>
                            <p className="text-xs text-muted-foreground truncate max-w-[140px]">{r.merchantEmail}</p>
                          </td>
                          <td className="px-4 py-3">
                            <p className="font-medium">{fmtAmount(r.amount)}</p>
                            {Number(r.feeAmount) > 0 && (
                              <p className="text-xs text-muted-foreground">Net: {fmtAmount(r.netCreditAmount)}</p>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1.5 text-xs">
                              <MethodIcon method={r.method} />
                              <span>{METHOD_LABEL[r.method] ?? r.method}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            {r.utr ? (
                              <span className="font-mono text-xs">{r.utr}</span>
                            ) : (
                              <span className="text-muted-foreground text-xs">—</span>
                            )}
                            {r.payerName && <p className="text-xs text-muted-foreground">{r.payerName}</p>}
                          </td>
                          <td className="px-4 py-3">
                            <Badge variant="outline" className={`text-xs ${badge.cls}`}>{badge.label}</Badge>
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                            {r.createdAt ? format(new Date(r.createdAt), "dd MMM yy, HH:mm") : "—"}
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">
                            {r.approvedByEmail ?? (r.approvedBy ? `Admin #${r.approvedBy}` : "—")}
                            {r.approvedAt && <p className="text-muted-foreground/60">{format(new Date(r.approvedAt), "dd MMM yy")}</p>}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1">
                              <Button
                                variant="ghost" size="icon" className="h-7 w-7"
                                title="View" onClick={() => setViewOrder(r)}
                              >
                                <Eye className="h-3.5 w-3.5" />
                              </Button>
                              {r.status === "PENDING_VERIFICATION" && (
                                <>
                                  <Button
                                    variant="ghost" size="icon" className="h-7 w-7 text-emerald-400 hover:text-emerald-300"
                                    title="Approve" onClick={() => setApproving(r)}
                                  >
                                    <CheckCircle2 className="h-3.5 w-3.5" />
                                  </Button>
                                  <Button
                                    variant="ghost" size="icon" className="h-7 w-7 text-rose-400 hover:text-rose-300"
                                    title="Reject" onClick={() => { setRejecting(r); setRejectReason(""); }}
                                  >
                                    <XCircle className="h-3.5 w-3.5" />
                                  </Button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="flex justify-between items-center px-4 py-3 border-t border-border/40">
                <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>Previous</Button>
                <span className="text-xs text-muted-foreground">Page {page + 1}</span>
                <Button variant="outline" size="sm" disabled={rows.length < limit} onClick={() => setPage((p) => p + 1)}>Next</Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* View Detail Dialog */}
      <Dialog open={!!viewOrder} onOpenChange={() => setViewOrder(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Load Order Detail</DialogTitle>
          </DialogHeader>
          {viewOrder && (
            <div className="space-y-3 text-sm">
              {[
                ["Load ID", viewOrder.loadId],
                ["Merchant", `${viewOrder.businessName ?? ""} (${viewOrder.merchantEmail ?? ""})`],
                ["Method", METHOD_LABEL[viewOrder.method] ?? viewOrder.method],
                ["Amount", fmtAmount(viewOrder.amount)],
                ["Fee", fmtAmount(viewOrder.feeAmount)],
                ["GST", fmtAmount(viewOrder.gstAmount)],
                ["Net Credit", fmtAmount(viewOrder.netCreditAmount)],
                ["Status", viewOrder.status],
                ["Internal Order ID", viewOrder.internalOrderId ?? "—"],
                ["Provider Payment ID", viewOrder.providerPaymentId ?? "—"],
                ["UTR", viewOrder.utr ?? "—"],
                ["Payer Name", viewOrder.payerName ?? "—"],
                ["Payer Reference", viewOrder.payerReference ?? "—"],
                ["Admin Note", viewOrder.adminNote ?? "—"],
                ["Rejection Reason", viewOrder.rejectionReason ?? "—"],
                ["Submitted", viewOrder.createdAt ? format(new Date(viewOrder.createdAt), "dd MMM yyyy, HH:mm") : "—"],
                ["Credited At", viewOrder.creditedAt ? format(new Date(viewOrder.creditedAt), "dd MMM yyyy, HH:mm") : "—"],
                ["Approved By", viewOrder.approvedByEmail ?? (viewOrder.approvedBy ? `Admin #${viewOrder.approvedBy}` : "—")],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between gap-4 py-1.5 border-b border-border/30">
                  <span className="text-muted-foreground shrink-0">{label}</span>
                  <span className="font-medium text-right break-all">{value}</span>
                </div>
              ))}
              {viewOrder.screenshotUrl && (
                <div className="pt-1">
                  <a href={viewOrder.screenshotUrl} target="_blank" rel="noopener noreferrer" className="text-primary text-xs underline">
                    View payment screenshot
                  </a>
                </div>
              )}
              {viewOrder.status === "PENDING_VERIFICATION" && (
                <div className="flex gap-2 pt-2">
                  <Button size="sm" className="flex-1 gap-1 bg-emerald-600 hover:bg-emerald-700"
                    onClick={() => { setApproving(viewOrder); setViewOrder(null); }}>
                    <CheckCircle2 className="h-3.5 w-3.5" /> Approve
                  </Button>
                  <Button size="sm" variant="destructive" className="flex-1 gap-1"
                    onClick={() => { setRejecting(viewOrder); setRejectReason(""); setViewOrder(null); }}>
                    <XCircle className="h-3.5 w-3.5" /> Reject
                  </Button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Approve Dialog */}
      <Dialog open={!!approving} onOpenChange={() => setApproving(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve Wallet Load</DialogTitle>
          </DialogHeader>
          {approving && (
            <div className="space-y-4">
              <div className="rounded-xl bg-emerald-500/5 border border-emerald-500/20 p-4 space-y-2 text-sm">
                <p>Merchant: <strong>{approving.businessName}</strong></p>
                <p>Amount: <strong>{fmtAmount(approving.amount)}</strong></p>
                <p>Net Credit: <strong className="text-emerald-400">{fmtAmount(approving.netCreditAmount)}</strong></p>
                {approving.utr && <p>UTR: <strong className="font-mono">{approving.utr}</strong></p>}
                {approving.payerName && <p>Payer: <strong>{approving.payerName}</strong></p>}
              </div>
              <p className="text-sm text-muted-foreground">
                This will credit <strong className="text-foreground">{fmtAmount(approving.netCreditAmount)}</strong> to the merchant's payout wallet immediately.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setApproving(null)}>Cancel</Button>
            <Button
              className="gap-2 bg-emerald-600 hover:bg-emerald-700"
              onClick={() => approveMut.mutate({ id: approving.id })}
              disabled={approveMut.isPending}
            >
              {approveMut.isPending ? <Spinner className="w-4 h-4" /> : <CheckCircle2 className="h-4 w-4" />}
              Confirm Approve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject Dialog */}
      <Dialog open={!!rejecting} onOpenChange={() => { setRejecting(null); setRejectReason(""); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Wallet Load</DialogTitle>
          </DialogHeader>
          {rejecting && (
            <div className="space-y-4">
              <div className="rounded-xl bg-rose-500/5 border border-rose-500/20 p-4 text-sm">
                <p>Merchant: <strong>{rejecting.businessName}</strong></p>
                <p>Amount: <strong>{fmtAmount(rejecting.amount)}</strong></p>
                {rejecting.utr && <p>UTR: <strong className="font-mono">{rejecting.utr}</strong></p>}
              </div>
              <div className="space-y-2">
                <Label>Rejection Reason *</Label>
                <Input
                  placeholder="Enter reason for rejection (required)"
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejecting(null)}>Cancel</Button>
            <Button
              variant="destructive" className="gap-2"
              onClick={() => rejectMut.mutate({ id: rejecting.id, rejectionReason: rejectReason })}
              disabled={rejectMut.isPending || rejectReason.trim().length < 5}
            >
              {rejectMut.isPending ? <Spinner className="w-4 h-4" /> : <XCircle className="h-4 w-4" />}
              Confirm Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Admin Top-up Dialog */}
      <Dialog open={topupDialog} onOpenChange={setTopupDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Admin Manual Top-up</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-xl bg-violet-500/5 border border-violet-500/20 p-3 text-xs text-violet-400">
              Directly credits a merchant's payout wallet. An audit log entry will be created. Reason is mandatory.
            </div>
            <div className="space-y-2">
              <Label>Merchant ID *</Label>
              <Input placeholder="Payout merchant ID" value={topupMerchantId} onChange={(e) => setTopupMerchantId(e.target.value)} type="number" />
            </div>
            <div className="space-y-2">
              <Label>Amount (₹) *</Label>
              <Input placeholder="Amount to credit" value={topupAmount} onChange={(e) => setTopupAmount(e.target.value)} type="number" />
            </div>
            <div className="space-y-2">
              <Label>Reason *</Label>
              <Input placeholder="Mandatory reason for top-up" value={topupReason} onChange={(e) => setTopupReason(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTopupDialog(false)}>Cancel</Button>
            <Button
              className="gap-2"
              onClick={() => topupMut.mutate({ merchantId: parseInt(topupMerchantId), amount: parseFloat(topupAmount), reason: topupReason })}
              disabled={topupMut.isPending || !topupMerchantId || !topupAmount || topupReason.trim().length < 5}
            >
              {topupMut.isPending ? <Spinner className="w-4 h-4" /> : <UserCog className="h-4 w-4" />}
              Credit Wallet
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
