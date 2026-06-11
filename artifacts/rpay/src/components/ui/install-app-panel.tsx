import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Smartphone, Download, CheckCircle2, Globe, X } from "lucide-react";
import { usePwaInstall } from "@/hooks/use-pwa-install";
import { RasoKartLogo } from "@/components/ui/rasokart-logo";

const APK_URL = "/downloads/rasokart.apk";

interface InstallAppPanelProps {
  open: boolean;
  onClose: () => void;
  appName?: string;
}

export function InstallAppPanel({ open, onClose, appName = "RasoKart" }: InstallAppPanelProps) {
  const { canPrompt, promptInstall, isInstalled, isIOS } = usePwaInstall();
  const [apkAvailable, setApkAvailable] = useState<boolean | null>(null);
  const [installing, setInstalling] = useState(false);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    if (!open) return;
    setApkAvailable(null);
    fetch(APK_URL, { method: "HEAD" })
      .then(r => setApkAvailable(r.ok))
      .catch(() => setApkAvailable(false));
  }, [open]);

  async function handlePwaInstall() {
    setInstalling(true);
    const ok = await promptInstall();
    setInstalling(false);
    if (ok) setInstalled(true);
  }

  const showInstalled = isInstalled || installed;

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-1">
            <RasoKartLogo size={40} className="shrink-0" />
            <div className="flex-1 min-w-0">
              <DialogTitle className="text-left text-base">{appName}</DialogTitle>
              <DialogDescription className="text-left text-xs mt-0.5">
                Install for a faster, app-like experience
              </DialogDescription>
            </div>
            <Button variant="ghost" size="icon" className="shrink-0 h-8 w-8" onClick={onClose}>
              <X className="w-4 h-4" />
            </Button>
          </div>
        </DialogHeader>

        <div className="space-y-3 mt-1">
          {showInstalled ? (
            <div className="flex items-center gap-2.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <p className="text-sm text-emerald-400 font-medium">Already installed on your device</p>
            </div>
          ) : (
            <div className="rounded-lg border border-border/50 bg-muted/10 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Globe className="w-4 h-4 text-primary shrink-0" />
                <p className="text-sm font-medium">Install as Web App</p>
              </div>
              {canPrompt ? (
                <Button className="w-full" onClick={handlePwaInstall} disabled={installing}>
                  <Smartphone className="w-4 h-4 mr-2" />
                  {installing ? "Installing…" : "Add to Home Screen"}
                </Button>
              ) : isIOS ? (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground font-medium">On iPhone / iPad (Safari):</p>
                  <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
                    <li>Tap the <strong className="text-foreground">Share</strong> icon at the bottom</li>
                    <li>Scroll and tap <strong className="text-foreground">"Add to Home Screen"</strong></li>
                    <li>Tap <strong className="text-foreground">Add</strong></li>
                  </ol>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Open this page in <strong className="text-foreground">Chrome</strong> or{" "}
                  <strong className="text-foreground">Edge</strong> on Android or desktop to install.
                </p>
              )}
            </div>
          )}

          <div className="rounded-lg border border-border/50 bg-muted/10 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Download className="w-4 h-4 text-primary shrink-0" />
              <p className="text-sm font-medium">Android App</p>
            </div>
            {apkAvailable === null ? (
              <p className="text-xs text-muted-foreground">Checking availability…</p>
            ) : apkAvailable ? (
              <a href={APK_URL} download className="block">
                <Button variant="outline" className="w-full">
                  <Download className="w-4 h-4 mr-2" />
                  Download Android APK
                </Button>
              </a>
            ) : (
              <p className="text-xs text-muted-foreground">
                Android app coming soon. You can install the web app now.
              </p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
