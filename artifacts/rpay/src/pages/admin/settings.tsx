import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Settings, Mail, Save, CheckCircle2, AlertCircle, Send, Calendar } from "lucide-react";
import { toast } from "sonner";
import { getToken } from "@/lib/auth";

async function apiGet(path: string) {
  const res = await fetch(`/api${path}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) throw new Error("Failed to fetch settings");
  return res.json();
}

async function apiPut(path: string, body: object) {
  const res = await fetch(`/api${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    let msg = text;
    try { msg = JSON.parse(text).error ?? text; } catch {}
    throw new Error(msg);
  }
  return res.json();
}

async function apiPost(path: string) {
  const res = await fetch(`/api${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) {
    const text = await res.text();
    let msg = text;
    try { msg = JSON.parse(text).error ?? text; } catch {}
    throw new Error(msg);
  }
  return res.json();
}

type ScheduleMode = "daily" | "weekly" | "off";

const SCHEDULE_OPTIONS: { value: ScheduleMode; label: string; description: string }[] = [
  {
    value: "daily",
    label: "Daily",
    description: "Run every night at the configured time, covering the past day(s).",
  },
  {
    value: "weekly",
    label: "Weekly (every Monday)",
    description: "Run once a week on Monday mornings, covering the full previous week.",
  },
  {
    value: "off",
    label: "Off",
    description: "Disable automatic reconciliation runs entirely. Admins can still trigger runs manually.",
  },
];

interface SettingsData {
  finance_report_email: string | null;
  reconciliation_schedule: string | null;
}

export default function AdminSettings() {
  const qc = useQueryClient();
  const [financeEmail, setFinanceEmail] = useState<string>("");
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>("daily");
  const [initialized, setInitialized] = useState(false);

  const { data, isLoading } = useQuery<SettingsData>({
    queryKey: ["/api/settings"],
    queryFn: () => apiGet("/settings"),
    onSuccess: (d: SettingsData) => {
      if (!initialized) {
        setFinanceEmail(d.finance_report_email ?? "");
        const raw = d.reconciliation_schedule;
        setScheduleMode(raw === "weekly" || raw === "off" ? raw : "daily");
        setInitialized(true);
      }
    },
  } as any);

  const recipientCount = financeEmail.trim()
    ? financeEmail.split(",").map(e => e.trim()).filter(e => e.length > 0).length
    : 0;

  const { mutate: saveEmail, isPending: savingEmail } = useMutation({
    mutationFn: () => apiPut("/settings/finance_report_email", { value: financeEmail || null }),
    onSuccess: () => {
      toast.success("Finance report email saved");
      qc.invalidateQueries({ queryKey: ["/api/settings"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const { mutate: sendTestEmail, isPending: sendingTest } = useMutation({
    mutationFn: () => apiPost("/settings/test-email"),
    onSuccess: () => toast.success("Test email sent — check your inbox"),
    onError: (err: Error) => toast.error(`Test email failed: ${err.message}`),
  });

  const { mutate: saveSchedule, isPending: savingSchedule } = useMutation({
    mutationFn: () => apiPut("/settings/reconciliation_schedule", { value: scheduleMode }),
    onSuccess: () => {
      toast.success("Reconciliation schedule saved");
      qc.invalidateQueries({ queryKey: ["/api/settings"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const currentEmail = data?.finance_report_email ?? null;
  const emailUnchanged = financeEmail === (currentEmail ?? "");

  const currentSchedule = (() => {
    const raw = data?.reconciliation_schedule;
    return raw === "weekly" || raw === "off" ? raw : "daily";
  })();
  const scheduleUnchanged = scheduleMode === currentSchedule;

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-violet-500/10 border border-violet-500/20">
          <Settings className="w-5 h-5 text-violet-400" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-foreground">System Settings</h1>
          <p className="text-sm text-muted-foreground">Configure platform-wide operational settings</p>
        </div>
      </div>

      {/* Reconciliation Schedule */}
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-muted-foreground" />
            <CardTitle className="text-base">Reconciliation Schedule</CardTitle>
          </div>
          <CardDescription className="text-sm">
            Control how often the system automatically runs reconciliation. The run time is
            configured separately under the Reconciliation settings.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!isLoading && currentSchedule === "off" && (
            <div className="flex items-center gap-2 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-md px-3 py-2">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              <span>Automatic reconciliation is currently <strong>disabled</strong>. Manual runs still work.</span>
            </div>
          )}
          {!isLoading && currentSchedule !== "off" && (
            <div className="flex items-center gap-2 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-md px-3 py-2">
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
              <span>
                Automatic reconciliation runs <strong>{currentSchedule === "weekly" ? "weekly (every Monday)" : "daily"}</strong>.
              </span>
            </div>
          )}

          <div className="space-y-2">
            <Label className="text-sm">Schedule frequency</Label>
            <div className="space-y-2">
              {SCHEDULE_OPTIONS.map(opt => (
                <label
                  key={opt.value}
                  className={`flex items-start gap-3 rounded-lg border px-4 py-3 cursor-pointer transition-colors ${
                    scheduleMode === opt.value
                      ? "border-violet-500/50 bg-violet-500/5"
                      : "border-border/50 hover:border-border"
                  }`}
                >
                  <input
                    type="radio"
                    name="schedule-mode"
                    value={opt.value}
                    checked={scheduleMode === opt.value}
                    onChange={() => setScheduleMode(opt.value)}
                    disabled={isLoading}
                    className="mt-0.5 accent-violet-500"
                  />
                  <div>
                    <p className="text-sm font-medium text-foreground">{opt.label}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{opt.description}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={() => saveSchedule()}
              disabled={savingSchedule || isLoading || scheduleUnchanged}
            >
              <Save className="w-3.5 h-3.5 mr-1.5" />
              {savingSchedule ? "Saving…" : "Save"}
            </Button>
            {!scheduleUnchanged && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setScheduleMode(currentSchedule)}
                disabled={savingSchedule}
              >
                Cancel
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Finance Report Email */}
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Mail className="w-4 h-4 text-muted-foreground" />
            <CardTitle className="text-base">Finance Report Recipients</CardTitle>
          </div>
          <CardDescription className="text-sm">
            After each reconciliation run completes, a summary email with the full CSV report attached
            will be sent to all configured addresses. Leave blank to disable automatic emails.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!isLoading && currentEmail && (
            <div className="flex items-start gap-2 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-md px-3 py-2">
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>
                Reports are currently being sent to{" "}
                {currentEmail.split(",").map(e => e.trim()).filter(Boolean).map((addr, i, arr) => (
                  <span key={addr}>
                    <strong>{addr}</strong>{i < arr.length - 1 ? ", " : ""}
                  </span>
                ))}
              </span>
            </div>
          )}
          {!isLoading && !currentEmail && (
            <div className="flex items-center gap-2 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-md px-3 py-2">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              <span>No finance email configured — automatic reports are disabled</span>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="finance-email" className="text-sm">Recipient email addresses</Label>
            <div className="flex items-center gap-2">
              <Input
                id="finance-email"
                type="text"
                placeholder="cfo@company.com, controller@company.com, auditor@company.com"
                value={financeEmail}
                onChange={e => setFinanceEmail(e.target.value)}
                disabled={isLoading}
                className="max-w-lg"
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => sendTestEmail()}
                disabled={sendingTest || isLoading || !currentEmail}
                title={!currentEmail ? "Save an email address first to send a test" : "Send a test email to the saved address"}
              >
                <Send className="w-3.5 h-3.5 mr-1.5" />
                {sendingTest ? "Sending…" : "Send test"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Separate multiple addresses with commas.
              {recipientCount > 1 && (
                <span className="ml-1 text-violet-400">{recipientCount} recipients configured.</span>
              )}
              {" "}Reports include run stats and a full CSV attachment.
              {currentEmail && ' Use "Send test" to verify SMTP is working.'}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={() => saveEmail()}
              disabled={savingEmail || isLoading || emailUnchanged}
            >
              <Save className="w-3.5 h-3.5 mr-1.5" />
              {savingEmail ? "Saving…" : "Save"}
            </Button>
            {!emailUnchanged && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setFinanceEmail(currentEmail ?? "")}
                disabled={savingEmail}
              >
                Cancel
              </Button>
            )}
          </div>

          <div className="border-t border-border/50 pt-4">
            <p className="text-xs text-muted-foreground font-medium mb-1">SMTP requirement</p>
            <p className="text-xs text-muted-foreground">
              Emails are sent via SMTP. Ensure the server has{" "}
              <code className="bg-muted px-1 py-0.5 rounded text-xs">SMTP_HOST</code>,{" "}
              <code className="bg-muted px-1 py-0.5 rounded text-xs">SMTP_USER</code>, and{" "}
              <code className="bg-muted px-1 py-0.5 rounded text-xs">SMTP_PASS</code> environment
              variables set. Optionally set{" "}
              <code className="bg-muted px-1 py-0.5 rounded text-xs">SMTP_PORT</code> (default 587) and{" "}
              <code className="bg-muted px-1 py-0.5 rounded text-xs">SMTP_FROM</code>.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
