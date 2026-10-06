import { useState, useMemo } from "react";
import { CHANNELS } from "../lib/microapps";

const CATS = [
  ["forms", "Forms"],
  ["controllers", "Form controllers"],
  ["mvc", "Presentation & business controllers"],
  ["comps", "User widgets"],
];
const statusText = (L) => ({
  mapped: "Mapped", ambiguous: "Needs review", none: `No ${L[2]} counterpart`,
  tablet: `Tablet / watch — no ${L[2]} counterpart`, stub: `Empty stub — split away in ${L[2]}`,
});
const ORDER = ["mapped", "ambiguous", "none", "tablet", "stub"];

// ---------------------------------------------------------------- upload screen
export function MicroAppUpload({ channel, setChannel, pick, onFolder, canEnter, enter, aligning, labels: L, editor }) {
  const C = CHANNELS[channel];
  const monoForms = (s) => (s ? [...s.forms.keys()].filter((k) => C.mono.includes(k.split("/")[0])).length : 0);
  const slots = [
    { title: L[0], sub: `Base monolith · e.g. ${channel === "web" ? "konyonlinebanking" : "konymobilebanking"}` },
    { title: L[1], sub: `Customised monolith · e.g. ${channel === "web" ? "konyonlinebanking2021" : "konymobilebanking2021"}` },
    { title: L[2], sub: "Micro apps · the folder holding the container app + all *MA projects" },
  ];
  return (
    <div>
      <h2 className="page">❖ Visualizer · Monolith to micro app</h2>
      <div className="crumb">Step 1 — choose the channel and load the two monoliths and the {L[2]} micro-app folder.</div>
      <div className="rules">
        {L[2]} splits the app into micro apps (<code>CardsMA</code>, <code>TransfersMA</code>, … plus shared <code>CommonsMA</code> /{" "}
        <code>ResourcesMA</code>), each carrying desktop and mobile forms. Every monolith form, controller, presentation / business
        controller and user widget is located in its micro app by name (and by content when a name exists in several micro apps),
        then compared {L.join(" · ")} with the same engines as the monolith workspace. Zips and build folders are never read.
      </div>
      {editor}
      <div className="toolbar">
        <b>Channel</b>
        <div className="seg">
          {Object.entries(CHANNELS).map(([k, c]) => (
            <button key={k} className={k === channel ? "on" : ""} onClick={() => setChannel(k)}>{c.label}</button>
          ))}
        </div>
        <span className="note">Monolith channels: {C.mono.join(" · ")} → {L[2]} {C.r26.join(" · ")} forms</span>
      </div>
      <div className="folders">
        {slots.map((s, i) => (
          <div key={s.title} className={"folder" + (pick[i] ? " filled" : "")}>
            <h3>{s.title || "—"} — {s.sub}</h3>
            <div className="cnt">{pick[i] ? (i === 2 ? pick[i].apps.size : monoForms(pick[i])) : 0}</div>
            <div className="cl">{i === 2 ? "projects (micro apps + container)" : `${C.mono.join("/")} forms`}</div>
            <label className="pick">Choose {s.title} folder
              <input type="file" webkitdirectory="" directory="" multiple style={{ display: "none" }} onChange={(e) => onFolder(i, e.target.files)} />
            </label>
            {pick[i] && (
              <div className="sub2">
                {i === 2
                  ? `${pick[i].counts.forms} forms · ${pick[i].counts.controllers} controllers · ${pick[i].counts.components} user widgets · ${pick[i].fileCount.toLocaleString()} files listed`
                  : `${pick[i].counts.controllers} controllers · ${pick[i].counts.business} business · ${pick[i].counts.presentation} presentation · ${pick[i].counts.components} widgets`}
              </div>
            )}
          </div>
        ))}
      </div>
      <div style={{ marginTop: 14 }}>
        <button className="btn" disabled={!canEnter || (aligning && aligning.running)} onClick={enter}>Start comparison →</button>
        <span className="tag" style={{ marginLeft: 10 }}>{aligning && aligning.running ? `${aligning.step}…` : "All three folders required."}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- micro-app map (workspace home)
export function MicroAppMap({ aligned, goto, labels: L }) {
  const STATUS = statusText(L);
  const { report, missing, channel, picked } = aligned;
  const [cat, setCat] = useState("forms");
  const [show, setShow] = useState(new Set(["mapped", "ambiguous", "none"]));
  const [q, setQ] = useState("");
  const [onlyKbz, setOnlyKbz] = useState(false);

  const stats = useMemo(() => Object.fromEntries(CATS.map(([c]) => {
    const s = {};
    for (const r of report[c]) s[r.status] = (s[r.status] || 0) + 1;
    return [c, s];
  })), [report]);

  // monolith module -> where its forms went
  const modules = useMemo(() => {
    const m = new Map();
    for (const r of report.forms) {
      if (r.status === "tablet") continue;
      const x = m.get(r.module) || { module: r.module, homes: {}, mapped: 0, none: 0, kbzOnly: 0 };
      if (r.target) { const h = `${r.target.app} · ${r.target.module}`; x.homes[h] = (x.homes[h] || 0) + 1; x.mapped++; } else x.none++;
      if (!r.present[0] && r.present[1]) x.kbzOnly++;
      m.set(r.module, x);
    }
    const biz = {};
    for (const r of report.mvc) if (r.kind === "B" && r.target && /BusinessController\.js$/.test(r.key)) biz[r.module] = `${r.target.app} · ${r.target.module}`;
    return [...m.values()].map((x) => ({ ...x, biz: biz[x.module] })).sort((a, b) => a.module.localeCompare(b.module));
  }, [report]);

  // KBZ customisation landing: KBZ-only forms grouped by their (suggested) micro app
  const kbzOnly = useMemo(() => {
    const g = {};
    for (const r of report.forms) {
      if (r.present[0] || !r.present[1]) continue;
      const home = r.target ? `${r.target.app} · ${r.target.module} (exists in ${L[2]})` : r.suggest ? `${r.suggest.replace(":", " · ")} (suggested)` : r.status === "tablet" ? `tablet / watch — no ${L[2]} counterpart` : "no suggestion";
      (g[home] = g[home] || []).push(r.name);
    }
    return Object.entries(g).sort((a, b) => b[1].length - a[1].length);
  }, [report, L]);

  const rows = report[cat].filter((r) => show.has(r.status) && (!onlyKbz || (!r.present[0] && r.present[1]))
    && (!q || `${r.key} ${r.target ? r.target.app + " " + r.target.key : ""}`.toLowerCase().includes(q.toLowerCase())));
  const toggle = (s) => setShow((x) => { const n = new Set(x); if (n.has(s)) n.delete(s); else n.add(s); return n; });

  const exportCsv = () => {
    const out = [["type", "monolith item", `in ${L[0]}`, `in ${L[1]}`, "status", `${L[2]} micro app`, `${L[2]} item`, "how matched", "alternatives", "suggested home"]];
    for (const [c] of CATS) for (const r of report[c])
      out.push([c, r.key, r.present[0] ? "Y" : "", r.present[1] ? "Y" : "", STATUS[r.status], r.target ? r.target.app : "", r.target ? r.target.key : "", r.method, r.alts.join("; "), r.suggest || ""]);
    const csv = out.map((x) => x.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `microapp_map_${channel}.csv`; a.click();
  };

  return (
    <div>
      <h2 className="page">❖ Micro-app map · {CHANNELS[channel].label}</h2>
      <div className="crumb">
        Where every {L[0]} / {L[1]} monolith item lives in the {L[2]} micro apps ({picked[2].microApps} projects loaded). The comparison menus use this map.
      </div>
      {missing.length > 0 && (
        <div className="rules">Declared in the container manifests but not provided (ignored): <b>{missing.join(", ")}</b>.</div>
      )}

      <div className="mapcards">
        {CATS.map(([c, t]) => {
          const s = stats[c];
          const total = report[c].length;
          return (
            <div key={c} className={"mapcard" + (c === cat ? " on" : "")} onClick={() => setCat(c)}>
              <div className="mt">{t}</div>
              <div className="mn"><b>{s.mapped || 0}</b> / {total} mapped</div>
              <div className="mbar">
                {ORDER.map((k) => s[k] ? <i key={k} className={"ms-" + k} style={{ width: (s[k] / total) * 100 + "%" }} title={`${STATUS[k]}: ${s[k]}`} /> : null)}
              </div>
              <div className="ml">
                {s.ambiguous ? <span>{s.ambiguous} to review · </span> : null}
                {s.none || 0} without counterpart{s.tablet ? ` · ${s.tablet} tablet/watch` : ""}{s.stub ? ` · ${s.stub} stubs` : ""} · {report.r26Only[c]} {L[2]}-only
              </div>
            </div>
          );
        })}
      </div>

      <div className="mapgrid">
        <div className="mappanel">
          <h3>Monolith module → {L[2]} micro app</h3>
          <table className="maptable">
            <thead><tr><th>Monolith module</th><th>Forms moved to</th><th>Business controller →</th><th>Not found</th></tr></thead>
            <tbody>
              {modules.map((m) => (
                <tr key={m.module}>
                  <td><b>{m.module || "(no module)"}</b></td>
                  <td>{Object.entries(m.homes).sort((a, b) => b[1] - a[1]).map(([h, n]) => <div key={h}>{h} <span className="tag">×{n}</span></div>)}{!m.mapped && <span className="tag">—</span>}</td>
                  <td>{m.biz || <span className="tag">—</span>}</td>
                  <td>{m.none ? <b className="r">{m.none}</b> : <span className="tag">—</span>}{m.kbzOnly ? <span className="tag"> ({m.kbzOnly} {L[1]}-only)</span> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mappanel">
          <h3>Where {L[1]}-only forms belong in {L[2]}</h3>
          {kbzOnly.length === 0 ? <p className="note">No {L[1]}-only forms.</p> : kbzOnly.map(([home, names]) => (
            <div key={home} className="kbzhome">
              <div><b>{home}</b> <span className="tag">{names.length} form{names.length > 1 ? "s" : ""}</span></div>
              <div className="tag">{names.join(", ")}</div>
            </div>
          ))}
          <div className="toolbar" style={{ marginTop: 10 }}>
            <button className="btn" onClick={() => goto("forms")}>Compare forms →</button>
            <button className="btn" onClick={() => goto("controllers")}>Compare controllers →</button>
          </div>
        </div>
      </div>

      <h3 style={{ margin: "16px 0 6px" }}>{CATS.find(([c]) => c === cat)[1]} — item by item</h3>
      <div className="searchbar">
        <div className="seg">{CATS.map(([c, t]) => <button key={c} className={c === cat ? "on" : ""} onClick={() => setCat(c)}>{t}</button>)}</div>
        <input type="text" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
        {ORDER.filter((s) => stats[cat][s]).map((s) => (
          <span key={s} className={"chip" + (show.has(s) ? " on" : "")} onClick={() => toggle(s)}>{show.has(s) ? "✓ " : ""}{STATUS[s]} ({stats[cat][s]})</span>
        ))}
        <span className={"chip" + (onlyKbz ? " on" : "")} onClick={() => setOnlyKbz((v) => !v)}>{onlyKbz ? "✓ " : ""}{L[1]}-only</span>
        <span className="spacer" />
        <button className="btn ghost" onClick={exportCsv}>Export CSV</button>
      </div>
      <table className="maptable">
        <thead><tr><th>Monolith item</th><th style={{ textAlign: "center" }}>{L[0]}</th><th style={{ textAlign: "center" }}>{L[1]}</th><th>Status</th><th>{L[2]} location</th><th>How it was matched</th></tr></thead>
        <tbody>
          {rows.slice(0, 600).map((r) => (
            <tr key={r.key}>
              <td className="mono" style={{ wordBreak: "break-all" }}>{r.key}</td>
              <td style={{ textAlign: "center" }}>{r.present[0] ? <span className="a">✓</span> : <span className="tag">—</span>}</td>
              <td style={{ textAlign: "center" }}>{r.present[1] ? <span className="a">✓</span> : <span className="tag">—</span>}</td>
              <td><span className={"mstat ms-" + r.status}>{STATUS[r.status]}</span></td>
              <td>{r.target ? <><b>{r.target.app}</b><div className="tag mono" style={{ wordBreak: "break-all" }}>{r.target.key}</div></> : r.suggest ? <span className="tag">suggested: {r.suggest.replace(":", " · ")}</span> : <span className="tag">—</span>}</td>
              <td className="tag">{r.method}{r.alts.length > 0 && <div>other candidates: {r.alts.join(", ")}</div>}</td>
            </tr>
          ))}
          {rows.length > 600 && <tr><td colSpan={6} className="note">Showing 600 of {rows.length} — use search or the filters, or export CSV.</td></tr>}
          {!rows.length && <tr><td colSpan={6} className="note">Nothing matches.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
