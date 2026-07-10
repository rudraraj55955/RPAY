import { useState, useEffect } from "react";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from "sonner";
import { ShieldCheck, FileCheck, Loader2, CheckCircle2, XCircle, ChevronRight, Lock, Info } from "lucide-react";

type Status =
  | "PENDING" | "PAN_VERIFIED" | "PAN_FAILED"
  | "AADHAAR_FAILED" | "NAME_MISMATCH" | "NAME_MATCH_PENDING_REVIEW"
  | "APPROVED" | "REJECTED";

interface StatusResp {
  status: Status;
  panVerified: boolean;
  panNumberMasked?: string;
  aadhaarVerified: boolean;
  aadhaarLast4?: string;
  nameMatchScore: number | null;
  failureReason: string | null;
}

const auth = () => `Bearer ${localStorage.getItem("rasokart_token")}`;

async function api<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`/api/merchant-kyc${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", Authorization: auth(), ...(opts?.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "Something went wrong");
  return data as T;
}

export default function MerchantAutoKyc() {
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<StatusResp | null>(null);
  const [pan, setPan] = useState("");
  const [aadhaar, setAadhaar] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = () => {
    setLoading(true);
    api<StatusResp>("/status").then(setStatus).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(load, []);

  const submitPan = async () => {
    setBusy(true);
    try {
      await api("/pan/verify", { method: "POST", body: JSON.stringify({ panNumber: pan.trim().toUpperCase() }) });
      toast.success("PAN verified successfully");
      load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const sendOtp = async () => {
    setBusy(true);
    try {
      await api("/aadhaar/start", { method: "POST", body: JSON.stringify({ aadhaarNumber: aadhaar.replace(/\s/g, "") }) });
      setOtpSent(true);
      toast.success("OTP sent to your Aadhaar-linked mobile number");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const verifyOtp = async () => {
    setBusy(true);
    try {
      const res = await api<{ ok: boolean; status: Status; nameMatchScore: number }>("/aadhaar/verify", {
        method: "POST",
        body: JSON.stringify({ otp: otp.trim() }),
      });
      if (res.ok) {
        toast.success("KYC verification complete — your account is now approved");
      } else {
        toast.error("Verification did not pass. Our team will review your submission.");
      }
      load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const s = status?.status ?? "PENDING";
  const isApproved = s === "APPROVED";
  const isTerminalFail = s === "REJECTED";
  const showAadhaarStep = status?.panVerified && !status?.aadhaarVerified;
  const showResultStep = status?.aadhaarVerified;

  return (
    <DashboardLayout>
      <div className="max-w-2xl mx-auto space-y-6 py-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <ShieldCheck className="h-6 w-6 text-emerald-500" />
            RasoKart KYC Verification
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Complete your identity verification to activate your merchant account.
          </p>
        </div>

        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : isApproved ? (
          <Card className="border-emerald-600/30 bg-emerald-950/20">
            <CardContent className="pt-6 flex flex-col items-center text-center gap-3 py-10">
              <CheckCircle2 className="h-12 w-12 text-emerald-500" />
              <h2 className="text-lg font-medium">You're verified!</h2>
              <p className="text-sm text-muted-foreground">Your KYC verification is complete and your account is fully active.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {status?.failureReason && (
              <Alert variant="destructive">
                <XCircle className="h-4 w-4" />
                <AlertDescription>{status.failureReason}</AlertDescription>
              </Alert>
            )}

            {s === "NAME_MATCH_PENDING_REVIEW" && (
              <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription>Your verification is complete and is under manual review by our team. You'll be notified once approved.</AlertDescription>
              </Alert>
            )}

            {!status?.panVerified && !isTerminalFail && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base"><FileCheck className="h-4 w-4" /> Step 1 — PAN Verification</CardTitle>
                  <CardDescription>Enter your PAN card number as registered with the Income Tax Department.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="pan">PAN Number</Label>
                    <Input id="pan" placeholder="ABCDE1234F" maxLength={10} value={pan}
                      onChange={(e) => setPan(e.target.value.toUpperCase())} className="uppercase tracking-wider" />
                  </div>
                  <Button onClick={submitPan} disabled={busy || pan.trim().length !== 10} className="w-full">
                    {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                    Verify PAN <ChevronRight className="h-4 w-4 ml-1" />
                  </Button>
                </CardContent>
              </Card>
            )}

            {showAadhaarStep && !isTerminalFail && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base"><Lock className="h-4 w-4" /> Step 2 — Aadhaar OTP Verification</CardTitle>
                  <CardDescription>We'll send a one-time password to your Aadhaar-linked mobile number.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {!otpSent ? (
                    <>
                      <div className="space-y-1.5">
                        <Label htmlFor="aadhaar">Aadhaar Number</Label>
                        <Input id="aadhaar" placeholder="XXXX XXXX XXXX" maxLength={12} value={aadhaar}
                          onChange={(e) => setAadhaar(e.target.value.replace(/\D/g, ""))} />
                      </div>
                      <Button onClick={sendOtp} disabled={busy || aadhaar.length !== 12} className="w-full">
                        {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                        Send OTP
                      </Button>
                    </>
                  ) : (
                    <>
                      <div className="space-y-1.5">
                        <Label htmlFor="otp">Enter OTP</Label>
                        <Input id="otp" placeholder="6-digit OTP" maxLength={6} value={otp}
                          onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))} />
                      </div>
                      <Button onClick={verifyOtp} disabled={busy || otp.length < 4} className="w-full">
                        {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                        Verify OTP
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setOtpSent(false)} className="w-full">Change Aadhaar number</Button>
                    </>
                  )}
                </CardContent>
              </Card>
            )}

            {(showResultStep || isTerminalFail) && (
              <Card>
                <CardContent className="pt-6 flex items-center gap-3">
                  <Badge variant={isTerminalFail || s === "NAME_MISMATCH" ? "destructive" : "secondary"}>{s.replace(/_/g, " ")}</Badge>
                  <span className="text-sm text-muted-foreground">
                    {isTerminalFail ? "Your KYC was rejected. Please contact support." : "Awaiting review."}
                  </span>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
