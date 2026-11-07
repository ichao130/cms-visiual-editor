import { useState } from "react";
import type { DragEvent, ReactNode } from "react";
import type { BlockInstance, SectionInstance, SectionSchema } from "@pcms/shared";
import { SectionFields } from "./SectionFields.js";
import { t } from "../i18n.js";

type BlockOp = "up" | "down" | "dup" | "del";

interface BlockManagerProps {
  blocks: BlockInstance[];
  schemaByType: Map<string, SectionSchema>;
  selectedBlockId: string | null;
  onSelect: (blockId: string) => void;
  onOp: (blockId: string, op: BlockOp) => void;
  /** Drag-reorder: move the block to the gap `toIndex` (0..length). */
  onMove: (blockId: string, toIndex: number) => void;
  /** Opens the block picker to add a block at the end of the list. */
  onAddClick: () => void;
}

/**
 * The nested-block list shown under a section's settings: select / reorder
 * (buttons or drag) / duplicate / delete the blocks, and add a new one. Field
 * editing of a block happens in BlockSettings (opened by selecting a block).
 */
export function BlockManager({
  blocks,
  schemaByType,
  selectedBlockId,
  onSelect,
  onOp,
  onMove,
  onAddClick,
}: BlockManagerProps) {
  const [drag, setDrag] = useState<{ index: number; id: string } | null>(null);
  const [dropHint, setDropHint] = useState<number | null>(null);

  const clearDrag = () => {
    setDrag(null);
    setDropHint(null);
  };
  const onRowDragOver = (index: number) => (e: DragEvent) => {
    if (!drag) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const after = e.clientY - rect.top > rect.height / 2;
    setDropHint(after ? index + 1 : index);
  };
  const onListDragOver = (e: DragEvent) => {
    if (!drag) return;
    e.preventDefault();
    setDropHint(blocks.length);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    if (drag && dropHint != null) onMove(drag.id, dropHint);
    clearDrag();
  };

  return (
    <div className="pcms-blockmgr">
      <h3 className="pcms-blockmgr__title">{t("block.manage")}</h3>
      <p className="pcms-blockhelp">{t("block.help.enabled")}</p>
      {blocks.length === 0 ? (
        <p className="pcms-empty">{t("block.empty")}</p>
      ) : (
        <ul className="pcms-blockmgr__list" onDragOver={onListDragOver} onDrop={onDrop}>
          {blocks.map((b, i) => {
            const isDragging = drag?.index === i;
            const dropBefore = dropHint === i;
            return (
              <li
                key={b.id}
                className={
                  `pcms-blockmgr__row${b.id === selectedBlockId ? " is-active" : ""}` +
                  `${isDragging ? " is-dragging" : ""}${dropBefore ? " is-drop-before" : ""}`
                }
                onDragOver={onRowDragOver(i)}
                onDrop={onDrop}
              >
                <span
                  className="pcms-columns-mgr__grip"
                  draggable
                  title={t("block.drag")}
                  onDragStart={(e) => {
                    setDrag({ index: i, id: b.id });
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", b.id);
                  }}
                  onDragEnd={clearDrag}
                >
                  ⠿
                </span>
                <button type="button" className="pcms-blockmgr__name" onClick={() => onSelect(b.id)}>
                  {schemaByType.get(b.type)?.label ?? b.type}
                </button>
                <div className="pcms-blockmgr__ops">
                  <button type="button" onClick={() => onOp(b.id, "up")} disabled={i === 0} title={t("block.up")}>
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => onOp(b.id, "down")}
                    disabled={i === blocks.length - 1}
                    title={t("block.down")}
                  >
                    ↓
                  </button>
                  <button type="button" onClick={() => onOp(b.id, "dup")} title={t("block.duplicate")}>
                    ⧉
                  </button>
                  <button
                    type="button"
                    className="pcms-blockmgr__del"
                    onClick={() => onOp(b.id, "del")}
                    title={t("block.delete")}
                  >
                    ×
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <button type="button" className="pcms-blockmgr__add" onClick={onAddClick}>
        ＋ {t("block.add")}
      </button>
    </div>
  );
}

interface EnableBlocksPromptProps {
  /** Make this section accept parts (edits its theme template). */
  onEnable: () => void;
}

/**
 * Shown under a section that has no `data-blocks` slot: explains the rule and
 * offers to make the section accept parts (which edits its theme template, so
 * it applies to every section of this type).
 */
export function EnableBlocksPrompt({ onEnable }: EnableBlocksPromptProps) {
  return (
    <div className="pcms-blockmgr">
      <h3 className="pcms-blockmgr__title">{t("block.manage")}</h3>
      <p className="pcms-blockhelp">{t("block.help.disabled")}</p>
      <button type="button" className="pcms-blockmgr__add" onClick={onEnable}>
        ＋ {t("block.enable")}
      </button>
    </div>
  );
}

interface BlockSettingsProps {
  block: BlockInstance;
  schema: SectionSchema;
  onFieldChange: (path: string, value: string) => void;
  onBack: () => void;
  /** Swap this block to a different part (opens the swap picker). */
  onSwap?: () => void;
  /**
   * Replaces the field editor for a layout block (whose template has no fields):
   * the columns manager is rendered here instead of SectionFields.
   */
  layout?: ReactNode;
}

/** Settings panel for one selected nested block, driven by its schema. */
export function BlockSettings({ block, schema, onFieldChange, onBack, onSwap, layout }: BlockSettingsProps) {
  return (
    <aside className="pcms-settings">
      <button type="button" className="pcms-settings__back" onClick={onBack}>
        ← {t("block.backToSection")}
      </button>
      <div className="pcms-settings__titlerow">
        <h2 className="pcms-col__title">
          {t("block.settings")}：{schema.label ?? schema.id}
        </h2>
        {onSwap && (
          <button type="button" className="pcms-swapbtn" onClick={onSwap} title={t("swap.block")}>
            ⇄ {t("swap.short")}
          </button>
        )}
      </div>
      {layout ?? (
        <SectionFields
          schema={schema}
          instance={block as SectionInstance}
          onFieldChange={onFieldChange}
          onRepeatChange={() => {}}
        />
      )}
    </aside>
  );
}
