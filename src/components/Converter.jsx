import { useState, useMemo } from "react";
import { CHANNELS } from "../lib/microapps";
import { SKIP_DIRS, convert, writeOut } from "../lib/convert";

const NAME_OK = /^[A-Za-z][A-Za-z0-9_]*$/;

// ---------------------------------------------------------------- step 1: inputs
export function ConverterUpload({ channel, setChannel, pick, onFolder, canPlan, onPlan, planning }) {
  const slots = [
    { title: "Monolith to convert", sub: `the customised ${channel === "web" ? "online" : "mobile"} banking project (e.g. ${channel === "web" ? "konyonlinebanking2021" : "konymobilebanking2021"})`, what: "files" },
    { title: "Micro-app reference", sub: "the R26 folder holding the container + all *MA projects — used for structure only", what: "projects" },
  ];
  return (
    <div>
      <h2 className="page">⇢ Converter · Monolith to micro app</h2>
      <div className="crumb">Step 1 — choose the channel, the monolith to convert and the micro-app reference.</div>
      <div className="rules">
        The converter rebuilds the monolith as micro-app projects — a container, one micro app per feature, plus shared
        <code> CommonsMA</code> and <code>ResourcesMA</code>. <b>Only the monolith's own code is used.</b> The micro-app reference
        supplies structure only: project setting files, navigation scaffolding and which micro app each module belongs to by
        default. Module names stay as they are; cross-app references are rewritten so the app can run, and every rewrite is reported.
      </div>
      <div className="toolbar">
        <b>Channel</b>
        <div className="seg">
          {Object.entries(CHANNELS).map(([k, c]) => <button key={k} className={k === channel ? "on" : ""} onClick={() => setChannel(k)}>{c.label}</button>)}
        </div>
      </div>
      <div className="folders" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
        {slots.map((s, i) => (
          <div key={s.title} className={"folder" + (pick[i] ? " filled" : "")}>
            <h3>{s.title}</h3>
            <div className="cl">{s.sub}</div>
            <div className="cnt">{pick[i] ? (i === 0 ? pick[i].raw.files.length.toLocaleString() : pick[i].apps.size) : 0}</div>
            <div className="cl">{s.what}</div>
            <label className="pick">Choose folder
              <input type="file" webkitdirectory="" directory="" multiple style={{ display: "none" }} onChange={(e) => onFolder(i, e.target.files)} />
            </label>
            {pick[i] && i === 0 && <div className="sub2">{pick[i].scan.counts.forms} forms · {pick[i].scan.counts.controllers} controllers · {pick[i].scan.counts.components} user widgets · {pick[i].raw.skipped.toLocaleString()} build / VCS files skipped</div>}
            {pick[i] && i === 1 && <div className="sub2">{[...pick[i].apps.keys()].filter((n) => /MA$/.test(n)).length} micro apps</div>}
          </div>
        ))}
      </div>
      <div style={{ marginTop: 14 }}>
        <button className="btn" disabled={!canPlan || (planning && planning.running)} onClick={onPlan}>Build the conversion plan →</button>
        <span className="tag" style={{ marginLeft: 10 }}>{planning && planning.running ? `${planning.step || "Working"}…` : `Folders never copied: ${SKIP_DIRS.join(", ")}.`}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- step 2: editable plan
export function ConverterPlan({ plan, setPlan, goRun }) {
  const [q, setQ] = useState("");
  const [only, setOnly] = useState("all");
  const setRow = (module, target) => setPlan((p) => ({ ...p, rows: p.rows.map((r) => (r.module === module ? { ...r, target } : r)) }));
  const setName = (k, v) => setPlan((p) => {
    const old = p[k];
    return { ...p, [k]: v, rows: p.rows.map((r) => (r.target === old ? { ...r, target: v } : r)) };
  });
  const bad = plan.rows.filter((r) => !NAME_OK.test(r.target.trim())).length + ["container", "commons", "resources"].filter((k) => !NAME_OK.test(plan[k])).length;
  const projects = useMemo(() => {
    const m = new Map();
    for (const r of plan.rows) { const t = r.target.trim(); m.set(t, (m.get(t) || 0) + 1); }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [plan]);
  const ql = q.trim().toLowerCase();
  const rows = plan.rows.filter((r) => (!ql || `${r.module} ${r.target}`.toLowerCase().includes(ql))
    && (only === "all" || (only === "new" && /new micro app/.test(r.reason)) || (only === "split" && /split across/.test(r.reason)) || (only === "changed" && r.target !== r.suggested)));
  const known = [...new Set([...plan.r26Apps, ...plan.rows.map((r) => r.target), plan.commons, plan.resources])].sort();
  return (
    <div>
      <h2 className="page">▦ Conversion plan</h2>
      <div className="crumb">Step 2 — check which micro app each monolith module goes to. Every module is kept whole and keeps its name.</div>
      <div className="vnames">
        <div className="vnhead"><b>Project names</b><span className="tag">the container and the two shared micro apps</span></div>
        <div className="vngrid" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
          {[["container", "Container app", "app-wide settings, models, native bindings, extras"], ["commons", "Shared code", "modules/ (utilities, ApplicationManager…)"], ["resources", "Shared resources", "themes, images, i18n, web, shared user widgets"]].map(([k, l, h]) => (
            <div key={k} className="vnslot">
              <label htmlFor={`cv-${k}`}>{l}</label>
              <input id={`cv-${k}`} type="text" value={plan[k]} onChange={(e) => setName(k, e.target.value.trim())} />
              <span className="tag">{h}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="cvprojects">
        <b>{projects.length + 3 - projects.filter(([p]) => [plan.container, plan.commons, plan.resources].includes(p)).length} projects will be written:</b>{" "}
        <span className="chip on">{plan.container} (container)</span>{" "}
        {projects.filter(([p]) => ![plan.container].includes(p)).map(([p, n]) => <span key={p} className="chip">{p} · {n} module{n > 1 ? "s" : ""}</span>)}{" "}
        {!projects.some(([p]) => p === plan.resources) && <span className="chip">{plan.resources}</span>}
        {!projects.some(([p]) => p === plan.commons) && <span className="chip">{plan.commons}</span>}
      </div>
      <div className="searchbar">
        <input type="text" placeholder="Search modules or micro apps…" value={q} onChange={(e) => setQ(e.target.value)} />
        {[["all", "All"], ["new", "New micro apps"], ["split", "Split in R26"], ["changed", "Changed by you"]].map(([k, l]) => (
          <span key={k} className={"chip" + (only === k ? " on" : "")} onClick={() => setOnly(k)}>{l}</span>
        ))}
        <span className="spacer" />
        <button className="btn ghost" onClick={() => setPlan((p) => ({ ...p, rows: p.rows.map((r) => ({ ...r, target: r.suggested })) }))}>Reset to suggestions</button>
        <button className="btn" disabled={bad > 0} onClick={goRun}>Continue to conversion →</button>
      </div>
      {bad > 0 && <div className="vnerr">{bad} name(s) are not valid project names — use letters, digits and _ , starting with a letter.</div>}
      <datalist id="cv-apps">{known.map((a) => <option key={a} value={a} />)}</datalist>
      <div className="retrotable" style={{ maxHeight: "60vh" }}>
        <table>
          <thead><tr><th>Monolith module</th><th style={{ textAlign: "center" }}>Forms</th><th style={{ textAlign: "center" }}>Controllers</th><th style={{ textAlign: "center" }}>MVC files</th><th>Micro app</th><th>Why</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.module} className={r.target !== r.suggested ? "cvchanged" : ""}>
                <td><b>{r.module || "(no module)"}</b></td>
                <td style={{ textAlign: "center" }}>{r.forms || "—"}</td>
                <td style={{ textAlign: "center" }}>{r.controllers || "—"}</td>
                <td style={{ textAlign: "center" }}>{r.mvc || "—"}</td>
                <td>
                  <input type="text" list="cv-apps" value={r.target} aria-label={`Micro app for ${r.module}`} onChange={(e) => setRow(r.module, e.target.value)}
                    className={NAME_OK.test(r.target.trim()) ? "" : "cvbad"} style={{ width: "100%", minWidth: 150 }} />
                  {r.target !== r.suggested && <div className="tag">suggested: {r.suggested}</div>}
                </td>
                <td className="tag">{r.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- step 3: convert + write + report
export function ConverterRun({ plan, mono, ma, run, setRun }) {
  const supported = typeof window !== "undefined" && "showDirectoryPicker" in window;
  const [rule, setRule] = useState("all");
  const [q, setQ] = useState("");
  const busy = run && run.running;

  const start = async (dirOverride) => {
    let dir = dirOverride;
    try {
      if (!dir) dir = await window.showDirectoryPicker({ mode: "readwrite" });
    } catch { return; } // picker cancelled
    if (!dirOverride) {
      for await (const _ of dir.values()) { void _; setRun({ confirm: dir }); return; } // not empty: ask first
    }
    setRun({ running: true, step: "Planning files", done: 0, total: 0, dirName: dir.name });
    try {
      const res = await convert(mono.raw.files, ma, plan, (p) => setRun((r) => ({ ...r, ...p, running: true })));
      setRun((r) => ({ ...r, step: "Writing files", done: 0, total: res.out.length }));
      const w = await writeOut(dir, res.out, (p) => setRun((r) => ({ ...r, ...p, step: "Writing files", running: true })));
      setRun({ running: false, result: res, write: w, dirName: dir.name });
    } catch (e) {
      setRun({ running: false, error: String(e.message || e) });
    }
  };

  const res = run && run.result;
  const rules = res ? Object.entries(res.summary.rewriteRules) : [];
  const shown = res ? res.rewrites.filter((r) => (rule === "all" || r.rule === rule) && (!q || `${r.path} ${r.before} ${r.after}`.toLowerCase().includes(q.toLowerCase()))) : [];
  const csv = () => {
    const o = res.out.find((x) => x.path === "conversion-report.csv");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([o.text], { type: "text/csv" }));
    a.download = "conversion-report.csv"; a.click();
  };

  return (
    <div>
      <h2 className="page">⇢ Convert &amp; report</h2>
      <div className="crumb">Step 3 — choose an output folder. The micro-app projects are written straight into it.</div>
      {!res && (
        <div className="rules">
          <b>What will be written</b> — {plan.container} (container) and the feature micro apps from the plan, plus {plan.commons} and {plan.resources}.
          Forms, controllers and business / presentation code are copied unchanged, except: <code>getModule(…)</code> calls that reach another
          micro app get <code>{"{moduleName, appName}"}</code>; named <code>define("Module/…")</code> gets the micro-app prefix; navigation to a form
          in another micro app becomes <code>{"{appName, friendlyName}"}</code>; and <code>NavigationManager.navigateTo</code> learns to keep those in its
          back-stack. Project setting files follow the reference's structure. A <code>conversion-report.csv</code> listing every change is written next to the projects.
        </div>
      )}
      {!supported && <p className="vnerr">This browser cannot write into a folder. Use Chrome or Edge.</p>}
      {run && run.confirm && (
        <div className="vnpanel" style={{ position: "static" }}>
          <p><b>“{run.confirm.name}” is not empty.</b> Files with the same paths will be overwritten; nothing else in the folder is touched.</p>
          <div className="vnactions">
            <button className="btn ghost" onClick={() => setRun(null)}>Choose another folder</button>
            <button className="btn" onClick={() => start(run.confirm)}>Write into it anyway</button>
          </div>
        </div>
      )}
      {!busy && !(run && run.confirm) && (
        <button className="btn" disabled={!supported} onClick={() => start()}>{res ? "Convert again into a folder…" : "Choose output folder & convert →"}</button>
      )}
      {busy && (
        <div style={{ maxWidth: 560, marginTop: 10 }}>
          <p className="note">{run.step}… {run.total ? `${run.done.toLocaleString()} / ${run.total.toLocaleString()}` : ""} {run.dirName ? `→ ${run.dirName}` : ""}</p>
          <div className="progress"><div style={{ width: (run.total ? (run.done / run.total) * 100 : 3) + "%" }} /></div>
        </div>
      )}
      {run && run.error && <p className="vnerr">Conversion stopped: {run.error}</p>}
      {res && (
        <>
          <div className="cards">
            <div className="card"><div className="n">{res.summary.projects.length}</div><div className="l">projects written to “{run.dirName}”</div></div>
            <div className="card"><div className="n">{run.write.written.toLocaleString()}</div><div className="l">files written{run.write.failed.length ? ` · ${run.write.failed.length} failed` : ""}</div></div>
            <div className="card"><div className="n">{res.summary.rewrites.toLocaleString()}</div><div className="l">reference rewrites</div></div>
            <div className="card"><div className="n" style={{ color: res.warnings.length ? "var(--chg-mark)" : undefined }}>{res.warnings.length}</div><div className="l">items to review</div></div>
            <div className="card"><div className="n">{res.summary.navigationManagerAdapted ? "Yes" : "No"}</div><div className="l">NavigationManager adapted</div></div>
          </div>
          <div className="note">
            Shared user widgets in {plan.resources}: {res.summary.widgetsShared} · in feature micro apps: {res.summary.widgetsInFeatureApps} ·
            template copies: {res.summary.templatesCopied} · unreferenced action sequences kept in the container: {res.summary.unreferencedActions} ·
            calls with a computed module / form (not rewritable, check by hand): getModule {res.summary.unresolved.getModule}, navigation {res.summary.unresolved.navigation}.
            Not generated (Visualizer rebuilds them): {res.summary.notGenerated.join(", ")}.
          </div>
          {run.write.failed.length > 0 && <div className="vnerr">Could not write: {run.write.failed.slice(0, 5).map((f) => `${f.path} (${f.error})`).join("; ")}{run.write.failed.length > 5 ? ` and ${run.write.failed.length - 5} more` : ""}</div>}
          {res.warnings.length > 0 && (
            <details className="retro" open>
              <summary><b>Items to review ({res.warnings.length})</b></summary>
              <ul>{res.warnings.slice(0, 200).map((w, i) => <li key={i} className="tag">{w.path ? <span className="mono">{w.path}{w.line ? `:${w.line}` : ""} — </span> : null}{w.message}</li>)}</ul>
            </details>
          )}
          <div className="searchbar">
            <div className="seg">
              <button className={rule === "all" ? "on" : ""} onClick={() => setRule("all")}>All ({res.rewrites.length})</button>
              {rules.map(([k, n]) => <button key={k} className={rule === k ? "on" : ""} onClick={() => setRule(k)}>{k} ({n})</button>)}
            </div>
            <input type="text" placeholder="Search file or code…" value={q} onChange={(e) => setQ(e.target.value)} />
            <span className="spacer" />
            <button className="btn ghost" onClick={csv}>Download report CSV</button>
          </div>
          <div className="retrotable" style={{ maxHeight: "55vh" }}>
            <table>
              <thead><tr><th>File (in the output)</th><th>Line</th><th>Rule</th><th>Before</th><th>After</th></tr></thead>
              <tbody>
                {shown.slice(0, 500).map((r, i) => (
                  <tr key={i}>
                    <td className="mono" style={{ wordBreak: "break-all" }}>{r.path}</td>
                    <td className="mono">{r.line}</td>
                    <td className="tag">{r.rule}</td>
                    <td className="mono pval old">{r.before}</td>
                    <td className="mono pval new">{r.after}</td>
                  </tr>
                ))}
                {shown.length > 500 && <tr><td colSpan={5} className="note">Showing 500 of {shown.length} — the CSV has all of them.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
