import type { FieldValue, SectionInstance, SectionSchema } from "@pcms/shared";
import { FieldInput } from "./FieldInput.js";
import { RepeatEditor } from "./RepeatEditor.js";
import { t } from "../i18n.js";

type Row = Record<string, FieldValue>;

interface InstanceSettingsProps {
  schema: SectionSchema | null;
  instance: SectionInstance;
  onFieldChange: (path: string, value: string) => void;
  onRepeatChange: (name: string, rows: Row[]) => void;
}

/** Settings panel for a selected section instance, driven by its schema. */
export function InstanceSettings({
  schema,
  instance,
  onFieldChange,
  onRepeatChange,
}: InstanceSettingsProps) {
  if (!schema) {
    return (
      <aside className="pcms-settings">
        <h2 className="pcms-col__title">{t("settings.title")}</h2>
        <p className="pcms-empty">{t("settings.empty")}</p>
      </aside>
    );
  }

  const fields = instance.fields ?? {};

  return (
    <aside className="pcms-settings">
      <h2 className="pcms-col__title">
        {t("settings.title")}：{schema.label ?? schema.id}
      </h2>

      {schema.fields.map((f) => (
        <FieldInput
          key={f.path}
          id={`inst-${instance.id}-${f.path}`}
          label={f.label ?? f.path}
          type={f.type}
          value={fields[f.path]}
          onChange={(v) => onFieldChange(f.path, v)}
        />
      ))}

      {schema.repeats.map((r) => (
        <RepeatEditor
          key={r.name}
          repeat={r}
          rows={(instance.repeats?.[r.name] as Row[] | undefined) ?? []}
          onChange={(rows) => onRepeatChange(r.name, rows)}
        />
      ))}
    </aside>
  );
}
