// Convert · Converter: a loaded monolith rebuilt as micro-app projects, with the loaded micro-app folder as reference.
import { useState, useEffect, useMemo } from "react";
import { ConverterUpload, ConverterPlan, ConverterRun } from "../components/Converter";
import { rawFiles, proposePlan, r26Layout } from "../lib/convert";
import { scanFolder } from "../lib/scan";
import { scanMicroApps, CHANNELS } from "../lib/microapps";
import { foreground } from "../lib/jobs";
import { useProjects, derive, SlotSelect, SlotLink, useSlotChoice } from "../app/projects";
import { Shell, useToolMeta } from "../app/Shell";
import { TOOLS } from "../app/tools";

export default function ConvertTool({ nav, setNav, side, openGroups, setOpenGroups }) {
  const { slots, channel, setChannel } = useProjects();
  const [monoId, setMonoId] = useSlotChoice(["monolith"]);
  const mono = monoId ? slots[monoId] : null, ref = slots.target && slots.target.kind === "microapps" ? slots.target : null;
  const pick = useMemo(() => [
    mono ? { scan: derive(mono.files, "scan", () => scanFolder(mono.files)), raw: derive(mono.files, "raw", () => rawFiles(mono.files)) } : null,
    ref ? derive(ref.files, "microapps", () => scanMicroApps(ref.files, scanFolder)) : null,
  ], [mono, ref]);
  const [plan, setPlan] = useState(null);
  const [planning, setPlanning] = useState(null);
  const [run, setRun] = useState(null);
  useEffect(() => { setPlan(null); setRun(null); setPlanning(null); }, [pick, channel]);

  const build = () => foreground("Converter · build the conversion plan", async () => {
    setPlanning({ running: true, step: "Matching modules to micro apps" });
    try {
      const p = await proposePlan(pick[0].scan, pick[0].raw.files, pick[1], channel);
      setPlanning({ running: true, step: "Placing every form where R26 keeps it" });
      p.layout = await r26Layout(pick[0].raw.files, pick[1], channel);
      p.useLayout = true;
      setPlan(p); setRun(null); setPlanning(null); setNav("cv-plan");
    } catch (e) { setPlanning({ running: false, step: `Could not build the plan: ${e.message || e}` }); }
  });
  useToolMeta("convert", { entered: !!plan, status: plan ? `Plan ready · ${plan.rows.length} modules` : pick[0] && pick[1] ? "Ready" : null, reset: () => { setPlan(null); setRun(null); } });

  if (!plan) {
    return (
      <div className="startpage">
        <ConverterUpload channel={channel} setChannel={setChannel} pick={pick} canPlan={!!(pick[0] && pick[1])} onPlan={build} planning={planning}
          pickers={[<SlotSelect key="m" accept={["monolith"]} value={monoId} onChange={setMonoId} />, <SlotLink key="r" id="target" accept={["microapps"]} />]} />
      </div>
    );
  }
  return (
    <Shell side={side} nav={nav} setNav={setNav} openGroups={openGroups} setOpenGroups={setOpenGroups} menu={TOOLS.convert.menu()}
      head={{ ico: "⇢", title: "Convert", sub: "Monolith → micro apps" }} foot={`${CHANNELS[plan.channel].label} · ${plan.rows.length} modules`}>
      {nav === "cv-plan" && <ConverterPlan plan={plan} setPlan={setPlan} goRun={() => setNav("cv-run")} />}
      {nav === "cv-run" && <ConverterRun plan={plan} mono={pick[0]} ma={pick[1]} run={run} setRun={setRun} />}
    </Shell>
  );
}
