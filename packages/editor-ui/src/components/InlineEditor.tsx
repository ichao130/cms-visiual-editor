import { useCallback, useEffect, useRef, useState } from "react";
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
 * SectionFields), follows the section as the preview scrolls, and can be dragged
 * by its header. The iframe is untrusted, so this lives in the parent and
 * positions itself from the rect the preview runtime reports.
 */
export function InlineEditor({
  schema,
  instance,
  anchor,
  onFieldChange,
  onRepeatChange,
  onClose,
}: InlineEditorProps) {
  // A manual position set by dragging overrides the anchored position until the
  // selection changes (then we re-anchor to the new section).
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ mx: number; my: number; ox: number; oy: number } | null>(null);

  useEffect(() => {
    setPos(null);
  }, [instance.id]);

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

  // Anchored position: beside the section, flipping / overlaying to stay in view.
  const rightX = rect.left + rect.width + GAP;
  const leftX = rect.left - CARD_W - GAP;
  let ax: number;
  if (rightX + CARD_W <= view.w - MARGIN) {
    ax = rightX;
  } else if (leftX >= MARGIN) {
    ax = leftX;
  } else {
    ax = Math.min(Math.max(MARGIN, rect.left + GAP), view.w - CARD_W - MARGIN);
  }
  const ay = Math.min(Math.max(rect.top, MARGIN), Math.max(MARGIN, view.h - 80));

  const x = pos ? pos.x : ax;
  const y = pos ? pos.y : ay;
  const maxHeight = Math.max(160, view.h - y - MARGIN);

  const onHeaderDown = useCallback(
    (e: React.MouseEvent) => {
      if ((e.target as HTMLElement).closest(".pcms-inline__close")) return;
      e.preventDefault();
      drag.current = { mx: e.clientX, my: e.clientY, ox: x, oy: y };
      setDragging(true);
    },
    [x, y],
  );

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const d = drag.current;
      if (!d) return;
      const nx = d.ox + (e.clientX - d.mx);
      const ny = d.oy + (e.clientY - d.my);
      setPos({
        x: Math.min(Math.max(MARGIN - CARD_W + 40, nx), view.w - 40),
        y: Math.min(Math.max(MARGIN, ny), Math.max(MARGIN, view.h - 40)),
      });
    };
    const onUp = () => {
      drag.current = null;
      setDragging(false);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragging, view.w, view.h]);

  return (
    <>
      {/* During a drag, cover the iframe so it doesn't swallow mouse events. */}
      {dragging && <div className="pcms-inline__shield" />}
      <div
        className="pcms-inline"
        style={{ left: `${x}px`, top: `${y}px`, width: `${CARD_W}px`, maxHeight: `${maxHeight}px` }}
        role="dialog"
        aria-label={schema.label ?? schema.id}
      >
        <header
          className={`pcms-inline__head${dragging ? " is-dragging" : ""}`}
          onMouseDown={onHeaderDown}
        >
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
    </>
  );
}
