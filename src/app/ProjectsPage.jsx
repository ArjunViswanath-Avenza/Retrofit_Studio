// Projects: load each folder once — every tool works from these. Then pick a tool.
import { useState } from "react";
import { useProjects, VIZ_SLOTS, FAB_SLOTS, KIND_LABEL } from "./projects";
import { VersionNames } from "../components/VersionNames";
import { validate, clean } from "../lib/names";
import { CHANNELS } from "../lib/microapps";
import { AREAS, TOOLS, toolsOf } from "./tools";
import { useRegistry } from "./Shell";

const HINT = {
  base: "Monolith — the release your customisation started from",
  custom: "Monolith — the base plus your own changes",
  target: "Monolith, or the micro-app folder (container + all *MA projects)",
  other: "Any other monolith or micro-app folder, for Explore and Convert",
  fbase: "Exported Fabric app (the folder holding Apps/)",
  fcustom: "Exported Fabric app",
  ftarget: "Exported Fabric app",
};
const nf = (n) => n.toLocaleString();

export default function ProjectsPage({ open }) {
  const P = useProjects();
  const { meta } = useRegistry();
  return (
    <div className="projects">
      <h2 className="page">Projects</h2>
      <div className="crumb">Load each folder once — every tool below works from these. Nothing is uploaded.</div>
      <ServiceNote />

      <section className="pj-sec">
        <div className="pj-head">
          <h3>Visualizer projects</h3>
          <div className="seg">
            {Object.entries(CHANNELS).map(([k, c]) => <button key={k} className={k === P.channel ? "on" : ""} onClick={() => P.setChannel(k)}>{c.label}</button>)}
          </div>
          <span className="tag">channel for the micro-app comparison, Visualize and the Converter</span>
        </div>
        <div className="pj-slots">{VIZ_SLOTS.map((id) => <SlotCard key={id} id={id} />)}</div>
        <Names ws="viz" />
      </section>

      <section className="pj-sec">
        <div className="pj-head"><h3>Fabric exports</h3></div>
        <div className="pj-slots three">{FAB_SLOTS.map((id) => <SlotCard key={id} id={id} />)}</div>
        <Names ws="fabric" />
      </section>

      <section className="pj-sec">
        <div className="pj-head"><h3>Tools</h3><span className="tag">Ctrl+K searches every tool, page, form, controller and template</span></div>
        {AREAS.filter((a) => a.id !== "projects").map((a) => (
          <div key={a.id} className="pj-area">
            <div className="pj-areah">{a.ico} {a.label}</div>
            <div className="pj-tools">
              {toolsOf(a.id).map((t) => {
                const T = TOOLS[t], L = P.L[T.names === "fabric" ? "fabric" : "viz"];
                const need = T.needs(P.slots, L);
                const m = meta[t];
                return (
                  <div key={t} className={"pj-tool" + (need ? " off" : "") + (m && m.entered ? " on" : "")} onClick={() => open(t)}>
                    <div className="pj-ti">{T.ico}</div>
                    <div className="pj-tb">
                      <b>{T.title}</b>
                      <p>{T.desc(L)}</p>
                      <span className={"pj-ts" + (m && m.entered ? " ok" : "")}>{m && m.entered ? m.status : need ? `Needs ${need}` : "Ready to open"}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

function SlotCard({ id }) {
  const { slots, load, loadPath, opening, service, remove, slotName } = useProjects();
  const s = slots[id];
  const busy = opening[id];
  const [dir, setDir] = useState("");
  const input = (label) => (
    <label className="btn ghost tiny pj-pick">{label}
      <input type="file" webkitdirectory="" directory="" multiple style={{ display: "none" }} data-slot={id} onChange={(e) => { load(id, e.target.files); e.target.value = ""; }} />
    </label>
  );
  return (
    <div className={"pj-slot" + (s ? " filled" : "")}>
      <div className="pj-sn">{slotName(id)}</div>
      <div className="pj-sh">{HINT[id]}</div>
      {busy && !busy.error && <div className="pj-opening">Opening {busy.dir}…</div>}
      {busy && busy.error && <div className="pj-err">{busy.error}</div>}
      {s ? (
        <>
          <div className="pj-folder" title={s.dir || s.name}>{s.dir || s.name}</div>
          <div className="pj-meta">
            <span className={"pj-kind k-" + s.kind}>{KIND_LABEL[s.kind]}{s.kind === "microapps" ? ` · ${s.projects} projects` : ""}</span>
            <span>{nf(s.fileCount)} files</span>
            {s.skipped > 0 && <span title="build output, jssrc, .git and similar — never read">{nf(s.skipped)} skipped</span>}
          </div>
          <div className="pj-acts">
            {s.dir && <button className="btn ghost tiny" onClick={() => loadPath(id, s.dir)} title="List the folder again (new or removed files)">Reload</button>}
            {input("Replace")}<button className="btn ghost tiny" onClick={() => remove(id)}>Remove</button>
          </div>
        </>
      ) : <div className="pj-acts">{input("Choose folder")}</div>}
      {service && service.available && (
        <form className="pj-path" onSubmit={(e) => { e.preventDefault(); if (dir.trim()) loadPath(id, dir.trim()); }}>
          <input type="text" value={dir} onChange={(e) => setDir(e.target.value)} placeholder={s && s.dir ? "Another folder's path…" : "…or paste the folder's path"} aria-label={`${slotName(id)} folder path`} data-path-slot={id} />
          <button className="btn tiny" type="submit" disabled={!dir.trim() || (busy && !busy.error)}>Open</button>
        </form>
      )}
    </div>
  );
}

// version names: edit a copy, apply when valid (tools re-run their comparisons with the new names)
function Names({ ws }) {
  const { names, setNamesFor } = useProjects();
  const [draft, setDraft] = useState(null);
  if (!draft) {
    return (
      <div className="pj-names">
        <span className="tag">Version names: <b>{clean(names[ws]).map((x) => x.name).join(" · ")}</b></span>
        <button className="btn ghost tiny" onClick={() => setDraft(names[ws])}>✎ Rename</button>
      </div>
    );
  }
  const err = validate(draft);
  return (
    <div className="pj-names open">
      <VersionNames ws={ws} value={draft} onChange={setDraft} compact />
      <div className="vnactions">
        <button className="btn ghost" onClick={() => setDraft(null)}>Cancel</button>
        <button className="btn" disabled={!!err} onClick={() => { setNamesFor(ws, clean(draft)); setDraft(null); }}>Apply names</button>
      </div>
    </div>
  );
}

function ServiceNote() {
  const { service } = useProjects();
  if (!service) return null;
  return service.available ? (
    <div className="pj-svc ok">⚡ Local file service is on — paste a folder's path to open it straight from disk: much faster to read, kept in memory
      between tools ({service.budgetMb.toLocaleString()} MB budget), and opened again by itself after a reload.</div>
  ) : (
    <div className="pj-svc">Folders are read by the browser. Run the studio with <code>npm run dev</code> to open folders by path through the local file service (faster, and they stay open after a reload).</div>
  );
}
