import { useEffect } from "react";
import type { FieldValue, SectionInstance, SectionSchema } from "@pcms/shared";
import { SectionFields } from "./SectionFields.js";
import { t } from "../i18n.js";

type Row = Record<string, FieldValue>;

/** Geometry of the selected section, in the preview iframe's own coordinates. */
export interface Anchor {
  rect: { top: number; left: number; width: number; height: number };
  view: { w: number; h: number };
}

interface InlineEditorProps {
  schema: SectionSchema;
  instance: SectionInstance;
  anchor: Anchor;
  onFieldChange: (path: string, value: string) => void;
  onRepeatChange: (name: string, rows: Row[]) => void;
  onClose: () => void;
}

const CARD_W = 300;
const GAP = 12;
const MARGIN = 8;

/**
 * Studio-style on-preview editor: a floating card anchored next to the selected
 * section. It renders the same fields as the right-hand panel (shared state via
 * SectionFields) and follows the section as the preview scrolls. The iframe is
 * untrusted, so this lives in the parent and positions itself from the rect the
 * preview runtime reports — it never reaches into the iframe.
 */
export function InlineEditor({
  schema,
  instance,
  anchor,
  onFieldChange,
  onRepeatChange,
  onClose,
}: InlineEditorProps) {
  // Close on Escape (unless a field is mid-edit inside the card).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const active = document.activeElement as HTMLElement | null;
      if (active?.closest(".pcms-inline")) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const { rect, view } = anchor;
  const rightX = rect.left + rect.width + GAP;
  const leftX = rect.left - CARD_W - GAP;
  let x: number;
  if (rightX + CARD_W <= view.w - MARGIN) {
    x = rightX; // beside the section, to its right
  } else if (leftX >= MARGIN) {
    x = leftX; // flipped to the left when the right would overflow
  } else {
    x = Math.min(Math.max(MARGIN, rect.left + GAP), view.w - CARD_W - MARGIN); // overlay inside
  }
  const y = Math.min(Math.max(rect.top, MARGIN), Math.max(MARGIN, view.h - 80));
  const maxHeight = Math.max(160, view.h - y - MARGIN);

  return (
    <div
      className="pcms-inline"
      style={{ left: `${x}px`, top: `${y}px`, width: `${CARD_W}px`, maxHeight: `${maxHeight}px` }}
      role="dialog"
      aria-label={schema.label ?? schema.id}
    >
      <header className="pcms-inline__head">
        <span className="pcms-inline__title">{schema.label ?? schema.id}</span>
        <button
          type="button"
          className="pcms-inline__close"
          onClick={onClose}
          aria-label={t("inline.close")}
          title={t("inline.close")}
        >
          ×
        </button>
      </header>
      <div className="pcms-inline__body">
        <SectionFields
          schema={schema}
          instance={instance}
          onFieldChange={onFieldChange}
          onRepeatChange={onRepeatChange}
        />
      </div>
    </div>
  );
}
