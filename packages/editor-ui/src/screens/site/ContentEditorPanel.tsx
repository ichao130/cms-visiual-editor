import { useState } from "react";
import { useSiteWorkspace } from "../../state/SiteWorkspace.js";
import { useMedia } from "../../media/MediaContext.js";
import { renderItemPreview } from "../../preview/render.js";
import { ContentPreviewModal } from "../../components/ContentPreviewModal.js";
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
  const { api, project, doc, commit, setDirty } = useSiteWorkspace();
  const { media } = useMedia();
  const toast = useToast();
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
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
  const aiSeo = {
    suggest: () => api.aiSeo(title, item.body).then((r) => r.description),
    apply: (text: string) => {
      commit(setContentField(doc, type, slug, "description", text));
      setDirty(true);
      toast(t("toast.aiApplied"));
    },
  };
  const aiRewrite = (text: string, instruction: string) =>
    api.aiRewrite(text, instruction);
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

  const onPreview = () => setPreviewHtml(renderItemPreview(project, doc, type, slug, media));

  return (
    <>
      <ContentForm
        item={item}
        def={typeDef(doc, type)}
        taxonomies={taxonomiesFor(doc, type)}
        onChange={onChange}
        onTermsChange={onTermsChange}
        onStatusChange={onStatusChange}
        onNoindexChange={onNoindexChange}
        aiSeo={aiSeo}
        aiRewrite={aiRewrite}
        onDuplicate={onDuplicate}
        onPreview={onPreview}
        onDelete={onDelete}
      />
      {previewHtml != null && (
        <ContentPreviewModal
          html={previewHtml}
          title={title}
          onClose={() => setPreviewHtml(null)}
        />
      )}
    </>
  );
}
