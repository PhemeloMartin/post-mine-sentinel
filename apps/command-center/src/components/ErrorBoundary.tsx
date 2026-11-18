import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface Props {
  /** Human name of the region, e.g. "Orbital view" — shown in the fallback. */
  region: string;
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  error: Error | null;
  incidentId: string | null;
}

/**
 * Contains a rendering failure to one region of the console (a crashed 3D scene must not take
 * the alert panel down with it). Shows a recoverable, accessible fallback with an incident id
 * that matches the client-error log line, instead of a blank screen.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, incidentId: null };

  static getDerivedStateFromError(error: Error): State {
    return { error, incidentId: `UI-${Date.now().toString(36).toUpperCase()}` };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Structured client-side error log; in live mode this is shipped to /api/v1/client-errors.
    console.error(
      JSON.stringify({
        level: 'error',
        incidentId: this.state.incidentId,
        region: this.props.region,
        message: error.message,
        componentStack: info.componentStack?.split('\n').slice(0, 6).join(' | '),
      }),
    );
  }

  private reset = () => this.setState({ error: null, incidentId: null });

  render() {
    if (!this.state.error) return this.props.children;
    if (this.props.fallback) return this.props.fallback;
    return (
      <div role="alert" className="flex h-full w-full items-center justify-center p-6">
        <div className="hud-panel max-w-md p-5 text-sm">
          <div className="mb-2 flex items-center gap-2 text-amber-300">
            <AlertTriangle size={18} aria-hidden />
            <span className="hud-title !text-amber-300">{this.props.region} unavailable</span>
          </div>
          <p className="text-slate-300">
            This part of the console hit an unexpected error. The rest of the system, including alerting, keeps running.
          </p>
          <p className="mt-2 font-mono text-[11px] text-slate-500">
            Incident {this.state.incidentId}: {this.state.error.message}
          </p>
          <button className="hud-btn mt-4" onClick={this.reset}>
            <RotateCcw size={14} aria-hidden /> Reload view
          </button>
        </div>
      </div>
    );
  }
}
