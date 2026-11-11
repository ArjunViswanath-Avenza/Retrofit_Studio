// Compare · Visualizer projects: monolith → monolith (three monoliths) and monolith → micro app (two monoliths and the
// micro-app folder, re-keyed onto the monolith's names first). Both run the same comparison workspace.
import { useState, useEffect, useMemo, useRef } from "react";
import { extractComponent, extractModule, buildModel, mvcKind } from "../lib/analyzer";
import { TwoCol, ThreeCol } from "../components/DiffView";
import { Checklist } from "../components/Checklist";
import { FormsView } from "../components/Forms";
import { OverallView } from "../components/Overall";
import { ComponentsView } from "../components/Components";
import { SegmentsView } from "../components/Segments";
import { analyzeComponents, componentUsage, relinkUsage } from "../lib/components";
import { analyzeSegments, segmentUsage, segmentFiles } from "../lib/segments";
import { scanFolder } from "../lib/scan";
import { MicroAppUpload, MicroAppMap } from "../components/MicroApps";
import { scanMicroApps, alignMicroApps, missingMicroApps, channelScan, relinkComponent, CHANNELS } from "../lib/microapps";
import { clean } from "../lib/names";
import { foreground, background, isStopped, yieldNow, pool } from "../lib/jobs";
import { useProjects, derive, SlotLink } from "../app/projects";
import { Shell, useToolMeta, useToolEntities, useAutoStart } from "../app/Shell";
import { useMore, MoreRows } from "../app/More";
import { TOOLS } from "../app/tools";

const PROJ_KEYS = ["r21", "kbz", "r26"];
const ROLE_SLOTS = ["base", "custom", "target"];
const names3 = (L) => L.join(" · ");
const monoScan = (s) => (s && s.kind === "monolith" ? derive(s.files, "scan", () => scanFolder(s.files)) : null);
const maScan = (s) => (s && s.kind === "microapps" ? derive(s.files, "microapps", () => scanMicroApps(s.files, scanFolder)) : null);
// changes whenever one of these folders is loaded again
const slotsVersion = (slots, ids) => ids.map((id) => (slots[id] ? +slots[id].loadedAt : 0)).join("|");
// user-widget links set by hand (COMP-are · Change the R26 copy), kept in this browser per KBZ folder · R26 folder · channel
const LINKS_KEY = "rs.compLinks";
const readLinks = (pid) => { try { return JSON.parse(localStorage.getItem(LINKS_KEY) || "{}")[pid] || {}; } catch { return {}; } };
const writeLink = (pid, key, link) => {
  try {
    const all = JSON.parse(localStorage.getItem(LINKS_KEY) || "{}");
    const m = all[pid] || {};
    if (link == null) delete m[key]; else m[key] = link;
    all[pid] = m;
    localStorage.setItem(LINKS_KEY, JSON.stringify(all));
  } catch { /* kept for this session only */ }
};

/* ================================================================ monolith → monolith */
export function CompareMono(props) {
  const { slots, L, names } = useProjects();
  const labels = L.viz;
  const ver = slotsVersion(slots, ROLE_SLOTS);
  const picked = useMemo(() => ROLE_SLOTS.map((id) => monoScan(slots[id])), [ver]); // eslint-disable-line react-hooks/exhaustive-deps
  const [entered, setEntered] = useState(false);
  useEffect(() => setEntered(false), [ver]);
  const ready = !!(picked[0] && picked[1]);
  useAutoStart(props, ready && !entered, () => setEntered(true));
  useToolMeta("ui", { entered, status: entered ? `Comparing ${labels.filter((m, i) => picked[i]).join(" · ")}` : ready ? "Ready" : null, reset: () => setEntered(false) });
  if (!entered) return <div className="startpage"><MonoStart picked={picked} labels={labels} ready={ready} enter={() => { setEntered(true); props.setNav("home"); }} /></div>;
  return (
    <Shell {...shellOf(props, TOOLS.ui.menu(labels), { ico: "▤", title: "Compare", sub: "Monolith → monolith" }, `${picked.filter(Boolean).length}/3 projects · ${names3(labels)}`)}>
      <VisualizerWorkspace key={labels.join("|") + ver} tool="ui" picked={picked} labels={labels} {...props}
        home={<Home picked={picked} goto={props.setNav} names={clean(names.viz)} />} />
    </Shell>
  );
}

function MonoStart({ picked, labels, ready, enter }) {
  return (
    <div>
      <h2 className="page">▤ Compare · Monolith → monolith</h2>
      <div className="crumb">The three Visualizer projects from the Projects page — {labels[0]} (base), {labels[1]} (customised) and {labels[2]} (new release).</div>
      <div className="rules">
        Each project's <b>forms</b>, <b>form controllers</b>, <b>MVC extensions</b> (business &amp; presentation controllers) and <b>user widgets</b> are
        compared. Everything runs in your browser — nothing is uploaded.
      </div>
      <div className="folders">
        {labels.map((name, i) => (
          <div key={PROJ_KEYS[i]} className={"folder" + (picked[i] ? " filled" : "")}>
            <h3>{name}</h3>
            <div className="cnt">{picked[i] ? picked[i].counts.controllers : 0}</div>
            <div className="cl">controllers detected</div>
            <SlotLink id={ROLE_SLOTS[i]} accept={["monolith"]} />
            {picked[i] && <div className="sub2">{picked[i].counts.forms} forms · {picked[i].counts.business} business · {picked[i].counts.presentation} presentation · {picked[i].counts.components} components</div>}
          </div>
        ))}
      </div>
      <div style={{ marginTop: 14 }}>
        <button className="btn" disabled={!ready} onClick={enter}>Start comparison →</button>
        <span className="tag" style={{ marginLeft: 10 }}>{labels[0]} + {labels[1]} required · {labels[2]} recommended.</span>
      </div>
    </div>
  );
}

/* ================================================================ monolith → micro app */
export function CompareMA(props) {
  const { slots, L, channel, setChannel } = useProjects();
  const labels = L.viz;
  const folders = slotsVersion(slots, ROLE_SLOTS), ver = folders + "|" + channel;
  const pick = useMemo(() => [monoScan(slots.base), monoScan(slots.custom), maScan(slots.target)], [folders]); // eslint-disable-line react-hooks/exhaustive-deps
  const [aligned, setAligned] = useState(null); // { picked: [R21, KBZ, aligned R26], report, missing, channel }
  const [aligning, setAligning] = useState(null);
  useEffect(() => { setAligned(null); setAligning(null); }, [ver]);
  const ready = !!(pick[0] && pick[1] && pick[2]);
  const pid = `${slots.custom ? slots.custom.name : ""}|${slots.target ? slots.target.name : ""}|${channel}`;
  // keep: stay on the page the address names (a reload or a bookmark) instead of the micro-app map
  const start = (keep) => foreground("Micro-app map · locate every item in its micro app", async () => {
    const C = CHANNELS[channel];
    const mono = [channelScan(pick[0], C.mono), channelScan(pick[1], C.mono)];
    const missing = await missingMicroApps(pick[2]);
    const { r26, report } = await alignMicroApps(mono, pick[2], channel, setAligning, readLinks(pid));
    setAligned({ picked: [mono[0], mono[1], r26], report, missing, channel });
    if (keep !== true) props.setNav("home");
  });
  // a component linked by hand to another R26 copy (or to none): saved, and applied without re-running the map
  const relinkComp = (key, link) => { writeLink(pid, key, link); setAligned((a) => (a ? relinkComponent(a, key, link) : a)); };
  useAutoStart(props, ready && !aligned && !(aligning && aligning.running), () => start(true));
  const segReport = useMemo(() => (aligned && aligned.report.segs ? new Map(aligned.report.segs.map((r) => [r.key, r])) : null), [aligned]);
  const compReport = useMemo(() => (aligned && aligned.report.comps ? new Map(aligned.report.comps.map((r) => [r.key, r])) : null), [aligned]);
  useToolMeta("ma", { entered: !!aligned, status: aligned ? `Comparing · ${CHANNELS[aligned.channel].label}` : ready ? "Ready" : null, reset: () => { setAligned(null); setAligning(null); } });
  if (!aligned) {
    return (
      <div className="startpage">
        <MicroAppUpload channel={channel} setChannel={setChannel} pick={pick} canEnter={ready} enter={() => start()} aligning={aligning} labels={labels}
          pickers={ROLE_SLOTS.map((id) => <SlotLink key={id} id={id} accept={[id === "target" ? "microapps" : "monolith"]} />)} />
      </div>
    );
  }
  return (
    <Shell {...shellOf(props, TOOLS.ma.menu(labels), { ico: "❖", title: "Compare", sub: "Monolith → micro app" }, `${CHANNELS[aligned.channel].label} · ${aligned.picked[2].microApps} ${labels[2]} projects`)}>
      <VisualizerWorkspace key={labels.join("|") + ver} tool="ma" picked={aligned.picked} labels={labels} segReport={segReport} compReport={compReport} relinkComp={relinkComp} {...props}
        home={<MicroAppMap aligned={aligned} goto={props.setNav} labels={labels} />} />
    </Shell>
  );
}

const shellOf = (p, menu, head, foot) => ({ side: p.side, nav: p.nav, setNav: p.setNav, openGroups: p.openGroups, setOpenGroups: p.setOpenGroups, menu, head, foot });

/* ================================================================ the comparison workspace */
// Match files across the three versions by key, then extract + compare each (shared by CtrlSync and MVC Bridge).
async function analyzeSets(maps, extractor, meta, onProgress, labels) {
  const keys = [...new Set(maps.flatMap((m) => [...m.keys()]))].sort();
  onProgress({ done: 0, total: keys.length, running: true });
  const results = new Array(keys.length);
  let done = 0;
  await pool(keys.length, 8, async (i) => { // several at once: their file reads go out together
    const key = keys[i];
    const base = { path: key, ...meta(key) };
    const fs = labels.map((l, k) => [l, maps[k].get(key)]);
    const present = fs.filter(([, f]) => f).map(([l]) => l);
    if (!fs[0][1] || !fs[1][1]) results[i] = { ...base, incomplete: true, present };
    else {
      try {
        const srcs = await Promise.all(fs.map(([, f]) => (f ? f.text() : null)));
        const files = [];
        fs.forEach(([label, f], k) => { if (f) files.push({ label, name: key, src: srcs[k], parsed: extractor(srcs[k]) }); });
        results[i] = { ...base, model: buildModel(files), present };
      } catch (e) { results[i] = { ...base, error: String(e.message || e), present }; }
    }
    if (++done % 5 === 0) { onProgress({ done, total: keys.length, running: true }); await yieldNow(); }
  });
  onProgress({ done: keys.length, total: keys.length, running: false });
  return results;
}

// what a drill-down's page address names, per page
const KEY_OF = { controllers: (r) => r.path, mvc: (r) => r.path, comps: (r) => r.key, segs: (r) => r.key };
const fileName = (k) => k.split("/").pop().replace(/\.(sm|js)$/i, "");

function VisualizerWorkspace({ tool, picked, labels, nav, setNav, item, setItem, active, home, segReport, compReport, relinkComp }) {
  const [bulk, setBulk] = useState(null);
  const [analyzing, setAnalyzing] = useState(null);
  const [formScan, setFormScan] = useState({}); // per version-pair form property scan (kept across menu navigation)
  const [mvcBulk, setMvcBulk] = useState(null);
  const [mvcAnalyzing, setMvcAnalyzing] = useState(null);
  const [overall, setOverall] = useState({}); // full-file comparison scans, per category + version pair
  const [compBulk, setCompBulk] = useState(null);
  const [compAnalyzing, setCompAnalyzing] = useState(null);
  const [compAspect, setCompAspect] = useState("structure");
  const [segBulk, setSegBulk] = useState(null);
  const [segAnalyzing, setSegAnalyzing] = useState(null);
  const [segAspect, setSegAspect] = useState("structure");
  const [segPicked, setSegPicked] = useState(null); // per version: { segs: template -> its files } for the Overall comparison
  const [segUsage, setSegUsage] = useState(null);
  const [segUsageProg, setSegUsageProg] = useState(null);
  const [compUsage, setCompUsage] = useState(null);
  const [compUsageProg, setCompUsageProg] = useState(null);
  const [tab, setTab] = useState("overview");
  const [member, setMember] = useState(null);
  const [view, setView] = useState("OLD_CUST");
  const shown = labels.filter((l, i) => i < 2 || picked[2]);

  // the drill-down open on this page comes from the page address (?item=<key>)
  const bulks = { controllers: bulk, mvc: mvcBulk, comps: compBulk, segs: segBulk };
  const drillAt = (n) => {
    const b = bulks[n];
    if (nav !== n || !item || !b) return null;
    const i = b.results.findIndex((r) => KEY_OF[n](r) === item);
    return i < 0 || ((n === "controllers" || n === "mvc") && !b.results[i].model) ? null : i;
  };
  const openAt = (n) => (i) => setItem(i == null ? null : KEY_OF[n](bulks[n].results[i]));
  const opened = `${nav}|${item || ""}|${bulks[nav] ? 1 : 0}`;
  useEffect(() => { // a drill-down opened (from a list, the search or Back): start on its first tab
    setTab("overview"); setView("OLD_CUST"); setCompAspect("structure"); setSegAspect("structure");
    const i = drillAt(nav);
    setMember(i != null && (nav === "controllers" || nav === "mvc") ? bulks[nav].results[i].model.genuine[0] || null : null);
  }, [opened]); // eslint-disable-line react-hooks/exhaustive-deps

  const runControllers = () => foreground("CtrlSync · compare form controllers", async () => {
    // extractComponent reads both controller styles: define({...}) and define([deps], function(){ return {...} })
    const results = await analyzeSets(picked.map((p) => (p ? p.controllers : new Map())), extractComponent,
      (k) => ({ base: k.split("/").pop().replace(/\.js$/, "") }), setAnalyzing, labels);
    setBulk({ results, unmatched: [] });
  });
  const runMvc = () => foreground("MVC Bridge · compare business & presentation controllers", async () => {
    const results = await analyzeSets(picked.map((p) => (p ? p.mvc : new Map())), extractModule,
      (k) => ({ base: k.split("/")[0], kind: mvcKind(k) }), setMvcAnalyzing, labels);
    setMvcBulk({ results, unmatched: [] });
  });
  // segment templates: the comparison first, then (in the background) the files for side by side and where each is used
  // background jobs run once each and stop when this comparison closes (Start over, new folders, new names)
  const jobs = useRef({});
  useEffect(() => () => Object.values(jobs.current).forEach((j) => j.cancel()), []);
  const once = (name, label, fn) => { if (!jobs.current[name]) jobs.current[name] = background(label, fn); };
  const loadSegFiles = () => once("segFiles", "TemplateTwin · collect every template's files", async (signal) => setSegPicked(await segmentFiles(picked, null, signal)));
  const loadSegUsage = () => once("segUsage", "TemplateTwin · find where each template is used", async (signal) => {
    setSegUsageProg({ done: 0, total: 1, running: true });
    try { setSegUsage(await segmentUsage(picked, setSegUsageProg, signal)); } catch (e) { if (!isStopped(e)) throw e; }
  });
  const runSegs = () => foreground("TemplateTwin · compare segment templates", async () => {
    const results = await analyzeSegments(picked, shown, setSegAnalyzing);
    setSegBulk({ results });
    loadSegFiles();
    loadSegUsage();
  });
  // components re-linked by hand: their R26 uses come from the root kuids of the copies now listed
  const relinked = useRef(new Set());
  const reportNow = useRef(compReport);
  reportNow.current = compReport;
  const withRelinks = (u) => {
    let x = u;
    for (const k of relinked.current) { const row = reportNow.current && reportNow.current.get(k); x = relinkUsage(x, 2, k, row ? [row.kuid, ...row.copies.map((c) => c.kuid)] : []); }
    return x;
  };
  const loadCompUsage = () => once("compUsage", "COMP-are · find where each component is used", async (signal) => {
    setCompUsageProg({ done: 0, total: 1, running: true });
    try { setCompUsage(withRelinks(await componentUsage(picked, setCompUsageProg, signal))); } catch (e) { if (!isStopped(e)) throw e; }
  });
  const runComps = () => foreground("COMP-are · compare user widgets", async () => {
    const results = await analyzeComponents(picked.map((p) => (p ? p.comps : null)), labels, setCompAnalyzing, { picked });
    setCompBulk({ results });
    loadCompUsage();
  });
  // a re-link replaces the R26 maps (new picked): compare that one component again against its new copy
  const pending = useRef(new Set());
  const relink = relinkComp ? (key, link) => { pending.current.add(key); relinked.current.add(key); relinkComp(key, link); } : null;
  useEffect(() => {
    if (!pending.current.size) return;
    const keys = [...pending.current];
    pending.current.clear();
    setCompUsage((u) => (u ? withRelinks(u) : u));
    if (!ran.current.has("comps")) return;
    foreground("COMP-are · compare the re-linked component", async () => {
      const res = await analyzeComponents(picked.map((p) => (p ? p.comps : null)), labels, () => {}, { picked, keys });
      const by = new Map(res.map((r) => [r.key, r]));
      setCompBulk((b) => (b ? { results: b.results.map((r) => by.get(r.key) || r) } : b));
    });
  }, [picked]); // eslint-disable-line react-hooks/exhaustive-deps

  // run an analysis the first time its view is opened (once each, whatever re-runs the effect)
  const ran = useRef(new Set());
  const first = (name, run) => { if (!ran.current.has(name)) { ran.current.add(name); run(); } };
  useEffect(() => {
    if (!active) return;
    if (nav === "controllers") first("controllers", runControllers);
    if (nav === "mvc") first("mvc", runMvc);
    if (nav === "comps") first("comps", runComps);
    if (nav === "segs") first("segs", runSegs);
    if (nav === "segs-all") loadSegFiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nav, active]);

  // what the search (Ctrl+K) can open in this comparison
  const entities = useMemo(() => {
    const out = [];
    const keys = (cat) => [...new Set(picked.flatMap((p) => (p && p[cat] ? [...p[cat].keys()] : [])))].sort();
    for (const k of keys("forms")) out.push({ label: fileName(k), sub: k, kind: "Form", route: { tool, nav: "forms", item: k } });
    for (const k of keys("controllers")) out.push({ label: fileName(k), sub: k, kind: "Form controller", route: { tool, nav: "controllers", item: k } });
    for (const k of keys("mvc")) out.push({ label: fileName(k), sub: k, kind: "Business / presentation", route: { tool, nav: "mvc", item: k } });
    for (const k of keys("comps")) out.push({ label: k, sub: "user widget", kind: "Component", route: { tool, nav: "comps", item: k } });
    if (tool === "ma") for (const k of keys("segs")) out.push({ label: fileName(k), sub: k, kind: "Segment template", route: { tool, nav: "segs", item: k } });
    return out;
  }, [picked, tool]);
  useToolEntities(tool, entities);

  const reportProps = { tab, setTab, member, setMember, view, setView };
  void setNav;

  return (
    <>
      {nav === "home" && home}
      {nav === "forms" && <FormsView picked={picked} labels={labels} scan={formScan} setScan={setFormScan} open={item} setOpen={setItem} />}
      {nav === "forms-all" && <OverallView key="forms" cat="forms" picked={picked} labels={labels} cache={overall} setCache={setOverall} />}
      {nav === "controllers-all" && <OverallView key="controllers" cat="controllers" picked={picked} labels={labels} cache={overall} setCache={setOverall} />}
      {nav === "mvc-all" && <OverallView key="mvc" cat="mvc" picked={picked} labels={labels} cache={overall} setCache={setOverall} />}
      {nav === "comps-all" && <OverallView key="comps" cat="comps" picked={picked} labels={labels} cache={overall} setCache={setOverall} />}
      {nav === "segs-all" && (segPicked ? <OverallView key="segs" cat="segs" picked={segPicked} labels={labels} cache={overall} setCache={setOverall} />
        : <div><h2 className="page">Segment templates · Overall comparison</h2><p className="note">Collecting every template's files and its controller…</p></div>)}
      {nav === "segs" && (
        <SegmentsView picked={picked} labels={shown} bulk={segBulk} analyzing={segAnalyzing}
          drill={drillAt("segs")} setDrill={openAt("segs")}
          aspect={segAspect} setAspect={(k) => { setSegAspect(k); setMember(null); }} overall={overall} setOverall={setOverall}
          report={segReport} usage={segUsage} usageProg={segUsageProg} segPicked={segPicked}
          renderReport={(model) => <Report model={model} {...reportProps} widgets={false} />} />
      )}
      {nav === "comps" && (
        <ComponentsView picked={picked} labels={shown} bulk={compBulk} analyzing={compAnalyzing}
          drill={drillAt("comps")} setDrill={openAt("comps")}
          aspect={compAspect} setAspect={(k) => { setCompAspect(k); setMember(null); }} overall={overall} setOverall={setOverall}
          report={compReport} usage={compUsage} usageProg={compUsageProg} relink={relink}
          renderReport={(model) => <Report model={model} {...reportProps} widgets={false} />} />
      )}
      {nav === "controllers" && (
        <AnalysisView title="Controller Retrofit" crumb={`Form-level controllers · ${labels[1]} customisations carried onto ${labels[2]}`} noun="controllers" labels={labels}
          bulk={bulk} analyzing={analyzing} drill={drillAt("controllers")} openDrill={openAt("controllers")} reportProps={reportProps} />
      )}
      {nav === "mvc" && (
        <AnalysisView title="Business & Presentation Retrofit" crumb={`MVC extensions · business and presentation controller logic across ${names3(labels)}`} noun="modules" labels={labels}
          bulk={mvcBulk} analyzing={mvcAnalyzing} drill={drillAt("mvc")} openDrill={openAt("mvc")} reportProps={reportProps} showKind />
      )}
    </>
  );
}

function AnalysisView({ title, crumb, noun, bulk, analyzing, drill, openDrill, reportProps, showKind, labels }) {
  if (drill != null && bulk) {
    const r = bulk.results[drill];
    return (
      <div>
        <button className="btn ghost" onClick={() => openDrill(null)} style={{ marginBottom: 10 }}>← All {noun}</button>
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
  const page = useMore(viewRows);
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
            {page.shown.map((r) => { const clickable = !!r.model; return (
              <tr key={r.path || r.base} className={clickable ? "clickable" : ""} style={{ cursor: clickable ? "pointer" : "default" }} onClick={() => clickable && openDrill(r.i)}>
                <td><b style={{ color: clickable ? "var(--accent)" : "inherit" }}>{r.base}</b>{r.path && <div className="tag" style={{ maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.path}</div>}</td>
                {showKind && <td><span className={"kindpill k-" + r.kind}>{r.kind}</span></td>}
                {tokens.map((t) => <td key={t} style={{ textAlign: "center" }}>{(r.present || []).includes(t) ? "✓" : "–"}</td>)}
                <td style={{ textAlign: "center", fontWeight: 700 }}>{r.model ? r.changes : "—"}</td>
                <td style={{ textAlign: "center", color: r.conflicts ? "var(--chg-mark)" : "inherit" }}>{r.model ? r.conflicts : "—"}</td>
                <td>{r.model ? <BucketBar bc={r.bc} /> : "—"}</td>
                <td>{r.model ? <span className="pill Added">ok</span> : r.incomplete ? <span className="pill Modified">missing</span> : <span className="pill Removed">parse err</span>}</td>
              </tr>); })}
            <MoreRows {...page} shown={page.shown.length} cols={tokens.length + (showKind ? 6 : 5)} />
          </tbody>
        </table>
      </div>
      <p className="tag" style={{ marginTop: 8 }}>
        Buckets: <span className="chip" style={{ background: "var(--add-mark)", color: "#fff" }}>1 clean</span> <span className="chip" style={{ background: "var(--chg-mark)", color: "#111" }}>2 conflict</span> <span className="chip" style={{ background: "#5b8def", color: "#fff" }}>3 in-new</span> <span className="chip" style={{ background: "#4caf7d", color: "#fff" }}>4 custom-only</span> <span className="chip" style={{ background: "#c9cdd4", color: "#111" }}>5 new-only</span>
      </p>
    </div>
  );
}
