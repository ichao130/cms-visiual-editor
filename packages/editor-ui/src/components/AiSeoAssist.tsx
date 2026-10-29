import { useState } from "react";
import { t } from "../i18n.js";

interface Props {
  /** Ask the AI proxy (or its mock) for a description suggestion. */
  suggest: () => Promise<string>;
  /** Apply an accepted suggestion to the item's description field. */
  onApply: (text: string) => void;
}

type State =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "ready"; text: string }
  | { phase: "empty" }
  | { phase: "error" };

/**
 * AI assist for the meta description: the model drafts a suggestion, the
 * operator previews it and chooses 適用 / 別の案 / 取り消し. The content is never
 * applied automatically (CLAUDE.md: AIは下書きと提案だけ).
 */
export function AiSeoAssist({ suggest, onApply }: Props) {
  const [state, setState] = useState<State>({ phase: "idle" });

  const run = async () => {
    setState({ phase: "loading" });
    try {
      const text = (await suggest()).trim();
      setState(text ? { phase: "ready", text } : { phase: "empty" });
    } catch {
      setState({ phase: "error" });
    }
  };

  return (
    <div className="pcms-aiseo">
      <button
        type="button"
        className="pcms-aiseo__run"
        onClick={run}
        disabled={state.phase === "loading"}
      >
        {state.phase === "loading" ? t("ai.generating") : t("ai.seoButton")}
      </button>

      {state.phase === "empty" && <p className="pcms-fieldhint">{t("ai.empty")}</p>}
      {state.phase === "error" && <p className="pcms-aiseo__error">{t("ai.error")}</p>}

      {state.phase === "ready" && (
        <div className="pcms-aiseo__result">
          <p className="pcms-aiseo__label">{t("ai.suggestion")}</p>
          <p className="pcms-aiseo__text">{state.text}</p>
          <div className="pcms-aiseo__actions">
            <button
              type="button"
              className="pcms-primary"
              onClick={() => {
                onApply(state.text);
                setState({ phase: "idle" });
              }}
            >
              {t("ai.apply")}
            </button>
            <button type="button" onClick={run}>
              {t("ai.another")}
            </button>
            <button type="button" onClick={() => setState({ phase: "idle" })}>
              {t("ai.cancel")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
