import { useState, useEffect, useMemo } from "react";
import { DiffPane } from "./Overall";
import { diffTexts } from "../lib/filediff";
import { fmt } from "../lib/analyzer";
import { TYPES, unitDetail, categoryOf, mask, maskText, parseXml, prettyXml } from "../lib/fabric";

const ST = ["changed", "onlyA", "onlyB", "environment", "format", "same"];
const stLabel = (st, [la, lb]) => ({
  changed: "Changed", onlyA: `Only in ${la}`, onlyB: `Only in ${lb}`, environment: "Environment only",
  format: "Export format only", same: "Identical", error: "Error",
})[st];
const KIND_LABEL = { service: "Service settings", endpoint: "Endpoint", operation: "Operation", object: "Object definition", mappingsets: "Mapping sets", model: "Workflow model", provider: "Identity provider", manifest: "App manifest", file: "File" };
const TYPE_ICON = { Identity: "🔑", Integration: "⇄", Object: "◫", Orchestration: "⛓", Workflow: "↯", App: "▣" };
const CATS = ["logic", "environment", "format"];
const CAT_LABEL = { logic: "Logic", environment: "Environment", format: "Export format" };

// ---------------------------------------------------------------- folder pickers
export function FabricPickers({ fab, onFabFolder, labels, subs = [] }) {
  return (
    <div className="folders" style={{ gridTemplateColumns: "repeat(2,1fr)" }}>
      {labels.map((l, i) => (
        <div key={l} className={"folder" + (fab[i] ? " filled" : "")}>
          <h3>{l || "—"} — {subs[i] || "Fabric app export"}</h3>
          <div className="cnt">{fab[i] ? Object.values(fab[i].counts).reduce((a, b) => a + b, 0) : 0}</div>
          <div className="cl">services detected</div>
          <label className="pick">Choose {l} export folder
            <input type="file" webkitdirectory="" directory="" multiple style={{ display: "none" }} onChange={(e) => onFabFolder(i, e.target.files)} />
          </label>
          {fab[i] && (
            <div className="sub2">
              {fab[i].app || "app"} · {TYPES.filter((t) => fab[i].counts[t]).map((t) => `${fab[i].counts[t]} ${t}`).join(" · ")}
              {fab[i].jars ? ` · ${fab[i].jars} jars skipped` : ""}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- page
export function LoomSync({ type, fab, onFabFolder, labels, bulk, analyzing, sel, setSel, goType }) {
  const title = type ? `LoomSync · ${type} services` : "LoomSync · Fabric overview";
  const header = (
    <>
      <h2 className="page">{title}</h2>
      <div className="crumb">Exported Fabric apps compared service by service — {labels[0]} vs {labels[1]} (JARs ignored)</div>
    </>
  );
  if (!fab[0] || !fab[1]) {
    return (
      <div>
        {header}
        <div className="rules">Pick the two exported Fabric app folders (the folder that contains <code>Apps/</code>). Files are read in your browser only.</div>
        <FabricPickers fab={fab} onFabFolder={onFabFolder} labels={labels} />
      </div>
    );
  }
  if (!bulk || (analyzing && analyzing.running)) {
    return (
      <div>
        {header}
        <div style={{ maxWidth: 520 }}>
          <p className="note">Reading &amp; comparing Fabric services… {analyzing ? `${analyzing.done}/${analyzing.total}` : ""}</p>
          <div className="progress"><div style={{ width: (analyzing && analyzing.total ? (analyzing.done / analyzing.total) * 100 : 0) + "%" }} /></div>
        </div>
      </div>
    );
  }
  if (sel && sel.svc && sel.type === type) return <ServiceView bulk={bulk} labels={labels} sel={sel} setSel={setSel} />;
  return (
    <div>
      {header}
      {type ? <TypeView bulk={bulk} labels={labels} type={type} setSel={setSel} /> : <Overview bulk={bulk} labels={labels} goType={goType} setSel={setSel} />}
    </div>
  );
}

// per-service aggregation
function useServices(bulk) {
  return useMemo(() => {
    const m = new Map();
    for (const u of bulk.units) {
      const k = `${u.type}/${u.svc}`;
      if (!m.has(k)) m.set(k, { key: k, type: u.type, svc: u.svc, units: [], present: [false, false], st: {}, logic: 0, env: 0, ops: [0, 0], subtype: "" });
      const s = m.get(k);
      s.units.push(u);
      s.present[0] ||= u.present[0];
      s.present[1] ||= u.present[1];
      s.st[u.status] = (s.st[u.status] || 0) + 1;
      s.logic += u.counts.logic;
      s.env += u.counts.environment;
      if (u.kind === "operation") { if (u.present[0]) s.ops[0]++; if (u.present[1]) s.ops[1]++; }
      if (u.kind === "endpoint" && u.subtype) s.subtype = u.subtype;
      if (u.type === "Identity") s.subtype = u.subtype || "";
    }
    for (const s of m.values()) {
      s.status = !s.present[0] ? "onlyB" : !s.present[1] ? "onlyA" : s.st.changed || s.st.onlyA || s.st.onlyB ? "changed" : s.st.environment ? "environment" : s.st.format ? "format" : "same";
      s.unitsChanged = (s.st.changed || 0) + (s.st.onlyA || 0) + (s.st.onlyB || 0);
    }
    return [...m.values()];
  }, [bulk]);
}

function Overview({ bulk, labels, goType, setSel }) {
  const [la, lb] = labels;
  const services = useServices(bulk);
  const per = useMemo(() => {
    const o = {};
    for (const t of TYPES) o[t] = { svc: [0, 0], ops: [0, 0], svcChanged: 0, svcA: 0, svcB: 0, opChanged: 0, opA: 0, opB: 0, env: 0 };
    for (const s of services) {
      const p = o[s.type];
      if (!p) continue;
      if (s.present[0]) p.svc[0]++;
      if (s.present[1]) p.svc[1]++;
      if (s.status === "changed") p.svcChanged++;
      if (s.status === "onlyA") p.svcA++;
      if (s.status === "onlyB") p.svcB++;
    }
    for (const u of bulk.units) {
      const p = o[u.type];
      if (!p || u.kind !== "operation") continue;
      if (u.present[0]) p.ops[0]++;
      if (u.present[1]) p.ops[1]++;
      if (u.status === "changed") p.opChanged++;
      if (u.status === "onlyA") p.opA++;
      if (u.status === "onlyB") p.opB++;
      if (u.status === "environment") p.env++;
    }
    return o;
  }, [bulk, services]);
  const top = useMemo(() => services.filter((s) => s.present[0] && s.present[1] && s.unitsChanged).sort((a, b) => b.unitsChanged - a.unitsChanged).slice(0, 12), [services]);
  const max = top.length ? top[0].unitsChanged : 1;

  return (
    <div>
      <div className="note">Exported from Fabric <b>{bulk.version[0] || "?"}</b> ({la}) and <b>{bulk.version[1] || "?"}</b> ({lb}).</div>
      <div className="fabgrid">
        {TYPES.filter((t) => t !== "App").map((t) => {
          const p = per[t];
          return (
            <div key={t} className="fabcard" onClick={() => goType(t)}>
              <div className="fabhead"><span className="fico">{TYPE_ICON[t]}</span> {t}</div>
              <div className="fabnums">
                <div><b>{p.svc[0]} → {p.svc[1]}</b><span>services {la} → {lb}</span></div>
                {p.ops[0] + p.ops[1] > 0 && <div><b>{p.ops[0]} → {p.ops[1]}</b><span>operations</span></div>}
              </div>
              <div className="fabchips">
                {p.svcChanged > 0 && <span className="stbadge st-changed">{p.svcChanged} services changed</span>}
                {p.svcB > 0 && <span className="stbadge st-onlyB">+{p.svcB} services only in {lb}</span>}
                {p.svcA > 0 && <span className="stbadge st-onlyA">−{p.svcA} only in {la}</span>}
                {t !== "Identity" && p.opChanged > 0 && <span className="stbadge st-changed">{p.opChanged} ops changed</span>}
                {p.opB > 0 && <span className="stbadge st-onlyB">+{p.opB} ops</span>}
                {p.opA > 0 && <span className="stbadge st-onlyA">−{p.opA} ops</span>}
                {p.env > 0 && <span className="stbadge st-environment">{p.env} env-only</span>}
              </div>
            </div>
          );
        })}
      </div>

      {top.length > 0 && (
        <>
          <h3 style={{ margin: "18px 0 6px" }}>Most changed services (present in both)</h3>
          <div className="chart">
            {top.map((s) => (
              <div className="row" key={s.key}>
                <span className="cname" onClick={() => setSel({ type: s.type, svc: s.svc })} title={s.key}>{TYPE_ICON[s.type]} {s.svc}</span>
                <span className="stackbar" style={{ width: Math.max(4, (s.unitsChanged / max) * 100) + "%" }}>
                  {s.st.changed > 0 && <i className="c" style={{ width: (s.st.changed / s.unitsChanged) * 100 + "%" }} />}
                  {s.st.onlyB > 0 && <i className="a" style={{ width: (s.st.onlyB / s.unitsChanged) * 100 + "%" }} />}
                  {s.st.onlyA > 0 && <i className="r" style={{ width: (s.st.onlyA / s.unitsChanged) * 100 + "%" }} />}
                </span>
                <span>{s.unitsChanged}</span>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="rules" style={{ marginTop: 16 }}>
        <b>How differences are classified</b>
        <ul style={{ margin: "6px 0 0 18px", padding: 0 }}>
          <li><b>Logic</b> — behaviour or contract: connector type, security, endpoint URLs, class / method names, pre/post processors, request &amp; response params, DB entity metadata (columns, relationships), object fields, backend mappings, orchestration steps.</li>
          <li><b>Environment</b> — DB user / password / JDBC URL / pool size, OAuth client id / secret and IdP hosts. Counted separately; secret values are masked.</li>
          <li><b>Export format</b> — produced by the Fabric version that wrote the export, not by a change: <code>isExtended</code>, <code>customOperation</code>, <code>customVerb</code>, <code>enableFrontendUrl</code>, param order numbers, <code>etag</code>s, designer layout (<code>*VisualMappingData</code>), the mirrored <code>mapperData</code> copy, field <code>id</code>/<code>entityTypeId</code>. Hidden unless you switch them on.</li>
          <li>A setting present on one side only with a default value (empty, false, null) counts as equal. Object operation names are compared without their generated number suffix. <code>lockConfig.json</code> and the <code>_JARs</code> folder are not compared.</li>
        </ul>
      </div>
    </div>
  );
}

function TypeView({ bulk, labels, type, setSel }) {
  const [la, lb] = labels;
  const services = useServices(bulk).filter((s) => s.type === type);
  const [q, setQ] = useState("");
  const [show, setShow] = useState(new Set(["changed", "onlyA", "onlyB"]));
  const [sort, setSort] = useState(["unitsChanged", -1]);
  const counts = useMemo(() => { const c = {}; for (const s of services) c[s.status] = (c[s.status] || 0) + 1; return c; }, [services]);
  const ql = q.trim().toLowerCase();
  const rows = useMemo(() => {
    const r = services.filter((s) => show.has(s.status) && (!ql || s.svc.toLowerCase().includes(ql) || s.units.some((u) => u.id.toLowerCase().includes(ql))));
    const [k, d] = sort;
    const v = (s) => (k === "svc" ? s.svc.toLowerCase() : k === "ops" ? s.ops[1] : s[k]);
    return r.sort((a, b) => { const x = v(a), y = v(b); return (x < y ? -1 : x > y ? 1 : 0) * d || a.svc.localeCompare(b.svc); });
  }, [services, show, ql, sort]);
  const toggle = (st) => setShow((s) => { const n = new Set(s); if (n.has(st)) n.delete(st); else n.add(st); return n; });
  const th = (k, t) => <th className="sortable" onClick={() => setSort(([sk, d]) => [k, sk === k ? -d : k === "svc" ? 1 : -1])}>{t}{sort[0] === k ? (sort[1] < 0 ? " ▼" : " ▲") : ""}</th>;
  return (
    <div>
      <div className="searchbar">
        <input type="text" placeholder="Search services or operations…" value={q} onChange={(e) => setQ(e.target.value)} />
        {["changed", "onlyA", "onlyB", "environment", "format", "same"].map((st) => (
          <span key={st} className={"chip" + (show.has(st) ? " on" : "")} onClick={() => toggle(st)}>{show.has(st) ? "✓ " : ""}{stLabel(st, labels)} ({counts[st] || 0})</span>
        ))}
        <span className="spacer" />
        <button className="btn ghost" onClick={() => exportCsv(bulk, labels, type)}>Export CSV</button>
      </div>
      <table>
        <thead>
          <tr>
            {th("svc", "Service")}
            <th style={{ textAlign: "center" }}>{la}</th><th style={{ textAlign: "center" }}>{lb}</th>
            <th>Status</th>
            {type !== "Identity" && <th>Type</th>}
            {type !== "Identity" && th("ops", `Operations ${la}→${lb}`)}
            {th("unitsChanged", "Items changed / added / removed")}
            {th("logic", "Logic diffs")}
            {th("env", "Env diffs")}
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => {
            const hits = ql ? s.units.filter((u) => u.id.toLowerCase().includes(ql)).length : 0;
            return (
              <tr key={s.key} className="clickable" style={{ cursor: "pointer" }} onClick={() => setSel({ type, svc: s.svc, q: ql && !s.svc.toLowerCase().includes(ql) ? q : "" })}>
                <td><b>{s.svc}</b>{hits > 0 && <div className="tag">{hits} matching item{hits > 1 ? "s" : ""}</div>}</td>
                <td style={{ textAlign: "center" }}>{s.present[0] ? <span className="a">✓</span> : <span className="tag">—</span>}</td>
                <td style={{ textAlign: "center" }}>{s.present[1] ? <span className="a">✓</span> : <span className="tag">—</span>}</td>
                <td><span className={"stbadge st-" + s.status}>{stLabel(s.status, labels)}</span></td>
                {type !== "Identity" && <td className="tag">{s.subtype}</td>}
                {type !== "Identity" && <td>{s.ops[0]} → {s.ops[1]}</td>}
                <td>
                  {s.st.changed > 0 && <b className="c">~{s.st.changed} </b>}
                  {s.st.onlyB > 0 && <b className="a">+{s.st.onlyB} </b>}
                  {s.st.onlyA > 0 && <b className="r">−{s.st.onlyA}</b>}
                  {!s.unitsChanged && <span className="tag">—</span>}
                </td>
                <td style={{ textAlign: "center" }}>{s.logic || <span className="tag">—</span>}</td>
                <td style={{ textAlign: "center" }}>{s.env || <span className="tag">—</span>}</td>
              </tr>
            );
          })}
          {!rows.length && <tr><td colSpan={9} className="note">No services match the filters.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function exportCsv(bulk, labels, type) {
  const [la, lb] = labels;
  const out = [["type", "service", "item", "kind", "status", "category", "change", "property", la, lb]];
  for (const u of bulk.units) {
    if (type && u.type !== type) continue;
    if (u.status === "onlyA" || u.status === "onlyB") { out.push([u.type, u.svc, u.id, u.kind, stLabel(u.status, labels), "", "", "", "", ""]); continue; }
    for (const c of u.changes) {
      if (c.cat === "format") continue;
      out.push([u.type, u.svc, u.id, u.kind, stLabel(u.status, labels), CAT_LABEL[c.cat], c.op, c.path, mask(c.path, c.a) ?? "", mask(c.path, c.b) ?? ""]);
    }
  }
  const csv = out.map((r) => r.map((x) => `"${String(x ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = `loomsync_${type || "all"}_changes.csv`; a.click();
}

// ---------------------------------------------------------------- service detail
function ServiceView({ bulk, labels, sel, setSel }) {
  const [la, lb] = labels;
  const units = useMemo(() => bulk.units.filter((u) => u.type === sel.type && u.svc === sel.svc), [bulk, sel.type, sel.svc]);
  const [q, setQ] = useState(sel.q || "");
  const [onlyChanged, setOnlyChanged] = useState(true);
  const list = units.filter((u) => (!onlyChanged || !["same", "format"].includes(u.status)) && (!q || u.id.toLowerCase().includes(q.toLowerCase())));
  const cur = units.find((u) => u.key === sel.unit) || list[0] || units[0];
  const counts = {}; for (const u of units) counts[u.status] = (counts[u.status] || 0) + 1;
  const go = (key) => {
    const u = bulk.units.find((x) => x.key === key);
    if (u) setSel({ type: u.type, svc: u.svc, unit: u.key });
  };
  return (
    <div>
      <button className="btn ghost" onClick={() => setSel(null)} style={{ marginBottom: 10 }}>← All {sel.type} services</button>
      <h2 className="page">{TYPE_ICON[sel.type]} {sel.svc}</h2>
      <div className="crumb">
        {sel.type} service · {units.length} items · {ST.filter((s) => counts[s]).map((s) => `${counts[s]} ${stLabel(s, labels).toLowerCase()}`).join(" · ")}
      </div>
      <div className="ovwrap">
        <div className="ovlist">
          <input type="text" placeholder="Search items…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="stchips">
            <span className={"chip" + (onlyChanged ? " on" : "")} onClick={() => setOnlyChanged((v) => !v)}>{onlyChanged ? "✓ " : ""}hide identical / format-only</span>
          </div>
          <div className="ovitems">
            {list.map((u) => (
              <div key={u.key} className={"ovitem" + (cur && u.key === cur.key ? " sel" : "")} onClick={() => setSel({ ...sel, unit: u.key })}>
                <div className="ovname"><span className={"stdot fst-" + u.status} /><b>{u.id}</b></div>
                <div className="ovsub">{KIND_LABEL[u.kind] || u.kind}{u.subtype ? ` · ${u.subtype}` : ""} · {stLabel(u.status, labels)}{u.counts.logic ? ` · ${u.counts.logic} logic` : ""}{u.counts.environment ? ` · ${u.counts.environment} env` : ""}</div>
              </div>
            ))}
            {!list.length && <p className="note">Nothing matches.</p>}
          </div>
        </div>
        <div className="ovmain">
          {cur ? <UnitView key={cur.key} u={cur} bulk={bulk} labels={labels} go={go} /> : <p className="note">No items.</p>}
        </div>
      </div>
      <p className="note">{la} = left · {lb} = right.</p>
    </div>
  );
}

const SECTION = { config: "Configuration", input: "Request (input)", output: "Response (output)", customCode: "Custom code", meta: "Object meta", fields: "Fields", relationships: "Relationships", policyConfig: "Policy", identityMeta: "Identity meta", intSvcs: "Integration services", objectSvcs: "Object services", orchSvcs: "Orchestration services", workflowSvcs: "Workflow services", identity: "Identity services" };
function sectionOf(path) {
  if (path.startsWith("@") || !/[.@[]/.test(path)) return "Settings";
  const segs = path.split(/\.|(?=@)|(?=\[)/);
  const f = segs[0];
  if (f === "config" && /^entitymetadata/.test(segs[1] || "")) return "DB entity metadata";
  if (f === "config" && /^step \d/.test(segs[1] || "")) return "Orchestration steps";
  if (f === "operationConfig") {
    const s = segs[1] || "";
    if (/^(iMapping|oMapping)/.test(s)) return "Request / response mapping";
    if (/^backendMeta/.test(s)) return "Backend";
    return "Operation";
  }
  return SECTION[f] || f;
}

const longVal = (v) => v != null && (v.length > 140 || v.includes("\n"));
function pretty(v) {
  if (v == null) return null;
  const t = v.trim();
  if (t.startsWith("<")) { const x = parseXml(t); if (x) return prettyXml(x); }
  if (t.startsWith("{") || t.startsWith("[")) { try { return JSON.stringify(JSON.parse(t), null, 2); } catch { /* text */ } }
  if (/function|var |\bif\s*\(|;\s*$/m.test(t)) return fmt(t);
  return v;
}

function UnitView({ u, bulk, labels, go }) {
  const [la, lb] = labels;
  const [tab, setTab] = useState("changes");
  const [cats, setCats] = useState(new Set(["logic", "environment"]));
  const [detail, setDetail] = useState(null);
  const [open, setOpen] = useState(null);
  useEffect(() => {
    let alive = true;
    unitDetail(u).then((d) => alive && setDetail(d)).catch((e) => alive && setDetail({ error: String(e.message || e) }));
    return () => { alive = false; };
  }, [u]);
  const one = u.status === "onlyA" || u.status === "onlyB";
  const changes = u.changes.filter((c) => cats.has(c.cat));
  const uses = bulk.uses[u.key] || [];
  const usedBy = bulk.usedBy[u.key] || [];
  const unitOfKey = (k) => bulk.units.find((x) => x.key === k);
  const toggle = (c) => setCats((s) => { const n = new Set(s); if (n.has(c)) n.delete(c); else n.add(c); return n; });

  // normalised "property = value" text per side, for the side-by-side tab
  const normText = (props) => {
    if (!props) return null;
    const lines = [];
    for (const [p, v] of props) {
      if (!cats.has(categoryOf(u, p))) continue;
      const mv = mask(p, v);
      if (longVal(mv)) { lines.push(`${p} =`); for (const l of (pretty(mv) || "").split("\n")) lines.push("    " + l); } else lines.push(`${p} = ${mv}`);
    }
    return lines.join("\n");
  };

  let body = null;
  if (tab === "changes") {
    if (one) body = <p className="note">This {KIND_LABEL[u.kind]?.toLowerCase() || "item"} exists only in {u.present[0] ? la : lb}. See the side-by-side or raw file tabs for its full content.</p>;
    else if (!changes.length) body = <p className="note">No {[...cats].map((c) => CAT_LABEL[c].toLowerCase()).join(" / ")} differences.{u.counts.format ? ` (${u.counts.format} export-format differences hidden.)` : ""}</p>;
    else {
      const secs = changes.map((c) => sectionOf(c.path));
      body = (
        <table className="ptable">
          <thead><tr><th>Property</th><th>{la}</th><th>{lb}</th><th></th></tr></thead>
          <tbody>
            {changes.map((c, i) => {
              const sec = secs[i];
              const a = mask(c.path, c.a), b = mask(c.path, c.b);
              const isLong = longVal(a) || longVal(b);
              const rows = [];
              if (i === 0 || secs[i - 1] !== sec) rows.push(<tr key={"s" + i} className="psec"><td colSpan={4}>{sec}</td></tr>);
              rows.push(
                <tr key={i} className={"pop-" + c.op}>
                  <td className="mono ppath">{c.path}</td>
                  <td className={"mono pval" + (c.a !== undefined ? " old" : "")}>{c.a === undefined ? <span className="tag">(absent)</span> : isLong ? <span className="tag">{a.length} chars</span> : a}</td>
                  <td className={"mono pval" + (c.b !== undefined ? " new" : "")}>{c.b === undefined ? <span className="tag">(absent)</span> : isLong ? <span className="tag">{b.length} chars</span> : b}</td>
                  <td>
                    {c.cat !== "logic" && <span className={"catb cat-" + c.cat}>{CAT_LABEL[c.cat]}</span>}
                    {isLong && <button className="btn ghost tiny" onClick={() => setOpen(open === i ? null : i)}>{open === i ? "hide" : "diff"}</button>}
                  </td>
                </tr>,
              );
              if (isLong && open === i) {
                rows.push(
                  <tr key={"d" + i}><td colSpan={4}>
                    <DiffPane sections={[{ id: "v", d: diffTexts(pretty(a), pretty(b)) }]} la={la} lb={lb} pathA={c.path} pathB={c.path} />
                  </td></tr>,
                );
              }
              return rows;
            })}
          </tbody>
        </table>
      );
    }
  } else if (!detail) body = <p className="note">Reading files…</p>;
  else if (detail.error) body = <p className="note">Could not read: {detail.error}</p>;
  else if (tab === "side") {
    body = <DiffPane sections={[{ id: "n", d: diffTexts(normText(detail.props[0]), normText(detail.props[1])) }]} la={la} lb={lb} pathA={u.present[0] ? "normalised properties" : null} pathB={u.present[1] ? "normalised properties" : null} />;
  } else {
    const names = [...new Set([...Object.keys(detail.texts[0] || {}), ...Object.keys(detail.texts[1] || {})])];
    const relOf = (i, n) => (u.files[i] && u.files[i][n] ? u.files[i][n].rel : null);
    const sections = names.map((n) => {
      const a = detail.texts[0] && detail.texts[0][n] != null ? maskText(detail.texts[0][n].replace(/\r\n?/g, "\n")) : null;
      const b = detail.texts[1] && detail.texts[1][n] != null ? maskText(detail.texts[1][n].replace(/\r\n?/g, "\n")) : null;
      return { id: n, title: names.length > 1 ? n : undefined, status: a == null ? "onlyB" : b == null ? "onlyA" : a === b ? "same" : "changed", d: diffTexts(a, b) };
    });
    body = <DiffPane sections={sections} la={la} lb={lb} pathA={names.length === 1 ? relOf(0, names[0]) : u.present[0] ? `${u.type}/${u.svc}` : null} pathB={names.length === 1 ? relOf(1, names[0]) : u.present[1] ? `${u.type}/${u.svc}` : null} />;
  }

  return (
    <div>
      <div className="ovhead">
        <div className="ovtitle">{u.id}</div>
        <span className={"stbadge st-" + u.status}>{stLabel(u.status, labels)}</span>
        <span className="tag">{KIND_LABEL[u.kind] || u.kind}{u.subtype ? ` · ${u.subtype}` : ""}</span>
        {!one && <span className="note">{u.counts.logic} logic · {u.counts.environment} environment · {u.counts.format} export-format differences</span>}
      </div>
      {u.error && <p className="note">Could not compare: {u.error}</p>}

      {(uses.length > 0 || usedBy.length > 0) && (
        <div className="refbox">
          {uses.length > 0 && (
            <div><b>Calls:</b>{" "}
              {[...new Map(uses.map((x) => [`${x.svc}.${x.op}`, x])).values()].map((x) => {
                const t = x.target && unitOfKey(x.target);
                const sides = [...new Set(uses.filter((y) => y.svc === x.svc && y.op === x.op).map((y) => labels[y.side]))].join(" & ");
                return (
                  <span key={x.svc + x.op} className={"refchip" + (t ? " link" : "")} onClick={() => t && go(t.key)} title={`referenced in ${sides}`}>
                    {x.svc}.{x.op} {t && <span className={"stdot fst-" + t.status} />} <span className="tag">{sides}</span>
                  </span>
                );
              })}
            </div>
          )}
          {usedBy.length > 0 && (
            <div><b>Used by:</b>{" "}
              {[...new Map(usedBy.map((x) => [x.from, x])).values()].map((x) => {
                const t = unitOfKey(x.from);
                return t ? (
                  <span key={x.from} className="refchip link" onClick={() => go(t.key)}>{t.type === "Object" ? "◫" : "⛓"} {t.svc}.{t.id} <span className={"stdot fst-" + t.status} /></span>
                ) : null;
              })}
            </div>
          )}
        </div>
      )}

      <div className="fbar">
        <div className="seg">
          {[["changes", "Changes"], ["side", "Side by side (normalised)"], ["raw", "Raw files"]].map(([k, t]) => (
            <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{t}</button>
          ))}
        </div>
        {tab !== "raw" && CATS.map((c) => (
          <span key={c} className={"chip" + (cats.has(c) ? " on" : "")} onClick={() => toggle(c)}>{cats.has(c) ? "✓ " : ""}{CAT_LABEL[c]}{!one ? ` (${u.counts[c]})` : ""}</span>
        ))}
        {tab === "raw" && <span className="note">Files exactly as exported; secret values masked.</span>}
      </div>
      {body}
    </div>
  );
}
