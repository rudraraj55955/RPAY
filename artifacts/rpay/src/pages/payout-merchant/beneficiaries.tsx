import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getToken } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Users, Plus, CheckCircle2, XCircle, Clock, Building2 } from "lucide-react";
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

function VerifiedBadge({ status }: { status: string }) {
  if (status === "VERIFIED") return <Badge variant="outline" className="text-[10px] border bg-emerald-500/15 text-emerald-400 border-emerald-500/30 gap-1"><CheckCircle2 className="w-2.5 h-2.5" />Verified</Badge>;
  if (status === "FAILED") return <Badge variant="outline" className="text-[10px] border bg-red-500/15 text-red-400 border-red-500/30 gap-1"><XCircle className="w-2.5 h-2.5" />Failed</Badge>;
  return <Badge variant="outline" className="text-[10px] border bg-amber-500/15 text-amber-400 border-amber-500/30 gap-1"><Clock className="w-2.5 h-2.5" />Pending</Badge>;
}

export default function PayoutMerchantBeneficiaries() {
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ payoutMode: "IMPS", accountHolder: "", bankAccount: "", ifscCode: "", bankName: "", upiId: "", label: "" });
  const [saving, setSaving] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["payout-merchant-beneficiaries"],
    queryFn: () => apiFetch<any>("/api/payout-merchant/beneficiaries"),
  });

  const handleAdd = async () => {
    if (form.payoutMode === "UPI" && !form.upiId.trim()) { toast.error("UPI ID is required"); return; }
    if (form.payoutMode !== "UPI" && (!form.bankAccount.trim() || !form.ifscCode.trim() || !form.accountHolder.trim())) {
      toast.error("Account holder, bank account and IFSC are required"); return;
    }
    setSaving(true);
    try {
      await apiFetch<any>("/api/payout-beneficiaries", {
        method: "POST",
        body: JSON.stringify({
          payoutMode: form.payoutMode,
          accountHolder: form.accountHolder || undefined,
          bankAccount: form.bankAccount || undefined,
          ifscCode: form.ifscCode || undefined,
          bankName: form.bankName || undefined,
          upiId: form.upiId || undefined,
          label: form.label || undefined,
        }),
      });
      toast.success("Beneficiary added successfully");
      setShowAdd(false);
      setForm({ payoutMode: "IMPS", accountHolder: "", bankAccount: "", ifscCode: "", bankName: "", upiId: "", label: "" });
      qc.invalidateQueries({ queryKey: ["payout-merchant-beneficiaries"] });
    } catch (err: any) {
      toast.error(err.message ?? "Failed to add beneficiary");
    } finally {
      setSaving(false);
    }
  };

  const bens = data?.beneficiaries ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Beneficiaries</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage payout destinations</p>
        </div>
        <Button onClick={() => setShowAdd(true)} className="gap-2">
          <Plus className="w-4 h-4" /> Add Beneficiary
        </Button>
      </div>

      <Card className="bg-card border-border/50">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-10"><Spinner className="w-6 h-6 text-muted-foreground" /></div>
          ) : bens.length === 0 ? (
            <div className="py-14 text-center">
              <Users className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No beneficiaries added yet</p>
              <Button className="mt-4" onClick={() => setShowAdd(true)}>Add First Beneficiary</Button>
            </div>
          ) : (
            <div className="divide-y divide-border/40">
              {bens.map((b: any) => (
                <div key={b.id} className="flex items-center gap-4 px-4 py-3">
                  <div className="w-9 h-9 rounded-lg bg-muted/30 flex items-center justify-center shrink-0">
                    <Building2 className="w-4 h-4 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium text-foreground">{b.accountHolder ?? b.upiId ?? "—"}</p>
                      {b.label && <span className="text-xs text-muted-foreground">({b.label})</span>}
                      <VerifiedBadge status={b.verificationStatus} />
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {b.payoutMode} · {b.bankAccountMasked ? `${b.bankAccountMasked} · ${b.ifscCode ?? ""}` : b.upiId ?? ""}
                      {b.bankName ? ` · ${b.bankName}` : ""}
                    </p>
                    <p className="text-[10px] text-muted-foreground/60 mt-0.5">Added {format(new Date(b.createdAt), "dd MMM yyyy")}</p>
                  </div>
                  <Badge variant="outline" className="text-[10px] border border-border text-muted-foreground shrink-0">
                    {b.payoutMode}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Add Beneficiary</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5">Payout Mode</Label>
              <Select value={form.payoutMode} onValueChange={v => setForm(f => ({ ...f, payoutMode: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="IMPS">IMPS (Instant)</SelectItem>
                  <SelectItem value="NEFT">NEFT</SelectItem>
                  <SelectItem value="RTGS">RTGS</SelectItem>
                  <SelectItem value="UPI">UPI</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {form.payoutMode === "UPI" ? (
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5">UPI ID</Label>
                <Input placeholder="e.g. merchant@upi" value={form.upiId} onChange={e => setForm(f => ({ ...f, upiId: e.target.value }))} />
              </div>
            ) : (
              <>
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5">Account Holder Name</Label>
                  <Input placeholder="Full name as per bank" value={form.accountHolder} onChange={e => setForm(f => ({ ...f, accountHolder: e.target.value }))} />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5">Bank Account Number</Label>
                  <Input placeholder="Account number" value={form.bankAccount} onChange={e => setForm(f => ({ ...f, bankAccount: e.target.value }))} />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5">IFSC Code</Label>
                  <Input placeholder="e.g. HDFC0001234" value={form.ifscCode} onChange={e => setForm(f => ({ ...f, ifscCode: e.target.value.toUpperCase() }))} />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5">Bank Name (optional)</Label>
                  <Input placeholder="e.g. HDFC Bank" value={form.bankName} onChange={e => setForm(f => ({ ...f, bankName: e.target.value }))} />
                </div>
              </>
            )}
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5">Label / Nickname (optional)</Label>
              <Input placeholder="e.g. Operations Account" value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdd(false)}>Cancel</Button>
            <Button onClick={handleAdd} disabled={saving}>
              {saving ? <Spinner className="w-4 h-4 mr-2" /> : null}
              Add Beneficiary
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
