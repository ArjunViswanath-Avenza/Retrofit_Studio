// Explore · Observatory: one loaded monolith or micro-app folder as a sky.
import { useState, useEffect, useMemo } from "react";
import { ObservatoryUpload, ObservatoryWorkspace } from "../components/Observatory";
import { readSky, universe } from "../lib/observatory";
import { foreground } from "../lib/jobs";
import { useProjects, derive, SlotSelect, useSlotChoice } from "../app/projects";
import { Shell, useToolMeta } from "../app/Shell";
import { OB_MENU } from "../app/tools";

const ACCEPT = ["monolith", "microapps"];
const chOf = (p) => { const c = Object.keys(p.channels); return c.includes("desktop") ? "desktop" : c.includes("mobile") ? "mobile" : c[0] || null; };

export default function ObservatoryTool({ nav, setNav, side, openGroups, setOpenGroups }) {
  const { slots } = useProjects();
  const [slotId, setSlotId] = useSlotChoice(ACCEPT);
  const slot = slotId ? slots[slotId] : null;
  const pick = useMemo(() => (slot ? derive(slot.files, "sky", () => readSky(slot.files)) : null), [slot]);
  const [ch, setCh] = useState(null);
  useEffect(() => setCh(pick ? chOf(pick) : null), [pick]);
  const [U, setU] = useState(null);
  const [busy, setBusy] = useState(false);
  const open = () => foreground(`Observatory · map ${pick.name}`, async () => {
    setBusy(true);
    try { setU(await universe(pick, ch)); setNav("ob-sky"); } finally { setBusy(false); }
  });
  useToolMeta("observatory", { entered: !!U, status: U ? `${U.name} · ${U.galaxies.filter((g) => g.systems.length).length} galaxies · ${U.systems.length} forms` : pick ? "Ready" : null, reset: () => setU(null) });

  if (!U) {
    return (
      <div className="startpage">
        <ObservatoryUpload pick={pick} picker={<SlotSelect accept={ACCEPT} value={slotId} onChange={setSlotId} />} ch={ch} setCh={setCh} go={open} busy={busy} />
      </div>
    );
  }
  return (
    <Shell side={side} nav={nav} setNav={setNav} openGroups={openGroups} setOpenGroups={setOpenGroups} menu={OB_MENU}
      head={{ ico: "✦", title: "Explore", sub: "Observatory" }} foot={`${U.name} · ${U.ch}`}>
      <ObservatoryWorkspace U={U} nav={nav} setNav={setNav} />
    </Shell>
  );
}
