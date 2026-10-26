import { useState, useEffect, useMemo, memo, lazy, Suspense } from "react";
import "./App.css";
import "./app/app.css";
import { ProjectsProvider, useProjects } from "./app/projects";
import { useRoute } from "./app/router";
import { AREAS, TOOLS, toolsOf } from "./app/tools";
import { useRegistry } from "./app/Shell";
import ProjectsPage from "./app/ProjectsPage";
import { Palette } from "./app/Palette";
import { PerfPanel, usePerfBusy } from "./app/PerfPanel";
import { VersionNamesPanel } from "./components/VersionNames";
import { countReads } from "./lib/perf";

countReads();

// each tool's code loads the first time it is opened
const TOOL_VIEWS = {
  ma: lazy(() => import("./tools/CompareTool.jsx").then((m) => ({ default: m.CompareMA }))),
  ui: lazy(() => import("./tools/CompareTool.jsx").then((m) => ({ default: m.CompareMono }))),
  fabric: lazy(() => import("./tools/FabricTool.jsx")),
  visualize: lazy(() => import("./tools/VisualizeTool.jsx")),
  blueprint: lazy(() => import("./tools/BlueprintTool.jsx")),
  observatory: lazy(() => import("./tools/ObservatoryTool.jsx")),
  convert: lazy(() => import("./tools/ConvertTool.jsx")),
};

export default function App() {
  return <ProjectsProvider><Studio /></ProjectsProvider>;
}

function Studio() {
  const [route, go] = useRoute();
  const P = useProjects();
  const { meta } = useRegistry();
  const busy = usePerfBusy();
  const tool = TOOLS[route.tool] ? route.tool : "projects";
  const area = tool === "projects" ? "projects" : TOOLS[tool].area;
  const [last, setLast] = useState({}); // tool -> its last page address (switching back returns there)
  const [lastInArea, setLastInArea] = useState({});
  const [visited, setVisited] = useState(() => new Set()); // opened tools stay mounted so their analyses survive switching
  const [side, setSide] = useState(true);
  const [openGroups, setOpenGroups] = useState(new Set());
  const [palette, setPalette] = useState(false);
  const [perf, setPerf] = useState(false);
  const [namesOpen, setNamesOpen] = useState(false);

  useEffect(() => {
    if (tool === "projects") return;
    setLast((l) => ({ ...l, [tool]: route }));
    setLastInArea((l) => ({ ...l, [area]: tool }));
    setVisited((v) => (v.has(tool) ? v : new Set(v).add(tool)));
  }, [tool, route, area]);
  useEffect(() => setNamesOpen(false), [tool]);
  useEffect(() => {
    const on = (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPalette((v) => !v); } };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

  const openTool = (t) => go(last[t] || { tool: t });
  const openArea = (a) => (a === "projects" ? go({ tool: "projects" }) : openTool(lastInArea[a] || toolsOf(a)[0]));
  const m = meta[tool];
  const entered = !!(m && m.entered);
  const T = TOOLS[tool];
  const mounted = new Set(visited);
  if (tool !== "projects") mounted.add(tool);

  return (
    <div>
      <div className="brand">
        {entered && <button className="burger" title="Menu" onClick={() => setSide((v) => !v)}><span /></button>}
        <div className="logo" style={{ cursor: "pointer" }} onClick={() => go({ tool: "projects" })} title="Projects">
          <span className="mark">Retr<span className="o">o</span>fit Studio</span>
          <span className="by">Powered by <span className="ava">avenza</span></span>
        </div>
        <nav className="areas">
          {AREAS.map((a) => <button key={a.id} className={a.id === area ? "on" : ""} onClick={() => openArea(a.id)}>{a.ico} {a.label}</button>)}
        </nav>
        <div className="rt">
          <button className="pillbtn searchbtn" onClick={() => setPalette(true)} title="Search (Ctrl+K)">⌕ Search <kbd>Ctrl K</kbd></button>
          <button className={"pillbtn" + (perf ? " on" : "")} onClick={() => setPerf((v) => !v)} title="Timings">⏱{busy ? <span className="busy">{busy}</span> : null}</button>
          {entered && T.names && <button className="pillbtn" onClick={() => setNamesOpen((v) => !v)}>✎ Version names</button>}
          {entered && m.reset && <button className="pillbtn" onClick={() => { m.reset(); go({ tool }); }} title="Back to this tool's start page; loaded folders stay loaded">↺ Start over</button>}
        </div>
      </div>
      {area !== "projects" && (
        <div className="toolstrip">
          {toolsOf(area).map((t) => {
            const X = TOOLS[t], need = X.needs(P.slots, P.L[X.names === "fabric" ? "fabric" : "viz"]), on = meta[t] && meta[t].entered;
            return (
              <button key={t} className={(t === tool ? "on" : "") + (on ? " live" : "")} onClick={() => openTool(t)} title={on ? meta[t].status : need ? `Needs ${need}` : "Ready"}>
                {X.ico} {X.title}{on && <i className="dot" />}
              </button>
            );
          })}
        </div>
      )}

      {namesOpen && entered && T.names && (
        <VersionNamesPanel key={T.names} ws={T.names} value={P.names[T.names]} onClose={() => setNamesOpen(false)} onApply={(list) => P.setNamesFor(T.names, list)} />
      )}
      {perf && <PerfPanel onClose={() => setPerf(false)} />}
      {palette && <Palette onClose={() => setPalette(false)} go={go} />}

      {tool === "projects" && <div className="startpage wide"><ProjectsPage open={openTool} /></div>}
      {[...mounted].map((t) => {
        const r = t === tool ? route : last[t] || { tool: t };
        return <ToolSlot key={t} t={t} active={t === tool} nav={r.nav || TOOLS[t].home} deep={!!r.nav} item={r.item} go={go} side={side} openGroups={openGroups} setOpenGroups={setOpenGroups} />;
      })}
    </div>
  );
}

// one opened tool; redraws only when its own page, the menu state or its visibility changes (not when search or
// the timings panel opens). deep: the address names a page inside the tool (a bookmark, Back, or a reload)
const ToolSlot = memo(function ToolSlot({ t, active, nav, deep, item, go, side, openGroups, setOpenGroups }) {
  const View = TOOL_VIEWS[t];
  const nav2 = useMemo(() => ({
    setNav: (n) => go({ tool: t, nav: n }),
    setItem: (k, o) => go({ tool: t, nav, item: k }, o),
    go: (x, o) => go({ tool: t, nav, ...x }, o),
  }), [t, nav, go]);
  return (
    <div style={active ? undefined : { display: "none" }}>
      <Suspense fallback={<div className="startpage"><p className="note">Loading {TOOLS[t].title}…</p></div>}>
        <View active={active} nav={nav} deep={deep} item={item} {...nav2} side={side} openGroups={openGroups} setOpenGroups={setOpenGroups} />
      </Suspense>
    </div>
  );
});
