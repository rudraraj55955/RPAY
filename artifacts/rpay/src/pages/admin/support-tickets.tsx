import { useState } from "react";
import {
  useListSupportTickets,
  useGetSupportTicket,
  useUpdateTicketStatus,
  useAddTicketReply,
  useGetSupportTicketStats,
  getListSupportTicketsQueryKey,
  getGetSupportTicketQueryKey,
  getGetSupportTicketStatsQueryKey,
  ListSupportTicketsStatus,
  UpdateTicketStatusInputStatus,
  UpdateTicketStatusInputPriority,
  type SupportTicket,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Headphones, ChevronLeft, ChevronRight, Send, Loader2, Search, CheckCircle, Clock, AlertCircle, Inbox } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow, format } from "date-fns";

const STATUS_STYLE: Record<string, string> = {
  open: "text-sky-400 border-sky-500/30 bg-sky-500/10",
  "in-progress": "text-amber-400 border-amber-500/30 bg-amber-500/10",
  resolved: "text-emerald-400 border-emerald-500/30 bg-emerald-500/10",
};

const PRIORITY_STYLE: Record<string, string> = {
  low: "text-muted-foreground border-muted-foreground/30",
  normal: "text-blue-400 border-blue-500/30 bg-blue-500/10",
  high: "text-orange-400 border-orange-500/30 bg-orange-500/10",
  urgent: "text-red-400 border-red-500/30 bg-red-500/10",
};

const CATEGORY_LABELS: Record<string, string> = {
  payments: "Payments",
  account: "Account",
  technical: "Technical",
  billing: "Billing",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant="outline" className={STATUS_STYLE[status] ?? ""}>
      {status === "in-progress" ? "In Progress" : status.charAt(0).toUpperCase() + status.slice(1)}
    </Badge>
  );
}

function PriorityBadge({ priority }: { priority: string }) {
  return (
    <Badge variant="outline" className={PRIORITY_STYLE[priority] ?? ""}>
      {priority.charAt(0).toUpperCase() + priority.slice(1)}
    </Badge>
  );
}

function TicketDetailSheet({
  ticketId,
  open,
  onClose,
}: {
  ticketId: number | null;
  open: boolean;
  onClose: () => void;
}) {
  const [replyMessage, setReplyMessage] = useState("");
  const [statusVal, setStatusVal] = useState("");
  const [priorityVal, setPriorityVal] = useState("");
  const qc = useQueryClient();

  const { data, isLoading } = useGetSupportTicket(
    ticketId ?? 0,
    { query: { enabled: ticketId != null && open, queryKey: getGetSupportTicketQueryKey(ticketId ?? 0) } }
  );

  const replyMutation = useAddTicketReply();
  const statusMutation = useUpdateTicketStatus();

  const ticket = data?.ticket;
  const replies = data?.replies ?? [];

  function invalidateAll() {
    if (!ticketId) return;
    qc.invalidateQueries({ queryKey: getGetSupportTicketQueryKey(ticketId) });
    qc.invalidateQueries({ queryKey: getListSupportTicketsQueryKey() });
    qc.invalidateQueries({ queryKey: getGetSupportTicketStatsQueryKey() });
  }

  function handleSendReply() {
    if (!replyMessage.trim() || !ticketId) return;
    replyMutation.mutate(
      { id: ticketId, data: { message: replyMessage.trim() } },
      {
        onSuccess: () => {
          toast.success("Reply sent");
          setReplyMessage("");
          invalidateAll();
        },
        onError: () => toast.error("Failed to send reply"),
      }
    );
  }

  function handleUpdateStatus() {
    if (!ticketId || (!statusVal && !priorityVal)) return;
    statusMutation.mutate(
      {
        id: ticketId,
        data: {
          status: statusVal ? (statusVal as UpdateTicketStatusInputStatus) : undefined,
          priority: priorityVal ? (priorityVal as UpdateTicketStatusInputPriority) : undefined,
        },
      },
      {
        onSuccess: () => {
          toast.success("Ticket updated");
          setStatusVal("");
          setPriorityVal("");
          invalidateAll();
        },
        onError: () => toast.error("Failed to update ticket"),
      }
    );
  }

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) { onClose(); setStatusVal(""); setPriorityVal(""); } }}>
      <SheetContent className="w-full sm:max-w-2xl flex flex-col gap-0 p-0">
        <SheetHeader className="p-6 pb-4 border-b border-border/50">
          <SheetTitle className="text-left text-base">
            {isLoading ? "Loading..." : ticket?.subject ?? "Ticket"}
          </SheetTitle>
          {ticket && (
            <div className="flex flex-wrap gap-2 mt-1">
              <StatusBadge status={ticket.status} />
              <PriorityBadge priority={ticket.priority} />
              <Badge variant="outline" className="text-muted-foreground">
                {CATEGORY_LABELS[ticket.category] ?? ticket.category}
              </Badge>
              {ticket.merchantName && (
                <Badge variant="outline" className="text-purple-400 border-purple-500/30 bg-purple-500/10">
                  {ticket.merchantName}
                </Badge>
              )}
            </div>
          )}
        </SheetHeader>

        {ticket && (
          <div className="px-6 py-3 border-b border-border/50 bg-muted/20">
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Update Status</Label>
                <Select value={statusVal} onValueChange={setStatusVal}>
                  <SelectTrigger className="h-8 w-36 text-xs">
                    <SelectValue placeholder={ticket.status === "in-progress" ? "In Progress" : ticket.status} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="open">Open</SelectItem>
                    <SelectItem value="in-progress">In Progress</SelectItem>
                    <SelectItem value="resolved">Resolved</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Priority</Label>
                <Select value={priorityVal} onValueChange={setPriorityVal}>
                  <SelectTrigger className="h-8 w-32 text-xs">
                    <SelectValue placeholder={ticket.priority} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="normal">Normal</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="urgent">Urgent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={handleUpdateStatus}
                disabled={(!statusVal && !priorityVal) || statusMutation.isPending}
                className="h-8"
              >
                {statusMutation.isPending && <Loader2 className="w-3 h-3 animate-spin mr-1" />}
                Apply
              </Button>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {isLoading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {ticket && (
            <div className="rounded-lg bg-muted/30 border border-border/50 p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-muted-foreground">
                  Merchant{ticket.merchantName ? ` · ${ticket.merchantName}` : ""}
                </span>
                <span className="text-xs text-muted-foreground">
                  {format(new Date(ticket.createdAt), "dd MMM yyyy, HH:mm")}
                </span>
              </div>
              <p className="text-sm leading-relaxed whitespace-pre-wrap">{ticket.message}</p>
              {ticket.screenshotUrl && (
                <a
                  href={ticket.screenshotUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-block text-xs text-sky-400 underline"
                >
                  View screenshot
                </a>
              )}
            </div>
          )}

          {replies.map((reply) => (
            <div
              key={reply.id}
              className={`rounded-lg border p-4 ${
                reply.authorRole === "admin"
                  ? "bg-sky-950/20 border-sky-500/20 mr-4"
                  : "bg-muted/30 border-border/50 ml-4"
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-muted-foreground">
                  {reply.authorRole === "admin"
                    ? `Support · ${reply.authorName ?? "Admin"}`
                    : `Merchant · ${reply.authorName ?? "User"}`}
                </span>
                <span className="text-xs text-muted-foreground">
                  {format(new Date(reply.createdAt), "dd MMM yyyy, HH:mm")}
                </span>
              </div>
              <p className="text-sm leading-relaxed whitespace-pre-wrap">{reply.message}</p>
            </div>
          ))}
        </div>

        <div className="border-t border-border/50 p-4 space-y-2">
          <Textarea
            placeholder="Type your reply..."
            value={replyMessage}
            onChange={(e) => setReplyMessage(e.target.value)}
            className="min-h-[80px] resize-none"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleSendReply();
            }}
          />
          <div className="flex justify-end">
            <Button
              size="sm"
              onClick={handleSendReply}
              disabled={!replyMessage.trim() || replyMutation.isPending}
            >
              {replyMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <Send className="w-4 h-4 mr-2" />
              )}
              Reply
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default function AdminSupportTickets() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selectedTicketId, setSelectedTicketId] = useState<number | null>(null);

  const { data, isLoading } = useListSupportTickets({
    status: statusFilter !== "all" ? (statusFilter as ListSupportTicketsStatus) : undefined,
    category: categoryFilter !== "all" ? categoryFilter : undefined,
    priority: priorityFilter !== "all" ? priorityFilter : undefined,
    page,
    limit: 20,
  });

  const { data: stats } = useGetSupportTicketStats();

  const tickets: SupportTicket[] = (data?.data ?? []).filter((t) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      t.subject.toLowerCase().includes(q) ||
      (t.merchantName ?? "").toLowerCase().includes(q)
    );
  });

  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / 20);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Support Tickets</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Review and respond to merchant support requests
          </p>
        </div>
      </div>

      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Card>
            <CardContent className="pt-4 pb-3 px-4 flex items-center gap-3">
              <Inbox className="w-5 h-5 text-sky-400 shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground">Open</p>
                <p className="text-xl font-bold">{stats.open}</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3 px-4 flex items-center gap-3">
              <Clock className="w-5 h-5 text-amber-400 shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground">In Progress</p>
                <p className="text-xl font-bold">{stats.inProgress}</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3 px-4 flex items-center gap-3">
              <CheckCircle className="w-5 h-5 text-emerald-400 shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground">Resolved</p>
                <p className="text-xl font-bold">{stats.resolved}</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3 px-4 flex items-center gap-3">
              <AlertCircle className="w-5 h-5 text-purple-400 shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground">Total</p>
                <p className="text-xl font-bold">{stats.total}</p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search tickets..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Tabs value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="open">Open</TabsTrigger>
            <TabsTrigger value="in-progress">In Progress</TabsTrigger>
            <TabsTrigger value="resolved">Resolved</TabsTrigger>
          </TabsList>
        </Tabs>
        <Select value={categoryFilter} onValueChange={(v) => { setCategoryFilter(v); setPage(1); }}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            <SelectItem value="payments">Payments</SelectItem>
            <SelectItem value="account">Account</SelectItem>
            <SelectItem value="technical">Technical</SelectItem>
            <SelectItem value="billing">Billing</SelectItem>
          </SelectContent>
        </Select>
        <Select value={priorityFilter} onValueChange={(v) => { setPriorityFilter(v); setPage(1); }}>
          <SelectTrigger className="w-32">
            <SelectValue placeholder="Priority" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Priority</SelectItem>
            <SelectItem value="low">Low</SelectItem>
            <SelectItem value="normal">Normal</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="urgent">Urgent</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : tickets.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Headphones className="w-10 h-10 text-muted-foreground/40 mb-3" />
              <p className="text-muted-foreground text-sm">No tickets found</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Subject</TableHead>
                  <TableHead className="hidden sm:table-cell">Merchant</TableHead>
                  <TableHead className="hidden sm:table-cell">Category</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden md:table-cell">Priority</TableHead>
                  <TableHead className="hidden lg:table-cell">Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tickets.map((ticket) => (
                  <TableRow
                    key={ticket.id}
                    className="cursor-pointer hover:bg-muted/40"
                    onClick={() => setSelectedTicketId(ticket.id)}
                  >
                    <TableCell>
                      <span className="font-medium text-sm">{ticket.subject}</span>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">
                      {ticket.merchantName ?? `#${ticket.merchantId}`}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <span className="text-sm text-muted-foreground">
                        {CATEGORY_LABELS[ticket.category] ?? ticket.category}
                      </span>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={ticket.status} />
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <PriorityBadge priority={ticket.priority} />
                    </TableCell>
                    <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
                      {formatDistanceToNow(new Date(ticket.createdAt), { addSuffix: true })}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Showing {(page - 1) * 20 + 1}–{Math.min(page * 20, total)} of {total}
          </span>
          <div className="flex gap-1">
            <Button variant="outline" size="sm" onClick={() => setPage((p) => p - 1)} disabled={page === 1}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={() => setPage((p) => p + 1)} disabled={page >= totalPages}>
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      <TicketDetailSheet
        ticketId={selectedTicketId}
        open={selectedTicketId != null}
        onClose={() => setSelectedTicketId(null)}
      />
    </div>
  );
}
