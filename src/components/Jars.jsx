import { useState, useEffect, useMemo, useReducer } from "react";
import { DiffPane } from "./Overall";
import { RETRO_BUCKETS as BUCKETS } from "../lib/fabric";
import { diffTexts } from "../lib/filediff";
import {
  indexCached, compareJars, jarRetrofit, classPair, classText, memberDiff, resourcePair, sourceDiff,
  subscribeDecompile, decompileState, decompilerStatus, loadDecompilerStatus, requestDecompile, prioritise,
} from "../lib/jars";

const JAR_ST = ["changed", "onlyA", "onlyB", "samecode", "identical"];
const stLabel = (st, [la, lb]) => ({
  changed: "Changed", onlyA: `Only in ${la}`, onlyB: `Only in ${lb}`, samecode: "Same code (rebuilt)", identical: "Identical file",
  rebuilt: "Same code (recompiled)", same: "Identical",
})[st] || st;
const ORDER = { changed: 0, onlyB: 1, onlyA: 2, samecode: 3, identical: 4 };
const className = (p) => p.replace(/\.class$/, "").replace(/\//g, ".");
const kb = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

// re-render on index / decompile progress
function useJarStore() {
  const [, tick] = useReducer((x) => x + 1, 0);
  useEffect(() => subscribeDecompile(tick), []);
}

// ---------------------------------------------------------------- page
export function JarView({ fab, names, pairs, pair, setPair, focus, setFocus }) {
  useJarStore();
  const entries = fab.map((s) => (s ? indexCached(s) : null));
  const idx = entries.map((e) => (e ? e.result : null));
  const labels = pair ? [names[pair[0]], names[pair[1]]] : [];
  const A = pair ? idx[pair[0]] : null, B = pair ? idx[pair[1]] : null;
  const cmp = useMemo(() => (A && B ? compareJars(A, B) : null), [A, B]); // eslint-disable-line react-hooks/exhaustive-deps
  const all = fab.every(Boolean);
  const retro = useMemo(() => (all && idx.every(Boolean) ? jarRetrofit(idx) : null), [all, idx[0], idx[1], idx[2]]); // eslint-disable-line react-hooks/exhaustive-deps
  const dstatus = decompilerStatus();
  const sel = focus && cmp ? cmp.rows.find((r) => r.base === focus.base) : null;
  const filesOf = (r) => (r ? r.names.map((n, i) => (n ? fab[pair[i]].jarFiles.get(n) : null)) : [null, null]);

  useEffect(() => { loadDecompilerStatus(); }, []);
  // every jar is decompiled: changed jars of the shown pair first, then the rest of the pair, then the other export
  useEffect(() => {
    if (!cmp) return;
    const rows = [...cmp.rows].sort((x, y) => ORDER[x.status] - ORDER[y.status]);
    const items = [];
    for (const r of rows) r.names.forEach((n, i) => n && items.push({ file: fab[pair[i]].jarFiles.get(n), name: n }));
    fab.forEach((s, i) => { if (s && !pair.includes(i)) for (const [n, f] of s.jarFiles || []) items.push({ file: f, name: n }); });
    requestDecompile(items);
  }, [cmp]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (sel) prioritise(filesOf(sel)); }, [sel && sel.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const header = (
    <>
      <h2 className="page">Java JARs · {sel ? sel.base : "decompiled comparison"}</h2>
      <div className="crumb">Every jar in the exports' <code>_JARs</code> folder, compared class by class — {labels[0]} vs {labels[1]}</div>
      {pairs.length > 1 && (
        <div className="toolbar">
          <b>Compare</b>
          <div className="seg">
            {pairs.map((p) => (
              <button key={p.join("")} className={p[0] === pair[0] && p[1] === pair[1] ? "on" : ""} onClick={() => setPair(p)}>{names[p[0]]} vs {names[p[1]]}</button>
            ))}
          </div>
        </div>
      )}
      <DecompileBar status={dstatus} fab={fab} />
    </>
  );

  if (!cmp) {
    return (
      <div>
        {header}
        <div style={{ maxWidth: 560 }}>
          {fab.map((s, i) => s && (
            <div key={i} className="note">
              {names[i]}: {entries[i].error ? `could not read the jars — ${entries[i].error}` : entries[i].result ? `${Object.keys(entries[i].result.jars).length} jars read` : `reading jars… ${entries[i].progress.done}/${entries[i].progress.total}${entries[i].progress.jar ? " · " + entries[i].progress.jar : ""}`}
            </div>
          ))}
          <div className="progress"><div style={{ width: (() => { const p = entries.filter(Boolean).map((e) => e.progress); const t = p.reduce((a, x) => a + (x.total || 0), 0); return (t ? (p.reduce((a, x) => a + x.done, 0) / t) * 100 : 0) + "%"; })() }} /></div>
        </div>
      </div>
    );
  }
  if (sel) {
    const jarIdx = sel.names.map((n, i) => (n ? (i ? B : A).jars[n] : null));
    return (
      <div>
        {header}
        <JarDetail key={`${pair.join("")}:${sel.key}`} row={sel} files={filesOf(sel)} jarIdx={jarIdx} labels={labels} focus={focus} setFocus={setFocus} />
      </div>
    );
  }
  return (
    <div>
      {header}
      {retro && <JarRetrofit retro={retro} names={names} open={(r) => { setPair([1, 2]); setFocus({ base: r.base, item: r.kind === "jar" ? null : r.path }); }} />}
      <JarList cmp={cmp} labels={labels} filesOf={filesOf} open={(r) => setFocus({ base: r.base })} />
    </div>
  );
}

function DecompileBar({ status, fab }) {
  const files = fab.flatMap((s) => (s ? [...(s.jarFiles || new Map()).values()] : []));
  const st = files.map(decompileState).filter(Boolean);
  const n = (k) => st.filter((x) => x.state === k).length;
  const running = st.find((x) => x.state === "running");
  if (!status) return <p className="note">Checking the decompiler…</p>;
  if (!status.available) {
    return <div className="rules">Decompiled source is not available: {status.reason}. The bytecode comparison below still covers every class. Start the app with <code>npm run dev</code> on a machine with Java 11+ to get the Java source view.</div>;
  }
  const total = new Set(files).size, done = n("done");
  return (
    <div className="decbar">
      <b>{status.decompiler}</b> <span className="tag">{status.java}</span>
      <span className="note">
        {done}/{total} jars decompiled{running ? ` · now: ${running.name}` : ""}{n("error") ? ` · ${n("error")} failed` : ""}
      </span>
      {done < total && <div className="progress" style={{ flex: "1 1 160px" }}><div style={{ width: (done / Math.max(1, total)) * 100 + "%" }} /></div>}
    </div>
  );
}

// ---------------------------------------------------------------- all jars
function JarList({ cmp, labels, filesOf, open }) {
  const [la, lb] = labels;
  const [show, setShow] = useState(new Set(JAR_ST));
  const [q, setQ] = useState("");
  const counts = {}; for (const r of cmp.rows) counts[r.status] = (counts[r.status] || 0) + 1;
  const ql = q.trim().toLowerCase();
  const rows = cmp.rows.filter((r) => show.has(r.status) && (!ql || r.names.some((n) => n && n.toLowerCase().includes(ql))))
    .sort((x, y) => ORDER[x.status] - ORDER[y.status] || x.base.localeCompare(y.base));
  const toggle = (k) => setShow((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const dc = (f) => { const s = decompileState(f); return !f ? "" : !s ? "·" : s.state === "done" ? "✓" : s.state === "running" ? "…" : s.state === "error" ? "✕" : s.state === "unavailable" ? "—" : "⧗"; };
  return (
    <div>
      <div className="fabgrid">
        {JAR_ST.map((k) => (
          <div key={k} className={"fabcard" + (show.has(k) ? "" : " dim")} onClick={() => toggle(k)}>
            <div className="fabhead"><span className={"stbadge st-" + k}>{stLabel(k, labels)}</span></div>
            <div className="fabnums"><div><b>{counts[k] || 0}</b><span>jar{counts[k] === 1 ? "" : "s"}</span></div></div>
          </div>
        ))}
      </div>
      <div className="searchbar">
        <input type="text" placeholder="Search jars…" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="note">{rows.length} shown · click a jar to open it</span>
        <span className="spacer" />
        <button className="btn ghost" onClick={() => exportCsv(cmp, labels, filesOf)}>Export CSV</button>
      </div>
      <table>
        <thead>
          <tr>
            <th>Library</th><th>{la}</th><th>{lb}</th><th>Status</th><th>Classes {la}→{lb}</th>
            <th>Classes changed / added / removed</th><th>Recompiled only</th><th>Resources</th><th>Used by services</th><th title="decompiled: ✓ done · … running · ⧗ queued · ✕ failed">Source</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const f = filesOf(r), c = r.counts;
            return (
              <tr key={r.key} className="clickable" style={{ cursor: "pointer" }} onClick={() => open(r)}>
                <td><b>{r.base}</b>{r.error && <div className="tag r">{r.error}</div>}</td>
                <td className="mono">{r.names[0] ? <>{r.versions[0] || "✓"} <span className="tag">{kb(r.sizes[0])}</span></> : <span className="tag">—</span>}</td>
                <td className="mono">{r.names[1] ? <>{r.versions[1] || "✓"} <span className="tag">{kb(r.sizes[1])}</span></> : <span className="tag">—</span>}</td>
                <td><span className={"stbadge st-" + r.status}>{stLabel(r.status, labels)}</span></td>
                <td>{r.nClasses[0]} → {r.nClasses[1]}</td>
                <td>
                  {c.changed > 0 && <b className="c">~{c.changed} </b>}
                  {c.onlyB > 0 && <b className="a">+{c.onlyB} </b>}
                  {c.onlyA > 0 && <b className="r">−{c.onlyA}</b>}
                  {!c.changed && !c.onlyA && !c.onlyB && <span className="tag">—</span>}
                </td>
                <td>{c.rebuilt || <span className="tag">—</span>}</td>
                <td>{c.res ? <b className="c">{c.res}</b> : <span className="tag">—</span>}{c.build ? <span className="tag"> +{c.build} build info</span> : ""}</td>
                <td className="tag">{r.usedBy[0].length} · {r.usedBy[1].length}</td>
                <td className="mono" style={{ textAlign: "center" }}>{dc(f[0])}{f[0] && f[1] ? " " : ""}{dc(f[1])}</td>
              </tr>
            );
          })}
          {!rows.length && <tr><td colSpan={10} className="note">No jars match the filters.</td></tr>}
        </tbody>
      </table>
      <div className="rules" style={{ marginTop: 16 }}>
        <b>How jars are compared</b>
        <ul style={{ margin: "6px 0 0 18px", padding: 0 }}>
          <li>Jars are matched by file name, then by library name without its version (<code>dom4j-2.1.3</code> ↔ <code>dom4j-2.1.4</code>).</li>
          <li><b>Bytecode</b> (always available, in the browser): every class is disassembled with constants resolved, jump targets as labels and debug information (line numbers, local variable names) left out. A class whose bytes differ but whose code is the same is <i>recompiled only</i>, not a change. Lambda bodies are numbered per method so one new lambda does not rename all the others.</li>
          <li><b>Decompiled source</b>: every jar is decompiled with Vineflower by the local dev server (once per jar — results are cached) and compared file by file.</li>
          <li><code>META-INF/MANIFEST.MF</code> and Maven <code>pom.properties</code> carry build dates and tool versions — counted as <i>build info</i>, not as changes.</li>
          <li>"Used by services" counts the services whose <code>Meta.json</code> lists the jar, in {la} · {lb}.</li>
        </ul>
      </div>
    </div>
  );
}

function exportCsv(cmp, labels, filesOf) {
  const [la, lb] = labels;
  const out = [["library", `${la} jar`, `${lb} jar`, "jar status", "level", "item", "status"]];
  for (const r of cmp.rows) {
    const base = [r.base, r.names[0] || "", r.names[1] || "", stLabel(r.status, labels)];
    out.push([...base, "jar", "", stLabel(r.status, labels)]);
    for (const c of r.classes) out.push([...base, "bytecode", className(c.path), stLabel(c.status, labels)]);
    for (const x of r.resources) out.push([...base, x.build ? "resource (build info)" : "resource", x.path, stLabel(x.status, labels)]);
    const d = filesOf(r).map(decompileState);
    if (r.status !== "identical" && d.every((x, i) => !r.names[i] || (x && x.state === "done"))) {
      for (const s of sourceDiff(d[0] && d[0].data, d[1] && d[1].data)) if (s.status !== "same") out.push([...base, "source", s.path, stLabel(s.status, labels)]);
    }
  }
  const csv = out.map((r) => r.map((x) => `"${String(x ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = `java_jars_${la}_vs_${lb}.csv`; a.click();
}

// ---------------------------------------------------------------- one jar pair
function JarDetail({ row, files, jarIdx, labels, focus, setFocus }) {
  const [la, lb] = labels;
  const [tab, setTab] = useState(focus.item && !focus.item.endsWith(".class") ? "res" : focus.item ? "byte" : "source");
  const ds = files.map(decompileState);
  const st = decompilerStatus();
  // bytecode list: the differing classes, or every class of a jar that is on one side only
  const classes = useMemo(() => {
    if (row.status === "onlyA" || row.status === "onlyB") {
      const j = jarIdx[row.status === "onlyA" ? 0 : 1];
      return Object.keys(j.classes).sort().map((p) => ({ path: p, status: row.status }));
    }
    return row.classes;
  }, [row, jarIdx]);
  const resources = useMemo(() => {
    if (row.status === "onlyA" || row.status === "onlyB") {
      const j = jarIdx[row.status === "onlyA" ? 0 : 1];
      return Object.keys(j.resources).sort().map((p) => ({ path: p, status: row.status, build: false }));
    }
    return row.resources;
  }, [row, jarIdx]);
  const srcReady = ds.every((x, i) => !row.names[i] || (x && x.state === "done"));
  const sources = useMemo(() => (srcReady ? sourceDiff(ds[0] && ds[0].data, ds[1] && ds[1].data) : null), [srcReady, ds[0], ds[1]]); // eslint-disable-line react-hooks/exhaustive-deps
  const srcChanged = sources ? sources.filter((s) => s.status !== "same").length : null;

  return (
    <div>
      <button className="btn ghost" onClick={() => setFocus(null)} style={{ marginBottom: 10 }}>← All jars</button>
      <div className="ovhead">
        <div className="ovtitle">{row.names[0] || "—"} ⇄ {row.names[1] || "—"}</div>
        <span className={"stbadge st-" + row.status}>{stLabel(row.status, labels)}</span>
        <span className="note">{row.nClasses[0]} → {row.nClasses[1]} classes{row.counts.changed ? ` · ${row.counts.changed} changed` : ""}{row.counts.onlyB ? ` · ${row.counts.onlyB} added` : ""}{row.counts.onlyA ? ` · ${row.counts.onlyA} removed` : ""}{row.counts.rebuilt ? ` · ${row.counts.rebuilt} recompiled only` : ""}</span>
      </div>
      {(row.usedBy[0].length > 0 || row.usedBy[1].length > 0 || row.deps.some((d) => d.length)) && (
        <div className="refbox">
          {[0, 1].map((i) => row.usedBy[i].length > 0 && (
            <div key={i}><b>Used by in {labels[i]} ({row.usedBy[i].length}):</b>{" "}
              {row.usedBy[i].slice(0, 40).map((s) => <span key={s} className="refchip">{s}</span>)}
              {row.usedBy[i].length > 40 && <span className="tag">+{row.usedBy[i].length - 40} more</span>}
            </div>
          ))}
          {[0, 1].map((i) => row.deps[i].length > 0 && (
            <div key={"d" + i}><b>Depends on ({labels[i]}):</b> {row.deps[i].map((s) => <span key={s} className="refchip">{s}</span>)}</div>
          ))}
        </div>
      )}
      {row.status === "identical" ? (
        <p className="note">The two jar files are byte-for-byte identical — nothing to compare.</p>
      ) : (
        <>
          <div className="fbar">
            <div className="seg">
              <button className={tab === "source" ? "on" : ""} onClick={() => setTab("source")}>Decompiled source{srcChanged != null ? ` (${srcChanged})` : ""}</button>
              <button className={tab === "byte" ? "on" : ""} onClick={() => setTab("byte")}>Bytecode ({classes.filter((c) => c.status !== "rebuilt").length})</button>
              <button className={tab === "res" ? "on" : ""} onClick={() => setTab("res")}>Resources ({resources.length})</button>
            </div>
            <span className="note">{la} = left · {lb} = right</span>
          </div>
          {tab === "source" && (
            sources ? <SourceTab key="s" sources={sources} data={ds.map((x) => x && x.data)} labels={labels} names={row.names} />
              : <SourcePending ds={ds} names={row.names} status={st} />
          )}
          {tab === "byte" && <ByteTab classes={classes} files={files} labels={labels} initial={focus.item && focus.item.endsWith(".class") ? focus.item : null} />}
          {tab === "res" && <ResTab resources={resources} files={files} labels={labels} initial={focus.item && !focus.item.endsWith(".class") ? focus.item : null} />}
        </>
      )}
    </div>
  );
}

function SourcePending({ ds, names, status }) {
  if (status && !status.available) return <p className="note">Decompiled source is not available ({status.reason}). Use the Bytecode tab.</p>;
  return (
    <div className="note">
      {names.map((n, i) => n && (
        <div key={i}>
          {n}: {!ds[i] ? "waiting" : ds[i].state === "running" ? "decompiling…" : ds[i].state === "queued" ? "queued" : ds[i].state === "error" ? `failed — ${ds[i].error}` : ds[i].state}
        </div>
      ))}
      <p>Large jars take up to a minute the first time; after that they come from the cache. The Bytecode tab works meanwhile.</p>
    </div>
  );
}

// a list on the left, a diff on the right
function Split({ items, cur, setCur, label, sub, filters, empty, children }) {
  const [q, setQ] = useState("");
  const ql = q.trim().toLowerCase();
  const list = items.filter((x) => !ql || x.path.toLowerCase().includes(ql));
  return (
    <div className="ovwrap">
      <div className="ovlist">
        <input type="text" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
        {filters}
        <div className="ovitems">
          {list.slice(0, 800).map((x) => (
            <div key={x.path} className={"ovitem" + (cur === x.path ? " sel" : "")} onClick={() => setCur(x.path)}>
              <div className="ovname"><span className={"stdot fst-" + x.status} /><b>{label(x)}</b></div>
              <div className="ovsub">{sub(x)}</div>
            </div>
          ))}
          {list.length > 800 && <p className="note">Showing 800 of {list.length} — search to narrow.</p>}
          {!list.length && <p className="note">{empty}</p>}
        </div>
      </div>
      <div className="ovmain">{children}</div>
    </div>
  );
}

function SourceTab({ sources, data, labels, names }) {
  const [hideSame, setHideSame] = useState(true);
  const items = hideSame ? sources.filter((s) => s.status !== "same") : sources;
  const [cur, setCur] = useState(items[0] ? items[0].path : null);
  const a = cur && data[0] ? data[0].files[cur] ?? null : null, b = cur && data[1] ? data[1].files[cur] ?? null : null;
  const d = useMemo(() => (cur ? diffTexts(a, b) : null), [cur, a, b]);
  const ms = data.map((x) => x && x.ms);
  return (
    <Split items={items} cur={cur} setCur={setCur} label={(x) => x.path.split("/").pop()} sub={(x) => `${x.path.split("/").slice(0, -1).join(".")} · ${stLabel(x.status, labels)}`}
      empty={hideSame ? "All decompiled files are identical." : "No .java files."}
      filters={<div className="stchips"><span className={"chip" + (hideSame ? " on" : "")} onClick={() => setHideSame((v) => !v)}>{hideSame ? "✓ " : ""}hide identical ({sources.length - sources.filter((s) => s.status !== "same").length})</span></div>}>
      {cur && d ? <DiffPane key={cur} sections={[{ id: cur, d }]} la={labels[0]} lb={labels[1]} pathA={a != null ? `${names[0]} · ${cur}` : null} pathB={b != null ? `${names[1]} · ${cur}` : null} />
        : <p className="note">Pick a file.</p>}
      <p className="note">Decompiled with Vineflower{ms.some(Boolean) ? ` (${ms.filter(Boolean).map((m) => `${(m / 1000).toFixed(1)} s`).join(" / ")}${data.some((x) => x && x.ms < 400) ? ", cached" : ""})` : ""}. Decompiled code is a reconstruction: names of local variables and the exact layout are the decompiler's, so compare logic, not formatting.</p>
    </Split>
  );
}

function ByteTab({ classes, files, labels, initial }) {
  const [showRebuilt, setShowRebuilt] = useState(false);
  const items = showRebuilt ? classes : classes.filter((c) => c.status !== "rebuilt");
  const [cur, setCur] = useState(initial || (items[0] ? items[0].path : null));
  const [models, setModels] = useState(null);
  const [view, setView] = useState("members");
  useEffect(() => {
    if (!cur) return;
    let alive = true;
    setModels(null);
    classPair(files, cur).then((m) => alive && setModels(m)).catch((e) => alive && setModels({ error: String(e.message || e) }));
    return () => { alive = false; };
  }, [cur]); // eslint-disable-line react-hooks/exhaustive-deps
  const nRebuilt = classes.filter((c) => c.status === "rebuilt").length;
  const sections = useMemo(() => {
    if (!models || models.error) return null;
    if (view === "whole") return [{ id: "w", d: diffTexts(models[0] ? classText(models[0]) : null, models[1] ? classText(models[1]) : null) }];
    const md = memberDiff(models[0], models[1]).filter((m) => m.status !== "same");
    return md.map((m) => ({ id: m.key, title: `${m.kind} · ${m.label}`, status: m.status, d: diffTexts(m.a, m.b) }));
  }, [models, view]);
  return (
    <Split items={items} cur={cur} setCur={setCur} label={(x) => className(x.path).split(".").pop()} sub={(x) => `${className(x.path).split(".").slice(0, -1).join(".")} · ${stLabel(x.status, labels)}`}
      empty="No differing classes."
      filters={nRebuilt > 0 && <div className="stchips"><span className={"chip" + (showRebuilt ? " on" : "")} onClick={() => setShowRebuilt((v) => !v)}>{showRebuilt ? "✓ " : ""}show recompiled-only ({nRebuilt})</span></div>}>
      {!cur ? <p className="note">Pick a class.</p> : !models ? <p className="note">Disassembling…</p> : models.error ? <p className="note">Could not read the class: {models.error}</p> : (
        <>
          <div className="ovhead">
            <div className="ovtitle">{className(cur)}</div>
            {models[0] && models[1] && models[0].version !== models[1].version && <span className="tag">class file version {models[0].version} → {models[1].version}</span>}
            <div className="seg">
              <button className={view === "members" ? "on" : ""} onClick={() => setView("members")}>Changed members</button>
              <button className={view === "whole" ? "on" : ""} onClick={() => setView("whole")}>Whole class</button>
            </div>
          </div>
          {sections.length ? <DiffPane key={cur + view} sections={sections} la={labels[0]} lb={labels[1]} pathA={models[0] ? cur : null} pathB={models[1] ? cur : null} />
            : <p className="note">Same code in both — the class files differ only in debug information or class-file version.</p>}
        </>
      )}
    </Split>
  );
}

function ResTab({ resources, files, labels, initial }) {
  const [cur, setCur] = useState(initial || (resources[0] ? resources[0].path : null));
  const [val, setVal] = useState(null);
  useEffect(() => {
    if (!cur) return;
    let alive = true;
    setVal(null);
    resourcePair(files, cur).then((v) => alive && setVal(v)).catch((e) => alive && setVal({ error: String(e.message || e) }));
    return () => { alive = false; };
  }, [cur]); // eslint-disable-line react-hooks/exhaustive-deps
  const binary = val && !val.error && val.some((x) => x && typeof x === "object");
  return (
    <Split items={resources} cur={cur} setCur={setCur} label={(x) => x.path.split("/").pop()} sub={(x) => `${x.path} · ${stLabel(x.status, labels)}${x.build ? " · build info" : ""}`}
      empty="No differing resources.">
      {!cur ? <p className="note">Pick a resource.</p> : !val ? <p className="note">Reading…</p> : val.error ? <p className="note">{val.error}</p>
        : binary ? <p className="note">Binary file — {val.map((x, i) => `${labels[i]}: ${x ? `${x.binary} bytes` : "absent"}`).join(" · ")}.</p>
          : <DiffPane key={cur} sections={[{ id: cur, d: diffTexts(val[0], val[1]) }]} la={labels[0]} lb={labels[1]} pathA={val[0] != null ? cur : null} pathB={val[1] != null ? cur : null} />}
    </Split>
  );
}

// ---------------------------------------------------------------- 3-way retrofit (all three exports loaded)
function JarRetrofit({ retro, names, open }) {
  const [B, C, T] = names;
  const [show, setShow] = useState(new Set(["1", "2", "4", "?"]));
  const [q, setQ] = useState("");
  const counts = {}; for (const r of retro.rows) counts[r.bucket] = (counts[r.bucket] || 0) + 1;
  const ql = q.trim().toLowerCase();
  const rows = retro.rows.filter((r) => show.has(r.bucket) && (!ql || r.key.toLowerCase().includes(ql)))
    .sort((a, b) => "21?43R".indexOf(a.bucket) - "21?43R".indexOf(b.bucket) || a.key.localeCompare(b.key));
  const toggle = (k) => setShow((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  return (
    <div className="retro">
      <h3>Retrofit view · {B} → {C} → {T}</h3>
      <p className="note">Every class and resource {C} changed in its jars (against {B}), and what to do with it in {T}. Compared by code, so recompiled-only classes do not count. {retro.targetOnly} items were changed only by {T}.</p>
      <div className="retrocards">
        {BUCKETS.map(([k, t, d]) => (
          <div key={k} className={"retrocard rb-" + (k === "?" ? "q" : k) + (show.has(k) ? " on" : "")} onClick={() => toggle(k)}>
            <b>{counts[k] || 0}</b><span>{t}</span><em>{d}</em>
          </div>
        ))}
      </div>
      <div className="searchbar">
        <input type="text" placeholder="Search jars or classes…" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="note">{rows.length} shown · click a row to open it ({C} vs {T})</span>
      </div>
      <div className="retrotable">
        <table>
          <thead><tr><th>Bucket</th><th>Library</th><th>Item</th><th>What to do</th></tr></thead>
          <tbody>
            {rows.slice(0, 400).map((r) => (
              <tr key={r.key} className="clickable" style={{ cursor: "pointer" }} onClick={() => open(r)}>
                <td><span className={"rbadge rb-" + (r.bucket === "?" ? "q" : r.bucket)}>{BUCKETS.find((b) => b[0] === r.bucket)[1]}</span></td>
                <td><b>{r.base}</b></td>
                <td className="mono" style={{ wordBreak: "break-all" }}>{r.kind === "class" ? className(r.path) : r.path}</td>
                <td className="tag">{r.note}</td>
              </tr>
            ))}
            {rows.length > 400 && <tr><td colSpan={4} className="note">Showing 400 of {rows.length} — narrow with the search or the bucket cards.</td></tr>}
            {!rows.length && <tr><td colSpan={4} className="note">Nothing in the selected buckets.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
