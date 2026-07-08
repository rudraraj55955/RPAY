import { useQuery } from "@tanstack/react-query";
import { getToken } from "@/lib/auth";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { User, Building2, Phone, Mail, Globe, CheckCircle2, Clock, XCircle, ShieldCheck } from "lucide-react";
import { format } from "date-fns";

async function apiFetch<T>(url: string): Promise<T> {
  const token = getToken();
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error((e as any).error ?? "Request failed"); }
  return res.json();
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { cls: string; label: string }> = {
    approved: { cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30", label: "Active" },
    pending: { cls: "bg-amber-500/15 text-amber-400 border-amber-500/30", label: "Pending Approval" },
    suspended: { cls: "bg-red-500/15 text-red-400 border-red-500/30", label: "Suspended" },
    rejected: { cls: "bg-red-500/15 text-red-400 border-red-500/30", label: "Rejected" },
  };
  const s = map[status] ?? { cls: "bg-muted/30 text-muted-foreground border-border", label: status };
  return <Badge variant="outline" className={`text-xs border ${s.cls}`}>{s.label}</Badge>;
}

export default function PayoutMerchantProfile() {
  const { user } = useAuth();
  const { data: config, isLoading } = useQuery({
    queryKey: ["payout-merchant-config"],
    queryFn: () => apiFetch<any>("/api/payout-merchant/config"),
  });

  if (isLoading) {
    return <div className="flex items-center justify-center h-64"><Spinner className="w-8 h-8 text-primary" /></div>;
  }

  const m = config?.merchant;
  const limits = config?.payoutLimits ?? {};
  const fee = config?.payoutFee ?? {};

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Profile</h1>
        <p className="text-sm text-muted-foreground mt-1">Your payout merchant account details</p>
      </div>

      {/* Business info */}
      <Card className="bg-card border-border/50">
        <CardHeader className="px-4 py-3 border-b border-border/40">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Building2 className="w-4 h-4 text-primary" /> Business Information
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 space-y-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-lg font-semibold text-foreground">{m?.businessName ?? "—"}</p>
              <p className="text-sm text-muted-foreground">{m?.contactName ?? "—"}</p>
            </div>
            <StatusBadge status={m?.status ?? "pending"} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Mail className="w-4 h-4 shrink-0" /><span className="truncate">{m?.email ?? "—"}</span>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Phone className="w-4 h-4 shrink-0" /><span>{m?.phone ?? "—"}</span>
            </div>
            {config?.approvedForPayoutAt && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <ShieldCheck className="w-4 h-4 shrink-0 text-emerald-400" />
                <span>Approved for payouts: {format(new Date(config.approvedForPayoutAt), "dd MMM yyyy")}</span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Service status */}
      <Card className="bg-card border-border/50">
        <CardHeader className="px-4 py-3 border-b border-border/40">
          <CardTitle className="text-sm font-semibold">Service Status</CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              { label: "Payout Service", enabled: config?.payoutServiceEnabled },
              { label: "Pay-in Service", enabled: config?.payinServiceEnabled },
              { label: "Collection Service", enabled: config?.collectionServiceEnabled },
            ].map(({ label, enabled }) => (
              <div key={label} className="flex items-center justify-between p-3 rounded-lg bg-muted/10 border border-border/40">
                <span className="text-sm text-foreground">{label}</span>
                <div className="flex items-center gap-1.5">
                  {enabled
                    ? <><CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /><span className="text-xs text-emerald-400">Active</span></>
                    : <><XCircle className="w-3.5 h-3.5 text-muted-foreground" /><span className="text-xs text-muted-foreground">Disabled</span></>}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Payout limits */}
      <Card className="bg-card border-border/50">
        <CardHeader className="px-4 py-3 border-b border-border/40">
          <CardTitle className="text-sm font-semibold">Payout Limits</CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: "Min Amount", value: `₹${Number(limits.minAmount ?? 1).toLocaleString("en-IN")}` },
              { label: "Max Amount", value: `₹${Number(limits.maxAmount ?? 200000).toLocaleString("en-IN")}` },
              { label: "Daily Limit", value: `₹${Number(limits.dailyLimit ?? 1000000).toLocaleString("en-IN")}` },
              { label: "Monthly Limit", value: `₹${Number(limits.monthlyLimit ?? 10000000).toLocaleString("en-IN")}` },
            ].map(({ label, value }) => (
              <div key={label} className="p-3 rounded-lg bg-muted/10 border border-border/40">
                <p className="text-xs text-muted-foreground mb-1">{label}</p>
                <p className="text-sm font-semibold text-foreground">{value}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Fee structure */}
      <Card className="bg-card border-border/50">
        <CardHeader className="px-4 py-3 border-b border-border/40">
          <CardTitle className="text-sm font-semibold">Fee Structure</CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <div className="p-3 rounded-lg bg-muted/10 border border-border/40">
              <p className="text-xs text-muted-foreground mb-1">Fee Type</p>
              <p className="text-sm font-semibold text-foreground capitalize">{fee.feeType ?? "flat"}</p>
            </div>
            <div className="p-3 rounded-lg bg-muted/10 border border-border/40">
              <p className="text-xs text-muted-foreground mb-1">Fee</p>
              <p className="text-sm font-semibold text-foreground">
                {fee.feeType === "percent" ? `${fee.fee ?? 0}%` : `₹${Number(fee.fee ?? 0).toFixed(2)}`}
              </p>
            </div>
            <div className="p-3 rounded-lg bg-muted/10 border border-border/40">
              <p className="text-xs text-muted-foreground mb-1">GST Rate</p>
              <p className="text-sm font-semibold text-foreground">{fee.gstRate ?? 18}%</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Login info */}
      <Card className="bg-card border-border/50">
        <CardHeader className="px-4 py-3 border-b border-border/40">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <User className="w-4 h-4 text-primary" /> Account
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Login Email</span>
            <span className="text-sm text-foreground">{user?.email ?? "—"}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Account Type</span>
            <Badge variant="outline" className="text-xs border border-primary/30 text-primary bg-primary/10">Payout Merchant</Badge>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Merchant Type</span>
            <span className="text-sm text-foreground">{config?.merchantType ?? "PAYOUT_ONLY"}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
