import {
  themeifyHtml,
  validateThemeHtml,
  draftText,
  rewriteText,
  seoSuggest,
} from "@pcms/engine";

/**
 * AI provider behind the proxy. The proxy (not the app) holds the key and
 * enforces quota — CLAUDE.md: AIの呼び出しは必ずプロキシ経由、APIキーをアプリに
 * 埋め込まない. Only the content needed for the operation is passed in; server
 * connection info and form data never reach the provider.
 */

export type AiOp = "themeify" | "draft" | "rewrite" | "seo";

export interface AiRequest {
  op: AiOp;
  args: Record<string, unknown>;
}

export interface AiProvider {
  readonly name: string;
  run(req: AiRequest): Promise<unknown>;
}

const str = (v: unknown): string => (v == null ? "" : String(v));

/** Offline provider (evaluation build) — deterministic engine helpers. */
export class MockProvider implements AiProvider {
  readonly name = "mock";
  async run(req: AiRequest): Promise<unknown> {
    switch (req.op) {
      case "themeify": {
        const html = themeifyHtml(str(req.args.html));
        return { html, issues: validateThemeHtml(html) };
      }
      case "draft":
        return { text: draftText(str(req.args.prompt)) };
      case "rewrite":
        return { text: rewriteText(str(req.args.text), str(req.args.instruction)) };
      case "seo":
        return seoSuggest(str(req.args.title), str(req.args.body));
      default:
        throw new Error(`unknown op: ${String(req.op)}`);
    }
  }
}

/**
 * Production provider — calls Claude through the Anthropic SDK with the
 * server-held key. The SDK is imported dynamically so it is optional in the
 * evaluation build. AI output is still validated (themeify) before it is used.
 */
export class ClaudeProvider implements AiProvider {
  readonly name = "claude";
  constructor(private readonly model = "claude-opus-5-5") {}

  async run(req: AiRequest): Promise<unknown> {
    const moduleName = "@anthropic-ai/sdk";
    const mod = await import(moduleName);
    const Anthropic = (mod.default ?? mod) as new () => AnthropicLike;
    const client = new Anthropic(); // reads ANTHROPIC_API_KEY from the env
    const res = await client.messages.create({
      model: this.model,
      max_tokens: 4000,
      messages: [{ role: "user", content: buildPrompt(req) }],
    });
    const text = (res.content ?? [])
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("");

    if (req.op === "themeify") return { html: text, issues: validateThemeHtml(text) };
    if (req.op === "seo") return { title: str(req.args.title), description: text.trim() };
    return { text };
  }
}

interface AnthropicLike {
  messages: {
    create(params: {
      model: string;
      max_tokens: number;
      messages: { role: string; content: string }[];
    }): Promise<{ content?: { type: string; text?: string }[] }>;
  };
}

function buildPrompt(req: AiRequest): string {
  switch (req.op) {
    case "themeify":
      return `次のHTMLを、data-section / data-field（型と日本語ラベル付き）を加えた編集可能なテーマHTMLに変換してください。HTMLのみを返してください。\n\n${str(req.args.html)}`;
    case "draft":
      return `次のテーマで、短いお店の紹介文をHTMLの<p>で2段落、日本語で書いてください。\n\nテーマ: ${str(req.args.prompt)}`;
    case "rewrite":
      return `次の本文を「${str(req.args.instruction)}」という指示に沿ってリライトし、HTMLで返してください。\n\n${str(req.args.text)}`;
    case "seo":
      return `次の記事のメタディスクリプションを120文字以内の日本語で1つ書いてください。説明文のみを返してください。\n\nタイトル: ${str(req.args.title)}\n本文: ${str(req.args.body)}`;
    default:
      return "";
  }
}

/** Use Claude when a key is configured; otherwise the offline mock. */
export function makeProvider(): AiProvider {
  return process.env.ANTHROPIC_API_KEY ? new ClaudeProvider() : new MockProvider();
}
