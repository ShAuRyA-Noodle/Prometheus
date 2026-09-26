/**
 * ErrorBoundary — catches render errors, shows recoverable UI, posts to console.
 * NOT for async errors (use APIError + toasts).
 */
import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: (err: Error, reset: () => void) => ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo): void {
     
    console.error("[ErrorBoundary]", error, info);
  }

  reset = () => this.setState({ error: null });

  override render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(error, this.reset);

    return (
      <div className="grid min-h-[60dvh] place-items-center px-6">
        <div className="grid max-w-md gap-4 text-center">
          <div className="mx-auto h-1 w-12 rounded-full bg-accent-500" />
          <h2 className="font-display text-2xl text-ink-50">
            Something broke. Not your fault.
          </h2>
          <p className="text-sm text-ink-400">{error.message}</p>
          <div>
            <button
              type="button"
              onClick={this.reset}
              className="rounded-full bg-accent-500 px-4 py-2 text-sm font-semibold text-ink-950 hover:bg-accent-400 focus-ring"
            >
              Reload this view
            </button>
          </div>
        </div>
      </div>
    );
  }
}
