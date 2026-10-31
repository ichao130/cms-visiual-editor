import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { blocksToHtml, htmlToBlocks, type Block } from "@pcms/engine";
import { useMedia } from "../media/MediaContext.js";
import { t } from "../i18n.js";

interface BlockEditorProps {
  value: string;
  onChange: (html: string) => void;
}

/** A block plus a stable React key, so editing one block never remounts another. */
interface Row {
  id: string;
  block: Block;
}

let seq = 0;
const nextId = () => `blk-${seq++}`;
const toRows = (html: string): Row[] =>
  htmlToBlocks(html).map((block) => ({ id: nextId(), block }));

/** Kinds offered in the "add block" menu, in display order. */
const KINDS = [
  "paragraph",
  "heading2",
  "heading3",
  "list",
  "orderedlist",
  "quote",
  "image",
  "gallery",
  "divider",
  "html",
] as const;
type Kind = (typeof KINDS)[number];

const KIND_LABEL: Record<Kind, string> = {
  paragraph: "段落",
  heading2: "見出し（大）",
  heading3: "見出し（小）",
  list: "箇条書き",
  orderedlist: "番号付き",
  quote: "引用",
  image: "画像",
  gallery: "ギャラリー",
  divider: "区切り線",
  html: "HTML / 埋め込み",
};

function newBlock(kind: Kind): Block {
  switch (kind) {
    case "heading2":
      return { type: "heading", level: 2, html: "" };
    case "heading3":
      return { type: "heading", level: 3, html: "" };
    case "list":
      return { type: "list", ordered: false, items: [""] };
    case "orderedlist":
      return { type: "list", ordered: true, items: [""] };
    case "quote":
      return { type: "quote", html: "" };
    case "image":
      return { type: "image", src: "", alt: "" };
    case "gallery":
      return { type: "gallery", images: [] };
    case "divider":
      return { type: "divider" };
    case "html":
      return { type: "html", html: "" };
    case "paragraph":
    default:
      return { type: "paragraph", html: "" };
  }
}

/**
 * A block-based editor for content bodies. Bodies are still stored as HTML, so
 * the editor parses the incoming HTML into blocks and serializes back on every
 * change (engine `htmlToBlocks` / `blocksToHtml`). Inline formatting inside text
 * blocks uses the browser's own rich-text commands over a small allow-list that
 * the engine parser preserves.
 */
export function BlockEditor({ value, onChange }: BlockEditorProps) {
  const [rows, setRows] = useState<Row[]>(() => toRows(value));
  // The HTML we last emitted, to tell our own edits from an external change
  // (switching items, AI rewrite apply) and only then re-parse into fresh rows.
  const lastEmitted = useRef<string>(blocksToHtml(rows.map((r) => r.block)));

  useEffect(() => {
    if (value !== lastEmitted.current) {
      const next = toRows(value);
      lastEmitted.current = blocksToHtml(next.map((r) => r.block));
      setRows(next);
    }
  }, [value]);

  const emit = (next: Row[]) => {
    setRows(next);
    const html = blocksToHtml(next.map((r) => r.block));
    lastEmitted.current = html;
    onChange(html);
  };

  const update = (id: string, block: Block) =>
    emit(rows.map((r) => (r.id === id ? { ...r, block } : r)));
  const remove = (id: string) => emit(rows.filter((r) => r.id !== id));
  const move = (id: string, dir: -1 | 1) => {
    const i = rows.findIndex((r) => r.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= rows.length) return;
    const next = [...rows];
    [next[i], next[j]] = [next[j]!, next[i]!];
    emit(next);
  };
  const insertAt = (index: number, kind: Kind) => {
    const next = [...rows];
    next.splice(index, 0, { id: nextId(), block: newBlock(kind) });
    emit(next);
  };

  return (
    <div className="pcms-blocks">
      <InlineToolbar />
      {rows.length === 0 && (
        <p className="pcms-blocks__empty">{t("blocks.empty")}</p>
      )}
      {rows.map((row, i) => (
        <div className="pcms-block" key={row.id}>
          <div className="pcms-block__controls">
            <button
              type="button"
              onClick={() => move(row.id, -1)}
              disabled={i === 0}
              aria-label={t("blocks.up")}
              title={t("blocks.up")}
            >
              ▲
            </button>
            <button
              type="button"
              onClick={() => move(row.id, 1)}
              disabled={i === rows.length - 1}
              aria-label={t("blocks.down")}
              title={t("blocks.down")}
            >
              ▼
            </button>
            <button
              type="button"
              className="pcms-danger"
              onClick={() => remove(row.id)}
              aria-label={t("blocks.remove")}
              title={t("blocks.remove")}
            >
              ✕
            </button>
          </div>
          <div className="pcms-block__body">
            <BlockBody block={row.block} onChange={(b) => update(row.id, b)} />
          </div>
          <AddMenu label={t("blocks.addHere")} onPick={(k) => insertAt(i + 1, k)} />
        </div>
      ))}
      <div className="pcms-blocks__foot">
        <AddMenu label={t("blocks.add")} onPick={(k) => insertAt(rows.length, k)} primary />
      </div>
    </div>
  );
}

/** Inline formatting applied to whatever text block currently has the caret. */
function InlineToolbar() {
  const exec = (command: string, arg?: string) => document.execCommand(command, false, arg);
  const link = () => {
    const url = window.prompt(t("blocks.linkUrl"));
    if (url) exec("createLink", url);
  };
  // Keep the caret in the editable block (buttons would otherwise steal focus).
  const hold = (e: MouseEvent) => e.preventDefault();
  return (
    <div className="pcms-blocks__inline" onMouseDown={hold}>
      <button type="button" onClick={() => exec("bold")}>
        <b>B</b>
      </button>
      <button type="button" onClick={() => exec("italic")}>
        <i>I</i>
      </button>
      <button type="button" onClick={link}>
        {t("blocks.link")}
      </button>
      <button type="button" onClick={() => exec("unlink")}>
        {t("blocks.unlink")}
      </button>
    </div>
  );
}

function BlockBody({ block, onChange }: { block: Block; onChange: (b: Block) => void }) {
  switch (block.type) {
    case "heading":
      return (
        <div className="pcms-block__headrow">
          <select
            className="pcms-block__level"
            value={block.level}
            onChange={(e) =>
              onChange({ ...block, level: Number(e.target.value) === 3 ? 3 : 2 })
            }
            aria-label={t("blocks.level")}
          >
            <option value={2}>H2</option>
            <option value={3}>H3</option>
          </select>
          <Editable
            className={`pcms-block__text is-h${block.level}`}
            html={block.html}
            placeholder={KIND_LABEL[block.level === 3 ? "heading3" : "heading2"]}
            onChange={(html) => onChange({ ...block, html })}
          />
        </div>
      );
    case "paragraph":
      return (
        <Editable
          className="pcms-block__text"
          html={block.html}
          placeholder={KIND_LABEL.paragraph}
          onChange={(html) => onChange({ ...block, html })}
        />
      );
    case "quote":
      return (
        <Editable
          className="pcms-block__text is-quote"
          html={block.html}
          placeholder={KIND_LABEL.quote}
          onChange={(html) => onChange({ ...block, html })}
        />
      );
    case "list":
      return (
        <div className="pcms-block__list">
          <label className="pcms-block__listtype">
            <input
              type="checkbox"
              checked={block.ordered}
              onChange={(e) => onChange({ ...block, ordered: e.target.checked })}
            />
            {t("blocks.ordered")}
          </label>
          <textarea
            rows={Math.max(2, block.items.length)}
            value={block.items.join("\n")}
            placeholder={t("blocks.listHint")}
            onChange={(e) =>
              onChange({ ...block, items: e.target.value.split("\n").map((s) => s.trim()).filter((s) => s !== "") })
            }
          />
        </div>
      );
    case "image":
      return <ImageBlock block={block} onChange={onChange} />;
    case "gallery":
      return <GalleryBlock block={block} onChange={onChange} />;
    case "divider":
      return <hr className="pcms-block__divider" />;
    case "html":
      return (
        <textarea
          className="pcms-block__html"
          rows={Math.max(2, block.html.split("\n").length)}
          value={block.html}
          placeholder={t("blocks.htmlHint")}
          onChange={(e) => onChange({ ...block, html: e.target.value })}
        />
      );
  }
}

function ImageBlock({
  block,
  onChange,
}: {
  block: Extract<Block, { type: "image" }>;
  onChange: (b: Block) => void;
}) {
  const { pickImage, resolveUrl } = useMedia();
  const thumb = resolveUrl(block.src);
  const pick = async () => {
    const path = await pickImage();
    if (path != null) onChange({ ...block, src: path });
  };
  return (
    <div className="pcms-block__image">
      <button type="button" className="pcms-imagefield__thumb" onClick={pick}>
        {thumb ? <img src={thumb} alt="" /> : <span className="pcms-imagefield__placeholder">{t("media.pick")}</span>}
      </button>
      <div className="pcms-block__imagemeta">
        <button type="button" onClick={pick}>
          {block.src ? t("media.change") : t("media.pick")}
        </button>
        <input
          type="text"
          value={block.alt}
          placeholder={t("blocks.alt")}
          onChange={(e) => onChange({ ...block, alt: e.target.value })}
        />
        <input
          type="text"
          value={block.caption ?? ""}
          placeholder={t("blocks.caption")}
          onChange={(e) => onChange({ ...block, caption: e.target.value })}
        />
      </div>
    </div>
  );
}

function GalleryBlock({
  block,
  onChange,
}: {
  block: Extract<Block, { type: "gallery" }>;
  onChange: (b: Block) => void;
}) {
  const { pickImage, resolveUrl } = useMedia();
  const setImages = (images: { src: string; alt: string }[]) => onChange({ ...block, images });
  const add = async () => {
    const path = await pickImage();
    if (path != null) setImages([...block.images, { src: path, alt: "" }]);
  };
  const change = async (idx: number) => {
    const path = await pickImage();
    if (path != null) setImages(block.images.map((im, i) => (i === idx ? { ...im, src: path } : im)));
  };
  return (
    <div className="pcms-block__gallery">
      <div className="pcms-block__gallerygrid">
        {block.images.map((im, i) => (
          <div className="pcms-block__galleryitem" key={i}>
            <button type="button" className="pcms-imagefield__thumb" onClick={() => change(i)}>
              {resolveUrl(im.src) ? (
                <img src={resolveUrl(im.src)} alt="" />
              ) : (
                <span className="pcms-imagefield__placeholder">{t("media.pick")}</span>
              )}
            </button>
            <input
              type="text"
              value={im.alt}
              placeholder={t("blocks.alt")}
              onChange={(e) =>
                setImages(block.images.map((x, j) => (j === i ? { ...x, alt: e.target.value } : x)))
              }
            />
            <button
              type="button"
              className="pcms-danger pcms-block__galleryremove"
              onClick={() => setImages(block.images.filter((_, j) => j !== i))}
            >
              {t("blocks.remove")}
            </button>
          </div>
        ))}
      </div>
      <button type="button" onClick={add}>
        {t("blocks.addImage")}
      </button>
    </div>
  );
}

/**
 * An uncontrolled contentEditable region. The initial HTML is written to the
 * DOM once on mount; thereafter React never touches its content, so the caret
 * stays put while typing. Switching items changes the block's React key, which
 * remounts this and loads the new HTML.
 */
function Editable({
  html,
  className,
  placeholder,
  onChange,
}: {
  html: string;
  className: string;
  placeholder: string;
  onChange: (html: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const initial = useMemo(() => html, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (ref.current && ref.current.innerHTML !== initial) ref.current.innerHTML = initial;
  }, [initial]);
  return (
    <div
      ref={ref}
      className={className}
      contentEditable
      suppressContentEditableWarning
      data-placeholder={placeholder}
      onInput={(e) => onChange(e.currentTarget.innerHTML)}
    />
  );
}

function AddMenu({
  label,
  onPick,
  primary,
}: {
  label: string;
  onPick: (kind: Kind) => void;
  primary?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="pcms-addblock">
      <button
        type="button"
        className={primary ? "pcms-addblock__btn pcms-primary" : "pcms-addblock__btn"}
        onClick={() => setOpen((v) => !v)}
      >
        ＋ {label}
      </button>
      {open && (
        <div className="pcms-addblock__menu">
          {KINDS.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => {
                onPick(k);
                setOpen(false);
              }}
            >
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
