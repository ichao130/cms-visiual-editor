import { useState } from "react";
import type { MenuItem } from "@pcms/shared";
import { t } from "../i18n.js";

interface MenuManagerProps {
  menus: Record<string, MenuItem[]>;
  onCommit: (name: string, items: MenuItem[]) => void;
  onClose: () => void;
}

/** Edit navigation menus (label + URL, add / remove / reorder). */
export function MenuManager({ menus, onCommit, onClose }: MenuManagerProps) {
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

  return (
    <div className="pcms-modal" role="dialog" aria-modal="true" aria-label={t("menu.title")}>
      <div className="pcms-modal__backdrop" onClick={onClose} />
      <div className="pcms-modal__panel pcms-modal__panel--narrow">
        <header className="pcms-modal__head">
          <h2>{t("menu.title")}</h2>
          <div className="pcms-modal__spacer" />
          <button type="button" onClick={onClose} aria-label={t("media.close")}>
            ✕
          </button>
        </header>

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
          <div className="pcms-menuitem" key={i}>
            <input
              className="pcms-menuitem__label"
              value={it.label}
              onChange={(e) => update(i, { label: e.target.value })}
              placeholder={t("menu.label")}
            />
            <input
              className="pcms-menuitem__url"
              value={it.url}
              onChange={(e) => update(i, { url: e.target.value })}
              placeholder="/path/"
            />
            <div className="pcms-menuitem__actions">
              <button type="button" onClick={() => move(i, -1)} disabled={i === 0}>
                ↑
              </button>
              <button type="button" onClick={() => move(i, 1)} disabled={i === items.length - 1}>
                ↓
              </button>
              <button type="button" className="pcms-danger" onClick={() => remove(i)}>
                {t("repeat.remove")}
              </button>
            </div>
          </div>
        ))}
        <button type="button" className="pcms-types__addfield" onClick={add}>
          {t("menu.add")}
        </button>
      </div>
    </div>
  );
}
