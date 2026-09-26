import { Component, type ReactNode } from 'react';
import { Button } from './ui';

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="mx-auto max-w-md py-20 text-center">
        <h2 className="text-lg font-semibold">This page hit a problem</h2>
        <p className="mt-2 text-sm text-fg-muted">
          Your data is safe. Reload to try again — if it keeps happening, export your data from Settings and
          let us know.
        </p>
        <Button className="mt-5" onClick={() => window.location.reload()}>
          Reload
        </Button>
      </div>
    );
  }
}
