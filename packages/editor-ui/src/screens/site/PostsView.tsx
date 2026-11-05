import { useState } from "react";
import { useSiteWorkspace } from "../../state/SiteWorkspace.js";
import {
  createContent,
  uniqueSlug,
  setContentStatusMany,
  removeContentMany,
  moveContent,
  moveContentTo,
  byOrderThenDate,
  type ItemRef,
} from "../../state/editorState.js";
import type { ContentItem } from "@pcms/shared";
import { NewContentModal } from "../../components/NewContentModal.js";
import { ContentEditorPanel } from "./ContentEditorPanel.js";
import { useDragReorder } from "../../state/useDragReorder.js";
import { useToast } from "../../state/ToastContext.js";
import { t } from "../../i18n.js";
import { isScheduled } from "@pcms/engine";
import { Icon } from "../../components/Icon.js";

/** Posts (and custom post types). Pages live in their own view. */
export function PostsView() {
  const { doc, commit, setDirty } = useSiteWorkspace();
  const toast = useToast();
  const [selected, setSelected] = useState<{ type: string; slug: string } | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | "published" | "draft">("all");
  const [checked, setChecked] = useState<Set<string>>(new Set());

  const postTypes = doc.contentTypes.filter((tp) => tp.name !== "page");
  const now = Date.now();
  const q = query.trim().toLowerCase();
  const filtering = q !== "" || status !== "all";
  const posts = doc.content.filter((i) => {
    if (i.type === "page") return false;
    const itemStatus = i.status ?? "published";
    if (status !== "all" && itemStatus !== status) return false;
    if (!q) return true;
    const title = String(i.fields.title ?? "").toLowerCase();
    return title.includes(q) || i.slug.toLowerCase().includes(q);
  });
  const matchCount = posts.length;

  const keyOf = (type: string, slug: string) => `${type}/${slug}`;
  const refsFromChecked = (): ItemRef[] =>
    [...checked].map((k) => {
      const i = k.indexOf("/");
      return { type: k.slice(0, i), slug: k.slice(i + 1) };
    });

  const toggle = (type: string, slug: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      const key = keyOf(type, slug);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const allShownKeys = posts.map((i) => keyOf(i.type, i.slug));
  const allChecked = allShownKeys.length > 0 && allShownKeys.every((k) => checked.has(k));
  const toggleAll = () => {
    setChecked(allChecked ? new Set() : new Set(allShownKeys));
  };

  const clearSelection = () => setChecked(new Set());

  const bulkStatus = (next: "published" | "draft") => {
    const refs = refsFromChecked();
    if (refs.length === 0) return;
    commit(setContentStatusMany(doc, refs, next));
    setDirty(true);
    const key = next === "published" ? "toast.bulkStatusPublished" : "toast.bulkStatusDraft";
    toast(t(key).replace("{count}", String(refs.length)));
    clearSelection();
  };

  const bulkDelete = () => {
    const refs = refsFromChecked();
    if (refs.length === 0) return;
    const msg = t("content.bulkDeleteConfirm").replace("{count}", String(refs.length));
    if (!window.confirm(msg)) return;
    if (selected && checked.has(keyOf(selected.type, selected.slug))) setSelected(null);
    commit(removeContentMany(doc, refs));
    setDirty(true);
    toast(t("toast.bulkDeleted").replace("{count}", String(refs.length)));
    clearSelection();
  };

  const move = (type: string, slug: string, dir: "up" | "down") => {
    commit(moveContent(doc, type, slug, dir));
    setDirty(true);
  };
  const reorder = (type: string, from: number, to: number) => {
    commit(moveContentTo(doc, type, from, to));
    setDirty(true);
  };

  const onCreate = (type: string, title: string, slug: string) => {
    const unique = uniqueSlug(doc, type, slug);
    commit(createContent(doc, type, title, unique));
    setDirty(true);
    setNewOpen(false);
    setSelected({ type, slug: unique });
  };

  return (
    <div className="pcms-contentpane">
      <div className="pcms-contentpane__list">
        <div className="pcms-listhead">
          <h1 className="pcms-page__title">{t("site.tab.posts")}</h1>
          <div className="pcms-listhead__actions">
            <button className="pcms-primary" onClick={() => setNewOpen(true)}>
              <Icon name="plus" size={14} /> {t("content.new")}
            </button>
          </div>
        </div>

        <div className="pcms-listsearch">
          <input
            type="search"
            className="pcms-listsearch__input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("content.search")}
          />
          <select
            className="pcms-listsearch__status"
            value={status}
            onChange={(e) => setStatus(e.target.value as "all" | "published" | "draft")}
            aria-label={t("content.status")}
          >
            <option value="all">{t("content.status.all")}</option>
            <option value="published">{t("content.status.published")}</option>
            <option value="draft">{t("content.status.draft")}</option>
          </select>
          {filtering && (
            <span className="pcms-listsearch__count">
              {t("content.matchCount").replace("{count}", String(matchCount))}
            </span>
          )}
        </div>

        {matchCount > 0 && (
          <label className="pcms-selectall">
            <input type="checkbox" checked={allChecked} onChange={toggleAll} />
            <span>{t("content.selectAll")}</span>
          </label>
        )}

        {checked.size > 0 && (
          <div className="pcms-bulkbar" role="toolbar">
            <span className="pcms-bulkbar__count">
              {t("content.selectedCount").replace("{count}", String(checked.size))}
            </span>
            <button onClick={() => bulkStatus("published")}>{t("content.bulkPublish")}</button>
            <button onClick={() => bulkStatus("draft")}>{t("content.bulkDraft")}</button>
            <button className="pcms-bulkbar__delete" onClick={bulkDelete}>
              {t("content.bulkDelete")}
            </button>
            <button className="pcms-bulkbar__clear" onClick={clearSelection}>
              {t("content.clearSelection")}
            </button>
          </div>
        )}

        {filtering && matchCount === 0 ? (
          <p className="pcms-empty">{t("content.noMatch")}</p>
        ) : null}

        {postTypes.map((tp) => {
          const items = posts.filter((i) => i.type === tp.name).sort(byOrderThenDate);
          // While filtering, hide type groups that have no match.
          if (filtering && items.length === 0) return null;
          // Manual reordering only in the full, unfiltered list.
          const canReorder = !filtering && items.length > 1;
          return (
            <PostTypeGroup
              key={tp.name}
              title={tp.label ?? tp.name}
              items={items}
              canReorder={canReorder}
              now={now}
              isChecked={(i) => checked.has(keyOf(i.type, i.slug))}
              isSelected={(i) => selected?.type === i.type && selected?.slug === i.slug}
              onToggle={toggle}
              onSelect={(i) => setSelected({ type: i.type, slug: i.slug })}
              onMove={move}
              onReorder={(from, to) => reorder(tp.name, from, to)}
            />
          );
        })}
      </div>

      <div className="pcms-contentpane__editor">
        {selected ? (
          <ContentEditorPanel
            type={selected.type}
            slug={selected.slug}
            onDeleted={() => setSelected(null)}
            onDuplicated={(type, slug) => setSelected({ type, slug })}
          />
        ) : (
          <aside className="pcms-settings">
            <p className="pcms-empty">{t("content.pickHint")}</p>
          </aside>
        )}
      </div>

      {newOpen && (
        <NewContentModal
          types={postTypes}
          onCreate={onCreate}
          onClose={() => setNewOpen(false)}
          resolveSlug={(type, slug) => uniqueSlug(doc, type, slug)}
        />
      )}
    </div>
  );
}

interface PostTypeGroupProps {
  title: string;
  items: ContentItem[];
  canReorder: boolean;
  now: number;
  isChecked: (i: ContentItem) => boolean;
  isSelected: (i: ContentItem) => boolean;
  onToggle: (type: string, slug: string) => void;
  onSelect: (i: ContentItem) => void;
  onMove: (type: string, slug: string, dir: "up" | "down") => void;
  onReorder: (from: number, to: number) => void;
}

/** One post type's item list, with arrow + drag-and-drop reordering. */
function PostTypeGroup({
  title,
  items,
  canReorder,
  now,
  isChecked,
  isSelected,
  onToggle,
  onSelect,
  onMove,
  onReorder,
}: PostTypeGroupProps) {
  const dnd = useDragReorder(onReorder);
  return (
    <div className="pcms-typegroup">
      <h2 className="pcms-typegroup__title">{title}</h2>
      {items.length === 0 ? (
        <p className="pcms-empty">{t("content.none")}</p>
      ) : (
        <ul className="pcms-itemlist">
          {items.map((i, idx) => (
            <li
              key={`${i.type}/${i.slug}`}
              className="pcms-itemlist__item"
              {...(canReorder ? dnd.zoneProps(idx) : {})}
            >
              {canReorder && (
                <span
                  className="pcms-draghandle"
                  aria-label={t("common.drag")}
                  title={t("common.drag")}
                  {...dnd.handleProps(idx)}
                >
                  <Icon name="grip" size={15} />
                </span>
              )}
              <input
                type="checkbox"
                className="pcms-itemlist__check"
                checked={isChecked(i)}
                onChange={() => onToggle(i.type, i.slug)}
                aria-label={String(i.fields.title ?? i.slug)}
              />
              <button
                className={`pcms-itemlist__row${isSelected(i) ? " is-selected" : ""}`}
                onClick={() => onSelect(i)}
              >
                <span className="pcms-itemlist__title">
                  {String(i.fields.title ?? i.slug)}
                  {i.status === "draft" && (
                    <span className="pcms-draftbadge">{t("content.status.draft")}</span>
                  )}
                  {i.status !== "draft" && isScheduled(i, now) && (
                    <span className="pcms-schedbadge">
                      {t("content.scheduled")}
                      {typeof i.fields.date === "string" ? `（${i.fields.date}）` : ""}
                    </span>
                  )}
                </span>
                <span className="pcms-itemlist__slug">/{i.slug}</span>
              </button>
              {canReorder && (
                <span className="pcms-itemlist__move">
                  <button
                    type="button"
                    disabled={idx === 0}
                    onClick={() => onMove(i.type, i.slug, "up")}
                    aria-label={t("content.moveUp")}
                    title={t("content.moveUp")}
                  >
                    <Icon name="chevron-up" size={15} />
                  </button>
                  <button
                    type="button"
                    disabled={idx === items.length - 1}
                    onClick={() => onMove(i.type, i.slug, "down")}
                    aria-label={t("content.moveDown")}
                    title={t("content.moveDown")}
                  >
                    <Icon name="chevron-down" size={15} />
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
