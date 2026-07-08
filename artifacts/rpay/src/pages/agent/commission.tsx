import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BookOpen } from "lucide-react";

export default function AgentCommission() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-bold tracking-tight">Commission Ledger</h1>
        <p className="text-muted-foreground">Your commission history and payouts</p>
      </div>
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <BookOpen className="h-4 w-4 text-cyan-400" />
            Commission History
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
            <BookOpen className="h-12 w-12 text-muted-foreground/30" />
            <p className="text-sm font-medium text-muted-foreground">Commission engine coming in Phase 4.</p>
            <p className="text-xs text-muted-foreground/60">
              Commission will be calculated from admin profit only — never from payout principal, GST, or provider cost.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
