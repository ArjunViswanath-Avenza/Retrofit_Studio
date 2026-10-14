import { useState, useEffect, useMemo, useRef, useLayoutEffect } from "react";
import "./formatlas.css";

// Form atlas: every monolith form as a tile. "Before" clusters them by monolith module; "After" flies each one to
// the micro app it lands in (a staggered wave), so the whole re-architecture is visible at once. Below, the full
// form-by-form list, linked to the tiles.

const STATUS = {
  same: "Same micro app as R26",
  moved: "R26 keeps it elsewhere",
  kbz: "Monolith only",
  channel: "No R26 channel",
};
const reduceMotion = () => typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const TILE = 12, GAP = 3, PAD = 12, HEAD = 44, COLGAP = 14, ROWGAP = 14;

// pack groups of tiles into rows of boxes; returns tile positions and box rectangles
function pack(groups, width) {
  const pos = new Map(), boxes = [];
  const maxCols = Math.max(4, Math.floor((width - 2 * PAD) / (TILE + GAP)));
  let x = 0, y = 0, rowH = 0;
  for (const g of groups) {
    const n = g.items.length;
    const cols = Math.min(maxCols, Math.max(5, Math.ceil(Math.sqrt(n * 2.2))));
    const rows = Math.ceil(n / cols);
    const w = Math.max(cols * (TILE + GAP) - GAP + 2 * PAD, 150), h = HEAD + rows * (TILE + GAP) - GAP + PAD;
    if (x > 0 && x + w > width) { x = 0; y += rowH + ROWGAP; rowH = 0; }
    g.items.forEach((k, i) => pos.set(k, { x: x + PAD + (i % cols) * (TILE + GAP), y: y + HEAD + Math.floor(i / cols) * (TILE + GAP) }));
    boxes.push({ ...g, x, y, w, h });
    x += w + COLGAP;
    rowH = Math.max(rowH, h);
  }
  return { pos, boxes, height: y + rowH };
}

export function FormAtlas({ plan, open, header }) {
  const wrap = useRef(null);
  const [width, setWidth] = useState(900);
  const [mode, setMode] = useState("before");
  const [q, setQ] = useState("");
  const [only, setOnly] = useState(null);
  const [hot, setHot] = useState(null);
  const [tip, setTip] = useState(null);
  const [appFilter, setAppFilter] = useState("all");

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(320, Math.floor(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // every form with its route
  const forms = useMemo(() => {
    const out = [];
    for (const m of plan.modules) if (m.kind === "ui") for (const f of m.forms) out.push({ key: `${m.module}/${f.ch}/${f.name}`, form: f.name, ch: f.ch, from: m.module, app: f.dest.app, module: f.dest.module, status: f.status, r26: f.r26 });
    return out;
  }, [plan]);
  const appKind = useMemo(() => new Map(plan.apps.map((a) => [a.name, a.kind])), [plan]);

  const before = useMemo(() => {
    const g = new Map();
    for (const f of forms) { if (!g.has(f.from)) g.set(f.from, []); g.get(f.from).push(f); }
    const groups = [...g].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
      .map(([k, list]) => ({ key: `m:${k}`, label: k, sub: `${list.length} form${list.length === 1 ? "" : "s"}`, kind: "module", items: list.sort((a, b) => a.app.localeCompare(b.app) || a.form.localeCompare(b.form)).map((f) => f.key) }));
    return pack(groups, width);
  }, [forms, width]);
  const after = useMemo(() => {
    const g = new Map();
    for (const f of forms) { if (!g.has(f.app)) g.set(f.app, []); g.get(f.app).push(f); }
    const order = { r26: 0, new: 1, shared: 2, container: 3 };
    const groups = [...g].sort((a, b) => (order[appKind.get(a[0])] ?? 1) - (order[appKind.get(b[0])] ?? 1) || b[1].length - a[1].length || a[0].localeCompare(b[0]))
      .map(([k, list]) => {
        const mods = new Set(list.map((f) => f.module));
        return { key: `a:${k}`, label: k, sub: `${list.length} forms · ${mods.size} module${mods.size === 1 ? "" : "s"}`, kind: appKind.get(k) || "new", items: list.sort((a, b) => a.module.localeCompare(b.module) || a.form.localeCompare(b.form)).map((f) => f.key) };
      });
    return pack(groups, width);
  }, [forms, width, appKind]);

  // play the migration on open and whenever the plan changes
  const planKey = JSON.stringify([plan.policy, plan.overrides, plan.channel]);
  useEffect(() => {
    if (reduceMotion()) { setMode("after"); return; }
    setMode("before");
    const t = setTimeout(() => setMode("after"), 900);
    return () => clearTimeout(t);
  }, [planKey]);
  const replay = () => { setMode("before"); setTimeout(() => setMode("after"), 700); };

  const L = mode === "after" ? after : before;
  const byKey = useMemo(() => new Map(forms.map((f) => [f.key, f])), [forms]);
  const ql = q.trim().toLowerCase();
  const match = (f) => (!ql || `${f.form} ${f.from} ${f.app} ${f.module}`.toLowerCase().includes(ql)) && (!only || f.status === only) && (appFilter === "all" || f.app === appFilter);
  const counts = useMemo(() => { const c = { same: 0, moved: 0, kbz: 0, channel: 0 }; for (const f of forms) c[f.status]++; return c; }, [forms]);
  const anyFilter = !!ql || !!only || appFilter !== "all";
  const list = forms.filter(match).sort((a, b) => a.from.localeCompare(b.from) || a.form.localeCompare(b.form));
  const apps = [...new Set(forms.map((f) => f.app))].sort();

  const showTip = (e, f) => {
    const r = wrap.current.getBoundingClientRect();
    setTip({ x: e.clientX - r.left + 14, y: e.clientY - r.top + 12, f });
  };

  return (
    <div>
      {header}
      <div className="fa-top">
        <div className="fa-modes">
          <button className={mode === "before" ? "on" : ""} onClick={() => setMode("before")}>Monolith modules</button>
          <span className="fa-arrow" aria-hidden="true"><i /></span>
          <button className={mode === "after" ? "on" : ""} onClick={() => setMode("after")}>Micro apps</button>
          <button className="btn ghost tiny fa-replay" onClick={replay}>↻ Replay migration</button>
        </div>
        <div className="fa-legend">
          {Object.entries(STATUS).filter(([s]) => counts[s]).map(([s, t]) => (
            <span key={s} className={"fa-leg" + (only === s ? " on" : "") + (only && only !== s ? " off" : "")} onClick={() => setOnly(only === s ? null : s)}>
              <i className={"fa-sw fa-" + s} />{t} <b>{counts[s]}</b>
            </span>
          ))}
        </div>
      </div>
      <div className="searchbar">
        <input type="text" placeholder="Find a form, module or micro app…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="fa-select" value={appFilter} onChange={(e) => setAppFilter(e.target.value)}>
          <option value="all">All micro apps ({apps.length})</option>
          {apps.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <span className="note">{anyFilter ? `${list.length} of ${forms.length} forms` : `${forms.length} forms · ${before.boxes.length} monolith modules → ${after.boxes.length} micro apps`}</span>
      </div>

      <div className="fa-stage" ref={wrap} style={{ height: Math.max(L.height + 20, 140) }} onMouseLeave={() => setTip(null)}>
        {before.boxes.map((b) => (
          <div key={b.key} className={"fa-box fa-box-module" + (mode === "before" ? " show" : "")} style={{ left: b.x, top: b.y, width: b.w, height: b.h }}>
            <div className="fa-box-h"><b>{b.label}</b><span>{b.sub}</span></div>
          </div>
        ))}
        {after.boxes.map((b, i) => (
          <div key={b.key} className={`fa-box fa-box-${b.kind}` + (mode === "after" ? " show" : "")} style={{ left: b.x, top: b.y, width: b.w, height: b.h, "--d": `${400 + Math.min(i * 40, 800)}ms` }}>
            <div className="fa-box-h"><b>{b.label}</b><span>{b.sub}</span></div>
          </div>
        ))}
        {forms.map((f) => {
          const p = L.pos.get(f.key) || { x: 0, y: 0 };
          const b0 = before.pos.get(f.key) || p;
          // a wave from left to right, with a little scatter so tiles do not move in lockstep
          const delay = mode === "after" ? Math.round((b0.x / Math.max(1, width)) * 650 + ((f.form.length * 37) % 180)) : Math.round(((f.form.length * 53) % 220));
          const dim = anyFilter && !match(f);
          return (
            <span key={f.key}
              className={`fa-tile fa-${f.status}` + (dim ? " dim" : "") + (hot === f.key ? " hot" : "") + (mode === "after" ? " landed" : "")}
              style={{ transform: `translate(${p.x}px, ${p.y}px)`, transitionDelay: `${delay}ms`, "--land": `${delay + 1050}ms` }}
              onMouseEnter={(e) => { setHot(f.key); showTip(e, f); }} onMouseLeave={() => setHot(null)}
              onClick={() => open(f.from)} />
          );
        })}
        {tip && (
          <div className="fa-tip" style={{ left: Math.min(tip.x, width - 260), top: tip.y }}>
            <div className="fa-tip-form">{tip.f.form}{tip.f.ch !== "desktop" && tip.f.ch !== "mobile" ? ` · ${tip.f.ch}` : ""}</div>
            <div className="fa-route"><span>{tip.f.from}</span><i>→</i><span><b>{tip.f.app}</b> / {tip.f.module}</span></div>
            <div className={"fa-tip-st fa-t-" + tip.f.status}>{STATUS[tip.f.status]}</div>
            {tip.f.r26.length > 0 && <div className="fa-tip-r26">R26: {tip.f.r26.map((r) => `${r.app} / ${r.module}`).join(" · ")}</div>}
          </div>
        )}
      </div>

      <h3 style={{ margin: "18px 0 6px" }}>All forms and where they land</h3>
      <div className="retrotable fa-list" style={{ maxHeight: "60vh" }}>
        <table>
          <thead><tr><th>Monolith module</th><th>Form</th><th></th><th>Micro app</th><th>Module in micro app</th><th>R26 has it in</th><th>Status</th></tr></thead>
          <tbody>
            {list.slice(0, 1500).map((f, i) => (
              <tr key={f.key} className={hot === f.key ? "hot" : ""} style={{ "--d": `${Math.min(i * 12, 600)}ms` }}
                onMouseEnter={() => setHot(f.key)} onMouseLeave={() => setHot(null)} onClick={() => open(f.from)}>
                <td className="mono">{f.from}</td>
                <td className="mono"><b>{f.form}</b>{f.ch !== "desktop" && f.ch !== "mobile" ? <span className="tag"> · {f.ch}</span> : ""}</td>
                <td className="fa-go">→</td>
                <td><b>{f.app}</b></td>
                <td className="mono">{f.module}</td>
                <td className="tag">{f.r26.length ? f.r26.map((r) => `${r.app} / ${r.module}`).join(" · ") : "—"}</td>
                <td><span className={"fa-badge fa-" + f.status}>{STATUS[f.status]}</span></td>
              </tr>
            ))}
            {!list.length && <tr><td colSpan={7} className="note">No forms match.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="note">Hover a tile or a row to trace a form; click to open its module. {byKey.size} forms.</p>
    </div>
  );
}
