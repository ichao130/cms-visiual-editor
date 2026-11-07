import { useState } from "react";
import type { BlockInstance, SectionInstance, SectionSchema } from "@pcms/shared";
import { SectionFields } from "./SectionFields.js";
import { t } from "../i18n.js";

type ChildOp = "up" | "down" | "del";

interface Props {
  /** The layout block instance (holds `columns` and `fields.ratio`). */
  block: BlockInstance;
  /** Schemas for the child block types, for labels + field editing. */
  childSchemaByType: Map<string, SectionSchema>;
  /** Block types that may go inside a column (layout types excluded). */
  childCatalog: { type: string; label: string }[];
  onCount: (count: number) => void;
  onRatio: (ratio: string) => void;
  onAddChild: (col: number, type: string) => void;
  onChildOp: (col: number, childId: string, op: ChildOp) => void;
  onChildField: (col: number, childId: string, path: string, value: string) => void;
}

/** Width-ratio presets offered for a given column count. */
function ratioPresets(count: number): string[] {
  if (count === 2) return ["1:1", "2:1", "1:2", "3:2", "2:3"];
  if (count === 3) return ["1:1:1", "2:1:1", "1:2:1", "1:1:2"];
  if (count >= 4) return [Array(count).fill("1").join(":")];
  return ["1"];
}

/**
 * Edits a layout (columns) block: the column count and width ratio, and the
 * child blocks inside each column (add / reorder / delete / edit fields). The
 * columns template itself has no fields, so this stands in for the normal field
 * panel when a layout block is selected.
 */
export function ColumnsManager({
  block,
  childSchemaByType,
  childCatalog,
  onCount,
  onRatio,
  onAddChild,
  onChildOp,
  onChildField,
}: Props) {
  const columns = block.columns ?? [];
  const count = columns.length || 1;
  const ratio = typeof block.fields?.ratio === "string" ? block.fields.ratio : "";
  const [open, setOpen] = useState<{ col: number; id: string } | null>(null);
  const [picking, setPicking] = useState<number | null>(null);

  const presets = ratioPresets(count);
  const ratioOptions = presets.includes(ratio) || ratio === "" ? presets : [ratio, ...presets];

  return (
    <div className="pcms-columns-mgr">
      <h3 className="pcms-blockmgr__title">{t("columns.title")}</h3>
      <p className="pcms-blockhelp">{t("columns.help")}</p>

      <div className="pcms-columns-mgr__ctrls">
        <label className="pcms-columns-mgr__ctrl">
          <span>{t("columns.count")}</span>
          <div className="pcms-columns-mgr__counts">
            {[2, 3, 4].map((n) => (
              <button
                key={n}
                type="button"
                className={count === n ? "is-active" : ""}
                onClick={() => onCount(n)}
              >
                {n}
              </button>
            ))}
          </div>
        </label>
        <label className="pcms-columns-mgr__ctrl">
          <span>{t("columns.width")}</span>
          <select value={ratio} onChange={(e) => onRatio(e.target.value)}>
            {ratioOptions.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
      </div>

      {columns.map((children, col) => (
        <div key={col} className="pcms-columns-mgr__col">
          <div className="pcms-columns-mgr__colhead">
            {t("columns.col")} {col + 1}
          </div>
          {children.length === 0 ? (
            <p className="pcms-empty">{t("columns.empty")}</p>
          ) : (
            <ul className="pcms-blockmgr__list">
              {children.map((child, i) => {
                const isOpen = open?.col === col && open?.id === child.id;
                const schema = childSchemaByType.get(child.type);
                return (
                  <li key={child.id} className={`pcms-blockmgr__row${isOpen ? " is-active" : ""}`}>
                    <div className="pcms-columns-mgr__childrow">
                      <button
                        type="button"
                        className="pcms-blockmgr__name"
                        onClick={() => setOpen(isOpen ? null : { col, id: child.id })}
                      >
                        {schema?.label ?? child.type}
                      </button>
                      <div className="pcms-blockmgr__ops">
                        <button
                          type="button"
                          onClick={() => onChildOp(col, child.id, "up")}
                          disabled={i === 0}
                          title={t("block.up")}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          onClick={() => onChildOp(col, child.id, "down")}
                          disabled={i === children.length - 1}
                          title={t("block.down")}
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          className="pcms-blockmgr__del"
                          onClick={() => {
                            if (isOpen) setOpen(null);
                            onChildOp(col, child.id, "del");
                          }}
                          title={t("block.delete")}
                        >
                          ×
                        </button>
                      </div>
                    </div>
                    {isOpen && schema && (
                      <div className="pcms-columns-mgr__fields">
                        <SectionFields
                          schema={schema}
                          instance={child as SectionInstance}
                          onFieldChange={(path, value) => onChildField(col, child.id, path, value)}
                          onRepeatChange={() => {}}
                        />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {picking === col ? (
            <div className="pcms-columns-mgr__pick">
              {childCatalog.map((c) => (
                <button
                  key={c.type}
                  type="button"
                  onClick={() => {
                    onAddChild(col, c.type);
                    setPicking(null);
                  }}
                >
                  {c.label}
                </button>
              ))}
              <button type="button" className="pcms-columns-mgr__pickcancel" onClick={() => setPicking(null)}>
                {t("columns.close")}
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="pcms-blockmgr__add"
              onClick={() => setPicking(col)}
              disabled={childCatalog.length === 0}
            >
              ＋ {t("columns.addChild")}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
