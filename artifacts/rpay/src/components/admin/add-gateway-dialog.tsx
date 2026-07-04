import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateProviderIntegration,
  getListProviderIntegrationsQueryKey,
} from "@workspace/api-client-react";
import type { ProviderIntegration } from "@workspace/api-client-react";
import { getToken } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger, DialogDescription } from "@/components/ui/dialog";
import { toast } from "sonner";
import { PlusCircle } from "lucide-react";

const authHeader = () => ({ Authorization: `Bearer ${getToken()}` });

export function AddGatewayDialog({
  trigger,
  onCreated,
}: {
  trigger: React.ReactNode;
  onCreated?: (providerKey: string) => void;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    providerNameInternal: "",
    displayNamePublic: "",
    productType: "payin",
    environment: "test" as "test" | "live",
    webhookUrl: "",
    notes: "",
    isEnabled: false,
    apiKey: "",
    apiSecret: "",
    webhookSecret: "",
  });

  function reset() {
    setForm({
      providerNameInternal: "", displayNamePublic: "", productType: "payin",
      environment: "test", webhookUrl: "", notes: "", isEnabled: false,
      apiKey: "", apiSecret: "", webhookSecret: "",
    });
  }

  const { mutate: createIntegration, isPending } = useCreateProviderIntegration({
    request: { headers: authHeader() },
    mutation: {
      onSuccess: (created: ProviderIntegration) => {
        toast.success(`${created.providerNameInternal} gateway added`);
        qc.invalidateQueries({ queryKey: getListProviderIntegrationsQueryKey() });
        setOpen(false);
        reset();
        onCreated?.(created.providerKey);
      },
      onError: (err: Error) => toast.error(err.message),
    },
  } as any);

  function handleSubmit() {
    if (!form.providerNameInternal.trim() || !form.displayNamePublic.trim()) {
      toast.error("Provider name and display name are required");
      return;
    }
    createIntegration({
      data: {
        providerNameInternal: form.providerNameInternal.trim(),
        displayNamePublic: form.displayNamePublic.trim(),
        productType: form.productType,
        environment: form.environment,
        webhookUrl: form.webhookUrl.trim() || undefined,
        notes: form.notes.trim() || undefined,
        isEnabled: form.isEnabled,
        apiKey: form.apiKey.trim() || undefined,
        apiSecret: form.apiSecret.trim() || undefined,
        webhookSecret: form.webhookSecret.trim() || undefined,
      },
    } as any);
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-lg bg-card border-border max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PlusCircle className="w-4 h-4 text-primary" />
            Add Payment Gateway
          </DialogTitle>
          <DialogDescription>
            Register a new provider integration. It will appear alongside Cashfree/EKQR in Overview and Configure.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Provider Name *</Label>
              <Input
                placeholder="e.g. Razorpay"
                value={form.providerNameInternal}
                onChange={e => setForm(f => ({ ...f, providerNameInternal: e.target.value }))}
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Display Name *</Label>
              <Input
                placeholder="e.g. RasoKart Alt Gateway"
                value={form.displayNamePublic}
                onChange={e => setForm(f => ({ ...f, displayNamePublic: e.target.value }))}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Product Type</Label>
              <Select value={form.productType} onValueChange={v => setForm(f => ({ ...f, productType: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="payin">Payin</SelectItem>
                  <SelectItem value="payout">Payout</SelectItem>
                  <SelectItem value="upi_qr">UPI / QR</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Environment</Label>
              <Select value={form.environment} onValueChange={v => setForm(f => ({ ...f, environment: v as "test" | "live" }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="test">Sandbox / Test</SelectItem>
                  <SelectItem value="live">Live / Production</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label className="text-xs text-muted-foreground mb-1 block">Webhook URL</Label>
            <Input
              placeholder="https://api.rasokart.com/api/payment/webhook"
              value={form.webhookUrl}
              onChange={e => setForm(f => ({ ...f, webhookUrl: e.target.value }))}
            />
          </div>

          <div className="grid grid-cols-1 gap-3 rounded-lg border border-border/50 p-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Credentials (optional, encrypted at rest)</p>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">API Key</Label>
              <Input
                type="password"
                placeholder="Enter API key"
                value={form.apiKey}
                onChange={e => setForm(f => ({ ...f, apiKey: e.target.value }))}
                className="font-mono"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">API Secret</Label>
              <Input
                type="password"
                placeholder="Enter API secret"
                value={form.apiSecret}
                onChange={e => setForm(f => ({ ...f, apiSecret: e.target.value }))}
                className="font-mono"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Webhook Signature Secret</Label>
              <Input
                type="password"
                placeholder="Enter webhook secret"
                value={form.webhookSecret}
                onChange={e => setForm(f => ({ ...f, webhookSecret: e.target.value }))}
                className="font-mono"
              />
            </div>
          </div>

          <div>
            <Label className="text-xs text-muted-foreground mb-1 block">Internal Notes</Label>
            <Textarea
              rows={2}
              placeholder="Internal notes for admins..."
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
            />
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div>
              <p className="text-sm font-medium">Enable Immediately</p>
              <p className="text-xs text-muted-foreground">Can be toggled later from Configure</p>
            </div>
            <Switch checked={form.isEnabled} onCheckedChange={v => setForm(f => ({ ...f, isEnabled: v }))} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={isPending}>
            {isPending ? "Adding…" : "Add Gateway"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
