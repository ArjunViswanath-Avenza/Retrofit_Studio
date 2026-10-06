import { useState, useEffect, useMemo, useRef } from "react";
import { idSetDiff, buildFormDiff, computeCounts, summarizeForm, CATEGORIES, CATEGORY_LABELS } from "../lib/forms";

const PAIRS = [[0, 1], [0, 2], [1, 2]]; // positions in labels: base·custom, base·new, custom·new
const MARK = { added: "+", removed: "−", moved: "↔", modified: "~", same: "" };

const formName = (key) => key.split("/").pop().replace(/\.sm$/i, "");
const formModule = (key) => key.split("/").slice(-2, -1)[0] || "";

// icon-font glyphs live in the Unicode private-use area and render as blanks — show them as \uXXXX
const showGlyphs = (s) => s.replace(/[-]/g, (c) => "\\u" + c.charCodeAt(0).toString(16));
const short = (v, n = 260) => {
  if (v === undefined) return "∅ (none)";
  const s = showGlyphs(typeof v === "string" ? JSON.stringify(v) : JSON.stringify(v));
  return s.length > n ? s.slice(0, n) + "…" : s;
};

async function readWidgets(map) {
  const W = {};
  if (!map) return { W, bad: 0 };
  const entries = [...map.entries()];
  let bad = 0;
  for (let i = 0; i < entries.length; i += 250) {
    const chunk = entries.slice(i, i + 250);
    const texts = await Promise.all(chunk.map(([, f]) => f.text()));
    chunk.forEach(([id], k) => { try { W[id] = JSON.parse(texts[k]); } catch { bad++; } });
  }
  return { W, bad };
}

function PairSelector({ pairIdx, setPairIdx, labels }) {
  return (
    <div className="seg">
      {PAIRS.filter(([, b]) => b < labels.length).map(([a, b], i) => (
        <button key={i} className={i === pairIdx ? "on" : ""} onClick={() => setPairIdx(i)}>{labels[a]} vs {labels[b]}</button>
      ))}
    </div>
  );
}

/* =========================================================== view + background scan =========================================================== */
export function FormsView({ picked, labels, scan, setScan }) {
  const [pairIdx, setPairIdx] = useState(0);
  const [open, setOpen] = useState(null);
  const started = useRef(new Set());
  const [A, B] = PAIRS[pairIdx].map((i) => labels[i]);
  const pairKey = A + "|" + B;

  // property differences need every widget read, so scan each pair once in the background
  useEffect(() => {
    if (scan[pairKey] || started.current.has(pairKey)) return;
    const ma = picked[labels.indexOf(A)]?.forms, mb = picked[labels.indexOf(B)]?.forms;
    if (!ma || !mb) return;
    started.current.add(pairKey);
    const keys = [...ma.keys()].filter((k) => mb.has(k));
    setScan((s) => ({ ...s, [pairKey]: { done: 0, total: keys.length, forms: {} } }));
    (async () => {
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        const [ra, rb] = await Promise.all([readWidgets(ma.get(k)), readWidgets(mb.get(k))]);
        const s = summarizeForm(ra.W, rb.W);
        setScan((c) => ({ ...c, [pairKey]: { ...c[pairKey], done: i + 1, forms: { ...c[pairKey].forms, [k]: s } } }));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairKey]);

  if (open) return <FormTree formKey={open} picked={picked} labels={labels} pairIdx={pairIdx} setPairIdx={setPairIdx} back={() => setOpen(null)} />;
  return <FormsList picked={picked} labels={labels} pairIdx={pairIdx} setPairIdx={setPairIdx} openForm={setOpen} scanEntry={scan[pairKey]} />;
}

/* ================================================================= list ================================================================= */
function FormsList({ picked, labels, pairIdx, setPairIdx, openForm, scanEntry }) {
  const [q, setQ] = useState("");
  const [onlyChanged, setOnlyChanged] = useState(true);
  const [sort, setSort] = useState({ key: "total", dir: "desc" });
  const [ia, ib] = PAIRS[pairIdx];
  const A = labels[ia], B = labels[ib];
  const scanning = scanEntry && scanEntry.done < scanEntry.total;

  const rows = useMemo(() => {
    const maps = picked.map((p) => (p ? p.forms : new Map()));
    const keys = [...new Set(maps.flatMap((m) => [...m.keys()]))].sort();
    return keys.map((key) => {
      const fa = maps[ia].get(key), fb = maps[ib].get(key);
      const { added, removed } = idSetDiff(fa ? new Set(fa.keys()) : new Set(), fb ? new Set(fb.keys()) : new Set());
      const s = scanEntry?.forms?.[key];
      const both = !!(fa && fb);
      const props = both ? (s ? s.propWidgets : null) : 0;
      const status = !fa && !fb ? "absent" : !fa ? "new form" : !fb ? "removed form"
        : added || removed ? "structure" : props == null ? "pending" : props > 0 ? "properties" : "unchanged";
      return {
        key, name: formName(key), module: formModule(key), added, removed, props: props ?? 0, propsKnown: props != null,
        entries: s ? s.leaves : 0, total: added + removed + (props || 0), status,
        sizes: labels.map((_, k) => (maps[k].get(key) ? maps[k].get(key).size : null)),
      };
    });
  }, [picked, labels, ia, ib, scanEntry]);

  const inPair = rows.filter((r) => r.status !== "absent");
  const agg = {
    forms: inPair.length,
    changed: inPair.filter((r) => r.total > 0).length,
    added: inPair.reduce((s, r) => s + r.added, 0),
    removed: inPair.reduce((s, r) => s + r.removed, 0),
    props: inPair.reduce((s, r) => s + r.props, 0),
    entries: inPair.reduce((s, r) => s + r.entries, 0),
  };
  let view = inPair.filter((r) => (!onlyChanged || r.total > 0 || !r.propsKnown) && (!q || r.name.toLowerCase().includes(q.toLowerCase())));
  const dir = sort.dir === "asc" ? 1 : -1;
  view = [...view].sort((x, y) => sort.key === "name" ? dir * x.name.localeCompare(y.name) : dir * (x[sort.key] - y[sort.key]) || x.name.localeCompare(y.name));
  const top = inPair.filter((r) => r.total > 0).sort((x, y) => y.total - x.total).slice(0, 8);
  const maxT = Math.max(1, ...top.map((r) => r.total));
  const setSortKey = (key) => setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" }));
  const arrow = (key) => (sort.key === key ? (sort.dir === "asc" ? " ▲" : " ▼") : "");
  const STATUS_PILL = { structure: "Modified", properties: "Props", "new form": "Added", "removed form": "Removed" };

  return (
    <div>
      <h2 className="page">Form Comparison</h2>
      <div className="crumb">Widget structure + property differences per form · {A} (base) → {B} (target)</div>
      <PairSelector pairIdx={pairIdx} setPairIdx={setPairIdx} labels={labels} />
      <div className="cards">
        <div className="card"><div className="n">{agg.forms}</div><div className="l">forms in {A}/{B}</div></div>
        <div className="card"><div className="n">{agg.changed}</div><div className="l">forms with differences</div></div>
        <div className="card"><div className="n" style={{ color: "var(--add-mark)" }}>+{agg.added}</div><div className="l">widgets added</div></div>
        <div className="card"><div className="n" style={{ color: "var(--del-mark)" }}>−{agg.removed}</div><div className="l">widgets removed</div></div>
        <div className="card">
          <div className="n" style={{ color: "var(--chg-mark)" }}>{agg.props}{scanning ? "…" : ""}</div>
          <div className="l">widgets with property changes{agg.entries ? ` · ${agg.entries} changes` : ""}</div>
        </div>
      </div>
      {scanning && (
        <div style={{ maxWidth: 560 }}>
          <div className="tag">Reading widget properties… {scanEntry.done}/{scanEntry.total} forms</div>
          <div className="progress"><div style={{ width: (scanEntry.done / scanEntry.total) * 100 + "%" }} /></div>
        </div>
      )}
      {top.length > 0 && (
        <div className="chart">
          <div className="tag" style={{ marginBottom: 2 }}>Forms with the most differences — click to open the tree
            <span className="legend" style={{ marginLeft: 10 }}><span className="lg added">added</span> <span className="lg removed">removed</span> <span className="lg modified">property changes</span></span>
          </div>
          {top.map((r) => (
            <div className="row" key={r.key}>
              <span className="cname" onClick={() => openForm(r.key)} title={r.key}>{r.name}</span>
              <span className="stackbar" title={`+${r.added} / −${r.removed} / ~${r.props}`}>
                <i className="a" style={{ width: (r.added / maxT) * 100 + "%" }} />
                <i className="r" style={{ width: (r.removed / maxT) * 100 + "%" }} />
                <i className="c" style={{ width: (r.props / maxT) * 100 + "%" }} />
              </span>
              <span style={{ textAlign: "right" }}>{r.total}</span>
            </div>
          ))}
        </div>
      )}
      <div className="searchbar">
        <input type="text" placeholder="Search forms…" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className={"chip" + (onlyChanged ? " on" : "")} onClick={() => setOnlyChanged((v) => !v)}>{onlyChanged ? "✓ " : ""}only changed</span>
        <span className="tag">{view.length} shown</span>
      </div>
      <div className="view" style={{ borderRadius: 10, border: "1px solid var(--line)", maxHeight: "58vh", overflow: "auto" }}>
        <table>
          <thead>
            <tr>
              <th className="sortable" onClick={() => setSortKey("name")}>Form{arrow("name")}</th>
              {labels.map((l) => <th key={l} style={{ textAlign: "center" }}>{l} widgets</th>)}
              <th className="sortable" style={{ textAlign: "center" }} onClick={() => setSortKey("added")}>Added{arrow("added")}</th>
              <th className="sortable" style={{ textAlign: "center" }} onClick={() => setSortKey("removed")}>Removed{arrow("removed")}</th>
              <th className="sortable" style={{ textAlign: "center" }} onClick={() => setSortKey("props")}>Property changes{arrow("props")}</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {view.map((r) => (
              <tr key={r.key} className="clickable" style={{ cursor: "pointer" }} onClick={() => openForm(r.key)}>
                <td><b style={{ color: "var(--accent)" }}>{r.name}</b><div className="tag">{r.module}</div></td>
                {r.sizes.map((s, k) => <td key={k} style={{ textAlign: "center" }}>{s == null ? "–" : s}</td>)}
                <td style={{ textAlign: "center", color: r.added ? "var(--add-mark)" : "inherit", fontWeight: 700 }}>{r.added ? "+" + r.added : "0"}</td>
                <td style={{ textAlign: "center", color: r.removed ? "var(--del-mark)" : "inherit", fontWeight: 700 }}>{r.removed ? "−" + r.removed : "0"}</td>
                <td style={{ textAlign: "center", color: r.props ? "var(--chg-mark)" : "inherit", fontWeight: 700 }}>
                  {!r.propsKnown ? <span className="tag">…</span> : r.props ? <>~{r.props} <span className="tag">({r.entries})</span></> : "0"}
                </td>
                <td>{r.status === "pending" ? <span className="tag">scanning…</span> : <span className={"pill " + (STATUS_PILL[r.status] || "")}>{r.status}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="tag" style={{ marginTop: 6 }}>Property changes = widgets whose properties differ (count of individual changes in brackets). IDE-only
        state, empty-vs-null values and Visualizer design-time settings are ignored.</p>
    </div>
  );
}

/* ================================================================= tree ================================================================= */
// getMap(i) -> Map(widgetId -> File) for version i (defaults to the form's .sm); embedded hides the page header
export function FormTree({ formKey, picked, labels, pairIdx, setPairIdx, back, getMap, embedded }) {
  const [ia, ib] = PAIRS[pairIdx];
  const A = labels[ia], B = labels[ib];
  const [data, setData] = useState(null);
  const [bad, setBad] = useState(0);
  const [expanded, setExpanded] = useState(new Set());
  const [changesOnly, setChangesOnly] = useState(true);
  const [showMod, setShowMod] = useState(true);
  const [cats, setCats] = useState(new Set(CATEGORIES));
  const [keyFilter, setKeyFilter] = useState(null);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(null);
  const [openInner, setOpenInner] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setData(null); setSel(null); setKeyFilter(null);
    (async () => {
      const mapOf = (i) => (getMap ? getMap(i) : picked[i]?.forms.get(formKey));
      const [ra, rb] = await Promise.all([readWidgets(mapOf(ia)), readWidgets(mapOf(ib))]);
      if (cancelled) return;
      const d = buildFormDiff(ra.W, rb.W);
      setBad(ra.bad + rb.bad);
      const ex = new Set([d.formRoot, "__detached__"]);
      for (const n of d.nodes.values()) {
        if (n.status === "same") continue;
        let p = d.nodes.get(n.treeParent);
        while (p && !ex.has(p.id)) { ex.add(p.id); p = d.nodes.get(p.treeParent); }
      }
      setExpanded(ex);
      setData(d);
    })();
    return () => { cancelled = true; };
  }, [formKey, pairIdx, picked, ia, ib]);

  const propInScope = (p) => showMod && cats.has(p.category) && (!keyFilter || p.key === keyFilter);
  const counts = useMemo(() => (data ? computeCounts(data, propInScope) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, showMod, cats, keyFilter]);
  const eff = (id) => counts.eff.get(id);
  const score = (id) => { const e = eff(id); return e ? e.added + e.removed + e.moved + e.modified : 0; };

  const matchSet = useMemo(() => {
    if (!data || !q) return null;
    const ql = q.toLowerCase(), s = new Set();
    for (const n of data.nodes.values()) {
      if (n.id.toLowerCase().includes(ql) || n.wType.toLowerCase().includes(ql)) {
        let p = n; while (p) { s.add(p.id); p = data.nodes.get(p.treeParent); }
      }
    }
    return s;
  }, [data, q]);

  const rows = useMemo(() => {
    if (!data || !counts) return [];
    const out = [];
    const walk = (id, depth) => {
      const n = data.nodes.get(id);
      if (!n) return;
      if (changesOnly && score(id) === 0) return;
      if (matchSet && !matchSet.has(id)) return;
      out.push({ n, depth });
      if (expanded.has(id) || matchSet) for (const c of n.children) walk(c, depth + 1);
    };
    if (data.formRoot) walk(data.formRoot, 0);
    const det = data.detached.filter((id) => (!changesOnly || score(id) > 0) && (!matchSet || matchSet.has(id)));
    if (det.length) {
      out.push({ group: true, depth: 0, count: det.length });
      if (expanded.has("__detached__") || matchSet) det.forEach((id) => walk(id, 1));
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, counts, expanded, changesOnly, matchSet]);

  const toggle = (id) => setExpanded((s) => { const c = new Set(s); if (c.has(id)) c.delete(id); else c.add(id); return c; });
  const expandAll = () => data && setExpanded(new Set([...data.nodes.keys(), "__detached__"]));
  const collapseAll = () => data && setExpanded(new Set([data.formRoot]));
  const toggleCat = (c) => setCats((s) => { const n = new Set(s); if (n.has(c)) n.delete(c); else n.add(c); return n; });

  const exportCsv = () => {
    const out = [["form", "widget", "wType", "status", "old_parent", "new_parent", "level", "category", "property", `${A}_value`, `${B}_value`]];
    for (const id of data.order) {
      const n = data.nodes.get(id), e = eff(id);
      if (e.status === "added" || e.status === "removed" || e.status === "moved")
        out.push([formName(formKey), n.id, n.wType, e.status, n.oldParent || "", n.newParent || "", n.depth, "", "", "", ""]);
      for (const p of n.props.filter(propInScope))
        out.push([formName(formKey), n.id, n.wType, "property", n.oldParent || "", n.newParent || "", n.depth, CATEGORY_LABELS[p.category],
          p.path, p.old === undefined ? "" : showGlyphs(JSON.stringify(p.old)), p.new === undefined ? "" : showGlyphs(JSON.stringify(p.new))]);
    }
    const csv = out.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `${formName(formKey)}_${A}_vs_${B}.csv`; a.click();
  };

  const selNode = sel && data ? data.nodes.get(sel) : null;

  // totals under current filters
  const T = useMemo(() => {
    if (!data || !counts) return null;
    const t = { added: 0, removed: 0, moved: 0, modified: 0, propWidgets: 0, entries: 0 };
    for (const [, e] of counts.eff) {
      if (e.status !== "same") t[e.status]++;
      if (e.props) { t.propWidgets++; t.entries += e.props; }
    }
    return t;
  }, [data, counts]);
  const topKeys = data ? Object.entries(data.byKey).sort((x, y) => y[1] - x[1]).slice(0, 10) : [];
  const maxLevel = counts ? Math.max(1, ...counts.levels.map((l) => l.added + l.removed + l.moved + l.modified)) : 1;

  return (
    <div>
      {!embedded && (
        <>
          <button className="btn ghost" onClick={back} style={{ marginBottom: 10 }}>← All forms</button>
          <h2 className="page">{formName(formKey)}</h2>
          <div className="crumb">{formKey}</div>
        </>
      )}
      <PairSelector pairIdx={pairIdx} setPairIdx={setPairIdx} labels={labels} />

      {!data || !counts ? (
        <p className="note">Reading widgets for {A} and {B}…</p>
      ) : (
        <>
          <div className="cards">
            <div className="card"><div className="n">{data.sizeA} → {data.sizeB}</div><div className="l">widgets {A} → {B}</div></div>
            <div className="card"><div className="n" style={{ color: "var(--add-mark)" }}>+{T.added}</div><div className="l">added</div></div>
            <div className="card"><div className="n" style={{ color: "var(--del-mark)" }}>−{T.removed}</div><div className="l">removed</div></div>
            <div className="card"><div className="n" style={{ color: "var(--mov-mark)" }}>{T.moved}</div><div className="l">moved (new parent)</div></div>
            <div className="card"><div className="n" style={{ color: "var(--chg-mark)" }}>~{T.propWidgets}</div><div className="l">widgets with property changes · {T.entries} changes</div></div>
          </div>

          {data.leaves > 0 && (
            <div className="propsum">
              <div className="pshead">
                <b>Property changes by category</b>
                <span className={"chip" + (showMod ? " on" : "")} onClick={() => setShowMod((v) => !v)}>{showMod ? "✓ " : ""}show property changes</span>
                <span className="chip" onClick={() => setCats(new Set(CATEGORIES))}>all</span>
                <span className="chip" onClick={() => setCats(new Set())}>none</span>
              </div>
              <div className="catchips">
                {CATEGORIES.filter((c) => data.byCategory[c]).map((c) => (
                  <span key={c} className={"catchip" + (cats.has(c) ? " on" : "")} onClick={() => toggleCat(c)}>
                    {CATEGORY_LABELS[c]} <b>{data.byCategory[c]}</b>
                  </span>
                ))}
              </div>
              <div className="tag" style={{ margin: "8px 0 4px" }}>Most-changed properties — click to show only widgets where it changed:</div>
              <div className="catchips">
                {topKeys.map(([k, n]) => (
                  <span key={k} className={"keychip" + (keyFilter === k ? " on" : "")} onClick={() => setKeyFilter(keyFilter === k ? null : k)}>
                    <span className="mono">{k}</span> ×{n}
                  </span>
                ))}
                {keyFilter && <span className="chip" onClick={() => setKeyFilter(null)}>✕ clear “{keyFilter}”</span>}
              </div>
            </div>
          )}

          <h3 style={{ margin: "12px 0 6px" }}>Level comparison</h3>
          <div className="levels">
            <div className="lvrow lvhead"><span>Level</span><span>Widgets</span><span>Added</span><span>Removed</span><span>Moved</span><span>Prop. changed</span><span /></div>
            {counts.levels.map((l) => {
              const ch = l.added + l.removed + l.moved + l.modified;
              return (
                <div key={l.depth} className={"lvrow" + (ch ? "" : " quiet")}>
                  <span><b>L{l.depth}</b>{l.depth === 0 ? " · form" : ""}</span>
                  <span>{l.total}</span>
                  <span style={{ color: l.added ? "var(--add-mark)" : "inherit" }}>{l.added ? "+" + l.added : "·"}</span>
                  <span style={{ color: l.removed ? "var(--del-mark)" : "inherit" }}>{l.removed ? "−" + l.removed : "·"}</span>
                  <span style={{ color: l.moved ? "var(--mov-mark)" : "inherit" }}>{l.moved || "·"}</span>
                  <span style={{ color: l.modified ? "var(--chg-mark)" : "inherit" }}>{l.modified ? "~" + l.modified : "·"}</span>
                  <span className="stackbar">
                    <i className="a" style={{ width: (l.added / maxLevel) * 100 + "%" }} />
                    <i className="r" style={{ width: (l.removed / maxLevel) * 100 + "%" }} />
                    <i className="m" style={{ width: (l.moved / maxLevel) * 100 + "%" }} />
                    <i className="c" style={{ width: (l.modified / maxLevel) * 100 + "%" }} />
                  </span>
                </div>
              );
            })}
            {data.detached.length > 0 && <div className="tag" style={{ marginTop: 4 }}>+ {data.detached.length} detached widget(s) not counted above (parent missing from the form).</div>}
          </div>

          <div className="searchbar" style={{ marginTop: 14 }}>
            <input type="text" placeholder="Find widget id or type…" value={q} onChange={(e) => setQ(e.target.value)} />
            <span className={"chip" + (changesOnly ? " on" : "")} onClick={() => setChangesOnly((v) => !v)}>{changesOnly ? "✓ " : ""}changes only</span>
            <span className="chip" onClick={expandAll}>expand all</span>
            <span className="chip" onClick={collapseAll}>collapse all</span>
            <span className="spacer" />
            <span className="legend">
              <span className="lg added">+ added</span> <span className="lg removed">− removed</span> <span className="lg moved">↔ moved</span> <span className="lg modified">~ properties</span>
            </span>
            <button className="btn" onClick={exportCsv}>Export (CSV)</button>
          </div>
          {bad > 0 && <p className="tag">{bad} widget file(s) could not be parsed and were skipped.</p>}

          <div className="treewrap">
            <div className="ftree">
              {rows.length === 0 && <p className="note" style={{ padding: 12 }}>No differences between {A} and {B} for this form under the current filters{changesOnly ? " (turn off “changes only” to browse the full tree)" : ""}.</p>}
              {rows.map((r, i) => {
                if (r.group) return (
                  <div key={"g" + i} className="trow group" onClick={() => toggle("__detached__")}>
                    <span className={"tchev" + (expanded.has("__detached__") ? " open" : "")}>▶</span>
                    <span>⊘ Detached widgets ({r.count}) — parent no longer exists in the form</span>
                  </div>
                );
                const { n, depth } = r;
                const e = eff(n.id);
                const kids = n.children.some((c) => (!changesOnly || score(c) > 0) && (!matchSet || matchSet.has(c)));
                const open = expanded.has(n.id) || !!matchSet;
                return (
                  <div key={n.id} className={"trow " + e.status + (sel === n.id ? " sel" : "")} onClick={() => { setSel(n.id); setOpenInner(null); }}>
                    {Array.from({ length: depth }, (_, k) => <span key={k} className="guide" />)}
                    <span className={"tchev" + (open ? " open" : "") + (kids ? "" : " none")} onClick={(ev) => { ev.stopPropagation(); if (kids) toggle(n.id); }}>▶</span>
                    <span className="tmark">{MARK[e.status]}</span>
                    <span className="tid">{n.id}</span>
                    <span className="wtag">{n.wType}</span>
                    {e.props > 0 && <span className="pbadge" title={`${e.props} property change(s)`}>~{e.props}</span>}
                    {!open && kids && (e.added || e.removed || e.modified) ? (
                      <span className="sub-badge">
                        {e.added ? <b className="a">+{e.added}</b> : null}
                        {e.removed ? <b className="r">−{e.removed}</b> : null}
                        {e.modified ? <b className="c">~{e.modified}</b> : null}
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>

            <div className="tdetail">
              {!selNode ? (
                <p className="note">Select a widget to see its details and property changes.</p>
              ) : (
                <>
                  <div className="tdhead"><span className={"lg " + selNode.status}>{selNode.status === "modified" ? "properties changed" : selNode.status}</span> <b>{selNode.id}</b></div>
                  <table className="kv">
                    <tbody>
                      <tr><td>Type</td><td>{selNode.wType} <span className="tag">{selNode.name}</span></td></tr>
                      <tr><td>Level</td><td>L{selNode.depth}{selNode.detached ? " (detached)" : ""}</td></tr>
                      <tr><td>Parent in {A}</td><td className="mono">{selNode.oldParent || "—"}</td></tr>
                      <tr><td>Parent in {B}</td><td className="mono">{selNode.newParent || "—"}</td></tr>
                      <tr><td>Children</td><td>{selNode.children.length}</td></tr>
                    </tbody>
                  </table>
                  {selNode.props.length === 0 ? (
                    <p className="tag" style={{ marginTop: 10 }}>
                      {selNode.status === "added" ? `Exists only in ${B}.` : selNode.status === "removed" ? `Exists only in ${A}.` : "No property differences."}
                    </p>
                  ) : (
                    CATEGORIES.filter((c) => selNode.props.some((p) => p.category === c)).map((c) => {
                      const list = selNode.props.filter((p) => p.category === c);
                      const inScope = showMod && cats.has(c);
                      return (
                        <div key={c} className={"pgroup" + (inScope ? "" : " dim")}>
                          <div className="pgtitle">{CATEGORY_LABELS[c]} <span className="tag">({list.length})</span></div>
                          <table className="pdiff">
                            <thead><tr><th>Property</th><th>{A}</th><th>{B}</th></tr></thead>
                            <tbody>
                              {list.map((p) => p.embedded ? (
                                <tr key={p.path}>
                                  <td className="mono">{p.key}</td>
                                  <td colSpan={2}>
                                    <span className={"lg " + (p.change === "added" ? "added" : p.change === "removed" ? "removed" : "modified")}>{p.change}</span>{" "}
                                    embedded <b>{p.widgetType}</b> definition · {p.innerCount} inner change(s){" "}
                                    <span className="chip" onClick={() => setOpenInner(openInner === p.path ? null : p.path)}>{openInner === p.path ? "hide" : "show"}</span>
                                    {openInner === p.path && (
                                      <table className="pdiff" style={{ marginTop: 6 }}>
                                        <tbody>
                                          {p.inner.slice(0, 200).map((x) => (
                                            <tr key={x.path}><td className="mono">{x.path.slice(p.key.length + 1)}</td><td className="mono old">{short(x.old, 120)}</td><td className="mono new">{short(x.new, 120)}</td></tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    )}
                                    {openInner === p.path && p.inner.length > 200 && <div className="tag">…{p.inner.length - 200} more in the CSV export</div>}
                                  </td>
                                </tr>
                              ) : (
                                <tr key={p.path}>
                                  <td className="mono">{p.path}</td>
                                  <td className="mono old">{short(p.old)}</td>
                                  <td className="mono new">{short(p.new)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      );
                    })
                  )}
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
