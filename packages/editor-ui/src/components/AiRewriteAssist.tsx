import { useState } from "react";
import { t } from "../i18n.js";

interface Props {
  /** Ask the AI proxy (or its mock) to rewrite the current text per an instruction. */
  rewrite: (instruction: string) => Promise<string>;
  /** Apply an accepted rewrite to the field (replaces its HTML). */
  onApply: (html: string) => void;
}

type State =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "ready"; html: string }
  | { phase: "error" };

/** Quick instruction presets matched by the rewrite heuristics / model. */
const PRESETS: Array<{ key: string; instruction: string }> = [
  { key: "ai.rewrite.shorter", instruction: "短く" },
  { key: "ai.rewrite.polite", instruction: "丁寧に" },
  { key: "ai.rewrite.catchy", instruction: "魅力的に" },
];

/**
 * AI assist for a rich-text field: the model rewrites the current text per a
 * preset or a free instruction, the operator previews the result and chooses
 * 適用 / 別の案 / 取り消し. Never applied automatically (CLAUDE.md: AIは下書きと提案だけ).
 */
export function AiRewriteAssist({ rewrite, onApply }: Props) {
  const [instruction, setInstruction] = useState("");
  const [state, setState] = useState<State>({ phase: "idle" });

  const run = async (text: string) => {
    const instr = text.trim();
    if (!instr) return;
    setState({ phase: "loading" });
    try {
      const html = (await rewrite(instr)).trim();
      setState({ phase: "ready", html });
    } catch {
      setState({ phase: "error" });
    }
  };

  return (
    <div className="pcms-airw">
      <div className="pcms-airw__controls">
        {PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            className="pcms-airw__preset"
            disabled={state.phase === "loading"}
            onClick={() => {
              setInstruction(p.instruction);
              void run(p.instruction);
            }}
          >
            {t(p.key as Parameters<typeof t>[0])}
          </button>
        ))}
        <input
          type="text"
          className="pcms-airw__input"
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder={t("ai.instruction")}
        />
        <button
          type="button"
          className="pcms-airw__run"
          disabled={state.phase === "loading" || instruction.trim() === ""}
          onClick={() => void run(instruction)}
        >
          {state.phase === "loading" ? t("ai.generating") : t("ai.rewrite.button")}
        </button>
      </div>

      {state.phase === "error" && <p className="pcms-airw__error">{t("ai.error")}</p>}

      {state.phase === "ready" && (
        <div className="pcms-airw__result">
          <p className="pcms-airw__label">{t("ai.suggestion")}</p>
          <div
            className="pcms-airw__preview"
            // Preview only; the model output is validated before it is applied.
            dangerouslySetInnerHTML={{ __html: state.html }}
          />
          <div className="pcms-airw__actions">
            <button
              type="button"
              className="pcms-primary"
              onClick={() => {
                onApply(state.html);
                setState({ phase: "idle" });
              }}
            >
              {t("ai.apply")}
            </button>
            <button type="button" onClick={() => void run(instruction)}>
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
