import type { BlockInstance, SectionInstance, SectionSchema } from "@pcms/shared";
import { SectionFields } from "./SectionFields.js";
import { t } from "../i18n.js";

type BlockOp = "up" | "down" | "del";

interface BlockManagerProps {
  blocks: BlockInstance[];
  schemaByType: Map<string, SectionSchema>;
  selectedBlockId: string | null;
  onSelect: (blockId: string) => void;
  onOp: (blockId: string, op: BlockOp) => void;
  /** Opens the block picker to add a block at the end of the list. */
  onAddClick: () => void;
}

/**
 * The nested-block list shown under a section's settings: select / reorder /
 * delete the blocks, and add a new one. Field editing of a block happens in
 * BlockSettings (opened by selecting a block).
 */
export function BlockManager({
  blocks,
  schemaByType,
  selectedBlockId,
  onSelect,
  onOp,
  onAddClick,
}: BlockManagerProps) {
  return (
    <div className="pcms-blockmgr">
      <h3 className="pcms-blockmgr__title">{t("block.manage")}</h3>
      <p className="pcms-blockhelp">{t("block.help.enabled")}</p>
      {blocks.length === 0 ? (
        <p className="pcms-empty">{t("block.empty")}</p>
      ) : (
        <ul className="pcms-blockmgr__list">
          {blocks.map((b, i) => (
            <li
              key={b.id}
              className={`pcms-blockmgr__row${b.id === selectedBlockId ? " is-active" : ""}`}
            >
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
          ))}
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
}

/** Settings panel for one selected nested block, driven by its schema. */
export function BlockSettings({ block, schema, onFieldChange, onBack }: BlockSettingsProps) {
  return (
    <aside className="pcms-settings">
      <button type="button" className="pcms-settings__back" onClick={onBack}>
        ← {t("block.backToSection")}
      </button>
      <h2 className="pcms-col__title">
        {t("block.settings")}：{schema.label ?? schema.id}
      </h2>
      <SectionFields
        schema={schema}
        instance={block as SectionInstance}
        onFieldChange={onFieldChange}
        onRepeatChange={() => {}}
      />
    </aside>
  );
}
