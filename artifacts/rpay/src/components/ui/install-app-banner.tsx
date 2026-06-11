import { useState } from "react";
import { Smartphone, X, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RasoKartLogo } from "@/components/ui/rasokart-logo";
import { usePwaInstall } from "@/hooks/use-pwa-install";
import { InstallAppPanel } from "@/components/ui/install-app-panel";

const BANNER_DISMISSED_KEY = "rasokart_install_banner_dismissed";

interface InstallAppBannerProps {
  appName?: string;
}

export function InstallAppBanner({ appName = "RasoKart" }: InstallAppBannerProps) {
  const { isMobile, isInstalled } = usePwaInstall();
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem(BANNER_DISMISSED_KEY) === "1"
  );
  const [panelOpen, setPanelOpen] = useState(false);

  function dismiss() {
    localStorage.setItem(BANNER_DISMISSED_KEY, "1");
    setDismissed(true);
  }

  if (!isMobile || isInstalled || dismissed) return null;

  return (
    <>
      <div className="flex items-center gap-3 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 mt-4">
        <RasoKartLogo size={28} className="shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-foreground truncate">{appName}</p>
          <p className="text-[11px] text-muted-foreground">Install for the best experience</p>
        </div>
        <Button size="sm" className="shrink-0 h-8 text-xs px-3" onClick={() => setPanelOpen(true)}>
          <Smartphone className="w-3.5 h-3.5 mr-1.5" />
          Install
        </Button>
        <Button variant="ghost" size="icon" className="shrink-0 h-7 w-7 text-muted-foreground hover:text-foreground" onClick={dismiss}>
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>
      <InstallAppPanel open={panelOpen} onClose={() => setPanelOpen(false)} appName={appName} />
    </>
  );
}

export function InstallAppButton({ appName = "RasoKart", variant = "ghost", className = "" }: {
  appName?: string;
  variant?: "ghost" | "outline" | "default";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const { isInstalled } = usePwaInstall();

  return (
    <>
      <Button
        variant={variant as "ghost" | "outline" | "default"}
        size="sm"
        className={`gap-2 ${className}`}
        onClick={() => setOpen(true)}
        title={isInstalled ? "App installed" : "Install App"}
      >
        <Download className="w-4 h-4 shrink-0" />
        <span>{isInstalled ? "App Installed" : "Install App"}</span>
      </Button>
      <InstallAppPanel open={open} onClose={() => setOpen(false)} appName={appName} />
    </>
  );
}
