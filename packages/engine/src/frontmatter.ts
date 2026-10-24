import type { FieldValue } from "@pcms/shared";

/**
 * Minimal YAML front-matter parser.
 *
 * This supports the subset pcms writes into content files: `key: value` pairs
 * with string / number / boolean / null scalars and simple inline or block
 * lists. It is deliberately tiny — a full YAML dependency is overkill for the
 * flat metadata the editor produces, and keeping it in-house keeps the engine
 * dependency-light. If richer YAML is ever needed we revisit (CLAUDE.md:
 * propose new deps first).
 */
export interface ParsedFrontMatter {
  data: Record<string, FieldValue>;
  body: string;
}

const FRONT_MATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export function parseFrontMatter(input: string): ParsedFrontMatter {
  const match = FRONT_MATTER_RE.exec(input);
  if (!match) {
    return { data: {}, body: input };
  }
  const [, raw = "", body = ""] = match;
  return { data: parseBlock(raw), body };
}

function parseBlock(raw: string): Record<string, FieldValue> {
  const data: Record<string, FieldValue> = {};
  const lines = raw.split(/\r?\n/);
  let currentKey: string | null = null;
  let currentList: FieldValue[] | null = null;

  for (const line of lines) {
    if (line.trim() === "") continue;

    // Block-list item: "  - value"
    const listItem = /^\s*-\s+(.*)$/.exec(line);
    if (listItem && currentKey && currentList) {
      currentList.push(parseScalar(listItem[1] ?? ""));
      continue;
    }

    const kv = /^([A-Za-z0-9_.-]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1] as string;
    const rest = (kv[2] ?? "").trim();

    if (rest === "") {
      // Begin a block list on following lines.
      currentKey = key;
      currentList = [];
      data[key] = currentList;
      continue;
    }

    currentKey = null;
    currentList = null;
    data[key] = parseValue(rest);
  }

  return data;
}

function parseValue(raw: string): FieldValue {
  // Inline list: [a, b, c]
  if (raw.startsWith("[") && raw.endsWith("]")) {
    const inner = raw.slice(1, -1).trim();
    if (inner === "") return [];
    return inner.split(",").map((part) => parseScalar(part.trim()));
  }
  return parseScalar(raw);
}

function parseScalar(raw: string): FieldValue {
  let v = raw;
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    return v.slice(1, -1);
  }
  if (v === "true") return true;
  if (v === "false") return false;
  if (v === "null" || v === "~") return null;
  if (v !== "" && !Number.isNaN(Number(v)) && /^-?\d+(\.\d+)?$/.test(v)) {
    return Number(v);
  }
  return v;
}
