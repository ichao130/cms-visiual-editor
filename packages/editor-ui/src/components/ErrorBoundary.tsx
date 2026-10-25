import { Component, type ErrorInfo, type ReactNode } from "react";
import { t } from "../i18n.js";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Catches render errors anywhere in the app and shows a recoverable message
 * instead of a blank screen. The developer detail is logged, not shown to the
 * operator (CLAUDE.md: 利用者向けの日本語メッセージと開発者向けの詳細を分ける).
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("pcms render error", error, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div className="pcms-errorpage" role="alert">
        <h1 className="pcms-errorpage__title">{t("error.title")}</h1>
        <p className="pcms-errorpage__msg">{t("error.message")}</p>
        <div className="pcms-errorpage__actions">
          <button className="pcms-primary" onClick={() => this.setState({ error: null })}>
            {t("error.retry")}
          </button>
          <button onClick={() => window.location.reload()}>{t("error.reload")}</button>
        </div>
      </div>
    );
  }
}
