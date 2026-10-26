// Explore · Blueprint: one loaded monolith, part by part. The open module / form is part of the page address.
import { useState, useEffect, useMemo } from "react";
import { BlueprintUpload, BlueprintHome, BlueprintModule, BlueprintForm, BlueprintFlow } from "../components/Blueprint";
import { ProjectLocator } from "../components/Locator";
import { loadProject, buildIndex, clsLabel } from "../lib/blueprint";
import { foreground } from "../lib/jobs";
import { useProjects, derive, SlotSelect, useSlotChoice } from "../app/projects";
import { Shell, useToolMeta, useToolEntities } from "../app/Shell";
import { BP_MENU } from "../app/tools";

const dirOf = (k) => k.split("/").slice(0, -1).join("/");
const chOf = (p) => { const c = Object.keys(p.channels); return c.includes("desktop") ? "desktop" : c.includes("mobile") ? "mobile" : c[0] || null; };

export default function BlueprintTool({ nav, setNav, item, go, side, openGroups, setOpenGroups }) {
  const { slots } = useProjects();
  const [slotId, setSlotId] = useSlotChoice(["monolith"]);
  const slot = slotId ? slots[slotId] : null;
  const pick = useMemo(() => (slot ? derive(slot.files, "blueprint", () => loadProject(slot.files)) : null), [slot]);
  const [ch, setCh] = useState(null);
  useEffect(() => setCh(pick ? chOf(pick) : null), [pick]);
  const [idx, setIdx] = useState(null);
  const [busy, setBusy] = useState(false);
  const [module, setModule] = useState(null);
  const [form, setForm] = useState(null);
  const [tab, setTab] = useState("preview");
  const [entry, setEntry] = useState(null);
  const [external, setExternal] = useState(null);
  const cache = useMemo(() => new Map(), [idx]); // eslint-disable-line react-hooks/exhaustive-deps

  const open = () => foreground(`Blueprint · read ${pick.name}`, async () => {
    setBusy(true);
    try {
      const x = await buildIndex(pick, ch);
      setIdx(x); setModule(null); setForm(null); setEntry(null); setExternal(null);
      setNav("bp-home");
    } finally { setBusy(false); }
  });
  // the page address names the module / form (search, Back, bookmarks)
  useEffect(() => {
    if (!idx || !item) return;
    if (nav === "bp-module" && item !== module) setModule(item);
    if ((nav === "bp-form" || nav === "bp-flow") && item !== form && idx.forms.has(item)) {
      setForm(item); setModule(dirOf(item)); setExternal(null);
      if (nav === "bp-form") { setTab("preview"); setEntry(null); }
    }
  }, [idx, nav, item]); // eslint-disable-line react-hooks/exhaustive-deps

  const openForm = (k) => { setForm(k); setModule(dirOf(k)); setTab("preview"); setEntry(null); setExternal(null); go({ nav: "bp-form", item: k }); };
  const openFlow = (id) => { setEntry(id); setExternal(null); go({ nav: "bp-flow", item: form }); };
  const openFormTab = (k, t) => { openForm(k); setTab(t); };
  const openFormFlow = (k, id) => { setForm(k); setModule(dirOf(k)); setExternal(null); setEntry(id); go({ nav: "bp-flow", item: k }); };
  const traceFrom = ({ cls, member, label }) => { setExternal({ id: `ext:${cls.id}#${member.name}`, group: "arrival", source: "started from a function", label: label || `${clsLabel(cls)}.${member.name}`, cls, member }); setEntry(null); go({ nav: "bp-flow" }); };
  const reset = () => { setIdx(null); setModule(null); setForm(null); setEntry(null); setExternal(null); };

  const entities = useMemo(() => {
    if (!idx) return [];
    const out = [];
    for (const m of idx.modules.keys()) out.push({ label: m.split("/").pop() || m, sub: m, kind: "Module", route: { tool: "blueprint", nav: "bp-module", item: m } });
    for (const k of idx.forms.keys()) out.push({ label: k.split("/").pop(), sub: k, kind: "Form", route: { tool: "blueprint", nav: "bp-form", item: k } });
    return out;
  }, [idx]);
  useToolEntities("blueprint", entities);
  useToolMeta("blueprint", { entered: !!idx, status: idx ? `${idx.project.name} · ${idx.modules.size} modules · ${idx.forms.size} forms` : pick ? "Ready" : null, reset });

  if (!idx) {
    return (
      <div className="startpage">
        <BlueprintUpload pick={pick} picker={<SlotSelect accept={["monolith"]} value={slotId} onChange={setSlotId} />} ch={ch} setCh={setCh} go={open} busy={busy} />
      </div>
    );
  }
  return (
    <Shell side={side} nav={nav} setNav={setNav} openGroups={openGroups} setOpenGroups={setOpenGroups} menu={BP_MENU}
      head={{ ico: "⌗", title: "Explore", sub: "Blueprint" }} foot={`${idx.project.name} · ${idx.ch}${module ? " · " + module : ""}${form ? " · " + form.split("/").pop() : ""}`}>
      {nav === "bp-home" && <BlueprintHome idx={idx} open={(m) => { setModule(m); go({ nav: "bp-module", item: m }); }} />}
      {nav === "bp-module" && <BlueprintModule idx={idx} module={module} setModule={(m) => { setModule(m); go({ nav: "bp-module", item: m }, { replace: true }); }} openForm={openForm} traceFrom={traceFrom} />}
      {nav === "bp-form" && <BlueprintForm idx={idx} formKey={form} setForm={openForm} tab={tab} setTab={setTab} openFlow={openFlow} cache={cache} />}
      {nav === "bp-locate" && <ProjectLocator idx={idx} cache={cache} openFormTab={(k) => openFormTab(k, "where")} openFormFlow={openFormFlow} />}
      {nav === "bp-flow" && <BlueprintFlow idx={idx} formKey={external ? null : form} setForm={(k) => { setForm(k); setModule(dirOf(k)); setEntry(null); go({ nav: "bp-flow", item: k }, { replace: true }); }} entryId={entry} setEntry={setEntry} cache={cache} external={external} />}
    </Shell>
  );
}
