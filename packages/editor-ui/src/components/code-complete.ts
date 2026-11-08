import {
  type Completion,
  type CompletionContext,
  type CompletionResult,
  snippetCompletion,
} from "@codemirror/autocomplete";
import { htmlLanguage } from "@codemirror/lang-html";
import { cssLanguage } from "@codemirror/lang-css";
import type { Extension } from "@codemirror/state";

/**
 * pcms-specific editor autocomplete. The generic HTML/CSS language packs don't
 * know this product's `data-*` theme vocabulary (CLAUDE.md テーマ仕様) or the
 * CSS custom properties a theme defines, which is what makes the stock
 * suggestions feel off. These sources are *added* to the language data facet, so
 * the built-in tag/property completions keep working alongside them.
 */

/** The theme `data-*` attributes, with Japanese hints shown in the popup. */
const DATA_ATTRS: { name: string; info: string; snippet: string }[] = [
  { name: "data-section", info: "並び替え・追加・非表示できる単位", snippet: 'data-section="${name}"' },
  { name: "data-field", info: "編集できる項目（型は要素から自動判定）", snippet: 'data-field="${name}"' },
  { name: "data-type", info: "型の明示（text/richtext/image/link/color/number/select）", snippet: 'data-type="${text}"' },
  { name: "data-label", info: "エディタに表示する項目名", snippet: 'data-label="${ラベル}"' },
  { name: "data-loop", info: "投稿などの繰り返し（posts / menu）", snippet: 'data-loop="${posts}"' },
  { name: "data-limit", info: "data-loop の最大件数", snippet: 'data-limit="${3}"' },
  { name: "data-repeat", info: "運用者が増減できる繰り返し（FAQ・スライド等）", snippet: 'data-repeat="${items}"' },
  { name: "data-if", info: "値が空なら要素ごと出さない", snippet: 'data-if="${field}"' },
  { name: "data-slot", info: "layout.html で各ページの中身が入る場所", snippet: 'data-slot="content"' },
  { name: "data-blocks", info: "ブロックを並べる場所（許可型 空白区切り／空=全部）", snippet: 'data-blocks="${}"' },
  { name: "data-block", info: "blocks/<型>.html のルート目印", snippet: "data-block" },
  { name: "data-columns", info: "レイアウト（カラム）ブロックのカラム置き場", snippet: "data-columns" },
];

/** Allowed values of `data-type`. */
const DATA_TYPES = ["text", "richtext", "image", "link", "color", "number", "select", "gallery"];

/** Loop sources offered for `data-loop`. */
const LOOP_SOURCES = ["posts", "menu"];

/** Common `data-field` paths a theme references (from CLAUDE.md examples). */
const FIELD_HINTS = [
  "post.title",
  "post.body",
  "post.date",
  "post.excerpt",
  "post.price",
  "post.image",
  "post.url",
  "item.label",
  "item.url",
  "site.name",
  "site.logo",
  "site.description",
  "pagination.label",
  "term.label",
];

const ATTR_OPTIONS: readonly Completion[] = DATA_ATTRS.map((a) =>
  snippetCompletion(a.snippet, {
    label: a.name,
    type: "property",
    info: a.info,
    boost: 50,
  }),
);

const TYPE_OPTIONS: readonly Completion[] = DATA_TYPES.map((v) => ({
  label: v,
  type: "enum",
}));

const FIELD_OPTIONS: readonly Completion[] = FIELD_HINTS.map((v) => ({
  label: v,
  type: "variable",
}));

const LOOP_OPTIONS: readonly Completion[] = LOOP_SOURCES.map((v) => ({
  label: v,
  type: "enum",
}));

/** Suggest pcms `data-*` attributes and the values of `data-type` / `data-field`. */
function pcmsHtmlSource(ctx: CompletionContext): CompletionResult | null {
  // Value of data-type="…": offer the known field types.
  const typeVal = ctx.matchBefore(/data-type="[\w-]*/);
  if (typeVal) {
    return {
      from: typeVal.from + typeVal.text.indexOf('"') + 1,
      options: TYPE_OPTIONS,
      validFor: /^[\w-]*$/,
    };
  }
  // Value of data-loop="…": offer the known loop sources.
  const loopVal = ctx.matchBefore(/data-loop="[\w-]*/);
  if (loopVal) {
    return {
      from: loopVal.from + loopVal.text.indexOf('"') + 1,
      options: LOOP_OPTIONS,
      validFor: /^[\w-]*$/,
    };
  }
  // Value of data-field="…"/data-if="…": offer common field paths.
  const fieldVal = ctx.matchBefore(/data-(?:field|if)="[\w.-]*/);
  if (fieldVal) {
    return {
      from: fieldVal.from + fieldVal.text.indexOf('"') + 1,
      options: FIELD_OPTIONS,
      validFor: /^[\w.-]*$/,
    };
  }
  // Attribute name: fires while typing `data-…` inside a tag.
  const attr = ctx.matchBefore(/data-[\w-]*/);
  if (attr && (attr.from < attr.to || ctx.explicit)) {
    return { from: attr.from, options: ATTR_OPTIONS, validFor: /^data-[\w-]*$/ };
  }
  return null;
}

/** HTML language extension that adds the pcms `data-*` completions. */
export function pcmsHtmlCompletions(): Extension {
  return htmlLanguage.data.of({ autocomplete: pcmsHtmlSource });
}

/**
 * CSS language extension that suggests the theme's own custom properties when
 * the operator types `--…` (declaring) or `var(--…` (referencing). `vars` is the
 * list of property names without the leading `--` (e.g. "primary", "accent").
 */
export function pcmsCssCompletions(vars: readonly string[]): Extension {
  const seen = Array.from(new Set(vars)).sort();
  const options: Completion[] = seen.map((name) => ({
    label: `--${name}`,
    type: "variable",
    boost: 50,
  }));
  const source = (ctx: CompletionContext): CompletionResult | null => {
    if (options.length === 0) return null;
    const token = ctx.matchBefore(/--[\w-]*/);
    if (!token || (token.from === token.to && !ctx.explicit)) return null;
    return { from: token.from, options, validFor: /^--[\w-]*$/ };
  };
  return cssLanguage.data.of({ autocomplete: source });
}

/** Extract `--name` custom-property names declared in a stylesheet. */
export function cssVarNames(css: string): string[] {
  const out = new Set<string>();
  const re = /--([\w-]+)\s*:/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) out.add(m[1]!);
  return [...out];
}
