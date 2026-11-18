// FormForge with three versions (R21 · KBZ · R26): every form's retrofit — where it lives in R26 (the micro-app map's
// match, how sure it is, change it by hand), triage and kind of customisation, widget tree / controller / actions
// compared, each version drawn (Visual), and KBZ's widget changes moved onto the R26 form (Move to R26), with conflict
// rules that apply to every form. Same building blocks as COMP-are.
import { useState, useMemo, useEffect } from "react";
import { FormTree } from "./Forms";
import { OverallView } from "./Overall";
import { ItemVisual } from "./SegmentVisual";
import { SegmentMerge, formSource } from "./SegmentMerge";
import { ExcludeBar, adjust, keyName } from "./ExcludeBar";
import { kindOf, mergeCounts, readWidgetJson } from "../lib/components";
import { formTriageOf, ruledCount, FORM_TRIAGE, formCodeModels, formRefs, formName } from "../lib/formretro";
import { versionIndex } from "../lib/visual";
import { useMore, MoreRows } from "../app/More";
import "./segments.css";

const TABS = [["visual", "Visual"], ["structure", "Structure"], ["controller", "Controller"], ["actions", "Actions"], ["files", "Files (side by side)"]];
const STATUSES = ["customised", "new", "removed", "absent", "unchanged"];
const EXCL_KEY = "rs.formExclude";
const pct = (x) => `${Math.round(x * 100)}%`;
const CONF = {
  proven: ["Proven", "the R26 form has this form's name and its root widget kuid (or only the kuid: renamed in R26)"],
  check: ["Check", "name and root kuid point to different R26 forms — the one sharing more widgets was chosen"],
  likely: ["Likely", "same name, no kuid match, at least 30% of the widgets shared"],
  weak: ["Weak", "same name, under 30% of the widgets shared — check it"],
  suggested: ["Suggested", "no name or kuid match; an R26 form shares ≥ 60% of the widgets — link it if it is the same"],
  "set by you": ["Set by you", "linked by hand (Change the R26 form)"],
  none: ["None", "no R26 form found"],
};
const TRI = Object.fromEntries(FORM_TRIAGE.map(([id, t, sub]) => [id, { t, sub }]));
function ConfPill({ x }) {
  const c = x && x.confidence;
  if (!c || !CONF[c]) return null;
  return <span className={"cp-conf c-" + c.replace(/ /g, "")} title={CONF[c][1] + (x.method ? ` · ${x.method}` : "")}>{CONF[c][0]}</span>;
}
const statusLabel = (st, labels) => ({ customised: "Customised", new: `New in ${labels[1]}`, removed: `Removed in ${labels[1]}`, absent: `Only in ${labels[2] || "new base"}`, unchanged: "Unchanged" })[st];
function structText(s) {
  if (!s) return <span className="tag">—</span>;
  const parts = [];
  if (s.added) parts.push(<b key="a" className="a">+{s.added}</b>);
  if (s.removed) parts.push(<b key="r" className="r">−{s.removed}</b>);
  if (s.moved) parts.push(<b key="m" style={{ color: "var(--mov-mark)" }}>↔{s.moved}</b>);
  if (s.reordered) parts.push(<b key="o" style={{ color: "var(--mov-mark)" }} title="containers whose children changed order">⇅{s.reordered}</b>);
  if (s.propWidgets) parts.push(<b key="c" className="c">~{s.propWidgets}</b>);
  return parts.length ? parts.reduce((acc, x, i) => (i ? [...acc, " ", x] : [x]), []) : <span className="tag">—</span>;
}

// item / setItem: the opened form (page address); report: Map(form key -> micro-app map row) or null (monolith R26);
// relink(key, link) or null; rules / setRules: conflict rules for every form
export function FormsRetroView(props) {
  const { analyzing, item, labels } = props;
  const [excl, setExcl] = useState(() => { try { return new Set(JSON.parse(localStorage.getItem(EXCL_KEY) || "[]")); } catch { return new Set(); } });
  useEffect(() => { try { localStorage.setItem(EXCL_KEY, JSON.stringify([...excl])); } catch { /* per-viewer convenience only */ } }, [excl]);
  const bulk = useMemo(() => (props.bulk && excl.size ? { results: props.bulk.results.map((r) => adjust(r, excl)) } : props.bulk), [props.bulk, excl]);
  const all = { ...props, bulk, raw: props.bulk ? props.bulk.results : [], excl, setExcl };
  const open = item && bulk ? bulk.results.find((r) => r.key === item) : null;
  if (open) return <FormDetail {...all} r={open} />;
  return (
    <div>
      <h2 className="page">FormForge · Forms retrofit</h2>
      <div className="crumb">Every form across {labels.join(" · ")} — widget tree, controller and actions, where it lives in {labels[2]}, and KBZ's widget changes moved onto the {labels[2]} form</div>
      {analyzing && analyzing.running ? (
        <div style={{ maxWidth: 520 }}>
          <p className="note">Reading &amp; comparing forms… {analyzing.done}/{analyzing.total}</p>
          <div className="progress"><div style={{ width: (analyzing.total ? (analyzing.done / analyzing.total) * 100 : 0) + "%" }} /></div>
        </div>
      ) : bulk ? <FormDashboard {...all} /> : <p className="note">Preparing…</p>}
    </div>
  );
}

function FormDashboard({ bulk, raw, excl, setExcl, labels, setItem, report, rules, setRules }) {
  const [O, C, N] = labels;
  const R = bulk.results;
  const [q, setQ] = useState("");
  const [show, setShow] = useState(new Set(["customised", "new", "removed"]));
  const [sort, setSort] = useState(["total", -1]);
  const [loc, setLoc] = useState(null); // confidence / renamed filter
  const [tq, setTq] = useState(null); // triage group picked
  const where = (r) => (report ? report.get(r.key) : null);
  const triage = useMemo(() => new Map(R.map((r) => [r.key, formTriageOf(r, labels, excl, rules)])), [R, labels, excl, rules]);
  const open = (r) => { const m = mergeCounts(r, excl); return Math.max(0, m.conflict - ruledCount(r, rules)); };

  const agg = useMemo(() => {
    const a = { per: {}, st: {}, total: 0, conflicts: 0, tri: {}, conf: {}, renamed: 0, mgConf: 0, mgOpen: 0, mgClean: 0 };
    for (const l of labels) a.per[l] = 0;
    for (const r of R) {
      for (const l of labels) if (r.present[l]) a.per[l]++;
      a.st[r.status] = (a.st[r.status] || 0) + 1;
      a.total += r.total; a.conflicts += r.conflicts;
      const t = triage.get(r.key); a.tri[t] = (a.tri[t] || 0) + 1;
      const m = mergeCounts(r, excl); a.mgConf += m.conflict; a.mgClean += m.clean; a.mgOpen += open(r);
      const x = where(r);
      if (x) { if (x.confidence) a.conf[x.confidence] = (a.conf[x.confidence] || 0) + 1; if (x.target && formName(x.target.key) !== r.name) a.renamed++; }
    }
    return a;
  }, [R, labels, triage, excl, rules, report]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const keep = (r) => {
      const x = where(r);
      if (loc === "renamed" && !(x && x.target && formName(x.target.key) !== r.name)) return false;
      if (loc && loc.startsWith("conf:") && !(x && x.confidence === loc.slice(5))) return false;
      return !ql || (r.key + " " + (x && x.target ? x.target.app + " " + x.target.key : "")).toLowerCase().includes(ql);
    };
    const out = R.filter((r) => (tq ? triage.get(r.key) === tq : show.has(r.status) && !r.tablet) && keep(r));
    const [k, dir] = sort;
    const val = (r) => (k === "name" ? r.name.toLowerCase() : k === "total" ? r.total : k === "conflicts" ? r.conflicts : k === "merge" ? open(r) : k === "triage" ? FORM_TRIAGE.findIndex(([id]) => id === triage.get(r.key)) : r.changes[k]);
    out.sort((x, y) => { const a = val(x), b = val(y); return (a < b ? -1 : a > b ? 1 : 0) * dir || x.name.localeCompare(y.name); });
    return out;
  }, [R, q, show, sort, loc, report, tq, triage, rules, excl]); // eslint-disable-line react-hooks/exhaustive-deps
  const page = useMore(rows);
  const toggle = (st) => setShow((s) => { const n = new Set(s); if (n.has(st)) n.delete(st); else n.add(st); return n; });
  const th = (k, t, title) => (
    <th key={k} className="sortable" title={title} onClick={() => setSort(([sk, d]) => [k, sk === k ? -d : k === "name" ? 1 : -1])}>{t}{sort[0] === k ? (sort[1] < 0 ? " ▼" : " ▲") : ""}</th>
  );

  const exportCsv = () => {
    const out = [["form", "module", "status", "triage", "kind of customisation", `structure ${O}→${C}`, "controller changes", "actions changes", "code conflicts", `move to ${N || "new"}: clean`, "conflicts", "conflicts left after rules", `${N || "new"} form`, `${N || "new"} link`, "how matched"]];
    for (const r of R) {
      const s = r.structure["01"], x = where(r), m = mergeCounts(r, excl);
      out.push([r.name, r.module, r.status, TRI[triage.get(r.key)].t, kindOf(r, excl) || "", s ? `+${s.added} -${s.removed} moved ${s.moved} props ${s.propWidgets} reordered ${s.reordered || 0}` : "", r.changes.controller, r.changes.actions, r.conflicts,
        r.merge ? m.clean : "", r.merge ? m.conflict : "", r.merge ? open(r) : "", x && x.target ? `${x.target.app}/forms/${x.target.key}` : "", x && x.confidence ? CONF[x.confidence][0] : "", x ? x.method : ""]);
    }
    const csv = out.map((row) => row.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "forms_retrofit.csv"; a.click();
  };

  return (
    <div>
      <div className="cards">
        {labels.map((l) => <div className="card" key={l}><div className="n">{agg.per[l]}</div><div className="l">{l} forms</div></div>)}
        <div className="card"><div className="n">{agg.st.customised || 0}</div><div className="l">customised ({C}≠{O})</div></div>
        <div className="card"><div className="n" style={{ color: "var(--add-mark)" }}>{agg.st.new || 0}</div><div className="l">only in {C}</div></div>
        {N && <div className="card"><div className="n">{agg.st.absent || 0}</div><div className="l">only in {N}</div></div>}
        <div className="card"><div className="n">{agg.total}</div><div className="l">{C} vs {O} changes</div></div>
        {N && <div className="card"><div className="n" style={{ color: "var(--chg-mark)" }}>{agg.mgOpen}</div><div className="l">widget conflicts to decide{rules && rules.length ? ` (of ${agg.mgConf}; rest by your rules)` : ""}</div></div>}
        {N && <div className="card"><div className="n">{agg.conflicts}</div><div className="l">code conflicts (controller / actions)</div></div>}
      </div>

      <div className="cp-triage">
        <div className="cp-th">Triage <span className="tag">what each form needs{N ? `, judged against the ${N} form compared` : ""} — click one to list only those</span>
          {tq && <button className="btn ghost tiny" onClick={() => setTq(null)}>show all</button>}</div>
        <div className="cp-tqs">
          {FORM_TRIAGE.filter(([id]) => agg.tri[id]).map(([id, t, sub]) => (
            <button key={id} className={"cp-tq t-" + id + (tq === id ? " on" : "")} onClick={() => setTq((v) => (v === id ? null : id))} title={sub}>
              <b>{agg.tri[id]}</b><span>{t}</span><i>{sub}</i>
            </button>
          ))}
        </div>
      </div>

      {N && setRules && (
        <div className="fr-rules">
          <b>Conflict rules for every form</b>
          {!rules || !rules.length ? <span className="tag">none yet — set them in a form's “Move {C} changes to {N}” window (“every form: keep / take”). A rule decides that kind of conflict on every form you open.</span>
            : <>
              {rules.map((x) => <span key={x.by + x.k} className="fr-rule">{x.by === "bp" ? `responsiveData › ${x.k}` : keyName(x.k) || x.k} → {x.choice === "kbz" ? `take ${C}` : `keep ${N}`}<button title="remove this rule" onClick={() => setRules((rs) => rs.filter((y) => y !== x))}>✕</button></span>)}
              <span className="tag">· {R.reduce((n, r) => n + ruledCount(r, rules), 0)} conflicts decided by them · a later rule wins where two apply</span>
              <button className="btn ghost tiny" onClick={() => setRules([])}>clear all</button>
            </>}
        </div>
      )}

      <ExcludeBar raw={raw} excl={excl} setExcl={setExcl} labels={labels} noun="form" />
      <div className="searchbar">
        <input type="text" placeholder="Search forms, modules or micro apps…" value={q} onChange={(e) => setQ(e.target.value)} />
        {tq ? <span className="tag">Triage: <b>{TRI[tq].t}</b> ({agg.tri[tq] || 0}) — the status chips are off while a triage group is picked</span> : STATUSES.filter((st) => st !== "absent" || N).map((st) => (
          <span key={st} className={"chip" + (show.has(st) ? " on" : "")} onClick={() => toggle(st)}>{show.has(st) ? "✓ " : ""}{statusLabel(st, labels)} ({agg.st[st] || 0})</span>
        ))}
        <span className="spacer" />
        <button className="btn ghost" onClick={exportCsv}>Export CSV</button>
      </div>
      {N && report && (
        <div className="sg-locbar">
          <span className="tag">{N} link:</span>
          {Object.keys(CONF).filter((c) => agg.conf[c]).map((c) => (
            <span key={c} className={"chip" + (loc === "conf:" + c ? " on" : "")} title={CONF[c][1]} onClick={() => setLoc((v) => (v === "conf:" + c ? null : "conf:" + c))}>{loc === "conf:" + c ? "✓ " : ""}{CONF[c][0]} ({agg.conf[c]})</span>
          ))}
          <span className={"chip" + (loc === "renamed" ? " on" : "")} onClick={() => setLoc((v) => (v === "renamed" ? null : "renamed"))}>{loc === "renamed" ? "✓ " : ""}Other name in {N} ({agg.renamed})</span>
        </div>
      )}

      <table>
        <thead>
          <tr>
            {th("name", "Form")}
            {labels.map((l) => <th key={l} style={{ textAlign: "center" }}>{l}</th>)}
            <th>Status</th>
            {th("triage", "Triage")}
            {th("structure", `Widgets ${O}→${C}`)}
            {th("controller", "Controller")}
            {th("actions", "Actions")}
            {N && th("conflicts", "Code conflicts")}
            {N && th("merge", `Move to ${N}`, "changes that move cleanly · widget conflicts still to decide (after your rules)")}
            {th("total", "Total")}
          </tr>
        </thead>
        <tbody>
          {page.shown.map((r) => {
            const x = where(r), m = r.merge ? mergeCounts(r, excl) : null, o = r.merge ? open(r) : 0, t = triage.get(r.key);
            return (
              <tr key={r.key} className="clickable" onClick={() => setItem(r.key)} style={{ cursor: "pointer" }}>
                <td><b>{r.name}</b><div className="tag">{r.module}</div></td>
                {labels.map((l, li) => (
                  <td key={l} style={{ textAlign: "center" }}>
                    {r.present[l] ? <span className="a">✓</span> : <span className="tag">—</span>}
                    {li === 2 && x && x.target && <div className="sg-app">{x.target.app}{formName(x.target.key) !== r.name ? <span className="sg-ren" title={x.target.key}> as {formName(x.target.key)}</span> : null}</div>}
                    {li === 2 && x && (x.target || x.confidence === "suggested") && <div><ConfPill x={x} /></div>}
                  </td>
                ))}
                <td><span className={"cstat cs-" + r.status}>{statusLabel(r.status, labels)}</span>{r.statusBefore === "customised" && r.status === "unchanged" && <span className="tag" title="its only changes are in excluded parameters"> · only excluded changes</span>}{x && x.status === "ambiguous" && <span className="pill b2" style={{ marginLeft: 4 }} title={x.method}>check form</span>}</td>
                <td><span className={"cp-tri t-" + t} title={TRI[t].sub}>{TRI[t].t}</span>{kindOf(r, excl) && <div className="tag">{kindOf(r, excl)}</div>}</td>
                <td>{structText(r.structure["01"])}</td>
                <td style={{ textAlign: "center" }}>{r.errors.controller ? <span className="pill Removed" title={r.errors.controller}>error</span> : r.changes.controller ? <b>{r.changes.controller}</b> : <span className="tag">—</span>}</td>
                <td style={{ textAlign: "center" }}>{r.errors.actions ? <span className="pill Removed" title={r.errors.actions}>error</span> : r.changes.actions ? <b>{r.changes.actions}</b> : <span className="tag">—</span>}</td>
                {N && <td style={{ textAlign: "center" }}>{r.conflicts ? <span className="pill b2">{r.conflicts}</span> : <span className="tag">—</span>}</td>}
                {N && <td className="fr-mg">{m ? <><span className="k">{m.clean} clean</span>{m.conflict ? <> · <span className={o ? "o" : ""}>{o ? `${o} to decide` : "all ruled"}</span></> : null}</> : <span className="tag">—</span>}</td>}
                <td style={{ textAlign: "center" }}><b>{r.total || ""}</b></td>
              </tr>
            );
          })}
          <MoreRows {...page} shown={page.shown.length} cols={20} />
          {!rows.length && <tr><td colSpan={20} className="note">No forms match the filters.</td></tr>}
        </tbody>
      </table>
      <p className="tag" style={{ marginTop: 6 }}>Tablet and watch forms are left out of the list (the micro apps carry none) — they are counted under the “Tablet / watch” triage group.</p>
    </div>
  );
}

function FormDetail({ r, picked, labels, setItem, renderReport, overall, setOverall, report, excl, relink, rules, setRules }) {
  const [O, C, N] = labels;
  const [tab, setTab] = useState("visual");
  const [pairIdx, setPairIdx] = useState(0);
  const [merging, setMerging] = useState(false);
  const [picking, setPicking] = useState(false);
  const [code, setCode] = useState(null); // { controller, actions, errors } built when a code tab is opened
  const x = report ? report.get(r.key) : null;
  const appOf = (i) => (picked[i] && picked[i].formApp ? picked[i].formApp.get(r.key) || "" : "");
  const r26Name = x && x.target ? formName(x.target.key) : r.name;
  const pathOf = (i) => (i === 2 && x && x.target ? `${x.target.app}/forms/${x.target.key}` : `${appOf(i) ? appOf(i) + "/" : ""}forms/${r.key.includes("·") ? r.key.replace(/^([^/]+)\/[^·]*·/, "$1/") : r.key}`);
  const linkTag = x && x.target ? `${x.target.app}/${x.target.key}` : "";
  const adapter = useMemo(() => ({
    noun: "form", render: "form",
    copyOf: (i) => (r.present[labels[i]] ? { app: appOf(i), name: i === 2 ? r26Name : r.name } : null),
    filesOf: (i) => (picked[i] && picked[i].forms ? picked[i].forms.get(r.key) : null),
    indexOf: (i) => versionIndex(picked[i], appOf(i), r.channel),
    refs: (i, id) => formRefs(picked[i], r.key, id),
    usesOf: () => null,
    usageReady: true,
  }), [r, picked, labels, x]); // eslint-disable-line react-hooks/exhaustive-deps
  const mergeSource = useMemo(() => (N && picked[2] ? formSource(r, picked, x) : null), [N, r, picked, x]);
  const canMerge = !!(mergeSource && r.present[O] && r.present[C] && r.present[N] && mergeSource.baseFiles && mergeSource.kbzFiles && mergeSource.copies.length);
  const doRelink = (link) => { setPicking(false); relink(r.key, link); };
  useEffect(() => { setCode(null); }, [r.key, linkTag]);
  useEffect(() => {
    if ((tab !== "controller" && tab !== "actions") || code) return undefined;
    let alive = true;
    (async () => {
      const W = [];
      for (let i = 0; i < labels.length; i++) { const m = picked[i] && picked[i].forms ? picked[i].forms.get(r.key) : null; W.push(m ? await readWidgetJson(m) : null); }
      const res = await formCodeModels(picked, labels, r.key, W);
      if (alive) setCode(res);
    })();
    return () => { alive = false; };
  }, [tab, code, r.key, picked, labels]);
  const t = formTriageOf(r, labels, excl, rules), k = kindOf(r, excl), m = mergeCounts(r, excl), ruled = ruledCount(r, rules);
  const count = (id) => (id === "structure" ? r.changes.structure : id === "controller" ? r.changes.controller : id === "actions" ? r.changes.actions : null);
  const model = code && (tab === "controller" ? code.controller : tab === "actions" ? code.actions : null);

  return (
    <div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
        <button className="btn ghost" onClick={() => setItem(null)}>← All forms</button>
        {canMerge && <button className="btn" style={{ marginLeft: "auto" }} onClick={() => setMerging(true)} title={`Choose ${C}'s widget changes to carry onto the ${N} form and write the merged form folder`}>⇢ Move {C} changes to {N}</button>}
      </div>
      {merging && <SegmentMerge source={mergeSource} picked={picked} labels={labels} onClose={() => setMerging(false)} rules={rules} setRules={setRules} />}
      {excl && excl.size > 0 && <div className="sx-note">Not counted as a change here: <b>{[...excl].map(keyName).join(", ")}</b> — set with “Exclude parameters” on the form list.</div>}
      <h2 className="page">
        {r.name} <span className={"cstat cs-" + r.status} style={{ fontSize: 13, verticalAlign: "middle" }}>{statusLabel(r.status, labels)}</span>
        <span className="cp-head">
          <span className={"cp-tri t-" + t} title={TRI[t].sub}>{TRI[t].t}</span>
          {k && <span className="tag">{k}</span>}
          {r.merge && <span className="tag" title={`rows the Move to ${N} window starts with, against the ${N} form compared`}>· {m.clean} clean · {m.conflict} conflicts{ruled ? ` (${ruled} decided by your rules)` : ""} · {m.removal} removals · {m.already} already in {N}{m.design ? ` · ${m.design} design-time kept as ${N}` : ""}</span>}
        </span>
      </h2>
      <div className="crumb">
        {r.module} · {labels.map((l) => <span key={l} style={{ marginRight: 10 }}>{l}: {r.present[l] ? <b className="a">present</b> : <b className="r">absent</b>}{r.widgetCounts && r.present[l] ? ` (${r.widgetCounts[l]} widgets)` : ""}</span>)}
      </div>

      <div className="sg-where">
        <div className="sg-h">Where it lives</div>
        <table className="sg-loc">
          <thead><tr><th>Version</th><th>Form folder</th><th>Widgets</th><th>Controller</th></tr></thead>
          <tbody>
            {labels.map((l, i) => (
              <tr key={l}>
                <td><b>{l}</b></td>
                <td>{r.present[l] ? <><span className="mono">{pathOf(i)}</span>{appOf(i) && <span className="sg-apptag">{appOf(i)}</span>}</> : <span className="tag">not in {l}</span>}</td>
                <td>{r.present[l] && r.widgetCounts ? r.widgetCounts[l] : ""}</td>
                <td>{r.present[l] ? (picked[i] && picked[i].controllers && picked[i].controllers.get(ctrlKey(r.key)) ? <span className="mono tag">{i === 2 && x && x.target ? `${r26Name}Controller.js` : `${r.name}Controller.js`}</span> : <span className="tag">none found</span>) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {N && x && (
          <div className="sg-match">
            <div><span className="tag">{N} form compared:</span> {x.target ? <b>{x.target.app}/{x.target.key}</b> : <span className="r">none</span>} <ConfPill x={x} /> <span className="tag">· {x.method}</span>
              {x.status === "ambiguous" && <span className="pill b2" style={{ marginLeft: 6 }}>two {N} forms are about as close — check which one you need</span>}
              {relink && <span className="cp-linkbtns">
                <button className="btn ghost tiny" onClick={() => setPicking((v) => !v)}>{picking ? "Close" : `Change the ${N} form…`}</button>
                {x.manual && <button className="btn ghost tiny" onClick={() => doRelink(null)} title={`automatic: ${x.auto && x.auto.method}`}>Back to automatic</button>}
              </span>}
            </div>
            {x.confidence === "check" && <p className="note">⚠ The form with the same name and the form with the same root widget id (kuid) are different {N} forms. The one sharing more widgets is compared; open the other with “Compare this one” if that is the real counterpart.</p>}
            {x.linkMissing && <p className="note">Your link to {x.linkMissing.app}/{x.linkMissing.key} was not found in this {N} folder — the automatic match is shown.</p>}
            {!x.target && x.suggestions && x.suggestions.length > 0 && (
              <div className="cp-sugg"><span className="tag">Suggested (shares widgets, no name or kuid match — nothing is compared until you link one):</span>
                {x.suggestions.map((c) => <span key={c.app + c.key} className="sg-copy">{c.name} <span className="tag">{c.app}</span><b>{pct(c.score)}</b>{relink && <button className="btn ghost tiny" onClick={() => doRelink({ app: c.app, key: c.key })}>Link</button>}</span>)}
              </div>
            )}
            {x.target && x.copies && x.copies.length > 1 && (
              <div className="cp-copies">
                <table className="sg-loc">
                  <thead><tr><th>{N} candidates</th><th>Widgets shared</th><th /></tr></thead>
                  <tbody>
                    {x.copies.map((c, i) => (
                      <tr key={c.app + c.key} className={i === 0 ? "cp-cur" : ""}>
                        <td><span className="sg-apptag">{c.app}</span> <span className="mono">{c.key}</span>{c.kuid && x.kuid && c.kuid === x.kuid && <span className="tag"> · same kuid</span>}{c.name === r.name && <span className="tag"> · same name</span>}</td>
                        <td>{c.score != null ? pct(c.score) : ""}</td>
                        <td>{i === 0 ? <span className="mg-best">compared</span> : relink && <button className="btn ghost tiny" onClick={() => doRelink({ app: c.app, key: c.key })}>Compare this one</button>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {picking && <FormLinkPicker r={r} x={x} picked={picked} N={N} onPick={doRelink} />}
          </div>
        )}
      </div>

      <div className="aspecttabs">
        {TABS.map(([id, label]) => {
          const n = count(id);
          return (
            <button key={id} className={"aspecttab" + (id === tab ? " on" : "")} onClick={() => setTab(id)}>
              <span className={"aspdot as-" + (id === "visual" || id === "files" ? id : id === "structure" ? "structure" : id)} /> {label}
              {n != null && <span className={"acount" + (n ? " nz" : "")}>{n}</span>}
              {r.errors[id] && <span className="pill Removed" style={{ marginLeft: 6 }}>error</span>}
            </button>
          );
        })}
      </div>
      <p className="note">Counts are {C} vs {O} changes (the customisation). Each tab also shows how {N || "the new base"} compares.</p>

      {tab === "visual" && <ItemVisual key={"visual:" + r.key + linkTag} adapter={adapter} r={r} labels={labels} excludeKeys={excl} />}
      {tab === "structure" && (r.errors.structure ? <p className="note">Could not read the widget tree: {r.errors.structure}</p>
        : <FormTree key={r.key + linkTag} formKey={r.key} picked={picked} labels={labels} pairIdx={pairIdx} setPairIdx={setPairIdx} previewKind="form" excludeKeys={excl} embedded />)}
      {tab === "files" && <OverallView key={r.key + linkTag} cat="forms" picked={picked} labels={labels} cache={overall} setCache={setOverall} focus={r.key} />}
      {(tab === "controller" || tab === "actions") && (
        !code ? <p className="note">Reading the {tab === "controller" ? "controllers" : "actions"}…</p>
          : code.errors[tab] ? <p className="note">Could not analyse: {code.errors[tab]}</p>
            : !model ? <p className="note">No {tab === "controller" ? `${r.name}Controller.js` : "actions"} in any version.</p>
              : (
                <>
                  {tab === "controller" && <p className="note">The form's controller, compared function by function (same as CtrlSync). Moving code is not part of Move to {N} — this shows what a developer has to carry over.</p>}
                  {tab === "actions" && <p className="note">Generated action sequences, matched by name; the label beside each is the event and widget it is defined for.</p>}
                  {tab === "actions" && model.fromJson && Object.keys(model.fromJson).length > 0 && (
                    <p className="note">
                      Read from <code>studioactions/…/AS_*.json</code> (a widget event names the action, the Actions file does not have it{model.noFile && model.noFile.length ? ` — no ControllerActions.js in ${model.noFile.join(", ")}` : ""}): {Object.entries(model.fromJson).map(([l, list]) => `${l} ${list.length}`).join(" · ")}.
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
const ctrlKey = (key) => { const s = key.split("/"); const n = s.pop().replace(/\.sm$/i, ""); return [...s, `${n}Controller`, `${n}Controller.js`].join("/"); };

// pick the R26 form by hand: every R26 form of the channel, closest widget overlap first
function FormLinkPicker({ r, x, picked, N, onPick }) {
  const [q, setQ] = useState("");
  const catalog = useMemo(() => (picked[2] && picked[2].formCatalog) || [], [picked]);
  const mine = useMemo(() => { const m = (picked[1] && picked[1].forms.get(r.key)) || (picked[0] && picked[0].forms.get(r.key)); return new Set(m ? m.keys() : []); }, [picked, r.key]);
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
        <b>Link {r.name} to an {N} form</b>
        <input type="text" autoFocus placeholder={`Search ${catalog.length} ${N} forms by name, module or micro app…`} value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn ghost tiny" onClick={() => onPick("none")} title="it has no counterpart: nothing is compared or moved">No {N} counterpart</button>
      </div>
      <div className="cp-plist">
        {shown.map(({ c, score }) => (
          <div key={c.app + c.key} className={"cp-prow" + (`${c.app}/${c.key}` === cur ? " on" : "")}>
            <span className="sg-apptag">{c.app}</span><b>{c.name}</b><span className="mono tag">{c.module}</span>
            {c.kuid && x && x.kuid === c.kuid && <span className="tag">same kuid</span>}
            <span className="cp-pscore">{pct(score)} widgets shared</span>
            {`${c.app}/${c.key}` === cur ? <span className="mg-best">compared now</span> : <button className="btn tiny" onClick={() => onPick({ app: c.app, key: c.key })}>Link</button>}
          </div>
        ))}
        {!shown.length && <p className="note">No {N} form matches.</p>}
      </div>
      <p className="note sg-foot">The link is kept in this browser for these customisation and {N} folders and this channel, and is used next time the micro-app map runs. The form (and its controller) is compared again against the one you pick.</p>
    </div>
  );
}
