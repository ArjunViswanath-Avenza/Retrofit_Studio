// Blueprint · Preview: the form drawn at desktop size; click a widget to see what it does and when the code changes it,
// pick a scenario to see the screen that flow produces, and play the flow on the screen.
import { useState, useEffect, useMemo, useRef } from "react";
import { renderPreview, previewAssets, currentBreakpoint } from "../lib/preview";
import { looseJson, LAYER_LABEL } from "../lib/blueprint";
import { cachedTrace, FlowStory, Code, stepText } from "./Blueprint";

const nf = (n) => Number(n || 0).toLocaleString("en-US");
const HEIGHTS = [768, 900, 1080];

// every screen change a traced flow makes, in the order the code runs, with the function and condition around it.
// "here" = made by this form's own controller or a component on it; changes on other forms are kept for the play caption only
const formOfNode = (n) => { const m = /^controller:(?:.*\/)?(\w+?)Controller$/.exec(n.cls); return m ? m[1] : null; };
function widgetSteps(T, formName) {
  const out = [], seen = new Set();
  const walk = (n, via) => {
    if (!n || seen.has(n.uid) || n.ref || n.cycle) return;
    seen.add(n.uid);
    for (const e of n.edges) {
      const s = e.step;
      if (e.kind === "widget") { const on = n.viewPrefix ? formName : formOfNode(n); out.push({ path: e.path || s.path, step: s, node: n, via, here: on === formName, on }); }
      walk(e.child, via);
      for (const r of e.returns || []) walk(r.node, via);
    }
  };
  walk(T.root, null);
  return out;
}
// what a screen change sets, when the value is written literally in the code
function literal(step, i18n) {
  const v = (step.value || "").trim();
  const str = v.match(/^["']([^"']*)["']$/);
  const loc = v.match(/getLocalizedString\(\s*["']([^"']+)["']\s*\)/);
  const a = step.action;
  if ((a === "isVisible =" || a === "setVisibility()") && /^(true|false)$/.test(v)) return { prop: "isVisible", value: v === "true", label: v === "true" ? "shown" : "hidden" };
  if (a === "text =" && str) return { prop: "text", value: str[1], label: `text “${str[1]}”` };
  if (a === "text =" && loc) return { prop: "text", value: i18n[loc[1]] ?? loc[1], label: `text ${loc[1]}` };
  if (a === "skin =" && str) return { prop: "skin", value: str[1], label: `skin ${str[1]}` };
  if (a === "src =" && str) return { prop: "src", value: str[1], label: `image ${str[1]}` };
  return null;
}
// the screen a scenario leads to: literal changes that agree are applied; anything else is only marked
function scenarioState(steps, i18n) {
  const per = new Map();
  for (const w of steps) {
    if (!w.here) continue;
    if (!per.has(w.path)) per.set(w.path, []);
    per.get(w.path).push({ ...w, lit: literal(w.step, i18n) });
  }
  const overrides = new Map(), marks = new Map();
  for (const [path, list] of per) {
    const o = {}; let maybe = false, runtime = false;
    const byProp = new Map();
    for (const x of list) {
      if (!x.lit) { runtime = true; continue; }
      if (!byProp.has(x.lit.prop)) byProp.set(x.lit.prop, new Set());
      byProp.get(x.lit.prop).add(JSON.stringify(x.lit.value));
      if (x.step.conds.length) maybe = true;
    }
    for (const [prop, vals] of byProp) { if (vals.size === 1) o[prop] = JSON.parse([...vals][0]); else maybe = true; }
    if (Object.keys(o).length) overrides.set(path, o);
    marks.set(path, maybe ? "maybe" : runtime && !Object.keys(o).length ? "changed" : "changed");
  }
  return { overrides, marks, per };
}

export function FormPreview({ idx, f, A, cache, openFlow }) {
  const iframeRef = useRef(null), boxRef = useRef(null);
  const [formJ, setFormJ] = useState(null);
  const [width, setWidth] = useState(null);
  const [height, setHeight] = useState(768);
  const [scenario, setScenario] = useState("");
  const [traces, setTraces] = useState(null); // entry id -> widget steps
  const [prog, setProg] = useState(null);
  const [render, setRender] = useState(null);
  const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState(null); // widget path
  const [scale, setScale] = useState(1);
  const [play, setPlay] = useState(null); // { i, events, running }
  const [speed, setSpeed] = useState(1);
  const [code, setCode] = useState(null);
  const [i18n, setI18n] = useState({});

  const entries = useMemo(() => [...A.entries, ...A.arrivals].filter((e) => e.member), [A]);

  // the form's breakpoints (width choices)
  useEffect(() => {
    let alive = true;
    (async () => {
      const assets = await previewAssets(idx);
      const root = await (async () => { for (const rel of f.files) { const j = looseJson(await idx.read(rel)); if (j && !j.parent) return j; } return null; })();
      if (!alive) return;
      setI18n(assets.i18n); setFormJ(root);
      const bp = currentBreakpoint(root, 1366);
      setWidth(bp.list.length ? Math.max(...bp.list.map(([, w]) => w)) : 1366);
    })();
    return () => { alive = false; };
  }, [idx, f]);

  // trace every action once (shared with the other tabs through the cache)
  useEffect(() => {
    let alive = true;
    (async () => {
      const out = {};
      for (let i = 0; i < entries.length; i++) {
        if (!alive) return;
        out[entries[i].id] = widgetSteps(await cachedTrace(idx, cache, entries[i], f), f.name);
        if (i % 8 === 7) { setProg({ done: i + 1, total: entries.length }); await new Promise((r) => setTimeout(r)); }
      }
      if (alive) { setTraces(out); setProg(null); }
    })();
    return () => { alive = false; };
  }, [idx, cache, entries, f]);

  const scen = useMemo(() => (scenario && traces && traces[scenario] ? scenarioState(traces[scenario], i18n) : null), [scenario, traces, i18n]);

  // draw
  useEffect(() => {
    if (!width || !iframeRef.current) return;
    let alive = true;
    setBusy(true);
    (async () => {
      const doc = iframeRef.current.contentDocument;
      const r = await renderPreview(idx, f.key, doc, { width, height, overrides: scen ? scen.overrides : new Map(), onPick: (p) => setSel(p) });
      if (!alive) return;
      if (scen) for (const [path, m] of scen.marks) { const n = r.byPath.get(path); if (n && n.el) { n.el.classList.add(m === "maybe" ? "bp-maybe" : "bp-changed"); } }
      setRender(r); setBusy(false);
    })();
    return () => { alive = false; };
  }, [idx, f, width, height, scen]);

  // fit the canvas to the available width
  useEffect(() => {
    const fit = () => { if (boxRef.current && width) setScale(Math.min(1, (boxRef.current.clientWidth - 2) / width)); };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [width]);

  // selection outline inside the canvas
  useEffect(() => {
    const doc = iframeRef.current && iframeRef.current.contentDocument;
    if (!doc || !render) return;
    for (const x of doc.querySelectorAll(".bp-sel")) x.classList.remove("bp-sel");
    const n = sel && render.byPath.get(sel);
    if (n && n.el) n.el.classList.add("bp-sel");
  }, [sel, render]);

  // index: widget path -> every flow step that changes it
  const changes = useMemo(() => {
    const m = new Map();
    if (!traces) return m;
    for (const e of entries) for (const w of traces[e.id] || []) { if (!w.here) continue; if (!m.has(w.path)) m.set(w.path, []); m.get(w.path).push({ ...w, entry: e }); }
    return m;
  }, [traces, entries]);

  // play: walk the selected scenario's steps, flashing each widget as the code changes it
  useEffect(() => {
    if (!play || !play.running) return;
    const doc = iframeRef.current && iframeRef.current.contentDocument;
    const ev = play.events[play.i];
    if (!ev) { setPlay((p) => ({ ...p, running: false })); return; }
    const n = ev.here && render && render.byPath.get(ev.path);
    if (doc && n && n.el) {
      n.el.classList.remove("bp-flash"); void n.el.offsetWidth; n.el.classList.add("bp-flash");
      n.el.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
    const t = setTimeout(() => setPlay((p) => (p && p.running ? { ...p, i: p.i + 1 } : p)), 1300 / speed);
    return () => clearTimeout(t);
  }, [play, render, speed]);
  const startPlay = (id) => {
    if (id !== scenario) setScenario(id);
    const evs = (traces && traces[id]) || [];
    setPlay({ id, i: 0, events: evs, running: true });
  };

  const bp = formJ && width ? currentBreakpoint(formJ, width) : null;
  const widths = formJ ? [...new Set([...currentBreakpoint(formJ, 0).list.map(([, w]) => w)])].sort((a, b) => a - b) : [];
  const selNode = sel && render ? render.byPath.get(sel) : null;
  const scenEntry = entries.find((e) => e.id === scenario);
  const cur = play && play.events[play.i];
  return (
    <div className="pv-wrap">
      <div className="pv-bar">
        <div className="seg" style={{ margin: 0 }}>
          {widths.map((w) => <button key={w} className={width === w ? "on" : ""} onClick={() => setWidth(w)}>{w}px</button>)}
          {widths.length > 0 && <button className={width === widths[widths.length - 1] + 80 ? "on" : ""} onClick={() => setWidth(widths[widths.length - 1] + 80)}>{widths[widths.length - 1] + 80}px</button>}
        </div>
        <select className="ol-select pv-sel" value={height} onChange={(e) => setHeight(Number(e.target.value))}>{HEIGHTS.map((h) => <option key={h} value={h}>height {h}px</option>)}</select>
        <select className="ol-select pv-scen" value={scenario} onChange={(e) => { setScenario(e.target.value); setPlay(null); }}>
          <option value="">Screen as it first opens (design state)</option>
          {["lifecycle", "action", "arrival"].map((g) => (
            <optgroup key={g} label={g === "lifecycle" ? "Form events" : g === "action" ? "User actions" : "Arrivals from other code"}>
              {entries.filter((e) => e.group === g).map((e) => <option key={e.id} value={e.id}>{e.label}{traces && traces[e.id] ? ` · ${traces[e.id].filter((w) => w.here).length} changes on this form` : ""}</option>)}
            </optgroup>
          ))}
        </select>
        {scenario && <button className="btn" onClick={() => startPlay(scenario)} disabled={!traces}>▶ Play on preview</button>}
        <span className="tag">{bp && bp.key ? `breakpoint ${bp.key} (≤${bp.width}px)` : "above every breakpoint: base design"}{busy ? " · drawing…" : render ? ` · ${nf(render.stats.widgets)} widgets, ${nf(render.stats.hiddenWidgets)} hidden at this state` : ""}{prog ? ` · reading flows ${prog.done}/${prog.total}` : ""}</span>
      </div>
      {scen && (
        <div className="pv-legend">
          <span><i className="pv-sw changed" /> changed by this flow{scenEntry ? ` (${scenEntry.label})` : ""} — values written in the code are applied</span>
          <span><i className="pv-sw maybe" /> changed only under a condition, or to different values — open it to see when</span>
          <span className="tag">{nf(scen.per.size)} widgets touched · {nf(scen.overrides.size)} with values applied</span>
        </div>
      )}
      {play && (
        <div className="pv-play">
          <button className="btn ghost" onClick={() => setPlay((p) => ({ ...p, running: !p.running }))}>{play.running ? "❚❚" : "▶"}</button>
          <button className="btn ghost" onClick={() => setPlay((p) => ({ ...p, i: Math.max(0, p.i - 1), running: false }))}>◀</button>
          <button className="btn ghost" onClick={() => setPlay((p) => ({ ...p, i: Math.min(p.events.length - 1, p.i + 1), running: false }))}>▶</button>
          <div className="seg" style={{ margin: 0 }}>{[0.5, 1, 2].map((s) => <button key={s} className={speed === s ? "on" : ""} onClick={() => setSpeed(s)}>{s}×</button>)}</div>
          <span className="pv-step">{play.events.length ? `${Math.min(play.i + 1, play.events.length)} / ${play.events.length}` : "this flow changes no widget that can be read from the code"}</span>
          {cur && <span className="pv-cap">{!cur.here && <span className="pv-pill rt">on {cur.on || "another form"}</span>}<b className="mono">{cur.path}</b> {cur.step.action} <span className="mono">{cur.step.value || ""}</span> <span className="tag">in {cur.node.clsLabel}.{cur.node.name} · line {cur.step.line}{cur.step.conds.length ? ` · only ${cur.step.conds[cur.step.conds.length - 1]}` : ""}</span>
            <button className="btn ghost" onClick={() => { setSel(cur.path); setCode({ rel: cur.node.rel, from: cur.node.line, to: cur.node.end, line: cur.step.line, title: `${cur.node.clsLabel}.${cur.node.name}` }); }}>code</button></span>}
        </div>
      )}
      <div className="pv-body">
        <div className="pv-canvas" ref={boxRef}>
          <div className="pv-frame" style={{ width: (width || 0) * scale, height: height * scale }}>
            <iframe ref={iframeRef} title="form preview" className="pv-iframe" style={{ width: width || 0, height, transform: `scale(${scale})` }} />
          </div>
          <div className="tag pv-note">Drawn from the project files with the runtime's layout rules · {Math.round(scale * 100)}% zoom · click any widget</div>
        </div>
        <div className="pv-side">
          {!sel ? <p className="note">Click a widget on the screen to see what it does and when the code changes it.</p> : (
            <WidgetPanel sel={sel} node={selNode} render={render} entries={entries} changes={changes} traces={traces} i18n={i18n}
              idx={idx} cache={cache} f={f} openFlow={openFlow} startPlay={startPlay} setCode={setCode} setSel={setSel} />
          )}
        </div>
      </div>
      {code && (
        <div className="bp-drawer">
          <div className="bp-drawerhead"><div className="bp-selhead">{code.title} — line {code.line}</div><button className="btn ghost" onClick={() => setCode(null)}>✕ Close</button></div>
          <Code idx={idx} rel={code.rel} from={code.from} to={code.to} hl={code.line} />
        </div>
      )}
    </div>
  );
}

function WidgetPanel({ sel, node, render, entries, changes, traces, i18n, idx, cache, f, openFlow, startPlay, setCode, setSel }) {
  const [open, setOpen] = useState(null);
  const [story, setStory] = useState(null);
  const own = entries.filter((e) => e.group !== "arrival" && (e.widget === sel || e.widget.replace(/^this\.view\./, "") === sel));
  // containers around it that react to clicks (not claimed to fire: the code decides)
  const around = [];
  if (render) {
    let p = node && node.j && node.j.parent;
    const prefix = sel.includes(".") ? sel.slice(0, sel.lastIndexOf(".")) : "";
    let guard = 0;
    while (p && guard++ < 30) {
      const path = prefix ? `${prefix}.${p}` : p;
      for (const e of entries) if (e.widget === path) around.push({ e, holder: path });
      const pn = render.byPath.get(path) || render.byPath.get(p);
      p = pn && pn.j ? pn.j.parent : null;
    }
  }
  const ch = changes.get(sel) || [];
  const byEntry = new Map();
  for (const c of ch) { if (!byEntry.has(c.entry.id)) byEntry.set(c.entry.id, { e: c.entry, list: [] }); byEntry.get(c.entry.id).list.push(c); }
  useEffect(() => {
    let alive = true;
    if (!open) { setStory(null); return; }
    const e = entries.find((x) => x.id === open);
    cachedTrace(idx, cache, e, f).then((T) => alive && setStory({ e, T }));
    return () => { alive = false; };
  }, [open, entries, idx, cache, f]);
  const p = node ? node.p : null;
  const fr = node && node.frame;
  const textNow = p ? (p.textKey && i18n[p.textKey] != null ? i18n[p.textKey] : p.text) : null;
  return (
    <div className="pv-panel">
      <div className="pv-wtitle"><b className="mono">{sel}</b><span className="tag">{p ? p.wType : ""}{node && node.comp ? ` · component ${node.comp}` : ""}</span></div>
      {p && <div className="tag">{fr ? `${Math.round(fr.w)}×${Math.round(fr.h)} at ${Math.round(fr.x)},${Math.round(fr.y)} in its parent` : "not laid out at this state"}{p.isVisible ? "" : " · hidden at this state"}{textNow ? ` · “${String(textNow).slice(0, 60)}”` : ""}{p.textKey ? ` · ${p.textKey}` : ""}</div>}

      <h4>What clicking it does</h4>
      {!own.length ? <p className="tag">No action is wired to this widget itself{around.length ? "" : ", and none to the containers around it"}.</p> : own.map((e) => (
        <div key={e.id} className={"pv-act" + (open === e.id ? " on" : "")}>
          <div className="pv-acthead" onClick={() => setOpen(open === e.id ? null : e.id)}>
            <b className="mono">{e.event}</b> <span className="tag">{e.source}</span>
            <span className="tag">{traces && traces[e.id] ? `· ${traces[e.id].filter((w) => w.here).length} change(s) on this form${traces[e.id].some((w) => !w.here) ? `, ${traces[e.id].filter((w) => !w.here).length} on other forms` : ""}` : ""}</span>
          </div>
          <div className="pv-btns">
            <button className="btn" onClick={() => startPlay(e.id)}>▶ Play on preview</button>
            <button className="btn ghost" onClick={() => openFlow(e.id)}>Code flow →</button>
            <button className="btn ghost" onClick={() => setOpen(open === e.id ? null : e.id)}>{open === e.id ? "Hide steps" : "What happens"}</button>
          </div>
          {open === e.id && (story && story.e.id === e.id ? <FlowStory idx={idx} entry={e} T={story.T} /> : <p className="note">Tracing…</p>)}
        </div>
      ))}
      {around.length > 0 && (
        <>
          <div className="tag" style={{ marginTop: 6 }}>Actions on the containers that hold it (whether a click here reaches them depends on the code):</div>
          {around.slice(0, 8).map(({ e, holder }) => <div key={e.id} className="pv-around"><span className="mono">{holder}.{e.event}</span> <button className="btn ghost" onClick={() => setSel(e.widget)}>select</button> <button className="btn ghost" onClick={() => openFlow(e.id)}>flow →</button></div>)}
        </>
      )}

      <h4>When the code changes it</h4>
      {!traces ? <p className="note">Reading every flow of this form…</p> : !ch.length ? <p className="tag">No flow of this form changes it in a way the code names literally.</p> : [...byEntry.values()].map(({ e, list }) => (
        <div key={e.id} className="pv-chg">
          <div className="pv-chghead"><b className="mono">{e.label}</b> <button className="btn ghost" onClick={() => startPlay(e.id)}>▶ play</button></div>
          {list.slice(0, 12).map((c, i) => {
            const lit = literal(c.step, i18n);
            return (
              <div key={i} className="pv-chgrow" onClick={() => setCode({ rel: c.node.rel, from: c.node.line, to: c.node.end, line: c.step.line, title: `${c.node.clsLabel}.${c.node.name}` })}>
                <span className={"pv-pill " + (lit ? "lit" : "rt")}>{lit ? lit.label : "value at run time"}</span>
                <span className="tag">{stepText(c.step)} · {LAYER_LABEL[c.node.layer]} {c.node.clsLabel}.{c.node.name} · line {c.step.line}</span>
                {c.step.conds.length > 0 && <div className="bp-cond">only {c.step.conds[c.step.conds.length - 1]}</div>}
              </div>
            );
          })}
          {list.length > 12 && <div className="tag">+{list.length - 12} more</div>}
        </div>
      ))}
    </div>
  );
}
