import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertTriangle, Trash2, History, RefreshCw, ShieldCheck, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  useDryRunDummyDataCleanup,
  useConfirmDummyDataCleanup,
  useGetDummyDataCleanupHistory,
  useGetMe,
} from "@workspace/api-client-react";

const CONFIRM_PHRASE = "CLEAN_DUMMY_DATA";

export default function AdminDataHygiene() {
  const { data: me } = useGetMe();
  const [confirmText, setConfirmText] = useState("");
  const [hasRunDryRun, setHasRunDryRun] = useState(false);

  const dryRun = useDryRunDummyDataCleanup({ query: { enabled: false, queryKey: ["dummy-data-dry-run"] } });
  const history = useGetDummyDataCleanupHistory();
  const confirmCleanup = useConfirmDummyDataCleanup();

  const isSuperAdmin = me?.isSuperAdmin ?? false;

  if (!isSuperAdmin) {
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Super Admin only</AlertTitle>
          <AlertDescription>This section is restricted to Super Admin accounts.</AlertDescription>
        </Alert>
      </div>
    );
  }

  const findings = dryRun.data?.findings ?? [];
  const totalRows = dryRun.data?.totalRows ?? 0;

  async function runDryRun() {
    setHasRunDryRun(false);
    const res = await dryRun.refetch();
    if (res.data) setHasRunDryRun(true);
  }

  function handleConfirm() {
    if (confirmText !== CONFIRM_PHRASE) {
      toast.error(`Type exactly "${CONFIRM_PHRASE}" to confirm`);
      return;
    }
    confirmCleanup.mutate(
      { data: { confirm: CONFIRM_PHRASE } },
      {
        onSuccess: (data) => {
          toast.success(`Deleted ${data.totalRowsDeleted} dummy rows across ${data.results.length} tables`);
          setConfirmText("");
          setHasRunDryRun(false);
          dryRun.refetch();
          history.refetch();
        },
        onError: () => toast.error("Cleanup failed. No changes were made outside the affected tables."),
      }
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <ShieldCheck className="h-6 w-6 text-primary" /> Data Hygiene — Dummy Data Cleanup
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Detect and remove seeded/demo/test data. The 3 documented demo merchant logins are never deleted
          (required for docs/health checks) — only their seeded transaction/payout/wallet history is cleaned.
          Real merchants, admins, provider settings, and live payout rows (including small ₹1/₹10 test amounts) are never touched.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Step 1 — Dry Run</CardTitle>
          <CardDescription>Shows exactly what would be deleted. Nothing is deleted at this step.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button onClick={runDryRun} disabled={dryRun.isFetching}>
            {dryRun.isFetching ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            Run Dry Run
          </Button>

          {hasRunDryRun && (
            <div className="space-y-3">
              <div className="flex items-center gap-3 text-sm">
                <Badge variant={totalRows > 0 ? "destructive" : "secondary"}>{totalRows} dummy rows detected</Badge>
                <span className="text-muted-foreground">
                  {dryRun.data?.protectedDemoMerchantCount ?? 0} protected demo merchant(s) kept ·{" "}
                  {dryRun.data?.deletableDummyMerchantCount ?? 0} dummy merchant(s) eligible for deletion
                </span>
              </div>

              {findings.length === 0 ? (
                <Alert>
                  <AlertTitle>No dummy data found</AlertTitle>
                  <AlertDescription>Database is already clean.</AlertDescription>
                </Alert>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Table</TableHead>
                      <TableHead>Rows</TableHead>
                      <TableHead>Sample IDs</TableHead>
                      <TableHead>Reason</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {findings.map((f) => (
                      <TableRow key={f.table}>
                        <TableCell className="font-medium">{f.table}</TableCell>
                        <TableCell>{f.count}</TableCell>
                        <TableCell className="text-muted-foreground">{f.sampleIds.join(", ")}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{f.reason}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {hasRunDryRun && totalRows > 0 && (
        <Card className="border-destructive/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="h-5 w-5" /> Step 2 — Confirm Cleanup
            </CardTitle>
            <CardDescription>
              This permanently deletes the {totalRows} rows shown above. This action is audit-logged and cannot be undone.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="confirm-phrase">Type "{CONFIRM_PHRASE}" to confirm</Label>
              <Input
                id="confirm-phrase"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder={CONFIRM_PHRASE}
              />
            </div>
            <Button
              variant="destructive"
              onClick={handleConfirm}
              disabled={confirmCleanup.isPending || confirmText !== CONFIRM_PHRASE}
            >
              {confirmCleanup.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Trash2 className="h-4 w-4 mr-2" />}
              Confirm & Delete
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-5 w-5" /> Cleanup History
          </CardTitle>
        </CardHeader>
        <CardContent>
          {(history.data?.history?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">No cleanup runs yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Performed By</TableHead>
                  <TableHead>Table</TableHead>
                  <TableHead>Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.data!.history.map((h) => (
                  <TableRow key={h.id}>
                    <TableCell>{new Date(h.createdAt).toLocaleString()}</TableCell>
                    <TableCell>{h.adminEmail}</TableCell>
                    <TableCell>{h.targetType}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{h.details}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
