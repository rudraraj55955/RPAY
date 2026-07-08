import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { getToken } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import {
  Wallet, CreditCard, Building2, Copy, CheckCircle2,
  AlertCircle, ArrowLeft, Upload, Info, ChevronRight,
} from "lucide-react";
import { Link, useLocation } from "wouter";
import { toast } from "sonner";

async function apiFetch<T>(url: string, opts?: RequestInit): Promise<T> {
  const token = getToken();
  const res = await fetch(url, { ...opts, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(opts?.headers ?? {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any).error ?? "Request failed");
  return data;
}

function fmtAmount(v: string | number | null | undefined): string {
  const n = Number(v ?? 0);
  return "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

type Method = "ONLINE" | "BANK_TRANSFER_UTR";

export default function LoadFunds() {
  const [, setLocation] = useLocation();
  const [method, setMethod] = useState<Method>("BANK_TRANSFER_UTR");
  const [amount, setAmount] = useState("");
  const [utr, setUtr] = useState("");
  const [payerName, setPayerName] = useState("");
  const [payerReference, setPayerReference] = useState("");
  const [screenshotUrl, setScreenshotUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submittedData, setSubmittedData] = useState<any>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const { data: settings, isLoading: settingsLoading } = useQuery({
    queryKey: ["wallet-load-settings"],
    queryFn: () => apiFetch<any>("/api/payout-merchant/wallet/load-settings"),
  });

  const parsedAmount = parseFloat(amount);
  const isValidAmount = !isNaN(parsedAmount) && parsedAmount > 0;
  const minAmount = settings?.minAmount ?? 100;
  const maxAmount = settings?.maxAmount ?? 500000;

  // Fee calculation
  let feeAmount = 0;
  let gstAmount = 0;
  let netCredit = isValidAmount ? parsedAmount : 0;
  if (isValidAmount && settings) {
    if (settings.feeType === "FLAT") feeAmount = settings.feeValue;
    else if (settings.feeType === "PERCENTAGE") feeAmount = (parsedAmount * settings.feeValue) / 100;
    if (settings.gstOnFee) gstAmount = feeAmount * 0.18;
    netCredit = Math.max(0, parsedAmount - feeAmount - gstAmount);
  }

  function copyText(text: string, key: string) {
    navigator.clipboard.writeText(text);
    setCopied(key);
    toast.success("Copied!");
    setTimeout(() => setCopied(null), 2000);
  }

  async function handleSubmit() {
    if (!isValidAmount) { toast.error("Please enter a valid amount"); return; }
    if (parsedAmount < minAmount) { toast.error(`Minimum load amount is ₹${minAmount}`); return; }
    if (parsedAmount > maxAmount) { toast.error(`Maximum load amount is ₹${maxAmount.toLocaleString()}`); return; }

    if (method === "BANK_TRANSFER_UTR") {
      if (!utr.trim() || utr.trim().length < 6) { toast.error("Please enter a valid UTR/reference number"); return; }
      if (!payerName.trim()) { toast.error("Payer name is required"); return; }
      if (settings?.requireScreenshot && !screenshotUrl.trim()) { toast.error("Payment screenshot URL is required"); return; }
    }

    setSubmitting(true);
    try {
      const body: Record<string, any> = { amount: parsedAmount, method };
      if (method === "BANK_TRANSFER_UTR") {
        body["utr"] = utr.trim().toUpperCase();
        body["payerName"] = payerName.trim();
        if (payerReference.trim()) body["payerReference"] = payerReference.trim();
        if (screenshotUrl.trim()) body["screenshotUrl"] = screenshotUrl.trim();
      }
      const result = await apiFetch<any>("/api/payout-merchant/wallet/load/create", {
        method: "POST",
        body: JSON.stringify(body),
      });
      setSubmittedData(result);
      setSubmitted(true);

      if (method === "ONLINE" && result.checkoutUrl) {
        window.open(result.checkoutUrl, "_blank");
      }
    } catch (err: any) {
      toast.error(err.message ?? "Failed to submit request");
    } finally {
      setSubmitting(false);
    }
  }

  if (settingsLoading) {
    return <div className="flex items-center justify-center h-64"><Spinner className="w-8 h-8 text-primary" /></div>;
  }

  if (!settings?.enabled) {
    return (
      <div className="space-y-4">
        <Link href="/payout-merchant/wallet">
          <Button variant="ghost" size="sm" className="gap-2 -ml-2"><ArrowLeft className="w-4 h-4" /> Back to Wallet</Button>
        </Link>
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <AlertCircle className="h-12 w-12 text-muted-foreground/30 mb-4" />
          <p className="text-sm font-medium text-muted-foreground">Wallet fund loading is currently unavailable.</p>
          <p className="text-xs text-muted-foreground/60 mt-1">Please contact support for assistance.</p>
        </div>
      </div>
    );
  }

  if (submitted && submittedData) {
    return (
      <div className="space-y-4 max-w-lg mx-auto">
        <Link href="/payout-merchant/wallet">
          <Button variant="ghost" size="sm" className="gap-2 -ml-2"><ArrowLeft className="w-4 h-4" /> Back to Wallet</Button>
        </Link>
        <Card className="border-border/50">
          <CardContent className="pt-8 pb-8 flex flex-col items-center text-center gap-4">
            <div className="h-16 w-16 rounded-full bg-emerald-500/10 flex items-center justify-center">
              <CheckCircle2 className="h-8 w-8 text-emerald-400" />
            </div>
            <div>
              <h2 className="text-xl font-bold">
                {method === "BANK_TRANSFER_UTR" ? "Request Submitted!" : "Payment Order Created"}
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                {method === "BANK_TRANSFER_UTR"
                  ? "Your deposit request is pending admin verification. Wallet will be credited after approval."
                  : "Complete payment in the opened tab. Wallet will be credited automatically after payment success."}
              </p>
            </div>
            <div className="w-full rounded-xl border border-border/40 bg-muted/20 p-4 space-y-2 text-left">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Amount</span>
                <span className="font-medium">{fmtAmount(submittedData.amount)}</span>
              </div>
              {Number(submittedData.feeAmount) > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Fee</span>
                  <span className="font-medium text-rose-400">-{fmtAmount(submittedData.feeAmount)}</span>
                </div>
              )}
              <div className="flex justify-between text-sm font-semibold border-t border-border/40 pt-2">
                <span>Net Credit</span>
                <span className="text-emerald-400">{fmtAmount(submittedData.netCreditAmount)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Reference</span>
                <span className="font-mono text-xs">{submittedData.loadId}</span>
              </div>
            </div>
            <div className="flex gap-3 w-full">
              {method === "ONLINE" && submittedData.checkoutUrl && (
                <Button className="flex-1" onClick={() => window.open(submittedData.checkoutUrl, "_blank")}>
                  Open Payment Page
                </Button>
              )}
              <Button variant="outline" className="flex-1" onClick={() => setLocation("/payout-merchant/wallet/load-history")}>
                View History
              </Button>
              <Button variant="outline" className="flex-1" onClick={() => { setSubmitted(false); setAmount(""); setUtr(""); setPayerName(""); }}>
                New Request
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <Link href="/payout-merchant/wallet">
          <Button variant="ghost" size="sm" className="gap-2 -ml-2 mb-4"><ArrowLeft className="w-4 h-4" /> Back to Wallet</Button>
        </Link>
        <h1 className="text-2xl font-bold">Load Funds</h1>
        <p className="text-sm text-muted-foreground mt-1">Add money to your RasoKart payout wallet</p>
      </div>

      {/* Method selection */}
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">Payment Method</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {settings?.onlineEnabled && (
            <button
              onClick={() => setMethod("ONLINE")}
              className={`w-full flex items-center gap-4 rounded-xl border p-4 text-left transition-all ${
                method === "ONLINE"
                  ? "border-primary/60 bg-primary/5"
                  : "border-border/40 hover:border-border/80 hover:bg-muted/20"
              }`}
            >
              <div className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 ${method === "ONLINE" ? "bg-primary/15" : "bg-muted/40"}`}>
                <CreditCard className={`h-4 w-4 ${method === "ONLINE" ? "text-primary" : "text-muted-foreground"}`} />
              </div>
              <div className="flex-1">
                <p className={`text-sm font-medium ${method === "ONLINE" ? "text-primary" : ""}`}>Online Payment</p>
                <p className="text-xs text-muted-foreground">UPI · QR · Card — Auto-credited after payment</p>
              </div>
              <div className={`h-4 w-4 rounded-full border-2 transition-all ${method === "ONLINE" ? "border-primary bg-primary" : "border-border"}`} />
            </button>
          )}
          {settings?.manualUtrEnabled && (
            <button
              onClick={() => setMethod("BANK_TRANSFER_UTR")}
              className={`w-full flex items-center gap-4 rounded-xl border p-4 text-left transition-all ${
                method === "BANK_TRANSFER_UTR"
                  ? "border-primary/60 bg-primary/5"
                  : "border-border/40 hover:border-border/80 hover:bg-muted/20"
              }`}
            >
              <div className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 ${method === "BANK_TRANSFER_UTR" ? "bg-primary/15" : "bg-muted/40"}`}>
                <Building2 className={`h-4 w-4 ${method === "BANK_TRANSFER_UTR" ? "text-primary" : "text-muted-foreground"}`} />
              </div>
              <div className="flex-1">
                <p className={`text-sm font-medium ${method === "BANK_TRANSFER_UTR" ? "text-primary" : ""}`}>Bank Transfer / UTR</p>
                <p className="text-xs text-muted-foreground">NEFT · IMPS · UPI — Transfer and submit UTR for verification</p>
              </div>
              <div className={`h-4 w-4 rounded-full border-2 transition-all ${method === "BANK_TRANSFER_UTR" ? "border-primary bg-primary" : "border-border"}`} />
            </button>
          )}
        </CardContent>
      </Card>

      {/* Amount */}
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">Load Amount</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="amount">Amount (₹)</Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-medium">₹</span>
              <Input
                id="amount"
                type="number"
                min={minAmount}
                max={maxAmount}
                step="1"
                placeholder={`Min ₹${minAmount} · Max ₹${maxAmount.toLocaleString()}`}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="pl-8"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Minimum: ₹{minAmount.toLocaleString()} · Maximum: ₹{maxAmount.toLocaleString()}
            </p>
          </div>

          {/* Quick amounts */}
          <div className="flex flex-wrap gap-2">
            {[500, 1000, 5000, 10000, 25000, 50000].filter(a => a >= minAmount && a <= maxAmount).map((a) => (
              <Button
                key={a}
                variant="outline"
                size="sm"
                onClick={() => setAmount(String(a))}
                className={`text-xs h-7 px-3 ${amount === String(a) ? "border-primary text-primary" : ""}`}
              >
                ₹{a.toLocaleString()}
              </Button>
            ))}
          </div>

          {/* Fee breakdown */}
          {isValidAmount && (
            <div className="rounded-xl border border-border/40 bg-muted/20 p-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Load Amount</span>
                <span>{fmtAmount(parsedAmount)}</span>
              </div>
              {feeAmount > 0 && (
                <>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">
                      Load Fee {settings?.feeType === "PERCENTAGE" ? `(${settings.feeValue}%)` : ""}
                    </span>
                    <span className="text-rose-400">-{fmtAmount(feeAmount)}</span>
                  </div>
                  {gstAmount > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">GST on Fee (18%)</span>
                      <span className="text-rose-400">-{fmtAmount(gstAmount)}</span>
                    </div>
                  )}
                </>
              )}
              <div className="flex justify-between text-sm font-semibold border-t border-border/40 pt-2">
                <span>Net Wallet Credit</span>
                <span className="text-emerald-400">{fmtAmount(netCredit)}</span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Bank transfer details */}
      {method === "BANK_TRANSFER_UTR" && settings?.bankDetails && (
        <Card className="border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Building2 className="h-4 w-4 text-primary" />
              Transfer Funds To
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {settings.bankDetails.bankName && (
              <div className="flex items-center justify-between py-2 border-b border-border/30">
                <span className="text-sm text-muted-foreground">Bank Name</span>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{settings.bankDetails.bankName}</span>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => copyText(settings.bankDetails.bankName, "bank")}>
                    {copied === "bank" ? <CheckCircle2 className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                  </Button>
                </div>
              </div>
            )}
            {settings.bankDetails.accountHolder && (
              <div className="flex items-center justify-between py-2 border-b border-border/30">
                <span className="text-sm text-muted-foreground">Account Holder</span>
                <span className="text-sm font-medium">{settings.bankDetails.accountHolder}</span>
              </div>
            )}
            {settings.bankDetails.accountNumber && (
              <div className="flex items-center justify-between py-2 border-b border-border/30">
                <span className="text-sm text-muted-foreground">Account Number</span>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-mono font-medium">{settings.bankDetails.accountNumber}</span>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => copyText(settings.bankDetails.accountNumber, "acc")}>
                    {copied === "acc" ? <CheckCircle2 className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                  </Button>
                </div>
              </div>
            )}
            {settings.bankDetails.ifsc && (
              <div className="flex items-center justify-between py-2 border-b border-border/30">
                <span className="text-sm text-muted-foreground">IFSC Code</span>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-mono font-medium">{settings.bankDetails.ifsc}</span>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => copyText(settings.bankDetails.ifsc, "ifsc")}>
                    {copied === "ifsc" ? <CheckCircle2 className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                  </Button>
                </div>
              </div>
            )}
            {settings.bankDetails.upiId && (
              <div className="flex items-center justify-between py-2">
                <span className="text-sm text-muted-foreground">UPI ID</span>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{settings.bankDetails.upiId}</span>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => copyText(settings.bankDetails.upiId, "upi")}>
                    {copied === "upi" ? <CheckCircle2 className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                  </Button>
                </div>
              </div>
            )}
            {!settings.bankDetails.bankName && !settings.bankDetails.accountNumber && !settings.bankDetails.upiId && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                <Info className="h-4 w-4 shrink-0" />
                <span>Bank transfer details are being configured. Please contact support for the account details.</span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* UTR form */}
      {method === "BANK_TRANSFER_UTR" && (
        <Card className="border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">Transfer Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-xl bg-amber-500/5 border border-amber-500/20 p-3 flex gap-2 text-xs text-amber-400">
              <Info className="h-4 w-4 shrink-0 mt-0.5" />
              <span>Transfer the exact amount first, then fill in the details below. Your wallet will be credited after admin verification.</span>
            </div>
            <div className="space-y-2">
              <Label htmlFor="utr">UTR / Reference Number *</Label>
              <Input
                id="utr"
                placeholder="12-digit UTR, transaction ID, or reference number"
                value={utr}
                onChange={(e) => setUtr(e.target.value.toUpperCase())}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="payerName">Payer Name *</Label>
              <Input
                id="payerName"
                placeholder="Name on the bank account / UPI ID"
                value={payerName}
                onChange={(e) => setPayerName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="payerRef">Payer Bank / UPI (optional)</Label>
              <Input
                id="payerRef"
                placeholder="Payer's bank name or UPI ID (optional)"
                value={payerReference}
                onChange={(e) => setPayerReference(e.target.value)}
              />
            </div>
            {settings?.requireScreenshot && (
              <div className="space-y-2">
                <Label htmlFor="screenshot">Payment Screenshot URL *</Label>
                <Input
                  id="screenshot"
                  placeholder="Paste image URL of payment screenshot"
                  value={screenshotUrl}
                  onChange={(e) => setScreenshotUrl(e.target.value)}
                />
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Online info */}
      {method === "ONLINE" && (
        <Card className="border-border/50">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-start gap-3">
              <Info className="h-4 w-4 text-primary shrink-0 mt-0.5" />
              <div className="text-sm text-muted-foreground space-y-1">
                <p>You'll be redirected to the <strong className="text-foreground">RasoKart Secure Deposit</strong> page.</p>
                <p>Your wallet will be credited automatically after payment confirmation. Do not close the browser until payment is complete.</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Button
        className="w-full h-11 text-base gap-2"
        onClick={handleSubmit}
        disabled={submitting || !isValidAmount}
      >
        {submitting ? (
          <><Spinner className="w-4 h-4" /> Processing…</>
        ) : method === "ONLINE" ? (
          <><CreditCard className="w-4 h-4" /> Proceed to Secure Payment</>
        ) : (
          <><Wallet className="w-4 h-4" /> Submit Deposit Request</>
        )}
      </Button>
    </div>
  );
}
