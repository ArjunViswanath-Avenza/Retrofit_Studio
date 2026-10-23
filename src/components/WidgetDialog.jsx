// Preview & edit one widget: a dialog with the R21 · KBZ · R26 versions of its template, component or form drawn side by
// side, and an editor whose changes are applied to that widget in all three versions and redrawn live. Preview only —
// nothing is written back to the project files.
import { useState, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { renderTemplate, renderForm } from "../lib/preview";
import { versionIndex } from "../lib/visual";
import { readWidgetJson, partsOf } from "../lib/components";
import "./widgetdialog.css";

const FORM_H = 900;
const WIDTHS = { segment: [[375, "375"], [768, "768"], [1024, "1024"], [1366, "1366"]], component: [[375, "375"], [768, "768"], [1024, "1024"], [1366, "1366"]], form: [[640, "640"], [1024, "1024"], [1366, "1366"], [1920, "1920"]] };
const NOUN = { segment: "segment template", component: "component", form: "form" };
const ALIGN = [["", "—"], ["1", "top left"], ["2", "top center"], ["3", "top right"], ["4", "middle left"], ["5", "middle center"], ["6", "middle right"], ["7", "bottom left"], ["8", "bottom center"], ["9", "bottom right"]];
// friendly fields: widget JSON key, how to read the typed value into JSON
const FIELDS = [
  { k: "_text_", label: "Text", hint: "replaces the i18n text" },
  { k: "_skin_", label: "Skin", list: true, hint: "skin name (or kuid)" },
  { k: "isvisible", label: "Visible", select: [["", "—"], ["true", "visible"], ["false", "hidden"]], parse: (v) => v === "true" },
  { k: "_width_", label: "Width", hint: "e.g. 50% · 120dp · preferred" },
  { k: "_height_", label: "Height", hint: "e.g. 40dp · preferred" },
  { k: "_left_", label: "Left" },
  { k: "_top_", label: "Top" },
  { k: "_right_", label: "Right" },
  { k: "_bottom_", label: "Bottom" },
  { k: "centerx", label: "Center X" },
  { k: "centery", label: "Center Y" },
  { k: "_padding_", label: "Padding", hint: "left, top, right, bottom (%)", parse: (v) => v.split(/[\s,]+/).filter(Boolean).map(Number) },
  { k: "contentalignment", label: "Alignment", select: ALIGN, parse: Number },
  { k: "layouttype", label: "Layout", select: [["", "—"], ["2", "free form"], ["3", "horizontal flow"], ["4", "vertical flow"]], parse: Number },
  { k: "zindex", label: "z-index", parse: Number },
];
// a patched JSON key also wins over the breakpoint overrides the runtime would apply on top of it
const RESP = { _left_: "left", _top_: "top", _right_: "right", _bottom_: "bottom", _width_: "width", _height_: "height", centerx: "centerX", centery: "centerY", isvisible: "isVisible", _skin_: "skin", _text_: "text", layouttype: "layoutType", zindex: "zIndex" };
const HL = `.kw.wd-sel>.kin,.krow.wd-sel>.kin{outline:3px solid #F26A21!important;outline-offset:-3px}
.kw.wd-edit>.kin,.krow.wd-edit>.kin{box-shadow:inset 0 0 0 9999px rgba(242,106,33,.12)}
.wd-tag{position:absolute;right:1px;top:1px;z-index:99999;font:700 9px/12px Arial;color:#fff;background:#F26A21;padding:0 4px;border-radius:6px;pointer-events:none}`;

function filesOf(kind, p, key) {
  if (!p) return null;
  if (kind === "segment") return p.segs ? p.segs.get(key) : null;
  if (kind === "form") return p.forms ? p.forms.get(key) : null;
  const parts = p.comps && p.comps.get(key) ? partsOf(key, p.comps.get(key)) : null;
  return parts ? parts.structure : null;
}
function appOf(kind, p, key) {
  if (!p) return "";
  if (kind === "segment") { const m = p.segMeta && p.segMeta.get(key); return m ? m.app : ""; }
  if (kind === "form") return (p.formApp && p.formApp.get(key)) || "";
  return (p.compApp && p.compApp.get(key)) || "";
}
const chOf = (kind, key) => (kind === "component" ? "desktop" : key.split("/")[0]);
const shown = (v) => { if (v === undefined || v === null || v === "") return "—"; if (Array.isArray(v)) return v.join(", "); if (typeof v === "object") return v.value === "" || v.value == null ? "—" : String(v.value); return String(v); };
function applyPatch(W, id, patch) {
  if (!W || !W[id] || !Object.keys(patch).length) return W;
  const j = JSON.parse(JSON.stringify(W[id]));
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete j[k]; else j[k] = v;
    if (k === "_text_") delete j.texti18n;
    const rk = RESP[k];
    if (rk && j.responsiveData && typeof j.responsiveData === "object") for (const b of Object.values(j.responsiveData)) if (b && typeof b === "object") delete b[rk];
  }
  return { ...W, [id]: j };
}

export function WidgetDialog({ kind, itemKey, id, picked, labels, onClose }) {
  const [Ws, setWs] = useState(null);
  const [draft, setDraft] = useState({}); // field key -> typed text
  const [adv, setAdv] = useState("{\n  \n}");
  const [advPatch, setAdvPatch] = useState({});
  const [advErr, setAdvErr] = useState(null);
  const [patch, setPatch] = useState({});
  const [width, setWidth] = useState(kind === "form" ? 1366 : 1024);
  const [showHidden, setShowHidden] = useState(false);
  const [skins, setSkins] = useState([]);
  const [jsonOf, setJsonOf] = useState(null);
  useEffect(() => {
    let alive = true;
    (async () => { const out = []; for (let i = 0; i < labels.length; i++) { const m = filesOf(kind, picked[i], itemKey); out.push(m ? await readWidgetJson(m) : null); } if (alive) setWs(out); })();
    return () => { alive = false; };
  }, [kind, itemKey, picked, labels.length]);
  useEffect(() => { const k = (e) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  // typed values -> JSON patch, a moment after typing stops
  useEffect(() => {
    const t = setTimeout(() => {
      const p = {};
      for (const f of FIELDS) {
        const v = draft[f.k];
        if (v === undefined || v === "") continue;
        p[f.k] = f.parse ? f.parse(v) : v;
      }
      setPatch({ ...p, ...advPatch });
    }, 350);
    return () => clearTimeout(t);
  }, [draft, advPatch]);
  const patched = useMemo(() => (Ws ? Ws.map((W) => (W ? applyPatch(W, id, patch) : null)) : null), [Ws, id, patch]);
  const has = labels.map((_, i) => !!(Ws && Ws[i] && Ws[i][id]));
  const anyJ = Ws && Ws.find((W, i) => has[i]) ? Ws.find((W, i) => has[i])[id] : null;
  const edited = Object.keys(patch).length;
  const onSkins = (names) => setSkins((s) => (s.length >= names.length ? s : names));
  const applyAdv = () => {
    try { const v = JSON.parse(adv.trim() || "{}"); if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("write an object: { \"property\": value }"); setAdvPatch(v); setAdvErr(null); } catch (e) { setAdvErr(e.message); }
  };
  const reset = () => { setDraft({}); setAdvPatch({}); setAdv("{\n  \n}"); setAdvErr(null); };

  return createPortal(
    <div className="wd-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="wd" role="dialog" aria-label={`Preview ${id}`}>
        <div className="wd-head">
          <div className="wd-title"><span className="wd-k">Preview &amp; edit · {NOUN[kind]}</span><b className="mono">{itemKey.split("/").pop().replace(/\.sm$/i, "")}</b><span className="wd-sep">›</span><b className="mono wd-id">{id}</b>{anyJ && <span className="tag">{anyJ.wType}</span>}</div>
          <div className="seg" style={{ margin: 0 }}>{WIDTHS[kind].map(([w, l]) => <button key={w} className={width === w ? "on" : ""} onClick={() => setWidth(w)}>{l}</button>)}</div>
          <label className="wd-check"><input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} /> Show hidden parts</label>
          <button className="wd-x" onClick={onClose} title="Close (Esc)">✕</button>
        </div>
        <div className="wd-body">
          <div className="wd-panes">
            {labels.map((l, i) => (
              <DialogPane key={i} kind={kind} label={l} p={picked[i]} itemKey={itemKey} W={patched && patched[i]} loading={!patched} id={id} width={width} showHidden={showHidden} edited={edited > 0 && has[i]} has={has[i]} onSkins={onSkins} />
            ))}
          </div>
          <aside className="wd-edit">
            <div className="wd-has">{labels.map((l, i) => <span key={l} className={has[i] ? "on" : ""}>{has[i] ? "✓" : "—"} {l}</span>)}</div>
            <p className="wd-note">Changes apply to <b>{id}</b> in every version that has it and are drawn straight away. Preview only — nothing is written to the project.</p>
            <datalist id="wd-skins">{skins.slice(0, 5000).map((s) => <option key={s} value={s} />)}</datalist>
            {FIELDS.map((f) => {
              const vals = labels.map((l, i) => (has[i] ? shown(Ws[i][id][f.k]) : null));
              const differ = new Set(vals.filter((v) => v != null)).size > 1;
              const on = draft[f.k] !== undefined && draft[f.k] !== "";
              return (
                <div key={f.k} className={"wd-f" + (on ? " on" : "")}>
                  <label>{f.label}{differ && <span className="wd-diff" title="the versions differ">differs</span>}</label>
                  {f.select ? (
                    <select value={draft[f.k] ?? ""} onChange={(e) => setDraft((d) => ({ ...d, [f.k]: e.target.value }))}>{f.select.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select>
                  ) : (
                    <input type="text" list={f.list ? "wd-skins" : undefined} placeholder={f.hint || "unchanged"} value={draft[f.k] ?? ""} onChange={(e) => setDraft((d) => ({ ...d, [f.k]: e.target.value }))} />
                  )}
                  <div className="wd-now">{labels.map((l, i) => <span key={l}>{l} <b>{!Ws ? "…" : vals[i] == null ? "not here" : vals[i]}</b></span>)}</div>
                </div>
              );
            })}
            <div className="wd-sec">Any property <span className="tag">JSON, applied to all three</span></div>
            <textarea className="wd-json" value={adv} onChange={(e) => setAdv(e.target.value)} spellCheck={false} rows={5} />
            {advErr && <div className="wd-err">{advErr}</div>}
            <div className="wd-btns">
              <button className="btn" onClick={applyAdv}>Apply JSON</button>
              <button className="btn ghost" onClick={reset} disabled={!edited && !Object.keys(draft).length}>Reset all</button>
            </div>
            {edited > 0 && <div className="wd-sum">{edited} parameter{edited === 1 ? "" : "s"} changed: <span className="mono">{Object.keys(patch).join(", ")}</span></div>}
            <div className="wd-sec">Current JSON</div>
            <div className="seg" style={{ margin: "0 0 6px" }}>{labels.map((l, i) => <button key={l} className={jsonOf === i ? "on" : ""} disabled={!has[i]} onClick={() => setJsonOf(jsonOf === i ? null : i)}>{l}</button>)}</div>
            {jsonOf != null && has[jsonOf] && <pre className="wd-raw">{JSON.stringify(Ws[jsonOf][id], null, 2)}</pre>}
          </aside>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// bring a widget into view inside the drawn form: every scrolling container around it (form, scroll flexes, segments)
// is scrolled so the widget sits near its middle — only inside the iframe, never the page behind the dialog
function reveal(el) {
  const win = el.ownerDocument.defaultView;
  for (let a = el.parentElement; a; a = a.parentElement) {
    const cs = win.getComputedStyle(a);
    if (!/(auto|scroll)/.test(cs.overflowY + cs.overflowX) || (a.scrollHeight <= a.clientHeight && a.scrollWidth <= a.clientWidth)) continue;
    const r = el.getBoundingClientRect(), ar = a.getBoundingClientRect();
    a.scrollTop += r.top - ar.top - a.clientHeight / 2 + r.height / 2;
    a.scrollLeft += r.left - ar.left - a.clientWidth / 2 + r.width / 2;
  }
}

function DialogPane({ kind, label, p, itemKey, W, loading, id, width, showHidden, edited, has, onSkins }) {
  const frame = useRef(null), box = useRef(null);
  const [h, setH] = useState(kind === "form" ? FORM_H : 80);
  const [state, setState] = useState("drawing");
  const [boxW, setBoxW] = useState(700);
  useEffect(() => { const el = box.current; if (!el) return undefined; const ro = new ResizeObserver(() => setBoxW(el.clientWidth)); ro.observe(el); return () => ro.disconnect(); }, []);
  useEffect(() => {
    if (!W || !frame.current) return undefined;
    let alive = true;
    setState("drawing");
    (async () => {
      try {
        const idx = versionIndex(p, appOf(kind, p, itemKey), chOf(kind, itemKey));
        const doc = frame.current.contentDocument;
        const map = new Map(Object.entries(W));
        const out = kind === "form" ? await renderForm(idx, map, doc, { width, height: FORM_H, showHidden, extraCss: HL }) : await renderTemplate(idx, map, doc, { width, showHidden, extraCss: HL });
        if (!alive) return;
        setH(out ? (kind === "form" ? FORM_H : out.height) : 40);
        const n = out && out.byId.get(id);
        if (n && n.el) {
          n.el.classList.add("wd-sel");
          if (edited) { n.el.classList.add("wd-edit"); const t = doc.createElement("span"); t.className = "wd-tag"; t.textContent = "edited"; n.el.appendChild(t); }
          if (kind === "form") reveal(n.el);
        }
        setState(out ? (n && !n.el ? "hiddenParent" : n && n.p && !n.p.isVisible ? "hidden" : "ok") : "empty");
        if (idx && idx.previewAssets) onSkins([...idx.previewAssets.skinsByName.keys()].sort());
      } catch (e) { if (alive) setState("error:" + (e.message || e)); }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [W, width, showHidden, p, itemKey, id]);
  const scale = Math.min(1, Math.max(0.15, (boxW - 2) / width));
  return (
    <div className="wd-pane">
      <div className="wd-ph"><b>{label}</b>
        {!p ? <span className="tag">not loaded</span> : !W ? <span className="tag">{loading ? "reading…" : `no such ${NOUN[kind]} in ${label}`}</span>
          : <span className="tag">{appOf(kind, p, itemKey) ? appOf(kind, p, itemKey) + " · " : ""}{Math.round(scale * 100)}%{has ? "" : ` · ${id} is not in ${label} — drawn unchanged`}</span>}
        {state === "hidden" && <span className="pill b2">widget hidden — tick “Show hidden parts”</span>}
      </div>
      <div className="wd-box" ref={box}>
        {W && state === "drawing" && <div className="wd-load">Drawing {label}…</div>}
        {state.startsWith("error") && <div className="wd-none">Could not draw: {state.slice(6)}</div>}
        {W && (
          <div className="wd-frame" style={{ width: width * scale, height: h * scale }}>
            <iframe ref={frame} title={`${label} preview`} className="wd-iframe" style={{ width, height: h, transform: `scale(${scale})` }} />
          </div>
        )}
      </div>
    </div>
  );
}

