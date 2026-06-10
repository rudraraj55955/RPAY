import { useState, useRef } from "react";
import { useListTransactions, useSearchByUtr } from "@workspace/api-client-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Download, Search, X, Info, Sparkles, Zap } from "lucide-react";
import { format, subDays, startOfMonth, endOfMonth, subMonths, startOfWeek, endOfWeek, startOfDay, endOfDay } from "date-fns";
import { getToken } from "@/lib/auth";

function highlightUtr(utr: string, search: string) {
  if (!search) return <>{utr}</>;
  const idx = utr.toLowerCase().indexOf(search.toLowerCase());
  if (idx === -1) return <>{utr}</>;
  return (
    <>
      {utr.slice(0, idx)}
      <mark className="bg-amber-400/30 text-amber-200 rounded-sm px-0.5 not-italic font-semibold">
        {utr.slice(idx, idx + search.length)}
      </mark>
      {utr.slice(idx + search.length)}
    </>
  );
}

const DATE_PRESETS = [
  {
    label: "Last 7 days",
    getRange: () => {
      const to = new Date();
      const from = subDays(to, 6);
      return { from: format(from, "yyyy-MM-dd"), to: format(to, "yyyy-MM-dd") };
    },
  },
  {
    label: "Last 30 days",
    getRange: () => {
      const to = new Date();
      const from = subDays(to, 29);
      return { from: format(from, "yyyy-MM-dd"), to: format(to, "yyyy-MM-dd") };
    },
  },
  {
    label: "This month",
    getRange: () => {
      const now = new Date();
      return {
        from: format(startOfMonth(now), "yyyy-MM-dd"),
        to: format(endOfMonth(now), "yyyy-MM-dd"),
      };
    },
  },
  {
    label: "Last month",
    getRange: () => {
      const prev = subMonths(new Date(), 1);
      return {
        from: format(startOfMonth(prev), "yyyy-MM-dd"),
        to: format(endOfMonth(prev), "yyyy-MM-dd"),
      };
    },
  },
];

interface SmartFilter {
  type: "amount" | "date";
  label: string;
  amountMin?: number;
  amountMax?: number;
  dateFrom?: string;
  dateTo?: string;
}

function parseSmartQuery(raw: string): SmartFilter | null {
  const q = raw.trim().toLowerCase();
  if (!q) return null;

  // Date shortcuts
  const now = new Date();
  if (q === "today") {
    return {
      type: "date",
      label: "Today",
      dateFrom: format(startOfDay(now), "yyyy-MM-dd"),
      dateTo: format(endOfDay(now), "yyyy-MM-dd"),
    };
  }
  if (q === "this week") {
    return {
      type: "date",
      label: "This week",
      dateFrom: format(startOfWeek(now, { weekStartsOn: 1 }), "yyyy-MM-dd"),
      dateTo: format(endOfWeek(now, { weekStartsOn: 1 }), "yyyy-MM-dd"),
    };
  }
  if (q === "this month") {
    return {
      type: "date",
      label: "This month",
      dateFrom: format(startOfMonth(now), "yyyy-MM-dd"),
      dateTo: format(endOfMonth(now), "yyyy-MM-dd"),
    };
  }
  if (q === "last month") {
    const prev = subMonths(now, 1);
    return {
      type: "date",
      label: "Last month",
      dateFrom: format(startOfMonth(prev), "yyyy-MM-dd"),
      dateTo: format(endOfMonth(prev), "yyyy-MM-dd"),
    };
  }
  if (q === "last week") {
    const prevWeekStart = startOfWeek(subDays(now, 7), { weekStartsOn: 1 });
    const prevWeekEnd = endOfWeek(subDays(now, 7), { weekStartsOn: 1 });
    return {
      type: "date",
      label: "Last week",
      dateFrom: format(prevWeekStart, "yyyy-MM-dd"),
      dateTo: format(prevWeekEnd, "yyyy-MM-dd"),
    };
  }

  // Amount patterns
  // >500 or >=500
  const gtMatch = q.match(/^(>=?)(\d+(?:\.\d+)?)$/);
  if (gtMatch) {
    const inclusive = gtMatch[1] === ">=";
    const val = parseFloat(gtMatch[2]!);
    const min = inclusive ? val : val + 0.01;
    return { type: "amount", label: `≥ ₹${val.toLocaleString()}`, amountMin: min };
  }

  // <500 or <=500
  const ltMatch = q.match(/^(<=?)(\d+(?:\.\d+)?)$/);
  if (ltMatch) {
    const inclusive = ltMatch[1] === "<=";
    const val = parseFloat(ltMatch[2]!);
    const max = inclusive ? val : val - 0.01;
    return { type: "amount", label: `≤ ₹${val.toLocaleString()}`, amountMax: max };
  }

  // 100-999 range
  const rangeMatch = q.match(/^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)$/);
  if (rangeMatch) {
    const min = parseFloat(rangeMatch[1]!);
    const max = parseFloat(rangeMatch[2]!);
    if (min <= max) {
      return {
        type: "amount",
        label: `₹${min.toLocaleString()} – ₹${max.toLocaleString()}`,
        amountMin: min,
        amountMax: max,
      };
    }
  }

  return null;
}

const PROVIDER_LABELS: Record<string, string> = {
  phonepe: "PhonePe",
  paytm: "Paytm",
  bharatpe: "BharatPe",
  yono_sbi: "YONO SBI",
  hdfc_smarthub: "HDFC SmartHub",
  upi_id: "UPI",
};

function formatProvider(p: string | null | undefined): string {
  if (!p) return "—";
  return PROVIDER_LABELS[p] ?? p.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function ProviderBadge({ provider }: { provider: string | null | undefined }) {
  if (!provider) return <span className="text-muted-foreground text-xs">—</span>;
  return (
    <Badge variant="outline" className="text-xs gap-1 border-violet-500/30 text-violet-300 bg-violet-500/10">
      <Zap className="w-3 h-3" />
      {formatProvider(provider)}
    </Badge>
  );
}

export default function MerchantTransactions() {
  const [type, setType] = useState("all");
  const [status, setStatus] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [utrSearch, setUtrSearch] = useState("");
  const [utrInput, setUtrInput] = useState("");

  // Smart search bar state
  const [smartInput, setSmartInput] = useState("");
  const [smartFilter, setSmartFilter] = useState<SmartFilter | null>(null);
  const [smartError, setSmartError] = useState("");
  const smartInputRef = useRef<HTMLInputElement>(null);

  const amountMin = smartFilter?.type === "amount" ? smartFilter.amountMin : undefined;
  const amountMax = smartFilter?.type === "amount" ? smartFilter.amountMax : undefined;
  const smartDateFrom = smartFilter?.type === "date" ? smartFilter.dateFrom : undefined;
  const smartDateTo = smartFilter?.type === "date" ? smartFilter.dateTo : undefined;

  // Smart date filter overrides manual date pickers when active
  const activeDateFrom = smartDateFrom ?? dateFrom;
  const activeDateTo = smartDateTo ?? dateTo;

  const { data, isLoading } = useListTransactions({
    type: type as any,
    status: status as any,
    page,
    limit: 20,
    search: utrSearch || undefined,
    ...(activeDateFrom ? { dateFrom: activeDateFrom } : {}),
    ...(activeDateTo ? { dateTo: activeDateTo } : {}),
    ...(amountMin != null ? { amountMin } : {}),
    ...(amountMax != null ? { amountMax } : {}),
  });
  const { data: utrResult, isLoading: utrLoading, error: utrError } = useSearchByUtr(
    { utr: utrSearch || "" },
    { query: { enabled: !!utrSearch } as any }
  );

  const applyPreset = (preset: (typeof DATE_PRESETS)[number]) => {
    const { from, to } = preset.getRange();
    setDateFrom(from);
    setDateTo(to);
    setPage(1);
    // Clear any date-type smart filter when preset applied
    if (smartFilter?.type === "date") {
      setSmartFilter(null);
      setSmartInput("");
    }
  };

  const isPresetActive = (preset: (typeof DATE_PRESETS)[number]) => {
    const { from, to } = preset.getRange();
    return activeDateFrom === from && activeDateTo === to;
  };

  const applySmartSearch = () => {
    setSmartError("");
    const filter = parseSmartQuery(smartInput);
    if (!filter) {
      setSmartError("Try: >500, 100-999, today, this week, this month");
      return;
    }
    setSmartFilter(filter);
    // If it's a date filter, clear the manual date pickers
    if (filter.type === "date") {
      setDateFrom("");
      setDateTo("");
    }
    setPage(1);
  };

  const clearSmartFilter = () => {
    setSmartFilter(null);
    setSmartInput("");
    setSmartError("");
    setPage(1);
    smartInputRef.current?.focus();
  };

  const exportCsv = async () => {
    const params = new URLSearchParams();
    if (type && type !== "all") params.set("type", type);
    if (status && status !== "all") params.set("status", status);
    if (utrSearch) params.set("search", utrSearch);
    if (activeDateFrom) params.set("dateFrom", activeDateFrom);
    if (activeDateTo) params.set("dateTo", activeDateTo);
    if (amountMin != null) params.set("amountMin", String(amountMin));
    if (amountMax != null) params.set("amountMax", String(amountMax));
    const url = `/api/transactions/export/csv?${params.toString()}`;
    const token = getToken();
    const res = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "transactions.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const hasSmartFilter = smartFilter !== null;
  const hasUtrSearch = !!utrSearch;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><h1 className="text-3xl font-bold tracking-tight">Transactions</h1><p className="text-muted-foreground mt-1">Your payment history</p></div>
        <Button variant="outline" size="sm" onClick={exportCsv}><Download className="w-4 h-4 mr-2" />Export CSV</Button>
      </div>

      {/* Smart Search Bar */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Smart Search</p>
          <div className="flex gap-3">
            <div className="relative flex-1">
              <Sparkles className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-violet-400" />
              <Input
                ref={smartInputRef}
                className="pl-9"
                placeholder="Try: >500  ·  100-999  ·  today  ·  this week  ·  this month"
                value={smartInput}
                onChange={e => { setSmartInput(e.target.value); setSmartError(""); }}
                onKeyDown={e => { if (e.key === "Enter") applySmartSearch(); }}
              />
            </div>
            <Button onClick={applySmartSearch} disabled={!smartInput.trim()}>
              <Search className="w-4 h-4 mr-2" />Apply
            </Button>
          </div>
          {smartError && (
            <p className="mt-2 text-xs text-amber-400">{smartError}</p>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            Amount ranges: <span className="font-mono text-foreground/60">{">500"}</span>, <span className="font-mono text-foreground/60">{"<=1000"}</span>, <span className="font-mono text-foreground/60">{"200-999"}</span> — Date shortcuts: <span className="font-mono text-foreground/60">today</span>, <span className="font-mono text-foreground/60">this week</span>, <span className="font-mono text-foreground/60">this month</span>, <span className="font-mono text-foreground/60">last month</span>
          </p>
        </CardContent>
      </Card>

      {/* UTR Search */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Search by UTR</p>
          <div className="flex gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input className="pl-9 font-mono" placeholder="Enter UTR number..." value={utrInput} onChange={e => setUtrInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { setUtrSearch(utrInput); setPage(1); } }} />
            </div>
            <Button onClick={() => { setUtrSearch(utrInput); setPage(1); }} disabled={!utrInput}>Search</Button>
            {utrSearch && <Button variant="ghost" size="icon" onClick={() => { setUtrSearch(""); setUtrInput(""); setPage(1); }}><X className="w-4 h-4" /></Button>}
          </div>
          {utrSearch && (
            <div className="mt-3 p-3 rounded-lg border bg-card/50">
              {utrLoading && <p className="text-sm text-muted-foreground">Searching...</p>}
              {utrError && <p className="text-sm text-rose-500">No transaction found for UTR: {utrSearch}</p>}
              {utrResult && (
                <div className="flex flex-wrap gap-4 text-sm">
                  <div><span className="text-muted-foreground">UTR:</span> <span className="font-mono font-medium">{highlightUtr(utrResult.utr, utrSearch)}</span></div>
                  <div><span className="text-muted-foreground">Amount:</span> <span className="font-semibold">₹{Number(utrResult.amount).toLocaleString()}</span></div>
                  <div><span className="text-muted-foreground">Type:</span> <Badge variant="outline">{utrResult.type}</Badge></div>
                  <div><span className="text-muted-foreground">Status:</span> <StatusBadge status={utrResult.status} /></div>
                  <div><span className="text-muted-foreground">Date:</span> {format(new Date(utrResult.createdAt), "MMM d, yyyy HH:mm")}</div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Active filter chips */}
      {(hasSmartFilter || hasUtrSearch) && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground font-medium">Active filters:</span>
          {hasSmartFilter && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-500/40 bg-violet-500/10 px-3 py-1 text-xs font-medium text-violet-300">
              <Sparkles className="w-3 h-3" />
              {smartFilter!.label}
              <button
                onClick={clearSmartFilter}
                className="ml-0.5 rounded-full p-0.5 hover:bg-violet-500/20 transition-colors"
                aria-label="Remove smart filter"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          )}
          {hasUtrSearch && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-300">
              <Info className="w-3 h-3" />
              UTR: <span className="font-mono">{utrSearch}</span>
              <button
                onClick={() => { setUtrSearch(""); setUtrInput(""); setPage(1); }}
                className="ml-0.5 rounded-full p-0.5 hover:bg-amber-500/20 transition-colors"
                aria-label="Clear UTR filter"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          )}
        </div>
      )}

      <Card>
        <CardHeader className="pb-4">
          <div className="space-y-3">
            <div className="flex flex-wrap gap-3 items-center">
              <Select value={type} onValueChange={v => { setType(v); setPage(1); }}>
                <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="deposit">Deposit</SelectItem>
                  <SelectItem value="withdrawal">Withdrawal</SelectItem>
                </SelectContent>
              </Select>
              <Select value={status} onValueChange={v => { setStatus(v); setPage(1); }}>
                <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="success">Success</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-wrap gap-2 items-center">
              <span className="text-xs text-muted-foreground font-medium mr-1">Date range:</span>
              {DATE_PRESETS.map(preset => (
                <Button
                  key={preset.label}
                  variant={isPresetActive(preset) ? "secondary" : "outline"}
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => applyPreset(preset)}
                >
                  {preset.label}
                </Button>
              ))}
              <div className="flex items-center gap-2 ml-1">
                <Input
                  type="date"
                  className="w-[150px] h-8 text-xs [color-scheme:dark]"
                  value={smartFilter?.type === "date" ? (smartFilter.dateFrom ?? "") : dateFrom}
                  onChange={e => {
                    if (smartFilter?.type === "date") return;
                    setDateFrom(e.target.value);
                    setPage(1);
                  }}
                  title="From date"
                  readOnly={smartFilter?.type === "date"}
                />
                <span className="text-muted-foreground text-sm">to</span>
                <Input
                  type="date"
                  className="w-[150px] h-8 text-xs [color-scheme:dark]"
                  value={smartFilter?.type === "date" ? (smartFilter.dateTo ?? "") : dateTo}
                  onChange={e => {
                    if (smartFilter?.type === "date") return;
                    setDateTo(e.target.value);
                    setPage(1);
                  }}
                  title="To date"
                  readOnly={smartFilter?.type === "date"}
                />
              </div>
              {(dateFrom || dateTo || smartFilter?.type === "date") && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground h-8 px-2"
                  onClick={() => {
                    setDateFrom("");
                    setDateTo("");
                    if (smartFilter?.type === "date") clearSmartFilter();
                    setPage(1);
                  }}
                >
                  <X className="w-3 h-3 mr-1" />Clear
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>UTR</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead>Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={i}>{Array.from({ length: 7 }).map((_, j) => <TableCell key={j}><div className="h-4 bg-muted/50 rounded animate-pulse" /></TableCell>)}</TableRow>
              )) : data?.data?.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-10">No transactions found</TableCell></TableRow>
              ) : data?.data?.map(tx => (
                <TableRow key={tx.id} className={utrSearch ? "bg-amber-500/5 ring-1 ring-inset ring-amber-500/20" : ""}>
                  <TableCell className="font-mono text-xs">{highlightUtr(tx.utr ?? "", utrSearch)}</TableCell>
                  <TableCell><Badge variant="outline" className="text-xs">{tx.type}</Badge></TableCell>
                  <TableCell><StatusBadge status={tx.status} /></TableCell>
                  <TableCell><ProviderBadge provider={tx.connectionProvider} /></TableCell>
                  <TableCell className="text-right font-mono font-semibold">₹{Number(tx.amount).toLocaleString()}</TableCell>
                  <TableCell className="text-xs text-muted-foreground font-mono">{tx.referenceId || "—"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{format(new Date(tx.createdAt), "MMM d, HH:mm")}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {data && data.total > 20 && (
        <div className="flex justify-between items-center">
          <span className="text-sm text-muted-foreground">{data.total} total</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>Previous</Button>
            <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={page * 20 >= data.total}>Next</Button>
          </div>
        </div>
      )}
    </div>
  );
}
