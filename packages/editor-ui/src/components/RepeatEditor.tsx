import type { FieldValue, RepeatSchema } from "@pcms/shared";
import { FieldInput } from "./FieldInput.js";
import { useDragReorder, moveItem } from "../state/useDragReorder.js";
import { t } from "../i18n.js";
import { Icon } from "./Icon.js";

type Row = Record<string, FieldValue>;

interface RepeatEditorProps {
  repeat: RepeatSchema;
  rows: Row[];
  onChange: (rows: Row[]) => void;
}

/** Operator-managed repeat (FAQ, menu items, slides, …). */
export function RepeatEditor({ repeat, rows, onChange }: RepeatEditorProps) {
  const update = (index: number, path: string, value: string) => {
    const next = rows.map((r, i) => (i === index ? { ...r, [path]: value } : r));
    onChange(next);
  };
  const add = () => onChange([...rows, {}]);
  const duplicate = (index: number) => {
    const src = rows[index];
    if (!src) return;
    const next = [...rows];
    next.splice(index + 1, 0, { ...src });
    onChange(next);
  };
  const remove = (index: number) => onChange(rows.filter((_, i) => i !== index));
  const move = (index: number, dir: -1 | 1) => {
    const to = index + dir;
    if (to < 0 || to >= rows.length) return;
    onChange(moveItem(rows, index, to));
  };
  const dnd = useDragReorder((from, to) => onChange(moveItem(rows, from, to)));

  return (
    <div className="pcms-repeat">
      <h3 className="pcms-repeat__title">{repeat.name}</h3>
      {rows.map((row, i) => (
        <fieldset className="pcms-repeat__row" key={i} {...dnd.zoneProps(i)}>
          <legend>
            <span
              className="pcms-draghandle"
              aria-label={t("common.drag")}
              title={t("common.drag")}
              {...dnd.handleProps(i)}
            >
              <Icon name="grip" size={15} />
            </span>
            {t("repeat.item")} {i + 1}
          </legend>
          {repeat.fields.map((f) => (
            <FieldInput
              key={f.path}
              id={`repeat-${repeat.name}-${i}-${f.path}`}
              label={f.label ?? f.path}
              type={f.type}
              options={f.options}
              value={row[f.path]}
              onChange={(v) => update(i, f.path, v)}
            />
          ))}
          <div className="pcms-repeat__actions">
            <button type="button" onClick={() => move(i, -1)} disabled={i === 0} title={t("sections.up")}>
              <Icon name="chevron-up" size={15} />
            </button>
            <button
              type="button"
              onClick={() => move(i, 1)}
              disabled={i === rows.length - 1}
              title={t("sections.down")}
            >
              <Icon name="chevron-down" size={15} />
            </button>
            <button
              type="button"
              onClick={() => duplicate(i)}
              title={t("repeat.duplicate")}
              aria-label={t("repeat.duplicate")}
            >
              <Icon name="copy" size={15} />
            </button>
            <button
              type="button"
              className="pcms-delbtn"
              onClick={() => remove(i)}
              title={t("repeat.remove")}
              aria-label={t("repeat.remove")}
            >
              <Icon name="trash" size={15} />
            </button>
          </div>
        </fieldset>
      ))}
      <button type="button" className="pcms-repeat__add" onClick={add}>
        {t("repeat.add")}
      </button>
    </div>
  );
}
