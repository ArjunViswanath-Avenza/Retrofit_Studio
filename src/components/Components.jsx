import { useState, useMemo } from "react";
import { FormTree } from "./Forms";
import { OverallView } from "./Overall";
import { partsOf } from "../lib/components";

// aspects shown per component; "structure" and "files" have their own views, the rest are member models
const ASPECT_TABS = [
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

export function ComponentsView(props) {
  const { bulk, analyzing, drill } = props;
  if (drill != null && bulk) return <ComponentDetail {...props} r={bulk.results[drill]} />;
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
        <CompDashboard {...props} />
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
  if (s.propWidgets) parts.push(<b key="c" className="c">~{s.propWidgets}</b>);
  return parts.length ? parts.reduce((acc, x, i) => (i ? [...acc, " ", x] : [x]), []) : <span className="tag">—</span>;
}

function CompDashboard({ bulk, labels, setDrill }) {
  const [O, C, N] = labels;
  const R = bulk.results;
  const [q, setQ] = useState("");
  const [show, setShow] = useState(new Set(["customised", "new", "removed"]));
  const [sort, setSort] = useState(["total", -1]);

  const agg = useMemo(() => {
    const a = { per: {}, st: {}, total: 0, conflicts: 0, aspects: {} };
    for (const l of labels) a.per[l] = 0;
    for (const r of R) {
      for (const l of labels) if (r.present[l]) a.per[l]++;
      a.st[r.status] = (a.st[r.status] || 0) + 1;
      a.total += r.total; a.conflicts += r.conflicts;
      for (const [k] of COLS) a.aspects[k] = (a.aspects[k] || 0) + r.changes[k];
    }
    return a;
  }, [R, labels]);

  const rows = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const out = R.map((r, i) => ({ r, i })).filter(({ r }) => show.has(r.status) && (!ql || r.key.toLowerCase().includes(ql)));
    const [k, dir] = sort;
    const val = ({ r }) => (k === "name" ? r.name.toLowerCase() : k === "total" ? r.total : k === "conflicts" ? r.conflicts : r.changes[k]);
    out.sort((x, y) => { const a = val(x), b = val(y); return (a < b ? -1 : a > b ? 1 : 0) * dir || x.r.name.localeCompare(y.r.name); });
    return out;
  }, [R, q, show, sort]);

  const top = useMemo(() => [...R].filter((r) => r.total > 0).sort((a, b) => b.total - a.total).slice(0, 12), [R]);
  const max = top.length ? top[0].total : 1;
  const toggle = (st) => setShow((s) => { const n = new Set(s); if (n.has(st)) n.delete(st); else n.add(st); return n; });
  const th = (k, t) => (
    <th className="sortable" onClick={() => setSort(([sk, d]) => [k, sk === k ? -d : k === "name" ? 1 : -1])}>
      {t}{sort[0] === k ? (sort[1] < 0 ? " ▼" : " ▲") : ""}
    </th>
  );

  const exportCsv = () => {
    const out = [["component", "status", "aspect", "item", "change", "bucket", `in_${N || "new"}`, "note"]];
    for (const r of R) {
      const s = r.structure["01"];
      if (s && (s.added || s.removed || s.moved || s.propWidgets))
        out.push([r.key, r.status, "structure", `${O}→${C} widgets`, `+${s.added} -${s.removed} moved ${s.moved} props ${s.propWidgets}`, "", "", ""]);
      for (const [k] of COLS) {
        const m = r.models[k];
        if (!m) continue;
        for (const n of m.genuine) {
          const x = m.members[n];
          out.push([r.key, r.status, k, m.hints && m.hints[n] ? `${n} (${m.hints[n]})` : n, x.change, x.bucket, x.inNew || "", x.note]);
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

      <div className="searchbar">
        <input type="text" placeholder="Search components…" value={q} onChange={(e) => setQ(e.target.value)} />
        {STATUSES.filter((st) => st !== "absent" || N).map((st) => (
          <span key={st} className={"chip" + (show.has(st) ? " on" : "")} onClick={() => toggle(st)}>
            {show.has(st) ? "✓ " : ""}{statusLabel(st, labels)} ({agg.st[st] || 0})
          </span>
        ))}
        <span className="spacer" />
        <button className="btn ghost" onClick={exportCsv}>Export CSV</button>
      </div>

      <table>
        <thead>
          <tr>
            {th("name", "Component")}
            {labels.map((l) => <th key={l} style={{ textAlign: "center" }}>{l}</th>)}
            <th>Status</th>
            {th("structure", `Structure ${O}→${C}`)}
            {COLS.slice(1).map(([k, t]) => th(k, t))}
            {N && th("conflicts", "Conflicts")}
            {th("total", "Total")}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ r, i }) => (
            <tr key={r.key} className="clickable" onClick={() => setDrill(i)} style={{ cursor: "pointer" }}>
              <td><b>{r.name}</b><div className="tag">{r.namespace}</div></td>
              {labels.map((l) => <td key={l} style={{ textAlign: "center" }}>{r.present[l] ? <span className="a">✓</span> : <span className="tag">—</span>}</td>)}
              <td><span className={"cstat cs-" + r.status}>{statusLabel(r.status, labels)}</span></td>
              <td>{structText(r.structure["01"])}</td>
              {COLS.slice(1).map(([k]) => (
                <td key={k} style={{ textAlign: "center" }}>
                  {r.errors[k] ? <span className="pill Removed" title={r.errors[k]}>error</span> : r.changes[k] ? <b>{r.changes[k]}</b> : <span className="tag">—</span>}
                </td>
              ))}
              {N && <td style={{ textAlign: "center" }}>{r.conflicts ? <span className="pill b2">{r.conflicts}</span> : <span className="tag">—</span>}</td>}
              <td style={{ textAlign: "center" }}><b>{r.total || ""}</b></td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={20} className="note">No components match the filters.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function ComponentDetail({ r, picked, labels, setDrill, aspect, setAspect, renderReport, overall, setOverall }) {
  const [O, C, N] = labels;
  const [pairIdx, setPairIdx] = useState(0);
  const smMaps = useMemo(() => picked.map((p) => {
    const parts = p && p.comps ? partsOf(r.key, p.comps.get(r.key)) : null;
    return parts ? parts.structure : undefined;
  }), [picked, r.key]);

  const count = (k) => (k === "structure" ? r.changes.structure : k === "files" ? null : r.changes[k]);
  const tabs = ASPECT_TABS.filter(([k]) => k !== "scripts" || r.models.scripts);
  const cur = tabs.some(([k]) => k === aspect) ? aspect : "structure";
  const model = r.models[cur];

  const emptyCtrl = cur === "controller" && model && labels.filter((l) => r.present[l] && model.counts[l] === 0);

  return (
    <div>
      <button className="btn ghost" onClick={() => setDrill(null)} style={{ marginBottom: 10 }}>← All components</button>
      <h2 className="page">
        {r.name} <span className={"cstat cs-" + r.status} style={{ fontSize: 13, verticalAlign: "middle" }}>{statusLabel(r.status, labels)}</span>
      </h2>
      <div className="crumb">
        userwidgets/{r.key} · {labels.map((l) => (
          <span key={l} style={{ marginRight: 10 }}>{l}: {r.present[l] ? <b className="a">present</b> : <b className="r">absent</b>}{r.widgetCounts && r.present[l] ? ` (${r.widgetCounts[l]} widgets)` : ""}</span>
        ))}
      </div>

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

      {cur === "structure" && (
        r.errors.structure ? <p className="note">Could not read the widget tree: {r.errors.structure}</p> : (
          <FormTree key={r.key} formKey={r.key} picked={picked} labels={labels} pairIdx={pairIdx} setPairIdx={setPairIdx}
            getMap={(i) => smMaps[i]} embedded />
        )
      )}

      {cur === "files" && <OverallView key={r.key} cat="comps" picked={picked} labels={labels} cache={overall} setCache={setOverall} focus={r.key} />}

      {cur !== "structure" && cur !== "files" && (
        r.errors[cur] ? <p className="note">Could not analyse: {r.errors[cur]}</p>
          : !model ? <p className="note">No {cur === "deps" ? "uwDependencies.json" : cur === "contract" ? "uwProperties.json" : cur} file in any version.</p>
            : (
              <>
                {emptyCtrl && emptyCtrl.length > 0 && (
                  <p className="note">Empty controller (<code>return {"{}"}</code>, no members) in {emptyCtrl.join(", ")}.</p>
                )}
                {cur === "contract" && <p className="note">Entries are matched by section + propertyKey; the tool-generated <code>kuid</code> / <code>srcWgtKUID</code> ids are ignored when deciding whether an entry changed.</p>}
                {cur === "actions" && <p className="note">Generated action sequences, matched by name; the label beside each is the event and widget from its <code>/** … defined for … **/</code> comment.</p>}
                {renderReport(model)}
              </>
            )
      )}
    </div>
  );
}
