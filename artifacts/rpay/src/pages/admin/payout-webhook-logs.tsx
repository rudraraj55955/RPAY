import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { Activity, ChevronLeft, ChevronRight, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { getToken } from "@/lib/auth";

type WebhookLog = {
  id: number;
  receivedAt: string;
  endpoint: string | null;
  eventType: string | null;
  status: string | null;
  signatureVerified: boolean | null;
  payoutId: number | null;
  transferId: string | null;
  cfTransferId: string | null;
  utr: string | null;
  safeError: string | null;
  processingResult: string;
};

function SigBadge({ verified }: { verified: boolean | null | undefined }) {
  if (verified === true)
    return <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-xs">✓ Verified</Badge>;
  if (verified === false)
    return <Badge className="bg-rose-500/10 text-rose-400 border-rose-500/20 text-xs">✗ Mismatch</Badge>;
  return <span className="text-muted-foreground text-xs">—</span>;
}

function ResultBadge({ result }: { result: string }) {
  if (result === "updated") return <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-xs">Updated</Badge>;
  if (result === "error") return <Badge className="bg-rose-500/10 text-rose-400 border-rose-500/20 text-xs">Error</Badge>;
  if (result === "skipped") return <Badge className="bg-amber-500/10 text-amber-400 border-amber-500/20 text-xs">Skipped</Badge>;
  return <Badge variant="outline" className="text-xs">{result}</Badge>;
}

export default function AdminPayoutWebhookLogs() {
  const [page, setPage] = useState(1);
  const [logs, setLogs] = useState<WebhookLog[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const LIMIT = 25;

  async function fetchLogs(p = page, silent = false) {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const res = await fetch(`/api/cashfree-payout/webhook-logs?page=${p}&limit=${LIMIT}`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!res.ok) throw new Error("Failed to load");
      const data = await res.json();
      setLogs(data.data ?? []);
      setTotal(data.total ?? 0);
    } catch {
      toast.error("Failed to load payout webhook logs");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useState(() => { fetchLogs(1); });

  const handlePage = (p: number) => { setPage(p); fetchLogs(p); };
  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Activity className="w-6 h-6 text-muted-foreground" />
            Payout Webhook Logs
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Inbound Cashfree Payout webhook events — signature verification status, transfer IDs, and processing results.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => fetchLogs(page, true)} disabled={refreshing}>
          {refreshing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
        </Button>
      </div>

      <Card className="border-border/50">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-border/40">
                  <TableHead className="text-xs">Received At</TableHead>
                  <TableHead className="text-xs">Event</TableHead>
                  <TableHead className="text-xs">Provider Status</TableHead>
                  <TableHead className="text-xs">Signature</TableHead>
                  <TableHead className="text-xs">Transfer ID</TableHead>
                  <TableHead className="text-xs">CF Transfer ID</TableHead>
                  <TableHead className="text-xs">UTR</TableHead>
                  <TableHead className="text-xs">Result</TableHead>
                  <TableHead className="text-xs">Error</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 9 }).map((_, j) => (
                        <TableCell key={j}><div className="h-4 bg-muted/40 rounded animate-pulse" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : logs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-16 text-muted-foreground text-sm">
                      No payout webhook events received yet.
                      <p className="text-xs mt-1 text-muted-foreground/70">
                        Configure the payout webhook URL in the Cashfree dashboard and send a test ping.
                      </p>
                    </TableCell>
                  </TableRow>
                ) : (
                  logs.map(log => (
                    <TableRow key={log.id} className="border-border/30">
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {format(new Date(log.receivedAt), "MMM d, HH:mm:ss")}
                      </TableCell>
                      <TableCell className="text-xs font-mono">
                        {log.eventType ?? <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-xs">
                        {log.status ?? <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell>
                        <SigBadge verified={log.signatureVerified} />
                      </TableCell>
                      <TableCell className="text-xs font-mono max-w-[160px] truncate" title={log.transferId ?? ""}>
                        {log.transferId ?? <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-xs font-mono max-w-[130px] truncate" title={log.cfTransferId ?? ""}>
                        {log.cfTransferId ?? <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-xs font-mono max-w-[120px] truncate" title={log.utr ?? ""}>
                        {log.utr ?? <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell>
                        <ResultBadge result={log.processingResult} />
                      </TableCell>
                      <TableCell className="text-xs text-rose-400 max-w-[200px] truncate" title={log.safeError ?? ""}>
                        {log.safeError ?? <span className="text-muted-foreground">—</span>}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>{total} total events</span>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => handlePage(Math.max(1, page - 1))} disabled={page === 1}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span>Page {page} of {totalPages}</span>
            <Button size="sm" variant="outline" onClick={() => handlePage(Math.min(totalPages, page + 1))} disabled={page >= totalPages}>
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
