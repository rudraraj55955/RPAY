import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Settings } from "lucide-react";

export default function PayoutAdminSettings() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-bold tracking-tight">Payout Settings</h1>
        <p className="text-muted-foreground">Payout admin configuration</p>
      </div>
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <Settings className="h-4 w-4 text-primary" />
            Settings
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-16 text-center gap-4">
            <Settings className="h-12 w-12 text-muted-foreground/30" />
            <div>
              <p className="font-medium text-muted-foreground">Provider settings are managed by Super Admin.</p>
              <p className="text-sm text-muted-foreground/60 mt-1">Payout admin settings — coming in Phase 6 (Multi-Provider Router).</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
