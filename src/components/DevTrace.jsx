// Code flow breakdown · developer view: the traced flow as a step-through debugger. One list of steps (in the order the
// code runs them) drives four views — sequence diagram, call map, call tree and outline — plus a timeline scrubber and
// an inspector with the call stack and the code of the current step.
import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { LAYERS, LAYER_LABEL } from "../lib/blueprint";
import { FlowStory } from "./Blueprint";
import "./devtrace.css";

const nf = (n) => Number(n || 0).toLocaleString("en-US");
const short = (rel) => rel.split("/").slice(-2).join("/");
const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const LANE_SHORT = ["Form", "Controller", "Presentation", "Business", "Service"];
const LANE_ICON = ["▣", "⚙", "◆", "▤", "⛁"];
const KIND = {
  start: { label: "Start", cls: "start" }, self: { label: "Call", cls: "self" }, call: { label: "Call", cls: "call" },
  service: { label: "Service", cls: "service" }, return: { label: "Callback", cls: "return" }, nav: { label: "Navigate", cls: "nav" },
  widget: { label: "Screen", cls: "widget" }, ref: { label: "Repeat", cls: "ref" },
};
const fk = (n) => "f:" + n.id;

/* ---------------------------------------------------------------- the steps, in the order the code runs them */
function traceRows(entry, T, onlyEffect) {
  const rows = [], spans = [];
  const lane = (l) => Math.max(0, LAYERS.indexOf(l));
  const fr = (n) => ({ clsLabel: n.clsLabel, name: n.name, layer: n.layer, rel: n.rel, line: n.line });
  rows.push({ from: 0, to: lane(T.root.layer), label: entry.group === "arrival" ? entry.label : `${entry.label} — user / form event`, node: T.root, line: T.root.line, kind: "start", depth: 0, stack: [fr(T.root)], src: "trigger", dst: fk(T.root), ek: "start" });
  const seen = new Set(), stepOf = new Map([[T.root.uid, 1]]);
  const laneDepth = [0, 0, 0, 0, 0];
  const walk = (n, depth, stack) => {
    if (!n) return;
    const me = lane(n.layer);
    const mark = (why) => rows.push({ from: me, to: me, label: `${n.name}() — ${why}`, node: n, line: n.line, kind: "ref", mute: true, depth, stack, src: fk(n), dst: fk(n), ek: "ref:" + n.uid });
    if (n.ref) return mark(`same as step ${stepOf.get(n.ref) || "?"} above`);
    if (n.cycle) return mark("already running on this path (loop)");
    if (n.cut) return mark("stopped at the depth limit");
    if (seen.has(n.uid)) return;
    seen.add(n.uid);
    const startRow = rows.length - 1, off = laneDepth[me]++;
    const into = (child, d, st) => {
      if (!child) return;
      if (!stepOf.has(child.uid)) stepOf.set(child.uid, rows.length);
      walk(child, d, child.ref || child.cycle || child.cut ? st : [...st, fr(child)]);
    };
    for (const [ei, e] of n.edges.entries()) {
      if (onlyEffect && !e.effect) continue;
      const s = e.step;
      const base = { node: n, line: s.line, cond: s.conds[s.conds.length - 1], conds: s.conds, step: s, edge: e, depth, stack, src: fk(n), ek: n.uid + ":" + ei };
      const to = (child) => (child ? lane(child.layer) : me);
      switch (e.kind) {
        case "self": case "local":
          rows.push({ ...base, from: me, to: me, label: `${s.fn || s.name}()`, kind: "self", dst: e.child ? fk(e.child) : fk(n) }); into(e.child, depth + 1, stack); break;
        case "pc": case "bc": case "ctrl":
          rows.push({ ...base, from: me, to: to(e.child), label: e.kind === "ctrl" ? `${s.form}.${s.fn}()` : `${s.module}.${s.fn}()`, kind: "call", missing: e.missing, dst: e.child ? fk(e.child) : "x:" + s.fn });
          into(e.child, depth + 1, stack); break;
        case "service":
          rows.push({ ...base, from: me, to: 4, label: `${s.obj}.${s.verb}`, kind: "service", dst: `s:${s.obj}.${s.verb}` });
          for (const [j, r] of (e.returns || []).entries()) if (r.node) {
            rows.push({ ...base, ek: base.ek + ":r" + j, from: 4, to: lane(r.node.layer), label: `↩ answer → ${r.label}`, kind: "return", src: `s:${s.obj}.${s.verb}`, dst: fk(r.node), outcome: r.label });
            into(r.node, depth + 1, stack);
          }
          break;
        case "param":
          if (e.child) { rows.push({ ...base, from: me, to: to(e.child), label: `↩ ${s.name}() → ${e.child.clsLabel}.${e.child.name}`, kind: "return", dst: fk(e.child) }); into(e.child, depth + 1, stack); }
          else rows.push({ ...base, from: me, to: me, label: `↩ calls back ${s.name}() (given by its caller)`, kind: "self", mute: true, dst: fk(n) });
          break;
        case "updateForm": case "present":
          rows.push({ ...base, from: me, to: 1, label: `↩ ${e.kind === "present" ? "presentUserInterface" : "updateForm"} → ${e.target || "?"}.${e.child ? e.child.name : "?"}  {${s.keys ? s.keys.map((k) => k.key).join(", ") : "data"}}`, kind: "return", missing: e.missing, dst: e.child ? fk(e.child) : "x:" + (e.target || "form") });
          into(e.child, depth + 1, stack); break;
        case "nav": rows.push({ ...base, from: me, to: 0, label: `opens ${s.form || "(form chosen at run time)"}`, kind: "nav", dst: "nav:" + (s.form || "?") }); break;
        case "widget": rows.push({ ...base, from: me, to: 0, label: `${e.path || s.path || "(form)"} ${s.action}`, kind: "widget", dst: "screen" }); break;
        case "compEvent": rows.push({ ...base, from: me, to: 1, label: `↩ raises ${e.event}${e.child ? ` → ${e.child.clsLabel}.${e.child.name}` : " (not handled)"}`, kind: "return", dst: e.child ? fk(e.child) : "x:" + e.event }); into(e.child, depth + 1, stack); break;
        case "compCall": rows.push({ ...base, from: me, to: e.child ? lane(e.child.layer) : 1, label: `${e.comp}.${s.action}`, kind: "call", dst: e.child ? fk(e.child) : "c:" + e.comp }); into(e.child, depth + 1, stack); break;
        case "infoSet": rows.push({ ...base, from: me, to: me, label: `stores "${s.key || "?"}" (setCustomInfo)`, kind: "self", dst: fk(n) }); break;
        case "unresolved": rows.push({ ...base, from: me, to: me, label: `? ${s.what} — ${s.why}`, kind: "self", mute: true, dst: fk(n) }); break;
        default: break;
      }
    }
    laneDepth[me]--;
    spans.push({ lane: me, s: Math.max(0, startRow), e: rows.length - 1, off, uid: n.uid });
  };
  walk(T.root, 1, [fr(T.root)]);
  return { rows, spans };
}

function traceStats(rows) {
  const fns = new Set(), lanes = new Set();
  const per = [0, 0, 0, 0, 0];
  let services = 0, callbacks = 0, screen = 0, navs = 0, conds = 0, gaps = 0;
  for (const r of rows) {
    if (r.dst && r.dst.startsWith("f:")) fns.add(r.dst);
    lanes.add(r.from); lanes.add(r.to); per[r.to]++;
    if (r.kind === "service") services++;
    if (r.kind === "return") callbacks++;
    if (r.kind === "widget") screen++;
    if (r.kind === "nav") navs++;
    if (r.cond) conds++;
    if (r.missing || (r.mute && r.kind !== "ref")) gaps++;
  }
  return { fns: fns.size, lanes: lanes.size, per, services, callbacks, screen, navs, conds, gaps, steps: rows.length };
}

function useCountUp(target, ms = 700) {
  const [v, setV] = useState(0);
  useEffect(() => {
    let raf, t0;
    const tick = (t) => { if (t0 == null) t0 = t; const k = Math.min(1, (t - t0) / ms); setV(Math.round(target * (1 - Math.pow(1 - k, 3)))); if (k < 1) raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

/* ---------------------------------------------------------------- the whole developer view */
export function DevTrace({ idx, entry, T, focus, setFocus, onBack }) {
  const [onlyEffect, setOnlyEffect] = useState(true);
  const [view, setView] = useState(() => { try { return localStorage.getItem("rs.devview") || "seq"; } catch { return "seq"; } });
  const { rows, spans } = useMemo(() => traceRows(entry, T, onlyEffect), [entry, T, onlyEffect]);
  const stats = useMemo(() => traceStats(rows), [rows]);
  const [cur, setCur] = useState(null); // index of the current step; null = the whole flow at once
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [q, setQ] = useState("");
  const [inspector, setInspector] = useState(true);
  useEffect(() => { setCur(null); setPlaying(false); }, [rows]);
  useEffect(() => { try { localStorage.setItem("rs.devview", view); } catch { /* per-viewer convenience only */ } }, [view]);

  const last = rows.length - 1;
  useEffect(() => {
    if (!playing) return;
    if (cur != null && cur >= last) { setPlaying(false); return; }
    const t = setTimeout(() => setCur((c) => (c == null ? 0 : Math.min(last, c + 1))), (cur == null ? 250 : 1000) / speed);
    return () => clearTimeout(t);
  }, [playing, cur, last, speed]);

  const go = useCallback((i) => { setPlaying(false); setCur(i == null ? null : Math.max(0, Math.min(last, i))); }, [last]);
  const step = useCallback((d) => { setPlaying(false); setCur((c) => (c == null ? (d > 0 ? 0 : last) : Math.max(0, Math.min(last, c + d)))); }, [last]);
  const play = () => { if (playing) return setPlaying(false); if (cur == null || cur >= last) setCur(null); setPlaying(true); };
  const ql = q.trim().toLowerCase();
  const hits = useMemo(() => (ql ? rows.map((r, i) => (r.label.toLowerCase().includes(ql) || (r.node && `${r.node.clsLabel}.${r.node.name}`.toLowerCase().includes(ql)) ? i : -1)).filter((i) => i >= 0) : []), [rows, ql]);
  const hitSet = useMemo(() => new Set(hits), [hits]);
  const nextHit = (dir) => { if (!hits.length) return; const c = cur == null ? -1 : cur; const n = dir > 0 ? hits.find((i) => i > c) ?? hits[0] : [...hits].reverse().find((i) => i < c) ?? hits[hits.length - 1]; go(n); };

  useEffect(() => {
    const onKey = (ev) => {
      const tag = (ev.target && ev.target.tagName) || "";
      if (/INPUT|TEXTAREA|SELECT/.test(tag)) return;
      if (ev.key === " ") { ev.preventDefault(); setPlaying((p) => { if (!p && (cur == null || cur >= last)) setCur(null); return !p; }); }
      else if (ev.key === "ArrowRight" || ev.key === "j") { ev.preventDefault(); step(1); }
      else if (ev.key === "ArrowLeft" || ev.key === "k") { ev.preventDefault(); step(-1); }
      else if (ev.key === "Home") { ev.preventDefault(); go(0); }
      else if (ev.key === "End") { ev.preventDefault(); go(last); }
      else if (ev.key === "Escape") go(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cur, last, go, step]);

  const r = cur != null ? rows[cur] : null;
  const VIEWS = [["seq", "⇶", "Sequence"], ["map", "◇", "Call map"], ["tree", "⊢", "Call tree"], ["outline", "≡", "Outline"]];
  return (
    <div className="dv">
      <DevHeader entry={entry} T={T} stats={stats} onBack={onBack} />
      <div className="dv-toolbar">
        <div className="dv-views">
          {VIEWS.map(([k, ic, l]) => <button key={k} className={view === k ? "on" : ""} onClick={() => setView(k)}><span className="dv-vi">{ic}</span>{l}</button>)}
        </div>
        <button className={"dv-toggle" + (onlyEffect ? " on" : "")} onClick={() => setOnlyEffect((v) => !v)} title="Hide calls that never reach a service, a navigation or the screen">
          <span className="dv-sw" />Key steps only
        </button>
        <div className="dv-search">
          <input type="text" placeholder="Find a step, function or service…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") nextHit(e.shiftKey ? -1 : 1); }} />
          {ql && <span className="dv-hits">{hits.length ? `${hits.length} found` : "none"}</span>}
          {ql && hits.length > 0 && <><button onClick={() => nextHit(-1)} title="Previous (Shift+Enter)">↑</button><button onClick={() => nextHit(1)} title="Next (Enter)">↓</button></>}
        </div>
        <button className={"dv-toggle" + (inspector ? " on" : "")} onClick={() => setInspector((v) => !v)}><span className="dv-sw" />Inspector</button>
        <button className={"dv-toggle" + (focus ? " on" : "")} onClick={() => setFocus((v) => !v)} title="Hide the list of actions to give the trace more room"><span className="dv-sw" />Focus</button>
      </div>
      <Transport rows={rows} cur={cur} playing={playing} speed={speed} setSpeed={setSpeed} play={play} go={go} step={step} hitSet={hitSet} />
      <div className={"dv-body" + (inspector ? "" : " wide")}>
        <div className="dv-stage">
          {view === "seq" && <SeqView rows={rows} spans={spans} cur={cur} go={go} hitSet={hitSet} />}
          {view === "map" && <MapView rows={rows} cur={cur} go={go} hitSet={hitSet} />}
          {view === "tree" && <TreeView rows={rows} cur={cur} go={go} hitSet={hitSet} />}
          {view === "outline" && <div className="dv-outline"><FlowStory idx={idx} entry={entry} T={T} /></div>}
          {rows.length <= 1 && view !== "outline" && <div className="dv-emptynote">Nothing to draw with “Key steps only” on — this action reaches no service, navigation or screen change. Turn it off to see every call.</div>}
        </div>
        {inspector && <Inspector idx={idx} r={r} i={cur} rows={rows} stats={stats} T={T} go={go} />}
      </div>
    </div>
  );
}

function Stat({ n, label, tone, d }) {
  const v = useCountUp(n);
  return <div className={"dv-stat" + (tone ? " " + tone : "")} style={{ "--d": d + "ms" }}><b>{nf(v)}</b><span>{label}</span></div>;
}

function DevHeader({ entry, T, stats, onBack }) {
  const total = stats.per.reduce((a, b) => a + b, 0) || 1;
  return (
    <div className="dv-head">
      <div className="dv-headtop">
        <button className="dv-back" onClick={onBack}>← Story view</button>
        <div className="dv-headtitle">
          <div className="dv-kicker"><span className="dv-live" />Execution trace</div>
          <h3 className="mono">{entry.label}</h3>
          <div className="dv-root">enters <span className="mono">{T.root.clsLabel}.{T.root.name}()</span> · <span className="mono">{short(T.root.rel)}:{T.root.line}</span>{T.truncated ? <span className="dv-warnpill">depth limit reached on some paths</span> : null}</div>
        </div>
        <div className="dv-keys"><kbd>Space</kbd> play <kbd>←</kbd><kbd>→</kbd> step <kbd>Esc</kbd> overview</div>
      </div>
      <div className="dv-stats">
        <Stat n={stats.steps} label="steps" d={0} />
        <Stat n={stats.fns} label="functions" d={60} />
        <Stat n={stats.services} label="service calls" tone="svc" d={120} />
        <Stat n={stats.callbacks} label="callbacks" tone="ret" d={180} />
        <Stat n={stats.screen} label="screen updates" tone="scr" d={240} />
        <Stat n={stats.navs} label="navigations" tone="nav" d={300} />
        <Stat n={stats.conds} label="conditional" d={360} />
        {stats.gaps > 0 && <Stat n={stats.gaps} label="unresolved" tone="bad" d={420} />}
      </div>
      <div className="dv-ribbon" title="Where the steps land, by layer">
        {stats.per.map((n, i) => n > 0 && <div key={i} className={"dv-rseg l" + i} style={{ flexGrow: n, "--d": i * 90 + "ms" }}><span>{LANE_SHORT[i]} · {n}</span></div>)}
        {total === 0 && <div className="dv-rseg" />}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- transport: play controls + a scrubbable strip of every step */
function Transport({ rows, cur, playing, speed, setSpeed, play, go, step, hitSet }) {
  const strip = useRef(null);
  const [hover, setHover] = useState(null);
  const at = (ev) => { const b = strip.current.getBoundingClientRect(); return Math.max(0, Math.min(rows.length - 1, Math.floor(((ev.clientX - b.left) / b.width) * rows.length))); };
  const drag = (ev) => {
    go(at(ev));
    const move = (e) => go(at(e));
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  };
  const last = rows.length - 1;
  const pct = cur == null ? 100 : ((cur + 0.5) / rows.length) * 100;
  return (
    <div className="dv-transport">
      <div className="dv-tbtns">
        <button onClick={() => go(0)} title="First step (Home)">⏮</button>
        <button onClick={() => step(-1)} title="Previous step (←)">◀</button>
        <button className="dv-play" onClick={play} title="Play / pause (Space)">{playing ? "❚❚" : "▶"}</button>
        <button onClick={() => step(1)} title="Next step (→)">▶︎</button>
        <button onClick={() => go(last)} title="Last step (End)">⏭</button>
      </div>
      <div className="dv-pos mono">{cur == null ? <>all <b>{nf(rows.length)}</b></> : <><b>{nf(cur + 1)}</b> / {nf(rows.length)}</>}</div>
      <div className="dv-strip" ref={strip} onPointerDown={drag} onPointerMove={(e) => setHover(at(e))} onPointerLeave={() => setHover(null)}>
        <div className="dv-ticks">
          {rows.map((r, i) => <i key={i} className={`k-${r.kind}${cur != null && i <= cur ? " past" : ""}${hitSet.has(i) ? " hit" : ""}${r.cond ? " cond" : ""}`} />)}
        </div>
        <div className="dv-fill" style={{ width: pct + "%" }} />
        {cur != null && <div className="dv-head-mark" style={{ left: pct + "%" }} />}
        {hover != null && rows[hover] && <div className="dv-tip" style={{ left: ((hover + 0.5) / rows.length) * 100 + "%" }}><b>{hover + 1}.</b> {trunc(rows[hover].label, 60)}</div>}
      </div>
      <div className="dv-speed">{[0.5, 1, 2, 4].map((s) => <button key={s} className={speed === s ? "on" : ""} onClick={() => setSpeed(s)}>{s}×</button>)}</div>
      {cur != null && <button className="dv-overview" onClick={() => go(null)}>Show all</button>}
    </div>
  );
}

/* keeps the current step in view inside a scrolling stage */
function useFollow(ref, cur, sel = ".cur") {
  useEffect(() => {
    const box = ref.current;
    if (!box || cur == null) return;
    const el = box.querySelector(sel);
    if (!el) return;
    // bring the stage itself up under the pinned transport bar first
    const sb = box.getBoundingClientRect();
    if (sb.top > 170 || sb.bottom > window.innerHeight + 4) window.scrollBy({ top: sb.top - 150, behavior: "smooth" });
    const b = box.getBoundingClientRect(), e = el.getBoundingClientRect();
    const top = e.top - b.top + box.scrollTop, left = e.left - b.left + box.scrollLeft;
    if (e.top < b.top + 40 || e.bottom > b.bottom - 40) box.scrollTo({ top: top - b.height / 2 + e.height / 2, behavior: "smooth" });
    if (e.left < b.left || e.right > b.right) box.scrollTo({ left: left - b.width / 2 + e.width / 2, behavior: "smooth" });
  }, [ref, cur, sel]);
}

// the width of a scrolling stage, kept up to date as the window resizes
function useWidth(ref, min) {
  const [w, setW] = useState(min);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.max(min, el.clientWidth - 2)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, min]);
  return w;
}

/* ---------------------------------------------------------------- sequence diagram */
function SeqView({ rows, spans, cur, go, hitSet }) {
  const box = useRef(null);
  useFollow(box, cur);
  const W = useWidth(box, 620);
  const shown = rows.slice(0, 1500);
  const G = 46, LW = (W - G) / 5, RH = 34, TOP = 70;
  const X = [0, 1, 2, 3, 4].map((i) => G + LW * i + LW / 2);
  const H = TOP + shown.length * RH + 24;
  const y = (i) => TOP + i * RH + RH / 2;
  const curLanes = cur != null && rows[cur] ? new Set([rows[cur].from, rows[cur].to]) : null;
  const laneCount = [0, 0, 0, 0, 0];
  for (const r of rows) laneCount[r.to]++;
  const state = (i) => (cur == null ? "" : i < cur ? " past" : i === cur ? " cur" : " ahead");
  const act = (sp) => (cur == null || (sp.s <= cur && cur <= sp.e)) && sp.s < shown.length;
  const gx = (lane, off) => X[lane] + off * 6;
  return (
    <div className="dv-seqbox" ref={box}>
      <svg className="dv-seq" viewBox={`0 0 ${W} ${H}`} width={W} height={H}>
        <defs>
          {["n", "c", "s", "r", "w"].map((k) => (
            <marker key={k} id={"dvA" + k} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,1 L10,5 L0,9 z" className={"dv-ah " + k} /></marker>
          ))}
          <linearGradient id="dvLife" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="currentColor" stopOpacity=".45" /><stop offset="1" stopColor="currentColor" stopOpacity=".08" /></linearGradient>
          <filter id="dvGlow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
        </defs>
        {shown.map((_, i) => i % 2 === 1 && <rect key={"band" + i} x={0} y={y(i) - RH / 2} width={W} height={RH} className="dv-band" />)}
        {LAYERS.map((l, i) => (
          <g key={l} className={"dv-lane l" + i + (curLanes && curLanes.has(i) ? " live" : "")} style={{ "--d": i * 70 + "ms" }}>
            <line x1={X[i]} y1={TOP - 12} x2={X[i]} y2={H} className="dv-life" />
            <rect x={X[i] - LW / 2 + 10} y={8} width={LW - 20} height={44} rx={12} className="dv-lanecard" />
            <rect x={X[i] - LW / 2 + 10} y={8} width={5} height={44} rx={2} className="dv-lanebar" />
            <text x={X[i] - LW / 2 + 28} y={27} className="dv-laneico">{LANE_ICON[i]}</text>
            <text x={X[i] - LW / 2 + 46} y={27} className="dv-lanet">{LANE_SHORT[i]}</text>
            <text x={X[i] - LW / 2 + 46} y={43} className="dv-lanes">{LAYER_LABEL[l].replace(/^.*\(|\)$/g, "").replace("Model / service", "model / service")} · {laneCount[i]}</text>
          </g>
        ))}
        {spans.filter(act).map((sp) => (
          <rect key={"sp" + sp.uid} x={gx(sp.lane, Math.min(sp.off, 3)) - 4} y={y(sp.s) - 6} width={8} height={Math.max(14, (Math.min(sp.e, shown.length - 1) - sp.s) * RH + 12)} rx={3} className={"dv-act l" + sp.lane} />
        ))}
        {shown.map((r, i) => {
          const cls = `dv-msg k-${r.kind}${r.mute ? " mute" : ""}${r.missing ? " miss" : ""}${hitSet.has(i) ? " hit" : ""}${state(i)}`;
          const yy = y(i), d = cur == null ? Math.min(i, 40) * 28 : 0;
          const mk = { call: "c", self: "n", service: "s", return: "r", widget: "w", nav: "w", start: "n", ref: "n" }[r.kind] || "n";
          const num = <text x={G - 10} y={yy + 4} textAnchor="end" className="dv-num">{i + 1}</text>;
          const cond = r.cond ? <g className="dv-cond"><rect x={6} y={yy - 5} width={10} height={10} transform={`rotate(45 11 ${yy})`} /><title>only {r.cond}</title></g> : null;
          const hit = <rect x={0} y={yy - RH / 2} width={W} height={RH} className="dv-hit" />;
          if (r.from === r.to) {
            const x = X[r.from] + 5;
            return (
              <g key={i + (i === cur ? ":" + cur : "")} className={cls} onClick={() => go(i)} style={{ "--d": d + "ms" }}>
                {hit}{num}{cond}
                <g className="dv-draw"><path d={`M${x},${yy - 7} h22 a6,6 0 0 1 0,14 h-20`} className="dv-line" markerEnd={`url(#dvA${mk})`} /></g>
                <text x={x + 36} y={yy + 4} className="dv-ml">{trunc(r.label, Math.round((W - x - 40) / 6.8))}</text>
                {i === cur && <circle r={4} className="dv-packet loop" style={{ "--x1": x + "px", "--y1": yy - 7 + "px" }} />}
              </g>
            );
          }
          const x1 = X[r.from] + (r.to > r.from ? 5 : -5), x2 = X[r.to] + (r.to > r.from ? -6 : 6);
          const rtl = r.to < r.from, lx = Math.min(x1, x2);
          const span = Math.abs(x2 - x1);
          return (
            <g key={i + (i === cur ? ":" + cur : "")} className={cls} onClick={() => go(i)} style={{ "--d": d + "ms" }}>
              {hit}{num}{cond}
              <g className={"dv-draw" + (rtl ? " rtl" : "")}><line x1={x1} y1={yy + 5} x2={x2} y2={yy + 5} className="dv-line" markerEnd={`url(#dvA${mk})`} /></g>
              {r.kind === "service" && <rect x={x2 - 70} y={yy - 13} width={60} height={13} rx={6.5} className="dv-svcpill" />}
              {r.kind === "service" && <text x={x2 - 40} y={yy - 3.5} textAnchor="middle" className="dv-svcpt">SERVICE</text>}
              <text x={lx + 8} y={yy - 2} className="dv-ml">{trunc(r.label, r.kind === "service" ? Math.max(16, Math.round((x2 - 80 - lx - 8) / 6.9)) : Math.max(24, Math.round((W - lx - 16) / 6.9)))}{r.missing ? " — missing" : ""}</text>
              {i === cur && <circle r={5} className="dv-packet" filter="url(#dvGlow)" style={{ "--x1": x1 + "px", "--x2": x2 + "px", "--y1": yy + 5 + "px" }} />}
            </g>
          );
        })}
      </svg>
      {rows.length > 1500 && <p className="tag" style={{ padding: "0 12px 10px" }}>First 1,500 steps drawn. The call tree shows the rest.</p>}
    </div>
  );
}

/* ---------------------------------------------------------------- call map: each function once, every hop between them */
function mapModel(rows) {
  const nodes = new Map(), edges = new Map();
  const put = (key, lane, r, i, isDst) => {
    if (!nodes.has(key)) {
      let title = key, sub = "";
      if (key === "trigger") { title = r.label.split(" — ")[0]; sub = "trigger"; }
      else if (key === "screen") { title = "Screen widgets"; sub = "updated from code"; }
      else if (key.startsWith("nav:")) { title = key.slice(4); sub = "opens form"; }
      else if (key.startsWith("s:")) { title = key.slice(2); sub = r.step && r.step.svcKind ? r.step.svcKind + " service" : "service"; }
      else if (key.startsWith("x:") || key.startsWith("c:")) { title = key.slice(2); sub = "not resolved"; }
      else {
        const n = isDst ? findNode(r) : r.node;
        const [fn, via] = n ? n.name.split(" › ") : [key];
        title = n ? fn + "()" : key; sub = n ? (via ? `› ${via} · ${n.clsLabel}` : n.clsLabel) : "";
      }
      nodes.set(key, { key, lane, title, sub, first: i, steps: [], order: nodes.size, file: null });
    }
    const n = nodes.get(key);
    n.steps.push(i);
    return n;
  };
  for (const [i, r] of rows.entries()) {
    if (!r.src || !r.dst) continue;
    const a = put(r.src, r.from, r, i, false), b = put(r.dst, r.to, r, i, true);
    if (!a.file && r.node && r.src === fk(r.node)) a.file = r.node;
    const k = r.src + "→" + r.dst;
    if (!edges.has(k)) edges.set(k, { k, a: r.src, b: r.dst, kind: r.kind, steps: [] });
    edges.get(k).steps.push(i);
  }
  return { nodes, edges };
}
// the trace node a step leads into (for a function the step enters)
function findNode(r) {
  const e = r.edge;
  if (!e) return r.node;
  if (r.kind === "return" && e.returns) { const x = e.returns.find((q) => q.node && fk(q.node) === r.dst); if (x) return x.node; }
  return e.child || r.node;
}

function MapView({ rows, cur, go, hitSet }) {
  const box = useRef(null);
  useFollow(box, cur, ".dv-mnode.cur");
  const { nodes, edges } = useMemo(() => mapModel(rows), [rows]);
  const [hover, setHover] = useState(null);
  const BW = useWidth(box, 860);
  const PADX = 12, CW = (BW - PADX * 2) / 5, NW = CW - 34, NH = 46, GAP = 14, TOP = 64;
  const chars = (n) => Math.max(12, Math.floor((NW - (n.steps.length > 1 ? 44 : 20)) / 6.8));
  const cols = [[], [], [], [], []];
  for (const n of [...nodes.values()].sort((a, b) => a.first - b.first)) cols[n.lane].push(n);
  const pos = new Map();
  cols.forEach((c, li) => c.forEach((n, j) => pos.set(n.key, { x: PADX + li * CW + (CW - NW) / 2, y: TOP + j * (NH + GAP), lane: li })));
  const W = PADX * 2 + CW * 5, H = TOP + Math.max(1, ...cols.map((c) => c.length)) * (NH + GAP) + 30;
  const r = cur != null ? rows[cur] : null;
  const curEdge = r ? r.src + "→" + r.dst : null;
  const reached = useMemo(() => { if (cur == null) return null; const s = new Set(); for (let i = 0; i <= cur; i++) { s.add(rows[i].src); s.add(rows[i].dst); } return s; }, [rows, cur]);
  const near = hover ? new Set([...edges.values()].filter((e) => e.a === hover || e.b === hover).flatMap((e) => [e.a, e.b])) : null;
  const path = (e) => {
    const p = pos.get(e.a), q = pos.get(e.b);
    if (!p || !q) return "";
    if (e.a === e.b) { const x = p.x + NW, yy = p.y + NH / 2; return `M${x},${yy - 8} C${x + 34},${yy - 26} ${x + 34},${yy + 26} ${x},${yy + 8}`; }
    if (p.lane === q.lane) { const x = p.x + NW, y1 = p.y + NH / 2, y2 = q.y + NH / 2, bend = 30 + Math.min(60, Math.abs(y2 - y1) / 6); return `M${x},${y1} C${x + bend},${y1} ${x + bend},${y2} ${x},${y2}`; }
    const fw = q.lane > p.lane;
    const x1 = fw ? p.x + NW : p.x, x2 = fw ? q.x : q.x + NW, y1 = p.y + NH / 2 + (fw ? -5 : 5), y2 = q.y + NH / 2 + (fw ? -5 : 5), dx = Math.max(40, Math.abs(x2 - x1) * 0.45) * (fw ? 1 : -1);
    return `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
  };
  return (
    <div className="dv-mapbox" ref={box}>
      <svg className="dv-map" viewBox={`0 0 ${W} ${H}`} width={W} height={H}>
        <defs>
          {["n", "c", "s", "r", "w"].map((k) => (
            <marker key={k} id={"dvM" + k} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,1 L10,5 L0,9 z" className={"dv-ah " + k} /></marker>
          ))}
        </defs>
        {LAYERS.map((l, i) => (
          <g key={l} className={"dv-mcol l" + i}>
            <rect x={PADX + i * CW + 6} y={6} width={CW - 12} height={H - 12} rx={16} className="dv-mcolbg" />
            <text x={PADX + i * CW + CW / 2} y={32} textAnchor="middle" className="dv-mcolt">{LANE_ICON[i]}  {LANE_SHORT[i]}</text>
            <text x={PADX + i * CW + CW / 2} y={48} textAnchor="middle" className="dv-lanes">{cols[i].length} {cols[i].length === 1 ? "node" : "nodes"}</text>
          </g>
        ))}
        {[...edges.values()].map((e, j) => {
          const d = path(e);
          const on = e.k === curEdge, seen = !reached || (reached.has(e.a) && reached.has(e.b) && e.steps[0] <= cur);
          const dim = (near && !(near.has(e.a) && near.has(e.b) && (e.a === hover || e.b === hover))) || !seen;
          const mk = { call: "c", service: "s", return: "r", widget: "w", nav: "w" }[e.kind] || "n";
          return (
            <g key={e.k + (on ? ":" + cur : "")} className={`dv-medge k-${e.kind}${on ? " on" : ""}${dim ? " dim" : ""}`} style={{ "--d": Math.min(j, 50) * 22 + 200 + "ms" }} onClick={() => go(e.steps[0])}>
              <path d={d} className="dv-mhit" />
              <path d={d} pathLength="1" className="dv-mline" markerEnd={`url(#dvM${mk})`} />
              {e.steps.length > 1 && <MidLabel d={d} text={"×" + e.steps.length} />}
              {on && <Packet d={d} />}
            </g>
          );
        })}
        {[...nodes.values()].map((n) => {
          const p = pos.get(n.key);
          const isCur = r && (r.dst === n.key);
          const isSrc = r && r.src === n.key;
          const dim = (reached && !reached.has(n.key)) || (near && !near.has(n.key));
          return (
            <g key={n.key} className={`dv-mnode l${n.lane}${isCur ? " cur" : ""}${isSrc ? " src" : ""}${dim ? " dim" : ""}${n.steps.some((i) => hitSet.has(i)) ? " hit" : ""}`} style={{ "--d": Math.min(n.order, 40) * 30 + "ms" }}
              transform={`translate(${p.x},${p.y})`} onMouseEnter={() => setHover(n.key)} onMouseLeave={() => setHover(null)} onClick={() => go(n.steps[0])}>
              <rect width={NW} height={NH} rx={10} className="dv-mcard" />
              <rect width={4} height={NH - 16} x={0} y={8} rx={2} className="dv-mbar" />
              <text x={14} y={20} className="dv-mt">{trunc(n.title, chars(n))}</text>
              <text x={14} y={36} className="dv-ms">{trunc(n.sub, Math.round(chars(n) * 1.2))}</text>
              {n.steps.length > 1 && <g transform={`translate(${NW - 30},12)`}><rect width={22} height={16} rx={8} className="dv-mcount" /><text x={11} y={11.5} textAnchor="middle" className="dv-mcountt">{n.steps.length}</text></g>}
              <title>{n.title}{n.sub ? " · " + n.sub : ""} — used in {n.steps.length} step{n.steps.length === 1 ? "" : "s"} (first: step {n.first + 1})</title>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
function MidLabel({ d, text }) {
  const ref = useRef(null);
  const [pt, setPt] = useState(null);
  useEffect(() => { const p = ref.current; if (p) { const L = p.getTotalLength(); const q = p.getPointAtLength(L / 2); setPt({ x: q.x, y: q.y }); } }, [d]);
  return <><path ref={ref} d={d} style={{ display: "none" }} />{pt && <g className="dv-mid"><rect x={pt.x - 13} y={pt.y - 8} width={26} height={16} rx={8} /><text x={pt.x} y={pt.y + 4} textAnchor="middle">{text}</text></g>}</>;
}
// a glowing dot that travels along a path
function Packet({ d, ms = 700 }) {
  const path = useRef(null), dot = useRef(null), trail = useRef(null);
  useEffect(() => {
    const p = path.current;
    if (!p) return;
    const L = p.getTotalLength();
    let raf, t0;
    const tick = (t) => {
      if (t0 == null) t0 = t;
      const k = Math.min(1, (t - t0) / ms), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      const q = p.getPointAtLength(L * e);
      if (dot.current) { dot.current.setAttribute("cx", q.x); dot.current.setAttribute("cy", q.y); }
      if (trail.current) { const t2 = p.getPointAtLength(Math.max(0, L * e - 26)); trail.current.setAttribute("cx", t2.x); trail.current.setAttribute("cy", t2.y); }
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [d, ms]);
  return <><path ref={path} d={d} style={{ display: "none" }} /><circle ref={trail} r={3} className="dv-trail" /><circle ref={dot} r={5.5} className="dv-dot" /></>;
}

/* ---------------------------------------------------------------- call tree: the same steps, nested by who calls whom */
function TreeView({ rows, cur, go, hitSet }) {
  const box = useRef(null);
  useFollow(box, cur);
  const [closed, setClosed] = useState(() => new Set());
  useEffect(() => setClosed(new Set()), [rows]);
  const hasKids = (i) => i + 1 < rows.length && rows[i + 1].depth > rows[i].depth;
  const vis = [];
  let hideBelow = null;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (hideBelow != null) { if (r.depth > hideBelow) continue; hideBelow = null; }
    vis.push(i);
    if (closed.has(i) && hasKids(i)) hideBelow = r.depth;
  }
  // a collapsed branch that holds the current step opens itself
  useEffect(() => {
    if (cur == null) return;
    const open = [];
    for (const c of closed) if (c < cur) { let j = c + 1; while (j < rows.length && rows[j].depth > rows[c].depth) j++; if (cur < j) open.push(c); }
    if (open.length) setClosed((s) => { const n = new Set(s); open.forEach((c) => n.delete(c)); return n; });
  }, [cur]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (i) => setClosed((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; });
  const all = (open) => setClosed(open ? new Set() : new Set(rows.map((_, i) => i).filter((i) => hasKids(i) && rows[i].depth >= 1)));
  return (
    <div className="dv-treebox" ref={box}>
      <div className="dv-treebar"><button onClick={() => all(true)}>Expand all</button><button onClick={() => all(false)}>Collapse all</button><span className="tag">{nf(vis.length)} of {nf(rows.length)} steps visible</span></div>
      {vis.map((i, k) => {
        const r = rows[i];
        const kid = hasKids(i);
        const st = cur == null ? "" : i < cur ? " past" : i === cur ? " cur" : " ahead";
        return (
          <div key={i} className={`dv-trow k-${r.kind}${r.mute ? " mute" : ""}${hitSet.has(i) ? " hit" : ""}${st}`} style={{ "--depth": r.depth, "--d": Math.min(k, 40) * 14 + "ms" }} onClick={() => go(i)}>
            <span className="dv-guides">{Array.from({ length: r.depth }, (_, g) => <i key={g} />)}</span>
            {kid ? <button className={"dv-ttog" + (closed.has(i) ? "" : " open")} onClick={(e) => { e.stopPropagation(); toggle(i); }}>▸</button> : <span className="dv-ttog none" />}
            <span className={"dv-tdot l" + r.to} />
            <span className="dv-tnum mono">{i + 1}</span>
            <span className={"dv-badge k-" + r.kind}>{(KIND[r.kind] || KIND.self).label}</span>
            <span className="dv-tlabel mono">{r.label}</span>
            {r.cond && <span className="dv-tcond" title={r.cond}>if</span>}
            <span className="dv-tloc mono">{r.node ? `${short(r.node.rel)}:${r.line}` : ""}</span>
          </div>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------- inspector: the current step, its call stack and its code */
function Inspector({ idx, r, i, rows, stats, T, go }) {
  if (!r) {
    return (
      <aside className="dv-insp">
        <div className="dv-ihead"><span className="dv-ikick">Inspector</span></div>
        <div className="dv-iempty">
          <div className="dv-iglyph">⌖</div>
          <b>Step through the flow</b>
          <span>Press <kbd>Space</kbd> to play it from the start, or click any step to see its call stack and its code here.</span>
          <button className="dv-ibtn" onClick={() => go(0)}>Start at step 1 →</button>
        </div>
        <div className="dv-legend">
          {[["call", "Call into another layer"], ["self", "Call in the same class"], ["service", "Request to a service"], ["return", "Callback / data back"], ["widget", "Screen or navigation"], ["ref", "Repeat / not followed"]].map(([k, l]) => <div key={k}><span className={"dv-lsw k-" + k} />{l}</div>)}
          <div><span className="dv-lsw cond" />Runs only under a condition</div>
        </div>
        <div className="dv-ifoot mono">{short(T.root.rel)} · {nf(stats.fns)} functions · {nf(stats.steps)} steps</div>
      </aside>
    );
  }
  const k = KIND[r.kind] || KIND.self;
  const n = r.node;
  return (
    <aside className="dv-insp" key={i}>
      <div className="dv-ihead">
        <span className="dv-ikick">Step {i + 1} of {rows.length}</span>
        <span className={"dv-badge k-" + r.kind}>{k.label}</span>
        <div className="dv-inav"><button onClick={() => go(i - 1)} disabled={i === 0}>‹</button><button onClick={() => go(i + 1)} disabled={i === rows.length - 1}>›</button></div>
      </div>
      <div className="dv-ilabel mono">{r.label}</div>
      <div className="dv-ihop">
        <span className={"dv-lchip l" + r.from}>{LANE_SHORT[r.from]}</span>
        <span className="dv-iarrow"><i /></span>
        <span className={"dv-lchip l" + r.to}>{LANE_SHORT[r.to]}</span>
      </div>
      {r.conds && r.conds.length > 0 && (
        <div className="dv-icond"><b>Runs only</b>{r.conds.map((c, j) => <div key={j} className="mono">{c}</div>)}</div>
      )}
      {r.missing && <div className="dv-icond bad"><b>Missing</b><div>{r.missing}</div></div>}
      <div className="dv-isec">Call stack</div>
      <ol className="dv-stack">
        {[...r.stack].reverse().map((f, j) => (
          <li key={j} className={j === 0 ? "top" : ""}><span className={"dv-tdot l" + Math.max(0, LAYERS.indexOf(f.layer))} /><span className="mono">{f.clsLabel}.{f.name}()</span><span className="dv-sloc mono">{short(f.rel)}:{f.line}</span></li>
        ))}
      </ol>
      {n && <>
        <div className="dv-isec">Code · <span className="mono">{short(n.rel)}</span> line {r.line}</div>
        <DvCode idx={idx} rel={n.rel} from={n.line} to={n.end} hl={r.line} />
      </>}
    </aside>
  );
}

function DvCode({ idx, rel, from, to, hl }) {
  const [lines, setLines] = useState(null);
  const ref = useRef(null);
  useEffect(() => { let alive = true; setLines(null); idx.read(rel).then((t) => alive && setLines((t || "").split("\n"))); return () => { alive = false; }; }, [idx, rel]);
  useEffect(() => {
    const box = ref.current;
    if (!box) return;
    const el = box.querySelector(".hl");
    if (el) box.scrollTo({ top: el.offsetTop - box.clientHeight / 2 + 10, behavior: "smooth" });
  }, [lines, hl, from]);
  if (!lines) return <div className="dv-code"><div className="dv-codeload" /></div>;
  const a = Math.max(1, from), b = Math.min(lines.length, to || from + 40);
  return (
    <div className="dv-code" ref={ref}>
      {lines.slice(a - 1, b).map((l, j) => <div key={j} className={"dv-cl" + (a + j === hl ? " hl" : "")}><span>{a + j}</span><code>{l || " "}</code></div>)}
    </div>
  );
}
