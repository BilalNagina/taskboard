// Catches a page that fails to render, so the rest of the app (sidebar, navigation) keeps
// working and the person sees what happened instead of a blank screen. Navigating to
// another page (a new resetKey) tries again.
import { Component } from 'react';
import { EmptyState } from './ui.jsx';

export default class ErrorBoundary extends Component {
  state = { error: null, resetKey: this.props.resetKey };

  static getDerivedStateFromError(error) {
    return { error };
  }

  static getDerivedStateFromProps(props, state) {
    return props.resetKey !== state.resetKey ? { error: null, resetKey: props.resetKey } : null;
  }

  componentDidCatch(error, info) {
    console.error('page failed to render', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="page">
        <EmptyState
          icon="zap"
          title="This page didn't load"
          action={
            <button className="btn btn-primary" onClick={() => window.location.reload()}>
              Reload the page
            </button>
          }
        >
          Something went wrong on our side. Reloading usually fixes it; the rest of the app still works from the sidebar.
        </EmptyState>
      </div>
    );
  }
}
