import type { FieldValue, RepeatSchema } from "@pcms/shared";
import { FieldInput } from "./FieldInput.js";
import { t } from "../i18n.js";

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
  const remove = (index: number) => onChange(rows.filter((_, i) => i !== index));

  return (
    <div className="pcms-repeat">
      <h3 className="pcms-repeat__title">{repeat.name}</h3>
      {rows.map((row, i) => (
        <fieldset className="pcms-repeat__row" key={i}>
          <legend>
            {t("repeat.item")} {i + 1}
          </legend>
          {repeat.fields.map((f) => (
            <FieldInput
              key={f.path}
              id={`repeat-${repeat.name}-${i}-${f.path}`}
              label={f.label ?? f.path}
              type={f.type}
              value={row[f.path]}
              onChange={(v) => update(i, f.path, v)}
            />
          ))}
          <button
            type="button"
            className="pcms-repeat__remove"
            onClick={() => remove(i)}
          >
            {t("repeat.remove")}
          </button>
        </fieldset>
      ))}
      <button type="button" className="pcms-repeat__add" onClick={add}>
        {t("repeat.add")}
      </button>
    </div>
  );
}
