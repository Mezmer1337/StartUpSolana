import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { reportClientError } from "../services/errorReporting";

interface Props {
  children: ReactNode;
  /** When this changes (e.g. the route), a crashed subtree gets a fresh start. */
  resetKey?: string;
}
interface State {
  error: Error | null;
  retries: number;
  resetKey?: string;
}

/**
 * Without this, any render error unmounts the whole React tree and leaves an
 * empty page until a manual reload. Here a crash is reported, the subtree is
 * remounted once automatically (fresh data, like re-opening the URL), and if
 * it crashes again a readable fallback with "Reload" is shown instead.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, retries: 0, resetKey: this.props.resetKey };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    // Navigating elsewhere clears a previous crash.
    if (props.resetKey !== state.resetKey) return { error: null, retries: 0, resetKey: props.resetKey };
    return null;
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    reportClientError(error, info.componentStack ?? "");
    if (this.state.retries === 0) {
      // One automatic retry: remount with fresh state after the current tick.
      setTimeout(() => this.setState({ error: null, retries: 1 }), 0);
    }
  }

  render() {
    const { error, retries } = this.state;
    if (!error) return this.props.children;
    if (retries === 0) return null; // auto-retry in progress
    return (
      <div className="glass rounded-2xl p-8 my-10 text-center flex flex-col items-center gap-4 max-w-lg mx-auto">
        <div className="text-5xl">🙀</div>
        <h1 className="text-lg font-bold text-white">Something went wrong on this page</h1>
        <p className="text-sm text-gray-400">Your data is safe — this was a display error, and it has been reported.</p>
        <p className="text-xs text-gray-500 font-mono break-all">{error.message}</p>
        <button
          onClick={() => window.location.reload()}
          className="px-5 py-2.5 rounded-xl text-sm font-semibold bg-gradient-to-r from-purple-500 to-indigo-500 text-white"
        >
          Reload page
        </button>
      </div>
    );
  }
}
