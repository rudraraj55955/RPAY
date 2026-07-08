import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Users, Search } from "lucide-react";
import { getToken } from "@/lib/auth";
import { format } from "date-fns";

interface PayoutMerchant {
  id: number;
  businessName: string;
  email: string;
  contactName: string;
  phone: string;
  merchantType: string;
  status: string;
  payoutServiceEnabled: boolean;
  agentId: number | null;
  createdAt: string;
}

async function fetchMerchants(): Promise<PayoutMerchant[]> {
  const token = getToken();
  const res = await fetch("/api/payout-admin/payout-merchants", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Failed to load merchants");
  const data = await res.json();
  return data.data ?? [];
}

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  approved: { label: "Active",    className: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
  pending:  { label: "Pending",   className: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
  suspended:{ label: "Suspended", className: "bg-rose-500/10 text-rose-400 border-rose-500/20" },
  rejected: { label: "Rejected",  className: "bg-muted text-muted-foreground" },
};

export default function PayoutAdminMerchants() {
  const [merchants, setMerchants] = useState<PayoutMerchant[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    fetchMerchants()
      .then(setMerchants)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const filtered = merchants.filter((m) => {
    const q = search.toLowerCase();
    return (
      m.businessName?.toLowerCase().includes(q) ||
      m.email?.toLowerCase().includes(q) ||
      m.contactName?.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-bold tracking-tight">Payout Merchants</h1>
        <p className="text-muted-foreground">Merchants using payout services</p>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by name, email…"
          className="pl-9"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <Users className="h-4 w-4 text-primary" />
            Payout Merchants
            <Badge variant="outline" className="ml-1 text-xs">{filtered.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              {search ? "No merchants match your search." : "No payout merchants found."}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/40">
                    <th className="text-left py-2 pr-4 text-xs font-medium text-muted-foreground">Business</th>
                    <th className="text-left py-2 pr-4 text-xs font-medium text-muted-foreground">Email</th>
                    <th className="text-left py-2 pr-4 text-xs font-medium text-muted-foreground">Type</th>
                    <th className="text-left py-2 pr-4 text-xs font-medium text-muted-foreground">Status</th>
                    <th className="text-left py-2 pr-4 text-xs font-medium text-muted-foreground">Payout Service</th>
                    <th className="text-left py-2 text-xs font-medium text-muted-foreground">Created</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/30">
                  {filtered.map((m) => {
                    const badge = STATUS_BADGE[m.status] ?? STATUS_BADGE["pending"];
                    return (
                      <tr key={m.id} className="hover:bg-muted/20 transition-colors">
                        <td className="py-3 pr-4">
                          <p className="font-medium">{m.businessName}</p>
                          <p className="text-xs text-muted-foreground">{m.contactName}</p>
                        </td>
                        <td className="py-3 pr-4 text-muted-foreground">{m.email}</td>
                        <td className="py-3 pr-4">
                          <Badge variant="outline" className="text-xs border-border/40">{m.merchantType}</Badge>
                        </td>
                        <td className="py-3 pr-4">
                          <Badge variant="outline" className={`text-xs ${badge.className}`}>{badge.label}</Badge>
                        </td>
                        <td className="py-3 pr-4">
                          <Badge
                            variant="outline"
                            className={`text-xs ${m.payoutServiceEnabled ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-muted text-muted-foreground"}`}
                          >
                            {m.payoutServiceEnabled ? "Enabled" : "Disabled"}
                          </Badge>
                        </td>
                        <td className="py-3 text-muted-foreground text-xs">
                          {m.createdAt ? format(new Date(m.createdAt), "dd MMM yyyy") : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
