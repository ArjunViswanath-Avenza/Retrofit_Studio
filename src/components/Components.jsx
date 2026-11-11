// COMP-are: user widgets (components) across R21 / KBZ / R26 — where each lives (the micro app holding it in R26 and
// its other copies), which forms / templates / components use it, structure (drawn in the Visual tab), controller,
// actions, contract and dependencies compared, and KBZ's widget changes moved onto R26 copies (Move to R26).
import { useState, useMemo, useEffect } from "react";
import { FormTree } from "./Forms";
import { OverallView } from "./Overall";
import { ItemVisual } from "./SegmentVisual";
import { SegmentMerge, componentSource } from "./SegmentMerge";
import { ExcludeBar, adjust, keyName } from "./ExcludeBar";
import { partsOf, componentRefs, triageOf, kindOf, mergeCounts, usesPerCopy, TRIAGE } from "../lib/components";
import { compWidgetIds } from "../lib/microapps";
import { versionIndex } from "../lib/visual";
import { useMore, MoreRows } from "../app/More";
import "./segments.css";

// aspects shown per component; "structure" and "files" have their own views, the rest are member models
const ASPECT_TABS = [
  ["visual", "Visual"],
  ["structure", "Structure"],
  ["controller", "Controller"],
  ["actions", "Actions"],
  ["contract", "Contract (uwProperties)"],
  ["deps", "Dependencies"],
  ["scripts", "Helper scripts"],
  ["files", "Files (side by side)"],
];
const COLS = [["structure", "Structure"], ["controller", "Controller"], ["actions", "Actions"], ["contract", "Contract"], ["deps", "Deps"], ["scripts", "Scripts"]];
const STATUSES = ["customised", "new", "removed", "absent", "unchanged"];

const EXCL_KEY = "rs.compExclude";
const pct = (x) => `${Math.round(x * 100)}%`;
const formName = (k) => k.split("/").pop().replace(/\.sm$/i, "");
const formModule = (k) => { const s = k.split("/"); return s.slice(1, -1).join("/").replace(/^[^·]*·/, ""); };
// distinct forms / templates / components using a component in one version
const usedCount = (usage, i, key) => { const u = usage && usage[i] && usage[i].get(key); return u ? new Set(u.map((e) => e.kind + e.where)).size : 0; };
// how sure the micro-app map is about the R26 copy
const CONF = {
  proven: ["Proven", "the R26 copy's root widget has this component's kuid"],
  likely: ["Likely", "same class name, at least 30% of the widgets shared"],
  weak: ["Weak", "same class name, under 30% of the widgets shared — check it"],
  suggested: ["Suggested", "no kuid or name match; an R26 component shares ≥ 60% of the widgets — link it if it is the same"],
  "set by you": ["Set by you", "linked by hand (Change the R26 copy)"],
  none: ["None", "no R26 copy found"],
};
const TRI = Object.fromEntries(TRIAGE.map(([id, t, sub]) => [id, { t, sub }]));
const confOf = (x) => (x && x.confidence) || null;
function ConfPill({ x }) {
  const c = confOf(x);
  if (!c || !CONF[c]) return null;
  return <span className={"cp-conf c-" + c.replace(/ /g, "")} title={CONF[c][1] + (x.method ? ` · ${x.method}` : "")}>{CONF[c][0]}</span>;
}

export function ComponentsView(props) {
  const { analyzing, drill } = props;
  // parameters left out of "modified" (kept per viewer); every component is recounted without them
  const [excl, setExcl] = useState(() => { try { return new Set(JSON.parse(localStorage.getItem(EXCL_KEY) || "[]")); } catch { return new Set(); } });
  useEffect(() => { try { localStorage.setItem(EXCL_KEY, JSON.stringify([...excl])); } catch { /* per-viewer convenience only */ } }, [excl]);
  const bulk = useMemo(() => (props.bulk && excl.size ? { results: props.bulk.results.map((r) => adjust(r, excl)) } : props.bulk), [props.bulk, excl]);
  const all = { ...props, bulk, raw: props.bulk ? props.bulk.results : [], excl, setExcl };
  if (drill != null && bulk) return <ComponentDetail {...all} r={bulk.results[drill]} />;
  return (
    <div>
      <h2 className="page">COMP-are · User widget retrofit</h2>
      <div className="crumb">Components under userwidgets/ — widget structure, controller, actions, contract (uwProperties) and dependencies across {props.labels.join(" · ")}</div>
      {analyzing && analyzing.running ? (
        <div style={{ maxWidth: 520 }}>
          <p className="note">Reading &amp; comparing components… {analyzing.done}/{analyzing.total}</p>
          <div className="progress"><div style={{ width: (analyzing.total ? (analyzing.done / analyzing.total) * 100 : 0) + "%" }} /></div>
        </div>
      ) : bulk ? (
        <CompDashboard {...all} />
      ) : (
        <p className="note">Preparing…</p>
      )}
    </div>
  );
}

const statusLabel = (st, labels) => ({
  customised: "Customised", new: `New in ${labels[1]}`, removed: `Removed in ${labels[1]}`,
  absent: `Only in ${labels[2] || "new base"}`, unchanged: "Unchanged",
})[st];

function structText(s) {
  if (!s) return "";
  const parts = [];
  if (s.added) parts.push(<b key="a" className="a">+{s.added}</b>);
  if (s.removed) parts.push(<b key="r" className="r">−{s.removed}</b>);
  if (s.moved) parts.push(<b key="m" style={{ color: "var(--mov-mark)" }}>↔{s.moved}</b>);
  if (s.reordered) parts.push(<b key="o" style={{ color: "var(--mov-mark)" }} title="containers whose children changed order">⇅{s.reordered}</b>);
  if (s.propWidgets) parts.push(<b key="c" className="c">~{s.propWidgets}</b>);
  return parts.length ? parts.reduce((acc, x, i) => (i ? [...acc, " ", x] : [x]), []) : <span className="tag">—</span>;
}

function CompDashboard({ bulk, raw, excl, setExcl, labels, setDrill, report, usage }) {
  const [O, C, N] = labels;
  const R = bulk.results;
  const [q, setQ] = useState("");
  const [show, setShow] = useState(new Set(["customised", "new", "removed"]));
  const [sort, setSort] = useState(["total", -1]);
  const [loc, setLoc] = useState(null); // R26 location / usage / confidence filter
  const [tq, setTq] = useState(null); // triage queue picked (replaces the status chips while on)
  const where = (r) => report && report.get(r.key); // the micro-app map's row for this component
  const triage = useMemo(() => new Map(R.map((r) => [r.key, triageOf(r, labels, excl)])), [R, labels, excl]);

  const agg = useMemo(() => {
    const a = { per: {}, st: {}, total: 0, conflicts: 0, aspects: {}, copies: 0, renamed: 0, ambiguous: 0, conf: {}, tri: {} };
    for (const l of labels) a.per[l] = 0;
    for (const r of R) {
      for (const l of labels) if (r.present[l]) a.per[l]++;
      a.st[r.status] = (a.st[r.status] || 0) + 1;
      a.total += r.total; a.conflicts += r.conflicts;
      for (const [k] of COLS) a.aspects[k] = (a.aspects[k] || 0) + r.changes[k];
      const t = triage.get(r.key);
      a.tri[t] = (a.tri[t] || 0) + 1;
      const x = report && report.get(r.key);
      if (x) {
        if (x.copies && x.copies.length > 1) a.copies++; if (x.target && x.target.key !== r.key) a.renamed++; if (x.status === "ambiguous") a.ambiguous++;
        if (x.confidence) a.conf[x.confidence] = (a.conf[x.confidence] || 0) + 1;
      }
    }
    return a;
  }, [R, labels, report, triage]);

  const rows = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const keep = (r) => {
      const x = where(r);
      if (loc === "copies" && !(x && x.copies && x.copies.length > 1)) return false;
      if (loc === "renamed" && !(x && x.target && x.target.key !== r.key)) return false;
      if (loc === "ambiguous" && !(x && x.status === "ambiguous")) return false;
      if (loc === "unused" && !(usage && labels.some((l, i) => r.present[l] && !usedCount(usage, i, r.key)))) return false;
      if (loc && loc.startsWith("conf:") && confOf(x) !== loc.slice(5)) return false;
      return !ql || (r.key + " " + (x && x.target ? x.target.app + " " + x.target.key : "")).toLowerCase().includes(ql);
    };
    const out = R.map((r, i) => ({ r, i })).filter(({ r }) => (tq ? triage.get(r.key) === tq : show.has(r.status)) && keep(r));
    const [k, dir] = sort;
    const val = ({ r }) => (k === "name" ? r.name.toLowerCase() : k === "total" ? r.total : k === "conflicts" ? r.conflicts : k === "used" ? usedCount(usage, 1, r.key) : k === "triage" ? TRIAGE.findIndex(([id]) => id === triage.get(r.key)) : r.changes[k]);
    out.sort((x, y) => { const a = val(x), b = val(y); return (a < b ? -1 : a > b ? 1 : 0) * dir || x.r.name.localeCompare(y.r.name); });
    return out;
  }, [R, q, show, sort, loc, report, usage, tq, triage]); // eslint-disable-line react-hooks/exhaustive-deps
  const page = useMore(rows);

  const top = useMemo(() => [...R].filter((r) => r.total > 0).sort((a, b) => b.total - a.total).slice(0, 12), [R]);
  const max = top.length ? top[0].total : 1;
  const toggle = (st) => setShow((s) => { const n = new Set(s); if (n.has(st)) n.delete(st); else n.add(st); return n; });
  const th = (k, t) => (
    <th key={k} className="sortable" onClick={() => setSort(([sk, d]) => [k, sk === k ? -d : k === "name" ? 1 : -1])}>
      {t}{sort[0] === k ? (sort[1] < 0 ? " ▼" : " ▲") : ""}
    </th>
  );

  const exportCsv = () => {
    const out = [["component", "status", "aspect", "item", "change", "bucket", `in_${N || "new"}`, "note", `${N || "new"}_location`, ...labels.map((l) => `used by (${l})`), "triage", "kind of customisation", `${N || "new"} link`, "how matched"]];
    const tail = (r) => { const x = where(r); return [x && x.target ? `${x.target.app}/userwidgets/${x.target.key}` : "", ...labels.map((l, i) => (usage ? usedCount(usage, i, r.key) : "")), TRI[triage.get(r.key)].t, kindOf(r, excl) || "", x && x.confidence ? CONF[x.confidence][0] : "", x ? x.method : ""]; };
    for (const r of R) {
      const s = r.structure["01"];
      if (!r.total) out.push([r.key, r.status, "", "", "", "", "", "", ...tail(r)]); // one line per component at least
      if (s && (s.added || s.removed || s.moved || s.propWidgets))
        out.push([r.key, r.status, "structure", `${O}→${C} widgets`, `+${s.added} -${s.removed} moved ${s.moved} props ${s.propWidgets} reordered ${s.reordered || 0}`, "", "", "", ...tail(r)]);
      for (const [k] of COLS) {
        const m = r.models[k];
        if (!m) continue;
        for (const n of m.genuine) {
          const x = m.members[n];
          out.push([r.key, r.status, k, m.hints && m.hints[n] ? `${n} (${m.hints[n]})` : n, x.change, x.bucket, x.inNew || "", x.note, ...tail(r)]);
        }
      }
    }
    const csv = out.map((row) => row.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "components_changes.csv"; a.click();
  };

  return (
    <div>
      <div className="cards">
        {labels.map((l) => <div className="card" key={l}><div className="n">{agg.per[l]}</div><div className="l">{l} components</div></div>)}
        <div className="card"><div className="n">{agg.st.customised || 0}</div><div className="l">customised ({C}≠{O})</div></div>
        <div className="card"><div className="n" style={{ color: "var(--add-mark)" }}>{agg.st.new || 0}</div><div className="l">new in {C}</div></div>
        <div className="card"><div className="n" style={{ color: "var(--del-mark)" }}>{agg.st.removed || 0}</div><div className="l">removed in {C}</div></div>
        {N && <div className="card"><div className="n">{agg.st.absent || 0}</div><div className="l">only in {N}</div></div>}
        <div className="card"><div className="n">{agg.total}</div><div className="l">{C} vs {O} changes</div></div>
        {N && <div className="card"><div className="n" style={{ color: "var(--chg-mark)" }}>{agg.conflicts}</div><div className="l">conflicts (bucket 2)</div></div>}
      </div>
      <div className="note">
        Changes by aspect ({C} vs {O}): {COLS.map(([k, t]) => <span key={k} style={{ marginRight: 12 }}><span className={"aspdot as-" + k} /> {t} <b>{agg.aspects[k]}</b></span>)}
      </div>

      {top.length > 0 && (
        <div className="chart">
          {top.map((r) => (
            <div className="row" key={r.key}>
              <span className="cname" title={r.key} onClick={() => setDrill(R.indexOf(r))}>{r.name}</span>
              <span className="stackbar" style={{ width: Math.max(4, (r.total / max) * 100) + "%" }}>
                {COLS.map(([k]) => r.changes[k] > 0 && <i key={k} className={"as-" + k} style={{ width: (r.changes[k] / r.total) * 100 + "%" }} title={`${k}: ${r.changes[k]}`} />)}
              </span>
              <span>{r.total}</span>
            </div>
          ))}
        </div>
      )}

      <div className="cp-triage">
        <div className="cp-th">Triage <span className="tag">what each component needs{N ? `, judged against the ${N} copy compared` : ""} — click one to list only those</span>
          {tq && <button className="btn ghost tiny" onClick={() => setTq(null)}>show all</button>}</div>
        <div className="cp-tqs">
          {TRIAGE.filter(([id]) => agg.tri[id]).map(([id, t, sub]) => (
            <button key={id} className={"cp-tq t-" + id + (tq === id ? " on" : "")} onClick={() => setTq((v) => (v === id ? null : id))} title={sub}>
              <b>{agg.tri[id]}</b><span>{t}</span><i>{sub}</i>
            </button>
          ))}
        </div>
      </div>

      <ExcludeBar raw={raw} excl={excl} setExcl={setExcl} labels={labels} noun="component" />
      <div className="searchbar">
        <input type="text" placeholder="Search components…" value={q} onChange={(e) => setQ(e.target.value)} />
        {tq ? <span className="tag">Triage: <b>{TRI[tq].t}</b> ({agg.tri[tq] || 0}) — the status chips are off while a triage group is picked</span> : STATUSES.filter((st) => st !== "absent" || N).map((st) => (
          <span key={st} className={"chip" + (show.has(st) ? " on" : "")} onClick={() => toggle(st)}>
            {show.has(st) ? "✓ " : ""}{statusLabel(st, labels)} ({agg.st[st] || 0})
          </span>
        ))}
        <span className="spacer" />
        <button className="btn ghost" onClick={exportCsv}>Export CSV</button>
      </div>
      {N && (
        <div className="sg-locbar">
          <span className="tag">Location:</span>
          {[["copies", `In several micro apps (${agg.copies})`], ["renamed", `Other name in ${N} (${agg.renamed})`], ["ambiguous", `Unclear best copy (${agg.ambiguous})`], ["unused", "Not used somewhere"]].map(([k, t]) => (
            <span key={k} className={"chip" + (loc === k ? " on" : "")} onClick={() => setLoc((v) => (v === k ? null : k))}>{loc === k ? "✓ " : ""}{t}</span>
          ))}
          {!usage && <span className="tag">· finding where each component is used…</span>}
        </div>
      )}
      {N && report && (
        <div className="sg-locbar">
          <span className="tag">{N} link:</span>
          {Object.keys(CONF).filter((c) => agg.conf[c]).map((c) => (
            <span key={c} className={"chip" + (loc === "conf:" + c ? " on" : "")} title={CONF[c][1]} onClick={() => setLoc((v) => (v === "conf:" + c ? null : "conf:" + c))}>{loc === "conf:" + c ? "✓ " : ""}{CONF[c][0]} ({agg.conf[c]})</span>
          ))}
        </div>
      )}

      <table>
        <thead>
          <tr>
            {th("name", "Component")}
            {labels.map((l) => <th key={l} style={{ textAlign: "center" }}>{l}</th>)}
            <th>Status</th>
            {th("triage", "Triage")}
            {th("structure", `Structure ${O}→${C}`)}
            {COLS.slice(1).map(([k, t]) => th(k, t))}
            {N && th("conflicts", "Conflicts")}
            {th("total", "Total")}
            {th("used", `Used by (${labels.join(" · ")})`)}
          </tr>
        </thead>
        <tbody>
          {page.shown.map(({ r, i }) => (
            <tr key={r.key} className="clickable" onClick={() => setDrill(i)} style={{ cursor: "pointer" }}>
              <td><b>{r.name}</b><div className="tag">{r.namespace}</div></td>
              {labels.map((l, li) => {
                const x = li === 2 ? where(r) : null;
                return (
                  <td key={l} style={{ textAlign: "center" }}>
                    {r.present[l] ? <span className="a">✓</span> : <span className="tag">—</span>}
                    {x && x.target && <div className="sg-app">{x.target.app}{x.target.key !== r.key ? <span className="sg-ren" title={x.target.key}> as {x.target.key.split(".").pop()}</span> : null}{x.copies && x.copies.length > 1 ? <span className="sg-more"> +{x.copies.length - 1}</span> : null}</div>}
                    {x && (x.target || x.confidence === "suggested") && <div><ConfPill x={x} /></div>}
                  </td>
                );
              })}
              <td><span className={"cstat cs-" + r.status}>{statusLabel(r.status, labels)}</span>{r.statusBefore === "customised" && r.status === "unchanged" && <span className="tag" title="its only changes are in excluded parameters"> · only excluded changes</span>}{where(r) && where(r).status === "ambiguous" && <span className="pill b2" style={{ marginLeft: 4 }} title={where(r).method}>check copy</span>}</td>
              <td><span className={"cp-tri t-" + triage.get(r.key)} title={TRI[triage.get(r.key)].sub}>{TRI[triage.get(r.key)].t}</span>{kindOf(r, excl) && <div className="tag">{kindOf(r, excl)}</div>}</td>
              <td>{structText(r.structure["01"])}</td>
              {COLS.slice(1).map(([k]) => (
                <td key={k} style={{ textAlign: "center" }}>
                  {r.errors[k] ? <span className="pill Removed" title={r.errors[k]}>error</span> : r.changes[k] ? <b>{r.changes[k]}</b> : <span className="tag">—</span>}
                </td>
              ))}
              {N && <td style={{ textAlign: "center" }}>{r.conflicts ? <span className="pill b2">{r.conflicts}</span> : <span className="tag">—</span>}</td>}
              <td style={{ textAlign: "center" }}><b>{r.total || ""}</b></td>
              <td className="sg-used">{usage ? labels.map((l, li) => (r.present[l] ? <span key={l} className={usedCount(usage, li, r.key) ? "" : "sg-zero"}>{usedCount(usage, li, r.key)}</span> : <span key={l} className="tag">—</span>)).reduce((a, b, k) => (k ? [...a, <i key={"s" + k}> · </i>, b] : [b]), []) : <span className="tag">…</span>}</td>
            </tr>
          ))}
          <MoreRows {...page} shown={page.shown.length} cols={20} />
          {!rows.length && <tr><td colSpan={20} className="note">No components match the filters.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function ComponentDetail({ r, picked, labels, setDrill, aspect, setAspect, renderReport, overall, setOverall, report, usage, usageProg, excl, relink }) {
  const [O, C, N] = labels;
  const [pairIdx, setPairIdx] = useState(0);
  const [merging, setMerging] = useState(false);
  const [picking, setPicking] = useState(false);
  const smMaps = useMemo(() => picked.map((p) => {
    const parts = p && p.comps ? partsOf(r.key, p.comps.get(r.key)) : null;
    return parts ? parts.structure : undefined;
  }), [picked, r.key]);
  const x = report && report.get(r.key); // where the micro-app map put it in R26
  // where each version keeps it: a monolith under userwidgets/, R26 in the micro app the map chose (maybe renamed)
  const appOf = (i) => (picked[i] && picked[i].compApp ? picked[i].compApp.get(r.key) || "" : "");
  const pathOf = (i) => (i === 2 && x && x.target ? `${x.target.app}/userwidgets/${x.target.key}` : `${appOf(i) ? appOf(i) + "/" : ""}userwidgets/${r.key}`);
  // the Visual tab draws the component from each version's own files and skins
  const adapter = useMemo(() => ({
    noun: "component",
    copyOf: (i) => (r.present[labels[i]] ? { app: appOf(i), name: i === 2 && x && x.target ? x.target.key : r.key } : null),
    filesOf: (i) => smMaps[i],
    indexOf: (i) => versionIndex(picked[i], appOf(i), "desktop"),
    refs: (i, id, uses) => componentRefs(picked[i], r.key, id, uses),
    usesOf: (i) => (usage && usage[i] ? usage[i].get(r.key) : null),
    usageReady: !!usage,
  }), [r, picked, labels, smMaps, usage, x]); // eslint-disable-line react-hooks/exhaustive-deps
  // R26 uses of each copy (a form uses the copy in its own micro app, else the shared one)
  const perCopy = useMemo(() => (usage && usage[2] && x && x.copies && x.copies.length ? usesPerCopy(usage[2].get(r.key), x.copies) : null), [usage, x, r.key]);
  const mergeSource = useMemo(() => (N && picked[2] ? componentSource(r, picked, x, perCopy) : null), [N, r, picked, x, perCopy]);
  const linkTag = x && x.target ? `${x.target.app}/${x.target.key}` : "";
  const doRelink = (link) => { setPicking(false); relink(r.key, link); };
  const canMerge = !!(mergeSource && r.present[O] && r.present[C] && mergeSource.baseFiles && mergeSource.kbzFiles && mergeSource.copies.length);

  const count = (k) => (k === "structure" ? r.changes.structure : k === "files" || k === "visual" ? null : r.changes[k]);
  const tabs = ASPECT_TABS.filter(([k]) => k !== "scripts" || r.models.scripts);
  const cur = tabs.some(([k]) => k === aspect) ? aspect : "structure";
  const model = r.models[cur];

  const emptyCtrl = cur === "controller" && model && labels.filter((l) => r.present[l] && model.counts[l] === 0);

  return (
    <div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
        <button className="btn ghost" onClick={() => setDrill(null)}>← All components</button>
        {canMerge && <button className="btn" style={{ marginLeft: "auto" }} onClick={() => setMerging(true)} title={`Choose ${C}'s widget changes to carry onto the ${N} copies and write the merged userwidgetmodel.sm folder`}>⇢ Move {C} changes to {N}</button>}
      </div>
      {merging && <SegmentMerge source={mergeSource} picked={picked} labels={labels} onClose={() => setMerging(false)} />}
      {excl && excl.size > 0 && <div className="sx-note">Not counted as a change here: <b>{[...excl].map(keyName).join(", ")}</b> — set with “Exclude parameters” on the component list.</div>}
      <h2 className="page">
        {r.name} <span className={"cstat cs-" + r.status} style={{ fontSize: 13, verticalAlign: "middle" }}>{statusLabel(r.status, labels)}</span>
        {(() => { const t = triageOf(r, labels, excl), k = kindOf(r, excl), m = mergeCounts(r, excl); return (
          <span className="cp-head">
            <span className={"cp-tri t-" + t} title={TRI[t].sub}>{TRI[t].t}</span>
            {k && <span className="tag">{k}</span>}
            {r.merge && <span className="tag" title={`rows the Move to ${N} popup starts with, against the copy compared`}>· {m.clean} clean · {m.conflict} conflicts · {m.removal} removals · {m.already} already in {N}{m.design ? ` · ${m.design} design-time kept as ${N}` : ""}</span>}
          </span>
        ); })()}
      </h2>
      <div className="crumb">
        userwidgets/{r.key} · {labels.map((l) => (
          <span key={l} style={{ marginRight: 10 }}>{l}: {r.present[l] ? <b className="a">present</b> : <b className="r">absent</b>}{r.widgetCounts && r.present[l] ? ` (${r.widgetCounts[l]} widgets)` : ""}</span>
        ))}
      </div>

      <div className="sg-where">
        <div className="sg-h">Where it lives</div>
        <table className="sg-loc">
          <thead><tr><th>Version</th><th>Component folder</th><th>Widgets</th><th>Used by</th></tr></thead>
          <tbody>
            {labels.map((l, i) => (
              <tr key={l}>
                <td><b>{l}</b></td>
                <td>{r.present[l] ? <><span className="mono">{pathOf(i)}</span>{(i === 2 && x && x.target ? x.target.app : appOf(i)) && <span className="sg-apptag">{i === 2 && x && x.target ? x.target.app : appOf(i)}</span>}</> : <span className="tag">not in {l}</span>}</td>
                <td>{r.present[l] && r.widgetCounts ? r.widgetCounts[l] : ""}</td>
                <td>{r.present[l] ? (usage ? `${usedCount(usage, i, r.key)} form${usedCount(usage, i, r.key) === 1 ? "" : "s"} / templates / components` : "…") : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {N && x && (
          <div className="sg-match">
            <div><span className="tag">{N} copy compared:</span> {x.target ? <b>{x.target.app}/{x.target.key}</b> : <span className="r">none</span>} <ConfPill x={x} /> <span className="tag">· {x.method}</span>
              {x.status === "ambiguous" && <span className="pill b2" style={{ marginLeft: 6 }}>two copies are about as close — check which one you need</span>}
              {relink && <span className="cp-linkbtns">
                <button className="btn ghost tiny" onClick={() => setPicking((v) => !v)}>{picking ? "Close" : `Change the ${N} copy…`}</button>
                {x.manual && <button className="btn ghost tiny" onClick={() => doRelink(null)} title={`automatic: ${x.auto && x.auto.method}`}>Back to automatic</button>}
              </span>}
            </div>
            {x.linkMissing && <p className="note">Your link to {x.linkMissing.app}/{x.linkMissing.key} was not found in this {N} folder — the automatic match is shown.</p>}
            {!x.target && x.suggestions && x.suggestions.length > 0 && (
              <div className="cp-sugg"><span className="tag">Suggested (shares widgets, no kuid or name match — nothing is compared until you link one):</span>
                {x.suggestions.map((c) => <span key={c.app + c.key} className="sg-copy">{c.name} <span className="tag">{c.app}</span><b>{pct(c.score)}</b>{relink && <button className="btn ghost tiny" onClick={() => doRelink({ app: c.app, key: c.key })}>Link</button>}</span>)}
              </div>
            )}
            {x.copies && x.copies.length > 0 && (
              <CopyList x={x} perCopy={perCopy} N={N} usageReady={!!usage} onCompare={relink ? (c) => doRelink({ app: c.app, key: c.key }) : null} />
            )}
            {picking && <LinkPicker r={r} x={x} picked={picked} N={N} onPick={doRelink} />}
          </div>
        )}
      </div>

      <CompUsedBy key={"used:" + r.key + linkTag} r={r} labels={labels} usage={usage} usageProg={usageProg} />

      <div className="aspecttabs">
        {tabs.map(([k, t]) => {
          const n = count(k);
          return (
            <button key={k} className={"aspecttab" + (k === cur ? " on" : "")} onClick={() => setAspect(k)}>
              <span className={"aspdot as-" + k} /> {t}
              {n != null && <span className={"acount" + (n ? " nz" : "")}>{n}</span>}
              {r.errors[k] && <span className="pill Removed" style={{ marginLeft: 6 }}>error</span>}
            </button>
          );
        })}
      </div>
      <p className="note">Counts are {C} vs {O} changes (the customisation). Each tab also shows how {N || "the new base"} compares.</p>

      {cur === "visual" && <ItemVisual key={"visual:" + r.key + linkTag} adapter={adapter} r={r} labels={labels} excludeKeys={excl} />}

      {cur === "structure" && (
        r.errors.structure ? <p className="note">Could not read the widget tree: {r.errors.structure}</p> : (
          <FormTree key={r.key + linkTag} formKey={r.key} picked={picked} labels={labels} pairIdx={pairIdx} setPairIdx={setPairIdx} previewKind="component" excludeKeys={excl}
            getMap={(i) => smMaps[i]} embedded />
        )
      )}

      {cur === "files" && <OverallView key={r.key} cat="comps" picked={picked} labels={labels} cache={overall} setCache={setOverall} focus={r.key} />}

      {cur !== "structure" && cur !== "files" && cur !== "visual" && (
        r.errors[cur] ? <p className="note">Could not analyse: {r.errors[cur]}</p>
          : !model ? <p className="note">No {cur === "deps" ? "uwDependencies.json" : cur === "contract" ? "uwProperties.json" : cur} file in any version.</p>
            : (
              <>
                {emptyCtrl && emptyCtrl.length > 0 && (
                  <p className="note">Empty controller (<code>return {"{}"}</code>, no members) in {emptyCtrl.join(", ")}.</p>
                )}
                {cur === "contract" && <p className="note">Entries are matched by section + propertyKey; the tool-generated <code>kuid</code> / <code>srcWgtKUID</code> ids are ignored when deciding whether an entry changed.</p>}
                {cur === "actions" && <p className="note">Generated action sequences, matched by name; the label beside each is the event and widget from its <code>/** … defined for … **/</code> comment.</p>}
                {cur === "actions" && model.fromJson && Object.keys(model.fromJson).length > 0 && (
                  <p className="note">
                    Read from <code>studioactions/…/AS_*.json</code> (an event names the action, the Actions file does not have it{model.noFile && model.noFile.length ? ` — no ControllerActions.js in ${model.noFile.join(", ")}` : ""}): {Object.entries(model.fromJson).map(([l, list]) => `${l} ${list.length}`).join(" · ")}.
                    Rendered the way Visualizer generates the file: a code snippet as written, a controller function call as <code>return self.fn.call(this);</code>.
                    {model.approx && model.approx.length > 0 && <> <b>Approximate</b> (other step types or nested steps, not rendered): {model.approx.join(", ")}.</>}
                  </p>
                )}
                {renderReport(model)}
              </>
            )
      )}
    </div>
  );
}

// every R26 copy of the component: widget overlap, where R26 forms use it, and a way to compare another one
function CopyList({ x, perCopy, N, usageReady, onCompare }) {
  const uses = (c) => (perCopy ? perCopy.get(`${c.app}/${c.key}`) || 0 : null);
  const best = perCopy ? x.copies.reduce((b, c) => (uses(c) > uses(b) ? c : b), x.copies[0]) : null;
  const hint = best && best !== x.copies[0] && uses(best) > uses(x.copies[0]);
  return (
    <div className="cp-copies">
      <table className="sg-loc">
        <thead><tr><th>{N} copy</th><th>Widgets shared</th><th>Placed by {N} forms · templates · components</th><th /></tr></thead>
        <tbody>
          {x.copies.map((c, i) => (
            <tr key={c.app + c.key} className={i === 0 ? "cp-cur" : ""}>
              <td><span className="sg-apptag">{c.app}</span> <span className="mono">{c.key}</span>{c.kuid && x.kuid && c.kuid === x.kuid && <span className="tag" title="its root widget has this component's kuid"> · same kuid</span>}</td>
              <td>{c.score != null ? pct(c.score) : ""}</td>
              <td>{!usageReady ? "…" : uses(c) ? <b>{uses(c)}</b> : <span className="sg-zero">placed nowhere</span>}</td>
              <td>{i === 0 ? <span className="mg-best">compared</span> : onCompare && <button className="btn ghost tiny" onClick={() => onCompare(c)}>Compare this one</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {hint && <p className="note">⚠ {N} forms place <b>{best.app}</b>'s copy more ({uses(best)} vs {uses(x.copies[0])}) — the copy compared was chosen by widget overlap.{onCompare && <> <button className="btn ghost tiny" onClick={() => onCompare(best)}>Compare {best.app}'s copy</button></>}</p>}
      {perCopy && perCopy.unresolved > 0 && <p className="note">{perCopy.unresolved} use{perCopy.unresolved === 1 ? "" : "s"} in micro apps with no copy of their own and no shared copy — not counted against a copy.</p>}
      <p className="note sg-foot">A form is counted for the copy in its own micro app, else for the copy in a shared micro app (Resources / Commons) — the copy a micro-app build can reach. This is how the tool reads it; Visualizer itself only names the root widget's kuid.</p>
    </div>
  );
}

// pick the R26 counterpart by hand: every R26 component of the channel, closest widget overlap first
function LinkPicker({ r, x, picked, N, onPick }) {
  const [q, setQ] = useState("");
  const catalog = useMemo(() => (picked[2] && picked[2].compCatalog) || [], [picked]);
  const mine = useMemo(() => compWidgetIds((picked[1] && picked[1].comps.get(r.key)) || (picked[0] && picked[0].comps.get(r.key))), [picked, r.key]);
  const scored = useMemo(() => catalog.map((c) => {
    let i = 0;
    for (const id of mine) if (c.ids.has(id)) i++;
    const u = mine.size + c.ids.size - i;
    return { c, score: u ? i / u : 0 };
  }).sort((a, b) => b.score - a.score || a.c.name.localeCompare(b.c.name)), [catalog, mine]);
  const ql = q.trim().toLowerCase();
  const shown = (ql ? scored.filter(({ c }) => (c.app + " " + c.key).toLowerCase().includes(ql)) : scored).slice(0, 40);
  const cur = x && x.target ? `${x.target.app}/${x.target.key}` : "";
  return (
    <div className="cp-picker">
      <div className="cp-ph">
        <b>Link {r.name} to an {N} component</b>
        <input type="text" autoFocus placeholder={`Search ${catalog.length} ${N} components by name, namespace or micro app…`} value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn ghost tiny" onClick={() => onPick("none")} title="it has no counterpart: nothing is compared or moved">No {N} counterpart</button>
      </div>
      <div className="cp-plist">
        {shown.map(({ c, score }) => (
          <div key={c.app + c.key} className={"cp-prow" + (`${c.app}/${c.key}` === cur ? " on" : "")}>
            <span className="sg-apptag">{c.app}</span><b>{c.name}</b><span className="mono tag">{c.key}</span>
            {c.kuid && r && x && x.kuid === c.kuid && <span className="tag">same kuid</span>}
            <span className="cp-pscore">{pct(score)} widgets shared</span>
            {`${c.app}/${c.key}` === cur ? <span className="mg-best">compared now</span> : <button className="btn tiny" onClick={() => onPick({ app: c.app, key: c.key })}>Link</button>}
          </div>
        ))}
        {!shown.length && <p className="note">No {N} component matches.</p>}
      </div>
      <p className="note sg-foot">The link is kept in this browser for these customisation and {N} folders and this channel, and is used next time the micro-app map runs. The component is compared again against the copy you pick.</p>
    </div>
  );
}

// forms, segment templates and other components that place this component (a UserWidgetInstance whose
// sourceUserWidget is the component's root widget id), per version
const USE_KIND = { form: "Forms", template: "Segment templates", component: "Other components" };
function CompUsedBy({ r, labels, usage, usageProg }) {
  const [vi, setVi] = useState(() => Math.max(0, labels.findIndex((l) => r.present[l])));
  if (!usage) return <div className="sg-where"><div className="sg-h">Used by</div><p className="note">Finding where each component is used… {usageProg ? Math.round((usageProg.done / Math.max(1, usageProg.total)) * 100) + "%" : ""}</p></div>;
  const list = (usage[vi] && usage[vi].get(r.key)) || [];
  const groups = new Map();
  for (const e of list) { const k = `${e.kind}|${e.where}`; if (!groups.has(k)) groups.set(k, { ...e, vias: [] }); groups.get(k).vias.push(e.via); }
  const byKind = Object.keys(USE_KIND).map((k) => [k, [...groups.values()].filter((g) => g.kind === k)]).filter(([, g]) => g.length);
  return (
    <div className="sg-where">
      <div className="sg-h">Used by
        <span className="seg" style={{ margin: "0 0 0 10px" }}>{labels.map((l, i) => <button key={l} className={vi === i ? "on" : ""} disabled={!r.present[l]} onClick={() => setVi(i)}>{l} · {r.present[l] ? usedCount(usage, i, r.key) : "—"}</button>)}</span>
      </div>
      {!r.present[labels[vi]] ? <p className="note">Not in {labels[vi]}.</p> : !byKind.length ? <p className="note">No form, segment template or component in {labels[vi]} places this component — it looks unused there.</p> : (
        byKind.map(([k, gs]) => (
          <div key={k} className="sg-ugroup">
            <div className="tag">{USE_KIND[k]} · {gs.length}</div>
            {gs.map((g) => (
              <div key={g.where} className="sg-urow">
                <b className="mono">{k === "form" ? formName(g.where) : k === "template" ? g.where.split("/").pop() : g.where}</b>
                {k === "form" && <span className="tag">{formModule(g.where)}</span>}
                {g.app && <span className="sg-apptag">{g.app}</span>}
                <span className="sg-via">instance {[...new Set(g.vias)].slice(0, 4).join(", ")}{g.vias.length > 4 ? ` · +${g.vias.length - 4}` : ""}</span>
              </div>
            ))}
          </div>
        ))
      )}
      <p className="note sg-foot">A form places a component as a widget of type UserWidgetInstance; its <code>sourceUserWidget</code> is the id of the component's root widget.</p>
    </div>
  );
}
