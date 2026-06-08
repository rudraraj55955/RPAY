import { useState } from "react";
import { useListVirtualAccounts, useUpdateVirtualAccount, useDeleteVirtualAccount, useGetVirtualAccountTransactions } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Search, XCircle, Trash2, X, Eye, Download, Calendar } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

type VaRow = {
  id: number;
  accountNumber: string;
  ifsc: string;
  bankName: string;
  accountHolder: string;
  label?: string | null;
  balance: string;
  totalCollection: string;
  status: string;
  createdAt: string;
  merchantName?: string | null;
};

export default function AdminVirtualAccounts() {
  const qc = useQueryClient();
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [merchantName, setMerchantName] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [selectedVa, setSelectedVa] = useState<VaRow | null>(null);
  const [exporting, setExporting] = useState(false);

  const { data, isLoading } = useListVirtualAccounts({
    status: status as "active" | "closed" | "all",
    search: search || undefined,
    merchantName: merchantName || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    page,
    limit: 20,
  } as Parameters<typeof useListVirtualAccounts>[0]);

  const updateMutation = useUpdateVirtualAccount();
  const deleteMutation = useDeleteVirtualAccount();

  const { data: historyData, isLoading: historyLoading } = useGetVirtualAccountTransactions(
    selectedVa?.id ?? 0,
    { query: { enabled: !!selectedVa } as any }
  );

  const handleClose = (id: number) => {
    updateMutation.mutate({ id, data: { status: "closed" } }, {
      onSuccess: () => { toast.success("Account closed"); qc.invalidateQueries({ queryKey: ["/api/virtual-accounts"] }); },
      onError: () => toast.error("Failed to close account"),
    });
  };

  const handleDelete = (id: number) => {
    if (!confirm("Delete this virtual account?")) return;
    deleteMutation.mutate({ id }, {
      onSuccess: () => { toast.success("Virtual account deleted"); qc.invalidateQueries({ queryKey: ["/api/virtual-accounts"] }); },
      onError: () => toast.error("Failed to delete"),
    });
  };

  const clearFilters = () => {
    setSearch(""); setMerchantName(""); setStatus("all"); setDateFrom(""); setDateTo(""); setPage(1);
  };

  const hasFilters = search || merchantName || status !== "all" || dateFrom || dateTo;

  const exportCsv = async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams();
      if (status && status !== "all") params.set("status", status);
      if (search) params.set("search", search);
      if (merchantName) params.set("merchantName", merchantName);
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);

      const res = await fetch(`/api/virtual-accounts/export/csv?${params.toString()}`, { credentials: "include" });
      if (!res.ok) { toast.error("Export failed"); return; }
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `virtual-accounts-${format(new Date(), "yyyy-MM-dd")}.csv`;
      a.click();
    } catch {
      toast.error("Export failed");
    } finally {
      setExporting(false);
    }
  };

  const txList = historyData?.data ?? [];
  const txCount = txList.length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Virtual Accounts</h1>
          <p className="text-muted-foreground mt-1">Monitor all merchant virtual accounts</p>
        </div>
        <Button variant="outline" size="sm" onClick={exportCsv} disabled={exporting}>
          <Download className="w-4 h-4 mr-1.5" />{exporting ? "Exporting…" : "Export CSV"}
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col gap-3">
            {/* Row 1: search inputs + status */}
            <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
              <div className="relative flex-1 min-w-[160px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input className="pl-9" placeholder="Search account number, holder..." value={search}
                  onChange={e => { setSearch(e.target.value); setPage(1); }} />
              </div>
              <div className="relative min-w-[160px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input className="pl-9 pr-8" placeholder="Filter by merchant name..." value={merchantName}
                  onChange={e => { setMerchantName(e.target.value); setPage(1); }} />
                {merchantName && (
                  <button className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={() => setMerchantName("")}>
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <Select value={status} onValueChange={v => { setStatus(v); setPage(1); }}>
                <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="closed">Closed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {/* Row 2: date range */}
            <div className="flex flex-col sm:flex-row gap-3 items-center">
              <div className="flex items-center gap-2 flex-1">
                <Calendar className="w-4 h-4 text-muted-foreground shrink-0" />
                <Input
                  type="date"
                  className="w-[160px]"
                  value={dateFrom}
                  onChange={e => { setDateFrom(e.target.value); setPage(1); }}
                />
                <span className="text-muted-foreground text-sm">to</span>
                <Input
                  type="date"
                  className="w-[160px]"
                  value={dateTo}
                  onChange={e => { setDateTo(e.target.value); setPage(1); }}
                />
              </div>
              {hasFilters && (
                <Button variant="ghost" size="sm" onClick={clearFilters} className="text-muted-foreground hover:text-foreground">
                  <X className="w-3.5 h-3.5 mr-1.5" />Clear filters
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Merchant</TableHead>
                <TableHead>Account Holder</TableHead>
                <TableHead>Account Number</TableHead>
                <TableHead>Bank</TableHead>
                <TableHead>IFSC</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Balance</TableHead>
                <TableHead>Total Collection</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>{Array.from({ length: 10 }).map((_, j) => <TableCell key={j}><div className="h-4 bg-muted/50 rounded animate-pulse" /></TableCell>)}</TableRow>
                ))
              ) : !data?.data?.length ? (
                <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-10">No virtual accounts found</TableCell></TableRow>
              ) : (data.data as VaRow[]).map(va => (
                <TableRow key={va.id} className="cursor-pointer hover:bg-muted/30" onClick={() => setSelectedVa(va)}>
                  <TableCell className="font-medium text-sm">{va.merchantName ?? "—"}</TableCell>
                  <TableCell className="text-sm">{va.accountHolder}</TableCell>
                  <TableCell className="font-mono text-xs">{va.accountNumber}</TableCell>
                  <TableCell className="text-sm">{va.bankName}</TableCell>
                  <TableCell className="font-mono text-xs">{va.ifsc}</TableCell>
                  <TableCell onClick={e => e.stopPropagation()}>
                    <Badge variant={va.status === "active" ? "default" : "secondary"} className="text-xs">
                      {va.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-sm text-emerald-400">
                    ₹{parseFloat(va.balance || "0").toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                  </TableCell>
                  <TableCell className="font-mono text-sm text-blue-400">
                    ₹{parseFloat(va.totalCollection || "0").toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{format(new Date(va.createdAt), "MMM d, yyyy")}</TableCell>
                  <TableCell className="text-right" onClick={e => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1">
                      <Button size="icon" variant="ghost" className="h-8 w-8" title="View Transactions"
                        onClick={() => setSelectedVa(va)}>
                        <Eye className="w-4 h-4" />
                      </Button>
                      {va.status === "active" && (
                        <Button size="sm" variant="ghost" className="text-amber-500 hover:text-amber-400 hover:bg-amber-500/10 h-8 text-xs"
                          onClick={() => handleClose(va.id)}>
                          <XCircle className="w-3.5 h-3.5 mr-1" />Close
                        </Button>
                      )}
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-rose-500 hover:text-rose-400"
                        onClick={() => handleDelete(va.id)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {data && data.total > 20 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{data.total} total</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>Previous</Button>
            <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={page * 20 >= data.total}>Next</Button>
          </div>
        </div>
      )}

      {/* Transaction Drawer */}
      <Sheet open={!!selectedVa} onOpenChange={v => { if (!v) setSelectedVa(null); }}>
        <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader className="mb-4">
            <SheetTitle>Transaction History</SheetTitle>
            {selectedVa && (
              <div className="text-sm text-muted-foreground space-y-0.5">
                <p className="font-medium text-foreground">{selectedVa.merchantName ?? "Unknown Merchant"}</p>
                <p>{selectedVa.accountHolder} · {selectedVa.accountNumber} · {selectedVa.bankName}</p>
              </div>
            )}
          </SheetHeader>

          {/* Mini stats */}
          {selectedVa && (
            <div className="grid grid-cols-3 gap-3 mb-5">
              <Card>
                <CardContent className="pt-4 pb-3">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Balance</p>
                  <p className="text-lg font-bold text-emerald-400 mt-1">
                    ₹{parseFloat(selectedVa.balance || "0").toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Collected</p>
                  <p className="text-lg font-bold text-blue-400 mt-1">
                    ₹{parseFloat(selectedVa.totalCollection || "0").toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Transactions</p>
                  <p className="text-lg font-bold mt-1">{historyLoading ? "—" : txCount}</p>
                </CardContent>
              </Card>
            </div>
          )}

          {historyLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-12 bg-muted/50 rounded animate-pulse" />
              ))}
            </div>
          ) : !txList.length ? (
            <div className="text-center text-muted-foreground py-12">
              <p className="text-sm">No transactions found</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>UTR</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {txList.map(tx => (
                  <TableRow key={tx.id}>
                    <TableCell className="font-mono text-xs">#{tx.id}</TableCell>
                    <TableCell className="font-mono text-sm font-semibold">
                      ₹{parseFloat(tx.amount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs capitalize">{tx.type}</Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{tx.utr ?? "—"}</TableCell>
                    <TableCell>
                      <Badge
                        variant={tx.status === "success" ? "default" : tx.status === "failed" ? "destructive" : "secondary"}
                        className="text-xs"
                      >
                        {tx.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {format(new Date(tx.createdAt), "MMM d, yyyy HH:mm")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
