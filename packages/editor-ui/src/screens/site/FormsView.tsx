import { useEffect, useMemo, useState } from "react";
import type { FormDef, FormField, FormFieldType, FormSubmission } from "@pcms/shared";
import type { PcmsApi } from "../../api/types.js";
import { t, type MessageKey } from "../../i18n.js";

interface Props {
  api: PcmsApi;
}

const FIELD_TYPES: { value: FormFieldType; label: MessageKey }[] = [
  { value: "text", label: "forms.type.text" },
  { value: "email", label: "forms.type.email" },
  { value: "tel", label: "forms.type.tel" },
  { value: "textarea", label: "forms.type.textarea" },
  { value: "select", label: "forms.type.select" },
  { value: "checkbox", label: "forms.type.checkbox" },
];

/** Contact-form builder + received submissions (受信一覧) with CSV export. */
export function FormsView({ api }: Props) {
  const [forms, setForms] = useState<FormDef[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [tab, setTab] = useState<"build" | "inbox">("build");

  useEffect(() => {
    let active = true;
    void api.listForms().then((list) => {
      if (!active) return;
      setForms(list);
      setSelectedId(list[0]?.id ?? null);
    });
    return () => {
      active = false;
    };
  }, [api]);

  const selected = forms.find((f) => f.id === selectedId) ?? null;

  const update = (next: FormDef) => {
    setForms((fs) => fs.map((f) => (f.id === next.id ? next : f)));
    setDirty(true);
  };

  const addForm = () => {
    const id = `form-${Date.now().toString(36)}`;
    const form: FormDef = {
      id,
      name: t("forms.newName"),
      fields: [{ name: "name", label: "お名前", type: "text", required: true }],
      notifyEmails: [],
      autoReply: false,
      completionMessage: t("forms.defaultComplete"),
    };
    setForms((fs) => [...fs, form]);
    setSelectedId(id);
    setDirty(true);
  };

  const deleteForm = (id: string) => {
    setForms((fs) => fs.filter((f) => f.id !== id));
    setSelectedId((cur) => (cur === id ? null : cur));
    setDirty(true);
  };

  const save = () => {
    void api.saveForms(forms).then(() => setDirty(false));
  };

  return (
    <div className="pcms-contentpane">
      <div className="pcms-contentpane__list">
        <div className="pcms-listhead">
          <h1 className="pcms-page__title">{t("site.tab.forms")}</h1>
          <div className="pcms-listhead__actions">
            <button className="pcms-primary" onClick={addForm}>
              ＋ {t("forms.new")}
            </button>
            <button onClick={save} disabled={!dirty}>
              {dirty ? t("common.save") : t("common.saved")}
            </button>
          </div>
        </div>
        <ul className="pcms-itemlist">
          {forms.map((f) => (
            <li key={f.id}>
              <button
                className={`pcms-itemlist__row${selectedId === f.id ? " is-selected" : ""}`}
                onClick={() => {
                  setSelectedId(f.id);
                  setTab("build");
                }}
              >
                <span className="pcms-itemlist__title">{f.name}</span>
                <span className="pcms-itemlist__slug">{f.fields.length}項目</span>
              </button>
            </li>
          ))}
          {forms.length === 0 && <p className="pcms-empty">{t("forms.none")}</p>}
        </ul>
      </div>

      <div className="pcms-contentpane__editor">
        {selected ? (
          <div className="pcms-formedit">
            <div className="pcms-tabbar__tabs pcms-formedit__tabs">
              <button
                className={`pcms-tabbar__tab${tab === "build" ? " is-active" : ""}`}
                onClick={() => setTab("build")}
              >
                {t("forms.build")}
              </button>
              <button
                className={`pcms-tabbar__tab${tab === "inbox" ? " is-active" : ""}`}
                onClick={() => setTab("inbox")}
              >
                {t("forms.inbox")}
              </button>
            </div>
            {tab === "build" ? (
              <FormBuilder form={selected} onChange={update} onDelete={() => deleteForm(selected.id)} />
            ) : (
              <Inbox api={api} form={selected} />
            )}
          </div>
        ) : (
          <aside className="pcms-settings">
            <p className="pcms-empty">{t("forms.pickHint")}</p>
          </aside>
        )}
      </div>
    </div>
  );
}

function FormBuilder({
  form,
  onChange,
  onDelete,
}: {
  form: FormDef;
  onChange: (f: FormDef) => void;
  onDelete: () => void;
}) {
  const setField = (i: number, patch: Partial<FormField>) =>
    onChange({ ...form, fields: form.fields.map((f, n) => (n === i ? { ...f, ...patch } : f)) });

  const addField = () =>
    onChange({
      ...form,
      fields: [
        ...form.fields,
        { name: `field${form.fields.length + 1}`, label: t("forms.newField"), type: "text" },
      ],
    });

  const removeField = (i: number) =>
    onChange({ ...form, fields: form.fields.filter((_, n) => n !== i) });

  const moveField = (i: number, dir: -1 | 1) => {
    const to = i + dir;
    if (to < 0 || to >= form.fields.length) return;
    const fields = [...form.fields];
    [fields[i], fields[to]] = [fields[to] as FormField, fields[i] as FormField];
    onChange({ ...form, fields });
  };

  return (
    <div className="pcms-formbuild">
      <label className="pcms-field">
        <span className="pcms-field__label">{t("forms.name")}</span>
        <input value={form.name} onChange={(e) => onChange({ ...form, name: e.target.value })} />
      </label>

      <h2 className="pcms-col__title">{t("forms.fields")}</h2>
      <div className="pcms-formfields">
        {form.fields.map((f, i) => (
          <div key={i} className="pcms-formfield">
            <div className="pcms-formfield__row">
              <input
                className="pcms-formfield__label"
                value={f.label}
                placeholder={t("forms.fieldLabel")}
                onChange={(e) => setField(i, { label: e.target.value })}
              />
              <select value={f.type} onChange={(e) => setField(i, { type: e.target.value as FormFieldType })}>
                {FIELD_TYPES.map((ft) => (
                  <option key={ft.value} value={ft.value}>
                    {t(ft.label)}
                  </option>
                ))}
              </select>
              <label className="pcms-formfield__req">
                <input
                  type="checkbox"
                  checked={f.required ?? false}
                  onChange={(e) => setField(i, { required: e.target.checked })}
                />
                {t("forms.required")}
              </label>
              <button onClick={() => moveField(i, -1)} title={t("sections.up")}>↑</button>
              <button onClick={() => moveField(i, 1)} title={t("sections.down")}>↓</button>
              <button className="pcms-formfield__del" onClick={() => removeField(i)}>{t("forms.removeField")}</button>
            </div>
            {f.type === "select" && (
              <input
                className="pcms-formfield__options"
                value={(f.options ?? []).join(", ")}
                placeholder={t("forms.options")}
                onChange={(e) =>
                  setField(i, {
                    options: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                  })
                }
              />
            )}
          </div>
        ))}
        <button className="pcms-addsection__btn" onClick={addField}>＋ {t("forms.addField")}</button>
      </div>

      <h2 className="pcms-col__title">{t("forms.settings")}</h2>
      <label className="pcms-field">
        <span className="pcms-field__label">{t("forms.notify")}</span>
        <input
          value={form.notifyEmails.join(", ")}
          placeholder={t("forms.notifyHint")}
          onChange={(e) =>
            onChange({
              ...form,
              notifyEmails: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
            })
          }
        />
      </label>
      <label className="pcms-formfield__req">
        <input
          type="checkbox"
          checked={form.autoReply}
          onChange={(e) => onChange({ ...form, autoReply: e.target.checked })}
        />
        {t("forms.autoReply")}
      </label>
      <label className="pcms-field">
        <span className="pcms-field__label">{t("forms.complete")}</span>
        <textarea
          rows={2}
          value={form.completionMessage}
          onChange={(e) => onChange({ ...form, completionMessage: e.target.value })}
        />
      </label>

      <button className="pcms-danger pcms-formbuild__delete" onClick={onDelete}>
        {t("forms.delete")}
      </button>
    </div>
  );
}

function Inbox({ api, form }: { api: PcmsApi; form: FormDef }) {
  const [rows, setRows] = useState<FormSubmission[]>([]);

  useEffect(() => {
    let active = true;
    void api.listSubmissions(form.id).then((s) => active && setRows(s));
    return () => {
      active = false;
    };
  }, [api, form.id]);

  const csv = useMemo(() => buildCsv(form, rows), [form, rows]);

  const exportCsv = () => {
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${form.id}-submissions.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="pcms-inbox">
      <div className="pcms-listhead">
        <span className="pcms-inbox__count">{t("forms.received")}: {rows.length}</span>
        <button onClick={exportCsv} disabled={rows.length === 0}>
          {t("forms.csv")}
        </button>
      </div>
      {rows.length === 0 ? (
        <p className="pcms-empty">{t("forms.noSubmissions")}</p>
      ) : (
        <div className="pcms-inbox__scroll">
          <table className="pcms-table">
            <thead>
              <tr>
                {form.fields.map((f) => (
                  <th key={f.name}>{f.label}</th>
                ))}
                <th>{t("forms.receivedAt")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  {form.fields.map((f) => (
                    <td key={f.name}>{r.values[f.name] ?? ""}</td>
                  ))}
                  <td>{formatDate(r.receivedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function buildCsv(form: FormDef, rows: FormSubmission[]): string {
  const headers = [...form.fields.map((f) => f.label), "受信日時"];
  const lines = [headers.map(csvCell).join(",")];
  for (const r of rows) {
    const cells = [...form.fields.map((f) => r.values[f.name] ?? ""), r.receivedAt];
    lines.push(cells.map(csvCell).join(","));
  }
  return lines.join("\r\n");
}

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
