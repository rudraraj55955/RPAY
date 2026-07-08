import { Component, ErrorInfo, ReactNode } from "react";
import { AlertTriangle, RefreshCcw, Home, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  showDetails: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, showDetails: false };
  }

  static getDerivedStateFromError(error: Error): Omit<State, "showDetails"> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Structured error log visible in browser devtools
    console.group("[RasoKart] Render Error");
    console.error(error);
    console.error("Component stack:", info.componentStack);
    console.groupEnd();
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, showDetails: false });
  };

  toggleDetails = () => {
    this.setState(s => ({ showDetails: !s.showDetails }));
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="min-h-screen flex items-center justify-center bg-background p-6">
          <div className="max-w-md w-full space-y-6">
            {/* Icon */}
            <div className="flex justify-center">
              <div className="w-16 h-16 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center">
                <AlertTriangle className="w-8 h-8 text-rose-400" />
              </div>
            </div>

            {/* Message */}
            <div className="text-center space-y-2">
              <h2 className="text-xl font-semibold text-foreground">Something went wrong</h2>
              <p className="text-sm text-muted-foreground leading-relaxed">
                An unexpected error occurred while rendering this page.
                Refreshing the page usually resolves the issue.
              </p>
            </div>

            {/* Error detail toggle */}
            {this.state.error && (
              <div className="rounded-lg border border-border/50 overflow-hidden">
                <button
                  onClick={this.toggleDetails}
                  className="w-full flex items-center justify-between px-4 py-2.5 text-xs text-muted-foreground hover:bg-muted/30 transition-colors"
                >
                  <span>Error details</span>
                  {this.state.showDetails
                    ? <ChevronUp className="w-3.5 h-3.5" />
                    : <ChevronDown className="w-3.5 h-3.5" />
                  }
                </button>
                {this.state.showDetails && (
                  <pre className="px-4 py-3 text-xs bg-muted/20 text-rose-300/80 overflow-x-auto whitespace-pre-wrap border-t border-border/50">
                    {this.state.error.message}
                    {this.state.error.stack
                      ? "\n\n" + this.state.error.stack.split("\n").slice(1, 6).join("\n")
                      : ""}
                  </pre>
                )}
              </div>
            )}

            {/* Actions */}
            <div className="flex justify-center gap-3">
              <Button variant="outline" onClick={this.handleReset} className="gap-2">
                <RefreshCcw className="w-4 h-4" />
                Try Again
              </Button>
              <Button onClick={() => window.location.reload()} className="gap-2">
                <RefreshCcw className="w-4 h-4" />
                Refresh Page
              </Button>
            </div>

            <p className="text-center text-xs text-muted-foreground/60">
              If this keeps happening, try clearing your browser cache or contact support.
            </p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export function PageErrorBoundary({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary
      fallback={
        <div className="flex flex-col items-center justify-center py-20 text-center gap-5">
          <div className="w-12 h-12 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center">
            <AlertTriangle className="w-6 h-6 text-rose-400" />
          </div>
          <div className="space-y-1 max-w-xs">
            <p className="text-sm font-medium text-foreground">Failed to load this section</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              There was a rendering error. Try refreshing or navigating away and back.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => window.location.reload()} className="gap-2">
            <RefreshCcw className="w-3.5 h-3.5" />
            Refresh
          </Button>
        </div>
      }
    >
      {children}
    </ErrorBoundary>
  );
}

/**
 * Inline error fallback for data-loading states within a page section.
 * Usage: wrap a Card or section that might throw in <SectionErrorBoundary>.
 */
export function SectionErrorBoundary({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <ErrorBoundary
      fallback={
        <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 px-4 py-6 text-center space-y-2">
          <AlertTriangle className="w-5 h-5 text-rose-400 mx-auto" />
          <p className="text-xs text-muted-foreground">
            {label ? `Failed to render "${label}"` : "Failed to render this section"}
          </p>
          <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => window.location.reload()}>
            Refresh
          </Button>
        </div>
      }
    >
      {children}
    </ErrorBoundary>
  );
}
