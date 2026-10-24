import { useState } from "react";
import { t } from "../i18n.js";

export interface InstanceRow {
  id: string;
  label: string;
  type: string;
  hidden: boolean;
}

interface SectionCanvasProps {
  instances: InstanceRow[];
  catalog: { type: string; label: string }[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onToggleHidden: (id: string) => void;
  /** Reorder from one index to another. */
  onMove: (from: number, to: number) => void;
  onDelete: (id: string) => void;
  onAdd: (type: string) => void;
}

/** Left-column canvas for a composed page: add / reorder / remove sections. */
export function SectionCanvas({
  instances,
  catalog,
  selectedId,
  onSelect,
  onToggleHidden,
  onMove,
  onDelete,
  onAdd,
}: SectionCanvasProps) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [addType, setAddType] = useState(catalog[0]?.type ?? "");

  return (
    <nav className="pcms-sections" aria-label={t("sections.title")}>
      <h2 className="pcms-col__title">{t("sections.title")}</h2>
      <ul>
        {instances.map((s, i) => (
          <li
            key={s.id}
            draggable
            onDragStart={() => setDragIndex(i)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (dragIndex != null && dragIndex !== i) onMove(dragIndex, i);
              setDragIndex(null);
            }}
            className={`pcms-section-row${s.id === selectedId ? " is-selected" : ""}${
              s.hidden ? " is-hidden" : ""
            }${dragIndex === i ? " is-dragging" : ""}`}
          >
            <span className="pcms-drag" title={t("sections.drag")} aria-hidden="true">
              ⠿
            </span>
            <button
              type="button"
              className="pcms-section-row__label"
              onClick={() => onSelect(s.id)}
            >
              {s.label}
            </button>
            <div className="pcms-section-row__actions">
              <button type="button" title={t("sections.up")} onClick={() => onMove(i, i - 1)} disabled={i === 0}>
                ↑
              </button>
              <button
                type="button"
                title={t("sections.down")}
                onClick={() => onMove(i, i + 1)}
                disabled={i === instances.length - 1}
              >
                ↓
              </button>
              <button type="button" className="pcms-toggle" onClick={() => onToggleHidden(s.id)}>
                {s.hidden ? t("sections.show") : t("sections.hide")}
              </button>
              <button type="button" className="pcms-danger" onClick={() => onDelete(s.id)}>
                {t("content.delete")}
              </button>
            </div>
          </li>
        ))}
      </ul>

      <div className="pcms-addsection">
        <select value={addType} onChange={(e) => setAddType(e.target.value)}>
          {catalog.map((c) => (
            <option key={c.type} value={c.type}>
              {c.label}
            </option>
          ))}
        </select>
        <button type="button" onClick={() => addType && onAdd(addType)}>
          {t("sections.add")}
        </button>
      </div>
    </nav>
  );
}
