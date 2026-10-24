import { useSiteWorkspace } from "../../state/SiteWorkspace.js";
import {
  findItem,
  removeContent,
  setContentField,
  setContentTerms,
  taxonomiesFor,
  typeDef,
} from "../../state/editorState.js";
import { ContentForm } from "../../components/ContentForm.js";
import { t } from "../../i18n.js";

interface Props {
  type: string;
  slug: string;
  onDeleted: () => void;
}

/** Editing form for one content item, wired to the shared site workspace. */
export function ContentEditorPanel({ type, slug, onDeleted }: Props) {
  const { api, doc, commit, setDirty } = useSiteWorkspace();
  const item = findItem(doc, type, slug);
  if (!item) return <p className="pcms-empty">{t("content.notFound")}</p>;

  const onChange = (key: string, value: string) => {
    commit(setContentField(doc, type, slug, key, value), `content:${type}/${slug}:${key}`);
    setDirty(true);
  };
  const onTermsChange = (taxonomy: string, terms: string[]) => {
    commit(setContentTerms(doc, type, slug, taxonomy, terms), `terms:${type}/${slug}:${taxonomy}`);
    setDirty(true);
  };
  const onDelete = () => {
    if (!window.confirm(t("content.deleteConfirm"))) return;
    void api.deleteContent(type, slug).then(() => {
      commit(removeContent(doc, type, slug));
      setDirty(true);
      onDeleted();
    });
  };

  return (
    <ContentForm
      item={item}
      def={typeDef(doc, type)}
      taxonomies={taxonomiesFor(doc, type)}
      onChange={onChange}
      onTermsChange={onTermsChange}
      onDelete={onDelete}
    />
  );
}
