import type { FieldValue, PageSettings, SectionSchema } from "@pcms/shared";
import { FieldInput } from "./FieldInput.js";
import { RepeatEditor } from "./RepeatEditor.js";
import { t } from "../i18n.js";

type Row = Record<string, FieldValue>;

interface SettingsPanelProps {
  section: SectionSchema | null;
  page: PageSettings;
  onFieldChange: (path: string, value: string) => void;
  onRepeatChange: (sectionId: string, name: string, rows: Row[]) => void;
}

export function SettingsPanel({
  section,
  page,
  onFieldChange,
  onRepeatChange,
}: SettingsPanelProps) {
  if (!section) {
    return (
      <aside className="pcms-settings">
        <h2 className="pcms-col__title">{t("settings.title")}</h2>
        <p className="pcms-empty">{t("settings.empty")}</p>
      </aside>
    );
  }

  const fields = page.fields ?? {};
  const sectionState = (page.sections ?? []).find((s) => s.id === section.id);
  const hidden = sectionState?.hidden === true;

  return (
    <aside className="pcms-settings">
      <h2 className="pcms-col__title">
        {t("settings.title")}：{section.label ?? section.id}
      </h2>
      {hidden && <p className="pcms-note">{t("settings.hidden")}</p>}

      {section.fields.map((f) => (
        <FieldInput
          key={f.path}
          id={`field-${f.path}`}
          label={f.label ?? f.path}
          type={f.type}
          value={fields[f.path]}
          onChange={(v) => onFieldChange(f.path, v)}
        />
      ))}

      {section.repeats.map((r) => (
        <RepeatEditor
          key={r.name}
          repeat={r}
          rows={(sectionState?.repeats?.[r.name] as Row[] | undefined) ?? []}
          onChange={(rows) => onRepeatChange(section.id, r.name, rows)}
        />
      ))}
    </aside>
  );
}
