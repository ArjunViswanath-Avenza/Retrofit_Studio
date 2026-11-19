// CtrlSync with three versions (R21 · KBZ · R26): every controller's retrofit — triage, the R26 controller it is
// compared with, the function-by-function comparison, the form drawn with the widgets each function uses, and KBZ's
// changes moved onto R26's controller file (Move to R26: clean moves, line-by-line merges, conflicts decided by hand
// or edited), one controller at a time or every controller with nothing left to decide at once. Only *Controller.js
// is written; the actions file is left to Visualizer (it regenerates it from studioactions).
import { useState, useMemo, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { TwoCol, ThreeCol } from "./DiffView";
import { MergePane, readSet } from "./SegmentMerge";
import { ctrlRows, ctrlPlan, choicesFor, chosenBody, undecidedOf, ctrlCounts, applyCtrlMerge, ctrlChecks, hasMarkers, widgetsIn, formKeyOfCtrl, ctrlOutPath, FRAMEWORK, CTRL_TRIAGE, ctrlTriageOf, defaultCtrlChoice } from "../lib/ctrlmerge";
import { useMore, MoreRows } from "../app/More";
import "./widgetdialog.css";
import "./segmerge.css";
import "./segments.css";
import "./ctrlretro.css";

const OUT_KEY = "rs.mergeOut"; // the output folder, shared with every Move to R26
const TRI = Object.fromEntries(CTRL_TRIAGE.map(([id, t, sub]) => [id, { t, sub }]));
const STATE = { clean: "clean", merged: "line merge", conflict: "conflict", removal: "removal", already: "already in R26" };
const WIDTHS = [[768, "768"], [1024, "1024"], [1366, "1366"]];
const ctrlName = (k) => k.split("/").pop().replace(/\.js$/i, "");
const readOut = () => { try { return localStorage.getItem(OUT_KEY) || ""; } catch { return ""; } };
const keepOut = (v) => { try { localStorage.setItem(OUT_KEY, v); } catch { /* remembered for this session only */ } };
const filesOf = (picked, key) => picked.map((p) => (p && p.controllers ? p.controllers.get(key) || null : null));
const appOf = (picked, key) => (picked[2] && picked[2].ctrlApp ? picked[2].ctrlApp.get(key) || "" : "");
const markerCount = (t) => ((t || "").match(/^<<<<<<< /gm) || []).length;
// a controller's decisions as kept: only what differs from the default (or was edited by hand)
function toSaved(rows, choices, edits) {
  const out = {};
  for (const r of rows) {
    const c = choices[r.name];
    if (c !== defaultCtrlChoice(r) || edits[r.name] != null) out[r.name] = { choice: c, sig: r.sig, ...(edits[r.name] != null ? { edit: edits[r.name] } : {}) };
  }
  return out;
}
async function writeCtrl(root, path, text) {
  const res = await fetch("/api/output/file", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ root, path, text }) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.error) throw new Error(j.error || `HTTP ${res.status}`);
  return j;
}
// widget ids of the form a controller belongs to, per version (null for a template controller / no form)
function formIds(picked, key, i) {
  const fk = formKeyOfCtrl(key);
  const m = fk && picked[i] && picked[i].forms ? picked[i].forms.get(fk) : null;
  return m ? new Set(m.keys()) : null;
}

// props: picked, labels, bulk (CtrlSync results), analyzing, item / setItem (opened controller key), report (Map key ->
// micro-app map row, or null), renderReport(model) (the function-by-function comparison), decisions ({ key: saved }),
// setDecision(key, saved)
export function CtrlRetroView(props) {
  const { bulk, analyzing, item, labels } = props;
  // what moves, per controller with KBZ changes and an R26 counterpart (diff3 runs here, once per comparison)
  const rowsOf = useMemo(() => {
    const m = new Map();
    if (bulk) for (const r of bulk.results) if (r.model && r.model.hasNew && r.model.genuine.length) { try { m.set(r.path, ctrlRows(r.model)); } catch { /* left without rows */ } }
    return m;
  }, [bulk]);
  const all = { ...props, rowsOf };
  const open = item && bulk ? bulk.results.find((r) => r.path === item) : null;
  if (open) return <CtrlDetail {...all} r={open} />;
  return (
    <div>
      <h2 className="page">CtrlSync · Controller retrofit</h2>
      <div className="crumb">Form and template controllers across {labels.join(" · ")} — function by function, where each lives in {labels[2]}, and {labels[1]}'s changes moved onto {labels[2]}'s controller</div>
      {analyzing && analyzing.running ? (
        <div style={{ maxWidth: 520 }}>
          <p className="note">Formatting &amp; comparing controllers… {analyzing.done}/{analyzing.total}</p>
          <div className="progress"><div style={{ width: (analyzing.total ? (analyzing.done / analyzing.total) * 100 : 0) + "%" }} /></div>
        </div>
      ) : bulk ? <CtrlDashboard {...all} /> : <p className="note">Preparing…</p>}
    </div>
  );
}

/* ================================================================ list */
function CtrlDashboard({ bulk, labels, rowsOf, decisions, setItem, report, picked }) {
  const [O, C, N] = labels;
  const R = bulk.results;
  const [q, setQ] = useState("");
  const [tq, setTq] = useState(null);
  const [onlyChanged, setOnlyChanged] = useState(true);
  const [sort, setSort] = useState(["changes", -1]);
  const [out, setOut] = useState(readOut);
  const [bulkGen, setBulkGen] = useState(null); // { running, done, total } | { written, skipped }
  const where = (r) => (report ? report.get(r.path) : null);
  const info = useMemo(() => new Map(R.map((r) => {
    const rows = rowsOf.get(r.path) || null;
    const saved = decisions[r.path];
    const t = ctrlTriageOf(r, rows, saved, labels, where(r));
    let n = null;
    if (rows) { const { choices, edits } = choicesFor(rows, saved); n = ctrlCounts(rows, choices, edits); }
    return [r.path, { t, n }];
  })), [R, rowsOf, decisions, labels, report]); // eslint-disable-line react-hooks/exhaustive-deps

  const agg = useMemo(() => {
    const a = { per: {}, tri: {}, changed: 0, functions: 0, clean: 0, merged: 0, conflict: 0, undecided: 0, removal: 0 };
    for (const l of labels) a.per[l] = 0;
    for (const r of R) {
      for (const l of labels) if ((r.present || []).includes(l)) a.per[l]++;
      const x = info.get(r.path);
      a.tri[x.t] = (a.tri[x.t] || 0) + 1;
      if (r.model && r.model.genuine.length) { a.changed++; a.functions += r.model.genuine.length; }
      if (x.n) for (const k of ["clean", "merged", "conflict", "undecided", "removal"]) a[k] += x.n[k];
    }
    return a;
  }, [R, info, labels]);

  const rows = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const outRows = R.filter((r) => {
      const x = info.get(r.path);
      if (tq ? x.t !== tq : onlyChanged && !(r.model && r.model.genuine.length) && !["new", "removed"].includes(x.t)) return false;
      if (!tq && x.t === "tablet") return false;
      const w = where(r);
      return !ql || (r.path + " " + (w && w.target ? w.target.app + " " + w.target.key : "")).toLowerCase().includes(ql);
    });
    const [k, dir] = sort;
    const val = (r) => {
      const x = info.get(r.path);
      return k === "name" ? ctrlName(r.path).toLowerCase() : k === "triage" ? CTRL_TRIAGE.findIndex(([id]) => id === x.t) : k === "open" ? (x.n ? x.n.undecided : -1) : r.model ? r.model.genuine.length : -1;
    };
    outRows.sort((a, b) => { const x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : 0) * dir || a.path.localeCompare(b.path); });
    return outRows;
  }, [R, q, tq, onlyChanged, sort, info, report]); // eslint-disable-line react-hooks/exhaustive-deps
  const page = useMore(rows);
  const th = (k, t, title) => <th key={k} className="sortable" title={title} onClick={() => setSort(([sk, d]) => [k, sk === k ? -d : k === "name" ? 1 : -1])}>{t}{sort[0] === k ? (sort[1] < 0 ? " ▼" : " ▲") : ""}</th>;

  // every controller with nothing left to decide, written in one go
  const ready = R.filter((r) => info.get(r.path).t === "quick");
  const runBulk = async () => {
    const root = out.trim();
    keepOut(root);
    setBulkGen({ running: true, done: 0, total: ready.length });
    const written = [], skipped = [];
    for (let n = 0; n < ready.length; n++) {
      const r = ready[n];
      try {
        const files = filesOf(picked, r.path);
        const plan = await ctrlPlan(files, labels);
        const { choices, edits } = choicesFor(plan.rows, decisions[r.path]);
        const res = applyCtrlMerge(plan.srcs[2], plan.srcs[1], plan.rows, choices, edits);
        const hard = res.problems.filter((p) => !p.warn);
        const path = ctrlOutPath(files[2], appOf(picked, r.path));
        if (undecidedOf(plan.rows, choices, edits).length) skipped.push([r.path, "conflicts to decide"]);
        else if (!res.changed) skipped.push([r.path, "nothing is set to move"]);
        else if (hard.length) skipped.push([r.path, hard[0].text]);
        else if (!path) skipped.push([r.path, `no controllers/ folder in ${N}'s path`]);
        else { const j = await writeCtrl(root, path, res.text); written.push([r.path, j.path, res.changed]); }
      } catch (e) { skipped.push([r.path, String(e.message || e)]); }
      setBulkGen((g) => ({ ...g, done: n + 1 }));
    }
    setBulkGen({ written, skipped });
  };

  const exportCsv = () => {
    const outRows = [["controller", "path", "triage", `${N} controller`, "how matched", `functions changed ${O}→${C}`, "move cleanly", "line merges", "conflicts", "conflicts open", "removals"]];
    for (const r of R) {
      const x = info.get(r.path), w = where(r);
      outRows.push([ctrlName(r.path), r.path, TRI[x.t].t, w && w.target ? `${w.target.app}/controllers/${w.target.key}` : "", w ? w.method : "", r.model ? r.model.genuine.length : "",
        x.n ? x.n.clean : "", x.n ? x.n.merged : "", x.n ? x.n.conflict : "", x.n ? x.n.undecided : "", x.n ? x.n.removal : ""]);
    }
    const csv = outRows.map((row) => row.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "controllers_retrofit.csv"; a.click();
  };

  return (
    <div>
      <div className="cards">
        {labels.map((l) => <div className="card" key={l}><div className="n">{agg.per[l]}</div><div className="l">{l} controllers</div></div>)}
        <div className="card"><div className="n">{agg.changed}</div><div className="l">customised ({C}≠{O})</div></div>
        <div className="card"><div className="n">{agg.functions}</div><div className="l">functions changed</div></div>
        <div className="card"><div className="n" style={{ color: "var(--add-mark)" }}>{agg.clean + agg.merged}</div><div className="l">move cleanly ({agg.merged} by line merge)</div></div>
        <div className="card"><div className="n" style={{ color: "var(--chg-mark)" }}>{agg.undecided}</div><div className="l">conflicts to decide (of {agg.conflict})</div></div>
      </div>

      <div className="cp-triage">
        <div className="cp-th">Triage <span className="tag">what each controller needs, judged against the {N} controller compared — click one to list only those</span>
          {tq && <button className="btn ghost tiny" onClick={() => setTq(null)}>show all</button>}</div>
        <div className="cp-tqs">
          {CTRL_TRIAGE.filter(([id]) => agg.tri[id]).map(([id, t, sub]) => (
            <button key={id} className={"cp-tq t-" + id + (tq === id ? " on" : "")} onClick={() => setTq((v) => (v === id ? null : id))} title={sub}>
              <b>{agg.tri[id]}</b><span>{t}</span><i>{sub}</i>
            </button>
          ))}
        </div>
      </div>

      <div className="cr-bulk">
        <b>Generate every “Ready” controller</b>
        <span className="tag">{ready.length} controller{ready.length === 1 ? "" : "s"} with nothing left to decide — each written as {N}'s file with {C}'s changes in (your choices where you made them, else the defaults: clean changes and line merges move, removals don't).</span>
        <div className="mg-out">
          <label>Output folder <input type="text" value={out} onChange={(e) => setOut(e.target.value)} placeholder="e.g. C:\Projects\KBZ\R26-merged — not inside a Visualizer project" /></label>
          <button className="btn" disabled={!ready.length || !out.trim() || (bulkGen && bulkGen.running)} onClick={runBulk}>{bulkGen && bulkGen.running ? `Writing… ${bulkGen.done}/${bulkGen.total}` : `Generate ${ready.length}`}</button>
        </div>
        {bulkGen && !bulkGen.running && (
          <div className="mg-done">
            <div className="ok">✓ {bulkGen.written.length} controller{bulkGen.written.length === 1 ? "" : "s"} written{bulkGen.written[0] ? <> — e.g. <span className="mono">{bulkGen.written[0][1]}</span></> : null}</div>
            {bulkGen.skipped.length > 0 && <details><summary className="err">{bulkGen.skipped.length} skipped</summary>{bulkGen.skipped.map(([k, why]) => <div key={k}><span className="mono">{ctrlName(k)}</span> · {why}</div>)}</details>}
          </div>
        )}
      </div>

      <div className="searchbar">
        <input type="text" placeholder="Search controllers, modules or micro apps…" value={q} onChange={(e) => setQ(e.target.value)} />
        {tq ? <span className="tag">Triage: <b>{TRI[tq].t}</b> ({agg.tri[tq] || 0})</span>
          : <span className={"chip" + (onlyChanged ? " on" : "")} onClick={() => setOnlyChanged((v) => !v)}>{onlyChanged ? "✓ " : ""}only changed</span>}
        <span className="tag">{rows.length} shown</span>
        <span className="spacer" />
        <button className="btn ghost" onClick={exportCsv}>Export CSV</button>
      </div>
      <table>
        <thead>
          <tr>
            {th("name", "Controller")}
            {labels.map((l) => <th key={l} style={{ textAlign: "center" }}>{l}</th>)}
            {th("triage", "Triage")}
            {th("changes", "Functions changed")}
            {th("open", `Move to ${N}`, "functions that move (clean or by line merge) · conflicts still to decide")}
          </tr>
        </thead>
        <tbody>
          {page.shown.map((r) => {
            const x = info.get(r.path), w = where(r), clickable = !!r.model;
            const renamed = w && w.target && ctrlName(w.target.key) !== ctrlName(r.path);
            return (
              <tr key={r.path} className={clickable ? "clickable" : ""} style={{ cursor: clickable ? "pointer" : "default" }} onClick={() => clickable && setItem(r.path)}>
                <td><b style={{ color: clickable ? "var(--accent)" : "inherit" }}>{ctrlName(r.path)}</b><div className="tag cr-path">{r.path}</div></td>
                {labels.map((l, li) => (
                  <td key={l} style={{ textAlign: "center" }}>
                    {(r.present || []).includes(l) ? <span className="a">✓</span> : <span className="tag">—</span>}
                    {li === 2 && w && w.target && <div className="sg-app">{w.target.app}{renamed ? <span className="sg-ren" title={w.target.key}> as {ctrlName(w.target.key)}</span> : null}</div>}
                  </td>
                ))}
                <td><span className={"cp-tri t-" + x.t} title={TRI[x.t].sub}>{TRI[x.t].t}</span>{w && w.status === "ambiguous" && <span className="pill b2" style={{ marginLeft: 4 }} title={w.method}>check</span>}</td>
                <td style={{ textAlign: "center" }}>{r.error ? <span className="pill Removed" title={r.error}>parse error</span> : r.model && r.model.genuine.length ? <b>{r.model.genuine.length}</b> : <span className="tag">—</span>}</td>
                <td className="fr-mg">{x.n ? <><span className="k">{x.n.clean + x.n.merged} move</span>{x.n.merged ? <span className="tag"> ({x.n.merged} merged)</span> : null}{x.n.conflict ? <> · <span className={x.n.undecided ? "o" : ""}>{x.n.undecided ? `${x.n.undecided} to decide` : "all decided"}</span></> : null}</> : <span className="tag">—</span>}</td>
              </tr>
            );
          })}
          <MoreRows {...page} shown={page.shown.length} cols={8} />
          {!rows.length && <tr><td colSpan={8} className="note">No controllers match the filters.</td></tr>}
        </tbody>
      </table>
      <p className="tag" style={{ marginTop: 6 }}>Tablet and watch controllers are left out of the list (the micro apps carry none) — they are counted under “Tablet / watch”. Only *Controller.js files are written; the actions file is regenerated by Visualizer from studioactions.</p>
    </div>
  );
}

/* ================================================================ one controller */
function CtrlDetail({ r, picked, labels, setItem, renderReport, report, rowsOf, decisions, setDecision }) {
  const [O, C, N] = labels;
  const [view, setView] = useState("code");
  const [merging, setMerging] = useState(false);
  const [member, setMember] = useState(null);
  const w = report ? report.get(r.path) : null;
  const rows = rowsOf.get(r.path) || null;
  const t = ctrlTriageOf(r, rows, decisions[r.path], labels, w);
  const n = rows ? (() => { const { choices, edits } = choicesFor(rows, decisions[r.path]); return ctrlCounts(rows, choices, edits); })() : null;
  const canMerge = !!(rows && rows.length && picked[2]);
  return (
    <div>
      <button className="btn ghost" onClick={() => setItem(null)} style={{ marginBottom: 10 }}>← All controllers</button>
      <h2 className="page">{ctrlName(r.path)}<span className="cp-head"><span className={"cp-tri t-" + t} title={TRI[t].sub}>{TRI[t].t}</span>
        {n && <span className="tag">{n.clean} clean · {n.merged} line merge{n.merged === 1 ? "" : "s"} · {n.conflict} conflict{n.conflict === 1 ? "" : "s"}{n.undecided ? ` (${n.undecided} to decide)` : ""} · {n.removal} removal{n.removal === 1 ? "" : "s"}</span>}</span></h2>
      <div className="crumb">{r.path}</div>
      {w && (
        <div className="cr-match">
          <b>{N} controller compared:</b> {w.target ? <span className="mono">{w.target.app} · {w.target.key}</span> : <span className="tag">none</span>}
          {w.method && <span className="tag"> — {w.method}</span>}
          {w.alts && w.alts.length > 0 && <span className="tag"> · other candidates: {w.alts.join(", ")}</span>}
          {w.method && w.method.startsWith("follows its form") && <span className="tag"> · change the {N} form in FormForge and the controller follows it</span>}
        </div>
      )}
      <div className="cr-bar">
        <div className="seg" style={{ margin: 0 }}>
          <button className={view === "code" ? "on" : ""} onClick={() => setView("code")}>Functions</button>
          <button className={view === "form" ? "on" : ""} onClick={() => setView("form")}>Form &amp; widgets</button>
        </div>
        {canMerge && <button className="btn" style={{ marginLeft: "auto" }} onClick={() => setMerging(true)} title={`Choose ${C}'s function changes to carry onto ${N}'s controller and write the merged file`}>⇢ Move {C} changes to {N}</button>}
      </div>
      {view === "code" && r.model && renderReport(r.model)}
      {view === "form" && r.model && <CtrlForm picked={picked} labels={labels} ctrlKey={r.path} model={r.model} member={member} setMember={setMember} />}
      {merging && <CtrlMerge r={r} picked={picked} labels={labels} saved={decisions[r.path]} onSave={(s) => setDecision(r.path, s)} onClose={() => setMerging(false)} />}
    </div>
  );
}

/* ================================================================ the form, with the widgets a function uses */
// members: names to list (default: the changed ones); bodyOf(name, label) overrides a version's text (the Move window
// passes the result as R26's)
function CtrlForm({ picked, labels, ctrlKey, model, member, setMember, members, resultOf, compact }) {
  const [, C, N] = labels;
  const fk = formKeyOfCtrl(ctrlKey);
  const ch = ctrlKey.split("/")[0];
  const kMap = fk && picked[1] && picked[1].forms ? picked[1].forms.get(fk) : null;
  const nMap = fk && picked[2] && picked[2].forms ? picked[2].forms.get(fk) : null;
  const nApp = fk && picked[2] && picked[2].formApp ? picked[2].formApp.get(fk) || "" : "";
  const [W, setW] = useState({});
  const [width, setWidth] = useState(1024);
  const [sel, setSel] = useState(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      const [a, b] = await Promise.all([readSet(kMap), readSet(nMap)]);
      if (alive) setW({ k: kMap ? a.W : null, n: nMap ? b.W : null });
    })();
    return () => { alive = false; };
  }, [kMap, nMap]);
  const kIds = useMemo(() => (kMap ? new Set(kMap.keys()) : null), [kMap]);
  const nIds = useMemo(() => (nMap ? new Set(nMap.keys()) : null), [nMap]);
  const list = members || model.genuine;
  const cur = member && list.includes(member) ? member : list[0];
  const x = cur ? model.members[cur] : null;
  const kBody = x ? x.bodies[C] : null;
  const nBody = x ? (resultOf ? resultOf(cur) : x.bodies[N]) : null;
  const usedK = widgetsIn(kBody, kIds), usedN = widgetsIn(nBody, nIds);
  const missing = usedK.filter((id) => nIds && !nIds.has(id));
  const marksK = useMemo(() => new Map(usedK.map((id) => [id, nIds && !nIds.has(id) ? "add" : "chg"])), [kBody, kIds, nIds]); // eslint-disable-line react-hooks/exhaustive-deps
  const marksN = useMemo(() => new Map(usedN.map((id) => [id, "chg"])), [nBody, nIds]); // eslint-disable-line react-hooks/exhaustive-deps
  // which changed functions name the widget picked on a drawing
  const usersOf = (id) => list.filter((n) => { const m = model.members[n]; return [m.bodies[C], m.bodies[N]].some((b) => widgetsIn(b, new Set([id])).length); });
  if (!kMap && !nMap) return <p className="note">No form drawing: {fk ? `${C} and ${N} have no form ${fk.split("/").pop().replace(/\.sm$/, "")}` : "this is a segment-template controller (its template is drawn in TemplateTwin)"}.</p>;
  return (
    <div className={"cr-form" + (compact ? " compact" : "")}>
      {!compact && (
        <div className="cr-members">
          {list.map((n) => {
            const m = model.members[n];
            const k = widgetsIn(m.bodies[C], kIds), miss = k.filter((id) => nIds && !nIds.has(id)).length;
            return (
              <div key={n} className={"memrow" + (n === cur ? " sel" : "")} onClick={() => setMember(n)}>
                <b>{n}</b> <span className={"pill " + (m.change || "")}>{m.change}</span>
                <div className="tag">{k.length ? `${k.length} widget${k.length === 1 ? "" : "s"}` : "no widgets"}{miss ? <span className="cr-miss"> · {miss} not on {N}'s form</span> : null}</div>
              </div>
            );
          })}
        </div>
      )}
      <div className="cr-draw">
        <div className="cr-drawbar">
          {cur && <span className="tag">Outlined: widgets <b className="mono">{cur}</b> uses — <span className="cr-k">amber</span> on both forms, <span className="cr-a">green</span> only on {C}'s form{resultOf ? ` · ${N} = the result` : ""}</span>}
          <div className="seg" style={{ margin: "0 0 0 auto" }}>{WIDTHS.map(([wd, l]) => <button key={wd} className={width === wd ? "on" : ""} onClick={() => setWidth(wd)}>{l}</button>)}</div>
        </div>
        {cur && (
          <div className="cr-uses">
            <div><i>{C}</i>{usedK.length ? usedK.map((id) => <span key={id} className={"cr-w" + (nIds && !nIds.has(id) ? " miss" : "")} onClick={() => setSel(id)} title={nIds && !nIds.has(id) ? `not on ${N}'s form` : ""}>{id}</span>) : <span className="tag">no widget of the form</span>}</div>
            <div><i>{resultOf ? "Result" : N}</i>{usedN.length ? usedN.map((id) => <span key={id} className="cr-w" onClick={() => setSel(id)}>{id}</span>) : <span className="tag">{nBody == null ? `not in ${N}` : "no widget of the form"}</span>}</div>
            {missing.length > 0 && <div className="cr-miss">⚠ {missing.join(", ")} {missing.length === 1 ? "is" : "are"} on {C}'s form only — move {missing.length === 1 ? "it" : "them"} with FormForge (Move {C} changes to {N}) or the moved code will not find {missing.length === 1 ? "it" : "them"}.</div>}
          </div>
        )}
        {sel && <div className="cr-uses"><div><i>{sel}</i>{usersOf(sel).length ? usersOf(sel).map((n) => <span key={n} className="cr-w fn" onClick={() => setMember(n)}>{n}</span>) : <span className="tag">no changed function names it</span>} <button className="btn ghost tiny" onClick={() => setSel(null)}>clear</button></div></div>}
        <div className="mg-panes">
          {W.k && <MergePane label={`${C} form`} p={picked[1]} app="" ch={ch} W={W.k} width={width} sel={sel} marks={marksK} onPick={setSel} render="form" />}
          {W.n && <MergePane label={`${N} form${nApp ? ` · ${nApp}` : ""}`} p={picked[2]} app={nApp} ch={ch} W={W.n} width={width} sel={sel} marks={marksN} onPick={setSel} render="form" />}
          {!W.k && !W.n && <p className="note">Reading the forms…</p>}
        </div>
      </div>
    </div>
  );
}

/* ================================================================ Move KBZ changes to R26 (one controller) */
function CtrlMerge({ r, picked, labels, saved, onSave, onClose }) {
  const [O, C, N] = labels;
  const files = useMemo(() => filesOf(picked, r.path), [picked, r.path]);
  const app = appOf(picked, r.path);
  const outPath = ctrlOutPath(files[2], app);
  const [plan, setPlan] = useState(null);
  const [err, setErr] = useState(null);
  const [choices, setChoices] = useState({});
  const [edits, setEdits] = useState({});
  const [draft, setDraft] = useState({}); // editor text not yet applied (debounced)
  const [sel, setSel] = useState(null);
  const [tab, setTab] = useState("result");
  const [show, setShow] = useState(new Set(["conflict", "merged", "clean", "removal"]));
  const [q, setQ] = useState("");
  const [out, setOut] = useState(readOut);
  const [gen, setGen] = useState(null);
  const [whole, setWhole] = useState(false);
  const ready = useRef(false);

  useEffect(() => { const k = (e) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  useEffect(() => {
    let alive = true;
    ctrlPlan(files, labels).then((p) => {
      if (!alive) return;
      const s = choicesFor(p.rows, saved);
      setPlan(p); setChoices(s.choices); setEdits(s.edits);
      const firstOpen = p.rows.find((x) => x.state === "conflict") || p.rows[0];
      setSel(firstOpen ? firstOpen.name : null);
      ready.current = true;
    }).catch((e) => alive && setErr(String(e.message || e)));
    return () => { alive = false; };
  }, [files]); // eslint-disable-line react-hooks/exhaustive-deps
  // decisions are kept as they change (per controller, in this browser)
  useEffect(() => { if (ready.current && plan) onSave(toSaved(plan.rows, choices, edits)); }, [choices, edits]); // eslint-disable-line react-hooks/exhaustive-deps
  // the editor applies after a pause in typing
  useEffect(() => {
    const names = Object.keys(draft);
    if (!names.length) return undefined;
    const t = setTimeout(() => { setEdits((e) => ({ ...e, ...draft })); setDraft({}); }, 400);
    return () => clearTimeout(t);
  }, [draft]);

  const rows = plan ? plan.rows : [];
  const byName = useMemo(() => new Map(rows.map((x) => [x.name, x])), [rows]);
  const result = useMemo(() => (plan ? applyCtrlMerge(plan.srcs[2], plan.srcs[1], rows, choices, edits) : null), [plan, rows, choices, edits]);
  const kIds = useMemo(() => formIds(picked, r.path, 1), [picked, r.path]);
  const nIds = useMemo(() => formIds(picked, r.path, 2), [picked, r.path]);
  const checks = useMemo(() => (result ? ctrlChecks(rows, choices, edits, result, { kbzWidgets: kIds, r26Widgets: nIds, framework: FRAMEWORK }) : []), [result, rows, choices, edits, kIds, nIds]);
  const checksOf = useMemo(() => { const m = new Map(); for (const c of checks) { if (!m.has(c.name)) m.set(c.name, []); m.get(c.name).push(c); } return m; }, [checks]);
  const counts = useMemo(() => ctrlCounts(rows, choices, edits), [rows, choices, edits]);
  const errors = checks.filter((c) => c.level === "error");
  const blockers = [];
  if (counts.undecided) blockers.push(`${counts.undecided} conflict${counts.undecided === 1 ? "" : "s"} to decide`);
  if (errors.length) blockers.push(`${errors.length} problem${errors.length === 1 ? "" : "s"} in the result`);
  if (result && !result.changed) blockers.push("nothing is set to move");
  if (!outPath) blockers.push(`no controllers/ folder in ${N}'s path`);
  const canGenerate = plan && !blockers.length && out.trim() && !(gen && gen.running);

  const setChoice = (name, v) => {
    setChoices((s) => ({ ...s, [name]: v }));
    if (v === "edit" && edits[name] == null) { const row = byName.get(name); setEdits((e) => ({ ...e, [name]: chosenBody(row, "edit") })); }
  };
  const setMany = (pred, v) => setChoices((s) => ({ ...s, ...Object.fromEntries(rows.filter(pred).map((x) => [x.name, v])) }));
  const startEdit = (name, from) => { const row = byName.get(name); setDraft((d) => { const n = { ...d }; delete n[name]; return n; }); setEdits((e) => ({ ...e, [name]: from === "merge" ? chosenBody(row, "edit", undefined) : chosenBody(row, from) || "" })); setChoices((s) => ({ ...s, [name]: "edit" })); };

  const generate = async () => {
    setGen({ running: true });
    keepOut(out.trim());
    try { const j = await writeCtrl(out.trim(), outPath, result.text); setGen({ path: j.path, moved: result.changed }); } catch (e) { setGen({ error: String(e.message || e) }); }
  };

  const list = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return rows.filter((x) => show.has(x.state) && (!ql || x.name.toLowerCase().includes(ql)));
  }, [rows, show, q]);
  const toggleShow = (s) => setShow((v) => { const n = new Set(v); if (n.has(s)) n.delete(s); else n.add(s); return n; });
  const row = sel ? byName.get(sel) : null;
  const choice = row ? choices[row.name] : null;
  const editText = row ? (draft[row.name] ?? edits[row.name] ?? "") : "";
  const bodyNow = row ? (choice === "edit" ? editText : chosenBody(row, choice || "r26", edits[row.name])) : null;
  const resultOf = (name) => { const x = byName.get(name); return x ? (choices[name] === "edit" ? draft[name] ?? edits[name] : chosenBody(x, choices[name] || "r26", edits[name])) : null; };

  return createPortal(
    <div className="wd-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="wd mg" role="dialog" aria-label={`Move ${C} changes to ${N}`}>
        <div className="wd-head">
          <div className="wd-title"><span className="wd-k">Move {C} changes to {N}</span><b className="mono">{ctrlName(r.path)}</b>
            <span className="tag">{O} = base · {C} = customisation · {N} = target{app ? ` (${app})` : ""}</span></div>
          <button className="wd-x" onClick={onClose} title="Close (Esc)">✕</button>
        </div>

        <div className="mg-body">
          <div className="mg-left">
            {err ? <p className="note" style={{ padding: 14, color: "var(--del-mark)" }}>Could not read the controllers: {err}</p> : !plan ? <p className="note" style={{ padding: 14 }}>Reading {O}, {C} and {N}…</p> : (
              <>
                <div className="mg-sum">
                  <span className={"mg-st conflict" + (counts.undecided ? " open" : "")}>{counts.conflict} conflicts{counts.undecided ? ` · ${counts.undecided} to decide` : " · all decided"}</span>
                  <span className="mg-st clean">{counts.clean} clean</span>
                  <span className="mg-st cr-merged">{counts.merged} line merges</span>
                  <span className="mg-st removal">{counts.removal} removals</span>
                  {counts.already > 0 && <span className="mg-st already">{counts.already} already in {N}</span>}
                  <span className="tag">{counts.moving} function{counts.moving === 1 ? "" : "s"} will change</span>
                </div>
                <div className="mg-tools">
                  {["conflict", "merged", "clean", "removal", "already"].map((s) => <span key={s} className={"chip" + (show.has(s) ? " on" : "")} onClick={() => toggleShow(s)}>{show.has(s) ? "✓ " : ""}{STATE[s]}</span>)}
                  <input type="text" placeholder="Find function…" value={q} onChange={(e) => setQ(e.target.value)} />
                </div>
                {counts.conflict > 0 && (
                  <div className="mg-bulk">
                    <span className="tag">Every conflict at once:</span>
                    <span className="mg-bk"><button onClick={() => setMany((x) => x.state === "conflict", "r26")}>keep {N}</button><button onClick={() => setMany((x) => x.state === "conflict", "kbz")}>take {C}</button></span>
                    {counts.merged > 0 && <><span className="tag">Line merges:</span><span className="mg-bk"><button onClick={() => setMany((x) => x.state === "merged", "merge")}>merge all</button><button onClick={() => setMany((x) => x.state === "merged", "r26")}>keep {N} for all</button></span></>}
                  </div>
                )}
                <div className="mg-list">
                  {!list.length && <p className="note" style={{ padding: 12 }}>{rows.length ? "No functions under these filters." : `${C} did not change this controller compared with ${O} — nothing to move.`}</p>}
                  {list.map((x) => {
                    const v = choices[x.name];
                    const open = x.state === "conflict" && (!v || (v === "edit" && hasMarkers(edits[x.name])));
                    const cs = checksOf.get(x.name);
                    return (
                      <div key={x.name} className={"mg-row cr-row s-" + x.state + (open ? " undecided" : "") + (sel === x.name ? " sel" : "")} onClick={() => setSel(x.name)}>
                        <span className={"mg-pill " + (x.state === "merged" ? "cr-merged" : x.state)}>{STATE[x.state]}</span>
                        <span className="mg-what"><b className="mono">{x.name}</b>{x.add && <span className="tag"> · not in {N}</span>}{x.note && <span className="tag"> · {x.note}</span>}</span>
                        <span />
                        <span className="mg-ctl" onClick={(e) => e.stopPropagation()}>
                          {x.state === "already" ? <span className="tag">nothing to do</span>
                            : x.state === "clean" ? <label className="mg-tick"><input type="checkbox" checked={v === "kbz" || v === "edit"} onChange={(e) => setChoice(x.name, e.target.checked ? "kbz" : "r26")} /> {x.add ? "add" : "move"}</label>
                              : x.state === "removal" ? <label className="mg-tick"><input type="checkbox" checked={v === "kbz"} onChange={(e) => setChoice(x.name, e.target.checked ? "kbz" : "r26")} /> remove</label>
                                : (
                                  <span className="seg mg-seg">
                                    {x.state === "merged" && <button className={v === "merge" ? "on" : ""} onClick={() => setChoice(x.name, "merge")}>merge</button>}
                                    <button className={v === "r26" ? "on" : ""} onClick={() => setChoice(x.name, "r26")}>{x.add ? "leave out" : `keep ${N}`}</button>
                                    <button className={v === "kbz" ? "on" : ""} onClick={() => setChoice(x.name, "kbz")}>{x.add ? `add ${C}'s` : `take ${C}`}</button>
                                    {!x.deps && <button className={v === "edit" ? "on" : ""} onClick={() => { setChoice(x.name, "edit"); setSel(x.name); setTab("result"); }}>edit</button>}
                                  </span>
                                )}
                        </span>
                        {cs && cs.map((c, i) => <div key={i} className={"mg-sub " + (c.level === "error" ? "err" : "warn")}>{c.level === "error" ? "✕" : "⚠"} {c.text}</div>)}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          <div className="mg-right">
            {row ? (
              <>
                <div className="cr-sel">
                  <b className="mono">{row.name}</b><span className={"mg-pill " + (row.state === "merged" ? "cr-merged" : row.state)}>{STATE[row.state]}</span>
                  <span className="tag">{choice === "kbz" ? (row.state === "removal" ? `removed from ${N}` : `${C}'s version`) : choice === "merge" ? "line-by-line merge" : choice === "edit" ? "edited by you" : choice === "r26" ? (row.add ? "left out" : `${N}'s version (unchanged)`) : "not decided yet"}</span>
                  <div className="seg" style={{ margin: "0 0 0 auto" }}>
                    {[["result", "Result"], ["three", `${O} · ${C} · ${N}`], ["pair", `${C} vs ${N}`], ["form", "Form"]].map(([k, l]) => <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>)}
                  </div>
                </div>
                {tab === "result" && (choice === "edit" ? (
                  <div className="cr-edit">
                    <div className="cr-edbar">
                      <span className="tag">{markerCount(editText) ? <span className="cr-miss">{markerCount(editText)} conflict block{markerCount(editText) === 1 ? "" : "s"} left — keep the lines you want and delete the {"<<<<<<< ||||||| ======= >>>>>>>"} lines</span> : "No conflict markers left."}</span>
                      <span className="tag" style={{ marginLeft: "auto" }}>start again from:</span>
                      {row.merge && <button className="btn ghost tiny" onClick={() => startEdit(row.name, "merge")}>the merge</button>}
                      {row.kbz != null && <button className="btn ghost tiny" onClick={() => startEdit(row.name, "kbz")}>{C}</button>}
                      {row.r26 != null && <button className="btn ghost tiny" onClick={() => startEdit(row.name, "r26")}>{N}</button>}
                    </div>
                    <textarea spellCheck={false} value={editText} onChange={(e) => setDraft((d) => ({ ...d, [row.name]: e.target.value }))} />
                  </div>
                ) : bodyNow == null ? <p className="note">{row.state === "removal" ? `Removed from ${N}'s controller.` : `Left out — ${N} does not get this function.`}</p>
                  : <pre className="cr-code">{bodyNow}</pre>)}
                {tab === "three" && <ThreeCol base={row.base} custom={row.kbz} next={row.r26} lo={O} lc={C} ln={N} />}
                {tab === "pair" && <TwoCol aBody={row.kbz} bBody={choice && choice !== "r26" ? bodyNow : row.r26} la={C} lb={choice && choice !== "r26" ? "Result" : N} />}
                {tab === "form" && plan && <CtrlForm picked={picked} labels={labels} ctrlKey={r.path} model={plan.model} member={row.name} setMember={setSel} members={rows.map((x) => x.name)} resultOf={resultOf} compact />}
              </>
            ) : <p className="note">Pick a function on the left.</p>}
            {whole && result && <pre className="cr-code whole">{result.text}</pre>}
          </div>
        </div>

        <div className="mg-foot">
          {checks.length > 0 && <details className="mg-issues"><summary>{errors.length ? `✕ ${errors.length} problem${errors.length === 1 ? "" : "s"}` : ""}{errors.length && checks.length > errors.length ? " · " : ""}{checks.length > errors.length ? `⚠ ${checks.length - errors.length} warning${checks.length - errors.length === 1 ? "" : "s"}` : ""} in the result</summary>{checks.map((c, k) => <div key={k}><span className="mono">{c.name || "file"}</span> · {c.text}</div>)}</details>}
          <div className="mg-out">
            <label>Output folder <input type="text" value={out} onChange={(e) => setOut(e.target.value)} placeholder="e.g. C:\Projects\KBZ\R26-merged — not inside a Visualizer project" /></label>
            <button className="btn ghost" onClick={() => setWhole((v) => !v)} disabled={!result}>{whole ? "Hide" : "Show"} the whole file</button>
            <button className="btn" disabled={!canGenerate} onClick={generate}>{gen && gen.running ? "Writing…" : "Generate controller"}</button>
            <span className="tag">{blockers.length ? blockers.join(" · ") : !out.trim() ? "Give an output folder." : `Writes <output>/${outPath} — replaced if it is there.`}</span>
          </div>
          {gen && gen.path && <div className="mg-done"><div className="ok">✓ written to <span className="mono">{gen.path}</span> — {gen.moved} function{gen.moved === 1 ? "" : "s"} changed from {N}</div></div>}
          {gen && gen.error && <div className="mg-done"><div className="err">✕ {gen.error}</div></div>}
        </div>
      </div>
    </div>,
    document.body,
  );
}
