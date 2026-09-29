import { useState, useEffect } from "react";
import "./App.css";
import { extract, extractModule, buildModel, isMainController, controllerKey, isMvcController, mvcKey, mvcKind } from "./lib/analyzer";
import { TwoCol, ThreeCol } from "./components/DiffView";
import { Checklist } from "./components/Checklist";
import { FormsView } from "./components/Forms";
import { OverallView } from "./components/Overall";

const LABELS = ["R21", "KBZ", "R26"];
const PROJ_META = [
  { key: "r21", title: "R21", sub: "Base project · July 2021" },
  { key: "kbz", title: "KBZ", sub: "Customised · modified" },
  { key: "r26", title: "R26", sub: "Latest · R26.0.2" },
];

// menu: only "controllers" is functional; others are work-in-progress
const MENU = [
  { id: "home", ico: "◧", label: "Project Overview", desc: "Counts across R21 · KBZ · R26" },
  {
    id: "forms", ico: "▤", label: "FormForge", desc: "Forms retrofit",
    items: [{ id: "forms", label: "Form comparison", ready: true }, { id: "forms-all", label: "Overall comparison", ready: true }],
  },
  {
    id: "controllers", ico: "⚙", label: "CtrlSync", desc: "Form-level controllers",
    items: [{ id: "controllers", label: "Controller comparison", ready: true }, { id: "controllers-all", label: "Overall comparison", ready: true }],
  },
  {
    id: "mvc", ico: "❏", label: "MVC Bridge", desc: "Business & Presentation controllers",
    items: [{ id: "mvc", label: "Business & Presentation comparison", ready: true }, { id: "mvc-all", label: "Overall comparison", ready: true }],
  },
];

// scan a picked project folder (from FileList) — counts only, no file reads
function scanFolder(fileList) {
  const files = [...fileList];
  const rel = (f) => (f.webkitRelativePath || f.name).replace(/\\/g, "/");
  const forms = new Map(); // formKey (path under forms/, ending ".sm") -> Map(widgetId -> File)
  let business = 0, presentation = 0;
  const controllers = new Map();
  const mvc = new Map(); // <Module>/<Business|Presentation>Controllers/*.js -> File
  for (const f of files) {
    const p = rel(f), lp = p.toLowerCase();
    const fi = lp.indexOf("/forms/");
    if (fi >= 0 && lp.endsWith(".json")) {
      const m = p.slice(fi + 7).match(/^(.*?\.sm)\/([^/]+)\.json$/i);
      if (m) {
        if (!forms.has(m[1])) forms.set(m[1], new Map());
        forms.get(m[1]).set(m[2], f);
      }
    }
    if (lp.includes("/mvcextensions/") && lp.endsWith(".js")) {
      if (lp.includes("/businesscontrollers/")) business++;
      else if (lp.includes("/presentationcontrollers/")) presentation++;
      if (isMvcController(p)) mvc.set(mvcKey(p), f);
    }
    if (lp.includes("/controllers/") && isMainController(f.name)) controllers.set(controllerKey(p), f);
  }
  return { fileCount: files.length, counts: { forms: forms.size, controllers: controllers.size, business, presentation }, controllers, forms, mvc };
}

// Match files across R21/KBZ/R26 by key, then extract + compare each (shared by CtrlSync and MVC Bridge).
async function analyzeSets(maps, extractor, meta, onProgress) {
  const keys = [...new Set(maps.flatMap((m) => [...m.keys()]))].sort();
  onProgress({ done: 0, total: keys.length, running: true });
  const results = [];
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const base = { path: key, ...meta(key) };
    const fs = LABELS.map((l, k) => [l, maps[k].get(key)]);
    const present = fs.filter(([, f]) => f).map(([l]) => l);
    if (!fs[0][1] || !fs[1][1]) results.push({ ...base, incomplete: true, present });
    else {
      try {
        const files = [];
        for (const [label, f] of fs) if (f) { const src = await f.text(); files.push({ label, name: key, src, parsed: extractor(src) }); }
        results.push({ ...base, model: buildModel(files), present });
      } catch (e) { results.push({ ...base, error: String(e.message || e), present }); }
    }
    if (i % 5 === 0) { onProgress({ done: i + 1, total: keys.length, running: true }); await new Promise((r) => setTimeout(r)); }
  }
  onProgress({ done: keys.length, total: keys.length, running: false });
  return results;
}

export default function App() {
  const [picked, setPicked] = useState([null, null, null]); // per project: scan result
  const [entered, setEntered] = useState(false);
  const [side, setSide] = useState(true);       // sidebar expanded
  const [nav, setNav] = useState("home");
  const [openGroups, setOpenGroups] = useState(new Set(["forms", "controllers"]));

  // controller analysis (lazy)
  const [bulk, setBulk] = useState(null);
  const [analyzing, setAnalyzing] = useState(null);
  const [formScan, setFormScan] = useState({}); // per version-pair form property scan (kept across menu navigation)
  const [drill, setDrill] = useState(null);
  const [mvcBulk, setMvcBulk] = useState(null);
  const [mvcAnalyzing, setMvcAnalyzing] = useState(null);
  const [mvcDrill, setMvcDrill] = useState(null);
  const [overall, setOverall] = useState({}); // full-file comparison scans, per category + version pair
  const [tab, setTab] = useState("overview");
  const [member, setMember] = useState(null);
  const [view, setView] = useState("OLD_CUST");

  const onFolder = (i, fileList) => {
    const scan = scanFolder(fileList);
    setPicked((p) => { const c = [...p]; c[i] = scan; return c; });
  };
  const canEnter = picked[0] && picked[1];

  const runControllers = async () => {
    const results = await analyzeSets(picked.map((p) => (p ? p.controllers : new Map())), extract,
      (k) => ({ base: k.split("/").pop().replace(/\.js$/, "") }), setAnalyzing);
    setBulk({ results, unmatched: [] });
  };
  const runMvc = async () => {
    const results = await analyzeSets(picked.map((p) => (p ? p.mvc : new Map())), extractModule,
      (k) => ({ base: k.split("/")[0], kind: mvcKind(k) }), setMvcAnalyzing);
    setMvcBulk({ results, unmatched: [] });
  };

  // auto-run controller analysis the first time that view is opened
  useEffect(() => {
    if (nav === "controllers" && entered && !bulk && !(analyzing && analyzing.running)) runControllers();
    if (nav === "mvc" && entered && !mvcBulk && !(mvcAnalyzing && mvcAnalyzing.running)) runMvc();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nav, entered]);

  const openDrill = (i) => { setDrill(i); setTab("overview"); setView("OLD_CUST"); setMember(bulk.results[i].model.genuine[0] || null); };
  const openMvcDrill = (i) => { setMvcDrill(i); setTab("overview"); setView("OLD_CUST"); setMember(mvcBulk.results[i].model.genuine[0] || null); };
  const reportProps = { tab, setTab, member, setMember, view, setView };

  const goHome = () => { setEntered(false); setPicked([null, null, null]); setBulk(null); setDrill(null); setAnalyzing(null); setFormScan({}); setMvcBulk(null); setMvcDrill(null); setMvcAnalyzing(null); setOverall({}); setNav("home"); };

  return (
    <div>
      <div className="brand">
        <button className="burger" title="Menu" onClick={() => setSide((s) => !s)}><span /></button>
        <div className="logo">
          <span className="mark">Retr<span className="o">o</span>fit Studio</span>
          <span className="by">Powered by <span className="ava">avenza</span></span>
        </div>
        <div className="rt">
          {entered && <button className="pillbtn" onClick={goHome}>New project</button>}
        </div>
      </div>

      {!entered ? (
        <div style={{ maxWidth: 1000, margin: "0 auto", padding: "24px 18px" }}>
          <ProjectPick picked={picked} onFolder={onFolder} canEnter={canEnter} enter={() => { setEntered(true); setNav("home"); }} />
        </div>
      ) : (
        <div className={"shell" + (side ? "" : " side-collapsed")}>
          <Sidebar side={side} nav={nav} setNav={setNav} openGroups={openGroups} setOpenGroups={setOpenGroups} projects={picked} />
          <div className="content">
            {nav === "home" && <Home picked={picked} goto={setNav} />}
            {nav === "forms" && <FormsView picked={picked} labels={LABELS} scan={formScan} setScan={setFormScan} />}
            {nav === "forms-all" && <OverallView key="forms" cat="forms" picked={picked} cache={overall} setCache={setOverall} />}
            {nav === "controllers-all" && <OverallView key="controllers" cat="controllers" picked={picked} cache={overall} setCache={setOverall} />}
            {nav === "mvc-all" && <OverallView key="mvc" cat="mvc" picked={picked} cache={overall} setCache={setOverall} />}
            {nav === "controllers" && (
              <AnalysisView title="Controller Retrofit" crumb="Form-level controllers · KBZ customisations carried onto R26" noun="controllers"
                bulk={bulk} analyzing={analyzing} drill={drill} setDrill={setDrill} openDrill={openDrill} reportProps={reportProps} />
            )}
            {nav === "mvc" && (
              <AnalysisView title="Business & Presentation Retrofit" crumb="MVC extensions · business and presentation controller logic across R21 · KBZ · R26" noun="modules"
                bulk={mvcBulk} analyzing={mvcAnalyzing} drill={mvcDrill} setDrill={setMvcDrill} openDrill={openMvcDrill} reportProps={reportProps} showKind />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function AnalysisView({ title, crumb, noun, bulk, analyzing, drill, setDrill, openDrill, reportProps, showKind }) {
  if (drill != null && bulk) {
    const r = bulk.results[drill];
    return (
      <div>
        <button className="btn ghost" onClick={() => setDrill(null)} style={{ marginBottom: 10 }}>← All {noun}</button>
        <h2 className="page">{r.base}{r.kind && <span className={"kindpill k-" + r.kind}>{r.kind}</span>}</h2>
        <div className="crumb">{r.path}</div>
        <Report model={r.model} {...reportProps} widgets={!showKind} />
      </div>
    );
  }
  return (
    <div>
      <h2 className="page">{title}</h2>
      <div className="crumb">{crumb}</div>
      {analyzing && analyzing.running ? (
        <div style={{ maxWidth: 520 }}>
          <p className="note">Formatting &amp; comparing {noun}… {analyzing.done}/{analyzing.total}</p>
          <div className="progress"><div style={{ width: (analyzing.total ? analyzing.done / analyzing.total * 100 : 0) + "%" }} /></div>
        </div>
      ) : bulk ? (
        <Dashboard bulk={bulk} tokens={LABELS} openDrill={openDrill} showKind={showKind} noun={noun} />
      ) : (
        <p className="note">Preparing…</p>
      )}
    </div>
  );
}

function Sidebar({ side, nav, setNav, openGroups, setOpenGroups, projects }) {
  return (
    <div className={"side" + (side ? "" : " collapsed")}>
      <div className="menu">
        {MENU.map((m) => {
          const hasItems = !!m.items;
          const isOpen = openGroups.has(m.id);
          const active = nav === m.id;
          return (
            <div key={m.id} className={"mgroup" + (isOpen ? " open" : "")}>
              <div className={"mhead" + (active ? " active" : "")}
                onClick={() => {
                  if (hasItems) setOpenGroups((s) => { const c = new Set(s); if (c.has(m.id)) c.delete(m.id); else c.add(m.id); return c; });
                  else setNav(m.id);
                }}>
                <span className="ico">{m.ico}</span>
                <span className="lbl">{m.label}<div style={{ fontSize: 12.5, fontWeight: 400, color: "var(--side-muted)" }}>{m.desc}</div></span>
                {m.wip && <span className="wip">WIP</span>}
                {hasItems && <span className="chev">▶</span>}
              </div>
              {hasItems && (
                <div className="sub">
                  {m.items.map((it) => (
                    <div key={it.id} className={"subitem" + (nav === it.id ? " active" : "") + (it.ready ? "" : " disabled")}
                      onClick={() => it.ready && setNav(it.id)}>
                      <span className="dot" /> {it.label}{!it.ready && <span className="wip" style={{ marginLeft: 6 }}>soon</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="foot">{projects.filter(Boolean).length}/3 projects loaded</div>
    </div>
  );
}

function ProjectPick({ picked, onFolder, canEnter, enter }) {
  return (
    <div>
      <div className="rules">
        Upload the <b>three project folders</b> — <b>R21</b> (base), <b>KBZ</b> (customised) and <b>R26</b> (latest). The tool
        walks each project and inventories its <b>forms</b>, <b>form controllers</b>, and <b>MVC extensions</b> (business &amp;
        presentation controllers). Everything runs in your browser — nothing is uploaded.
      </div>
      <div className="folders">
        {PROJ_META.map((meta, i) => (
          <div key={meta.key} className={"folder" + (picked[i] ? " filled" : "")}>
            <h3>{meta.title} — {meta.sub}</h3>
            <div className="cnt">{picked[i] ? picked[i].counts.controllers : 0}</div>
            <div className="cl">controllers detected</div>
            <label className="pick">Choose {meta.title} folder
              <input type="file" webkitdirectory="" directory="" multiple style={{ display: "none" }} onChange={(e) => onFolder(i, e.target.files)} />
            </label>
            {picked[i] && <div className="sub2">{picked[i].counts.forms} forms · {picked[i].counts.business} business · {picked[i].counts.presentation} presentation</div>}
          </div>
        ))}
      </div>
      <div style={{ marginTop: 14 }}>
        <button className="btn" disabled={!canEnter} onClick={enter}>Open dashboard →</button>
        <span className="tag" style={{ marginLeft: 10 }}>R21 + KBZ required · R26 recommended.</span>
      </div>
    </div>
  );
}

function Home({ picked, goto }) {
  const base = picked[0] && picked[0].counts;
  const metric = (i, field) => (picked[i] ? picked[i].counts[field] : "—");
  const delta = (i, field) => {
    if (i === 0 || !picked[i] || !base) return null;
    const d = picked[i].counts[field] - base[field];
    if (d === 0) return null;
    return <span className={"delta " + (d > 0 ? "up" : "down")}>{d > 0 ? "+" : ""}{d}</span>;
  };
  const FIELDS = [["forms", "Forms"], ["controllers", "Controllers"], ["business", "Business Ctrl"], ["presentation", "Presentation Ctrl"]];
  return (
    <div>
      <h2 className="page">Project Overview</h2>
      <div className="crumb">Inventory across the three projects — open FormForge or CtrlSync from the menu to compare.</div>
      <div className="projgrid">
        {PROJ_META.map((meta, i) => (
          <div key={meta.key} className={"projcard " + meta.key}>
            <div className="top">
              <div><b style={{ fontSize: 15 }}>{meta.title}</b><div className="tag2">{meta.sub}</div></div>
              {picked[i] ? <span className="tag2">{picked[i].fileCount} files</span> : <span className="tag2">not loaded</span>}
            </div>
            <div className="metrics">
              {FIELDS.map(([f, l]) => (
                <div className="metric" key={f}>
                  <div className="mv">{metric(i, f)}{delta(i, f)}</div>
                  <div className="ml">{l}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 18 }}>
        <button className="btn" onClick={() => goto("forms")}>Compare forms →</button>{" "}
        <button className="btn" onClick={() => goto("controllers")}>Analyze controller retrofit →</button>
      </div>
    </div>
  );
}

function Wip({ title, icon }) {
  return (
    <div>
      <h2 className="page">{title}</h2>
      <div className="wipbox">
        <div className="big">{icon}</div>
        <h3>Work in progress</h3>
        <p>This module is being designed and will be committed soon. For now, <b>Controller Retrofit</b> is available.</p>
      </div>
    </div>
  );
}

/* ============================ per-controller report ============================ */
function Report({ model, tab, setTab, member, setMember, view, setView, widgets = true }) {
  const [O, C, N] = model.labels;
  const bc = {};
  Object.values(model.members).forEach((x) => { if (x.bucket) bc[x.bucket] = (bc[x.bucket] || 0) + 1; });
  const tabs = [["overview", "Overview"], ["genuine", `Genuine Changes (${C}→${O})`]];
  if (model.hasNew) tabs.push(["threeway", "3-Way + Buckets"], ["checklist", "Retrofit Checklist"]);
  if (model.hasNew && widgets) tabs.push(["widgets", "Widget Remap"]);
  const gotoMember = (name) => { setMember(name); setTab("genuine"); };
  return (
    <div>
      <div className="cards">
        {model.labels.map((l) => <div className="card" key={l}><div className="n">{model.counts[l]}</div><div className="l">{l} members</div></div>)}
        <div className="card"><div className="n">{model.genuine.length}</div><div className="l">{C} vs {O} changes</div></div>
        {model.hasNew && <div className="card"><div className="n">{[1, 2, 3, 4, 5].map((k) => bc[k] || 0).join("/")}</div><div className="l">buckets 1·2·3·4·5</div></div>}
      </div>
      <div className="tabs">
        {tabs.map(([k, t]) => <div key={k} className={"tab" + (k === tab ? " active" : "")} onClick={() => setTab(k)}>{t}</div>)}
      </div>
      <div className="view">
        {tab === "overview" && <Overview model={model} O={O} C={C} N={N} />}
        {tab === "genuine" && <Genuine model={model} O={O} C={C} N={N} member={member} setMember={setMember} view={view} setView={setView} />}
        {tab === "threeway" && <ThreeWay model={model} O={O} C={C} N={N} gotoMember={gotoMember} />}
        {tab === "checklist" && <Checklist model={model} />}
        {tab === "widgets" && <Widgets model={model} />}
      </div>
    </div>
  );
}

function Overview({ model, O, C, N }) {
  return (
    <div>
      <p className="note"><b>{O}</b> = old base · <b>{C}</b> = customisation on {O} · <b>{N || "—"}</b> = new base. Each {C} change must be re-expressed on {N || "the new base"}.</p>
      <table>
        <thead><tr><th>Module / class</th>{model.labels.map((l) => <th key={l}>{l}</th>)}</tr></thead>
        <tbody><tr><td>define()</td>{model.labels.map((l) => <td key={l} className="mono">{model.moduleNames[l] ? `"${model.moduleNames[l]}"` : "(anonymous)"}</td>)}</tr></tbody>
      </table>
      {model.hasNew && (
        <>
          <h3>Customisations to retrofit onto {N}</h3>
          <table>
            <thead><tr><th>Member</th><th>Change</th><th>Bucket</th><th>Note</th></tr></thead>
            <tbody>{model.genuine.map((n) => { const x = model.members[n]; return <tr key={n}><td><b>{n}</b></td><td><span className={"pill " + x.change}>{x.change}</span></td><td className={"b" + (x.bucket || "q")}>{x.bucket ? "Bucket " + x.bucket : ""}</td><td>{x.note}</td></tr>; })}</tbody>
          </table>
        </>
      )}
    </div>
  );
}

function Genuine({ model, O, C, N, member, setMember, view, setView }) {
  if (!model.genuine.length) return <p>No changes detected.</p>;
  const cur = member && model.genuine.includes(member) ? member : model.genuine[0];
  const x = model.members[cur];
  const views = [["OLD_CUST", `${O} vs ${C}`]];
  if (model.hasNew) views.push(["OLD_NEW", `${O} vs ${N}`], ["CUST_NEW", `${C} vs ${N}`], ["ALL3", "All 3"]);
  const pairMap = { OLD_CUST: [O, C], OLD_NEW: [O, N], CUST_NEW: [C, N] };
  const av = model.hasNew ? view : "OLD_CUST";
  return (
    <div className="split">
      <div className="memberlist">
        {model.genuine.map((n) => { const m = model.members[n]; return (
          <div key={n} className={"memrow" + (n === cur ? " sel" : "")} onClick={() => setMember(n)}>
            <b>{n}</b> <span className={"pill " + (m.change || "")}>{m.change}</span> {m.bucket && <span className={"pill b" + m.bucket}>B{m.bucket}</span>}
            {m.dups && Object.keys(m.dups).length > 0 && <span className="pill duppill" title="Defined more than once in the file — the later definition wins at runtime">defined {Object.entries(m.dups).map(([l, c]) => `${c}× in ${l}`).join(", ")}</span>}
            <div className="tag">{m.kind}{model.hasNew ? ` · in ${N}: ${m.inNew || ""}` : ""}</div>
          </div>); })}
      </div>
      <div>
        <h3 style={{ margin: "0 0 4px" }}>{cur}</h3>
        <div className="tag">kind: {x.kind} · change: {x.change || "—"} {x.bucket ? "· bucket " + x.bucket : ""}</div>
        {x.note && <div className="note">{x.note}</div>}
        <div className="seg">{views.map(([k, t]) => <button key={k} className={k === av ? "on" : ""} onClick={() => setView(k)}>{t}</button>)}</div>
        {av === "ALL3" ? (
          <>
            <div className="legend"><span style={{ background: "var(--add-bg)" }}>green = added vs {O}</span> <span style={{ background: "var(--del-bg)" }}>red = missing vs {O}</span> <span style={{ background: "var(--chg-bg)" }}>amber = {O} line changed in a branch</span></div>
            <ThreeCol base={x.bodies[O]} custom={x.bodies[C]} next={x.bodies[N]} lo={O} lc={C} ln={N} />
          </>
        ) : (() => { const [la, lb] = pairMap[av]; return (
          <>
            <div className="legend"><span style={{ background: "var(--del-bg)" }}>red = only in {la}</span> <span style={{ background: "var(--add-bg)" }}>green = only in {lb}</span></div>
            <TwoCol aBody={x.bodies[la]} bBody={x.bodies[lb]} la={la} lb={lb} />
          </>); })()}
      </div>
    </div>
  );
}

function ThreeWay({ model, O, C, N, gotoMember }) {
  const rows = Object.keys(model.members).filter((n) => model.members[n].note);
  return (
    <div>
      <p className="note">Members with a {C} delta vs {O}. Click a row to inspect the diff.</p>
      <table>
        <thead><tr><th>#</th><th>Member</th><th>{O}</th><th>{C}</th><th>{N}</th><th>Bucket</th><th>Note</th></tr></thead>
        <tbody>{rows.map((n, i) => { const x = model.members[n]; const mk = (l) => (x.present[l] ? "Y" : "–"); return (
          <tr key={n} style={{ cursor: "pointer" }} onClick={() => gotoMember(n)}>
            <td>{i + 1}</td><td><b>{n}</b></td>
            <td style={{ textAlign: "center" }}>{mk(O)}</td><td style={{ textAlign: "center" }}>{mk(C)}</td><td style={{ textAlign: "center" }}>{mk(N)}</td>
            <td className={"b" + (x.bucket || "q")} style={{ textAlign: "center" }}>{x.bucket}</td><td>{x.note}</td>
          </tr>); })}</tbody>
      </table>
    </div>
  );
}

function Widgets({ model }) {
  const w = model.widgets.filter((x) => x.remap);
  return (
    <div>
      <p className="note">Widgets whose presence differs across versions — a likely field/index remap. A <span style={{ background: "var(--del-bg)", padding: "0 6px" }}>0</span> means the widget is absent (form-layer work).</p>
      <table>
        <thead><tr><th>Widget token</th>{model.labels.map((l) => <th key={l}>{l}</th>)}</tr></thead>
        <tbody>{w.map((x) => (
          <tr key={x.token}><td className="mono">{x.token}</td>{model.labels.map((l) => <td key={l} style={{ textAlign: "center", background: x.counts[l] === 0 ? "var(--del-bg)" : undefined }}>{x.counts[l]}</td>)}</tr>
        ))}</tbody>
      </table>
      <p className="tag">{w.length} of {model.widgets.length} widget tokens differ.</p>
    </div>
  );
}

/* ============================ controllers dashboard ============================ */
function Dashboard({ bulk, tokens, openDrill, showKind, noun = "controllers" }) {
  const [BASE, CUST] = tokens;
  const [q, setQ] = useState("");
  const [onlyChanged, setOnlyChanged] = useState(true);
  const KINDS = ["Business", "Presentation", "Extension"];
  const [kinds, setKinds] = useState(new Set(KINDS));
  const toggleKind = (k) => setKinds((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const [sort, setSort] = useState({ key: "changes", dir: "desc" });

  const rows = bulk.results.map((r, i) => {
    const bcc = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    if (r.model) Object.values(r.model.members).forEach((x) => { if (x.bucket && bcc[x.bucket] !== undefined) bcc[x.bucket]++; });
    return { ...r, i, changes: r.model ? r.model.genuine.length : 0, conflicts: bcc[2], customOnly: bcc[4], bc: bcc };
  });
  const okRows = rows.filter((r) => r.model);
  const agg = {
    total: bulk.results.length, changed: okRows.filter((r) => r.changes > 0).length,
    changes: okRows.reduce((s, r) => s + r.changes, 0),
    conflicts: okRows.reduce((s, r) => s + r.conflicts, 0),
    customOnly: okRows.reduce((s, r) => s + r.customOnly, 0),
  };
  let viewRows = rows.filter((r) => (!onlyChanged || r.changes > 0) && (!showKind || kinds.has(r.kind))
    && (!q || r.base.toLowerCase().includes(q.toLowerCase()) || (r.path || "").toLowerCase().includes(q.toLowerCase())));
  const dir = sort.dir === "asc" ? 1 : -1;
  viewRows = [...viewRows].sort((a, b) => sort.key === "name" ? dir * a.base.localeCompare(b.base) : dir * ((a[sort.key] || 0) - (b[sort.key] || 0)) || a.base.localeCompare(b.base));
  const top = okRows.filter((r) => r.changes > 0).sort((a, b) => b.changes - a.changes).slice(0, 10);
  const maxC = Math.max(1, ...top.map((r) => r.changes));
  const setSortKey = (key) => setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" }));
  const arrow = (key) => (sort.key === key ? (sort.dir === "asc" ? " ▲" : " ▼") : "");

  const exportCsv = () => {
    const out = [[showKind ? "module" : "controller", "type", "path", "member", "change", "bucket", "in_new", "note"]];
    okRows.forEach((r) => r.model.genuine.forEach((n) => { const x = r.model.members[n]; out.push([r.base, r.kind || "", r.path || "", n, x.change, x.bucket, x.inNew || "", (x.note || "").replace(/\s+/g, " ")]); }));
    const csv = out.map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = `${noun}_changes.csv`; a.click();
  };
  const BucketBar = ({ bc }) => { const tot = [1, 2, 3, 4, 5].reduce((s, k) => s + bc[k], 0) || 1; return (
    <span className="bucketbar" title={`clean:${bc[1]} conflict:${bc[2]} in-new:${bc[3]} custom-only:${bc[4]} new-only:${bc[5]}`}>
      {[1, 2, 3, 4, 5].map((k) => bc[k] > 0 ? <i key={k} className={"s" + k} style={{ width: (bc[k] / tot) * 120 + "px" }} /> : null)}
    </span>); };

  return (
    <div>
      <div className="cards">
        <div className="card"><div className="n">{agg.total}</div><div className="l">{noun}</div></div>
        <div className="card"><div className="n">{agg.changed}</div><div className="l">customised ({CUST}≠{BASE})</div></div>
        <div className="card"><div className="n">{agg.changes}</div><div className="l">total changes</div></div>
        <div className="card"><div className="n" style={{ color: "var(--chg-mark)" }}>{agg.conflicts}</div><div className="l">conflicts (bucket 2)</div></div>
        <div className="card"><div className="n">{agg.customOnly}</div><div className="l">custom-only (bucket 4)</div></div>
      </div>
      {top.length > 0 && (
        <div className="chart">
          <div className="tag" style={{ marginBottom: 2 }}>Top controllers by change volume — click to open</div>
          {top.map((r) => (
            <div className="row" key={r.path || r.base}>
              <span className="cname" onClick={() => openDrill(r.i)} title={r.path || r.base}>{r.base}{r.kind ? ` · ${r.kind}` : ""}</span>
              <span className="bar" style={{ width: (r.changes / maxC) * 100 + "%" }} />
              <span style={{ textAlign: "right" }}>{r.changes}</span>
            </div>
          ))}
        </div>
      )}
      <div className="searchbar">
        <input type="text" placeholder={`Search ${noun}…`} value={q} onChange={(e) => setQ(e.target.value)} />
        <span className={"chip" + (onlyChanged ? " on" : "")} onClick={() => setOnlyChanged((v) => !v)}>{onlyChanged ? "✓ " : ""}only changed</span>
        {showKind && KINDS.map((k) => (
          <span key={k} className={"chip" + (kinds.has(k) ? " on" : "")} onClick={() => toggleKind(k)}>{kinds.has(k) ? "✓ " : ""}{k}</span>
        ))}
        <span className="tag">{viewRows.length} shown</span>
        <span className="spacer" />
        <button className="btn" onClick={exportCsv}>Export changes (CSV)</button>
      </div>
      <div className="view" style={{ borderRadius: 10, border: "1px solid var(--line)", maxHeight: "60vh", overflow: "auto" }}>
        <table>
          <thead>
            <tr>
              <th className="sortable" onClick={() => setSortKey("name")}>Controller{arrow("name")}</th>
              {showKind && <th>Type</th>}
              {tokens.map((t) => <th key={t} style={{ textAlign: "center" }}>{t}</th>)}
              <th className="sortable" style={{ textAlign: "center" }} onClick={() => setSortKey("changes")}>Changes{arrow("changes")}</th>
              <th className="sortable" style={{ textAlign: "center" }} onClick={() => setSortKey("conflicts")}>Conflicts{arrow("conflicts")}</th>
              <th>Buckets</th><th>Status</th>
            </tr>
          </thead>
          <tbody>
            {viewRows.map((r) => { const clickable = !!r.model; return (
              <tr key={r.path || r.base} className={clickable ? "clickable" : ""} style={{ cursor: clickable ? "pointer" : "default" }} onClick={() => clickable && openDrill(r.i)}>
                <td><b style={{ color: clickable ? "var(--accent)" : "inherit" }}>{r.base}</b>{r.path && <div className="tag" style={{ maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.path}</div>}</td>
                {showKind && <td><span className={"kindpill k-" + r.kind}>{r.kind}</span></td>}
                {tokens.map((t) => <td key={t} style={{ textAlign: "center" }}>{(r.present || []).includes(t) ? "✓" : "–"}</td>)}
                <td style={{ textAlign: "center", fontWeight: 700 }}>{r.model ? r.changes : "—"}</td>
                <td style={{ textAlign: "center", color: r.conflicts ? "var(--chg-mark)" : "inherit" }}>{r.model ? r.conflicts : "—"}</td>
                <td>{r.model ? <BucketBar bc={r.bc} /> : "—"}</td>
                <td>{r.model ? <span className="pill Added">ok</span> : r.incomplete ? <span className="pill Modified">missing</span> : <span className="pill Removed">parse err</span>}</td>
              </tr>); })}
          </tbody>
        </table>
      </div>
      <p className="tag" style={{ marginTop: 8 }}>
        Buckets: <span className="chip" style={{ background: "var(--add-mark)", color: "#fff" }}>1 clean</span> <span className="chip" style={{ background: "var(--chg-mark)", color: "#111" }}>2 conflict</span> <span className="chip" style={{ background: "#5b8def", color: "#fff" }}>3 in-new</span> <span className="chip" style={{ background: "#4caf7d", color: "#fff" }}>4 custom-only</span> <span className="chip" style={{ background: "#c9cdd4", color: "#111" }}>5 new-only</span>
      </p>
    </div>
  );
}
