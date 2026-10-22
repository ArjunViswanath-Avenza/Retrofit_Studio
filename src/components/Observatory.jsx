// Observatory: the whole project as a sky. Galaxies = modules (or micro apps), solar systems = forms; a camera flies
// from the sky into a galaxy and into one solar system (the form as a sun, its controller, components and the
// presentation / business code it calls in orbit, services as far stars) and back out. Links: navigation, shared
// components, code calls into other galaxies.
import { useState, useEffect, useMemo, useRef, useCallback, memo } from "react";
import { surveyForm, linksOf, galaxyOf } from "../lib/observatory";
import "./observatory.css";

const nf = (n) => Number(n || 0).toLocaleString("en-US");
const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0) / 4294967296; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lastSeg = (ns) => (ns || "").split(".").pop();
const KIND_LABEL = { nav: "Navigation", comp: "Shared components", call: "Code calls" };

export const OB_MENU = [
  { id: "ob-sky", ico: "✦", label: "Sky", desc: "Galaxies, solar systems, every connection" },
  { id: "ob-catalogue", ico: "☰", label: "Star catalogue", desc: "Every galaxy and system, searchable" },
];

/* ================================================================ upload */
export function ObservatoryUpload({ pick, onFolder, ch, setCh, go, busy }) {
  const chans = pick ? Object.keys(pick.channels) : [];
  return (
    <div>
      <h2 className="page">✦ Observatory · the whole project as a sky</h2>
      <div className="crumb">Pick one folder: a monolith, a single micro app, or a micro-app project (a folder of micro apps). Everything is read in your browser.</div>
      <div className="rules">
        Every <b>module</b> (or <b>micro app</b>) becomes a <b>galaxy</b> and every <b>form</b> a <b>solar system</b> — the form is the sun, its controller,
        components and the presentation / business code it calls are in orbit, and the services it reaches are far stars. Lines between them show
        <b> navigation</b>, <b>shared components</b> and <b>code calls</b> into other galaxies. Click a galaxy to fly in, click a solar system to land, click empty space to fly back out.
      </div>
      <div className="folders" style={{ gridTemplateColumns: "1fr" }}>
        <div className={"folder" + (pick && pick.projects.length ? " filled" : "")}>
          <h3>Project folder</h3>
          <div className="cnt">{pick ? nf(pick.projects.length) : 0}</div>
          <div className="cl">{pick && pick.kind === "microapps" ? "micro apps" : "project"}</div>
          <label className="pick">Choose folder
            <input type="file" webkitdirectory="" directory="" multiple style={{ display: "none" }} onChange={(e) => onFolder(e.target.files)} />
          </label>
          {pick && (pick.projects.length ? <div className="sub2"><b>{pick.name}</b> · {pick.kind === "microapps" ? `micro-app project: ${pick.projects.map((p) => p.name).slice(0, 6).join(", ")}${pick.projects.length > 6 ? "…" : ""}` : "one Visualizer project"}</div>
            : <div className="sub2 bp-warn">No projectProperties.json found — is this a Visualizer project?</div>)}
        </div>
      </div>
      {chans.length > 0 && (
        <>
          <div className="tag" style={{ margin: "12px 0 6px" }}>Channel</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{chans.map((c) => <button key={c} className={"btn" + (ch === c ? "" : " ghost")} onClick={() => setCh(c)}>{c} · {nf(pick.channels[c])} forms</button>)}</div>
        </>
      )}
      <button className="btn" style={{ marginTop: 18 }} disabled={!pick || !pick.projects.length || !ch || busy} onClick={go}>{busy ? "Mapping the sky…" : "Open the Observatory →"}</button>
    </div>
  );
}

/* ================================================================ layout: galaxies, quasars, systems */
function layoutSky(U) {
  const lit = U.galaxies.filter((g) => g.systems.length).sort((a, b) => b.systems.length - a.systems.length || a.name.localeCompare(b.name));
  const dark = U.galaxies.filter((g) => !g.systems.length).sort((a, b) => a.name.localeCompare(b.name));
  const G = new Map();
  const Rof = (g) => 70 + 24 * Math.sqrt(g.systems.length);
  const avg = lit.reduce((s, g) => s + Rof(g), 0) / (lit.length || 1);
  lit.forEach((g, i) => { const a = i * 2.399963, d = Math.sqrt(i) * avg * 1.6; G.set(g.id, { x: d * Math.cos(a), y: d * Math.sin(a) * 0.8, R: Rof(g), hue: Math.round((i * 137.508 + 205) % 360), i, dark: false }); });
  const arr = lit.map((g) => G.get(g.id));
  for (let it = 0; it < 260; it++) {
    for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) {
      const a = arr[i], b = arr[j], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1, min = a.R + b.R + 150;
      if (d < min) { const p = (min - d) / 2, ux = dx / d, uy = dy / d; a.x -= ux * p; a.y -= uy * p; b.x += ux * p; b.y += uy * p; }
    }
    for (const a of arr) { a.x *= 0.996; a.y *= 0.996; }
  }
  const ext = arr.reduce((m, a) => Math.max(m, Math.hypot(a.x, a.y) + a.R), 200);
  dark.forEach((g, i) => {
    const a = (i / Math.max(1, dark.length)) * Math.PI * 2 + 0.35, ring = ext + 190 + (i % 2) * 70;
    G.set(g.id, { x: ring * Math.cos(a), y: ring * Math.sin(a) * 0.82, R: clamp(16 + 3 * Math.sqrt(g.pc + g.bc), 16, 34), hue: 200, i: lit.length + i, dark: true });
  });
  const S = new Map();
  for (const g of lit) {
    const p = G.get(g.id);
    const list = g.systems.map((id) => U.sysById.get(id)).sort((a, b) => b.files - a.files || a.name.localeCompare(b.name));
    const n = list.length, arms = n > 14 ? 3 : 2;
    list.forEach((s, i) => {
      const t = (i + 0.6) / n, arm = i % arms;
      const th = (arm * 2 * Math.PI) / arms + t * 2.3 * Math.PI + (hash(s.id) - 0.5) * 0.55;
      const rad = p.R * (0.15 + 0.8 * Math.pow(t, 0.85)) + (hash(s.id + "r") - 0.5) * p.R * 0.07;
      S.set(s.id, { x: p.x + rad * Math.cos(th), y: p.y + rad * Math.sin(th), r: clamp(2.6 + 1.5 * Math.log2(1 + s.files / 6), 2.6, 8), g: g.id, tw: hash(s.id + "t") });
    });
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of G.values()) { minX = Math.min(minX, p.x - p.R); maxX = Math.max(maxX, p.x + p.R); minY = Math.min(minY, p.y - p.R); maxY = Math.max(maxY, p.y + p.R); }
  return { G, S, bounds: { minX, maxX, minY, maxY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, w: maxX - minX, h: maxY - minY } };
}
// spiral arms of a galaxy, as paths
function armPaths(p, arms, seed) {
  const out = [];
  for (let a = 0; a < arms; a++) {
    const pts = [];
    for (let k = 0; k <= 26; k++) { const t = k / 26, th = (a * 2 * Math.PI) / arms + t * 2.3 * Math.PI + seed, r = p.R * (0.1 + 0.92 * Math.pow(t, 0.85)); pts.push([p.x + r * Math.cos(th), p.y + r * Math.sin(th)]); }
    out.push("M" + pts.map((q) => q[0].toFixed(1) + "," + q[1].toFixed(1)).join(" L"));
  }
  return out;
}
const curve = (a, b, bend = 0.18) => { const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, dx = b.x - a.x, dy = b.y - a.y; return `M${a.x},${a.y} Q${mx - dy * bend},${my + dx * bend} ${b.x},${b.y}`; };

/* ================================================================ the workspace: survey runner + views */
export function ObservatoryWorkspace({ U, nav, setNav }) {
  const surveys = useRef(new Map());
  const prio = useRef([]);
  const [ver, setVer] = useState(0);
  const [done, setDone] = useState(0);
  const [running, setRunning] = useState(true);
  const [fly, setFly] = useState(null); // a focus request from the catalogue
  // read every form in the background; a form the user lands on jumps the queue
  useEffect(() => {
    if (!running) return;
    let alive = true;
    (async () => {
      const queue = U.systems.map((s) => s.id);
      let n = 0;
      while (alive) {
        const urgent = prio.current.shift();
        const id = urgent || queue.find((x) => !surveys.current.has(x));
        if (!id) break;
        if (!surveys.current.has(id)) {
          try { surveys.current.set(id, await surveyForm(U, U.sysById.get(id))); } catch { surveys.current.set(id, { comps: [], calls: [], navs: [], services: [], ctrlCalls: [], actions: 0, ctrl: null, reached: new Map(), failed: true }); }
          n++;
          if (n % 6 === 0 || urgent) { setVer((v) => v + 1); setDone(surveys.current.size); await new Promise((r) => setTimeout(r)); }
        }
      }
      if (alive) { setVer((v) => v + 1); setDone(surveys.current.size); setRunning(false); }
    })();
    return () => { alive = false; };
  }, [U, running]);
  const ensure = useCallback((id) => { if (!surveys.current.has(id)) { prio.current.unshift(id); if (!running) setRunning(true); } }, [running]);
  const L = useMemo(() => linksOf(U, surveys.current), [U, ver]); // eslint-disable-line react-hooks/exhaustive-deps
  const lay = useMemo(() => layoutSky(U), [U]);
  const scan = { done, total: U.systems.length, running };
  return (
    <>
      <div style={{ display: nav === "ob-sky" ? "block" : "none" }}><Sky U={U} L={L} lay={lay} surveys={surveys.current} ver={ver} ensure={ensure} scan={scan} fly={fly} setFly={setFly} active={nav === "ob-sky"} /></div>
      {nav === "ob-catalogue" && <Catalogue U={U} L={L} surveys={surveys.current} ver={ver} scan={scan} go={(f) => { setFly({ ...f, t: Date.now() }); setNav("ob-sky"); }} />}
    </>
  );
}

/* ================================================================ the sky */
function Sky({ U, L, lay, surveys, ver, ensure, scan, fly, setFly, active }) {
  const box = useRef(null), svg = useRef(null), mini = useRef(null);
  const cam = useRef({ x: lay.bounds.cx, y: lay.bounds.cy, w: lay.bounds.w * 0.12 });
  const size = useRef({ w: 1000, h: 600 });
  const anim = useRef(null);
  const drag = useRef(null), moved = useRef(false);
  const [focus, setFocus] = useState({ level: "sky", g: null, s: null });
  const [hover, setHover] = useState(null); // galaxy or system id
  const [sel, setSel] = useState(null); // a body in the focused solar system
  const [show, setShow] = useState({ nav: true, comp: true, call: true, managers: false, labels: true, motion: true, panel: true });
  const [q, setQ] = useState("");

  const applyCam = useCallback(() => {
    const el = svg.current;
    if (!el) return;
    const { x, y, w } = cam.current, h = (w * size.current.h) / size.current.w;
    el.setAttribute("viewBox", `${x - w / 2} ${y - h / 2} ${w} ${h}`);
    el.style.setProperty("--k", String(w / size.current.w));
    if (mini.current) { mini.current.setAttribute("x", x - w / 2); mini.current.setAttribute("y", y - h / 2); mini.current.setAttribute("width", w); mini.current.setAttribute("height", h); }
  }, []);
  const panelOpen = useRef(true);
  useEffect(() => { panelOpen.current = show.panel; }, [show.panel]);
  // frame a body in the part of the screen the details panel does not cover
  const target = useCallback((f) => {
    const W = size.current.w, H = size.current.h, avail = Math.max(320, W - (panelOpen.current && W > 900 ? 370 : 0));
    const fit = (cx, cy, hw, hh) => { const wa = Math.max(hw * 2, (hh * 2 * avail) / H), w = (wa * W) / avail; return { x: cx + ((W - avail) / 2) * (w / W), y: cy, w }; };
    if (f.level === "system") { const p = lay.S.get(f.s); return fit(p.x, p.y, 74, 70); }
    if (f.level === "galaxy") { const p = lay.G.get(f.g); return fit(p.x, p.y, p.R * (p.dark ? 4 : 1.5), p.R * (p.dark ? 3.4 : 1.3)); }
    const b = lay.bounds;
    return fit(b.cx, b.cy, b.w * 0.55, b.h * 0.56);
  }, [lay]);
  // hide labels that would overlap a more important one at the current zoom (biggest galaxies, then biggest forms)
  const cull = useCallback(() => {
    const el = svg.current;
    if (!el) return;
    const k = cam.current.w / size.current.w, placed = [];
    const fg = el.dataset.focus || "";
    const items = [...el.querySelectorAll("[data-lbl]")].filter((t) => t.dataset.lbl === "g" || t.dataset.g === fg)
      .map((t) => ({ t, x: +t.dataset.x, y: +t.dataset.y, p: +t.dataset.p + (t.dataset.lbl === "s" ? 0 : 0), f: +t.dataset.f, c: +t.dataset.c, n: t.textContent.length, s: t.dataset.lbl === "s" }))
      .sort((a, b) => b.p - a.p);
    for (const it of items) {
      const w = it.n * it.c * it.f * k, h = it.f * 1.3 * k, y0 = it.y + (it.s ? it.f * 0.25 * k : -it.f * 0.9 * k);
      const box = [it.x - w / 2 - 3 * k, y0, it.x + w / 2 + 3 * k, y0 + h];
      const hit = placed.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1]);
      it.t.classList.toggle("culled", hit);
      if (!hit) placed.push(box);
    }
  }, []);
  const cullSoon = useRef(null);
  const settle = useCallback(() => { clearTimeout(cullSoon.current); cullSoon.current = setTimeout(cull, 90); }, [cull]);
  const flyTo = useCallback((t, ms = 1300) => {
    cancelAnimationFrame(anim.current);
    const a = { ...cam.current }, dist = Math.hypot(t.x - a.x, t.y - a.y);
    const bump = clamp(dist / Math.max(a.w, t.w), 0, 2.5) * 0.45;
    const t0 = performance.now();
    const step = (now) => {
      const k = clamp((now - t0) / ms, 0, 1), e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      cam.current = { x: a.x + (t.x - a.x) * e, y: a.y + (t.y - a.y) * e, w: Math.exp(Math.log(a.w) + (Math.log(t.w) - Math.log(a.w)) * e) * (1 + bump * Math.sin(Math.PI * e)) };
      applyCam();
      if (k < 1) anim.current = requestAnimationFrame(step); else settle();
    };
    anim.current = requestAnimationFrame(step);
  }, [applyCam, settle]);
  const go = useCallback((f, ms) => { setFocus(f); setSel(null); if (f.s) ensure(f.s); flyTo(target(f), ms); }, [ensure, flyTo, target]);
  useEffect(() => { settle(); }, [focus, show.labels, settle]);
  const up = useCallback(() => {
    if (focus.level === "system") go({ level: "galaxy", g: focus.g, s: null });
    else if (focus.level === "galaxy") go({ level: "sky", g: null, s: null });
  }, [focus, go]);

  // size, intro flight, wheel zoom
  useEffect(() => {
    const el = box.current;
    const ro = new ResizeObserver(() => { const r = el.getBoundingClientRect(); if (r.width > 10) { size.current = { w: r.width, h: r.height }; applyCam(); } });
    ro.observe(el);
    return () => ro.disconnect();
  }, [applyCam]);
  useEffect(() => { applyCam(); const t = setTimeout(() => flyTo(target({ level: "sky" }), 2600), 60); return () => clearTimeout(t); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const el = svg.current;
    const wheel = (e) => {
      e.preventDefault();
      cancelAnimationFrame(anim.current);
      const r = el.getBoundingClientRect(), c = cam.current, h = (c.w * size.current.h) / size.current.w;
      const px = c.x - c.w / 2 + ((e.clientX - r.left) / r.width) * c.w, py = c.y - h / 2 + ((e.clientY - r.top) / r.height) * h;
      const f = Math.exp(e.deltaY * 0.0014), w = clamp(c.w * f, 40, lay.bounds.w * 3);
      const s = w / c.w;
      cam.current = { x: px + (c.x - px) * s, y: py + (c.y - py) * s, w };
      applyCam();
      settle();
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [applyCam, lay, settle]);
  useEffect(() => {
    const key = (e) => { if (!active) return; if (e.key === "Escape" && !/INPUT|TEXTAREA/.test(e.target.tagName)) up(); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [up, active]);
  useEffect(() => { if (!fly) return; go(fly.s ? { level: "system", g: U.sysById.get(fly.s).galaxy, s: fly.s } : { level: "galaxy", g: fly.g, s: null }, 1600); setFly(null); }, [fly]); // eslint-disable-line react-hooks/exhaustive-deps

  // drag to pan; a click that did not move picks
  const down = (e) => { if (e.button !== 0) return; cancelAnimationFrame(anim.current); drag.current = { x: e.clientX, y: e.clientY, c: { ...cam.current } }; moved.current = false; };
  const move = (e) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!moved.current && Math.hypot(dx, dy) < 4) return;
    moved.current = true;
    const s = d.c.w / size.current.w;
    cam.current = { ...d.c, x: d.c.x - dx * s, y: d.c.y - dy * s };
    applyCam();
  };
  const release = () => { if (drag.current && moved.current) settle(); drag.current = null; };
  const pickGalaxy = useCallback((id) => { if (moved.current) return; go({ level: "galaxy", g: id, s: null }); }, [go]);
  const pickSystem = useCallback((id) => { if (moved.current) return; go({ level: "system", g: U.sysById.get(id).galaxy, s: id }); }, [go, U]);
  const bgClick = (e) => { if (moved.current) return; if (e.target === svg.current || e.target.classList.contains("ob-bg")) up(); };

  const hits = useMemo(() => {
    const ql = q.trim().toLowerCase();
    if (!ql) return [];
    const gs = U.galaxies.filter((g) => g.name.toLowerCase().includes(ql)).slice(0, 6).map((g) => ({ g: g.id, label: g.name, sub: g.systems.length ? `${g.kind === "microapp" ? "micro app" : "module"} · ${g.systems.length} forms` : "no forms" }));
    const ss = U.systems.filter((s) => s.name.toLowerCase().includes(ql)).slice(0, 10).map((s) => ({ s: s.id, label: s.name, sub: U.galById.get(s.galaxy).name }));
    return [...gs, ...ss];
  }, [q, U]);

  const fg = focus.g && U.galById.get(focus.g), fs = focus.s && U.sysById.get(focus.s);
  const svgCls = `ob-svg lvl-${focus.level}${show.motion ? "" : " still"}${show.labels ? "" : " nolabels"}${hover ? " hovering" : ""}`;
  return (
    <div className={"ob" + (active ? "" : " paused")} ref={box}>
      <Starfield cam={cam} size={size} motion={show.motion && active} />
      <svg ref={svg} className={svgCls} data-focus={focus.g || ""} onPointerDown={down} onPointerMove={move} onPointerUp={release} onPointerLeave={release} onClick={bgClick}>
        <SkyDefs U={U} lay={lay} />
        <rect className="ob-bg" x={lay.bounds.minX - 6000} y={lay.bounds.minY - 6000} width={lay.bounds.w + 12000} height={lay.bounds.h + 12000} />
        <GalaxyLinks U={U} L={L} lay={lay} show={show} hover={hover} focus={focus} />
        {U.galaxies.map((g) => {
          const p = lay.G.get(g.id);
          return p.dark
            ? <Quasar key={g.id} g={g} p={p} focus={focus.g === g.id} dim={focus.level !== "sky" && focus.g !== g.id} onPick={pickGalaxy} setHover={setHover} />
            : <Galaxy key={g.id} U={U} g={g} p={p} S={lay.S} level={focus.level} focus={focus.g === g.id} dim={focus.level !== "sky" && focus.g !== g.id} sysFocus={focus.s} onPick={pickGalaxy} onSystem={pickSystem} setHover={setHover} />;
        })}
        {focus.level !== "sky" && fg && <SystemLinks U={U} L={L} lay={lay} gid={focus.g} show={show} hover={hover} sysFocus={focus.s} />}
        {focus.level === "system" && fs && <SolarSystem U={U} L={L} lay={lay} s={fs} R={surveys.get(fs.id)} ver={ver} show={show} sel={sel} setSel={setSel} onSystem={pickSystem} onGalaxy={pickGalaxy} />}
      </svg>

      {/* HUD */}
      <div className="ob-top">
        <div className="ob-crumbs">
          <button className={focus.level === "sky" ? "on" : ""} onClick={() => go({ level: "sky", g: null, s: null })}>✦ {U.name}</button>
          {fg && <><i>›</i><button className={focus.level === "galaxy" ? "on" : ""} onClick={() => go({ level: "galaxy", g: fg.id, s: null })}>{fg.name}</button></>}
          {fs && <><i>›</i><button className="on">{fs.name}</button></>}
          {focus.level !== "sky" && <button className="ob-back" onClick={up} title="Back out (Esc)">⤺ Back</button>}
        </div>
        <div className="ob-search">
          <input type="text" placeholder="Find a galaxy or a form…" value={q} onChange={(e) => setQ(e.target.value)} />
          {hits.length > 0 && (
            <div className="ob-hits">
              {hits.map((h) => <button key={h.s || h.g} onClick={() => { setQ(""); go(h.s ? { level: "system", g: U.sysById.get(h.s).galaxy, s: h.s } : { level: "galaxy", g: h.g, s: null }, 1700); }}><b>{h.s ? "☉" : "✺"} {h.label}</b><span>{h.sub}</span></button>)}
            </div>
          )}
        </div>
      </div>
      {scan.running && <div className="ob-scan"><div className="ob-scanring" style={{ "--p": scan.done / scan.total }} /><span>Charting the sky · {nf(scan.done)} / {nf(scan.total)} solar systems</span></div>}
      <div className="ob-legend">
        {["nav", "comp", "call"].map((k) => <button key={k} className={"k-" + k + (show[k] ? " on" : "")} onClick={() => setShow((s) => ({ ...s, [k]: !s[k] }))}><i />{KIND_LABEL[k]}</button>)}
        <button className={"opt" + (show.managers ? " on" : "")} onClick={() => setShow((s) => ({ ...s, managers: !s.managers }))} title="Calls into modules with no forms (managers, shared business code)"><i />{U.kind === "monolith" ? "Shared modules" : "Form-less apps"}</button>
        <button className={"opt" + (show.labels ? " on" : "")} onClick={() => setShow((s) => ({ ...s, labels: !s.labels }))}><i />Labels</button>
        <button className={"opt" + (show.motion ? " on" : "")} onClick={() => setShow((s) => ({ ...s, motion: !s.motion }))}><i />Motion</button>
      </div>
      <div className="ob-hint">{focus.level === "sky" ? "Click a galaxy to fly in · scroll to zoom · drag to pan" : focus.level === "galaxy" ? "Click a solar system to land · click empty space or Esc to fly out" : "Click a planet or a portal · Esc to fly out"}</div>
      <MiniMap U={U} lay={lay} mini={mini} onGo={(x, y) => { const t = { ...cam.current, x, y }; flyTo(t, 700); }} />
      {show.panel ? (
        <div className="ob-panel" key={focus.level + (focus.g || "") + (focus.s || "")}>
          <button className="ob-pclose" onClick={() => setShow((s) => ({ ...s, panel: false }))} title="Hide">×</button>
          {focus.level === "sky" && <SkyPanel U={U} L={L} lay={lay} scan={scan} onGalaxy={(id) => go({ level: "galaxy", g: id, s: null })} />}
          {focus.level === "galaxy" && fg && <GalaxyPanel U={U} L={L} g={fg} surveys={surveys} onGalaxy={(id) => go({ level: "galaxy", g: id, s: null })} onSystem={(id) => go({ level: "system", g: U.sysById.get(id).galaxy, s: id })} />}
          {focus.level === "system" && fs && <SystemPanel U={U} L={L} s={fs} R={surveys.get(fs.id)} sel={sel} setSel={setSel} onSystem={(id) => go({ level: "system", g: U.sysById.get(id).galaxy, s: id })} onGalaxy={(id) => go({ level: "galaxy", g: id, s: null })} />}
        </div>
      ) : <button className="ob-popen" onClick={() => setShow((s) => ({ ...s, panel: true }))}>☰ Details</button>}
    </div>
  );
}

function SkyDefs({ U, lay }) {
  return (
    <defs>
      {U.galaxies.map((g) => {
        const p = lay.G.get(g.id);
        return (
          <g key={g.id}>
            <radialGradient id={"obh-" + p.i}><stop offset="0" stopColor={`hsl(${p.hue} 90% 72%)`} stopOpacity={p.dark ? 0.7 : 0.42} /><stop offset="0.45" stopColor={`hsl(${p.hue} 80% 55%)`} stopOpacity={p.dark ? 0.18 : 0.14} /><stop offset="1" stopColor={`hsl(${p.hue} 80% 40%)`} stopOpacity="0" /></radialGradient>
            <radialGradient id={"obc-" + p.i}><stop offset="0" stopColor="#fff" /><stop offset="0.35" stopColor={`hsl(${p.hue} 100% 85%)`} /><stop offset="1" stopColor={`hsl(${p.hue} 90% 60%)`} stopOpacity="0" /></radialGradient>
          </g>
        );
      })}
      <radialGradient id="obSun"><stop offset="0" stopColor="#fffbe8" /><stop offset="0.4" stopColor="#ffd27a" /><stop offset="0.75" stopColor="#ff9a3c" stopOpacity="0.85" /><stop offset="1" stopColor="#ff6a21" stopOpacity="0" /></radialGradient>
      <radialGradient id="obPortal"><stop offset="0" stopColor="#0a0f1d" /><stop offset="0.7" stopColor="#1b2a4a" /><stop offset="1" stopColor="#7d9bd0" stopOpacity="0.6" /></radialGradient>
      <filter id="obGlow" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="1.6" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
      <marker id="obArrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,1 L10,5 L0,9 z" fill="context-stroke" /></marker>
    </defs>
  );
}

const Galaxy = memo(function Galaxy({ U, g, p, S, level, focus, dim, sysFocus, onPick, onSystem, setHover }) {
  const arms = useMemo(() => armPaths(p, g.systems.length > 14 ? 3 : 2, hash(g.id) * 6), [p, g]);
  const dust = useMemo(() => Array.from({ length: 14 }, (_, i) => { const a = hash(g.id + i) * Math.PI * 2, r = p.R * (0.2 + 0.85 * hash(g.id + "d" + i)); return { x: p.x + r * Math.cos(a), y: p.y + r * Math.sin(a), r: 0.6 + hash(g.id + "s" + i) * 1.4 }; }), [p, g]);
  const dist = Math.hypot(p.x, p.y);
  const interactive = level === "sky" || !focus;
  return (
    <g className={"ob-gal" + (focus ? " focus" : "") + (dim ? " dim" : "")} style={{ "--h": p.hue, "--d": Math.min(2400, dist * 0.9) + "ms" }}
      onMouseEnter={() => setHover(g.id)} onMouseLeave={() => setHover(null)}>
      <circle className="ob-halo" cx={p.x} cy={p.y} r={p.R * 1.3} fill={`url(#obh-${p.i})`} onClick={interactive ? (e) => { e.stopPropagation(); onPick(g.id); } : undefined} />
      <g className="ob-arms" style={{ transformOrigin: `${p.x}px ${p.y}px`, animationDuration: 160 + (p.i % 7) * 25 + "s" }}>
        {arms.map((d, i) => <path key={i} d={d} className="ob-arm" style={{ strokeWidth: p.R * 0.16 }} />)}
        {arms.map((d, i) => <path key={"t" + i} d={d} className="ob-armt" style={{ strokeWidth: p.R * 0.035 }} />)}
        {dust.map((q, i) => <circle key={i} cx={q.x} cy={q.y} r={q.r} className="ob-dust" />)}
      </g>
      <circle className="ob-core" cx={p.x} cy={p.y} r={p.R * 0.16} fill={`url(#obc-${p.i})`} />
      {g.systems.map((id) => {
        const s = S.get(id), sys = U.sysById.get(id);
        return (
          <g key={id} className={"ob-sys" + (sysFocus === id ? " here" : "")} onClick={(e) => { e.stopPropagation(); if (level === "sky") onPick(g.id); else onSystem(id); }}
            onMouseEnter={(e) => { e.stopPropagation(); if (level !== "sky") setHover(id); }} onMouseLeave={(e) => { e.stopPropagation(); if (level !== "sky") setHover(g.id); }}>
            <circle className="ob-shit" cx={s.x} cy={s.y} r={s.r * 2.6} />
            <circle className="ob-star" cx={s.x} cy={s.y} r={s.r} style={{ "--r": s.r + "px", "--tw": 2 + s.tw * 4 + "s", "--twd": -s.tw * 5 + "s" }} />
            <text className="ob-slabel" x={s.x} y={s.y + s.r} dy="1.25em" textAnchor="middle" data-lbl="s" data-g={g.id} data-x={s.x} data-y={s.y + s.r} data-p={sys.files} data-f="11" data-c="0.62">{sys.name}</text>
          </g>
        );
      })}
      <text className="ob-glabel" x={p.x} y={p.y + p.R * 1.12} textAnchor="middle" data-lbl="g" data-g={g.id} data-x={p.x} data-y={p.y + p.R * 1.12} data-p={1e6 + g.systems.length} data-f="13" data-c="0.6" onClick={interactive ? (e) => { e.stopPropagation(); onPick(g.id); } : undefined}>{g.name}</text>
      <text className="ob-gsub" x={p.x} y={p.y + p.R * 1.12} dy="1.25em" textAnchor="middle">{g.systems.length} form{g.systems.length === 1 ? "" : "s"}{g.kind === "microapp" ? ` · ${g.modules.length} module${g.modules.length === 1 ? "" : "s"}` : ""}</text>
    </g>
  );
});

const Quasar = memo(function Quasar({ g, p, focus, dim, onPick, setHover }) {
  return (
    <g className={"ob-qsr" + (focus ? " focus" : "") + (dim ? " dim" : "")} style={{ "--d": "1800ms" }} onClick={(e) => { e.stopPropagation(); onPick(g.id); }}
      onMouseEnter={() => setHover(g.id)} onMouseLeave={() => setHover(null)}>
      <circle cx={p.x} cy={p.y} r={p.R * 1.6} fill={`url(#obh-${p.i})`} className="ob-halo" />
      <g className="ob-jets" style={{ transformOrigin: `${p.x}px ${p.y}px` }}>
        <line x1={p.x} y1={p.y - p.R * 1.5} x2={p.x} y2={p.y + p.R * 1.5} className="ob-jet" />
      </g>
      <circle cx={p.x} cy={p.y} r={p.R * 0.28} className="ob-qcore" />
      <text className="ob-qlabel" x={p.x} y={p.y + p.R * 1.25} textAnchor="middle">{g.name}</text>
    </g>
  );
});

/* ---------------------------------------------------------------- links between galaxies (always) */
const GalaxyLinks = memo(function GalaxyLinks({ U, L, lay, show, hover, focus }) {
  const hg = hover && (U.galById.has(hover) ? hover : U.sysById.has(hover) ? U.sysById.get(hover).galaxy : null);
  const fg = focus.g;
  const rows = [];
  for (const l of L.galaxyLinks) {
    const a = lay.G.get(l.a), b = lay.G.get(l.b);
    if (!a || !b) continue;
    if ((a.dark || b.dark) && !show.managers) continue;
    ["nav", "comp", "call"].forEach((k, ki) => {
      if (!l[k] || !show[k]) return;
      const on = hg ? l.a === hg || l.b === hg : fg ? l.a === fg || l.b === fg : false;
      rows.push(<path key={l.a + l.b + k} d={curve(a, b, 0.1 + ki * 0.07)} className={`ob-gl k-${k}${on ? " on" : ""}`} style={{ strokeWidth: 0.6 + Math.log2(1 + l[k]) * 0.9 }} vectorEffect="non-scaling-stroke" />);
    });
  }
  return <g className={"ob-glinks" + (hg || fg ? " focused" : "")}>{rows}</g>;
});

/* ---------------------------------------------------------------- links of the focused galaxy's systems */
const SystemLinks = memo(function SystemLinks({ U, L, lay, gid, show, hover, sysFocus }) {
  const inG = (id) => id && U.sysById.get(id) && U.sysById.get(id).galaxy === gid;
  const pos = (id) => lay.S.get(id);
  const hs = hover && U.sysById.has(hover) ? hover : sysFocus;
  const out = [];
  const g = lay.G.get(gid);
  if (show.nav) for (const l of L.nav) {
    const a = inG(l.from), b = inG(l.to);
    if (!a && !b) continue;
    const on = hs && (l.from === hs || l.to === hs);
    out.push(<path key={"n" + l.from + l.to} d={curve(pos(l.from), pos(l.to), a && b ? 0.25 : 0.08)} className={`ob-sl k-nav${a && b ? "" : " ext"}${on ? " on" : ""}`} markerEnd="url(#obArrow)" vectorEffect="non-scaling-stroke" />);
  }
  if (show.call) for (const l of L.call) {
    const a = inG(l.from), b = l.to ? inG(l.to) : l.toGalaxy === gid;
    if (!a && !b) continue;
    const tp = l.to ? pos(l.to) : lay.G.get(l.toGalaxy);
    if (!tp || (!show.managers && !l.to && lay.G.get(l.toGalaxy).dark)) continue;
    const on = hs && (l.from === hs || l.to === hs);
    out.push(<path key={"c" + l.from + (l.to || l.toGalaxy)} d={curve(pos(l.from), tp, 0.12)} className={`ob-sl k-call ext${on ? " on" : ""}`} markerEnd="url(#obArrow)" vectorEffect="non-scaling-stroke" />);
  }
  if (show.comp) for (const c of L.components) {
    if (c.common) continue;
    const mine = c.systems.filter(inG);
    if (mine.length < 2) continue;
    const pts = mine.map(pos).sort((p1, p2) => Math.atan2(p1.y - g.y, p1.x - g.x) - Math.atan2(p2.y - g.y, p2.x - g.x));
    const on = hs && mine.includes(hs);
    out.push(<path key={"k" + c.key} d={"M" + pts.map((p) => `${p.x},${p.y}`).join(" L")} className={`ob-sl k-comp${on ? " on" : ""}`} vectorEffect="non-scaling-stroke"><title>{lastSeg(c.ns) || c.key} · shared by {mine.length} forms here</title></path>);
  }
  return <g className={"ob-slinks" + (hs ? " focused" : "")}>{out}</g>;
});

/* ---------------------------------------------------------------- one solar system */
function SolarSystem({ U, L, lay, s, R, show, sel, setSel, onSystem, onGalaxy }) {
  const p = lay.S.get(s.id);
  const O1 = 13, O2 = 23, O3 = 34, OS = 46, OP = 62;
  // portals: every other solar system (or galaxy) this one is linked to, placed in the direction of that body
  const portals = useMemo(() => {
    const m = new Map();
    const add = (id, galaxy, kind, dir) => { const k = id || "g:" + galaxy; if (!m.has(k)) m.set(k, { k, id, galaxy, kinds: new Set(), dirs: new Set() }); m.get(k).kinds.add(kind); m.get(k).dirs.add(dir); };
    if (show.nav) for (const l of L.nav) { if (l.from === s.id) add(l.to, null, "nav", "out"); if (l.to === s.id) add(l.from, null, "nav", "in"); }
    if (show.call) for (const l of L.call) {
      if (l.from === s.id) { if (l.to) add(l.to, null, "call", "out"); else if (show.managers || !lay.G.get(l.toGalaxy).dark) add(null, l.toGalaxy, "call", "out"); }
      if (l.to === s.id) add(l.from, null, "call", "in");
    }
    if (show.comp) for (const c of L.components) { if (c.common || !c.systems.includes(s.id)) continue; for (const o of c.systems) if (o !== s.id) add(o, null, "comp", "both"); }
    const list = [...m.values()].slice(0, 36).map((x) => {
      const t = x.id ? lay.S.get(x.id) : lay.G.get(x.galaxy);
      return { ...x, a: Math.atan2(t.y - p.y, t.x - p.x), t, name: x.id ? U.sysById.get(x.id).name : U.galById.get(x.galaxy).name, sub: x.id ? U.galById.get(U.sysById.get(x.id).galaxy).name : "galaxy" };
    }).sort((a, b) => a.a - b.a);
    const gap = Math.min(0.32, (Math.PI * 2) / Math.max(1, list.length));
    for (let it = 0; it < 30; it++) for (let i = 0; i < list.length; i++) { const nx = list[(i + 1) % list.length]; let d = nx.a - list[i].a; if (i === list.length - 1) d += Math.PI * 2; if (list.length > 1 && d < gap) { list[i].a -= (gap - d) / 2; nx.a += (gap - d) / 2; } }
    return list;
  }, [L, s, show, lay, U, p]);
  if (!R) return <g className="ob-solar"><circle cx={p.x} cy={p.y} r={7} fill="url(#obSun)" className="ob-sun pending" /><text className="ob-sunlabel" x={p.x} y={p.y + 9} dy="1em" textAnchor="middle">Reading {s.name}…</text></g>;
  const comps = R.comps.slice(0, 14);
  const groups = new Map();
  for (const c of R.calls) { const k = `${c.kind}|${c.app}|${c.module}`; if (!groups.has(k)) groups.set(k, { key: k, kind: c.kind, app: c.app, module: c.module, fns: [], galaxy: galaxyOf(U, c.app, c.module) }); groups.get(k).fns.push(c); }
  const mods = [...groups.values()].sort((a, b) => b.fns.length - a.fns.length).slice(0, 14);
  const svcs = R.services.slice(0, 18);
  const at = (o, i, n, off = 0) => { const a = (i / Math.max(1, n)) * Math.PI * 2 + off; return { x: p.x + o * Math.cos(a), y: p.y + o * Math.sin(a) }; };
  const moons = Math.min(R.actions, 28);
  const isSel = (t, k) => sel && sel.type === t && sel.key === k;
  return (
    <g className="ob-solar" key={s.id}>
      {[O1, O2, O3, OS].map((o) => <circle key={o} cx={p.x} cy={p.y} r={o} className="ob-orbit" />)}
      {/* portals and the lines out to them */}
      {portals.map((x, i) => {
        const q = { x: p.x + OP * Math.cos(x.a), y: p.y + OP * Math.sin(x.a) };
        const kind = x.kinds.size > 1 ? "mix" : [...x.kinds][0];
        return (
          <g key={x.k} className={`ob-portal k-${kind}`} style={{ "--d": 400 + i * 40 + "ms" }} onClick={(e) => { e.stopPropagation(); if (x.id) onSystem(x.id); else onGalaxy(x.galaxy); }}>
            <line x1={p.x + 8 * Math.cos(x.a)} y1={p.y + 8 * Math.sin(x.a)} x2={q.x} y2={q.y} className={"ob-pline" + (x.dirs.has("in") && !x.dirs.has("out") ? " in" : "")} vectorEffect="non-scaling-stroke" />
            <line x1={q.x} y1={q.y} x2={x.t.x} y2={x.t.y} className="ob-pfar" vectorEffect="non-scaling-stroke" />
            <circle cx={q.x} cy={q.y} r={2.6} fill="url(#obPortal)" className="ob-pring" />
            <circle cx={q.x} cy={q.y} r={3.4} className="ob-pswirl" style={{ transformOrigin: `${q.x}px ${q.y}px` }} />
            <text className="ob-plabel" x={q.x + (Math.cos(x.a) >= 0 ? 4.6 : -4.6)} y={q.y} dy="0.35em" textAnchor={Math.cos(x.a) >= 0 ? "start" : "end"}>{x.name}<tspan className="ob-ptsub" dx="0.5em">{x.sub}</tspan></text>
          </g>
        );
      })}
      {/* services: far stars */}
      <g className="ob-ring svc" style={{ transformOrigin: `${p.x}px ${p.y}px` }}>
        {svcs.map((v, i) => { const q = at(OS, i, svcs.length, 0.4); return (
          <g key={v} className={"ob-body svc" + (isSel("svc", v) ? " sel" : "")} onClick={(e) => { e.stopPropagation(); setSel({ type: "svc", key: v }); }}>
            <path d={`M${q.x},${q.y - 2.2} L${q.x + 0.55},${q.y - 0.55} L${q.x + 2.2},${q.y} L${q.x + 0.55},${q.y + 0.55} L${q.x},${q.y + 2.2} L${q.x - 0.55},${q.y + 0.55} L${q.x - 2.2},${q.y} L${q.x - 0.55},${q.y - 0.55} Z`} className="ob-svcstar" style={{ "--tw": 2 + hash(v) * 3 + "s" }} />
            <g className="ob-up" style={{ transformOrigin: `${q.x}px ${q.y}px` }}><text className="ob-blabel" x={q.x} y={q.y + 2.4} dy="1em" textAnchor="middle">{v.replace(/^\w+: /, "")}</text></g>
          </g>
        ); })}
      </g>
      {/* presentation / business code */}
      <g className="ob-ring r3" style={{ transformOrigin: `${p.x}px ${p.y}px` }}>
        {mods.map((m, i) => { const q = at(O3, i, mods.length, 1.1); const ext = m.galaxy && m.galaxy.id !== s.galaxy; return (
          <g key={m.key} className={`ob-body ${m.kind}${ext ? " ext" : ""}${isSel("mod", m.key) ? " sel" : ""}`} onClick={(e) => { e.stopPropagation(); setSel({ type: "mod", key: m.key, m }); }}>
            <line x1={p.x} y1={p.y} x2={q.x} y2={q.y} className="ob-spoke" vectorEffect="non-scaling-stroke" />
            {m.kind === "pc" ? <rect x={q.x - 2.1} y={q.y - 2.1} width={4.2} height={4.2} rx={0.8} transform={`rotate(45 ${q.x} ${q.y})`} className="ob-planet" /> : <rect x={q.x - 2} y={q.y - 2} width={4} height={4} rx={0.6} className="ob-planet" />}
            {ext && <circle cx={q.x} cy={q.y} r={3.6} className="ob-extring" />}
            <g className="ob-up" style={{ transformOrigin: `${q.x}px ${q.y}px` }}><text className="ob-blabel" x={q.x} y={q.y + 3} dy="1em" textAnchor="middle">{m.module}<tspan className="ob-bsub" x={q.x} dy="1.2em">{m.kind === "pc" ? "presentation" : "business"} · {m.fns.length} call{m.fns.length === 1 ? "" : "s"}</tspan></text></g>
          </g>
        ); })}
      </g>
      {/* components */}
      <g className="ob-ring r2" style={{ transformOrigin: `${p.x}px ${p.y}px` }}>
        {comps.map((c, i) => { const q = at(O2, i, comps.length, 0.2); const shared = L.components.find((x) => x.key === c.key); return (
          <g key={c.key} className={"ob-body comp" + (shared && shared.common ? " common" : "") + (isSel("comp", c.key) ? " sel" : "")} onClick={(e) => { e.stopPropagation(); setSel({ type: "comp", key: c.key, c }); }}>
            <line x1={p.x} y1={p.y} x2={q.x} y2={q.y} className="ob-spoke" vectorEffect="non-scaling-stroke" />
            <circle cx={q.x} cy={q.y} r={1.5 + Math.min(1.2, c.instances.length * 0.3)} className="ob-planet" />
            <g className="ob-up" style={{ transformOrigin: `${q.x}px ${q.y}px` }}><text className="ob-blabel" x={q.x} y={q.y + 2.6} dy="1em" textAnchor="middle">{lastSeg(c.ns) || "component " + c.kuid.slice(0, 6)}</text></g>
          </g>
        ); })}
      </g>
      {/* the controller, with the user actions as moons */}
      <g className="ob-ring r1" style={{ transformOrigin: `${p.x}px ${p.y}px` }}>
        {R.ctrl && (() => { const q = at(O1, 0, 1, -0.6); return (
          <g className={"ob-body ctrl" + (isSel("ctrl", "c") ? " sel" : "")} onClick={(e) => { e.stopPropagation(); setSel({ type: "ctrl", key: "c" }); }}>
            <line x1={p.x} y1={p.y} x2={q.x} y2={q.y} className="ob-spoke" vectorEffect="non-scaling-stroke" />
            <circle cx={q.x} cy={q.y} r={3} className="ob-planet" />
            <g className="ob-moons" style={{ transformOrigin: `${q.x}px ${q.y}px` }}>
              {Array.from({ length: moons }, (_, i) => { const a = (i / moons) * Math.PI * 2, rr = 4.6 + (i % 3) * 0.7; return <circle key={i} cx={q.x + rr * Math.cos(a)} cy={q.y + rr * Math.sin(a)} r={0.42} className="ob-moon" />; })}
            </g>
            <g className="ob-up" style={{ transformOrigin: `${q.x}px ${q.y}px` }}><text className="ob-blabel" x={q.x} y={q.y + 6.4} dy="1em" textAnchor="middle">{R.ctrl.name}<tspan className="ob-bsub" x={q.x} dy="1.2em">{nf(R.actions)} actions</tspan></text></g>
          </g>
        ); })()}
      </g>
      <circle cx={p.x} cy={p.y} r={9} fill="url(#obSun)" className="ob-corona" style={{ transformOrigin: `${p.x}px ${p.y}px` }} />
      <circle cx={p.x} cy={p.y} r={5.2} fill="url(#obSun)" className="ob-sun" onClick={(e) => { e.stopPropagation(); setSel(null); }} />
      <text className="ob-sunlabel" x={p.x} y={p.y - 6.5} textAnchor="middle">{s.name}</text>
      {mods.length < [...groups.values()].length && <text className="ob-more" x={p.x} y={p.y + O3 + 4} dy="1em" textAnchor="middle">+{[...groups.values()].length - mods.length} more modules called</text>}
    </g>
  );
}

/* ================================================================ panels */
function SkyPanel({ U, L, lay, scan, onGalaxy }) {
  const deg = new Map();
  for (const l of L.galaxyLinks) { const w = l.nav + l.call + l.comp; deg.set(l.a, (deg.get(l.a) || 0) + w); deg.set(l.b, (deg.get(l.b) || 0) + w); }
  const lit = U.galaxies.filter((g) => g.systems.length);
  const top = [...lit].sort((a, b) => (deg.get(b.id) || 0) - (deg.get(a.id) || 0)).slice(0, 8);
  const big = [...lit].sort((a, b) => b.systems.length - a.systems.length).slice(0, 6);
  return (
    <>
      <div className="ob-pkick">The sky</div>
      <h3>{U.name}</h3>
      <div className="ob-psub">{U.kind === "microapps" ? "Micro-app project" : "Monolith"} · {U.ch}</div>
      <div className="ob-stats">
        <div><b>{nf(lit.length)}</b><span>galaxies</span></div>
        <div><b>{nf(U.systems.length)}</b><span>solar systems</span></div>
        <div><b>{nf(U.galaxies.length - lit.length)}</b><span>{U.kind === "monolith" ? "shared modules" : "form-less apps"}</span></div>
        <div className="k-nav"><b>{nf(L.nav.length)}</b><span>navigations</span></div>
        <div className="k-comp"><b>{nf(L.components.filter((c) => !c.common && c.systems.length > 1).length)}</b><span>shared components</span></div>
        <div className="k-call"><b>{nf(L.call.length)}</b><span>code calls out</span></div>
      </div>
      {scan.running && <div className="ob-note">Connections appear as each form is read · {nf(scan.done)} of {nf(scan.total)}</div>}
      <div className="ob-psec">Most connected</div>
      {top.map((g) => <Row key={g.id} hue={lay.G.get(g.id).hue} title={g.name} sub={`${g.systems.length} forms · ${nf(deg.get(g.id) || 0)} links`} onClick={() => onGalaxy(g.id)} />)}
      <div className="ob-psec">Largest</div>
      {big.map((g) => <Row key={g.id} hue={lay.G.get(g.id).hue} title={g.name} sub={`${g.systems.length} forms`} onClick={() => onGalaxy(g.id)} />)}
      {L.components.some((c) => c.common) && <div className="ob-note">On almost every screen (not drawn as links): {L.components.filter((c) => c.common).map((c) => `${lastSeg(c.ns)} (${c.systems.length})`).join(", ")}</div>}
    </>
  );
}
const Row = ({ hue, title, sub, onClick, kind }) => (
  <button className={"ob-row" + (kind ? " k-" + kind : "")} onClick={onClick}>
    <i style={hue != null ? { background: `hsl(${hue} 85% 65%)` } : undefined} /><b>{title}</b><span>{sub}</span>
  </button>
);

function GalaxyPanel({ U, L, g, surveys, onGalaxy, onSystem }) {
  const mine = new Set(g.systems);
  const ext = new Map();
  for (const l of L.galaxyLinks) { if (l.a === g.id) { ext.set(l.b, { nav: l.nav, call: l.call, comp: l.comp }); } if (l.b === g.id) ext.set(l.a, { nav: l.nav, call: l.call, comp: l.comp }); }
  const callers = L.call.filter((l) => l.toGalaxy === g.id && !mine.has(l.from));
  const list = g.systems.map((id) => U.sysById.get(id)).map((s) => { const R = surveys.get(s.id); return { s, R, out: L.nav.filter((l) => l.from === s.id).length, inn: L.nav.filter((l) => l.to === s.id).length }; })
    .sort((a, b) => (b.out + b.inn) - (a.out + a.inn) || a.s.name.localeCompare(b.s.name));
  return (
    <>
      <div className="ob-pkick">{g.systems.length ? (g.kind === "microapp" ? "Micro app · galaxy" : "Module · galaxy") : U.kind === "monolith" ? "Shared module (no forms)" : "Micro app without forms"}</div>
      <h3>{g.name}</h3>
      <div className="ob-psub">{g.systems.length} forms · {g.pc} presentation · {g.bc} business file{g.bc === 1 ? "" : "s"}{g.kind === "microapp" ? ` · modules: ${g.modules.join(", ")}` : ""}</div>
      {!g.systems.length && callers.length > 0 && <><div className="ob-psec">Called from {callers.length} form{callers.length === 1 ? "" : "s"}</div>{callers.slice(0, 30).map((l) => <Row key={l.from} kind="call" title={U.sysById.get(l.from).name} sub={[...l.fns].slice(0, 2).join(", ")} onClick={() => onSystem(l.from)} />)}</>}
      {ext.size > 0 && <div className="ob-psec">Connected galaxies</div>}
      {[...ext.entries()].sort((a, b) => (b[1].nav + b[1].call + b[1].comp) - (a[1].nav + a[1].call + a[1].comp)).slice(0, 20).map(([id, w]) => (
        <button key={id} className="ob-row" onClick={() => onGalaxy(id)}><i className="ob-mix" /><b>{U.galById.get(id).name}</b>
          <span className="ob-kinds">{w.nav > 0 && <em className="k-nav">{w.nav} nav</em>}{w.comp > 0 && <em className="k-comp">{w.comp} comp</em>}{w.call > 0 && <em className="k-call">{w.call} calls</em>}</span></button>
      ))}
      {list.length > 0 && <div className="ob-psec">Solar systems</div>}
      {list.map(({ s, R, out, inn }) => <Row key={s.id} title={s.name} sub={R ? `${R.actions} actions · ${R.comps.length} comps · ${out}↗ ${inn}↙` : "reading…"} onClick={() => onSystem(s.id)} />)}
    </>
  );
}

function SystemPanel({ U, L, s, R, sel, setSel, onSystem, onGalaxy }) {
  const g = U.galById.get(s.galaxy);
  const outs = L.nav.filter((l) => l.from === s.id), ins = L.nav.filter((l) => l.to === s.id);
  const callsOut = L.call.filter((l) => l.from === s.id), callsIn = L.call.filter((l) => l.to === s.id);
  const sharing = new Map();
  if (R) for (const c of R.comps) { const x = L.components.find((k) => k.key === c.key); if (x && !x.common) for (const o of x.systems) if (o !== s.id) { if (!sharing.has(o)) sharing.set(o, []); sharing.get(o).push(lastSeg(c.ns)); } }
  return (
    <>
      <div className="ob-pkick">Solar system · {g.name}</div>
      <h3>☉ {s.name}</h3>
      <div className="ob-psub">{s.module}{U.kind === "microapps" ? ` · ${s.app}` : ""} · {s.key}</div>
      {!R ? <div className="ob-note">Reading this form…</div> : (
        <>
          <div className="ob-stats">
            <div><b>{nf(R.actions)}</b><span>actions</span></div>
            <div><b>{nf(R.comps.length)}</b><span>components</span></div>
            <div><b>{nf(R.calls.length)}</b><span>PC / BC calls</span></div>
            <div><b>{nf(R.services.length)}</b><span>services</span></div>
            <div className="k-nav"><b>{outs.length}↗ {ins.length}↙</b><span>navigation</span></div>
            <div className="k-call"><b>{callsOut.length}↗ {callsIn.length}↙</b><span>code calls</span></div>
          </div>
          {sel && <BodyCard U={U} L={L} s={s} R={R} sel={sel} close={() => setSel(null)} onSystem={onSystem} onGalaxy={onGalaxy} />}
          {outs.length > 0 && <div className="ob-psec">Opens</div>}
          {outs.map((l) => <Row key={l.to} kind="nav" title={U.sysById.get(l.to).name} sub={`${U.galById.get(U.sysById.get(l.to).galaxy).name} · via ${[...l.via].slice(0, 2).join(", ")}`} onClick={() => onSystem(l.to)} />)}
          {ins.length > 0 && <div className="ob-psec">Opened from</div>}
          {ins.map((l) => <Row key={l.from} kind="nav" title={U.sysById.get(l.from).name} sub={`${U.galById.get(U.sysById.get(l.from).galaxy).name} · via ${[...l.via].slice(0, 2).join(", ")}`} onClick={() => onSystem(l.from)} />)}
          {callsOut.length > 0 && <div className="ob-psec">Calls into</div>}
          {callsOut.map((l) => <Row key={l.to || l.toGalaxy} kind="call" title={l.to ? U.sysById.get(l.to).name : U.galById.get(l.toGalaxy).name} sub={[...l.fns].slice(0, 3).join(", ")} onClick={() => (l.to ? onSystem(l.to) : onGalaxy(l.toGalaxy))} />)}
          {callsIn.length > 0 && <div className="ob-psec">Called from</div>}
          {callsIn.map((l) => <Row key={l.from} kind="call" title={U.sysById.get(l.from).name} sub={[...l.fns].slice(0, 2).join(", ")} onClick={() => onSystem(l.from)} />)}
          {sharing.size > 0 && <div className="ob-psec">Shares components with</div>}
          {[...sharing.entries()].slice(0, 40).map(([id, ns]) => <Row key={id} kind="comp" title={U.sysById.get(id).name} sub={[...new Set(ns)].join(", ")} onClick={() => onSystem(id)} />)}
          <div className="ob-psec">Inside this system</div>
          <button className="ob-row" onClick={() => setSel({ type: "ctrl", key: "c" })}><i className="ob-dot ctrl" /><b>{R.ctrl ? R.ctrl.name : "no controller"}</b><span>{R.ctrl ? `${R.ctrl.members} functions · ${nf(R.ctrl.lines)} lines` : ""}</span></button>
          {R.comps.map((c) => <button key={c.key} className="ob-row" onClick={() => setSel({ type: "comp", key: c.key, c })}><i className="ob-dot comp" /><b>{lastSeg(c.ns) || c.kuid}</b><span>{c.instances.join(", ")}</span></button>)}
        </>
      )}
    </>
  );
}

function BodyCard({ U, L, s, R, sel, close, onSystem, onGalaxy }) {
  let body = null;
  if (sel.type === "ctrl" && R.ctrl) body = <><h4>● {R.ctrl.name}</h4><div className="ob-bc">{R.ctrl.files.map((f) => <div key={f} className="mono">{f}</div>)}<div>{R.ctrl.members} functions · {nf(R.ctrl.lines)} lines · {nf(R.actions)} user actions and form events</div></div></>;
  if (sel.type === "comp") {
    const c = sel.c, x = L.components.find((k) => k.key === c.key);
    body = <><h4>◍ {lastSeg(c.ns) || "component"}</h4><div className="ob-bc"><div className="mono">{c.ns || `kuid ${c.kuid} (not found in this project)`}{c.app && U.kind === "microapps" ? ` · lives in ${c.app}` : ""}</div><div>On this form as {c.instances.join(", ")}</div>{x && <div>Used by {x.systems.length} form{x.systems.length === 1 ? "" : "s"}{x.common ? " — on almost every screen" : ""}</div>}</div>
      {x && !x.common && x.systems.filter((o) => o !== s.id).slice(0, 12).map((o) => <Row key={o} kind="comp" title={U.sysById.get(o).name} sub={U.galById.get(U.sysById.get(o).galaxy).name} onClick={() => onSystem(o)} />)}</>;
  }
  if (sel.type === "mod") {
    const m = sel.m;
    body = <><h4>{m.kind === "pc" ? "◆" : "▤"} {m.module} {m.kind === "pc" ? "presentation" : "business"}</h4>
      <div className="ob-bc">{m.galaxy && m.galaxy.id !== s.galaxy ? <button className="ob-link" onClick={() => onGalaxy(m.galaxy.id)}>In another galaxy: {m.galaxy.name} → fly there</button> : <div>Same galaxy</div>}</div>
      {m.fns.map((f) => { const r = R.reached.get(`${f.kind}|${f.app}|${f.module}|${f.fn}`); return (
        <div key={f.fn} className="ob-fn"><b className="mono">{f.fn}()</b><span>called from {f.via}</span>
          {r && (r.navs.length > 0 || r.services.length > 0) && <span className="ob-leads">→ {[...new Set(r.navs.map((n) => n.form))].slice(0, 3).join(", ")}{r.navs.length && r.services.length ? " · " : ""}{r.services.slice(0, 3).join(", ")}</span>}
          {r && r.missing && <span className="ob-miss">not found in {m.module}</span>}</div>
      ); })}</>;
  }
  if (sel.type === "svc") {
    const via = [...R.reached.entries()].filter(([, r]) => r.services.includes(sel.key)).map(([k]) => k.split("|").slice(2).join("."));
    body = <><h4>✦ {sel.key.replace(/^\w+: /, "")}</h4><div className="ob-bc"><div>{sel.key.split(":")[0]} service</div>{via.length > 0 && <div>Reached through {via.slice(0, 4).join(", ")}</div>}</div></>;
  }
  return <div className="ob-card"><button className="ob-pclose" onClick={close}>×</button>{body}</div>;
}

/* ================================================================ starfield, minimap */
function Starfield({ cam, size, motion }) {
  const ref = useRef(null);
  useEffect(() => {
    const c = ref.current, ctx = c.getContext("2d");
    const stars = Array.from({ length: 520 }, (_, i) => ({ x: hash("x" + i), y: hash("y" + i), z: 0.25 + hash("z" + i) * 0.75, p: hash("p" + i) * 6.28, s: 0.6 + hash("s" + i) * 2.4, h: hash("h" + i) }));
    let raf, shoot = null, next = performance.now() + 4000;
    const draw = (t) => {
      const dpr = window.devicePixelRatio || 1, W = size.current.w, H = size.current.h;
      if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const { x, y, w } = cam.current, zoom = Math.log(Math.max(40, w)) * 0.08;
      for (const s of stars) {
        const px = ((s.x * W * 1.4 - (x / w) * 160 * s.z) % W + W) % W, py = ((s.y * H * 1.4 - (y / w) * 160 * s.z) % H + H) % H;
        const a = (0.25 + 0.75 * s.z) * (motion ? 0.6 + 0.4 * Math.sin(t / (900 + s.s * 500) + s.p) : 0.8);
        ctx.fillStyle = s.h > 0.92 ? `rgba(255,214,170,${a})` : s.h > 0.84 ? `rgba(170,200,255,${a})` : `rgba(235,240,255,${a})`;
        const r = (s.s * s.z) / (1 + zoom * 0.4);
        ctx.beginPath(); ctx.arc(px, py, r, 0, 6.283); ctx.fill();
      }
      if (motion) {
        if (!shoot && t > next) { shoot = { x: Math.random() * W, y: Math.random() * H * 0.5, t0: t }; next = t + 6000 + Math.random() * 9000; }
        if (shoot) {
          const k = (t - shoot.t0) / 900;
          if (k > 1) shoot = null;
          else { const sx = shoot.x + k * 260, sy = shoot.y + k * 120; const g = ctx.createLinearGradient(sx - 90, sy - 42, sx, sy); g.addColorStop(0, "rgba(255,255,255,0)"); g.addColorStop(1, `rgba(255,255,255,${0.8 * (1 - k)})`); ctx.strokeStyle = g; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(sx - 90, sy - 42); ctx.lineTo(sx, sy); ctx.stroke(); }
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [cam, size, motion]);
  return <canvas ref={ref} className="ob-stars" />;
}

function MiniMap({ U, lay, mini, onGo }) {
  const b = lay.bounds, pad = 120;
  const vb = `${b.minX - pad} ${b.minY - pad} ${b.w + pad * 2} ${b.h + pad * 2}`;
  const ref = useRef(null);
  const click = (e) => { const r = ref.current.getBoundingClientRect(); onGo(b.minX - pad + ((e.clientX - r.left) / r.width) * (b.w + pad * 2), b.minY - pad + ((e.clientY - r.top) / r.height) * (b.h + pad * 2)); };
  return (
    <svg ref={ref} className="ob-mini" viewBox={vb} preserveAspectRatio="none" onClick={click}>
      {U.galaxies.map((g) => { const p = lay.G.get(g.id); return <circle key={g.id} cx={p.x} cy={p.y} r={p.dark ? p.R : p.R * 0.8} style={{ fill: `hsl(${p.hue} 85% ${p.dark ? 80 : 62}%)`, opacity: p.dark ? 0.5 : 0.75 }} />; })}
      <rect ref={mini} className="ob-minicam" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/* ================================================================ star catalogue */
function Catalogue({ U, L, surveys, scan, go }) {
  const [tab, setTab] = useState("systems");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState({ k: "g", d: 1 }); // stable while forms are still being read
  const ql = q.trim().toLowerCase();
  const navOut = new Map(), navIn = new Map(), callOut = new Map(), callIn = new Map();
  for (const l of L.nav) { navOut.set(l.from, (navOut.get(l.from) || 0) + 1); navIn.set(l.to, (navIn.get(l.to) || 0) + 1); }
  for (const l of L.call) { callOut.set(l.from, (callOut.get(l.from) || 0) + 1); if (l.to) callIn.set(l.to, (callIn.get(l.to) || 0) + 1); }
  const gdeg = new Map();
  for (const l of L.galaxyLinks) for (const [x, y] of [[l.a, l.b], [l.b, l.a]]) { if (!gdeg.has(x)) gdeg.set(x, { nav: 0, call: 0, comp: 0, n: new Set() }); const d = gdeg.get(x); d.nav += l.nav; d.call += l.call; d.comp += l.comp; d.n.add(y); }
  const sysRows = U.systems.map((s) => { const R = surveys.get(s.id); return { s, g: U.galById.get(s.galaxy).name, actions: R ? R.actions : null, comps: R ? R.comps.length : null, calls: R ? R.calls.length : null, services: R ? R.services.length : null, out: navOut.get(s.id) || 0, in: navIn.get(s.id) || 0, cout: callOut.get(s.id) || 0, cin: callIn.get(s.id) || 0, links: (navOut.get(s.id) || 0) + (navIn.get(s.id) || 0) + (callOut.get(s.id) || 0) + (callIn.get(s.id) || 0) }; })
    .filter((r) => !ql || r.s.name.toLowerCase().includes(ql) || r.g.toLowerCase().includes(ql));
  const galRows = U.galaxies.map((g) => { const d = gdeg.get(g.id) || { nav: 0, call: 0, comp: 0, n: new Set() }; return { g, forms: g.systems.length, nav: d.nav, call: d.call, comp: d.comp, conn: d.n.size, links: d.nav + d.call + d.comp }; })
    .filter((r) => !ql || r.g.name.toLowerCase().includes(ql));
  const by = (rows, key) => [...rows].sort((a, b) => ((a[key] ?? -1) > (b[key] ?? -1) ? 1 : (a[key] ?? -1) < (b[key] ?? -1) ? -1 : 0) * sort.d);
  const H = ({ k, children }) => <th onClick={() => setSort((s) => ({ k, d: s.k === k ? -s.d : -1 }))} className={sort.k === k ? "on" : ""}>{children}{sort.k === k ? (sort.d < 0 ? " ↓" : " ↑") : ""}</th>;
  return (
    <div className="bp-page ob-cat">
      <h2 className="page">☰ Star catalogue</h2>
      <div className="crumb">Every galaxy and solar system of {U.name}, with its connections. Click a row to fly there in the sky.{scan.running ? ` Still reading forms: ${nf(scan.done)} of ${nf(scan.total)}.` : ""}</div>
      <div className="tabs">
        <div className={"tab" + (tab === "systems" ? " active" : "")} onClick={() => setTab("systems")}>Solar systems · {nf(U.systems.length)}</div>
        <div className={"tab" + (tab === "galaxies" ? " active" : "")} onClick={() => setTab("galaxies")}>Galaxies · {nf(U.galaxies.length)}</div>
      </div>
      <div className="view">
        <div className="searchbar"><input type="text" placeholder={tab === "systems" ? "Find a form or galaxy…" : "Find a galaxy…"} value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <table className="ob-table">
          {tab === "systems" ? (
            <>
              <thead><tr><H k="name">Form</H><H k="g">Galaxy</H><H k="actions">Actions</H><H k="comps">Components</H><H k="calls">PC / BC calls</H><H k="services">Services</H><H k="out">Opens</H><H k="in">Opened from</H><H k="cout">Calls out</H><H k="cin">Called from</H></tr></thead>
              <tbody>{by(sysRows.map((r) => ({ ...r, name: r.s.name })), sort.k).slice(0, 600).map((r) => (
                <tr key={r.s.id} onClick={() => go({ s: r.s.id })}><td className="mono">{r.s.name}</td><td>{r.g}</td><td>{r.actions ?? "…"}</td><td>{r.comps ?? "…"}</td><td>{r.calls ?? "…"}</td><td>{r.services ?? "…"}</td><td className="k-nav">{r.out || ""}</td><td className="k-nav">{r.in || ""}</td><td className="k-call">{r.cout || ""}</td><td className="k-call">{r.cin || ""}</td></tr>
              ))}</tbody>
            </>
          ) : (
            <>
              <thead><tr><H k="name">Galaxy</H><H k="forms">Forms</H><H k="conn">Connected galaxies</H><H k="nav">Navigation</H><H k="comp">Shared components</H><H k="call">Code calls</H></tr></thead>
              <tbody>{by(galRows.map((r) => ({ ...r, name: r.g.name })), sort.k).map((r) => (
                <tr key={r.g.id} onClick={() => go({ g: r.g.id })}><td><b>{r.g.name}</b>{!r.forms && <span className="tag"> · {U.kind === "monolith" ? "shared module" : "no forms"}</span>}</td><td>{r.forms}</td><td>{r.conn}</td><td className="k-nav">{r.nav || ""}</td><td className="k-comp">{r.comp || ""}</td><td className="k-call">{r.call || ""}</td></tr>
              ))}</tbody>
            </>
          )}
        </table>
      </div>
    </div>
  );
}
