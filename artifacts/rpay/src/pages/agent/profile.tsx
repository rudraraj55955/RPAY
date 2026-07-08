import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { User, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { getToken } from "@/lib/auth";

interface AgentProfile {
  id: number;
  name: string;
  email: string;
  mobile: string;
  referralCode: string;
  status: string;
  walletBalance: string;
  totalCommissionEarned: string;
  totalCommissionPaid: string;
  createdAt: string;
}

async function fetchProfile(): Promise<AgentProfile> {
  const token = getToken();
  const res = await fetch("/api/agent/me", { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error("Failed to load profile");
  return res.json();
}

export default function AgentProfile() {
  const [profile, setProfile] = useState<AgentProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchProfile()
      .then(setProfile)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  function copyCode() {
    if (profile?.referralCode) {
      navigator.clipboard.writeText(profile.referralCode);
      toast.success("Referral code copied!");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-bold tracking-tight">My Profile</h1>
        <p className="text-muted-foreground">Your agent account details</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base font-semibold">
              <User className="h-4 w-4 text-primary" />
              Agent Details
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>
            ) : !profile ? (
              <div className="py-8 text-center text-sm text-muted-foreground">Profile not found. Contact admin.</div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between py-2 border-b border-border/30">
                  <span className="text-sm text-muted-foreground">Name</span>
                  <span className="text-sm font-medium">{profile.name}</span>
                </div>
                <div className="flex items-center justify-between py-2 border-b border-border/30">
                  <span className="text-sm text-muted-foreground">Email</span>
                  <span className="text-sm font-medium">{profile.email}</span>
                </div>
                <div className="flex items-center justify-between py-2 border-b border-border/30">
                  <span className="text-sm text-muted-foreground">Mobile</span>
                  <span className="text-sm font-medium">{profile.mobile || "—"}</span>
                </div>
                <div className="flex items-center justify-between py-2 border-b border-border/30">
                  <span className="text-sm text-muted-foreground">Status</span>
                  <Badge
                    variant="outline"
                    className={`text-xs ${profile.status === "active" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-rose-500/10 text-rose-400 border-rose-500/20"}`}
                  >
                    {profile.status === "active" ? "Active" : "Suspended"}
                  </Badge>
                </div>
                <div className="flex items-center justify-between py-2">
                  <span className="text-sm text-muted-foreground">Referral Code</span>
                  <div className="flex items-center gap-2">
                    <code className="text-sm bg-muted/40 px-2 py-0.5 rounded font-mono">{profile.referralCode}</code>
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={copyCode}>
                      <Copy className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">Commission Summary</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>
            ) : !profile ? null : (
              <div className="space-y-4">
                <div className="flex items-center justify-between py-2 border-b border-border/30">
                  <span className="text-sm text-muted-foreground">Total Earned</span>
                  <span className="text-sm font-medium text-emerald-400">
                    ₹{Number(profile.totalCommissionEarned).toLocaleString()}
                  </span>
                </div>
                <div className="flex items-center justify-between py-2 border-b border-border/30">
                  <span className="text-sm text-muted-foreground">Total Paid</span>
                  <span className="text-sm font-medium">
                    ₹{Number(profile.totalCommissionPaid).toLocaleString()}
                  </span>
                </div>
                <div className="flex items-center justify-between py-2">
                  <span className="text-sm text-muted-foreground">Wallet Balance</span>
                  <span className="text-sm font-medium text-cyan-400">
                    ₹{Number(profile.walletBalance).toLocaleString()}
                  </span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
