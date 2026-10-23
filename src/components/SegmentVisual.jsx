// TemplateTwin · Visual: one segment template drawn as a segment row in each version (R21 · KBZ · R26), from each
// version's own files and skins. "Highlight changes" turns it into a 1 vs 1 comparison: the pair side by side, every
// added / removed / changed / moved widget outlined (same widget diff as the Structure tab), with a clickable list.
// Nothing is drawn until a template's Visual tab is opened.
import { useState, useEffect, useMemo, useRef } from "react";
import { renderTemplate } from "../lib/preview";
import { templateIndex } from "../lib/visual";
import { readWidgetJson } from "../lib/components";
import { buildFormDiff } from "../lib/forms";
import { widgetRefs } from "../lib/segments";

const PAIRS = [[0, 1], [0, 2], [1, 2]];
const WIDTHS = [[375, "Mobile 375"], [768, "Tablet 768"], [1024, "1024"], [1366, "Desktop 1366"]];
const MARK = { added: "add", removed: "del", modified: "chg", moved: "mov" };
const SIGN = { add: "+", del: "−", chg: "~", mov: "↔" };
const HL_CSS = `
.kw.hl-add>.kin,.krow.hl-add>.kin{outline:2px solid #2f9e5b;outline-offset:-2px;box-shadow:inset 0 0 0 9999px rgba(47,158,91,.13)}
.kw.hl-del>.kin,.krow.hl-del>.kin{outline:2px solid #d64545;outline-offset:-2px;box-shadow:inset 0 0 0 9999px rgba(214,69,69,.13)}
.kw.hl-chg>.kin,.krow.hl-chg>.kin{outline:2px dashed #d99a14;outline-offset:-2px;box-shadow:inset 0 0 0 9999px rgba(230,163,35,.12)}
.kw.hl-mov>.kin,.krow.hl-mov>.kin{outline:2px dashed #3e7bd6;outline-offset:-2px;box-shadow:inset 0 0 0 9999px rgba(62,123,214,.10)}
.hl-b{position:absolute;right:1px;top:1px;z-index:99999;font:700 9px/12px Arial;color:#fff;padding:0 4px;border-radius:6px;pointer-events:none}
.hl-b.add{background:#2f9e5b}.hl-b.del{background:#d64545}.hl-b.chg{background:#d99a14}.hl-b.mov{background:#3e7bd6}
.kw.hl-focus>.kin,.krow.hl-focus>.kin{animation:hlf 1s ease 3}
@keyframes hlf{0%,100%{box-shadow:inset 0 0 0 9999px rgba(242,106,33,0)}50%{box-shadow:inset 0 0 0 9999px rgba(242,106,33,.35)}}
.kw:hover>.kin{outline:1px solid rgba(242,106,33,.6);outline-offset:-1px;cursor:pointer}
.kw.hl-sel>.kin,.krow.hl-sel>.kin{outline:3px solid #F26A21!important;outline-offset:-3px}
`;

export function SegmentVisual({ r, picked, labels, usage }) {
  const [width, setWidth] = useState(1024);
  const [showHidden, setShowHidden] = useState(false);
  const [hl, setHl] = useState(false);
  const [pairIdx, setPairIdx] = useState(0);
  const [focus, setFocus] = useState(null); // { id, t }
  const [sel, setSel] = useState(null); // the widget open in the side panel: { id, i (version clicked) }
  const [Ws, setWs] = useState(null); // per version: widget id -> JSON (null when the version has no copy)
  const [hidden, setHidden] = useState({}); // pane index -> Set(ids not drawn because hidden)
  useEffect(() => {
    let alive = true;
    setWs(null);
    (async () => { const out = []; for (let i = 0; i < labels.length; i++) { const m = picked[i] && picked[i].segs && picked[i].segs.get(r.key); out.push(m ? await readWidgetJson(m) : null); } if (alive) setWs(out); })();
    return () => { alive = false; };
  }, [r.key, picked, labels.length]);

  const pairs = PAIRS.filter(([a, b]) => b < labels.length);
  const [a, b] = pairs[Math.min(pairIdx, pairs.length - 1)];
  const diff = useMemo(() => (hl && Ws ? buildFormDiff(Ws[a] || {}, Ws[b] || {}) : null), [hl, Ws, a, b]);
  const changes = useMemo(() => (diff ? diff.order.map((id) => diff.nodes.get(id)).filter((n) => n.status !== "same") : []), [diff]);
  const marksFor = (i) => {
    if (!diff) return null;
    const m = new Map();
    for (const n of changes) {
      const k = MARK[n.status];
      if (i === a && (k === "del" || k === "chg" || k === "mov")) m.set(n.id, k);
      if (i === b && (k === "add" || k === "chg" || k === "mov")) m.set(n.id, k);
    }
    return m;
  };
  const panes = hl ? [a, b] : labels.map((_, i) => i);
  const t = diff ? diff.totals : null;

  return (
    <div className="sv">
      <div className="sv-bar">
        <div className="seg" style={{ margin: 0 }}>{WIDTHS.map(([w, l]) => <button key={w} className={width === w ? "on" : ""} onClick={() => setWidth(w)}>{l}</button>)}</div>
        <label className="sv-check"><input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} /> Show hidden parts</label>
        <span className="spacer" />
        <button className={"btn" + (hl ? "" : " ghost")} onClick={() => { setHl((v) => !v); setFocus(null); }}>{hl ? "✓ Highlighting changes" : "◎ Highlight changes"}</button>
        {hl && <div className="seg" style={{ margin: 0 }}>{pairs.map(([x, y], i) => <button key={i} className={pairIdx === i ? "on" : ""} onClick={() => { setPairIdx(i); setFocus(null); }}>{labels[x]} vs {labels[y]}</button>)}</div>}
      </div>
      {hl && t && (
        <div className="sv-legend">
          <span className="sv-k add">+ {t.added} added in {labels[b]}</span>
          <span className="sv-k del">− {t.removed} removed (shown in {labels[a]})</span>
          <span className="sv-k chg">~ {t.modified} changed</span>
          <span className="sv-k mov">↔ {t.moved} moved</span>
          <span className="tag">Same widget comparison as the Structure tab · click a change to find it</span>
        </div>
      )}
      <div className={"sv-main" + (sel ? " open" : "")}>
      <div className="sv-left">
      <div className={"sv-panes n" + panes.length}>
        {panes.map((i) => (
          <Pane key={i} i={i} label={labels[i]} r={r} p={picked[i]} W={Ws && Ws[i]} loading={!Ws} width={width} showHidden={showHidden}
            marks={marksFor(i)} focus={focus} selId={sel && sel.id} onHidden={(s) => setHidden((h) => ({ ...h, [i]: s }))} onPick={(id) => { setFocus({ id, t: Date.now() }); setSel({ id, i }); }} />
        ))}
      </div>
      {hl && diff && (
        <div className="sv-changes">
          <div className="sv-ch-h">{changes.length ? `${changes.length} widget${changes.length === 1 ? "" : "s"} differ between ${labels[a]} and ${labels[b]}` : `No widget differs between ${labels[a]} and ${labels[b]}`}</div>
          {changes.map((n) => {
            const k = MARK[n.status];
            const isHidden = [a, b].some((i) => hidden[i] && hidden[i].has(n.id));
            return (
              <div key={n.id} className={"sv-ch" + (focus && focus.id === n.id ? " on" : "")} onClick={() => { setFocus({ id: n.id, t: Date.now() }); setSel({ id: n.id, i: n.status === "removed" ? a : b }); }}>
                <span className={"sv-k " + k}>{SIGN[k]} {n.status}</span>
                <b className="mono">{n.id}</b><span className="tag">{n.wType}</span>
                {n.status === "moved" && <span className="tag">{n.oldParent} → {n.newParent}</span>}
                {n.props.length > 0 && <span className="sv-props">{n.props.slice(0, 3).map((p) => `${p.path}${p.embedded ? "" : `: ${short(p.old)} → ${short(p.new)}`}`).join(" · ")}{n.props.length > 3 ? ` · +${n.props.length - 3} more` : ""}</span>}
                {n.wType === "Form" && <span className="tag">the template's own settings</span>}
                {isHidden && !showHidden && <span className="pill b2" title="hidden in the design">hidden — tick “Show hidden parts”</span>}
              </div>
            );
          })}
        </div>
      )}
      </div>
      {sel && <WidgetPanel key={sel.id} sel={sel} r={r} picked={picked} labels={labels} Ws={Ws} usage={usage} diff={diff} pair={[a, b]} onClose={() => setSel(null)} />}
      </div>
    </div>
  );
}
const short = (v) => { if (v === undefined) return "∅"; const s = typeof v === "string" ? v : JSON.stringify(v); return s.length > 28 ? s.slice(0, 27) + "…" : s; };

function Pane({ i, label, r, p, W, loading, width, showHidden, marks, focus, selId, onHidden, onPick }) {
  const frame = useRef(null), box = useRef(null), res = useRef(null);
  const [h, setH] = useState(80);
  const [state, setState] = useState("drawing");
  const [boxW, setBoxW] = useState(600);
  const [rev, setRev] = useState(0);
  const copy = r.copies[i];
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBoxW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // draw (again) when the template, the width or "show hidden" changes
  useEffect(() => {
    if (!W || !frame.current) return;
    let alive = true;
    setState("drawing");
    (async () => {
      try {
        const idx = templateIndex(p, r.key);
        const doc = frame.current.contentDocument;
        const out = await renderTemplate(idx, new Map(Object.entries(W)), doc, { width, showHidden, extraCss: HL_CSS });
        if (!alive) return;
        res.current = out;
        setH(out ? out.height : 40);
        doc.body.addEventListener("click", (e) => { const w = e.target.closest(".kw"); if (w) { const id = w.dataset.path.split(".").pop(); onPick(id); } });
        const hid = new Set();
        if (out) for (const [id, n] of out.byId) if (!n.p.isVisible || (n.el && n.el.closest && n.el.closest("[style*='display: none']"))) hid.add(id);
        onHidden(hid);
        setState(out ? "ok" : "empty");
        setRev((x) => x + 1);
      } catch (e) { if (alive) setState("error:" + (e.message || e)); }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [W, width, showHidden, r.key, p]);
  // highlights
  useEffect(() => {
    const out = res.current;
    if (!out || !frame.current) return;
    const doc = frame.current.contentDocument;
    for (const el of doc.querySelectorAll(".hl-add,.hl-del,.hl-chg,.hl-mov")) el.classList.remove("hl-add", "hl-del", "hl-chg", "hl-mov");
    for (const el of doc.querySelectorAll(".hl-b")) el.remove();
    if (!marks) return;
    for (const [id, k] of marks) {
      const n = out.byId.get(id);
      if (!n || !n.el) continue;
      n.el.classList.add("hl-" + k);
      const b = doc.createElement("span"); b.className = "hl-b " + k; b.textContent = SIGN[k]; n.el.appendChild(b);
    }
  }, [marks, rev]);
  // the widget open in the side panel keeps an outline
  useEffect(() => {
    const out = res.current;
    if (!out || !frame.current) return;
    const doc = frame.current.contentDocument;
    for (const el of doc.querySelectorAll(".hl-sel")) el.classList.remove("hl-sel");
    const n = selId && out.byId.get(selId);
    if (n && n.el) n.el.classList.add("hl-sel");
  }, [selId, rev]);
  // find a widget: flash it and scroll the pane to it
  useEffect(() => {
    const out = res.current;
    if (!focus || !out || !frame.current) return;
    const doc = frame.current.contentDocument;
    for (const el of doc.querySelectorAll(".hl-focus")) el.classList.remove("hl-focus");
    const n = out.byId.get(focus.id);
    if (!n || !n.el) return;
    void n.el.offsetWidth;
    n.el.classList.add("hl-focus");
    const rect = n.el.getBoundingClientRect(), fr = frame.current.getBoundingClientRect(), s = scale;
    const y = fr.top + rect.top * s;
    if (y < 80 || y > window.innerHeight - 80) window.scrollBy({ top: y - window.innerHeight / 3, behavior: "smooth" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, rev]);
  const scale = Math.min(1, Math.max(0.2, (boxW - 2) / width));
  return (
    <div className="sv-pane">
      <div className="sv-ph"><b>{label}</b>{copy ? <span className="tag mono">{copy.app ? copy.app + " · " : ""}{copy.name}</span> : <span className="tag">not in {label}</span>}
        {copy && state === "ok" && <span className="tag">{Math.round(scale * 100)}% · {h}px tall</span>}</div>
      <div className="sv-box" ref={box}>
        {!copy ? <div className="sv-none">This template is not in {label}.</div> : (
          <>
            {(loading || state === "drawing") && <div className="sv-load">{loading ? "Reading the template…" : `Drawing ${label} with its skins…`}</div>}
            {state.startsWith("error") && <div className="sv-none">Could not draw: {state.slice(6)}</div>}
            {state === "empty" && <div className="sv-none">The template has no widget to draw.</div>}
            <div className="sv-frame" style={{ width: width * scale, height: h * scale }}>
              <iframe ref={frame} title={`${label} template`} className="sv-iframe" style={{ width, height: h, transform: `scale(${scale})` }} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- side panel: one widget, its properties and its code */
const KIND_LABEL = { template: "Template controller", form: "Form", component: "Component", module: "Presentation / business code" };
const val = (v) => { if (v == null) return null; if (typeof v === "object") return v.value === "" || v.value == null ? null : String(v.value); return String(v); };
const PROPS = [
  ["Type", (j) => j.wType],
  ["Text", (j, A) => { const k = j.texti18n || j.placeholderi18n; const v = k && A && A.i18n ? A.i18n[k] : null; return k ? `${v != null ? `“${v}”` : "(no text in i18n)"} · ${k}` : j._text_ != null && j._text_ !== "" ? `“${j._text_}”` : null; }],
  ["Skin", (j, A) => { const s = j._skin_; if (!s) return null; const sk = A && A.skinsByKuid && A.skinsByKuid.get(s); return sk ? `${sk._name} (${s})` : s; }],
  ["Visible", (j) => (j.isvisible === false ? "hidden in the design" : "yes")],
  ["Position", (j) => ["_left_", "_top_", "_right_", "_bottom_", "centerx", "centery"].map((k) => [k, val(j[k])]).filter(([, v]) => v != null).map(([k, v]) => `${k.replace(/_/g, "")} ${v}`).join(" · ") || null],
  ["Size", (j) => ["_width_", "_height_"].map((k) => [k, val(j[k])]).filter(([, v]) => v != null).map(([k, v]) => `${k.replace(/_/g, "")} ${v}`).join(" · ") || null],
  ["Layout", (j) => ({ 2: "free form", 3: "horizontal flow", 4: "vertical flow" })[j.layouttype] || null],
  ["Children", (j) => (j.children && j.children.length ? j.children.join(", ") : null)],
];
function chainOf(W, id) { const out = []; let cur = W && W[id]; let g = 0; while (cur && g++ < 40) { out.unshift(cur.id); cur = cur.parent ? W[cur.parent] : null; } return out; }
const escRe = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function WidgetPanel({ sel, r, picked, labels, Ws, usage, diff, pair, onClose }) {
  const id = sel.id;
  const has = labels.map((_, i) => !!(Ws && Ws[i] && Ws[i][id]));
  const [vi, setVi] = useState(has[sel.i] ? sel.i : Math.max(0, has.indexOf(true)));
  const [refs, setRefs] = useState(null);
  const [open, setOpen] = useState(() => new Set());
  const [raw, setRaw] = useState(false);
  const uses = usage && usage[vi] ? usage[vi].get(r.key) : null;
  // the code that names this widget, in the version shown (again once the forms using the template are known)
  useEffect(() => {
    let alive = true;
    setRefs(null);
    if (!has[vi]) { setRefs([]); return undefined; }
    widgetRefs(picked[vi], r.key, id, uses).then((x) => alive && setRefs(x));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vi, id, r.key, uses]);
  const j = Ws && Ws[vi] && Ws[vi][id];
  const idx = templateIndex(picked[vi], r.key);
  const A = idx && idx.previewAssets;
  const node = diff && diff.nodes.get(id);
  const total = refs ? refs.reduce((n, g) => n + g.hits.length, 0) : 0;
  const re = new RegExp(`(?<![\\w$])(${escRe(id)})(?![\\w$])`);
  const mark = (t) => t.split(re).map((x, k) => (k % 2 ? <mark key={k}>{x}</mark> : x));
  return (
    <aside className="sv-panel">
      <button className="sv-pclose" onClick={onClose} title="Close">×</button>
      <div className="sv-pk">Widget</div>
      <h4 className="mono">{id}</h4>
      <div className="sv-has">{labels.map((l, i) => <span key={l} className={has[i] ? "on" : ""}>{has[i] ? "✓" : "—"} {l}</span>)}</div>
      <div className="seg sv-vtabs">{labels.map((l, i) => <button key={l} className={vi === i ? "on" : ""} disabled={!has[i]} onClick={() => setVi(i)}>{l}</button>)}</div>
      {!j ? <p className="note">Not in {labels[vi]}.</p> : (
        <>
          <div className="sv-chain mono">{chainOf(Ws[vi], id).join(" › ")}</div>
          <table className="sv-props-t"><tbody>
            {PROPS.map(([k, f]) => { const v = f(j, A); return v ? <tr key={k}><th>{k}</th><td>{v}</td></tr> : null; })}
          </tbody></table>
          <button className="sv-link" onClick={() => setRaw((x) => !x)}>{raw ? "Hide" : "Show"} the widget JSON</button>
          {raw && <pre className="sv-raw">{JSON.stringify(j, null, 2)}</pre>}
        </>
      )}
      {node && node.status !== "same" && (
        <div className="sv-pdiff">
          <div className="sv-psec">{labels[pair[0]]} → {labels[pair[1]]}: <span className={"sv-k " + MARK[node.status]}>{node.status}</span></div>
          {node.status === "moved" && <div className="tag">parent {node.oldParent} → {node.newParent}</div>}
          {node.props.slice(0, 30).map((p, k) => <div key={k} className="sv-pd"><b className="mono">{p.path}</b><span className="mono">{p.embedded ? `${p.change} (${p.innerCount} inner changes)` : `${short(p.old)} → ${short(p.new)}`}</span></div>)}
          {node.props.length > 30 && <div className="tag">+{node.props.length - 30} more — see the Structure tab</div>}
        </div>
      )}
      <div className="sv-psec">References in {labels[vi]} code {refs && <span className="tag">· {total} line{total === 1 ? "" : "s"}</span>}</div>
      {!usage && <p className="note">Still finding the forms that use this template — only its own controller is searched until then.</p>}
      {!refs ? <p className="note">Searching…</p> : !refs.length ? <p className="note">No controller, form or component in {labels[vi]} names <span className="mono">{id}</span>{has[vi] ? "" : " (it is not in this version)"}.</p> : refs.map((g, gi) => (
        <div key={gi} className="sv-rg">
          <div className="sv-rh"><span className={"sv-rk k-" + g.kind}>{KIND_LABEL[g.kind]}</span><b className="mono">{g.label}</b>{g.app && <span className="sg-apptag">{g.app}</span>}<span className="tag">{g.sub}</span></div>
          {g.hits.map((h) => {
            const k = `${gi}:${h.line}`, isOpen = open.has(k);
            return (
              <div key={h.line} className={"sv-hit" + (isOpen ? " open" : "")} title="Click for the lines around it" onClick={() => setOpen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; })}>
                {!isOpen ? <div className="sv-hl"><span>{h.line}</span><code>{mark(h.text)}</code></div>
                  : h.ctx.map((t, x) => <div key={x} className={"sv-hl" + (h.from + x === h.line ? " cur" : "")}><span>{h.from + x}</span><code>{h.from + x === h.line ? mark(t) : t || " "}</code></div>)}
              </div>
            );
          })}
          {g.more > 0 && <div className="tag">+{g.more} more lines</div>}
        </div>
      ))}
    </aside>
  );
}
