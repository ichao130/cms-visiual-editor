import { useSiteWorkspace } from "../../state/SiteWorkspace.js";
import { useToast } from "../../state/ToastContext.js";
import {
  duplicateContent,
  findItem,
  removeContent,
  setContentField,
  setContentNoindex,
  setContentStatus,
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
  onDuplicated?: (type: string, slug: string) => void;
}

/** Editing form for one content item, wired to the shared site workspace. */
export function ContentEditorPanel({ type, slug, onDeleted, onDuplicated }: Props) {
  const { api, doc, commit, setDirty } = useSiteWorkspace();
  const toast = useToast();
  const item = findItem(doc, type, slug);
  if (!item) return <p className="pcms-empty">{t("content.notFound")}</p>;

  const title = String(item.fields.title ?? slug);

  const onChange = (key: string, value: string) => {
    commit(setContentField(doc, type, slug, key, value), `content:${type}/${slug}:${key}`);
    setDirty(true);
  };
  const onTermsChange = (taxonomy: string, terms: string[]) => {
    commit(setContentTerms(doc, type, slug, taxonomy, terms), `terms:${type}/${slug}:${taxonomy}`);
    setDirty(true);
  };
  const onStatusChange = (status: "draft" | "published") => {
    commit(setContentStatus(doc, type, slug, status));
    setDirty(true);
  };
  const onNoindexChange = (noindex: boolean) => {
    commit(setContentNoindex(doc, type, slug, noindex));
    setDirty(true);
  };
  const onDelete = () => {
    if (!window.confirm(t("content.deleteConfirm"))) return;
    void api.deleteContent(type, slug).then(() => {
      commit(removeContent(doc, type, slug));
      setDirty(true);
      toast(t("toast.contentDeleted").replace("{name}", title));
      onDeleted();
    });
  };
  const onDuplicate = () => {
    const { state, slug: newSlug } = duplicateContent(doc, type, slug, t("content.copySuffix"));
    commit(state);
    setDirty(true);
    toast(t("toast.contentDuplicated").replace("{name}", title));
    onDuplicated?.(type, newSlug);
  };

  return (
    <ContentForm
      item={item}
      def={typeDef(doc, type)}
      taxonomies={taxonomiesFor(doc, type)}
      onChange={onChange}
      onTermsChange={onTermsChange}
      onStatusChange={onStatusChange}
      onNoindexChange={onNoindexChange}
      onDuplicate={onDuplicate}
      onDelete={onDelete}
    />
  );
}
