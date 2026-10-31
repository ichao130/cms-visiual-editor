import { contentUrl } from "@pcms/engine";
import type { EditorState } from "./editorState.js";
import { t } from "../i18n.js";

/** A page/post/archive the operator can link to, offered in link pickers. */
export interface LinkTarget {
  label: string;
  url: string;
}

/**
 * The site's linkable destinations — home, settings pages, type archives and
 * every published content item — for menu and redirect pickers. Drafts and
 * scheduled (future-dated) posts are left out so a link never points at a page
 * the published site will not have.
 */
export function buildLinkTargets(doc: EditorState): LinkTarget[] {
  const typeLabel = (type: string) =>
    doc.contentTypes.find((ct) => ct.name === type)?.label ?? type;
  const list: LinkTarget[] = [{ label: t("menu.home"), url: "/" }];
  const now = Date.now();
  for (const id of Object.keys(doc.settings.pages)) {
    if (id === "index" || id === "home") continue;
    list.push({ label: id, url: `/${id}/` });
  }
  for (const type of new Set(doc.content.map((i) => i.type))) {
    list.push({ label: `${typeLabel(type)}一覧`, url: `/${type}/` });
  }
  for (const item of doc.content) {
    if (item.status === "draft") continue;
    const date = item.fields.date;
    if (
      typeof date === "string" &&
      date.trim() !== "" &&
      Date.parse(date.replace(/\//g, "-")) > now
    ) {
      continue;
    }
    list.push({
      label: `${typeLabel(item.type)}: ${String(item.fields.title ?? item.slug)}`,
      url: contentUrl(item, doc.site),
    });
  }
  return list;
}
