/**
 * The editor runtime injected into the preview iframe. It is the only script
 * that runs there — theme scripts are stripped and the iframe is
 * sandbox="allow-scripts" (no same-origin), so this cannot reach the parent
 * except via postMessage.
 *
 * It maps hovers/clicks on `data-pcms-section` / `data-pcms-field` elements to
 * the parent editor, and accepts a selection from the parent to highlight.
 * Section ids are controlled slugs, so attribute selectors need no escaping.
 */
export const EDITOR_OVERLAY_CSS = `
[data-pcms-hover]{outline:2px solid #2f6feb!important;outline-offset:-2px!important;cursor:pointer;}
[data-pcms-selected]{outline:2px solid #1a7f37!important;outline-offset:-2px!important;}
`;

export const EDITOR_RUNTIME = `
(function(){
  var SEL='[data-pcms-section],[data-pcms-field]';
  var hovered=null, selected=null;
  function closestEditable(t){ return (t && t.closest) ? t.closest(SEL) : null; }
  function setHover(el){
    if(hovered===el) return;
    if(hovered) hovered.removeAttribute('data-pcms-hover');
    hovered=el;
    if(hovered) hovered.setAttribute('data-pcms-hover','');
  }
  function setSelected(el){
    if(selected) selected.removeAttribute('data-pcms-selected');
    selected=el;
    if(selected) selected.setAttribute('data-pcms-selected','');
  }
  document.addEventListener('mousemove', function(e){ setHover(closestEditable(e.target)); }, true);
  document.addEventListener('mouseleave', function(){ setHover(null); }, true);
  document.addEventListener('click', function(e){
    var a = e.target.closest ? e.target.closest('a') : null;
    if(a) e.preventDefault();
    var el = closestEditable(e.target);
    if(!el) return;
    e.preventDefault(); e.stopPropagation();
    var sectionEl = el.closest('[data-pcms-section]');
    var fieldEl = e.target.closest ? e.target.closest('[data-pcms-field]') : null;
    setSelected(sectionEl || el);
    parent.postMessage({
      source:'pcms-preview', type:'select',
      section: sectionEl ? sectionEl.getAttribute('data-pcms-section') : null,
      field: fieldEl ? fieldEl.getAttribute('data-pcms-field') : null
    }, '*');
  }, true);
  window.addEventListener('message', function(e){
    var d = e.data || {};
    if(d.source!=='pcms-editor' || d.type!=='select') return;
    var el = d.section ? document.querySelector('[data-pcms-section="'+d.section+'"]') : null;
    setSelected(el);
    if(el && el.scrollIntoView) el.scrollIntoView({block:'nearest',behavior:'smooth'});
  });
})();
`;
