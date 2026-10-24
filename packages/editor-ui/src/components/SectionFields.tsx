import type { FieldValue, SectionInstance, SectionSchema } from "@pcms/shared";
import { FieldInput } from "./FieldInput.js";
import { RepeatEditor } from "./RepeatEditor.js";

type Row = Record<string, FieldValue>;

interface SectionFieldsProps {
  schema: SectionSchema;
  instance: SectionInstance;
  onFieldChange: (path: string, value: string) => void;
  onRepeatChange: (name: string, rows: Row[]) => void;
}

/**
 * The schema-driven fields + repeats for one section instance. Shared by the
 * right-hand settings panel and the inline (on-preview) editor so both edit the
 * same state and stay in sync.
 */
export function SectionFields({
  schema,
  instance,
  onFieldChange,
  onRepeatChange,
}: SectionFieldsProps) {
  const fields = instance.fields ?? {};
  return (
    <>
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
    </>
  );
}
