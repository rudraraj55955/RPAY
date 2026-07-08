import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Activity, ExternalLink } from "lucide-react";

export default function PayoutAdminAuditLogs() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-bold tracking-tight">Audit Logs</h1>
        <p className="text-muted-foreground">Payout operation audit trail</p>
      </div>

      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <Activity className="h-4 w-4 text-cyan-400" />
            Payout Audit Logs
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-16 text-center gap-4">
            <Activity className="h-12 w-12 text-muted-foreground/30" />
            <div>
              <p className="font-medium text-muted-foreground">Payout audit logs are shared with the main admin audit trail.</p>
              <p className="text-sm text-muted-foreground/60 mt-1">Filter by "payout" module actions to see payout-specific events.</p>
            </div>
            <p className="text-xs text-muted-foreground/50">Full dedicated payout audit log page — coming in Phase 4.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
