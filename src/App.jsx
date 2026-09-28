import { useState } from "react";
import "./App.css";
import { extract, buildModel, groupFiles, isMainController, controllerKey } from "./lib/analyzer";
import { TwoCol, ThreeCol } from "./components/DiffView";
import { Checklist } from "./components/Checklist";

const DEFAULT_LABELS = ["R21", "KBZ", "R26"];

export default function App() {
  const [mode, setMode] = useState("single");
  const [slots, setSlots] = useState([
    { label: "R21", name: "", src: "" },
    { label: "KBZ", name: "", src: "" },
    { label: "R26", name: "", src: "" },
  ]);
  const [model, setModel] = useState(null);
  const [tab, setTab] = useState("overview");
  const [member, setMember] = useState(null);
  const [view, setView] = useState("OLD_CUST");
  const [err, setErr] = useState("");

  // bulk mode
  const [tokens, setTokens] = useState(["R21", "KBZ", "R26"]);
  const [bulkFiles, setBulkFiles] = useState([]); // [{name, src, relPath}]
  const [bulk, setBulk] = useState(null);          // { results, unmatched }
  const [drill, setDrill] = useState(null);        // index into bulk.results

  // project-folders mode
  const [projFiles, setProjFiles] = useState([[], [], []]); // per version: [{key,name,src}]
  const [progress, setProgress] = useState(null);  // {done,total,running}

  const onProjectFolder = (i, fileList) => {
    const mains = [...fileList].filter((f) => isMainController(f.name));
    Promise.all(mains.map((f) => new Promise((res) => {
      const r = new FileReader();
      r.onload = () => res({ key: controllerKey(f.webkitRelativePath || f.name), name: f.name, src: r.result });
      r.readAsText(f);
    }))).then((list) => setProjFiles((prev) => { const c = [...prev]; c[i] = list; return c; }));
  };

  const analyzeProjects = async () => {
    setErr("");
    const toks = tokens.map((t) => t.trim()).filter(Boolean);
    const [BASE, CUST, NEW] = toks;
    const maps = projFiles.map((arr) => new Map(arr.map((x) => [x.key, x])));
    const keys = [...new Set(projFiles.flatMap((arr) => arr.map((x) => x.key)))].sort();
    const results = [];
    setProgress({ done: 0, total: keys.length, running: true });
    for (let idx = 0; idx < keys.length; idx++) {
      const key = keys[idx];
      const name = key.split("/").pop().replace(/\.js$/, "");
      const present = toks.filter((t, k) => maps[k] && maps[k].has(key));
      const base = maps[0] && maps[0].get(key), cust = maps[1] && maps[1].get(key), nw = maps[2] && maps[2].get(key);
      if (!base || !cust) {
        results.push({ base: name, path: key, incomplete: true, present });
      } else {
        try {
          const files = [[BASE, base], [CUST, cust], [NEW, nw]].filter(([t, f]) => t && f)
            .map(([t, f]) => ({ label: t, name: f.name, src: f.src, parsed: extract(f.src) }));
          results.push({ base: name, path: key, model: buildModel(files), present });
        } catch (e) {
          results.push({ base: name, path: key, error: String(e.message || e), present });
        }
      }
      if (idx % 8 === 0) { setProgress({ done: idx + 1, total: keys.length, running: true }); await new Promise((r) => setTimeout(r)); }
    }
    setProgress({ done: keys.length, total: keys.length, running: false });
    setBulk({ results, unmatched: [] });
    setDrill(null);
  };

  const onFile = (i, file) => {
    if (!file) return;
    const r = new FileReader();
    r.onload = () => {
      setSlots((s) => {
        const c = [...s];
        const m = file.name.match(/_([A-Za-z0-9]+)\.js$/);
        c[i] = { label: m ? m[1] : c[i].label || DEFAULT_LABELS[i], name: file.name, src: r.result };
        return c;
      });
    };
    r.readAsText(file);
  };

  const setLabel = (i, v) => setSlots((s) => { const c = [...s]; c[i] = { ...c[i], label: v }; return c; });
  const canAnalyze = slots[0].src && slots[1].src;

  const analyze = () => {
    setErr("");
    try {
      const files = slots
        .filter((s) => s.src)
        .map((s) => ({ label: s.label.trim() || "?", name: s.name, src: s.src, parsed: extract(s.src) }));
      const m = buildModel(files);
      setModel(m);
      setMember(m.genuine[0] || null);
      setView("OLD_CUST");
      setTab("overview");
    } catch (e) {
      setErr(String(e.message || e));
    }
  };

  const onBulkFiles = (fileList) => {
    const js = [...fileList].filter((f) => f.name.toLowerCase().endsWith(".js"));
    Promise.all(js.map((f) => new Promise((res) => {
      const r = new FileReader();
      r.onload = () => res({ name: f.name, src: r.result, relPath: f.webkitRelativePath || f.name });
      r.readAsText(f);
    }))).then((list) => setBulkFiles((prev) => {
      const map = new Map(prev.map((x) => [x.relPath, x]));
      list.forEach((x) => map.set(x.relPath, x));
      return [...map.values()];
    }));
  };

  const analyzeBulk = () => {
    setErr("");
    const toks = tokens.map((t) => t.trim()).filter(Boolean);
    const [BASE, CUST, NEW] = toks;
    const { groups, unmatched } = groupFiles(bulkFiles, toks);
    const results = groups.map((g) => {
      const present = toks.filter((t) => g.byVersion[t]);
      if (!g.byVersion[BASE] || !g.byVersion[CUST]) return { base: g.base, incomplete: true, present };
      try {
        const files = [BASE, CUST, NEW].filter((t) => t && g.byVersion[t]).map((t) => {
          const f = g.byVersion[t];
          return { label: t, name: f.name, src: f.src, parsed: extract(f.src) };
        });
        return { base: g.base, model: buildModel(files), present };
      } catch (e) {
        return { base: g.base, error: String(e.message || e), present };
      }
    });
    setBulk({ results, unmatched });
    setDrill(null);
  };

  const openDrill = (i) => { setDrill(i); setTab("overview"); setView("OLD_CUST"); setMember(bulk.results[i].model.genuine[0] || null); };

  const reset = () => { setModel(null); setBulk(null); setDrill(null); setErr(""); setProgress(null); };

  const busy = model || bulk;
  const projCounts = projFiles.map((a) => a.length);

  return (
    <div className="app">
      <header>
        <h1>Retrofit Studio</h1>
        <span className="meta">
          {model ? model.names.join("  •  ")
            : bulk ? `${bulk.results.length} controllers`
              : "Format + compare Kony/Temenos controllers"}
        </span>
        <span className="spacer" />
        {busy && <button className="btn ghost" onClick={reset}>New</button>}
      </header>
      <main>
        {model ? (
          <Report model={model} tab={tab} setTab={setTab} member={member} setMember={setMember} view={view} setView={setView} />
        ) : bulk ? (
          drill != null ? (
            <div>
              <button className="btn ghost" onClick={() => setDrill(null)} style={{ marginBottom: 10 }}>← All controllers</button>
              <h2 style={{ margin: "0 0 8px" }}>{bulk.results[drill].base}</h2>
              <Report model={bulk.results[drill].model} tab={tab} setTab={setTab} member={member} setMember={setMember} view={view} setView={setView} />
            </div>
          ) : (
            <Dashboard bulk={bulk} tokens={tokens.map((t) => t.trim()).filter(Boolean)} openDrill={openDrill} />
          )
        ) : (
          <div>
            <div className="seg" style={{ marginBottom: 12 }}>
              <button className={mode === "single" ? "on" : ""} onClick={() => setMode("single")}>Single controller</button>
              <button className={mode === "projects" ? "on" : ""} onClick={() => setMode("projects")}>Project folders</button>
              <button className={mode === "bulk" ? "on" : ""} onClick={() => setMode("bulk")}>Loose files</button>
            </div>
            {mode === "single" ? (
              <Uploader slots={slots} onFile={onFile} setLabel={setLabel} canAnalyze={canAnalyze} analyze={analyze} err={err} />
            ) : mode === "projects" ? (
              <ProjectUploader tokens={tokens} setTokens={setTokens} counts={projCounts} onFolder={onProjectFolder}
                clear={() => setProjFiles([[], [], []])} analyze={analyzeProjects} progress={progress} err={err} />
            ) : (
              <BulkUploader tokens={tokens} setTokens={setTokens} bulkFiles={bulkFiles} onBulkFiles={onBulkFiles}
                clearBulk={() => setBulkFiles([])} analyzeBulk={analyzeBulk} err={err} />
            )}
          </div>
        )}
      </main>
    </div>
  );
}

function Uploader({ slots, onFile, setLabel, canAnalyze, analyze, err }) {
  const titles = ["Base (old) — required", "Custom — required", "New base — optional"];
  return (
    <div className="uploader">
      <div className="rules">
        Upload 2–3 controller versions. Each file is <b>formatted</b> (K&amp;R braces, <code>key: value</code>, no line
        wrapping) and then <b>compared</b> — so only real code changes show. Everything runs in your browser.
      </div>
      <div className="grid">
        {slots.map((s, i) => (
          <div key={i} className={"slot" + (s.src ? " filled" : "")}>
            <h3>{titles[i]}</h3>
            <input type="text" value={s.label} onChange={(e) => setLabel(i, e.target.value)} placeholder="label" />
            <div className="fname">{s.name}</div>
            <input type="file" accept=".js" onChange={(e) => onFile(i, e.target.files[0])} />
          </div>
        ))}
      </div>
      <div style={{ marginTop: 14 }}>
        <button className="btn" disabled={!canAnalyze} onClick={analyze}>Format &amp; Compare</button>
        {err && <div style={{ color: "#e0533d", marginTop: 8 }}>{err}</div>}
      </div>
    </div>
  );
}

function Report({ model, tab, setTab, member, setMember, view, setView }) {
  const [O, C, N] = model.labels;
  const bc = {};
  Object.values(model.members).forEach((x) => { if (x.bucket) bc[x.bucket] = (bc[x.bucket] || 0) + 1; });
  const tabs = [["overview", "Overview"], ["genuine", `Genuine Changes (${C}→${O})`]];
  if (model.hasNew) tabs.push(["threeway", "3-Way + Buckets"], ["checklist", "Retrofit Checklist"], ["widgets", "Widget Remap"]);

  const gotoMember = (name) => { setMember(name); setTab("genuine"); };

  return (
    <div>
      <div className="cards">
        {model.labels.map((l) => (
          <div className="card" key={l}><div className="n">{model.counts[l]}</div><div className="l">{l} members</div></div>
        ))}
        <div className="card"><div className="n">{model.genuine.length}</div><div className="l">{C} vs {O} changes</div></div>
        {model.hasNew && (
          <div className="card"><div className="n">{[1, 2, 3, 4, 5].map((k) => bc[k] || 0).join("/")}</div><div className="l">buckets 1·2·3·4·5</div></div>
        )}
      </div>

      <div className="tabs">
        {tabs.map(([k, t]) => (
          <div key={k} className={"tab" + (k === tab ? " active" : "")} onClick={() => setTab(k)}>{t}</div>
        ))}
      </div>

      <div className="view">
        {tab === "overview" && <Overview model={model} O={O} C={C} N={N} />}
        {tab === "genuine" && (
          <Genuine model={model} O={O} C={C} N={N} member={member} setMember={setMember} view={view} setView={setView} />
        )}
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
      <p className="note">
        <b>{O}</b> = old base (common ancestor) · <b>{C}</b> = customisation on {O} · <b>{N || "—"}</b> = new base / upgrade target.
        Each <b>{C}</b> change must be re-expressed on <b>{N || "the new base"}</b>.
      </p>
      <table>
        <thead><tr><th>Module signature</th>{model.labels.map((l) => <th key={l}>{l}</th>)}</tr></thead>
        <tbody><tr><td>define()</td>{model.labels.map((l) => <td key={l} className="mono">{model.moduleNames[l] ? `"${model.moduleNames[l]}"` : "(anonymous)"}</td>)}</tr></tbody>
      </table>
      {model.hasNew && (
        <>
          <h3>Customisations to retrofit onto {N}</h3>
          <table>
            <thead><tr><th>Member</th><th>Change</th><th>Bucket</th><th>Deterministic note</th></tr></thead>
            <tbody>
              {model.genuine.map((n) => {
                const x = model.members[n];
                return <tr key={n}><td><b>{n}</b></td><td><span className={"pill " + x.change}>{x.change}</span></td>
                  <td className={"b" + (x.bucket || "q")}>{x.bucket ? "Bucket " + x.bucket : ""}</td><td>{x.note}</td></tr>;
              })}
            </tbody>
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
  const activeView = model.hasNew ? view : "OLD_CUST";

  return (
    <div className="split">
      <div className="memberlist">
        {model.genuine.map((n) => {
          const m = model.members[n];
          return (
            <div key={n} className={"memrow" + (n === cur ? " sel" : "")} onClick={() => setMember(n)}>
              <b>{n}</b> <span className={"pill " + (m.change || "")}>{m.change}</span>{" "}
              {m.bucket && <span className={"pill b" + m.bucket}>B{m.bucket}</span>}
              <div className="tag">{m.kind}{model.hasNew ? ` · in ${N}: ${m.inNew || ""}` : ""}</div>
            </div>
          );
        })}
      </div>
      <div>
        <h3 style={{ margin: "0 0 4px" }}>{cur}</h3>
        <div className="tag">kind: {x.kind} · change: {x.change || "—"} {x.bucket ? "· bucket " + x.bucket : ""}</div>
        {x.note && <div className="note">{x.note}</div>}
        <div className="seg">
          {views.map(([k, t]) => <button key={k} className={k === activeView ? "on" : ""} onClick={() => setView(k)}>{t}</button>)}
        </div>
        {activeView === "ALL3" ? (
          <>
            <div className="legend">
              <span style={{ background: "var(--add-bg)" }}>green = added vs {O}</span>{" "}
              <span style={{ background: "var(--del-bg)" }}>red = missing vs {O}</span>{" "}
              <span style={{ background: "var(--chg-bg)" }}>amber = {O} line changed in a branch</span>
            </div>
            <ThreeCol base={x.bodies[O]} custom={x.bodies[C]} next={x.bodies[N]} lo={O} lc={C} ln={N} />
          </>
        ) : (
          (() => {
            const [la, lb] = pairMap[activeView];
            return (
              <>
                <div className="legend">
                  <span style={{ background: "var(--del-bg)" }}>red = only in {la}</span>{" "}
                  <span style={{ background: "var(--add-bg)" }}>green = only in {lb}</span>
                </div>
                <TwoCol aBody={x.bodies[la]} bBody={x.bodies[lb]} la={la} lb={lb} />
              </>
            );
          })()
        )}
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
        <tbody>
          {rows.map((n, i) => {
            const x = model.members[n];
            const mk = (l) => (x.present[l] ? "Y" : "–");
            return (
              <tr key={n} style={{ cursor: "pointer" }} onClick={() => gotoMember(n)}>
                <td>{i + 1}</td><td><b>{n}</b></td>
                <td style={{ textAlign: "center" }}>{mk(O)}</td><td style={{ textAlign: "center" }}>{mk(C)}</td><td style={{ textAlign: "center" }}>{mk(N)}</td>
                <td className={"b" + (x.bucket || "q")} style={{ textAlign: "center" }}>{x.bucket}</td><td>{x.note}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Widgets({ model }) {
  const w = model.widgets.filter((x) => x.remap);
  return (
    <div>
      <p className="note">
        Widgets whose presence differs across versions — a likely field/index remap or added/removed widget.
        A <span style={{ background: "var(--del-bg)", padding: "0 6px" }}>0</span> means the widget is absent in that version (form-layer work needed).
      </p>
      <table>
        <thead><tr><th>Widget token</th>{model.labels.map((l) => <th key={l}>{l}</th>)}</tr></thead>
        <tbody>
          {w.map((x) => (
            <tr key={x.token}>
              <td className="mono">{x.token}</td>
              {model.labels.map((l) => (
                <td key={l} style={{ textAlign: "center", background: x.counts[l] === 0 ? "var(--del-bg)" : undefined }}>{x.counts[l]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="tag">{w.length} of {model.widgets.length} widget tokens differ across versions.</p>
    </div>
  );
}

function BulkUploader({ tokens, setTokens, bulkFiles, onBulkFiles, clearBulk, analyzeBulk, err }) {
  const toks = tokens.map((t) => t.trim()).filter(Boolean);
  const { groups, unmatched } = groupFiles(bulkFiles, toks);
  const [BASE, CUST] = toks;
  const complete = groups.filter((g) => g.byVersion[BASE] && g.byVersion[CUST]).length;
  const setTok = (i, v) => setTokens((t) => { const c = [...t]; c[i] = v; return c; });
  const titles = ["Base (old)", "Custom", "New base (optional)"];

  return (
    <div className="uploader">
      <div className="rules">
        Upload a <b>whole set of controllers</b> at once (pick a folder, or many <code>.js</code> files). They're grouped
        into version triples by filename suffix (<code>frmX_R21.js</code>) or by version-named sub-folders, then each
        controller is formatted &amp; compared. Everything runs in your browser.
      </div>
      <div className="grid" style={{ gridTemplateColumns: "repeat(3,1fr)" }}>
        {titles.map((t, i) => (
          <div className="slot filled" key={i} style={{ borderStyle: "solid" }}>
            <h3>{t} — version token</h3>
            <input type="text" value={tokens[i] || ""} onChange={(e) => setTok(i, e.target.value)} placeholder="e.g. R21" />
          </div>
        ))}
      </div>
      <div style={{ margin: "12px 0", display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
        <label className="btn" style={{ cursor: "pointer" }}>
          Choose folder
          <input type="file" webkitdirectory="" directory="" multiple style={{ display: "none" }} onChange={(e) => onBulkFiles(e.target.files)} />
        </label>
        <label className="btn ghost" style={{ cursor: "pointer", color: "var(--accent)", border: "1px solid var(--line)" }}>
          Choose files
          <input type="file" accept=".js" multiple style={{ display: "none" }} onChange={(e) => onBulkFiles(e.target.files)} />
        </label>
        <span className="tag">{bulkFiles.length} .js file(s) loaded · {groups.length} controller(s) detected · {complete} complete</span>
        {bulkFiles.length > 0 && <button className="btn ghost" style={{ color: "var(--accent)", border: "1px solid var(--line)" }} onClick={clearBulk}>Clear</button>}
      </div>

      {groups.length > 0 && (
        <div style={{ maxHeight: 260, overflow: "auto", marginBottom: 12 }}>
          <table>
            <thead><tr><th>Controller</th>{toks.map((t) => <th key={t}>{t}</th>)}<th>Status</th></tr></thead>
            <tbody>
              {groups.map((g) => {
                const ok = g.byVersion[BASE] && g.byVersion[CUST];
                return (
                  <tr key={g.base}>
                    <td><b>{g.base}</b></td>
                    {toks.map((t) => <td key={t} style={{ textAlign: "center" }}>{g.byVersion[t] ? "✓" : "–"}</td>)}
                    <td>{ok ? <span className="pill Added">ready</span> : <span className="pill Removed">missing {BASE}/{CUST}</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {unmatched.length > 0 && <div className="tag" style={{ marginBottom: 8 }}>Unmatched (no version token): {unmatched.join(", ")}</div>}

      <button className="btn" disabled={complete === 0} onClick={analyzeBulk}>Analyze {complete} controller{complete === 1 ? "" : "s"}</button>
      {err && <div style={{ color: "#e0533d", marginTop: 8 }}>{err}</div>}
    </div>
  );
}

function ProjectUploader({ tokens, setTokens, counts, onFolder, clear, analyze, progress, err }) {
  const setTok = (i, v) => setTokens((t) => { const c = [...t]; c[i] = v; return c; });
  const titles = ["Base (old)", "Custom", "New base (optional)"];
  const running = progress && progress.running;
  const canAnalyze = counts[0] > 0 && counts[1] > 0 && !running;
  return (
    <div className="uploader">
      <div className="rules">
        Point at the <b>three project folders</b> (each a full Kony/Temenos project). The tool walks each folder, finds every
        <code>*Controller.js</code>, matches them across projects by their path under <code>controllers/</code>, then formats
        &amp; compares each one. Everything runs in your browser — nothing is uploaded.
      </div>
      <div className="folders">
        {titles.map((t, i) => (
          <div key={i} className={"folder" + (counts[i] > 0 ? " filled" : "")}>
            <h3>{t}</h3>
            <input type="text" value={tokens[i] || ""} onChange={(e) => setTok(i, e.target.value)} placeholder="label e.g. R21" style={{ width: 130, textAlign: "center" }} />
            <div className="cnt">{counts[i]}</div><div className="cl">controllers</div>
            <label className="pick">Choose folder
              <input type="file" webkitdirectory="" directory="" multiple style={{ display: "none" }} onChange={(e) => onFolder(i, e.target.files)} />
            </label>
          </div>
        ))}
      </div>
      <div className="toolbar">
        <button className="btn" disabled={!canAnalyze} onClick={analyze}>
          {running ? `Analyzing… ${progress.done}/${progress.total}` : "Analyze project"}
        </button>
        {counts[0] + counts[1] + counts[2] > 0 && <button className="chip" onClick={clear}>Clear</button>}
        <span className="tag">Base + Custom required · New base optional.</span>
      </div>
      {progress && <div className="progress"><div style={{ width: (progress.total ? (progress.done / progress.total) * 100 : 0) + "%" }} /></div>}
      {err && <div style={{ color: "#e0533d" }}>{err}</div>}
    </div>
  );
}

function Dashboard({ bulk, tokens, openDrill }) {
  const [BASE, CUST] = tokens;
  const [q, setQ] = useState("");
  const [onlyChanged, setOnlyChanged] = useState(true);
  const [sort, setSort] = useState({ key: "changes", dir: "desc" });

  const rows = bulk.results.map((r, i) => {
    const bc = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    if (r.model) Object.values(r.model.members).forEach((x) => { if (x.bucket && bc[x.bucket] !== undefined) bc[x.bucket]++; });
    return { ...r, i, changes: r.model ? r.model.genuine.length : 0, conflicts: bc[2], customOnly: bc[4], bc };
  });
  const okRows = rows.filter((r) => r.model);
  const agg = {
    total: bulk.results.length, analyzed: okRows.length,
    changes: okRows.reduce((s, r) => s + r.changes, 0),
    conflicts: okRows.reduce((s, r) => s + r.conflicts, 0),
    customOnly: okRows.reduce((s, r) => s + r.customOnly, 0),
    changed: okRows.filter((r) => r.changes > 0).length,
  };

  let viewRows = rows.filter((r) => (!onlyChanged || r.changes > 0) && (!q || r.base.toLowerCase().includes(q.toLowerCase())));
  const dir = sort.dir === "asc" ? 1 : -1;
  viewRows = [...viewRows].sort((a, b) => sort.key === "name"
    ? dir * a.base.localeCompare(b.base)
    : dir * ((a[sort.key] || 0) - (b[sort.key] || 0)) || a.base.localeCompare(b.base));

  const top = okRows.filter((r) => r.changes > 0).sort((a, b) => b.changes - a.changes).slice(0, 10);
  const maxC = Math.max(1, ...top.map((r) => r.changes));
  const setSortKey = (key) => setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" }));
  const arrow = (key) => (sort.key === key ? (sort.dir === "asc" ? " ▲" : " ▼") : "");

  const exportCsv = () => {
    const out = [["controller", "path", "member", "change", "bucket", "in_new", "note"]];
    okRows.forEach((r) => r.model.genuine.forEach((n) => {
      const x = r.model.members[n];
      out.push([r.base, r.path || "", n, x.change, x.bucket, x.inNew || "", (x.note || "").replace(/\s+/g, " ")]);
    }));
    const csv = out.map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "all_controllers_changes.csv"; a.click();
  };

  const BucketBar = ({ bc }) => {
    const tot = [1, 2, 3, 4, 5].reduce((s, k) => s + bc[k], 0) || 1;
    return (
      <span className="bucketbar" title={`clean:${bc[1]} conflict:${bc[2]} in-new:${bc[3]} custom-only:${bc[4]} new-only:${bc[5]}`}>
        {[1, 2, 3, 4, 5].map((k) => bc[k] > 0 ? <i key={k} className={"s" + k} style={{ width: (bc[k] / tot) * 120 + "px" }} /> : null)}
      </span>
    );
  };

  return (
    <div>
      <div className="cards">
        <div className="card"><div className="n">{agg.total}</div><div className="l">controllers</div></div>
        <div className="card"><div className="n">{agg.changed}</div><div className="l">customised ({CUST}≠{BASE})</div></div>
        <div className="card"><div className="n">{agg.changes}</div><div className="l">total changes</div></div>
        <div className="card"><div className="n" style={{ color: "var(--chg-mark)" }}>{agg.conflicts}</div><div className="l">conflicts (bucket 2)</div></div>
        <div className="card"><div className="n">{agg.customOnly}</div><div className="l">custom-only (bucket 4)</div></div>
      </div>

      {top.length > 0 && (
        <div className="chart">
          <div className="tag" style={{ marginBottom: 2 }}>Top controllers by change volume — click to open</div>
          {top.map((r) => (
            <div className="row" key={r.base}>
              <span className="cname" onClick={() => openDrill(r.i)} title={r.base}>{r.base}</span>
              <span className="bar" style={{ width: (r.changes / maxC) * 100 + "%" }} />
              <span style={{ textAlign: "right" }}>{r.changes}</span>
            </div>
          ))}
        </div>
      )}

      <div className="searchbar">
        <input type="text" placeholder="Search controllers…" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className={"chip" + (onlyChanged ? " on" : "")} onClick={() => setOnlyChanged((v) => !v)}>
          {onlyChanged ? "✓ " : ""}only changed
        </span>
        <span className="tag">{viewRows.length} shown</span>
        <span className="spacer" style={{ flex: 1 }} />
        <button className="btn" onClick={exportCsv}>Export changes (CSV)</button>
      </div>

      <div className="view" style={{ borderRadius: 10, border: "1px solid var(--line)", maxHeight: "62vh", overflow: "auto" }}>
        <table>
          <thead>
            <tr>
              <th className="sortable" onClick={() => setSortKey("name")}>Controller{arrow("name")}</th>
              {tokens.map((t) => <th key={t} style={{ textAlign: "center" }}>{t}</th>)}
              <th className="sortable" style={{ textAlign: "center" }} onClick={() => setSortKey("changes")}>Changes{arrow("changes")}</th>
              <th className="sortable" style={{ textAlign: "center" }} onClick={() => setSortKey("conflicts")}>Conflicts{arrow("conflicts")}</th>
              <th>Buckets</th><th>Status</th>
            </tr>
          </thead>
          <tbody>
            {viewRows.map((r) => {
              const clickable = !!r.model;
              return (
                <tr key={r.path || r.base} className={clickable ? "clickable" : ""} style={{ cursor: clickable ? "pointer" : "default" }} onClick={() => clickable && openDrill(r.i)}>
                  <td><b style={{ color: clickable ? "var(--accent)" : "inherit" }}>{r.base}</b>{r.path && <div className="tag" style={{ maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.path}</div>}</td>
                  {tokens.map((t) => <td key={t} style={{ textAlign: "center" }}>{(r.present || []).includes(t) ? "✓" : "–"}</td>)}
                  <td style={{ textAlign: "center", fontWeight: 700 }}>{r.model ? r.changes : "—"}</td>
                  <td style={{ textAlign: "center", color: r.conflicts ? "var(--chg-mark)" : "inherit" }}>{r.model ? r.conflicts : "—"}</td>
                  <td>{r.model ? <BucketBar bc={r.bc} /> : "—"}</td>
                  <td>
                    {r.model ? <span className="pill Added">ok</span>
                      : r.incomplete ? <span className="pill Modified">missing version</span>
                        : <span className="pill Removed">parse error</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="tag" style={{ marginTop: 8 }}>
        Buckets: <span className="chip s1" style={{ background: "var(--add-mark)", color: "#000" }}>1 clean</span>{" "}
        <span className="chip" style={{ background: "var(--chg-mark)", color: "#000" }}>2 conflict</span>{" "}
        <span className="chip" style={{ background: "#7fb0ff", color: "#000" }}>3 in-new</span>{" "}
        <span className="chip" style={{ background: "#9ad0a5", color: "#000" }}>4 custom-only</span>{" "}
        <span className="chip" style={{ background: "#c9d3e0", color: "#000" }}>5 new-only</span>
      </p>
    </div>
  );
}
