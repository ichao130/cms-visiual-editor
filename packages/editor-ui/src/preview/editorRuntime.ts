/**
 * The editor runtime injected into the preview iframe. It is the only script
 * that runs there — theme scripts are stripped and the iframe is
 * sandbox="allow-scripts" (no same-origin), so it talks to the editor only via
 * postMessage.
 *
 * Responsibilities: hover/click select, per-section tools (up/down/delete), "+"
 * insert markers, drag-to-reorder, and inline editing (double-click a text /
 * richtext field → contenteditable → confirm posts the new value).
 */
export const EDITOR_OVERLAY_CSS = `
[data-pcms-hover]{outline:2px solid #2f6feb!important;outline-offset:-2px!important;cursor:pointer;}
[data-pcms-selected]{outline:2px solid #1a7f37!important;outline-offset:-2px!important;}
.pcms-editing{outline:2px solid #1a7f37!important;outline-offset:-2px!important;background:rgba(26,127,55,.06);cursor:text;}
.pcms-section{position:relative;}
.pcms-section--hidden{opacity:.4;}
.pcms-sec-tools{position:absolute;top:4px;right:4px;z-index:10;display:flex;gap:2px;background:rgba(255,255,255,.96);border:1px solid #d0d7de;border-radius:6px;padding:2px;opacity:0;transition:opacity .1s;box-shadow:0 1px 4px rgba(0,0,0,.15);}
.pcms-section:hover>.pcms-sec-tools{opacity:1;}
.pcms-sec-tools button,.pcms-sec-handle{font:inherit;font-size:13px;line-height:1;border:none;background:transparent;cursor:pointer;padding:3px 5px;border-radius:4px;color:#333;}
.pcms-sec-handle{cursor:grab;}
.pcms-sec-tools button:hover{background:#eef0f2;}
.pcms-insert{position:relative;height:6px;display:flex;align-items:center;justify-content:center;margin:0;}
.pcms-insert__btn{width:24px;height:24px;border-radius:50%;border:1px solid #2f6feb;background:#fff;color:#2f6feb;font-size:14px;line-height:1;cursor:pointer;opacity:0;transition:opacity .1s;z-index:9;padding:0;}
.pcms-insert:hover .pcms-insert__btn,body.pcms-dragging .pcms-insert__btn{opacity:1;}
body.pcms-dragging .pcms-insert{height:18px;outline:1px dashed #9db6ef;}
.pcms-insert--over{background:#eaf1ff;}
.pcms-insert--over .pcms-insert__btn{opacity:1;background:#2f6feb;color:#fff;}
.pcms-empty-canvas{margin:2rem;padding:3rem 1rem;border:2px dashed #c0c6cf;border-radius:12px;text-align:center;color:#6b7280;font-family:sans-serif;line-height:1.8;}
`;

export const EDITOR_RUNTIME = `
(function(){
  var SEL='[data-pcms-section],[data-pcms-field]';
  var hovered=null, selected=null, dragId=null, editing=null, clickTimer=null;
  function closestEditable(t){ return (t && t.closest) ? t.closest(SEL) : null; }
  function post(o){ o.source='pcms-preview'; parent.postMessage(o,'*'); }
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
    postRect();
  }
  var rectPending=false;
  function sectionOf(el){
    if(!el) return null;
    if(el.getAttribute && el.getAttribute('data-pcms-section')!=null) return el;
    return el.closest ? el.closest('[data-pcms-section]') : null;
  }
  function postRect(){
    var el=sectionOf(selected);
    if(!el){ post({type:'rect', section:null, rect:null}); return; }
    var r=el.getBoundingClientRect();
    post({type:'rect', section:el.getAttribute('data-pcms-section'),
      rect:{top:r.top,left:r.left,width:r.width,height:r.height},
      view:{w:(window.innerWidth||document.documentElement.clientWidth),
            h:(window.innerHeight||document.documentElement.clientHeight)}});
  }
  function scheduleRect(){
    if(rectPending||!selected) return;
    rectPending=true;
    requestAnimationFrame(function(){ rectPending=false; postRect(); });
  }
  function clearDrop(){ var e=document.querySelector('.pcms-insert--over'); if(e) e.classList.remove('pcms-insert--over'); }

  function startEdit(el){
    if(editing && editing!==el) finishEdit();
    editing=el;
    setHover(null);
    el.classList.add('pcms-editing');
    el.setAttribute('contenteditable','true');
    el.focus();
    try{ var r=document.createRange(); r.selectNodeContents(el); var s=getSelection(); s.removeAllRanges(); s.addRange(r); }catch(_){}
  }
  function finishEdit(){
    if(!editing) return;
    var el=editing; editing=null;
    el.removeAttribute('contenteditable');
    el.classList.remove('pcms-editing');
    var type=el.getAttribute('data-pcms-fieldtype');
    var value=(type==='richtext') ? el.innerHTML : (el.innerText||'').replace(/\\n+$/,'');
    var sectionEl=el.closest('[data-pcms-section]');
    post({type:'edit',
      section: sectionEl?sectionEl.getAttribute('data-pcms-section'):null,
      field: el.getAttribute('data-pcms-field'), value:value});
  }

  document.addEventListener('mousemove', function(e){
    if(dragId||editing) return;
    setHover(closestEditable(e.target));
  }, true);
  document.addEventListener('mouseleave', function(){ if(!editing) setHover(null); }, true);

  document.addEventListener('dblclick', function(e){
    var el=e.target.closest ? e.target.closest('[data-pcms-field]') : null;
    if(!el) return;
    var type=el.getAttribute('data-pcms-fieldtype');
    if(type!=='text' && type!=='richtext') return;
    e.preventDefault(); e.stopPropagation();
    if(clickTimer){ clearTimeout(clickTimer); clickTimer=null; } // cancel the pending field focus
    startEdit(el);
  }, true);
  document.addEventListener('blur', function(e){ if(editing && e.target===editing) finishEdit(); }, true);
  document.addEventListener('keydown', function(e){
    if(!editing) return;
    if(e.key==='Escape'){ e.preventDefault(); editing.blur(); }
    else if(e.key==='Enter' && editing.getAttribute('data-pcms-fieldtype')==='text'){ e.preventDefault(); editing.blur(); }
  }, true);

  document.addEventListener('click', function(e){
    var op=e.target.closest ? e.target.closest('[data-pcms-op]') : null;
    if(op){ e.preventDefault(); e.stopPropagation();
      post({type:'op', op:op.getAttribute('data-pcms-op'), id:op.getAttribute('data-pcms-id')}); return; }
    var ins=e.target.closest ? e.target.closest('[data-pcms-insert]') : null;
    if(ins){ e.preventDefault(); e.stopPropagation();
      post({type:'insert', index:Number(ins.getAttribute('data-pcms-insert'))}); return; }
    // Clicks inside the field being edited place the caret — leave them alone.
    if(editing && (e.target===editing || editing.contains(e.target))) return;
    var a=e.target.closest ? e.target.closest('a') : null;
    if(a) e.preventDefault();
    if(e.target.closest && e.target.closest('.pcms-sec-tools')) return;
    var el=closestEditable(e.target);
    if(!el) return;
    e.preventDefault(); e.stopPropagation();
    var sectionEl=el.closest('[data-pcms-section]');
    var fieldEl=e.target.closest ? e.target.closest('[data-pcms-field]') : null;
    var section = sectionEl?sectionEl.getAttribute('data-pcms-section'):null;
    var field = fieldEl?fieldEl.getAttribute('data-pcms-field'):null;
    var ftype = fieldEl?fieldEl.getAttribute('data-pcms-fieldtype'):null;
    setSelected(sectionEl || el);
    post({type:'select', section:section, field:null});
    if(field && ftype==='image'){
      // Clicking an image opens the media picker to replace it.
      post({type:'pickimage', section:section, field:field});
    } else if(field){
      // Focus the panel field after a delay, so a double-click (inline edit)
      // can cancel it instead of stealing focus from the contenteditable.
      if(clickTimer) clearTimeout(clickTimer);
      clickTimer=setTimeout(function(){ clickTimer=null; post({type:'focusfield', section:section, field:field}); }, 220);
    }
  }, true);

  document.addEventListener('dragstart', function(e){
    var h=e.target.closest ? e.target.closest('[data-pcms-drag]') : null;
    if(!h) return;
    dragId=h.getAttribute('data-pcms-drag');
    try{ e.dataTransfer.setData('text/plain', dragId); e.dataTransfer.effectAllowed='move'; }catch(_){}
    document.body.classList.add('pcms-dragging');
  }, true);
  document.addEventListener('dragend', function(){ dragId=null; document.body.classList.remove('pcms-dragging'); clearDrop(); }, true);
  document.addEventListener('dragover', function(e){
    if(!dragId) return;
    var ins=e.target.closest ? e.target.closest('[data-pcms-insert]') : null;
    if(ins){ e.preventDefault(); clearDrop(); ins.classList.add('pcms-insert--over'); }
  }, true);
  document.addEventListener('drop', function(e){
    if(dragId){
      var ins=e.target.closest ? e.target.closest('[data-pcms-insert]') : null;
      if(ins){ e.preventDefault(); post({type:'move', id:dragId, toIndex:Number(ins.getAttribute('data-pcms-insert'))}); }
    }
    dragId=null; document.body.classList.remove('pcms-dragging'); clearDrop();
  }, true);

  // Keep the floating editor glued to its section as the preview scrolls/resizes.
  window.addEventListener('scroll', scheduleRect, true);
  window.addEventListener('resize', scheduleRect);

  window.addEventListener('message', function(e){
    var d=e.data||{};
    if(d.source!=='pcms-editor' || d.type!=='select') return;
    var el=d.section ? document.querySelector('[data-pcms-section="'+d.section+'"]') : null;
    setSelected(el);
    if(el && el.scrollIntoView) el.scrollIntoView({block:'nearest',behavior:'smooth'});
    // The rect may change after the smooth scroll settles; re-post shortly.
    setTimeout(postRect, 320);
  });
})();
`;
