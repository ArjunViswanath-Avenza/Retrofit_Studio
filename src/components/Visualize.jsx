import { useState, useEffect, useMemo, useRef } from "react";
import "./visualize.css";
import { CHANNELS } from "../lib/microapps";
import { R26_MAP, SHARED, buildPlan, planCsv } from "../lib/mapplan";

// Visualize: what a monolith becomes in the micro-app architecture — modules, forms and where each one goes —
// from the built-in R26 map. The user tries the placement options, adjusts single modules, then agrees the plan.

const STATUS = {
  same: { label: "Same micro app as R26", short: "Matches R26" },
  moved: { label: "R26 keeps it in another micro app", short: "R26 differs" },
  kbz: { label: "Only in the monolith — not in R26", short: "Monolith only" },
  channel: { label: "No R26 form for this channel (tablet / watch)", short: "No R26 channel" },
};
const KIND = { r26: "R26 micro app", new: "New micro app", shared: "Shared", container: "Container" };
const reduceMotion = () => typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---------------------------------------------------------------- small pieces
function CountUp({ value, ms = 900 }) {
  const [v, setV] = useState(reduceMotion() ? value : 0);
  const from = useRef(0);
  useEffect(() => {
    if (reduceMotion()) { setV(value); return; }
    const start = performance.now(), a = from.current;
    let raf;
    const tick = (t) => {
      const k = Math.min(1, (t - start) / ms), e = 1 - Math.pow(1 - k, 3);
      setV(Math.round(a + (value - a) * e));
      if (k < 1) raf = requestAnimationFrame(tick); else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  return <>{v.toLocaleString()}</>;
}

function Kpis({ plan }) {
  const s = plan.stats;
  const matched = s.forms - s.kbzOnly - s.noChannel;
  const items = [
    ["Forms", s.forms, `${s.modules} modules with screens`],
    ["Micro apps", s.apps, `${s.r26Apps} existing in R26 · ${s.newApps} new`],
    ["Match R26", s.same, matched ? `${Math.round((s.same / matched) * 100)}% of forms R26 also has` : "—"],
    ["Differ from R26", s.moved, s.moved ? "R26 keeps them in another micro app" : "none"],
    ["Monolith only", s.kbzOnly, s.noChannel ? `no R26 form of that name · plus ${s.noChannel} tablet / watch forms R26 has no channel for` : "no R26 form of that name"],
    ["Business logic", s.logicModules, "modules without screens"],
  ];
  return (
    <div className="vz-kpis">
      {items.map(([l, n, sub], i) => (
        <div key={l} className="vz-kpi" style={{ "--d": `${i * 60}ms` }}>
          <div className="vz-kpi-n"><CountUp value={n} /></div>
          <div className="vz-kpi-l">{l}</div>
          <div className="vz-kpi-s">{sub}</div>
        </div>
      ))}
    </div>
  );
}

// placement options — shown on every view so the picture updates as you choose
export function PlanBar({ policy, setPolicy, overrides, agreed }) {
  const opts = [
    ["placement", "Placement", [["module", "Keep modules whole"], ["form", "Follow R26 form by form"]]],
    ["naming", "Module names", [["kbz", "Keep monolith names"], ["r26", "Use R26 names"]]],
    ["unmatched", "Modules not in R26", [["new", "New micro app"], ["nearest", "Closest existing"]]],
  ];
  const stale = agreed && (JSON.stringify(agreed.policy) !== JSON.stringify(policy) || JSON.stringify(agreed.overrides || {}) !== JSON.stringify(overrides || {}));
  return (
    <div className="vz-planbar">
      {opts.map(([k, l, vals]) => (
        <div key={k} className="vz-opt">
          <span>{l}</span>
          <div className="seg">
            {vals.map(([v, t]) => <button key={v} className={policy[k] === v ? "on" : ""} onClick={() => setPolicy((p) => ({ ...p, [k]: v }))}>{t}</button>)}
          </div>
        </div>
      ))}
      {agreed && <span className={"vz-agreedtag" + (stale ? " stale" : "")}>{stale ? "Changed since agreed" : `✓ Agreed ${agreed.date}`}</span>}
    </div>
  );
}

const Badge = ({ status }) => <span className={`vz-badge vz-${status}`}>{STATUS[status].short}</span>;
const KindTag = ({ kind }) => <span className={`vz-kind vz-k-${kind}`}>{KIND[kind]}</span>;

// ---------------------------------------------------------------- upload
export function VisualizeUpload({ channel, setChannel, pick, onFolder, go }) {
  const inv = pick && pick.inv;
  return (
    <div>
      <h2 className="page">◎ Visualize · Monolith to micro apps</h2>
      <div className="crumb">Choose the channel and the monolith project, then visualize where every module and form goes.</div>
      <div className="rules">
        Uses the built-in map of <b>R26 {R26_MAP.release}</b> ({Object.keys(R26_MAP.apps).length} projects, read once from the R26 apps) —
        no R26 upload needed. Nothing is changed or written: this is the picture of the conversion, for review and agreement before anything is converted.
      </div>
      <div className="toolbar">
        <b>Channel</b>
        <div className="seg">
          {Object.entries(CHANNELS).map(([k, c]) => <button key={k} className={k === channel ? "on" : ""} onClick={() => setChannel(k)}>{c.label}</button>)}
        </div>
      </div>
      <div className="folders" style={{ gridTemplateColumns: "minmax(0, 1fr)", maxWidth: 560 }}>
        <div className={"folder" + (pick ? " filled" : "")}>
          <h3>Monolith project</h3>
          <div className="cl">e.g. {channel === "web" ? "konyonlinebanking2021" : "konymobilebanking2021"}</div>
          <div className="cnt">{inv ? inv.forms.length.toLocaleString() : 0}</div>
          <div className="cl">{channel === "web" ? "web" : "mobile / tablet / watch"} forms</div>
          <label className="pick">Choose folder
            <input type="file" webkitdirectory="" directory="" multiple style={{ display: "none" }} onChange={(e) => onFolder(e.target.files)} />
          </label>
          {pick && <div className="sub2">{pick.name} · {new Set(inv.forms.map((f) => f.module)).size} modules with screens · {inv.mvc.size} MVC extension modules · {pick.files.length.toLocaleString()} files</div>}
        </div>
      </div>
      <button className="btn vz-go" disabled={!inv || !inv.forms.length} onClick={go}>Visualize →</button>
      {pick && inv && !inv.forms.length && <p className="note">No {channel} forms in this folder — pick the project root (the folder holding <code>forms/</code>) or switch the channel.</p>}
    </div>
  );
}

// ---------------------------------------------------------------- flow (animated ribbons: modules -> micro apps)
export function FlowView({ plan, open, header }) {
  const [hover, setHover] = useState(null); // {t:'m'|'a', id}
  const [logic, setLogic] = useState(false);
  const [tip, setTip] = useState(null);
  const box = useRef(null);
  const L = useMemo(() => layout(plan, logic), [plan, logic]);
  const runKey = useMemo(() => JSON.stringify([plan.policy, plan.overrides, logic]), [plan, logic]);
  const hiLink = (l) => !hover || (hover.t === "m" ? l.m === hover.id : l.a === hover.id);
  const hiNode = (t, id) => !hover || (hover.t === t && hover.id === id) || L.links.some((l) => hiLink(l) && (t === "m" ? l.m === id : l.a === id));
  const showTip = (e, content) => {
    const r = box.current.getBoundingClientRect();
    setTip({ x: e.clientX - r.left + 14, y: e.clientY - r.top + 10, content });
  };
  return (
    <div>
      {header}
      <Kpis plan={plan} />
      <div className="vz-legend">
        <span><i className="vz-sw vz-sw-r26" /> to an existing R26 micro app</span>
        <span><i className="vz-sw vz-sw-new" /> to a new micro app</span>
        <span><i className="vz-sw vz-sw-shared" /> shared code</span>
        <span><i className="vz-dot-split" /> R26 splits this module</span>
        <label className="vz-check"><input type="checkbox" checked={logic} onChange={(e) => setLogic(e.target.checked)} /> include business-only modules ({plan.stats.logicModules})</label>
        <span className="spacer" />
        <span className="tag">hover to trace · click to open</span>
      </div>
      <div className="vz-flow" ref={box} onMouseLeave={() => { setHover(null); setTip(null); }}>
        <div className="vz-colh"><span>Monolith modules</span><span>Micro apps</span></div>
        <svg viewBox={`0 0 ${L.W} ${L.H}`} width="100%" style={{ minWidth: 760 }} role="img" aria-label="Monolith modules flowing into micro apps">
          <defs>
            <clipPath id="vz-reveal"><rect x="0" y="0" height={L.H} width={reduceMotion() ? L.W : 0} key={runKey}>
              {!reduceMotion() && <animate attributeName="width" from="0" to={L.W} dur="1.2s" fill="freeze" calcMode="spline" keySplines="0.2 0.7 0.2 1" keyTimes="0;1" />}
            </rect></clipPath>
          </defs>
          <g clipPath="url(#vz-reveal)">
            {L.links.map((l) => (
              <g key={l.key} className={"vz-link vz-l-" + l.kind + (hiLink(l) ? (hover ? " hi" : "") : " dim")}
                onMouseEnter={(e) => { setHover({ t: "m", id: l.m }); showTip(e, <><b>{l.m}</b> → <b>{l.a}</b><div>{l.n} {l.logic ? "business module" : `form${l.n === 1 ? "" : "s"}`}</div></>); }}
                onMouseMove={(e) => showTip(e, tip && tip.content)} onClick={() => open(l.m)}>
                <path className="vz-rib" d={l.d} />
                <path className="vz-run" d={l.c} />
              </g>
            ))}
          </g>
          {L.left.map((n, i) => (
            <g key={n.id} className={"vz-node" + (hiNode("m", n.id) ? "" : " dim")} style={{ "--d": `${Math.min(i * 18, 700)}ms` }}
              onMouseEnter={(e) => { setHover({ t: "m", id: n.id }); showTip(e, <><b>{n.id}</b><div>{n.mod.reason}</div><div className="tag">{n.mod.kind === "logic" ? "business logic only" : `${n.mod.forms.length} forms`} · click for details</div></>); }}
              onClick={() => open(n.id)}>
              <rect className="vz-bar vz-bar-m" x={L.xl - 6} y={n.y} width="6" height={n.h} rx="2" />
              <text x={L.xl - 12} y={n.y + n.h / 2} className="vz-lbl" textAnchor="end" dominantBaseline="middle">
                {n.id}<tspan className="vz-cnt"> {n.units}</tspan>
              </text>
              {n.mod.split && <circle cx={L.xl - 3} cy={n.y - 4} r="3" className="vz-split" />}
            </g>
          ))}
          {L.right.map((n, i) => (
            <g key={n.id} className={"vz-node" + (hiNode("a", n.id) ? "" : " dim")} style={{ "--d": `${200 + Math.min(i * 30, 700)}ms` }}
              onMouseEnter={(e) => { setHover({ t: "a", id: n.id }); showTip(e, <><b>{n.id}</b> <KindTag kind={n.app.kind} /><div>{n.app.forms} forms in {n.app.modules.length} modules{n.app.logic.length ? ` · ${n.app.logic.length} business modules` : ""}</div></>); }}>
              <rect className={"vz-bar vz-bar-" + n.app.kind} x={L.xr} y={n.y} width="10" height={n.h} rx="2" />
              <text x={L.xr + 16} y={n.y + n.h / 2} className="vz-lbl vz-lbl-a" dominantBaseline="middle">
                {n.id}<tspan className="vz-cnt"> {n.units}</tspan>
              </text>
            </g>
          ))}
        </svg>
        {tip && tip.content && <div className="vz-tip" style={{ left: tip.x, top: tip.y }}>{tip.content}</div>}
      </div>
    </div>
  );
}

// sankey-style geometry: left = modules, right = micro apps; ribbon thickness = forms (business modules = 1)
function layout(plan, withLogic) {
  const links = new Map();
  const mods = plan.modules.filter((m) => m.kind === "ui" || withLogic);
  for (const m of mods) {
    if (m.kind === "logic") { links.set(`${m.module}|${m.home}`, { m: m.module, a: m.home, n: 1, logic: true }); continue; }
    for (const f of m.forms) {
      const k = `${m.module}|${f.dest.app}`;
      if (!links.has(k)) links.set(k, { m: m.module, a: f.dest.app, n: 0 });
      links.get(k).n++;
    }
  }
  const appInfo = new Map(plan.apps.map((a) => [a.name, a]));
  const used = new Set([...links.values()].map((l) => l.a));
  const order = { r26: 0, new: 1, shared: 2, container: 3 };
  const right = plan.apps.filter((a) => used.has(a.name)).map((a) => ({ id: a.name, app: a, units: [...links.values()].filter((l) => l.a === a.name).reduce((s, l) => s + l.n, 0) }))
    .sort((a, b) => order[a.app.kind] - order[b.app.kind] || b.units - a.units || a.id.localeCompare(b.id));
  const rIndex = new Map(right.map((r, i) => [r.id, i]));
  const left = mods.map((m) => {
    const ls = [...links.values()].filter((l) => l.m === m.module);
    const main = ls.sort((a, b) => b.n - a.n)[0];
    return { id: m.module, mod: m, units: ls.reduce((s, l) => s + l.n, 0), main: main ? rIndex.get(main.a) : 999 };
  }).sort((a, b) => a.main - b.main || b.units - a.units || a.id.localeCompare(b.id));
  const W = 1000, xl = 280, xr = 700, gapL = 8, gapR = 12, minH = 9;
  const total = left.reduce((s, n) => s + n.units, 0) || 1;
  const target = Math.max(560, left.length * 21, right.length * 30);
  const u = Math.max(0.6, (target - gapL * left.length) / total);
  let y = 10;
  for (const n of left) { n.h = Math.max(minH, n.units * u); n.y = y; y += n.h + gapL; }
  const hl = y;
  // right nodes: same unit scale, centred against the left column
  const rTotal = right.reduce((s, n) => s + Math.max(minH + 6, n.units * u) + gapR, 0);
  let yr = Math.max(10, (hl - rTotal) / 2);
  for (const n of right) { n.h = Math.max(minH + 6, n.units * u); n.y = yr; yr += n.h + gapR; }
  const H = Math.max(hl, yr) + 10;
  // ribbon slices, stacked in left order on both ends
  const offL = new Map(left.map((n) => [n.id, 0])), offR = new Map(right.map((n) => [n.id, 0]));
  const lNode = new Map(left.map((n) => [n.id, n])), rNode = new Map(right.map((n) => [n.id, n]));
  const out = [];
  const sorted = [...links.values()].sort((a, b) => left.indexOf(lNode.get(a.m)) - left.indexOf(lNode.get(b.m)) || (rIndex.get(a.a) - rIndex.get(b.a)));
  for (const l of sorted) {
    const ln = lNode.get(l.m), rn = rNode.get(l.a);
    const h0 = ln.h * (l.n / ln.units), h1 = rn.h * (l.n / rn.units);
    const y0 = ln.y + offL.get(l.m), y1 = rn.y + offR.get(l.a);
    offL.set(l.m, offL.get(l.m) + h0); offR.set(l.a, offR.get(l.a) + h1);
    const x0 = xl, x1 = xr, xm = (x0 + x1) / 2;
    const d = `M${x0},${y0} C${xm},${y0} ${xm},${y1} ${x1},${y1} L${x1},${y1 + h1} C${xm},${y1 + h1} ${xm},${y0 + h0} ${x0},${y0 + h0} Z`;
    const c = `M${x0},${y0 + h0 / 2} C${xm},${y0 + h0 / 2} ${xm},${y1 + h1 / 2} ${x1},${y1 + h1 / 2}`;
    const kind = l.logic ? "logic" : (appInfo.get(l.a) || { kind: "new" }).kind;
    out.push({ ...l, key: `${l.m}|${l.a}`, d, c, kind });
  }
  return { W, H, xl, xr, left, right, links: out };
}

// ---------------------------------------------------------------- micro-app board
export function AppsView({ plan, open, header }) {
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("all");
  const ql = q.trim().toLowerCase();
  const apps = plan.apps.filter((a) => (a.forms || a.logic.length) && (kind === "all" || a.kind === kind)
    && (!ql || a.name.toLowerCase().includes(ql) || a.modules.some((m) => m.name.toLowerCase().includes(ql) || m.from.some((x) => x.toLowerCase().includes(ql)) || m.forms.some((f) => f.name.toLowerCase().includes(ql)))));
  const runKey = JSON.stringify([plan.policy, plan.overrides, kind]);
  return (
    <div>
      {header}
      <div className="searchbar">
        <input type="text" placeholder="Search micro apps, modules or forms…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="seg">
          {[["all", "All"], ["r26", "Existing in R26"], ["new", "New"], ["shared", "Shared"]].map(([k, t]) => <button key={k} className={kind === k ? "on" : ""} onClick={() => setKind(k)}>{t}</button>)}
        </div>
        <span className="note">{apps.length} micro apps</span>
        <span className="spacer" />
        <span className="vz-legend" style={{ margin: 0 }}>
          {["same", "moved", "kbz", "channel"].map((s) => <span key={s}><i className={"vz-sw vz-bg-" + s} />{STATUS[s].short}</span>)}
        </span>
      </div>
      <div className="vz-board" key={runKey}>
        {apps.map((a, i) => {
          const c = { same: 0, moved: 0, kbz: 0, channel: 0 };
          for (const m of a.modules) for (const f of m.forms) c[f.status]++;
          const tot = a.forms || 1;
          return (
            <div key={a.name} className={"vz-app vz-app-" + a.kind} style={{ "--d": `${Math.min(i * 45, 900)}ms` }}>
              <div className="vz-app-h">
                <div>
                  <div className="vz-app-name">{a.name}</div>
                  <div className="vz-app-tags"><KindTag kind={a.kind} />{a.retail && <span className="vz-mini">Retail</span>}{a.business && <span className="vz-mini">Business</span>}</div>
                </div>
                <div className="vz-app-n"><CountUp value={a.forms} ms={700} /><span>forms</span></div>
              </div>
              {a.forms > 0 && (
                <div className="vz-comp" title={`${c.same} match R26 · ${c.moved} R26 differs · ${c.kbz} monolith only · ${c.channel} no R26 channel`}>
                  {["same", "moved", "kbz", "channel"].map((s) => c[s] ? <i key={s} className={"vz-" + s} style={{ width: `${(c[s] / tot) * 100}%` }} /> : null)}
                </div>
              )}
              <div className="vz-app-mods">
                {a.modules.sort((x, y) => y.forms.length - x.forms.length).map((m) => (
                  <div key={m.name} className="vz-app-mod" onClick={() => open(m.from[0])}>
                    <span className="vz-mod-name">{m.name}</span>
                    {(m.from.length > 1 || m.from[0] !== m.name) && <span className="vz-from">from {m.from.join(", ")}</span>}
                    <span className="vz-mod-n">{m.forms.length}</span>
                  </div>
                ))}
                {a.logic.length > 0 && <div className="vz-logic">Business / presentation code: {a.logic.join(", ")}</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- modules & forms
export function ModulesView({ plan, sel, setSel, setOverride, header }) {
  const [q, setQ] = useState("");
  const [only, setOnly] = useState("all");
  const ql = q.trim().toLowerCase();
  const list = plan.modules.filter((m) => (!ql || m.module.toLowerCase().includes(ql) || m.forms.some((f) => f.name.toLowerCase().includes(ql)))
    && (only === "all" || (only === "split" && m.split) || (only === "new" && m.basis === "new") || (only === "logic" && m.kind === "logic") || (only === "moved" && m.forms.some((f) => f.status === "moved"))));
  const cur = plan.modules.find((m) => m.module === sel) || list[0];
  return (
    <div>
      {header}
      <div className="ovwrap">
        <div className="ovlist">
          <input type="text" placeholder="Search modules or forms…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="stchips">
            {[["all", "All"], ["split", "R26 splits"], ["moved", "Differs from R26"], ["new", "New micro app"], ["logic", "Business only"]].map(([k, t]) => (
              <span key={k} className={"chip" + (only === k ? " on" : "")} onClick={() => setOnly(k)}>{t}</span>
            ))}
          </div>
          <div className="ovitems">
            {list.map((m) => (
              <div key={m.module} className={"ovitem" + (cur && cur.module === m.module ? " sel" : "")} onClick={() => setSel(m.module)}>
                <div className="ovname"><span className={"stdot " + (m.split ? "st-changed" : m.basis === "new" ? "st-onlyA" : m.kind === "logic" ? "" : "st-onlyB")} /><b>{m.module}</b></div>
                <div className="ovsub">{m.kind === "logic" ? "business logic" : `${m.forms.length} forms`} → {m.home}</div>
              </div>
            ))}
            {!list.length && <p className="note">Nothing matches.</p>}
          </div>
        </div>
        <div className="ovmain">{cur && <ModuleDetail key={cur.module + JSON.stringify(plan.policy)} m={cur} plan={plan} setOverride={setOverride} />}</div>
      </div>
    </div>
  );
}

function appChoices(plan, m) {
  const r26 = Object.entries(R26_MAP.apps).filter(([, a]) => a.kind === "feature").map(([n]) => n);
  const created = plan.apps.filter((a) => a.kind === "new").map((a) => a.name);
  return [...new Set([m.home, ...r26, ...created, SHARED.commons])].sort();
}

export function ModuleDetail({ m, plan, setOverride }) {
  const [custom, setCustom] = useState("");
  const overridden = !!plan.overrides[m.module];
  const dests = {};
  for (const f of m.forms) { const k = `${f.dest.app} / ${f.dest.module}`; dests[k] = (dests[k] || 0) + 1; }
  return (
    <div className="vz-detail">
      <div className="ovhead">
        <div className="ovtitle">{m.module}</div>
        <span className="tag">{m.kind === "logic" ? "business logic only" : `${m.forms.length} forms`}{m.mvc ? ` · ${m.mvc.files} business / presentation files` : ""}</span>
      </div>
      <div className="vz-route">
        <div className="vz-route-from"><span>Monolith</span><b>{m.module}</b></div>
        <div className="vz-route-arrow"><i /></div>
        <div className="vz-route-to">
          {m.kind === "logic" ? <div><span>Micro app</span><b>{m.home}</b></div>
            : Object.entries(dests).map(([k, n]) => <div key={k}><span>{n} form{n === 1 ? "" : "s"}</span><b>{k}</b></div>)}
        </div>
      </div>
      <p className="note">{m.reason}{m.renamedTo && m.renamedTo !== m.module ? ` · R26 calls this module ${m.renamedTo}` : ""}</p>
      {m.split && (
        <div className="vz-splitbar">
          <span className="tag">Where R26 keeps these forms</span>
          <div className="vz-comp">{m.r26Apps.map(([a, n], i) => <i key={a} className={"vz-sp" + (i % 6)} style={{ width: `${(n / m.r26Apps.reduce((s, x) => s + x[1], 0)) * 100}%` }} title={`${a}: ${n}`} />)}</div>
          <div className="vz-splitlegend">{m.r26Apps.map(([a, n], i) => <span key={a}><i className={"vz-sp" + (i % 6)} />{a} {n}</span>)}</div>
        </div>
      )}
      <div className="vz-override">
        <b>Send this module to</b>
        <select value={m.home} onChange={(e) => setOverride(m.module, e.target.value)}>
          {appChoices(plan, m).map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <input type="text" placeholder="or a new micro app name…" value={custom} onChange={(e) => setCustom(e.target.value)} />
        <button className="btn tiny" disabled={!/^[A-Za-z][A-Za-z0-9_]*$/.test(custom.trim())} onClick={() => { setOverride(m.module, custom.trim()); setCustom(""); }}>Use</button>
        {overridden && <button className="btn ghost tiny" onClick={() => setOverride(m.module, null)}>Reset to suggested</button>}
      </div>
      {m.forms.length > 0 && (
        <table className="vz-forms">
          <thead><tr><th>Form</th><th>Goes to</th><th>R26 has it in</th><th>Status</th></tr></thead>
          <tbody>
            {m.forms.map((f, i) => (
              <tr key={f.ch + f.name} style={{ "--d": `${Math.min(i * 25, 800)}ms` }}>
                <td className="mono">{f.name}{f.ch !== "desktop" && f.ch !== "mobile" ? <span className="tag"> · {f.ch}</span> : ""}{f.controller ? "" : <span className="tag" title="no form controller"> · no controller</span>}</td>
                <td><b>{f.dest.app}</b><div className="tag">{f.dest.module}</div></td>
                <td>{f.r26.length ? f.r26.map((r) => <div key={r.app + r.module} className={f.owner && r.app === f.owner.app && r.module === f.owner.module ? "" : "tag"}>{r.app} / {r.module}</div>) : <span className="tag">—</span>}</td>
                <td><Badge status={f.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function ModuleDrawer({ module, plan, setOverride, onClose }) {
  const m = plan.modules.find((x) => x.module === module);
  useEffect(() => {
    const k = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  if (!m) return null;
  return (
    <div className="vz-drawer-wrap" onClick={onClose}>
      <div className="vz-drawer" onClick={(e) => e.stopPropagation()}>
        <button className="vz-close" onClick={onClose} aria-label="Close">×</button>
        <ModuleDetail m={m} plan={plan} setOverride={setOverride} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- review & agree
export function ReviewView({ plan, inv, setPolicy, overrides, setOverride, agreed, agree, projectName, header }) {
  // what each alternative would do, so the choice is made with numbers
  const alt = useMemo(() => {
    const out = {};
    for (const [k, vals] of Object.entries({ placement: ["module", "form"], naming: ["kbz", "r26"], unmatched: ["new", "nearest"] }))
      for (const v of vals) out[`${k}:${v}`] = buildPlan(inv, plan.channel, { ...plan.policy, [k]: v }, overrides).stats;
    return out;
  }, [inv, plan.channel, plan.policy, overrides]);
  const choices = [
    ["placement", "Where forms go", [
      ["module", "Keep modules whole", "Each monolith module moves as one piece into the micro app holding most of its forms in R26. Simpler, fewer cross-app links.", (s) => `${s.moved} forms sit in a different micro app than in R26`],
      ["form", "Follow R26 form by form", "Each form goes to the micro app R26 keeps it in; modules R26 splits are split the same way. Closest to R26.", (s) => `${s.splitModules} modules split · ${s.apps} micro apps`],
    ]],
    ["naming", "Module names", [
      ["kbz", "Keep monolith names", "Modules keep their current names inside the micro apps (e.g. AuthModule).", () => "no module renamed"],
      ["r26", "Use R26 names", "Where R26 has the form, the module takes R26's name (e.g. AuthModule → AuthUIModule).", (s) => `${s.renamed} modules renamed`],
    ]],
    ["unmatched", "Modules R26 doesn't have", [
      ["new", "New micro app each", "A module with no R26 counterpart becomes its own micro app.", (s) => `${s.newApps} new micro apps`],
      ["nearest", "Join the closest micro app", "It joins the existing micro app with the closest name; a new one only if nothing is close.", (s) => `${s.newApps} new micro apps`],
    ]],
  ];
  const ov = Object.entries(overrides);
  const stale = agreed && (JSON.stringify(agreed.policy) !== JSON.stringify(plan.policy) || JSON.stringify(agreed.overrides) !== JSON.stringify(overrides));
  const download = (name, text, type) => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); };
  return (
    <div>
      {header}
      <div className="vz-choices">
        {choices.map(([k, title, opts]) => (
          <div key={k} className="vz-choice">
            <h3>{title}</h3>
            <div className="vz-choice-opts">
              {opts.map(([v, t, d, impact]) => (
                <div key={v} className={"vz-choice-opt" + (plan.policy[k] === v ? " on" : "")} onClick={() => setPolicy((p) => ({ ...p, [k]: v }))}>
                  <div className="vz-choice-t"><span className="vz-radio" />{t}</div>
                  <div className="vz-choice-d">{d}</div>
                  <div className="vz-choice-i">{impact(alt[`${k}:${v}`])}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <h3 style={{ margin: "18px 0 6px" }}>Your changes to single modules ({ov.length})</h3>
      {ov.length ? (
        <table className="vz-forms">
          <thead><tr><th>Module</th><th>Sent to</th><th></th></tr></thead>
          <tbody>{ov.map(([m, a]) => <tr key={m}><td className="mono">{m}</td><td><b>{a}</b></td><td><button className="btn ghost tiny" onClick={() => setOverride(m, null)}>Reset</button></td></tr>)}</tbody>
        </table>
      ) : <p className="note">None — open a module (Flow, Micro apps or Modules & forms) to send it somewhere else.</p>}

      <div className={"vz-agree" + (agreed && !stale ? " done" : "")}>
        <div>
          <h3>{agreed && !stale ? "Plan agreed" : "Agree this plan"}</h3>
          <p className="note">
            {projectName} · {CHANNELS[plan.channel].label} · {plan.stats.forms} forms in {plan.stats.modules} modules → {plan.stats.apps} micro apps
            ({plan.stats.r26Apps} existing in R26, {plan.stats.newApps} new) · R26 {plan.release} map.
            {agreed && !stale ? ` Agreed ${agreed.date}.` : stale ? " The plan changed since it was agreed — agree again to record the new version." : " Agreeing records these choices; nothing is converted yet."}
          </p>
        </div>
        <div className="vz-agree-btns">
          <button className="btn" onClick={agree}>{agreed && !stale ? "Agree again" : "✓ Agree plan"}</button>
          <button className="btn ghost" onClick={() => download(`${projectName}_${plan.channel}_microapp_plan.csv`, planCsv(plan), "text/csv")}>Download CSV</button>
          <button className="btn ghost" onClick={() => download(`${projectName}_${plan.channel}_microapp_plan.json`, JSON.stringify({ project: projectName, channel: plan.channel, release: plan.release, policy: plan.policy, overrides, agreed: agreed && !stale ? agreed.date : null, stats: plan.stats, modules: plan.modules.map((m) => ({ module: m.module, kind: m.kind, home: m.home, reason: m.reason, forms: m.forms.map((f) => ({ form: f.name, channel: f.ch, app: f.dest.app, module: f.dest.module, status: f.status })) })) }, null, 2), "application/json")}>Download plan (JSON)</button>
        </div>
      </div>
    </div>
  );
}
