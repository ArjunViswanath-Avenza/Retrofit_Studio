// The loaded folders, shared by every tool: each folder is loaded once (on the Projects page or from a tool's start
// page) and every tool reads it from here. Folder scans are cached per folder (derive), so two tools on the same
// folder scan it once. A folder opened by its path goes through the local file service (lib/localfs.js): its path is
// remembered and the folder opens again by itself after a reload.
import { createContext, useContext, useState, useMemo, useCallback, useEffect, useRef } from "react";
import { loadNames, saveNames, clean } from "../lib/names";
import { track, trackSync } from "../lib/perf";
import { serviceStatus, openFolder } from "../lib/localfs";

// Visualizer slots: base / custom / target carry the version roles; "other" is a spare folder for the explore tools.
// Fabric slots: the three exported Fabric apps.
export const VIZ_SLOTS = ["base", "custom", "target", "other"];
export const FAB_SLOTS = ["fbase", "fcustom", "ftarget"];
const ROLE_INDEX = { base: 0, custom: 1, target: 2, fbase: 0, fcustom: 1, ftarget: 2 };
export const KIND_LABEL = { monolith: "Monolith", microapps: "Micro apps", fabric: "Fabric export", unknown: "Not recognised" };

// generated and version-control folders: never read by any tool
const SKIP_VIZ = new Set([".git", "node_modules", "jssrc", "binaries", "build", "temp", "ssm_temp"]);
const SKIP_FAB = new Set([".git", "node_modules"]);

const relOf = (f) => (f.webkitRelativePath || f.name).replace(/\\/g, "/");

const PATHS_KEY = "rs.slotPaths";
const savedPaths = () => { try { return JSON.parse(localStorage.getItem(PATHS_KEY) || "{}"); } catch { return {}; } };
const savePath = (id, dir) => { try { const m = savedPaths(); if (dir) m[id] = dir; else delete m[id]; localStorage.setItem(PATHS_KEY, JSON.stringify(m)); } catch { /* not remembered */ } };

export function readFolder(fileList, group) {
  const skip = group === "fabric" ? SKIP_FAB : SKIP_VIZ;
  const files = [];
  let skipped = 0;
  const props = [];
  let fabric = false;
  for (const f of fileList) {
    const p = relOf(f);
    const dirs = p.split("/").slice(1, -1);
    if (dirs.some((d) => skip.has(d))) { skipped++; continue; }
    files.push(f);
    if (/(^|\/)projectProperties\.json$/.test(p)) props.push(p.split("/").length);
    else if (!fabric && /(^|\/)Apps\/[^/]+\//.test(p)) fabric = true;
  }
  const name = files.length ? relOf(files[0]).split("/")[0] : "";
  let kind = "unknown", projects = 0;
  if (group === "fabric") kind = fabric ? "fabric" : "unknown";
  else if (props.length) {
    const min = Math.min(...props);
    projects = props.filter((d) => d === min).length;
    kind = projects > 1 ? "microapps" : "monolith";
  }
  return { name, kind, files, fileCount: files.length, skipped, projects, loadedAt: new Date() };
}

const SCAN_LABEL = { scan: "Index Visualizer project", microapps: "Index micro-app projects", raw: "List project files", fabric: "Index Fabric export", blueprint: "Index for Blueprint", sky: "Index for Observatory" };
// one cached result per folder and key: derive(slot.files, "scan", () => scanFolder(slot.files))
const derived = new WeakMap();
export function derive(files, key, fn) {
  if (!files) return null;
  if (!derived.has(files)) derived.set(files, new Map());
  const m = derived.get(files);
  if (!m.has(key)) m.set(key, trackSync(`${SCAN_LABEL[key] || key} · ${files.length ? relOf(files[0]).split("/")[0] : ""}`, fn));
  return m.get(key);
}

const Ctx = createContext(null);

export function ProjectsProvider({ children }) {
  const [slots, setSlots] = useState({});
  const [names, setNames] = useState(loadNames);
  const [channel, setChannelState] = useState(() => { try { return localStorage.getItem("rs.channel") || "web"; } catch { return "web"; } });
  const setChannel = useCallback((c) => { setChannelState(c); try { localStorage.setItem("rs.channel", c); } catch { /* this session only */ } }, []);
  // the local file service: open folders by path ({ available } once checked)
  const [service, setService] = useState(null);
  const [opening, setOpening] = useState({}); // slot -> { dir, error? } while (re)opening by path
  const loadPath = useCallback(async (id, dir) => {
    const group = FAB_SLOTS.includes(id) ? "fabric" : "viz";
    setOpening((o) => ({ ...o, [id]: { dir } }));
    try {
      const r = await track(`Open folder ${dir}`, () => openFolder(dir.trim(), [...(group === "fabric" ? SKIP_FAB : SKIP_VIZ)]));
      const s = readFolder(r.files, group);
      s.dir = r.dir;
      setSlots((m) => ({ ...m, [id]: s }));
      savePath(id, r.dir);
      setOpening((o) => { const c = { ...o }; delete c[id]; return c; });
    } catch (e) {
      setOpening((o) => ({ ...o, [id]: { dir, error: String(e.message || e) } }));
    }
  }, []);
  // reopen the folders opened by path last time (once)
  const reopened = useRef(false);
  useEffect(() => {
    if (reopened.current) return;
    reopened.current = true;
    serviceStatus().then((st) => {
      setService(st);
      if (!st.available) return;
      for (const [id, dir] of Object.entries(savedPaths())) loadPath(id, dir);
    });
  }, [loadPath]);
  const load = useCallback((id, fileList) => {
    if (!fileList || !fileList.length) return;
    const group = FAB_SLOTS.includes(id) ? "fabric" : "viz";
    const s = trackSync(`List folder (${fileList.length.toLocaleString()} files)`, () => readFolder(fileList, group));
    setSlots((m) => ({ ...m, [id]: s }));
    savePath(id, null);
  }, []);
  const remove = useCallback((id) => { savePath(id, null); setSlots((m) => { const c = { ...m }; delete c[id]; return c; }); }, []);
  const setNamesFor = useCallback((ws, list) => setNames((n) => { const c = { ...n, [ws]: list }; saveNames(c); return c; }), []);
  const value = useMemo(() => {
    const L = { viz: clean(names.viz).map((x) => x.name), fabric: clean(names.fabric).map((x) => x.name) };
    const slotName = (id) => (id === "other" ? "Other project" : FAB_SLOTS.includes(id) ? L.fabric[ROLE_INDEX[id]] : L.viz[ROLE_INDEX[id]]);
    return { slots, load, loadPath, opening, service, remove, names, setNamesFor, L, slotName, channel, setChannel };
  }, [slots, load, loadPath, opening, service, remove, names, setNamesFor, channel, setChannel]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useProjects = () => useContext(Ctx);

function FolderInput({ id, label }) {
  const { load } = useProjects();
  return (
    <label className="pick">{label}
      <input type="file" webkitdirectory="" directory="" multiple style={{ display: "none" }} data-slot={id} onChange={(e) => { load(id, e.target.files); e.target.value = ""; }} />
    </label>
  );
}

// a fixed slot inside a tool's start page: what is loaded there, and replace / choose it in place
export function SlotLink({ id, accept }) {
  const { slots, slotName } = useProjects();
  const s = slots[id];
  if (!s) return <FolderInput id={id} label={`Choose ${slotName(id)} folder`} />;
  const wrong = accept && !accept.includes(s.kind);
  return (
    <div className="slotlink">
      <span className="tag">From Projects: <b>{s.name}</b> · {KIND_LABEL[s.kind]}{s.kind === "microapps" ? ` (${s.projects})` : ""}</span>
      {wrong && <div className="bp-warn">This tool needs {accept.map((k) => KIND_LABEL[k].toLowerCase()).join(" or ")} here.</div>}
      <FolderInput id={id} label="Replace folder" />
    </div>
  );
}

// any loaded Visualizer folder of the accepted kinds, or a new one (loaded into the spare slot)
export function SlotSelect({ accept, value, onChange }) {
  const { slots, slotName } = useProjects();
  const options = VIZ_SLOTS.filter((id) => slots[id] && accept.includes(slots[id].kind));
  return (
    <div className="slotselect">
      {options.length > 0 && (
        <div className="seg">
          {options.map((id) => (
            <button key={id} type="button" className={value === id ? "on" : ""} onClick={() => onChange(id)} title={slots[id].name}>
              {slotName(id)} · {slots[id].name}
            </button>
          ))}
        </div>
      )}
      <FolderInput id="other" label={options.length ? "Another folder…" : "Choose folder"} />
    </div>
  );
}

// the preferred loaded folder for a tool that works on one project
export function preferSlot(slots, accept, order = ["custom", "base", "target", "other"]) {
  return order.find((id) => slots[id] && accept.includes(slots[id].kind)) || null;
}

// the folder a one-project tool works on: the user's choice while it stays loaded, else the preferred one; a folder
// just loaded with "Another folder…" is chosen at once
export function useSlotChoice(accept) {
  const { slots } = useProjects();
  const [id, setId] = useState(null);
  const other = slots.other;
  useEffect(() => { if (other && accept.includes(other.kind)) setId("other"); }, [other]); // eslint-disable-line react-hooks/exhaustive-deps
  const cur = id && slots[id] && accept.includes(slots[id].kind) ? id : preferSlot(slots, accept);
  return [cur, setId];
}
