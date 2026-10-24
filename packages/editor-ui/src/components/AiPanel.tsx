import { useState } from "react";
import type { PcmsApi, AiSeoResult } from "../api/types.js";
import type { AiIssue } from "@pcms/engine";
import { t } from "../i18n.js";

interface ContentContext {
  title: string;
  body: string;
  onApplyBody: (html: string) => void;
}

interface AiPanelProps {
  api: PcmsApi;
  content?: ContentContext;
  onClose: () => void;
}

type Mode = "assist" | "themeify";
type Op = "draft" | "rewrite" | "seo";

/**
 * AI assist. The model only drafts / suggests — the operator reviews the result
 * and chooses 適用 / 別の案 / 閉じる (CLAUDE.md: AIは下書きと提案だけ、差分を見せて人が選ぶ).
 * Offline heuristics stand in for the model in the evaluation build.
 */
export function AiPanel({ api, content, onClose }: AiPanelProps) {
  const [mode, setMode] = useState<Mode>("assist");
  const [op, setOp] = useState<Op>("draft");
  const [prompt, setPrompt] = useState("");
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);

  const [proposed, setProposed] = useState<string | null>(null);
  const [seo, setSeo] = useState<AiSeoResult | null>(null);

  const [html, setHtml] = useState("");
  const [themed, setThemed] = useState<string | null>(null);
  const [issues, setIssues] = useState<AiIssue[]>([]);

  const generate = async () => {
    setBusy(true);
    try {
      if (op === "draft") {
        setSeo(null);
        setProposed(await api.aiDraft(prompt));
      } else if (op === "rewrite") {
        setSeo(null);
        setProposed(await api.aiRewrite(content?.body ?? "", instruction));
      } else {
        setProposed(null);
        setSeo(await api.aiSeo(content?.title ?? "", content?.body ?? ""));
      }
    } finally {
      setBusy(false);
    }
  };

  const convert = async () => {
    setBusy(true);
    try {
      const r = await api.aiThemeify(html);
      setThemed(r.html);
      setIssues(r.issues);
    } finally {
      setBusy(false);
    }
  };

  const applyBody = () => {
    if (content && proposed != null) {
      content.onApplyBody(proposed);
      onClose();
    }
  };

  return (
    <div className="pcms-modal" role="dialog" aria-modal="true" aria-label={t("ai.title")}>
      <div className="pcms-modal__backdrop" onClick={onClose} />
      <div className="pcms-modal__panel pcms-modal__panel--wide">
        <header className="pcms-modal__head">
          <h2>{t("ai.title")}</h2>
          <div className="pcms-modal__spacer" />
          <button type="button" onClick={onClose} aria-label={t("media.close")}>
            ✕
          </button>
        </header>

        <p className="pcms-ai__note">{t("ai.note")}</p>

        <div className="pcms-ai__tabs">
          <button type="button" className={mode === "assist" ? "is-active" : ""} onClick={() => setMode("assist")}>
            {t("ai.tab.assist")}
          </button>
          <button type="button" className={mode === "themeify" ? "is-active" : ""} onClick={() => setMode("themeify")}>
            {t("ai.tab.themeify")}
          </button>
        </div>

        {mode === "assist" ? (
          <div className="pcms-ai__assist">
            {content ? (
              <p className="pcms-ai__target">
                {t("ai.target")}：{content.title}
              </p>
            ) : (
              <p className="pcms-empty">{t("ai.noContent")}</p>
            )}

            <label className="pcms-field">
              <span className="pcms-field__label">{t("ai.op")}</span>
              <select value={op} onChange={(e) => setOp(e.target.value as Op)}>
                <option value="draft">{t("ai.op.draft")}</option>
                <option value="rewrite">{t("ai.op.rewrite")}</option>
                <option value="seo">{t("ai.op.seo")}</option>
              </select>
            </label>

            {op === "draft" && (
              <label className="pcms-field">
                <span className="pcms-field__label">{t("ai.prompt")}</span>
                <input value={prompt} onChange={(e) => setPrompt(e.target.value)} />
              </label>
            )}
            {op === "rewrite" && (
              <label className="pcms-field">
                <span className="pcms-field__label">{t("ai.instruction")}</span>
                <input value={instruction} onChange={(e) => setInstruction(e.target.value)} />
              </label>
            )}

            <button type="button" className="pcms-primary" onClick={generate} disabled={busy}>
              {busy ? t("ai.generating") : t("ai.generate")}
            </button>

            {op === "rewrite" && content && (
              <div className="pcms-ai__before">
                <span className="pcms-field__label">{t("ai.current")}</span>
                <div className="pcms-ai__box" dangerouslySetInnerHTML={{ __html: content.body }} />
              </div>
            )}

            {proposed != null && (
              <div className="pcms-ai__result">
                <span className="pcms-field__label">{t("ai.proposed")}</span>
                <div className="pcms-ai__box" dangerouslySetInnerHTML={{ __html: proposed }} />
                <div className="pcms-modal__actions">
                  <button type="button" onClick={generate} disabled={busy}>
                    {t("ai.another")}
                  </button>
                  <button type="button" className="pcms-primary" onClick={applyBody} disabled={!content}>
                    {t("ai.apply")}
                  </button>
                </div>
              </div>
            )}

            {seo != null && (
              <div className="pcms-ai__result">
                <label className="pcms-field">
                  <span className="pcms-field__label">{t("ai.result")}（title）</span>
                  <input readOnly value={seo.title} />
                </label>
                <label className="pcms-field">
                  <span className="pcms-field__label">{t("ai.seo.descLabel")}</span>
                  <textarea readOnly rows={3} value={seo.description} />
                </label>
              </div>
            )}
          </div>
        ) : (
          <div className="pcms-ai__themeify">
            <label className="pcms-field">
              <span className="pcms-field__label">{t("ai.htmlInput")}</span>
              <textarea rows={6} value={html} onChange={(e) => setHtml(e.target.value)} />
            </label>
            <button type="button" className="pcms-primary" onClick={convert} disabled={busy || !html.trim()}>
              {busy ? t("ai.generating") : t("ai.convert")}
            </button>

            {themed != null && (
              <div className="pcms-ai__result">
                <span className="pcms-field__label">{t("ai.result")}</span>
                <textarea className="pcms-ai__code" readOnly rows={8} value={themed} />
                {issues.length === 0 ? (
                  <p className="pcms-ai__ok">{t("ai.issues.none")}</p>
                ) : (
                  <ul className="pcms-publish__issues">
                    {issues.map((i, idx) => (
                      <li key={idx} className={`pcms-publish__issue is-${i.level}`}>
                        [{i.level === "error" ? "エラー" : "注意"}] {i.message}
                      </li>
                    ))}
                  </ul>
                )}
                <div className="pcms-modal__actions">
                  <button type="button" onClick={() => void navigator.clipboard?.writeText(themed)}>
                    {t("ai.copy")}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
