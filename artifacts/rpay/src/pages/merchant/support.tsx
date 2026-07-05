import { useState, useRef } from "react";
import {
  useListSupportTickets,
  useCreateSupportTicket,
  useGetSupportTicket,
  useAddTicketReply,
  getListSupportTicketsQueryKey,
  getGetSupportTicketQueryKey,
  CreateSupportTicketInputCategory,
  ListSupportTicketsStatus,
  type SupportTicket,
} from "@workspace/api-client-react";
import { useUpload } from "@workspace/object-storage-web";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PlusCircle, Headphones, ChevronLeft, ChevronRight, Send, Loader2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow, format } from "date-fns";
import { useCompanySettings } from "@/lib/company-settings";

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
  const qc = useQueryClient();

  const { data, isLoading } = useGetSupportTicket(
    ticketId ?? 0,
    { query: { enabled: ticketId != null && open, queryKey: getGetSupportTicketQueryKey(ticketId ?? 0) } }
  );

  const replyMutation = useAddTicketReply();

  function handleSendReply() {
    if (!replyMessage.trim() || !ticketId) return;
    replyMutation.mutate(
      { id: ticketId, data: { message: replyMessage.trim() } },
      {
        onSuccess: () => {
          toast.success("Reply sent");
          setReplyMessage("");
          qc.invalidateQueries({ queryKey: getGetSupportTicketQueryKey(ticketId) });
          qc.invalidateQueries({ queryKey: getListSupportTicketsQueryKey() });
        },
        onError: () => toast.error("Failed to send reply"),
      }
    );
  }

  const ticket = data?.ticket;
  const replies = data?.replies ?? [];

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent className="w-full sm:max-w-xl flex flex-col gap-0 p-0">
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
            </div>
          )}
        </SheetHeader>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {isLoading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {ticket && (
            <div className="rounded-lg bg-muted/30 border border-border/50 p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-muted-foreground">You</span>
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
                  ? "bg-sky-950/20 border-sky-500/20 ml-4"
                  : "bg-muted/30 border-border/50 mr-4"
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-muted-foreground">
                  {reply.authorRole === "admin" ? "Support Team" : "You"}
                </span>
                <span className="text-xs text-muted-foreground">
                  {format(new Date(reply.createdAt), "dd MMM yyyy, HH:mm")}
                </span>
              </div>
              <p className="text-sm leading-relaxed whitespace-pre-wrap">{reply.message}</p>
            </div>
          ))}

          {ticket?.status === "resolved" && (
            <div className="text-center text-xs text-muted-foreground py-2">
              This ticket has been resolved. You can still send a follow-up message.
            </div>
          )}
        </div>

        <div className="border-t border-border/50 p-4 space-y-2">
          <Textarea
            placeholder="Type your message..."
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
              Send
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function NewTicketDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [category, setCategory] = useState<CreateSupportTicketInputCategory | "">("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);
  const [screenshotName, setScreenshotName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const base = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

  const { uploadFile, isUploading } = useUpload({
    basePath: `${base}/api/storage`,
    requestHeaders: {
      Authorization: `Bearer ${localStorage.getItem("rasokart_token") ?? ""}`,
    },
    onSuccess: (response) => {
      const url = `${base}/api/storage${response.objectPath}`;
      setScreenshotUrl(url);
      toast.success("Screenshot uploaded");
    },
    onError: () => toast.error("Screenshot upload failed"),
  });

  const createMutation = useCreateSupportTicket();

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error("File must be under 5 MB");
      return;
    }
    setScreenshotName(file.name);
    uploadFile(file);
  }

  function handleRemoveScreenshot() {
    setScreenshotUrl(null);
    setScreenshotName(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleClose() {
    setCategory("");
    setSubject("");
    setMessage("");
    setScreenshotUrl(null);
    setScreenshotName(null);
    onClose();
  }

  function handleSubmit() {
    if (!category || !subject.trim() || !message.trim()) {
      toast.error("Please fill in all required fields");
      return;
    }
    createMutation.mutate(
      {
        data: {
          category,
          subject: subject.trim(),
          message: message.trim(),
          screenshotUrl: screenshotUrl ?? null,
        },
      },
      {
        onSuccess: () => {
          toast.success("Support ticket created. We'll get back to you soon.");
          handleClose();
          onCreated();
        },
        onError: () => toast.error("Failed to create ticket"),
      }
    );
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Raise a Support Ticket</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Category <span className="text-red-400">*</span></Label>
            <Select value={category} onValueChange={(v) => setCategory(v as CreateSupportTicketInputCategory)}>
              <SelectTrigger>
                <SelectValue placeholder="Select category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={CreateSupportTicketInputCategory.payments}>Payments</SelectItem>
                <SelectItem value={CreateSupportTicketInputCategory.account}>Account</SelectItem>
                <SelectItem value={CreateSupportTicketInputCategory.technical}>Technical</SelectItem>
                <SelectItem value={CreateSupportTicketInputCategory.billing}>Billing</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Subject <span className="text-red-400">*</span></Label>
            <Input
              placeholder="Brief description of your issue"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              maxLength={200}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Message <span className="text-red-400">*</span></Label>
            <Textarea
              placeholder="Describe your issue in detail..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="min-h-[120px]"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Screenshot <span className="text-muted-foreground text-xs">(optional, max 5 MB)</span></Label>
            {screenshotUrl ? (
              <div className="flex items-center gap-2 p-2 rounded-md bg-muted/30 border border-border/50">
                <span className="text-xs text-muted-foreground flex-1 truncate">{screenshotName ?? "Screenshot"}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
                  onClick={handleRemoveScreenshot}
                >
                  <X className="w-3 h-3" />
                </Button>
              </div>
            ) : (
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleFileChange}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploading}
                >
                  {isUploading ? (
                    <><Loader2 className="w-4 h-4 animate-spin mr-2" />Uploading…</>
                  ) : (
                    <><Upload className="w-4 h-4 mr-2" />Upload Image</>
                  )}
                </Button>
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>Cancel</Button>
          <Button
            onClick={handleSubmit}
            disabled={createMutation.isPending || isUploading}
          >
            {createMutation.isPending && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
            Submit Ticket
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function MerchantSupport() {
  const { companyName, supportPhone, supportEmail, whatsappPhone } = useCompanySettings();
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [selectedTicketId, setSelectedTicketId] = useState<number | null>(null);
  const [newTicketOpen, setNewTicketOpen] = useState(false);

  const { data, isLoading } = useListSupportTickets({
    status: statusFilter !== "all" ? (statusFilter as ListSupportTicketsStatus) : undefined,
    category: categoryFilter !== "all" ? categoryFilter : undefined,
    page,
    limit: 15,
  });

  const tickets: SupportTicket[] = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / 15);

  function invalidate() {
    qc.invalidateQueries({ queryKey: getListSupportTicketsQueryKey() });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Support</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Raise and track your support requests
          </p>
        </div>
        <Button onClick={() => setNewTicketOpen(true)}>
          <PlusCircle className="w-4 h-4 mr-2" />
          New Ticket
        </Button>
      </div>

      <Card className="border-border/50 bg-card/40">
        <CardContent className="py-4 flex flex-wrap items-center gap-x-8 gap-y-2 text-sm">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Headphones className="w-4 h-4" />
            <span>Operated by {companyName}</span>
          </div>
          <span className="text-foreground">
            Support: <a href={`tel:${supportPhone}`} className="hover:underline">{supportPhone}</a>
          </span>
          {supportEmail && (
            <span className="text-foreground">
              Email: <a href={`mailto:${supportEmail}`} className="hover:underline">{supportEmail}</a>
            </span>
          )}
          {whatsappPhone && (
            <span className="text-foreground">WhatsApp: {whatsappPhone}</span>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="open">Open</TabsTrigger>
            <TabsTrigger value="in-progress">In Progress</TabsTrigger>
            <TabsTrigger value="resolved">Resolved</TabsTrigger>
          </TabsList>
        </Tabs>
        <Select value={categoryFilter} onValueChange={(v) => { setCategoryFilter(v); setPage(1); }}>
          <SelectTrigger className="w-40">
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
              <p className="text-muted-foreground/60 text-xs mt-1">
                Click "New Ticket" to raise a support request
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Subject</TableHead>
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
            Showing {(page - 1) * 15 + 1}–{Math.min(page * 15, total)} of {total}
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

      <NewTicketDialog
        open={newTicketOpen}
        onClose={() => setNewTicketOpen(false)}
        onCreated={invalidate}
      />
    </div>
  );
}
