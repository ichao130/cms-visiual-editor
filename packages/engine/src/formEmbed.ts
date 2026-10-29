import type { FormDef, FormField } from "@pcms/shared";
import { escapeHtml } from "./markdown.js";

/**
 * Generate the HTML snippet an operator pastes into their static site to post a
 * form to the Cloud Functions receiver (CLAUDE.md: 静的サイトからの送信は Cloud
 * Functions で受け取る、PHP は使わない). The snippet is a plain `<form>` plus a
 * small inline script that serialises the fields to JSON `{ siteId, formId,
 * data }`, POSTs them, and swaps in the completion message. It contains no
 * secrets — only the public endpoint, the site id and the form id.
 */

/** Hidden field that must stay empty; a filled value marks a bot. */
export const HONEYPOT_FIELD = "_gotcha";

export interface FormEmbedOptions {
  /** The deployed submitForm endpoint URL. */
  endpoint: string;
  /** The site id the submission belongs to. */
  siteId: string;
}

export function buildFormEmbed(form: FormDef, opts: FormEmbedOptions): string {
  const fields = form.fields.map(fieldHtml).join("\n");
  const json = (value: string): string => JSON.stringify(value);
  const script = [
    "<script>",
    "(function(){",
    "  var f=document.currentScript.previousElementSibling;",
    "  var msg=f.querySelector('[data-pcms-msg]');",
    "  f.addEventListener('submit',function(e){",
    "    e.preventDefault();",
    "    var data={};new FormData(f).forEach(function(v,k){data[k]=v;});",
    `    fetch(${json(opts.endpoint)},{method:'POST',headers:{'Content-Type':'application/json'},`,
    `      body:JSON.stringify({siteId:${json(opts.siteId)},formId:${json(form.id)},data:data})})`,
    "      .then(function(r){return r.json();})",
    "      .then(function(j){msg.hidden=false;if(j.ok){f.reset();msg.textContent=" +
      json(form.completionMessage || "送信しました。") +
      ";}",
    "        else{msg.textContent=(j.errors&&j.errors.join(' '))||'送信に失敗しました。';}})",
    "      .catch(function(){msg.hidden=false;msg.textContent='送信に失敗しました。';});",
    "  });",
    "})();",
    "</script>",
  ].join("\n");

  return `<form class="pcms-form" novalidate>
  <div style="position:absolute;left:-9999px" aria-hidden="true">
    <label>この欄は入力しないでください<input type="text" name="${HONEYPOT_FIELD}" tabindex="-1" autocomplete="off"></label>
  </div>
${fields}
  <button type="submit">送信</button>
  <p class="pcms-form__msg" data-pcms-msg hidden></p>
</form>
${script}
`;
}

function fieldHtml(field: FormField): string {
  const name = escapeHtml(field.name);
  const label = escapeHtml(field.label);
  const req = field.required ? " required" : "";
  switch (field.type) {
    case "textarea":
      return `  <label class="pcms-form__row">${label}
    <textarea name="${name}"${req}></textarea>
  </label>`;
    case "select": {
      const options = (field.options ?? [])
        .map((o) => `      <option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`)
        .join("\n");
      return `  <label class="pcms-form__row">${label}
    <select name="${name}"${req}>
      <option value="">—</option>
${options}
    </select>
  </label>`;
    }
    case "checkbox":
      return `  <label class="pcms-form__row pcms-form__row--check">
    <input type="checkbox" name="${name}" value="1"${req}> ${label}
  </label>`;
    case "email":
    case "tel":
    case "text":
    default:
      return `  <label class="pcms-form__row">${label}
    <input type="${inputType(field.type)}" name="${name}"${req}>
  </label>`;
  }
}

function inputType(type: string): string {
  return type === "email" || type === "tel" ? type : "text";
}
