import { useState } from "react";
import type { ReactNode } from "react";
import type { MenuItem } from "@pcms/shared";
import type { LinkTarget } from "../state/linkTargets.js";
import { useDragReorder, moveItem } from "../state/useDragReorder.js";
import { t } from "../i18n.js";
import { Icon } from "./Icon.js";

interface MenuManagerProps {
  menus: Record<string, MenuItem[]>;
  onCommit: (name: string, items: MenuItem[]) => void;
  /** Existing pages/posts/archives, so URLs can be picked instead of typed. */
  targets?: LinkTarget[];
}

/**
 * Edit navigation menus: label + URL, add / remove / reorder, and one level of
 * sub-items (dropdowns). A sub-item renders as a nested `<ul>` in themes whose
 * nav loop element is an `<li>`.
 */
export function MenuManager({ menus, onCommit, targets = [] }: MenuManagerProps) {
  const names = Object.keys(menus).length ? Object.keys(menus) : ["menu"];
  const [selected, setSelected] = useState(names[0] as string);
  const items = menus[selected] ?? [];

  const update = (idx: number, patch: Partial<MenuItem>) =>
    onCommit(
      selected,
      items.map((it, i) => (i === idx ? { ...it, ...patch } : it)),
    );
  const add = () => onCommit(selected, [...items, { label: "新しい項目", url: "/" }]);
  const remove = (idx: number) => onCommit(selected, items.filter((_, i) => i !== idx));
  const move = (idx: number, dir: -1 | 1) => {
    const to = idx + dir;
    if (to < 0 || to >= items.length) return;
    const next = [...items];
    [next[idx], next[to]] = [next[to] as MenuItem, next[idx] as MenuItem];
    onCommit(selected, next);
  };
  const dnd = useDragReorder((from, to) => onCommit(selected, moveItem(items, from, to)));

  // Child-item (sub-menu) operations for the parent at `p`.
  const childrenOf = (p: number): MenuItem[] => items[p]?.children ?? [];
  const setChildren = (p: number, children: MenuItem[]) =>
    update(p, { children: children.length > 0 ? children : undefined });
  const addChild = (p: number) => setChildren(p, [...childrenOf(p), { label: "新しい項目", url: "/" }]);
  const updateChild = (p: number, c: number, patch: Partial<MenuItem>) =>
    setChildren(p, childrenOf(p).map((ch, i) => (i === c ? { ...ch, ...patch } : ch)));
  const removeChild = (p: number, c: number) =>
    setChildren(p, childrenOf(p).filter((_, i) => i !== c));
  const moveChild = (p: number, c: number, dir: -1 | 1) => {
    const arr = [...childrenOf(p)];
    const to = c + dir;
    if (to < 0 || to >= arr.length) return;
    [arr[c], arr[to]] = [arr[to] as MenuItem, arr[c] as MenuItem];
    setChildren(p, arr);
  };

  return (
    <div className="pcms-structpage pcms-structpage--narrow">
      <h1 className="pcms-page__title">{t("menu.title")}</h1>
      <p className="pcms-structpage__hint">{t("menu.hint")}</p>

      {names.length > 1 && (
        <label className="pcms-field">
          <span className="pcms-field__label">{t("menu.pick")}</span>
          <select value={selected} onChange={(e) => setSelected(e.target.value)}>
            {names.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      )}

      {items.map((it, i) => (
        <div key={i}>
          <MenuRow
            item={it}
            targets={targets}
            rootProps={dnd.zoneProps(i)}
            handle={
              <span
                className="pcms-draghandle"
                aria-label={t("common.drag")}
                title={t("common.drag")}
                {...dnd.handleProps(i)}
              >
                <Icon name="grip" size={15} />
              </span>
            }
            onChange={(patch) => update(i, patch)}
            onUp={() => move(i, -1)}
            onDown={() => move(i, 1)}
            canUp={i > 0}
            canDown={i < items.length - 1}
            onRemove={() => remove(i)}
          />
          <div className="pcms-submenu-edit">
            {childrenOf(i).map((ch, ci) => (
              <MenuRow
                key={ci}
                indent
                item={ch}
                targets={targets}
                onChange={(patch) => updateChild(i, ci, patch)}
                onUp={() => moveChild(i, ci, -1)}
                onDown={() => moveChild(i, ci, 1)}
                canUp={ci > 0}
                canDown={ci < childrenOf(i).length - 1}
                onRemove={() => removeChild(i, ci)}
              />
            ))}
            <button type="button" className="pcms-submenu-edit__add" onClick={() => addChild(i)}>
              <Icon name="plus" size={13} /> {t("menu.addChild")}
            </button>
          </div>
        </div>
      ))}
      <button type="button" className="pcms-types__addfield" onClick={add}>
        <Icon name="plus" size={14} /> {t("menu.add")}
      </button>
    </div>
  );
}

interface MenuRowProps {
  item: MenuItem;
  targets: LinkTarget[];
  onChange: (patch: Partial<MenuItem>) => void;
  onUp: () => void;
  onDown: () => void;
  canUp: boolean;
  canDown: boolean;
  onRemove: () => void;
  /** Drag handle (top-level rows only). */
  handle?: ReactNode;
  /** Drag-zone props spread onto the row (top-level rows only). */
  rootProps?: Record<string, unknown>;
  /** A child (sub-menu) row: rendered indented. */
  indent?: boolean;
}

/** One menu row (label + URL + target picker + reorder/delete), reused for
 * top-level items and sub-items. */
function MenuRow({
  item,
  targets,
  onChange,
  onUp,
  onDown,
  canUp,
  canDown,
  onRemove,
  handle,
  rootProps,
  indent,
}: MenuRowProps) {
  return (
    <div className={`pcms-menuitem${indent ? " pcms-menuitem--child" : ""}`} {...rootProps}>
      {handle}
      <input
        className="pcms-menuitem__label"
        value={item.label}
        onChange={(e) => onChange({ label: e.target.value })}
        placeholder={t("menu.label")}
      />
      <input
        className="pcms-menuitem__url"
        value={item.url}
        onChange={(e) => onChange({ url: e.target.value })}
        placeholder="/path/"
      />
      {targets.length > 0 && (
        <select
          className="pcms-menuitem__pick"
          value=""
          aria-label={t("menu.pickTarget")}
          onChange={(e) => {
            const target = targets.find((tg) => tg.url === e.target.value);
            if (!target) return;
            const patch: Partial<MenuItem> =
              item.label.trim() === "" || item.label === "新しい項目"
                ? { url: target.url, label: target.label }
                : { url: target.url };
            onChange(patch);
          }}
        >
          <option value="">{t("menu.pickTarget")}</option>
          {targets.map((tg) => (
            <option key={tg.url} value={tg.url}>
              {tg.label}
            </option>
          ))}
        </select>
      )}
      <div className="pcms-menuitem__actions">
        <button type="button" onClick={onUp} disabled={!canUp}>
          <Icon name="chevron-up" size={15} />
        </button>
        <button type="button" onClick={onDown} disabled={!canDown}>
          <Icon name="chevron-down" size={15} />
        </button>
        <button
          type="button"
          className="pcms-delbtn"
          onClick={onRemove}
          title={t("repeat.remove")}
          aria-label={t("repeat.remove")}
        >
          <Icon name="trash" size={15} />
        </button>
      </div>
    </div>
  );
}
