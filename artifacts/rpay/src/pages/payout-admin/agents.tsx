import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { UserCog } from "lucide-react";
import { getToken } from "@/lib/auth";
import { format } from "date-fns";

interface Agent {
  id: number;
  name: string;
  email: string;
  mobile: string;
  referralCode: string;
  status: string;
  walletBalance: string;
  totalCommissionEarned: string;
  createdAt: string;
}

async function fetchAgents(): Promise<Agent[]> {
  const token = getToken();
  const res = await fetch("/api/payout-admin/agents", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Failed to load agents");
  const data = await res.json();
  return data.data ?? [];
}

export default function PayoutAdminAgents() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAgents()
      .then(setAgents)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-bold tracking-tight">Agents</h1>
        <p className="text-muted-foreground">Agents onboarding payout merchants</p>
      </div>

      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <UserCog className="h-4 w-4 text-violet-400" />
            Agent List
            <Badge variant="outline" className="ml-1 text-xs">{agents.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>
          ) : agents.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              No agents yet. Create an agent from the Admin portal.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/40">
                    <th className="text-left py-2 pr-4 text-xs font-medium text-muted-foreground">Name</th>
                    <th className="text-left py-2 pr-4 text-xs font-medium text-muted-foreground">Email</th>
                    <th className="text-left py-2 pr-4 text-xs font-medium text-muted-foreground">Referral Code</th>
                    <th className="text-left py-2 pr-4 text-xs font-medium text-muted-foreground">Status</th>
                    <th className="text-left py-2 pr-4 text-xs font-medium text-muted-foreground">Commission Earned</th>
                    <th className="text-left py-2 text-xs font-medium text-muted-foreground">Joined</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/30">
                  {agents.map((a) => (
                    <tr key={a.id} className="hover:bg-muted/20 transition-colors">
                      <td className="py-3 pr-4">
                        <p className="font-medium">{a.name}</p>
                        <p className="text-xs text-muted-foreground">{a.mobile}</p>
                      </td>
                      <td className="py-3 pr-4 text-muted-foreground">{a.email}</td>
                      <td className="py-3 pr-4">
                        <code className="text-xs bg-muted/40 px-2 py-0.5 rounded">{a.referralCode}</code>
                      </td>
                      <td className="py-3 pr-4">
                        <Badge
                          variant="outline"
                          className={`text-xs ${a.status === "active" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-rose-500/10 text-rose-400 border-rose-500/20"}`}
                        >
                          {a.status === "active" ? "Active" : "Suspended"}
                        </Badge>
                      </td>
                      <td className="py-3 pr-4 font-medium text-emerald-400">
                        ₹{Number(a.totalCommissionEarned).toLocaleString()}
                      </td>
                      <td className="py-3 text-xs text-muted-foreground">
                        {a.createdAt ? format(new Date(a.createdAt), "dd MMM yyyy") : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
