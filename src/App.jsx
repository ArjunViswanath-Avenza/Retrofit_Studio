import { useState, useEffect } from "react";
import "./App.css";
import { extractComponent, extractModule, buildModel, mvcKind } from "./lib/analyzer";
import { TwoCol, ThreeCol } from "./components/DiffView";
import { Checklist } from "./components/Checklist";
import { FormsView } from "./components/Forms";
import { OverallView } from "./components/Overall";
import { ComponentsView } from "./components/Components";
import { analyzeComponents } from "./lib/components";
import { scanFolder } from "./lib/scan";
import { MicroAppUpload, MicroAppMap } from "./components/MicroApps";
import { scanMicroApps, alignMicroApps, missingMicroApps, channelScan, CHANNELS } from "./lib/microapps";
import { LoomSync, FabricPickers } from "./components/Fabric";
import { scanFabricFolder, analyzeFabric } from "./lib/fabric";
import { VersionNames, VersionNamesPanel } from "./components/VersionNames";
import { loadNames, saveNames, validate, clean } from "./lib/names";

// Version names are user-editable per workspace (components/VersionNames.jsx); L = [base, customised, new release]
// for the Visualizer workspaces and [customised, new release] for Fabric. These keys only pick card colours.
const PROJ_KEYS = ["r21", "kbz", "r26"];
const names3 = (L) => L.join(" · ");

// Three workspaces, each with its own upload screen and its own menu.
const WORKSPACES = {
  ui: {
    title: "Visualizer", sub: "Monolith to monolith", ico: "▤", short: "Monolith",
    desc: (L) => `Compare three Visualizer projects — ${L[0]} (base), ${L[1]} (customised) and ${L[2]} (new release): forms, controllers, MVC extensions and user widgets.`,
    covers: ["FormForge · forms", "CtrlSync · form controllers", "MVC Bridge · business & presentation", "COMP-are · user widgets"],
  },
  ma: {
    title: "Visualizer", sub: "Monolith to micro app", ico: "❖", short: "Micro app",
    desc: (L) => `Compare the ${L[0]} and ${L[1]} monoliths (web or mobile) with the ${L[2]} micro-app architecture — every form, controller, presentation / business controller and user widget is located in its new micro app first.`,
    covers: ["Micro-app map", "FormForge · forms", "CtrlSync · form controllers", "MVC Bridge", "COMP-are · user widgets"],
  },
  fabric: {
    title: "Fabric", sub: "Fabric app comparison", ico: "≋", short: "Fabric",
    desc: (L) => `Compare two exported Fabric apps — ${L[0]} and ${L[1]} — service by service with LoomSync.`,
    covers: ["Integration", "Object", "Orchestration", "Identity", "Workflow & app manifest"],
  },
};

const uiMenu = (L) => [
  { id: "home", ico: "◧", label: "Project Overview", desc: `Counts across ${names3(L)}` },
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
  {
    id: "comps", ico: "⧉", label: "COMP-are", desc: "User widgets (components)",
    items: [{ id: "comps", label: "Component comparison", ready: true }, { id: "comps-all", label: "Overall comparison", ready: true }],
  },
];

const maMenu = (L) => [{ id: "home", ico: "❖", label: "Micro-app map", desc: `Where monolith items live in ${L[2]}` }, ...uiMenu(L).slice(1)];

const fabMenu = (L) => [
  { id: "fab-overview", ico: "≋", label: "LoomSync Overview", desc: `All service types · ${L[0]} vs ${L[1]}` },
  { id: "fab-Integration", ico: "⇄", label: "Integration", desc: "Endpoints & operations" },
  { id: "fab-Object", ico: "◫", label: "Object", desc: "Objects, fields & mappings" },
  { id: "fab-Orchestration", ico: "⛓", label: "Orchestration", desc: "Composite & looping operations" },
  { id: "fab-Identity", ico: "🔑", label: "Identity", desc: "Identity providers" },
  { id: "fab-Workflow", ico: "↯", label: "Workflow", desc: "Workflow services" },
  { id: "fab-App", ico: "▣", label: "App manifest", desc: "Service lists" },
];

// Match files across the three versions by key, then extract + compare each (shared by CtrlSync and MVC Bridge).
async function analyzeSets(maps, extractor, meta, onProgress, labels) {
  const keys = [...new Set(maps.flatMap((m) => [...m.keys()]))].sort();
  onProgress({ done: 0, total: keys.length, running: true });
  const results = [];
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const base = { path: key, ...meta(key) };
    const fs = labels.map((l, k) => [l, maps[k].get(key)]);
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
  const [mode, setMode] = useState(null); // null = workspace picker · "ui" monolith · "ma" micro app · "fabric"
  const [names, setNames] = useState(loadNames); // { ui: [{name, sub}×3], ma: [...], fabric: [{name, sub}×2] }
  const [namesOpen, setNamesOpen] = useState(false);
  const labelsOf = (ws) => clean(names[ws]).map((x) => x.name);
  const L = { ui: labelsOf("ui"), ma: labelsOf("ma"), fabric: labelsOf("fabric") };
  const setNamesFor = (ws, list) => setNames((n) => { const c = { ...n, [ws]: list }; saveNames(c); return c; });
  const [side, setSide] = useState(true); // sidebar expanded
  const [openGroups, setOpenGroups] = useState(new Set(["forms", "controllers"]));

  // Visualizer · monolith to monolith
  const [picked, setPicked] = useState([null, null, null]);
  const [uiEntered, setUiEntered] = useState(false);
  const [uiNav, setUiNav] = useState("home");
  // Visualizer · monolith to micro app
  const [maChannel, setMaChannel] = useState("web");
  const [maPick, setMaPick] = useState([null, null, null]); // R21 monolith, KBZ monolith, R26 micro-app folder
  const [maAligned, setMaAligned] = useState(null); // { picked: [R21, KBZ, aligned R26], report, missing, channel }
  const [maAligning, setMaAligning] = useState(null);
  const [maNav, setMaNav] = useState("home");
  // Fabric
  const [fab, setFab] = useState([null, null]);
  const [fabEntered, setFabEntered] = useState(false);
  const [fabNav, setFabNav] = useState("fab-overview");
  const [fabBulk, setFabBulk] = useState(null);
  const [fabAnalyzing, setFabAnalyzing] = useState(null);
  const [fabSel, setFabSel] = useState(null); // { type, svc, unit }

  const entered = { ui: uiEntered, ma: !!maAligned, fabric: fabEntered };
  const uiReady = picked[0] && picked[1] && !validate(names.ui);
  const fabReady = fab[0] && fab[1] && !validate(names.fabric);
  const maReady = maPick[0] && maPick[1] && maPick[2] && !validate(names.ma);

  const onFolder = (i, fileList) => {
    const scan = scanFolder(fileList);
    setPicked((p) => { const c = [...p]; c[i] = scan; return c; });
  };
  const onMaFolder = (i, fileList) => {
    const scan = i === 2 ? scanMicroApps(fileList, scanFolder) : scanFolder(fileList);
    setMaPick((p) => { const c = [...p]; c[i] = scan; return c; });
  };
  const onFabFolder = (i, fileList) => {
    const scan = scanFabricFolder(fileList);
    setFab((p) => { const c = [...p]; c[i] = scan; return c; });
    setFabBulk(null); setFabSel(null);
  };
  const startMa = async () => {
    const C = CHANNELS[maChannel];
    const mono = [channelScan(maPick[0], C.mono), channelScan(maPick[1], C.mono)];
    const missing = await missingMicroApps(maPick[2]);
    const { r26, report } = await alignMicroApps(mono, maPick[2], maChannel, setMaAligning);
    setMaAligned({ picked: [mono[0], mono[1], r26], report, missing, channel: maChannel });
    setMaNav("home");
  };

  useEffect(() => {
    if (mode === "fabric" && fabEntered && fabReady && !fabBulk && !(fabAnalyzing && fabAnalyzing.running)) {
      analyzeFabric(fab, L.fabric, setFabAnalyzing).then(setFabBulk);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, fabEntered, fab, fabBulk]);

  // "New project" clears only the current workspace and returns to its upload screen
  const reset = {
    ui: () => { setUiEntered(false); setPicked([null, null, null]); setUiNav("home"); },
    ma: () => { setMaAligned(null); setMaPick([null, null, null]); setMaAligning(null); setMaNav("home"); },
    fabric: () => { setFabEntered(false); setFab([null, null]); setFabBulk(null); setFabAnalyzing(null); setFabSel(null); setFabNav("fab-overview"); },
  };
  const status = {
    ui: uiEntered ? `Loaded · ${L.ui.filter((m, i) => picked[i]).join(" · ")}` : picked.some(Boolean) ? `${picked.filter(Boolean).length}/3 projects picked` : "Not loaded yet",
    ma: maAligned ? `Loaded · ${CHANNELS[maAligned.channel].label}` : maPick.some(Boolean) ? `${maPick.filter(Boolean).length}/3 folders picked` : "Not loaded yet",
    fabric: fabEntered ? `Loaded · ${names3(L.fabric)}` : fab.some(Boolean) ? `${fab.filter(Boolean).length}/2 exports picked` : "Not loaded yet",
  };
  const shellProps = (m, nav, setNav, menu, foot) => ({ hidden: mode !== m, side, nav, setNav, openGroups, setOpenGroups, menu, workspace: WORKSPACES[m], foot });

  return (
    <div>
      <div className="brand">
        {mode && entered[mode] && <button className="burger" title="Menu" onClick={() => setSide((v) => !v)}><span /></button>}
        <div className="logo" style={{ cursor: "pointer" }} onClick={() => setMode(null)} title="Workspaces">
          <span className="mark">Retr<span className="o">o</span>fit Studio</span>
          <span className="by">Powered by <span className="ava">avenza</span></span>
        </div>
        {mode && (
          <div className="wsswitch">
            {Object.entries(WORKSPACES).map(([k, w]) => (
              <button key={k} className={k === mode ? "on" : ""} onClick={() => setMode(k)} title={`${w.title} · ${w.sub}`}>{w.ico} {w.short}</button>
            ))}
          </div>
        )}
        <div className="rt">
          {mode && entered[mode] && <button className="pillbtn" onClick={() => setNamesOpen((v) => !v)}>✎ Version names</button>}
          {mode && <button className="pillbtn" onClick={() => setMode(null)}>⌂ Workspaces</button>}
          {mode && entered[mode] && <button className="pillbtn" onClick={reset[mode]}>New project</button>}
        </div>
      </div>

      {namesOpen && mode && entered[mode] && (
        <VersionNamesPanel key={mode} ws={mode} value={names[mode]} onClose={() => setNamesOpen(false)}
          onApply={(list) => { setNamesFor(mode, list); if (mode === "fabric") { setFabBulk(null); setFabAnalyzing(null); } }} />
      )}
      {!mode && (
        <div style={{ maxWidth: 1180, margin: "0 auto", padding: "28px 18px" }}>
          <Landing status={status} done={entered} open={setMode} labels={L} />
        </div>
      )}
      {mode && !entered[mode] && (
        <div style={{ maxWidth: 1000, margin: "0 auto", padding: "24px 18px" }}>
          <button className="btn ghost" onClick={() => setMode(null)} style={{ marginBottom: 12 }}>← Workspaces</button>
          {mode === "ui" && (
            <ProjectPick picked={picked} onFolder={onFolder} canEnter={uiReady} enter={() => { setUiEntered(true); setUiNav("home"); }}
              names={names.ui} setNames={(x) => setNamesFor("ui", x)} />
          )}
          {mode === "ma" && (
            <MicroAppUpload channel={maChannel} setChannel={setMaChannel} pick={maPick} onFolder={onMaFolder}
              canEnter={maReady} enter={startMa} aligning={maAligning} labels={L.ma}
              editor={<VersionNames ws="ma" value={names.ma} onChange={(x) => setNamesFor("ma", x)} />} />
          )}
          {mode === "fabric" && (
            <FabricUpload fab={fab} onFabFolder={onFabFolder} canEnter={fabReady} enter={() => { setFabEntered(true); setFabNav("fab-overview"); }}
              names={names.fabric} setNames={(x) => setNamesFor("fabric", x)} />
          )}
        </div>
      )}

      {/* loaded workspaces stay mounted (hidden when not current) so their analyses survive switching */}
      {uiEntered && (
        <Shell {...shellProps("ui", uiNav, setUiNav, uiMenu(L.ui), `${picked.filter(Boolean).length}/3 projects loaded · ${names3(L.ui)}`)}>
          <VisualizerWorkspace key={L.ui.join("|")} picked={picked} labels={L.ui} nav={uiNav} setNav={setUiNav} active={mode === "ui"}
            home={<Home picked={picked} goto={setUiNav} names={clean(names.ui)} />} />
        </Shell>
      )}
      {maAligned && (
        <Shell {...shellProps("ma", maNav, setMaNav, maMenu(L.ma), `${CHANNELS[maAligned.channel].label} · ${maAligned.picked[2].microApps} ${L.ma[2]} projects`)}>
          <VisualizerWorkspace key={L.ma.join("|")} picked={maAligned.picked} labels={L.ma} nav={maNav} setNav={setMaNav} active={mode === "ma"}
            home={<MicroAppMap aligned={maAligned} goto={setMaNav} labels={L.ma} />} />
        </Shell>
      )}
      {fabEntered && (
        <Shell {...shellProps("fabric", fabNav, setFabNav, fabMenu(L.fabric), `${L.fabric[0]} · ${L.fabric[1]} Fabric exports loaded`)}>
          {fabNav.startsWith("fab-") && (
            <LoomSync type={fabNav === "fab-overview" ? null : fabNav.slice(4)} fab={fab} onFabFolder={onFabFolder} labels={L.fabric}
              bulk={fabBulk} analyzing={fabAnalyzing} sel={fabSel}
              setSel={(x) => { setFabSel(x); if (x && x.type) setFabNav("fab-" + x.type); }}
              goType={(t) => { setFabSel(null); setFabNav("fab-" + t); }} />
          )}
        </Shell>
      )}
    </div>
  );
}

function Shell({ hidden, side, nav, setNav, openGroups, setOpenGroups, menu, workspace, foot, children }) {
  return (
    <div className={"shell" + (side ? "" : " side-collapsed")} style={hidden ? { display: "none" } : undefined}>
      <Sidebar side={side} nav={nav} setNav={setNav} openGroups={openGroups} setOpenGroups={setOpenGroups} menu={menu} workspace={workspace} foot={foot} />
      <div className="content">{children}</div>
    </div>
  );
}

// One Visualizer comparison (R21 · KBZ · R26) with its own analysis state. Used twice: monolith-to-monolith and
// monolith-to-micro-app (where picked[2] is R26 re-keyed onto the monolith's names by the micro-app map).
function VisualizerWorkspace({ picked, labels, nav, setNav, active, home }) {
  const [bulk, setBulk] = useState(null);
  const [analyzing, setAnalyzing] = useState(null);
  const [formScan, setFormScan] = useState({}); // per version-pair form property scan (kept across menu navigation)
  const [drill, setDrill] = useState(null);
  const [mvcBulk, setMvcBulk] = useState(null);
  const [mvcAnalyzing, setMvcAnalyzing] = useState(null);
  const [mvcDrill, setMvcDrill] = useState(null);
  const [overall, setOverall] = useState({}); // full-file comparison scans, per category + version pair
  const [compBulk, setCompBulk] = useState(null);
  const [compAnalyzing, setCompAnalyzing] = useState(null);
  const [compDrill, setCompDrill] = useState(null);
  const [compAspect, setCompAspect] = useState("structure");
  const [tab, setTab] = useState("overview");
  const [member, setMember] = useState(null);
  const [view, setView] = useState("OLD_CUST");

  const runControllers = async () => {
    // extractComponent reads both controller styles: define({...}) and define([deps], function(){ return {...} })
    const results = await analyzeSets(picked.map((p) => (p ? p.controllers : new Map())), extractComponent,
      (k) => ({ base: k.split("/").pop().replace(/\.js$/, "") }), setAnalyzing, labels);
    setBulk({ results, unmatched: [] });
  };
  const runMvc = async () => {
    const results = await analyzeSets(picked.map((p) => (p ? p.mvc : new Map())), extractModule,
      (k) => ({ base: k.split("/")[0], kind: mvcKind(k) }), setMvcAnalyzing, labels);
    setMvcBulk({ results, unmatched: [] });
  };
  const runComps = async () => {
    const results = await analyzeComponents(picked.map((p) => (p ? p.comps : null)), labels, setCompAnalyzing);
    setCompBulk({ results });
  };

  // run an analysis the first time its view is opened
  useEffect(() => {
    if (!active) return;
    if (nav === "controllers" && !bulk && !(analyzing && analyzing.running)) runControllers();
    if (nav === "mvc" && !mvcBulk && !(mvcAnalyzing && mvcAnalyzing.running)) runMvc();
    if (nav === "comps" && !compBulk && !(compAnalyzing && compAnalyzing.running)) runComps();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nav, active]);

  const openDrill = (i) => { setDrill(i); setTab("overview"); setView("OLD_CUST"); setMember(bulk.results[i].model.genuine[0] || null); };
  const openMvcDrill = (i) => { setMvcDrill(i); setTab("overview"); setView("OLD_CUST"); setMember(mvcBulk.results[i].model.genuine[0] || null); };
  const reportProps = { tab, setTab, member, setMember, view, setView };
  const openCompDrill = (i) => { setCompDrill(i); setCompAspect("structure"); setTab("overview"); setView("OLD_CUST"); setMember(null); };
  const changeCompAspect = (k) => { setCompAspect(k); setMember(null); };
  void setNav;

  return (
    <>
      {nav === "home" && home}
      {nav === "forms" && <FormsView picked={picked} labels={labels} scan={formScan} setScan={setFormScan} />}
      {nav === "forms-all" && <OverallView key="forms" cat="forms" picked={picked} labels={labels} cache={overall} setCache={setOverall} />}
      {nav === "controllers-all" && <OverallView key="controllers" cat="controllers" picked={picked} labels={labels} cache={overall} setCache={setOverall} />}
      {nav === "mvc-all" && <OverallView key="mvc" cat="mvc" picked={picked} labels={labels} cache={overall} setCache={setOverall} />}
      {nav === "comps-all" && <OverallView key="comps" cat="comps" picked={picked} labels={labels} cache={overall} setCache={setOverall} />}
      {nav === "comps" && (
        <ComponentsView picked={picked} labels={labels.filter((l, i) => i < 2 || picked[2])} bulk={compBulk} analyzing={compAnalyzing}
          drill={compDrill} setDrill={(i) => (i == null ? setCompDrill(null) : openCompDrill(i))}
          aspect={compAspect} setAspect={changeCompAspect} overall={overall} setOverall={setOverall}
          renderReport={(model) => <Report model={model} {...reportProps} widgets={false} />} />
      )}
      {nav === "controllers" && (
        <AnalysisView title="Controller Retrofit" crumb={`Form-level controllers · ${labels[1]} customisations carried onto ${labels[2]}`} noun="controllers" labels={labels}
          bulk={bulk} analyzing={analyzing} drill={drill} setDrill={setDrill} openDrill={openDrill} reportProps={reportProps} />
      )}
      {nav === "mvc" && (
        <AnalysisView title="Business & Presentation Retrofit" crumb={`MVC extensions · business and presentation controller logic across ${names3(labels)}`} noun="modules" labels={labels}
          bulk={mvcBulk} analyzing={mvcAnalyzing} drill={mvcDrill} setDrill={setMvcDrill} openDrill={openMvcDrill} reportProps={reportProps} showKind />
      )}
    </>
  );
}

function AnalysisView({ title, crumb, noun, bulk, analyzing, drill, setDrill, openDrill, reportProps, showKind, labels }) {
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
        <Dashboard bulk={bulk} tokens={labels} openDrill={openDrill} showKind={showKind} noun={noun} />
      ) : (
        <p className="note">Preparing…</p>
      )}
    </div>
  );
}

function Sidebar({ side, nav, setNav, openGroups, setOpenGroups, menu, workspace, foot }) {
  return (
    <div className={"side" + (side ? "" : " collapsed")}>
      <div className="wshead" title={workspace.sub}>
        <span className="ico">{workspace.ico}</span>
        <span className="lbl">{workspace.title}<div>{workspace.sub}</div></span>
      </div>
      <div className="menu">
        {menu.map((m) => {
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
      <div className="foot">{foot}</div>
    </div>
  );
}

function ProjectPick({ picked, onFolder, canEnter, enter, names, setNames }) {
  const N = clean(names);
  return (
    <div>
      <h2 className="page">▤ Visualizer · Monolith to monolith</h2>
      <div className="crumb">Step 1 — load the three Visualizer projects, then start the comparison.</div>
      <div className="rules">
        Upload the <b>three project folders</b> — <b>{N[0].name}</b> (base), <b>{N[1].name}</b> (customised) and <b>{N[2].name}</b> (new release). The tool
        walks each project and inventories its <b>forms</b>, <b>form controllers</b>, and <b>MVC extensions</b> (business &amp;
        presentation controllers). Everything runs in your browser — nothing is uploaded.
      </div>
      <VersionNames ws="ui" value={names} onChange={setNames} />
      <div className="folders">
        {N.map((meta, i) => (
          <div key={PROJ_KEYS[i]} className={"folder" + (picked[i] ? " filled" : "")}>
            <h3>{meta.name || "—"}{meta.sub ? ` — ${meta.sub}` : ""}</h3>
            <div className="cnt">{picked[i] ? picked[i].counts.controllers : 0}</div>
            <div className="cl">controllers detected</div>
            <label className="pick">Choose {meta.name || "this"} folder
              <input type="file" webkitdirectory="" directory="" multiple style={{ display: "none" }} onChange={(e) => onFolder(i, e.target.files)} />
            </label>
            {picked[i] && <div className="sub2">{picked[i].counts.forms} forms · {picked[i].counts.business} business · {picked[i].counts.presentation} presentation · {picked[i].counts.components} components</div>}
          </div>
        ))}
      </div>
      <div style={{ marginTop: 14 }}>
        <button className="btn" disabled={!canEnter} onClick={enter}>Start comparison →</button>
        <span className="tag" style={{ marginLeft: 10 }}>{N[0].name} + {N[1].name} required · {N[2].name} recommended.</span>
      </div>
    </div>
  );
}

function FabricUpload({ fab, onFabFolder, canEnter, enter, names, setNames }) {
  const N = clean(names);
  return (
    <div>
      <h2 className="page">≋ Fabric · Fabric app comparison</h2>
      <div className="crumb">Step 1 — load the two exported Fabric apps, then start the comparison.</div>
      <div className="rules">
        Pick each exported Fabric app folder — the folder that contains <code>Apps/</code> (Identity, Integration, Object,
        Orchestration, Workflow services). <b>JAR files are skipped.</b> Everything runs in your browser — nothing is uploaded.
      </div>
      <VersionNames ws="fabric" value={names} onChange={setNames} />
      <FabricPickers fab={fab} onFabFolder={onFabFolder} labels={N.map((x) => x.name)} subs={N.map((x) => x.sub)} />
      <div style={{ marginTop: 14 }}>
        <button className="btn" disabled={!canEnter} onClick={enter}>Start comparison →</button>
        <span className="tag" style={{ marginLeft: 10 }}>Both exports required.</span>
      </div>
    </div>
  );
}

function Landing({ status, done, open, labels }) {
  return (
    <div>
      <h2 className="page">Choose a comparison</h2>
      <div className="crumb">Each workspace has its own uploads and its own menu. You can switch between them at any time — loaded data is kept.</div>
      <div className="wsgrid">
        {Object.entries(WORKSPACES).map(([k, w]) => (
          <div key={k} className={"wscard" + (done[k] ? " done" : "")} onClick={() => open(k)}>
            <div className="wsico">{w.ico}</div>
            <div className="wstitle">{w.title} <span>· {w.sub}</span></div>
            <p>{w.desc(labels[k])}</p>
            <div className="wscovers">{w.covers.map((c) => <span key={c}>{c}</span>)}</div>
            <div className="wsfoot">
              <span className={"wsstatus" + (done[k] ? " ok" : "")}>{status[k]}</span>
              <span className="btn">{done[k] ? "Open →" : "Upload & compare →"}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Home({ picked, goto, names }) {
  const base = picked[0] && picked[0].counts;
  const metric = (i, field) => (picked[i] ? picked[i].counts[field] : "—");
  const delta = (i, field) => {
    if (i === 0 || !picked[i] || !base) return null;
    const d = picked[i].counts[field] - base[field];
    if (d === 0) return null;
    return <span className={"delta " + (d > 0 ? "up" : "down")}>{d > 0 ? "+" : ""}{d}</span>;
  };
  const FIELDS = [["forms", "Forms"], ["controllers", "Controllers"], ["business", "Business Ctrl"], ["presentation", "Presentation Ctrl"], ["components", "Components"]];
  return (
    <div>
      <h2 className="page">Project Overview</h2>
      <div className="crumb">Inventory across the three projects — open FormForge or CtrlSync from the menu to compare.</div>
      <div className="projgrid">
        {names.map((meta, i) => (
          <div key={PROJ_KEYS[i]} className={"projcard " + PROJ_KEYS[i]}>
            <div className="top">
              <div><b style={{ fontSize: 15 }}>{meta.name}</b><div className="tag2">{meta.sub}</div></div>
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
        <button className="btn" onClick={() => goto("controllers")}>Analyze controller retrofit →</button>{" "}
        <button className="btn" onClick={() => goto("comps")}>Compare components →</button>
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
            {model.hints && model.hints[n] && <div className="tag" style={{ color: "var(--accent)" }}>{model.hints[n]}</div>}
            <div className="tag">{m.kind}{model.hasNew ? ` · in ${N}: ${m.inNew || ""}` : ""}</div>
          </div>); })}
      </div>
      <div>
        <h3 style={{ margin: "0 0 4px" }}>{cur}{model.hints && model.hints[cur] && <span className="tag" style={{ marginLeft: 8 }}>{model.hints[cur]}</span>}</h3>
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
