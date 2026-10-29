import type {
  ContentItem,
  ContentTypeDef,
  FieldDef,
  FieldValue,
  TaxonomyDef,
} from "@pcms/shared";
import { ContentField } from "./ContentField.js";
import { TaxonomyInput } from "./TaxonomyInput.js";
import { AiSeoAssist } from "./AiSeoAssist.js";
import { t } from "../i18n.js";

interface ContentFormProps {
  item: ContentItem;
  def: ContentTypeDef | undefined;
  taxonomies: TaxonomyDef[];
  onChange: (key: string, value: string) => void;
  onTermsChange: (taxonomy: string, terms: string[]) => void;
  onStatusChange: (status: "draft" | "published") => void;
  onNoindexChange?: (noindex: boolean) => void;
  /** AI assist for the meta description (suggest + apply). */
  aiSeo?: { suggest: () => Promise<string>; apply: (text: string) => void };
  onDuplicate?: () => void;
  onDelete: () => void;
}

function toTerms(value: FieldValue | undefined): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (value == null || value === "") return [];
  return [String(value)];
}

/** Editing form for a content item, driven by its content-type definition. */
export function ContentForm({
  item,
  def,
  taxonomies,
  onChange,
  onTermsChange,
  onStatusChange,
  onNoindexChange,
  aiSeo,
  onDuplicate,
  onDelete,
}: ContentFormProps) {
  const fields = def?.fields ?? fallbackFields(item);

  function valueOf(name: string): FieldValue | undefined {
    return name === "body" ? item.body : item.fields[name];
  }

  return (
    <aside className="pcms-settings">
      <div className="pcms-settings__head">
        <h2 className="pcms-col__title">
          {t("content.title")}：{def?.label ?? item.type}
        </h2>
        <div className="pcms-settings__headactions">
          <select
            className="pcms-statusselect"
            value={item.status ?? "published"}
            onChange={(e) => onStatusChange(e.target.value as "draft" | "published")}
            aria-label={t("content.status")}
          >
            <option value="published">{t("content.status.published")}</option>
            <option value="draft">{t("content.status.draft")}</option>
          </select>
          {onDuplicate && (
            <button type="button" onClick={onDuplicate}>
              {t("content.duplicate")}
            </button>
          )}
          <button type="button" className="pcms-danger" onClick={onDelete}>
            {t("content.delete")}
          </button>
        </div>
      </div>

      {fields
        .filter((f) => isVisible(f, valueOf))
        .map((f) => (
          <ContentField
            key={f.name}
            field={f}
            value={valueOf(f.name)}
            onChange={(v) => onChange(f.name, v)}
          />
        ))}

      {taxonomies.length > 0 && (
        <div className="pcms-taxsection">
          <h3 className="pcms-types__fieldshead">{t("tax.title")}</h3>
          {taxonomies.map((tx) => (
            <TaxonomyInput
              key={tx.name}
              tax={tx}
              value={toTerms(item.fields[tx.name])}
              onChange={(terms) => onTermsChange(tx.name, terms)}
            />
          ))}
        </div>
      )}

      {(onNoindexChange || aiSeo) && (
        <div className="pcms-seosection">
          <h3 className="pcms-types__fieldshead">{t("content.seo")}</h3>
          {aiSeo && <AiSeoAssist suggest={aiSeo.suggest} onApply={aiSeo.apply} />}
          {onNoindexChange && (
            <>
              <label className="pcms-checkrow">
                <input
                  type="checkbox"
                  checked={item.noindex ?? false}
                  onChange={(e) => onNoindexChange(e.target.checked)}
                />
                <span>{t("content.noindex")}</span>
              </label>
              <p className="pcms-fieldhint">{t("content.noindex.hint")}</p>
            </>
          )}
        </div>
      )}
    </aside>
  );
}

function isVisible(
  field: FieldDef,
  valueOf: (name: string) => FieldValue | undefined,
): boolean {
  if (!field.showIf) return true;
  const other = valueOf(field.showIf.field);
  if (field.showIf.equals !== undefined) return other === field.showIf.equals;
  return other != null && other !== "";
}

/** Used when a content type has no definition: expose what the item carries. */
function fallbackFields(item: ContentItem): FieldDef[] {
  const defs: FieldDef[] = [
    { name: "title", label: "タイトル", type: "text", required: true },
  ];
  for (const key of Object.keys(item.fields)) {
    if (key === "title" || key === "url") continue;
    defs.push({ name: key, label: key, type: "text" });
  }
  defs.push({ name: "body", label: "本文", type: "richtext" });
  return defs;
}
