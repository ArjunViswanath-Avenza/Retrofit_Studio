// TemplateTwin: segment templates across R21 / KBZ / R26 — where each lives (monolith path, the micro app holding
// it and its other copies), which forms / components use it, and the same structure / controller / actions / files
// comparison COMP-are gives components.
import { useState, useMemo, useEffect } from "react";
import { FormTree } from "./Forms";
import { OverallView } from "./Overall";
import { segmentFiles } from "../lib/segments";
import { SegmentVisual } from "./SegmentVisual";
import "./segments.css";

const ASPECT_TABS = [["visual", "Visual"], ["structure", "Structure"], ["controller", "Controller"], ["actions", "Actions"], ["files", "Files (side by side)"]];
const COLS = [["structure", "Structure"], ["controller", "Controller"], ["actions", "Actions"]];
const STATUSES = ["customised", "new", "removed", "absent", "unchanged"];
const statusLabel = (st, labels) => ({
  customised: "Customised", new: `New in ${labels[1]}`, removed: `Removed in ${labels[1]}`,
  absent: `Only in ${labels[2] || "new base"}`, unchanged: "Unchanged",
})[st];
const pct = (x) => `${Math.round(x * 100)}%`;
const formName = (k) => k.split("/").pop().replace(/\.sm$/i, "");
const formModule = (k) => { const s = k.split("/"); return s.slice(1, -1).join("/").replace(/^[^·]*·/, ""); };

export function SegmentsView(props) {
  const { analyzing, drill } = props;
  // parameters left out of "modified" (kept per viewer); every template is recounted without them
  const [excl, setExcl] = useState(() => { try { return new Set(JSON.parse(localStorage.getItem("rs.segExclude") || "[]")); } catch { return new Set(); } });
  useEffect(() => { try { localStorage.setItem("rs.segExclude", JSON.stringify([...excl])); } catch { /* per-viewer convenience only */ } }, [excl]);
  const bulk = useMemo(() => (props.bulk && excl.size ? { results: props.bulk.results.map((r) => adjust(r, excl)) } : props.bulk), [props.bulk, excl]);
  props = { ...props, bulk, raw: props.bulk ? props.bulk.results : [], excl, setExcl };
  if (drill != null && bulk) return <SegmentDetail {...props} r={bulk.results[drill]} />;
  return (
    <div>
      <h2 className="page">TemplateTwin · Segment template retrofit</h2>
      <div className="crumb">Every segment template (templates/&lt;channel&gt;/segments) of {props.labels.join(" · ")} — {props.labels[2] ? `the ${props.labels[2]} templates of every micro app in one list, ` : ""}where each one lives, which forms use it, and its structure, controller and actions compared</div>
      {analyzing && analyzing.running ? (
        <div style={{ maxWidth: 520 }}>
          <p className="note">Reading &amp; comparing segment templates… {analyzing.done}/{analyzing.total}</p>
          <div className="progress"><div style={{ width: (analyzing.total ? (analyzing.done / analyzing.total) * 100 : 0) + "%" }} /></div>
        </div>
      ) : bulk ? <SegDashboard {...props} /> : <p className="note">Preparing…</p>}
    </div>
  );
}

function structText(s) {
  if (!s) return "";
  const parts = [];
  if (s.added) parts.push(<b key="a" className="a">+{s.added}</b>);
  if (s.removed) parts.push(<b key="r" className="r">−{s.removed}</b>);
  if (s.moved) parts.push(<b key="m" style={{ color: "var(--mov-mark)" }}>↔{s.moved}</b>);
  if (s.propWidgets) parts.push(<b key="c" className="c">~{s.propWidgets}</b>);
  return parts.length ? parts.reduce((acc, x, i) => (i ? [...acc, " ", x] : [x]), []) : <span className="tag">—</span>;
}

// "used by" count of distinct forms (and components) for one version
const usedCount = (usage, i, key) => {
  const u = usage && usage[i] && usage[i].get(key);
  if (!u) return 0;
  return new Set(u.filter((e) => e.kind === "form" || e.kind === "component").map((e) => e.kind + e.where)).size;
};

function SegDashboard({ bulk, raw, excl, setExcl, labels, setDrill, report, usage, usageProg }) {
  const [O, C, N] = labels;
  const R = bulk.results;
  const [q, setQ] = useState("");
  const [show, setShow] = useState(new Set(["customised", "new", "removed", "absent"]));
  const [loc, setLoc] = useState(null); // renamed | copies | ambiguous | unused
  const [sort, setSort] = useState(["total", -1]);
  const rowOf = (r) => report && report.get(r.key);

  const agg = useMemo(() => {
    const a = { per: {}, st: {}, total: 0, conflicts: 0, aspects: {}, renamed: 0, copies: 0, ambiguous: 0 };
    for (const l of labels) a.per[l] = 0;
    for (const r of R) {
      for (const l of labels) if (r.present[l]) a.per[l]++;
      a.st[r.status] = (a.st[r.status] || 0) + 1;
      a.total += r.total; a.conflicts += r.conflicts;
      for (const [k] of COLS) a.aspects[k] = (a.aspects[k] || 0) + r.changes[k];
      const x = rowOf(r);
      if (x && x.renamed) a.renamed++;
      if (x && x.alts && x.alts.length) a.copies++;
      if (x && x.status === "ambiguous") a.ambiguous++;
    }
    a.unused = usage ? labels.map((l, i) => R.filter((r) => r.present[l] && !usedCount(usage, i, r.key)).length) : null;
    return a;
  }, [R, labels, report, usage]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const keep = (r) => {
      if (!show.has(r.status)) return false;
      const x = rowOf(r);
      if (loc === "renamed" && !(x && x.renamed)) return false;
      if (loc === "copies" && !(x && x.alts && x.alts.length)) return false;
      if (loc === "ambiguous" && !(x && x.status === "ambiguous")) return false;
      if (loc === "unused" && !(usage && labels.some((l, i) => r.present[l] && !usedCount(usage, i, r.key)))) return false;
      if (!ql) return true;
      const app = x && x.target ? x.target.app + " " + x.target.name : "";
      return (r.key + " " + app + " " + r.copies.map((c) => (c ? c.root || "" : "")).join(" ")).toLowerCase().includes(ql);
    };
    const out = R.map((r, i) => ({ r, i })).filter(({ r }) => keep(r));
    const [k, dir] = sort;
    const val = ({ r }) => (k === "name" ? r.name.toLowerCase() : k === "total" ? r.total : k === "conflicts" ? r.conflicts : k === "used" ? usedCount(usage, 1, r.key) : r.changes[k]);
    out.sort((x, y) => { const a = val(x), b = val(y); return (a < b ? -1 : a > b ? 1 : 0) * dir || x.r.name.localeCompare(y.r.name); });
    return out;
  }, [R, q, show, loc, sort, report, usage]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (st) => setShow((s) => { const n = new Set(s); if (n.has(st)) n.delete(st); else n.add(st); return n; });
  const th = (k, t) => <th key={k} className="sortable" onClick={() => setSort(([sk, d]) => [k, sk === k ? -d : k === "name" ? 1 : -1])}>{t}{sort[0] === k ? (sort[1] < 0 ? " ▼" : " ▲") : ""}</th>;

  const exportCsv = () => {
    const out = [["template", "channel", "status", ...labels.map((l) => `${l} location`), `${N || ""} other copies`, "match", ...labels.map((l) => `used by (${l})`), "structure", "controller", "actions", "conflicts", "total"]];
    for (const r of R) {
      const x = rowOf(r);
      out.push([r.name, r.channel, r.status, ...r.copies.map((c) => (c ? c.path : "")), x && x.alts ? x.alts.map((a) => `${a.app}${a.score != null ? ` (${pct(a.score)})` : ""}`).join("; ") : "", x ? x.method : "",
        ...labels.map((l, i) => (usage ? usedCount(usage, i, r.key) : "")), r.changes.structure, r.changes.controller, r.changes.actions, r.conflicts, r.total]);
    }
    const csv = out.map((row) => row.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv" }));
    a.download = "segment_templates.csv"; a.click();
  };

  return (
    <div>
      <div className="cards">
        {labels.map((l) => <div className="card" key={l}><div className="n">{agg.per[l]}</div><div className="l">{l} templates</div></div>)}
        <div className="card"><div className="n">{agg.st.customised || 0}</div><div className="l">customised ({C}≠{O})</div></div>
        <div className="card"><div className="n" style={{ color: "var(--add-mark)" }}>{agg.st.new || 0}</div><div className="l">new in {C}</div></div>
        <div className="card"><div className="n" style={{ color: "var(--del-mark)" }}>{agg.st.removed || 0}</div><div className="l">removed in {C}</div></div>
        {N && <div className="card"><div className="n">{agg.st.absent || 0}</div><div className="l">only in {N}</div></div>}
        {N && <div className="card"><div className="n">{agg.copies}</div><div className="l">in several micro apps</div></div>}
        <div className="card"><div className="n">{agg.total}</div><div className="l">{C} vs {O} changes</div></div>
        {N && <div className="card"><div className="n" style={{ color: "var(--chg-mark)" }}>{agg.conflicts}</div><div className="l">conflicts (bucket 2)</div></div>}
      </div>
      <div className="note">
        Changes by aspect ({C} vs {O}): {COLS.map(([k, t]) => <span key={k} style={{ marginRight: 12 }}><span className={"aspdot as-" + k} /> {t} <b>{agg.aspects[k]}</b></span>)}
        {usageProg && usageProg.running ? <span className="sg-scan"> · finding where each template is used… {Math.round((usageProg.done / Math.max(1, usageProg.total)) * 100)}%</span>
          : agg.unused ? <span> · not used by any form or component: {labels.map((l, i) => `${l} ${agg.unused[i]}`).join(" · ")}</span> : null}
      </div>
      <div className="searchbar">
        <input type="text" placeholder="Search templates, root flex or micro app…" value={q} onChange={(e) => setQ(e.target.value)} />
        {STATUSES.filter((st) => st !== "absent" || N).map((st) => (
          <span key={st} className={"chip" + (show.has(st) ? " on" : "")} onClick={() => toggle(st)}>{show.has(st) ? "✓ " : ""}{statusLabel(st, labels)} ({agg.st[st] || 0})</span>
        ))}
        <span className="spacer" />
        <button className="btn ghost" onClick={exportCsv}>Export CSV</button>
      </div>
      <ExcludeBar raw={raw} excl={excl} setExcl={setExcl} labels={labels} />
      {N && (
        <div className="sg-locbar">
          <span className="tag">Location:</span>
          {[["copies", `In several micro apps (${agg.copies})`], ["renamed", `Renamed in ${N} (${agg.renamed})`], ["ambiguous", `Unclear best copy (${agg.ambiguous})`], ["unused", "Not used somewhere"]].map(([k, t]) => (
            <span key={k} className={"chip" + (loc === k ? " on" : "")} onClick={() => setLoc((v) => (v === k ? null : k))}>{loc === k ? "✓ " : ""}{t}</span>
          ))}
        </div>
      )}
      <table>
        <thead>
          <tr>
            {th("name", "Template")}
            {labels.map((l) => <th key={l} style={{ textAlign: "center" }}>{l}</th>)}
            <th>Status</th>
            {th("structure", `Structure ${O}→${C}`)}
            {COLS.slice(1).map(([k, t]) => th(k, t))}
            {N && th("conflicts", "Conflicts")}
            {th("total", "Total")}
            {th("used", `Used by (${labels.join(" · ")})`)}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 1500).map(({ r, i }) => {
            const x = rowOf(r);
            return (
              <tr key={r.key} className="clickable" onClick={() => setDrill(i)} style={{ cursor: "pointer" }}>
                <td><b>{r.name}</b><div className="tag">{r.channel}{r.copies.find((c) => c && c.root) ? ` · root ${r.copies.find((c) => c && c.root).root}` : ""}</div></td>
                {labels.map((l, li) => (
                  <td key={l} style={{ textAlign: "center" }}>
                    {r.present[l] ? <span className="a">✓</span> : <span className="tag">—</span>}
                    {li === 2 && r.copies[2] && <div className="sg-app">{r.copies[2].app}{r.copies[2].name !== r.name ? <span className="sg-ren" title="renamed"> as {r.copies[2].name}</span> : null}{x && x.alts && x.alts.length ? <span className="sg-more"> +{x.alts.length}</span> : null}</div>}
                  </td>
                ))}
                <td><span className={"cstat cs-" + r.status}>{statusLabel(r.status, labels)}</span>{r.statusBefore === "customised" && r.status === "unchanged" && <span className="tag" title="its only changes are in excluded parameters"> · only excluded changes</span>}{x && x.status === "ambiguous" && <span className="pill b2" style={{ marginLeft: 4 }} title={x.method}>check copy</span>}</td>
                <td>{structText(r.structure["01"])}</td>
                {COLS.slice(1).map(([k]) => <td key={k} style={{ textAlign: "center" }}>{r.errors[k] ? <span className="pill Removed" title={r.errors[k]}>error</span> : r.changes[k] ? <b>{r.changes[k]}</b> : <span className="tag">—</span>}</td>)}
                {N && <td style={{ textAlign: "center" }}>{r.conflicts ? <span className="pill b2">{r.conflicts}</span> : <span className="tag">—</span>}</td>}
                <td style={{ textAlign: "center" }}><b>{r.total || ""}</b></td>
                <td className="sg-used">{usage ? labels.map((l, li) => (r.present[l] ? <span key={l} className={usedCount(usage, li, r.key) ? "" : "sg-zero"}>{usedCount(usage, li, r.key)}</span> : <span key={l} className="tag">—</span>)).reduce((a, b, k) => (k ? [...a, <i key={"s" + k}> · </i>, b] : [b]), []) : <span className="tag">…</span>}</td>
              </tr>
            );
          })}
          {!rows.length && <tr><td colSpan={20} className="note">No templates match the filters.</td></tr>}
        </tbody>
      </table>
      {rows.length > 1500 && <p className="note">First 1,500 shown — narrow the search to see the rest.</p>}
    </div>
  );
}

function SegmentDetail({ r, picked, labels, setDrill, aspect, setAspect, renderReport, overall, setOverall, report, usage, usageProg, excl }) {
  const [pairIdx, setPairIdx] = useState(0);
  // this template's files only (widget JSONs + controller + actions per version) for the side-by-side view
  const [files, setFiles] = useState(null);
  const [fileScan, setFileScan] = useState({});
  useEffect(() => { let alive = true; setFiles(null); segmentFiles(picked, [r.key]).then((x) => alive && setFiles(x)); return () => { alive = false; }; }, [picked, r.key]);
  const x = report && report.get(r.key);
  const tabs = ASPECT_TABS;
  const cur = tabs.some(([k]) => k === aspect) ? aspect : "structure";
  const model = r.models[cur];
  const count = (k) => (k === "files" || k === "visual" ? null : r.changes[k]);
  const [O, C, N] = labels;
  return (
    <div>
      <button className="btn ghost" onClick={() => setDrill(null)} style={{ marginBottom: 10 }}>← All templates</button>
      {excl && excl.size > 0 && <div className="sx-note">Not counted as a change here: <b>{[...excl].map(keyName).join(", ")}</b> — set with “Exclude parameters” on the template list.</div>}
      <h2 className="page">{r.name} <span className={"cstat cs-" + r.status} style={{ fontSize: 13, verticalAlign: "middle" }}>{statusLabel(r.status, labels)}</span></h2>
      <div className="crumb">Segment template · {r.channel}{r.widgetCounts ? " · " + labels.filter((l) => r.present[l]).map((l) => `${l} ${r.widgetCounts[l]} widgets`).join(" · ") : ""}</div>

      <div className="sg-where">
        <div className="sg-h">Where it lives</div>
        <table className="sg-loc">
          <thead><tr><th>Version</th><th>Template</th><th>Root flex</th><th>Controller</th><th>Used by</th></tr></thead>
          <tbody>
            {labels.map((l, i) => {
              const c = r.copies[i];
              return (
                <tr key={l}>
                  <td><b>{l}</b></td>
                  <td>{c ? <><span className="mono">{c.path}</span>{c.app && <span className="sg-apptag">{c.app}</span>}</> : <span className="tag">not in {l}</span>}</td>
                  <td className="mono">{c ? c.root || <span className="tag">—</span> : ""}</td>
                  <td>{c ? (c.hasCtrl ? <span className="mono" title={c.ctrlPath}>{c.root}Controller{c.hasActions ? " + Actions" : ""}</span> : <span className="r">not found{c.root ? ` (${c.root}Controller)` : ""}</span>) : ""}</td>
                  <td>{c ? (usage ? `${usedCount(usage, i, r.key)} form${usedCount(usage, i, r.key) === 1 ? "" : "s"} / components` : "…") : ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {N && x && (
          <div className="sg-match">
            <div><span className="tag">{N} copy compared:</span> {x.target ? <b>{x.target.app}/{x.target.name}</b> : <span className="r">none found</span>} <span className="tag">· {x.method}</span>
              {x.status === "ambiguous" && <span className="pill b2" style={{ marginLeft: 6 }}>two copies are about as close — check which one you need</span>}</div>
            {x.alts && x.alts.length > 0 && (
              <div className="sg-copies"><span className="tag">Other copies in {N} ({x.alts.length}):</span>{x.alts.map((a) => <span key={a.app + a.name} className="sg-copy">{a.app}{a.name !== (x.target && x.target.name) ? `/${a.name}` : ""}{a.score != null && <b>{pct(a.score)}</b>}</span>)}</div>
            )}
          </div>
        )}
      </div>

      <UsedBy key={"used:" + r.key} r={r} labels={labels} usage={usage} usageProg={usageProg} />

      <div className="aspecttabs">
        {tabs.map(([k, t]) => {
          const n = count(k);
          return (
            <button key={k} className={"aspecttab" + (k === cur ? " on" : "")} onClick={() => setAspect(k)}>
              <span className={"aspdot as-" + k} /> {t}{n != null && <span className={"acount" + (n ? " nz" : "")}>{n}</span>}
              {r.errors[k] && <span className="pill Removed" style={{ marginLeft: 6 }}>error</span>}
            </button>
          );
        })}
      </div>
      <p className="note">Counts are {C} vs {O} changes (the customisation). Each tab also shows how {N || "the new base"} compares.</p>
      {cur === "visual" && <SegmentVisual key={"visual:" + r.key} r={r} picked={picked} labels={labels} usage={usage} excludeKeys={excl} />}
      {cur === "structure" && (r.errors.structure ? <p className="note">Could not read the widget tree: {r.errors.structure}</p> : (
        <FormTree key={r.key} formKey={r.key} picked={picked} labels={labels} pairIdx={pairIdx} setPairIdx={setPairIdx} previewKind="segment" excludeKeys={excl} getMap={(i) => (picked[i] && picked[i].segs ? picked[i].segs.get(r.key) : undefined)} embedded />
      ))}
      {cur === "files" && (files ? <OverallView key={r.key} cat="segs" picked={files} labels={labels} cache={fileScan} setCache={setFileScan} focus={r.key} /> : <p className="note">Collecting this template's files…</p>)}
      {(cur === "controller" || cur === "actions") && (
        r.errors[cur] ? <p className="note">Could not analyse: {r.errors[cur]}</p>
          : !model ? <p className="note">No {cur === "controller" ? `${r.copies.find((c) => c && c.root)?.root || "<rootFlex>"}Controller.js` : "ControllerActions.js"} found for this template in any version.</p>
            : (
              <>
                <p className="note">The template's code lives in controllers/{r.channel}/{r.copies.find((c) => c && c.root)?.root || "<rootFlex>"}Controller/ — named after its root flex, not the template.</p>
                {cur === "actions" && <p className="note">Generated action sequences, matched by name; the label beside each is the event and widget from its <code>/** … defined for … **/</code> comment.</p>}
                {renderReport(model)}
              </>
            )
      )}
    </div>
  );
}

const KIND = { form: "Forms", component: "Components", module: "Presentation / business code", template: "Other templates' controllers" };
function UsedBy({ r, labels, usage, usageProg }) {
  const [vi, setVi] = useState(() => Math.max(0, labels.findIndex((l, i) => r.copies[i])));
  if (!usage) return <div className="sg-where"><div className="sg-h">Used by</div><p className="note">Finding where each template is used… {usageProg ? Math.round((usageProg.done / Math.max(1, usageProg.total)) * 100) + "%" : ""}</p></div>;
  const list = (usage[vi] && usage[vi].get(r.key)) || [];
  const groups = new Map();
  for (const e of list) { const k = `${e.kind}|${e.where}`; if (!groups.has(k)) groups.set(k, { ...e, vias: [] }); groups.get(k).vias.push(`${e.via} · ${e.field}`); }
  const byKind = Object.keys(KIND).map((k) => [k, [...groups.values()].filter((g) => g.kind === k)]).filter(([, g]) => g.length);
  return (
    <div className="sg-where">
      <div className="sg-h">Used by
        <span className="seg" style={{ margin: "0 0 0 10px" }}>{labels.map((l, i) => <button key={l} className={vi === i ? "on" : ""} disabled={!r.copies[i]} onClick={() => setVi(i)}>{l} · {r.copies[i] ? (usage[i] && usage[i].get(r.key) ? new Set(usage[i].get(r.key).map((e) => e.kind + e.where)).size : 0) : "—"}</button>)}</span>
      </div>
      {!r.copies[vi] ? <p className="note">Not in {labels[vi]}.</p> : !byKind.length ? <p className="note">No form, component or code in {labels[vi]} refers to this template's root flex ({r.copies[vi].root || "unknown"}) or kuid — it looks unused there.</p> : (
        byKind.map(([k, gs]) => (
          <div key={k} className="sg-ugroup">
            <div className="tag">{KIND[k]} · {gs.length}</div>
            {gs.map((g) => (
              <div key={g.where} className="sg-urow">
                <b className="mono">{k === "form" ? formName(g.where) : g.where}</b>
                {k === "form" && <span className="tag">{formModule(g.where)}</span>}
                {g.app && <span className="sg-apptag">{g.app}</span>}
                <span className="sg-via">{[...new Set(g.vias)].slice(0, 4).join(" · ")}{g.vias.length > 4 ? ` · +${g.vias.length - 4}` : ""}</span>
                {g.shared && <span className="pill b2" title="another template has the same root flex name">same root flex as another template</span>}
              </div>
            ))}
          </div>
        ))
      )}
      <p className="note sg-foot">A form uses a template through its root flex: <code>rowtemplate</code> / <code>sectionheadertemplate</code> in the segment's JSON, <code>.rowTemplate = "…"</code> in code, a per-row <code>template: "…"</code> in the segment data — or the name is kept in code first (<i>named in code</i>).</p>
    </div>
  );
}

/* ---------------------------------------------------------------- excluding parameters from "modified" */
// one template recounted without the excluded parameters: a widget only counts as modified when something else changed
function adjust(r, excl) {
  if (!r.wkeys) return r;
  const structure = { ...r.structure };
  let hidden = 0;
  for (const [pair, s] of Object.entries(r.structure)) {
    const list = r.wkeys[pair];
    if (!list || !s) continue;
    const pw = list.filter((ks) => ks.some((k) => !excl.has(k))).length;
    if (pair === "01") hidden = s.propWidgets - pw;
    structure[pair] = { ...s, propWidgets: pw };
  }
  const s = structure["01"];
  const st = s ? s.added + s.removed + s.moved + s.propWidgets : 0;
  const changes = { ...r.changes, structure: st };
  const total = st + changes.controller + changes.actions;
  const status = r.status === "customised" || r.status === "unchanged" ? (total ? "customised" : "unchanged") : r.status;
  return { ...r, structure, changes, total, status, hidden, statusBefore: r.status };
}
const FRIENDLY = {
  _skin_: "skin", focusskin: "focus skin", hoverskin: "hover skin", disabledSkins: "disabled skins", pressedskin: "pressed skin", shellCSS: "custom CSS",
  _width_: "width", _height_: "height", _left_: "left", _top_: "top", _right_: "right", _bottom_: "bottom", centerx: "center X", centery: "center Y",
  minwidth: "min width", maxwidth: "max width", minheight: "min height", maxheight: "max height", zindex: "z-index", _padding_: "padding", paddinginpixel: "padding in px",
  _margin_: "margin", contentalignment: "content alignment", layouttype: "layout", autogrowmode: "auto-grow", reverselayoutdirection: "reverse layout",
  _text_: "text", texti18n: "text (i18n key)", tooltip: "tooltip", isvisible: "visible", _src_: "image", accessibilityconfig: "accessibility",
  context: "design context", breakpointInfo: "breakpoints", currentBreakpoint: "current breakpoint", kuid: "widget id (kuid)", containerId: "container id",
  currentLocale: "design locale", snapgridsize: "snap grid", snaptogrid: "snap to grid", iscustomlayout: "custom layout", clipbounds: "clip bounds",
};
const GROUPS = [
  ["Skins & styles", (k) => /skin/i.test(k) || k === "shellCSS"],
  ["Position & size", (k) => /^(_left_|_top_|_right_|_bottom_|_width_|_height_|centerx|centery|min(width|height)|max(width|height)|zindex|_padding_|paddinginpixel|_margin_|contentalignment|layouttype|autogrowmode|reverselayoutdirection)$/.test(k)],
  ["Text", (k) => /^(_text_|texti18n|tooltip|tooltipi18n|_placeholder_|placeholderi18n)$/.test(k)],
  ["Visibility", (k) => k === "isvisible"],
  ["Events", (k) => /^ide_on/.test(k)],
  ["Design-time settings", (k) => /^(context|breakpointInfo|currentBreakpoint|kuid|containerId|currentLocale|snapgridsize|snaptogrid|iscustomlayout)$/.test(k)],
];
const keyName = (k) => (FRIENDLY[k] ? `${FRIENDLY[k]}` : k);

// what excluding a set of parameters would take out of the KBZ-vs-R21 counts
function impact(raw, set) {
  let widgets = 0, templates = 0;
  for (const r of raw) {
    const list = r.wkeys && r.wkeys["01"];
    if (!list) continue;
    const gone = list.filter((ks) => ks.every((k) => set.has(k))).length;
    widgets += gone;
    if (gone && r.status === "customised") { const a = adjust(r, set); if (a.status === "unchanged") templates++; }
  }
  return { widgets, templates };
}

function ExcludeBar({ raw, excl, setExcl, labels }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => new Set(excl));
  const [q, setQ] = useState("");
  useEffect(() => { if (open) setDraft(new Set(excl)); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  // every parameter that changes on some widget: widgets / templates where it changed (KBZ vs R21), and in the other pairs
  const keys = useMemo(() => {
    const m = new Map();
    for (const r of raw) for (const [pair, list] of Object.entries(r.wkeys || {})) {
      const seen = new Set();
      for (const ks of list) for (const k of ks) {
        if (!m.has(k)) m.set(k, { k, cat: (r.keyCat && r.keyCat[k]) || "other", w01: 0, t01: 0, other: 0 });
        const x = m.get(k);
        if (pair === "01") { x.w01++; if (!seen.has(k)) { seen.add(k); x.t01++; } } else x.other++;
      }
    }
    return [...m.values()].sort((a, b) => b.w01 - a.w01 || b.other - a.other || a.k.localeCompare(b.k));
  }, [raw]);
  const ql = q.trim().toLowerCase();
  const shownKeys = keys.filter((x) => !ql || x.k.toLowerCase().includes(ql) || keyName(x.k).toLowerCase().includes(ql));
  const toggle = (k) => setDraft((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const groupKeys = (f) => keys.filter((x) => f(x.k)).map((x) => x.k);
  const toggleGroup = (f) => { const g = groupKeys(f); if (!g.length) return; setDraft((s) => { const n = new Set(s); const all = g.every((k) => n.has(k)); for (const k of g) { if (all) n.delete(k); else n.add(k); } return n; }); };
  const before = useMemo(() => impact(raw, excl), [raw, excl]);
  const would = useMemo(() => impact(raw, draft), [raw, draft]);
  const missing = !raw.some((r) => r.wkeys);
  return (
    <div className="sx">
      <div className="sx-bar">
        <button className={"btn" + (excl.size ? "" : " ghost")} onClick={() => setOpen((v) => !v)}>⊘ Exclude parameters{excl.size ? ` (${excl.size})` : ""}</button>
        {excl.size > 0 ? (
          <>
            <span className="sx-sum">Not counted as a change: {[...excl].map((k) => <span key={k} className="sx-pill">{keyName(k)}<i onClick={() => setExcl((s) => { const n = new Set(s); n.delete(k); return n; })} title="Count it again">✕</i></span>)}</span>
            <span className="tag">{before.widgets} widget{before.widgets === 1 ? "" : "s"} and {before.templates} template{before.templates === 1 ? "" : "s"} no longer count as changed ({labels[1]} vs {labels[0]})</span>
            <button className="btn ghost" onClick={() => setExcl(new Set())}>Clear</button>
          </>
        ) : <span className="tag">Leave out parameters (e.g. skin) — a widget then only counts as modified when something else changed.</span>}
      </div>
      {open && (
        <div className="sx-panel">
          {missing ? <p className="note">These results were read before parameter details were recorded — open the comparison again (New project → Start comparison) to use this filter.</p> : (
            <>
              <div className="sx-groups">
                <span className="tag">Quick picks:</span>
                {GROUPS.map(([name, f]) => { const g = groupKeys(f); if (!g.length) return null; const all = g.every((k) => draft.has(k)); return <span key={name} className={"chip" + (all ? " on" : "")} onClick={() => toggleGroup(f)} title={g.join(", ")}>{all ? "✓ " : ""}{name} ({g.length})</span>; })}
              </div>
              <div className="sx-search"><input type="text" placeholder={`Find among ${keys.length} parameters…`} value={q} onChange={(e) => setQ(e.target.value)} /></div>
              <div className="sx-list">
                {shownKeys.map((x) => (
                  <label key={x.k} className={"sx-row" + (draft.has(x.k) ? " on" : "")}>
                    <input type="checkbox" checked={draft.has(x.k)} onChange={() => toggle(x.k)} />
                    <b>{keyName(x.k)}</b>{FRIENDLY[x.k] && <span className="mono sx-key">{x.k}</span>}
                    <span className="sx-cat">{x.cat}</span>
                    <span className="sx-n">{x.w01 ? `${x.w01} widget${x.w01 === 1 ? "" : "s"} in ${x.t01} template${x.t01 === 1 ? "" : "s"}` : "—"}{x.other ? <em> · {x.other} in the {labels[2] || "other"} comparisons</em> : null}</span>
                  </label>
                ))}
              </div>
              <div className="sx-foot">
                <span className="tag">{draft.size} selected · applying takes {would.widgets} widget{would.widgets === 1 ? "" : "s"} and {would.templates} template{would.templates === 1 ? "" : "s"} out of “changed” ({labels[1]} vs {labels[0]})</span>
                <span className="spacer" />
                <button className="btn ghost" onClick={() => setDraft(new Set())}>Clear selection</button>
                <button className="btn ghost" onClick={() => setOpen(false)}>Cancel</button>
                <button className="btn" onClick={() => { setExcl(new Set(draft)); setOpen(false); }}>Apply</button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
