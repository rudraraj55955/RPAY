import { ReactNode } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle, CheckCircle2, Info, XCircle, Loader2, IndianRupee } from "lucide-react";
import { cn } from "@/lib/utils";

export type RasoConfirmVariant = "default" | "destructive" | "warning" | "success";

export interface RasoConfirmBreakdownRow {
  label: string;
  value: string;
  highlight?: boolean;
  credit?: boolean;
  debit?: boolean;
  separator?: boolean;
}

export interface RasoConfirmModalProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  variant?: RasoConfirmVariant;
  title: string;
  description?: string;
  message?: ReactNode;
  breakdown?: RasoConfirmBreakdownRow[];
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  loading?: boolean;
  disableConfirm?: boolean;
  children?: ReactNode;
}

const ICON_MAP: Record<RasoConfirmVariant, typeof CheckCircle2> = {
  default:     CheckCircle2,
  destructive: XCircle,
  warning:     AlertTriangle,
  success:     CheckCircle2,
};

const ICON_COLOR: Record<RasoConfirmVariant, string> = {
  default:     "text-primary",
  destructive: "text-rose-400",
  warning:     "text-amber-400",
  success:     "text-emerald-400",
};

const CONFIRM_VARIANT: Record<RasoConfirmVariant, "default" | "destructive"> = {
  default:     "default",
  destructive: "destructive",
  warning:     "default",
  success:     "default",
};

const CONFIRM_COLOR: Record<RasoConfirmVariant, string> = {
  default:     "",
  destructive: "",
  warning:     "bg-amber-600 hover:bg-amber-700 text-white border-amber-600",
  success:     "bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-600",
};

export function RasoConfirmModal({
  open,
  onOpenChange,
  variant = "default",
  title,
  description,
  message,
  breakdown,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  onConfirm,
  loading = false,
  disableConfirm = false,
  children,
}: RasoConfirmModalProps) {
  const Icon = ICON_MAP[variant];
  const iconColor = ICON_COLOR[variant];

  return (
    <Dialog open={open} onOpenChange={v => { if (!loading) onOpenChange(v); }}>
      <DialogContent className="sm:max-w-md bg-card border-border/60 shadow-2xl">
        <DialogHeader className="space-y-3">
          <div className="flex items-center gap-3">
            <span className={cn("flex items-center justify-center w-9 h-9 rounded-full bg-muted/60 shrink-0", iconColor)}>
              <Icon className="w-5 h-5" />
            </span>
            <DialogTitle className="text-base font-semibold leading-tight">{title}</DialogTitle>
          </div>
          {description && (
            <DialogDescription className="text-sm text-muted-foreground leading-relaxed">
              {description}
            </DialogDescription>
          )}
        </DialogHeader>

        {message && (
          <div className="text-sm text-foreground/80 leading-relaxed">{message}</div>
        )}

        {breakdown && breakdown.length > 0 && (
          <div className="rounded-lg border border-border/50 bg-muted/20 overflow-hidden">
            {breakdown.map((row, i) => {
              if (row.separator) {
                return <div key={i} className="border-t border-border/40 my-0" />;
              }
              return (
                <div
                  key={i}
                  className={cn(
                    "flex items-center justify-between px-4 py-2 text-sm",
                    row.highlight && "bg-muted/40 font-semibold",
                    i % 2 === 0 && !row.highlight ? "bg-transparent" : "",
                  )}
                >
                  <span className={cn("text-muted-foreground", row.highlight && "text-foreground")}>
                    {row.label}
                  </span>
                  <span className={cn(
                    "font-mono font-medium tabular-nums",
                    row.credit && "text-emerald-400",
                    row.debit && "text-rose-400",
                    row.highlight && !row.credit && !row.debit && "text-foreground",
                    !row.credit && !row.debit && !row.highlight && "text-foreground/80",
                  )}>
                    {row.value}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {children}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={loading}
            className="flex-1 sm:flex-none"
          >
            {cancelLabel}
          </Button>
          <Button
            variant={CONFIRM_VARIANT[variant]}
            size="sm"
            onClick={onConfirm}
            disabled={loading || disableConfirm}
            className={cn("flex-1 sm:flex-none min-w-[100px]", CONFIRM_COLOR[variant])}
          >
            {loading ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" />{confirmLabel}…</>
            ) : (
              confirmLabel
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
