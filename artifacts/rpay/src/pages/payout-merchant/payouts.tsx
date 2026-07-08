import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getToken } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowRightLeft, Plus, ChevronLeft, ChevronRight, Clock, CheckCircle2, XCircle } from "lucide-react";
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
    "Sent": "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    "Processing": "bg-blue-500/15 text-blue-400 border-blue-500/30",
    "Failed": "bg-red-500/15 text-red-400 border-red-500/30",
    "Reversed": "bg-amber-500/15 text-amber-400 border-amber-500/30",
    "Rejected": "bg-red-500/15 text-red-400 border-red-500/30",
  };
  return (
    <Badge variant="outline" className={`text-[10px] border ${map[status] ?? "bg-muted/30 text-muted-foreground border-border"}`}>
      {status}
    </Badge>
  );
}

export default function PayoutMerchantPayouts() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    amount: "",
    payoutMode: "IMPS",
    accountHolder: "",
    bankAccount: "",
    ifscCode: "",
    bankName: "",
    upiId: "",
    remarks: "",
  });

  const { data, isLoading } = useQuery({
    queryKey: ["payout-merchant-payouts", page],
    queryFn: () => apiFetch<any>(`/api/payout-merchant/payouts?page=${page}&limit=25`),
  });

  const { data: bens } = useQuery({
    queryKey: ["payout-merchant-bens"],
    queryFn: () => apiFetch<any>("/api/payout-merchant/beneficiaries"),
  });

  const createMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) =>
      apiFetch<any>("/api/withdrawals", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      toast.success("Payout submitted successfully");
      setShowCreate(false);
      setForm({ amount: "", payoutMode: "IMPS", accountHolder: "", bankAccount: "", ifscCode: "", bankName: "", upiId: "", remarks: "" });
      qc.invalidateQueries({ queryKey: ["payout-merchant-payouts"] });
      qc.invalidateQueries({ queryKey: ["payout-merchant-stats"] });
      qc.invalidateQueries({ queryKey: ["payout-merchant-wallet"] });
    },
    onError: (err: any) => toast.error(err.message ?? "Failed to submit payout"),
  });

  const handleCreate = () => {
    const amt = Number(form.amount);
    if (!amt || amt <= 0) { toast.error("Enter a valid amount"); return; }
    if (form.payoutMode === "UPI" && !form.upiId) { toast.error("UPI ID is required"); return; }
    if (form.payoutMode !== "UPI" && (!form.bankAccount || !form.ifscCode || !form.accountHolder)) {
      toast.error("Account holder, bank account and IFSC are required"); return;
    }
    createMutation.mutate({
      amount: amt,
      payoutMode: form.payoutMode,
      accountHolder: form.accountHolder || undefined,
      bankAccount: form.bankAccount || undefined,
      ifscCode: form.ifscCode || undefined,
      bankName: form.bankName || undefined,
      upiId: form.upiId || undefined,
      remarks: form.remarks || undefined,
    });
  };

  const payouts = data?.payouts ?? [];
  const totalPages = data?.totalPages ?? 1;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Payouts</h1>
          <p className="text-sm text-muted-foreground mt-1">Send and track payout transfers</p>
        </div>
        <Button onClick={() => setShowCreate(true)} className="gap-2">
          <Plus className="w-4 h-4" /> New Payout
        </Button>
      </div>

      <Card className="bg-card border-border/50">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-10"><Spinner className="w-6 h-6 text-muted-foreground" /></div>
          ) : payouts.length === 0 ? (
            <div className="py-14 text-center">
              <ArrowRightLeft className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No payouts yet</p>
              <Button className="mt-4" onClick={() => setShowCreate(true)}>Send First Payout</Button>
            </div>
          ) : (
            <>
              <div className="divide-y divide-border/40">
                {/* Header */}
                <div className="grid grid-cols-[1fr_120px_100px_100px] gap-4 px-4 py-2 text-xs text-muted-foreground font-medium">
                  <span>Recipient</span>
                  <span>Amount</span>
                  <span>Mode</span>
                  <span>Status</span>
                </div>
                {payouts.map((p: any) => (
                  <div key={p.id} className="grid grid-cols-[1fr_120px_100px_100px] gap-4 px-4 py-3 items-center hover:bg-muted/10 transition-colors">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{p.accountHolder ?? p.upiId ?? "—"}</p>
                      <p className="text-xs text-muted-foreground">{format(new Date(p.createdAt), "dd MMM yyyy, HH:mm")}</p>
                      {p.utr && <p className="text-[10px] text-emerald-400 font-mono mt-0.5">UTR: {p.utr}</p>}
                      {p.failureReason && <p className="text-[10px] text-red-400 mt-0.5 truncate">{p.failureReason}</p>}
                    </div>
                    <p className="text-sm font-semibold text-foreground">{fmtAmount(p.amount)}</p>
                    <p className="text-xs text-muted-foreground">{p.payoutMode}</p>
                    <StatusBadge status={p.displayStatus} />
                  </div>
                ))}
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

      {/* Create payout dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Send Payout</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5">Amount (₹)</Label>
              <Input type="number" min="1" placeholder="e.g. 5000" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
            </div>
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
                <Input placeholder="e.g. user@upi" value={form.upiId} onChange={e => setForm(f => ({ ...f, upiId: e.target.value }))} />
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
              <Label className="text-xs text-muted-foreground mb-1.5">Remarks (optional)</Label>
              <Input placeholder="Internal note" value={form.remarks} onChange={e => setForm(f => ({ ...f, remarks: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={createMutation.isPending}>
              {createMutation.isPending ? <Spinner className="w-4 h-4 mr-2" /> : null}
              Submit Payout
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
