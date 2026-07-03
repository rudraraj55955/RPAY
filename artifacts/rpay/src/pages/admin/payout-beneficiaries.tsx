import { useState } from "react";
import {
  useListPayoutBeneficiaries,
  useRetryPayoutBeneficiaryProvider,
  useDisablePayoutBeneficiary,
  useEnablePayoutBeneficiary,
  getListPayoutBeneficiariesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { RotateCcw, Ban, CheckCircle2, XCircle, AlertTriangle, Lock } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

export default function AdminPayoutBeneficiaries() {
  const qc = useQueryClient();
  const [localStatus, setLocalStatus] = useState("all");

  const { data, isLoading, isError } = useListPayoutBeneficiaries();
  const filteredData =
    localStatus === "all" ? data?.data : data?.data?.filter(b => b.localStatus === localStatus);
  const retryMutation = useRetryPayoutBeneficiaryProvider();
  const disableMutation = useDisablePayoutBeneficiary();
  const enableMutation = useEnablePayoutBeneficiary();

  const invalidate = () => qc.invalidateQueries({ queryKey: getListPayoutBeneficiariesQueryKey() });

  const handleRetry = (id: number) => {
    retryMutation.mutate(
      { id },
      {
        onSuccess: (result: any) => {
          if (result?.providerStatus === "created") toast.success("Beneficiary registered with provider");
          else toast.error("Beneficiary setup failed. Check bank account, IFSC, and name.");
          invalidate();
        },
        onError: (e: any) => toast.error((e?.data as any)?.error ?? e?.message ?? "Failed to retry beneficiary"),
      }
    );
  };

  const handleDisable = (id: number) => {
    disableMutation.mutate(
      { id },
      {
        onSuccess: () => {
          toast.success("Beneficiary disabled");
          invalidate();
        },
        onError: (e: any) => toast.error((e?.data as any)?.error ?? e?.message ?? "Failed to disable beneficiary"),
      }
    );
  };

  const handleEnable = (id: number) => {
    enableMutation.mutate(
      { id },
      {
        onSuccess: () => {
          toast.success("Beneficiary enabled");
          invalidate();
        },
        onError: (e: any) => toast.error((e?.data as any)?.error ?? e?.message ?? "Failed to enable beneficiary"),
      }
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Payout Beneficiaries</h1>
        <p className="text-muted-foreground mt-1">Saved merchant beneficiaries used for payouts</p>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <Select
            value={localStatus}
            onValueChange={setLocalStatus}
          >
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="disabled">Disabled</SelectItem>
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Merchant</TableHead>
                  <TableHead>Label</TableHead>
                  <TableHead>Mode</TableHead>
                  <TableHead>Destination</TableHead>
                  <TableHead>Local Status</TableHead>
                  <TableHead>Provider Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 8 }).map((_, j) => (
                        <TableCell key={j}>
                          <div className="h-4 bg-muted/50 rounded animate-pulse" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : isError ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-10">
                      <div className="flex flex-col items-center gap-2 text-destructive">
                        <XCircle className="w-5 h-5" />
                        <p className="text-sm font-medium">Failed to load beneficiaries</p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : filteredData?.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground py-10">
                      No beneficiaries found
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredData?.map(b => {
                    const dest = b.payoutMode === "UPI" ? (b.upiIdMasked ?? "—") : `${b.bankName ?? "—"} ···${b.bankAccountLast4 ?? ""}`;
                    return (
                      <TableRow key={b.id}>
                        <TableCell className="font-medium">{b.merchantName || "—"}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {b.label || "—"}
                          {b.usedInSuccessfulPayout && (
                            <Lock className="inline-block w-3 h-3 ml-1.5 text-muted-foreground" />
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="font-mono text-xs">
                            {b.payoutMode}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground max-w-[180px] truncate">
                          {dest}
                          <p className="text-xs text-muted-foreground/70 truncate">{b.accountHolder ?? ""}</p>
                        </TableCell>
                        <TableCell>
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                              b.localStatus === "active"
                                ? "text-emerald-400 bg-emerald-500/10"
                                : "text-rose-400 bg-rose-500/10"
                            }`}
                          >
                            {b.localStatus === "active" ? "Active" : "Disabled"}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                              b.providerStatus === "created"
                                ? "text-emerald-400 bg-emerald-500/10"
                                : b.providerStatus === "failed"
                                ? "text-rose-400 bg-rose-500/10"
                                : "text-muted-foreground bg-muted/30"
                            }`}
                          >
                            {b.providerStatus === "created"
                              ? "Registered"
                              : b.providerStatus === "failed"
                              ? "Failed"
                              : "Not Registered"}
                          </span>
                          {b.lastProviderError && (
                            <p className="text-xs text-rose-400 mt-0.5 max-w-[160px] truncate" title={b.lastProviderError}>
                              {b.lastProviderError}
                            </p>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                          {format(new Date(b.createdAt), "MMM d, yyyy")}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1.5">
                            {b.providerStatus !== "created" && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-amber-500 hover:text-amber-400 hover:bg-amber-500/10"
                                onClick={() => handleRetry(b.id)}
                                disabled={retryMutation.isPending}
                                title="Retry provider registration"
                              >
                                <RotateCcw className="w-4 h-4 mr-1" />
                                Retry
                              </Button>
                            )}
                            {b.localStatus === "active" ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-rose-500 hover:text-rose-400 hover:bg-rose-500/10"
                                onClick={() => handleDisable(b.id)}
                                disabled={disableMutation.isPending}
                              >
                                <Ban className="w-4 h-4 mr-1" />
                                Disable
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-emerald-500 hover:text-emerald-400 hover:bg-emerald-500/10"
                                onClick={() => handleEnable(b.id)}
                                disabled={enableMutation.isPending}
                              >
                                <CheckCircle2 className="w-4 h-4 mr-1" />
                                Enable
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
