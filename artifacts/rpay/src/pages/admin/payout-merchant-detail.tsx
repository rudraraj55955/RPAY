import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getToken } from "@/lib/auth";
import { useParams, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import {
  ArrowLeft, Building2, Wallet, ArrowRightLeft, BookOpen, CheckCircle2, Clock,
  XCircle, Plus, Minus, ShieldCheck, User, Users,
} from "lucide-react";
import { format } from "date-fns";
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

function fmtAmount(v: string | number | null | undefined): string {
  const n = Number(v ?? 0);
  return "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    approved: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    pending: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    suspended: "bg-red-500/15 text-red-400 border-red-500/30",
    rejected: "bg-red-500/15 text-red-400 border-red-500/30",
  };
  return <Badge variant="outline" className={`text-xs border ${map[status] ?? "bg-muted/30 text-muted-foreground border-border"}`}>{status}</Badge>;
}

export default function AdminPayoutMerchantDetail() {
  const { merchantId } = useParams<{ merchantId: string }>();
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<"overview" | "payouts" | "ledger" | "beneficiaries">("overview");
  const [showCredit, setShowCredit] = useState(false);
  const [showDebit, setShowDebit] = useState(false);
  const [walletAmount, setWalletAmount] = useState("");
  const [walletReason, setWalletReason] = useState("");

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["admin-payout-merchant-detail", merchantId],
    queryFn: () => apiFetch<any>(`/api/admin/payout-merchants/${merchantId}`),
  });

  const { data: payouts, isLoading: payoutsLoading } = useQuery({
    queryKey: ["admin-payout-merchant-payouts", merchantId],
    queryFn: () => apiFetch<any>(`/api/admin/payout-merchants/${merchantId}/payouts?limit=20`),
    enabled: activeTab === "payouts",
  });

  const { data: ledger, isLoading: ledgerLoading } = useQuery({
    queryKey: ["admin-payout-merchant-ledger", merchantId],
    queryFn: () => apiFetch<any>(`/api/admin/payout-merchants/${merchantId}/ledger?limit=30`),
    enabled: activeTab === "ledger",
  });

  const { data: bens, isLoading: bensLoading } = useQuery({
    queryKey: ["admin-payout-merchant-bens", merchantId],
    queryFn: () => apiFetch<any>(`/api/admin/payout-merchants/${merchantId}/beneficiaries`),
    enabled: activeTab === "beneficiaries",
  });

  const approveMutation = useMutation({
    mutationFn: () => apiFetch<any>(`/api/admin/payout-merchants/${merchantId}/approve`, { method: "POST" }),
    onSuccess: () => { toast.success("Payout merchant approved"); refetch(); },
    onError: (err: any) => toast.error(err.message ?? "Failed to approve"),
  });

  const settingsMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiFetch<any>(`/api/admin/payout-merchants/${merchantId}/settings`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => { toast.success("Settings updated"); refetch(); },
    onError: (err: any) => toast.error(err.message ?? "Failed to update"),
  });

  const creditMutation = useMutation({
    mutationFn: () => apiFetch<any>(`/api/admin/payout-merchants/${merchantId}/wallet/credit`, { method: "POST", body: JSON.stringify({ amount: Number(walletAmount), reason: walletReason }) }),
    onSuccess: () => { toast.success("Wallet credited"); setShowCredit(false); setWalletAmount(""); setWalletReason(""); refetch(); qc.invalidateQueries({ queryKey: ["admin-payout-merchant-ledger", merchantId] }); },
    onError: (err: any) => toast.error(err.message ?? "Failed to credit wallet"),
  });

  const debitMutation = useMutation({
    mutationFn: () => apiFetch<any>(`/api/admin/payout-merchants/${merchantId}/wallet/debit`, { method: "POST", body: JSON.stringify({ amount: Number(walletAmount), reason: walletReason }) }),
    onSuccess: () => { toast.success("Wallet debited"); setShowDebit(false); setWalletAmount(""); setWalletReason(""); refetch(); qc.invalidateQueries({ queryKey: ["admin-payout-merchant-ledger", merchantId] }); },
    onError: (err: any) => toast.error(err.message ?? "Failed to debit wallet"),
  });

  if (isLoading) {
    return <div className="flex items-center justify-center h-64"><Spinner className="w-8 h-8 text-primary" /></div>;
  }
  if (!data) {
    return <div className="text-center py-20 text-muted-foreground">Payout merchant not found</div>;
  }

  const { merchant, user, wallet, payoutStats, beneficiaryCount } = data;
  const TABS = ["overview", "payouts", "ledger", "beneficiaries"] as const;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <Link href="/admin/payout-merchants">
          <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground h-8">
            <ArrowLeft className="w-4 h-4" /> Back
          </Button>
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-xl font-bold text-foreground">{merchant.businessName}</h1>
            <StatusBadge status={merchant.status} />
            {merchant.payoutServiceEnabled && (
              <Badge variant="outline" className="text-xs border bg-blue-500/15 text-blue-400 border-blue-500/30">Payout Enabled</Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">{merchant.email} · {merchant.phone}</p>
        </div>
        {merchant.status === "pending" && (
          <Button onClick={() => approveMutation.mutate()} disabled={approveMutation.isPending} className="gap-2 shrink-0">
            {approveMutation.isPending ? <Spinner className="w-4 h-4" /> : <ShieldCheck className="w-4 h-4" />}
            Approve
          </Button>
        )}
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card className="bg-card border-border/50"><CardContent className="p-4">
          <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><Wallet className="w-3 h-3" /> Available</p>
          <p className="text-xl font-bold text-foreground">{fmtAmount(wallet?.availableBalance)}</p>
        </CardContent></Card>
        <Card className="bg-card border-border/50"><CardContent className="p-4">
          <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><Clock className="w-3 h-3" /> Hold</p>
          <p className="text-xl font-bold text-foreground">{fmtAmount(wallet?.holdBalance)}</p>
        </CardContent></Card>
        <Card className="bg-card border-border/50"><CardContent className="p-4">
          <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-emerald-400" /> Total Sent</p>
          <p className="text-xl font-bold text-foreground">{fmtAmount(wallet?.totalPayout)}</p>
        </CardContent></Card>
        <Card className="bg-card border-border/50"><CardContent className="p-4">
          <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><ArrowRightLeft className="w-3 h-3" /> Payouts</p>
          <p className="text-xl font-bold text-foreground">{payoutStats?.total ?? 0}</p>
        </CardContent></Card>
      </div>

      {/* Wallet actions */}
      <div className="flex gap-3 flex-wrap">
        <Button variant="outline" size="sm" onClick={() => setShowCredit(true)} className="gap-2 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10">
          <Plus className="w-4 h-4" /> Credit Wallet
        </Button>
        <Button variant="outline" size="sm" onClick={() => setShowDebit(true)} className="gap-2 text-red-400 border-red-500/30 hover:bg-red-500/10">
          <Minus className="w-4 h-4" /> Debit Wallet
        </Button>
        <Button variant="outline" size="sm" onClick={() => settingsMutation.mutate({ payoutServiceEnabled: !merchant.payoutServiceEnabled })} disabled={settingsMutation.isPending} className="gap-2">
          {merchant.payoutServiceEnabled ? "Disable Payout" : "Enable Payout"}
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border/50">
        {TABS.map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)} className={`px-4 py-2 text-sm capitalize transition-colors ${activeTab === tab ? "text-primary border-b-2 border-primary font-medium" : "text-muted-foreground hover:text-foreground"}`}>
            {tab}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "overview" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card className="bg-card border-border/50">
            <CardHeader className="px-4 py-3 border-b border-border/40"><CardTitle className="text-sm font-semibold flex items-center gap-2"><Building2 className="w-4 h-4 text-primary" />Business Info</CardTitle></CardHeader>
            <CardContent className="p-4 space-y-3">
              {[
                ["Business", merchant.businessName],
                ["Contact", merchant.contactName],
                ["Email", merchant.email],
                ["Phone", merchant.phone],
                ["Type", merchant.merchantType],
                ["Created", format(new Date(merchant.createdAt), "dd MMM yyyy")],
                ["Approved for Payout", merchant.approvedForPayoutAt ? format(new Date(merchant.approvedForPayoutAt), "dd MMM yyyy") : "Not yet"],
              ].map(([k, v]) => (
                <div key={k} className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">{k}</span>
                  <span className="text-xs text-foreground font-medium">{v}</span>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card className="bg-card border-border/50">
            <CardHeader className="px-4 py-3 border-b border-border/40"><CardTitle className="text-sm font-semibold flex items-center gap-2"><User className="w-4 h-4 text-primary" />Login Account</CardTitle></CardHeader>
            <CardContent className="p-4 space-y-3">
              {user ? [
                ["Name", user.name],
                ["Email", user.email],
                ["Status", user.isActive ? "Active" : "Inactive"],
                ["Member since", format(new Date(user.createdAt), "dd MMM yyyy")],
              ].map(([k, v]) => (
                <div key={k} className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">{k}</span>
                  <span className="text-xs text-foreground font-medium">{v}</span>
                </div>
              )) : <p className="text-xs text-muted-foreground">No login account found</p>}
              <div className="pt-2 border-t border-border/40">
                <p className="text-xs text-muted-foreground mb-1">Beneficiaries</p>
                <p className="text-sm font-semibold text-foreground">{beneficiaryCount} registered</p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {activeTab === "payouts" && (
        <Card className="bg-card border-border/50">
          <CardContent className="p-0">
            {payoutsLoading ? (
              <div className="flex items-center justify-center py-10"><Spinner className="w-5 h-5 text-muted-foreground" /></div>
            ) : (payouts?.payouts ?? []).length === 0 ? (
              <div className="py-12 text-center text-muted-foreground text-sm">No payouts yet</div>
            ) : (
              <div className="divide-y divide-border/40">
                <div className="grid grid-cols-[1fr_100px_100px_120px] gap-4 px-4 py-2 text-xs text-muted-foreground font-medium">
                  <span>Recipient</span><span>Amount</span><span>Mode</span><span>Date</span>
                </div>
                {(payouts?.payouts ?? []).map((p: any) => (
                  <div key={p.id} className="grid grid-cols-[1fr_100px_100px_120px] gap-4 px-4 py-3 items-center">
                    <div>
                      <p className="text-sm font-medium text-foreground">{p.accountHolder ?? p.upiId ?? "—"}</p>
                      <p className="text-xs text-muted-foreground">{p.transferStatus ?? p.status}</p>
                      {p.utr && <p className="text-[10px] font-mono text-emerald-400">UTR: {p.utr}</p>}
                    </div>
                    <p className="text-sm font-semibold text-foreground">{fmtAmount(p.amount)}</p>
                    <p className="text-xs text-muted-foreground">{p.payoutMode}</p>
                    <p className="text-xs text-muted-foreground">{format(new Date(p.createdAt), "dd MMM yy, HH:mm")}</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {activeTab === "ledger" && (
        <Card className="bg-card border-border/50">
          <CardContent className="p-0">
            {ledgerLoading ? (
              <div className="flex items-center justify-center py-10"><Spinner className="w-5 h-5 text-muted-foreground" /></div>
            ) : (ledger?.entries ?? []).length === 0 ? (
              <div className="py-12 text-center text-muted-foreground text-sm">No ledger entries yet</div>
            ) : (
              <div className="divide-y divide-border/40">
                {(ledger?.entries ?? []).map((e: any) => {
                  const credit = e.txnType.includes("credit") || e.txnType === "withdrawal_refund" || e.txnType === "payout_reversal";
                  return (
                    <div key={e.id} className="flex items-center justify-between px-4 py-3">
                      <div>
                        <p className="text-sm text-foreground">{e.txnType.replace(/_/g, " ")}</p>
                        <p className="text-xs text-muted-foreground">{e.description ?? "—"} · {format(new Date(e.createdAt), "dd MMM yy, HH:mm")}</p>
                      </div>
                      <div className="text-right">
                        <p className={`text-sm font-semibold ${credit ? "text-emerald-400" : "text-red-400"}`}>{credit ? "+" : "-"}{fmtAmount(e.amount)}</p>
                        <p className="text-xs text-muted-foreground">Bal: {fmtAmount(e.availableAfter)}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {activeTab === "beneficiaries" && (
        <Card className="bg-card border-border/50">
          <CardContent className="p-0">
            {bensLoading ? (
              <div className="flex items-center justify-center py-10"><Spinner className="w-5 h-5 text-muted-foreground" /></div>
            ) : (bens?.beneficiaries ?? []).length === 0 ? (
              <div className="py-12 text-center text-muted-foreground text-sm">No beneficiaries added yet</div>
            ) : (
              <div className="divide-y divide-border/40">
                {(bens?.beneficiaries ?? []).map((b: any) => (
                  <div key={b.id} className="flex items-center gap-4 px-4 py-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground">{b.accountHolder ?? b.upiId ?? "—"}</p>
                      <p className="text-xs text-muted-foreground">{b.payoutMode} · {b.bankAccount ?? b.upiId} {b.ifscCode ? `· ${b.ifscCode}` : ""}</p>
                    </div>
                    <Badge variant="outline" className={`text-[10px] border ${b.providerStatus === "created" ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" : "bg-muted/30 text-muted-foreground border-border"}`}>
                      {b.providerStatus}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Wallet credit dialog */}
      {[
        { show: showCredit, title: "Credit Wallet", onClose: () => setShowCredit(false), onSubmit: () => creditMutation.mutate(), isPending: creditMutation.isPending, label: "Credit", cls: "" },
        { show: showDebit, title: "Debit Wallet", onClose: () => setShowDebit(false), onSubmit: () => debitMutation.mutate(), isPending: debitMutation.isPending, label: "Debit", cls: "" },
      ].map(({ show, title, onClose, onSubmit, isPending, label }) => (
        <Dialog key={title} open={show} onOpenChange={onClose}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
            <div className="space-y-4 py-2">
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5">Amount (₹)</Label>
                <Input type="number" min="1" placeholder="e.g. 10000" value={walletAmount} onChange={e => setWalletAmount(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5">Reason</Label>
                <Input placeholder="Brief reason for this transaction" value={walletReason} onChange={e => setWalletReason(e.target.value)} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button onClick={onSubmit} disabled={isPending || !walletAmount || !walletReason}>
                {isPending ? <Spinner className="w-4 h-4 mr-2" /> : null}{label}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ))}
    </div>
  );
}
