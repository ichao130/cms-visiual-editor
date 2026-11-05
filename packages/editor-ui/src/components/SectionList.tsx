import { useDragReorder } from "../state/useDragReorder.js";
import { t } from "../i18n.js";
import { Icon } from "./Icon.js";

export interface SectionRow {
  id: string;
  label: string;
  hidden: boolean;
}

interface SectionListProps {
  sections: SectionRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onToggleHidden: (id: string) => void;
  onMove: (id: string, dir: -1 | 1) => void;
  /** Reorder to an arbitrary position (drag-and-drop); indices into `sections`. */
  onReorder: (from: number, to: number) => void;
}

export function SectionList({
  sections,
  selectedId,
  onSelect,
  onToggleHidden,
  onMove,
  onReorder,
}: SectionListProps) {
  const dnd = useDragReorder(onReorder);
  return (
    <nav className="pcms-sections" aria-label={t("sections.title")}>
      <h2 className="pcms-col__title">{t("sections.title")}</h2>
      <ul>
        {sections.map((s, i) => (
          <li
            key={s.id}
            className={`pcms-section-row${s.id === selectedId ? " is-selected" : ""}${
              s.hidden ? " is-hidden" : ""
            }`}
            {...dnd.zoneProps(i)}
          >
            <span
              className="pcms-draghandle"
              aria-label={t("common.drag")}
              title={t("common.drag")}
              {...dnd.handleProps(i)}
            >
              <Icon name="grip" size={15} />
            </span>
            <button
              type="button"
              className="pcms-section-row__label"
              onClick={() => onSelect(s.id)}
            >
              {s.label}
            </button>
            <div className="pcms-section-row__actions">
              <button
                type="button"
                title={t("sections.up")}
                onClick={() => onMove(s.id, -1)}
                disabled={i === 0}
              >
                <Icon name="chevron-up" size={15} />
              </button>
              <button
                type="button"
                title={t("sections.down")}
                onClick={() => onMove(s.id, 1)}
                disabled={i === sections.length - 1}
              >
                <Icon name="chevron-down" size={15} />
              </button>
              <button
                type="button"
                className="pcms-toggle"
                onClick={() => onToggleHidden(s.id)}
              >
                {s.hidden ? t("sections.show") : t("sections.hide")}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </nav>
  );
}
