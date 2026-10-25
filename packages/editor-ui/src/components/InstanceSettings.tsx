import type { FieldValue, SectionInstance, SectionSchema, SectionStyle } from "@pcms/shared";
import { SectionFields } from "./SectionFields.js";
import { t } from "../i18n.js";

type Row = Record<string, FieldValue>;

interface InstanceSettingsProps {
  schema: SectionSchema | null;
  instance: SectionInstance;
  onFieldChange: (path: string, value: string) => void;
  onRepeatChange: (name: string, rows: Row[]) => void;
  onStyleChange: (patch: Partial<SectionStyle>) => void;
}

/** Settings panel for a selected section instance, driven by its schema. */
export function InstanceSettings({
  schema,
  instance,
  onFieldChange,
  onRepeatChange,
  onStyleChange,
}: InstanceSettingsProps) {
  if (!schema) {
    return (
      <aside className="pcms-settings">
        <h2 className="pcms-col__title">{t("settings.title")}</h2>
        <p className="pcms-empty">{t("settings.empty")}</p>
      </aside>
    );
  }

  return (
    <aside className="pcms-settings">
      <h2 className="pcms-col__title">
        {t("settings.title")}：{schema.label ?? schema.id}
      </h2>
      <SectionFields
        schema={schema}
        instance={instance}
        onFieldChange={onFieldChange}
        onRepeatChange={onRepeatChange}
        onStyleChange={onStyleChange}
      />
    </aside>
  );
}
