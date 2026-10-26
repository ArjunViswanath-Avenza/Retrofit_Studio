// Explore · Visualize: one loaded monolith placed onto the micro-app architecture from the built-in R26 map.
import { useState, useEffect, useMemo } from "react";
import { VisualizeUpload, PlanBar, FlowView, AppsView, ModulesView, ReviewView, ModuleDrawer } from "../components/Visualize";
import { FormAtlas } from "../components/FormAtlas";
import { rawFiles } from "../lib/convert";
import { inventory, buildPlan, POLICY_DEFAULT } from "../lib/mapplan";
import { CHANNELS } from "../lib/microapps";
import { useProjects, derive, SlotSelect, useSlotChoice } from "../app/projects";
import { Shell, useToolMeta } from "../app/Shell";
import { VZ_MENU } from "../app/tools";

export default function VisualizeTool({ nav, setNav, side, openGroups, setOpenGroups }) {
  const { slots, channel, setChannel } = useProjects();
  const [slotId, setSlotId] = useSlotChoice(["monolith"]);
  const slot = slotId ? slots[slotId] : null;
  const pick = useMemo(() => (slot ? { name: slot.name || "project", files: derive(slot.files, "raw", () => rawFiles(slot.files)).files } : null), [slot]);
  const [entered, setEntered] = useState(false);
  const [policy, setPolicy] = useState(POLICY_DEFAULT);
  const [overrides, setOverrides] = useState({});
  const [open, setOpen] = useState(null); // module shown in the drawer
  const [sel, setSel] = useState(null); // module selected in Modules & forms
  const [agreed, setAgreed] = useState(null);
  useEffect(() => { setOverrides({}); setOpen(null); setSel(null); }, [pick]);
  const inv = useMemo(() => (pick ? inventory(pick.files, channel) : null), [pick, channel]);
  const plan = useMemo(() => (inv && entered ? buildPlan(inv, channel, policy, overrides) : null), [inv, entered, channel, policy, overrides]);
  const key = pick ? `retrofit-studio:vz-agreed:${pick.name}:${channel}` : null;
  useEffect(() => { // previously agreed plan for this project + channel
    if (!key) { setAgreed(null); return; }
    let rec = null;
    try { rec = JSON.parse(localStorage.getItem(key) || "null"); } catch { /* storage unavailable */ }
    setAgreed(rec);
    if (rec) { setPolicy({ ...POLICY_DEFAULT, ...rec.policy }); setOverrides(rec.overrides || {}); } // reopen on the agreed plan
  }, [key]);
  const agree = () => {
    const rec = { date: new Date().toLocaleString(), policy, overrides, stats: plan.stats };
    try { localStorage.setItem(key, JSON.stringify(rec)); } catch { /* storage unavailable: kept for this session */ }
    setAgreed(rec);
  };
  const setOverride = (module, app) => setOverrides((o) => { const n = { ...o }; if (app) n[module] = app; else delete n[module]; return n; });
  const reset = () => { setEntered(false); setPolicy(POLICY_DEFAULT); setOverrides({}); setOpen(null); setSel(null); };
  useToolMeta("visualize", { entered: !!(entered && plan), status: entered && plan ? `${pick.name} · ${plan.stats.forms} forms → ${plan.stats.apps} micro apps${agreed ? " · agreed" : ""}` : pick ? "Ready" : null, reset });

  if (!entered || !plan) {
    return (
      <div className="startpage">
        <VisualizeUpload channel={channel} setChannel={setChannel} pick={pick && { ...pick, inv }}
          picker={<SlotSelect accept={["monolith"]} value={slotId} onChange={setSlotId} />}
          go={() => { setEntered(true); setNav("vz-flow"); }} />
      </div>
    );
  }
  const header = (
    <>
      <h2 className="page">{(VZ_MENU.find((x) => x.id === nav) || VZ_MENU[0]).label}</h2>
      <div className="crumb">{pick.name} → micro-app architecture · {CHANNELS[channel].label}</div>
      <PlanBar policy={policy} setPolicy={setPolicy} overrides={overrides} agreed={agreed} />
    </>
  );
  return (
    <Shell side={side} nav={nav} setNav={setNav} openGroups={openGroups} setOpenGroups={setOpenGroups} menu={VZ_MENU}
      head={{ ico: "◎", title: "Explore", sub: "Visualize" }} foot={`${pick.name} · ${CHANNELS[channel].label} · R26 ${plan.release} map`}>
      {nav === "vz-flow" && <FlowView plan={plan} open={setOpen} header={header} />}
      {nav === "vz-atlas" && <FormAtlas plan={plan} open={setOpen} header={header} />}
      {nav === "vz-apps" && <AppsView plan={plan} open={setOpen} header={header} />}
      {nav === "vz-modules" && <ModulesView plan={plan} sel={sel} setSel={setSel} setOverride={setOverride} header={header} />}
      {nav === "vz-plan" && <ReviewView plan={plan} inv={inv} setPolicy={setPolicy} overrides={overrides} setOverride={setOverride} agreed={agreed} agree={agree} projectName={pick.name} header={header} />}
      {open && <ModuleDrawer module={open} plan={plan} setOverride={setOverride} onClose={() => setOpen(null)} />}
    </Shell>
  );
}
