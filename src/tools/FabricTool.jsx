// Compare · Fabric: the exported Fabric apps from the Projects page, service by service (LoomSync) and jar by jar.
import { useState, useEffect, useMemo } from "react";
import { LoomSync, FabricPickers } from "../components/Fabric";
import { JarView } from "../components/Jars";
import { resetDecompile } from "../lib/jars";
import { scanFabricFolder, analyzeFabric, fabricRetrofit } from "../lib/fabric";
import { clean } from "../lib/names";
import { foreground } from "../lib/jobs";
import { useProjects, derive, SlotLink, FAB_SLOTS } from "../app/projects";
import { Shell, useToolMeta, useAutoStart } from "../app/Shell";
import { TOOLS } from "../app/tools";

const pk = (p) => `${p[0]}${p[1]}`;

export default function FabricTool({ active, deep, nav, setNav, side, openGroups, setOpenGroups }) {
  const { slots, L, names } = useProjects();
  const labels = L.fabric;
  const ver = FAB_SLOTS.map((id) => (slots[id] ? +slots[id].loadedAt : 0)).join("|");
  const fab = useMemo(() => FAB_SLOTS.map((id) => (slots[id] ? derive(slots[id].files, "fabric", () => scanFabricFolder(slots[id].files)) : null)), [ver]); // eslint-disable-line react-hooks/exhaustive-deps
  const [entered, setEntered] = useState(false);
  const [bulk, setBulk] = useState({}); // "ab" (slot positions) -> analysis of that pair
  const [analyzing, setAnalyzing] = useState({}); // "ab" -> progress
  const [pair, setPair] = useState(null); // [a, b] currently shown
  const [sel, setSel] = useState(null); // { type, svc, unit }
  const [jarFocus, setJarFocus] = useState(null); // Java JARs: { base, item } of the opened jar
  // new exports: start again; new names: compare again
  useEffect(() => { setEntered(false); setBulk({}); setAnalyzing({}); setSel(null); setJarFocus(null); resetDecompile(); }, [ver]);
  useEffect(() => { setBulk({}); setAnalyzing({}); }, [labels.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps

  const ready = fab.filter(Boolean).length >= 2;
  useAutoStart({ active, deep }, ready && !entered, () => setEntered(true));
  // pairs that can be compared; the customised · new release pair first (what a 2-export comparison shows)
  const pairs = [[1, 2], [0, 1], [0, 2]].filter(([a, b]) => fab[a] && fab[b]);
  const cur = pair && pairs.some(([a, b]) => a === pair[0] && b === pair[1]) ? pair : pairs[0] || null;
  const all = fab.every(Boolean);
  const retro = useMemo(() => (all && bulk["01"] && bulk["02"] && bulk["12"] ? fabricRetrofit(bulk["01"], bulk["02"], bulk["12"]) : null), [all, bulk]);

  useEffect(() => {
    if (!active || !entered || !cur) return;
    if (Object.values(analyzing).some((x) => x && x.running)) return; // one pair at a time
    const want = [cur, ...(all && nav === "fab-overview" ? [[0, 1], [0, 2], [1, 2]] : [])];
    const next = want.find((p) => !bulk[pk(p)]);
    if (!next) return;
    const key = pk(next);
    const progress = (x) => setAnalyzing((m) => ({ ...m, [key]: x }));
    progress({ done: 0, total: 0, running: true });
    foreground(`Fabric · compare ${labels[next[0]]} vs ${labels[next[1]]}`, () => analyzeFabric([fab[next[0]], fab[next[1]]], [labels[next[0]], labels[next[1]]], progress))
      .then((res) => setBulk((m) => ({ ...m, [key]: res })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, entered, fab, bulk, analyzing, cur && pk(cur), nav]);

  useToolMeta("fabric", { entered, status: entered ? `Comparing ${labels.filter((x, i) => fab[i]).join(" · ")}` : ready ? "Ready" : null, reset: () => setEntered(false) });
  const pickers = FAB_SLOTS.map((id) => <SlotLink key={id} id={id} accept={["fabric"]} />);

  if (!entered) {
    const N = clean(names.fabric);
    return (
      <div className="startpage">
        <h2 className="page">≋ Compare · Fabric apps</h2>
        <div className="crumb">The exported Fabric apps from the Projects page — any two, or all three for the retrofit view.</div>
        <div className="rules">
          Each export is the folder that contains <code>Apps/</code> (Identity, Integration, Object, Orchestration, Workflow services). Jars in <code>_JARs</code> are
          compared in <b>Java JARs</b>. Everything runs in your browser — only the Java JARs view sends jars to the local dev server to decompile them, and they never leave this machine.
        </div>
        <FabricPickers fab={fab} pickers={pickers} labels={N.map((x) => x.name)} subs={N.map((x) => x.sub)} />
        <div style={{ marginTop: 14 }}>
          <button className="btn" disabled={!ready} onClick={() => { setEntered(true); setNav("fab-overview"); }}>Start comparison →</button>
          <span className="tag" style={{ marginLeft: 10 }}>Any two exports are enough · all three adds the retrofit view.</span>
        </div>
      </div>
    );
  }
  return (
    <Shell side={side} nav={nav} setNav={setNav} openGroups={openGroups} setOpenGroups={setOpenGroups} menu={TOOLS.fabric.menu(labels)}
      head={{ ico: "≋", title: "Compare", sub: "Fabric apps" }} foot={`${labels.filter((x, i) => fab[i]).join(" · ")} Fabric exports loaded`}>
      {nav.startsWith("fab-") && (
        <LoomSync type={nav === "fab-overview" ? null : nav.slice(4)} fab={fab} pickers={pickers} names={labels}
          pairs={pairs} pair={cur} setPair={(p) => { setPair(p); setSel(null); }}
          bulk={cur ? bulk[pk(cur)] : null} analyzing={cur ? analyzing[pk(cur)] : null}
          retro={retro} retroProgress={all ? ["01", "02", "12"].map((k) => (bulk[k] ? "done" : analyzing[k] && analyzing[k].running ? analyzing[k] : "waiting")) : null}
          sel={sel}
          setSel={(x) => { setSel(x); if (x && x.type) setNav("fab-" + x.type); }}
          goType={(t) => { setSel(null); setNav("fab-" + t); }} />
      )}
      {nav === "jars" && (
        <JarView fab={fab} names={labels} pairs={pairs} pair={cur} setPair={(p) => { setPair(p); setJarFocus(null); }}
          focus={jarFocus} setFocus={setJarFocus} />
      )}
    </Shell>
  );
}
