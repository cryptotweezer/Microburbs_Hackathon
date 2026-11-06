// Shows a readable message instead of a blank panel if any section throws while rendering.
import { Component, type ReactNode } from "react";

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="m-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-800">
        <p className="font-semibold">Something went wrong in the panel.</p>
        <pre className="mt-2 whitespace-pre-wrap break-words text-[11px]">{String(this.state.error.stack ?? this.state.error.message).slice(0, 1200)}</pre>
        <button className="mt-2 rounded-md bg-rose-600 px-3 py-1 text-white" onClick={() => this.setState({ error: null })}>
          Try again
        </button>
      </div>
    );
  }
}
