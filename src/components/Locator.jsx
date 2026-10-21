// Where it lives: every action of a form as a tree — the form, its own widgets, each component instance — and for each
// action the full widget path, the file that wires it, the handler and its controller file:line, whether a user can
// reach it, run-time replacements and the first calls it makes. Per form (a tab) and across the whole project.
import { useState, useEffect, useMemo, useRef } from "react";
import { formActions } from "../lib/blueprint";
import { locateForm } from "../lib/locator";
import { widgetInfo } from "../lib/preview";
import { Code } from "./Blueprint";
import "./locator.css";

const nf = (n) => Number(n || 0).toLocaleString("en-US");
const short = (rel) => (rel || "").split("/").slice(-2).join("/");
const HOP = { pc: "Presentation", bc: "Business", ctrl: "Other form", service: "Service", nav: "Opens form", event: "Event" };
const REACH = { visible: ["●", "Visible"], shown: ["◐", "Shown by code"], hidden: ["○", "Hidden"], unknown: ["·", "—"], form: ["", ""] };

// one form's locator result, computed once per project load
export async function locate(idx, cache, formKey) {
  const k = "loc:" + formKey;
  if (cache.has(k)) return cache.get(k);
  const base = cache.get("form:" + formKey) || (await formActions(idx, formKey));
  const L = await locateForm(idx, formKey, base);
  cache.set(k, L);
  return L;
}

/* ---------------------------------------------------------------- filters shared by the form tab and the project view */
const FILTERS = [
  ["all", "All"], ["bad", "Problems"], ["warn", "Warnings"], ["hidden", "Unreachable"], ["replaced", "Replaced at run time"], ["comp", "In components"],
];
function keep(a, filter, ql) {
  if (filter === "bad" && a.problem !== "bad") return false;
  if (filter === "warn" && !a.problem) return false;
  if (filter === "hidden" && a.reach.state !== "hidden") return false;
  if (filter === "replaced" && !a.status.some((s) => /Replace/.test(s.text))) return false;
  if (filter === "comp" && !a.inst) return false;
  if (!ql) return true;
  const hay = [a.path, a.event, a.handler && a.handler.name, a.handler && a.handler.rel, ...a.wired.map((w) => w.text), ...a.hops.map((h) => h.text), a.text].join(" ").toLowerCase();
  return hay.includes(ql);
}
function counts(acts) {
  return { all: acts.length, bad: acts.filter((a) => a.problem === "bad").length, warn: acts.filter((a) => a.problem).length, hidden: acts.filter((a) => a.reach.state === "hidden").length, replaced: acts.filter((a) => a.status.some((s) => /Replace/.test(s.text))).length, comp: acts.filter((a) => a.inst).length };
}
function FilterBar({ q, setQ, filter, setFilter, n, open, extra }) {
  return (
    <div className="lc-bar">
      <div className="lc-search"><span>⌕</span><input type="text" placeholder="Find a widget, event, handler, file or call…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <div className="lc-filters">
        {FILTERS.map(([k, l]) => <button key={k} className={(filter === k ? "on " : "") + "f-" + k} onClick={() => setFilter(k)}>{l}<b>{nf(n[k])}</b></button>)}
      </div>
      {open && <div className="lc-open"><button onClick={() => open(true)}>Expand all</button><button onClick={() => open(false)}>Collapse all</button></div>}
      {extra}
    </div>
  );
}

/* ---------------------------------------------------------------- the tree for one form */
export function LocatorTree({ idx, L, info, filter, ql, openAll, openFlow, onCode, root = true }) {
  const [openActs, setOpenActs] = useState(() => new Set());
  const [closedGroups, setClosedGroups] = useState(() => new Set());
  useEffect(() => { if (openAll === true) setOpenActs(new Set(L.acts.map((a) => a.id))); if (openAll === false) setOpenActs(new Set()); }, [openAll, L]);
  const toggle = (set, setter, id) => setter((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  for (const a of L.acts) a.text = info && info.get(a.path) && info.get(a.path).text;
  const groups = L.groups.map((g) => ({ ...g, shown: g.acts.filter((a) => keep(a, filter, ql)) })).filter((g) => g.shown.length);
  const F = L.form;
  return (
    <div className="lc-tree">
      {root && (
        <div className="lc-root">
          <div className="lc-rootico">▤</div>
          <div className="lc-rootbody">
            <div className="lc-roottitle"><b className="mono">{F.name}</b><span className="lc-tag">Form</span><span className="tag">module {F.module}</span></div>
            <div className="lc-files">
              {F.folder && <button className="lc-file" onClick={() => onCode({ rel: F.rel, from: 1, to: 60, title: "Form file" })}><i>Form</i>{F.folder}</button>}
              {F.ctrl.map((r) => <button key={r} className="lc-file" onClick={() => onCode({ rel: r, from: 1, to: 80, title: r.split("/").pop() })}><i>{/Actions\.js$/.test(r) ? "Actions" : "Controller"}</i>{short(r)}</button>)}
            </div>
            <div className="lc-rootstats">
              <span>{nf(L.counts.acts)} actions</span><span>{nf(L.counts.comps)} components</span>
              {L.counts.bad > 0 && <span className="bad">✕ {L.counts.bad} problem{L.counts.bad === 1 ? "" : "s"}</span>}
              {L.counts.warn > 0 && <span className="warn">! {L.counts.warn} warning{L.counts.warn === 1 ? "" : "s"}</span>}
            </div>
          </div>
        </div>
      )}
      {!groups.length && <div className="lc-none">No action on this form matches.</div>}
      <div className="lc-branches">
        {groups.map((g, gi) => {
          const closed = closedGroups.has(g.id);
          const [rIco, rTxt] = g.reach ? REACH[g.reach.state] : ["", ""];
          return (
            <div key={g.id} className={"lc-group k-" + g.kind + (gi === groups.length - 1 ? " last" : "")} style={{ "--d": Math.min(gi, 12) * 40 + "ms" }}>
              <div className="lc-ghead" onClick={() => toggle(closedGroups, setClosedGroups, g.id)}>
                <span className={"lc-caret" + (closed ? "" : " open")}>▸</span>
                <span className="lc-gico">{g.kind === "events" ? "◉" : g.kind === "form" ? "▣" : "⧉"}</span>
                <span className="lc-gtitle">{g.kind === "component" ? <><span className="lc-tag comp">Component</span><b className="mono">{g.title}</b><span className="lc-gns">{g.ns ? g.ns : `component ${String(g.kuid || "").slice(0, 8)}… — defined in another app`}</span></> : <b>{g.title}</b>}</span>
                {g.reach && <span className={"lc-reach r-" + g.reach.state} title={g.reach.hiddenAt ? `hidden at ${g.reach.hiddenAt}` : ""}>{rIco} {rTxt}</span>}
                <span className="lc-gcount">{g.shown.length}{g.shown.length !== g.acts.length ? ` of ${g.acts.length}` : ""}</span>
              </div>
              {!closed && g.kind === "component" && (
                <div className="lc-gfiles">
                  {g.rel && <button className="lc-file" onClick={() => onCode({ rel: g.rel, from: 1, to: 60, title: "Instance file" })}><i>Instance</i>{short(g.rel)}</button>}
                  {g.files.map((r) => <button key={r} className="lc-file" onClick={() => onCode({ rel: r, from: 1, to: 80, title: r.split("/").pop() })}><i>{/Actions\.js$/.test(r) ? "Comp. actions" : "Comp. controller"}</i>{short(r)}</button>)}
                  {!g.files.length && <span className="tag">The component's own code is not in this project — only the events this form wires on it are listed.</span>}
                </div>
              )}
              {!closed && (
                <div className="lc-acts">
                  {g.shown.map((a, ai) => <ActionNode key={a.id} idx={idx} a={a} F={F} open={openActs.has(a.id)} toggle={() => toggle(openActs, setOpenActs, a.id)} last={ai === g.shown.length - 1} openFlow={openFlow} onCode={onCode} />)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ActionNode({ idx, a, F, open, toggle, last, openFlow, onCode }) {
  const bad = a.status.filter((s) => s.tone === "bad").length, warn = a.status.filter((s) => s.tone === "warn").length;
  const segs = a.inst ? [a.inst, ...(a.inner ? a.inner.split(".") : [])] : a.group === "events" ? [] : a.path.split(".");
  const openWired = async (w) => {
    if (w.how === "code") return onCode({ rel: w.rel, from: w.from, to: w.to, hl: w.line, title: `Wired in ${w.text}` });
    if (w.how !== "designer") return;
    const t = (await idx.read(w.rel)) || "";
    const i = t.split("\n").findIndex((l) => a.entry.member && l.includes(a.entry.member.name));
    onCode({ rel: w.rel, from: Math.max(1, i - 12), to: i + 14, hl: i + 1, title: `Wired in ${w.rel.split("/").pop()}` });
  };
  const h = a.handler;
  return (
    <div className={"lc-act" + (last ? " last" : "") + (open ? " open" : "") + (a.problem ? " p-" + a.problem : "")}>
      <div className="lc-ahead" onClick={toggle}>
        <span className={"lc-caret" + (open ? " open" : "")}>▸</span>
        <span className="lc-ev">{a.event}</span>
        <span className="lc-apath mono">{a.group === "events" ? F.name : a.path}</span>
        {a.text && <span className="lc-atext">“{a.text.length > 40 ? a.text.slice(0, 39) + "…" : a.text}”</span>}
        <span className="lc-aright">
          {bad > 0 && <span className="lc-pill bad">✕ {bad}</span>}
          {warn > 0 && <span className="lc-pill warn">! {warn}</span>}
          {a.reach.state === "hidden" && <span className="lc-pill mute">○ hidden</span>}
          <span className="lc-where">{h ? h.where : "no handler"}</span>
        </span>
      </div>
      {open && (
        <div className="lc-detail">
          <Row k="Widget path">
            <div className="lc-crumbs">
              <span className="lc-cr form">{F.name}</span>
              {a.group === "events" ? <span className="lc-cr">(the form itself)</span> : segs.map((s, i) => <span key={i} className={"lc-cr" + (i === 0 && a.inst ? " comp" : "")}>{s}{i === 0 && a.inst ? <i> component</i> : null}</span>)}
              <span className="lc-cr ev">{a.event}</span>
            </div>
          </Row>
          <Row k="Wired in">
            {a.wired.map((w, i) => (
              <div key={i} className="lc-wire">
                <span className={"lc-how h-" + w.how}>{w.how === "designer" ? "Designer" : w.how === "code" ? "Code" : w.how === "framework" ? "Framework" : "Nowhere"}</span>
                {w.rel ? <button className="lc-link mono" onClick={() => openWired(w)}>{w.how === "code" ? `${short(w.rel)} · ${w.text}` : w.rel}</button> : <span className="tag">{w.text || "no widget file references this action sequence"}</span>}
              </div>
            ))}
          </Row>
          <Row k="Handler">
            {h ? (
              <div className="lc-handler">
                <b className="mono">{h.name}</b>
                <span className="lc-tag">{h.where}</span>
                {h.rel ? <button className="lc-link mono" onClick={() => onCode({ rel: h.rel, from: h.line, to: h.end, hl: h.line, title: `${h.owner}.${h.name}` })}>{h.rel}:{h.line}</button> : <span className="tag mono">{h.text}</span>}
              </div>
            ) : <span className="tag">{a.cleared ? "none — the event is cleared" : "not found in the code"}</span>}
          </Row>
          <Row k="Calls next">
            <div className="lc-hops">
              {a.hops.map((x, i) => <span key={i} className={"lc-hop k-" + x.kind} title={x.via}><i>{HOP[x.kind]}</i>{x.text}{x.via ? <em>{x.via}</em> : null}</span>)}
              {a.screen > 0 && <span className="lc-hop k-screen"><i>Screen</i>{a.screen} widget update{a.screen === 1 ? "" : "s"}</span>}
              {!a.hops.length && !a.screen && <span className="tag">{a.empty ? "nothing — the handler is empty" : "nothing beyond its own class"}</span>}
            </div>
          </Row>
          <Row k="Status">
            <div className="lc-status">
              {a.status.length ? a.status.map((s, i) => <div key={i} className={"lc-st t-" + s.tone}><span>{s.tone === "bad" ? "✕" : s.tone === "warn" ? "!" : "i"}</span>{s.text}</div>) : <div className="lc-st t-ok"><span>✓</span>{a.reach.state === "visible" ? "Visible and wired — nothing to flag" : "Nothing to flag"}</div>}
            </div>
          </Row>
          <div className="lc-actions">
            {h && h.rel && <button className="lc-btn" onClick={() => onCode({ rel: h.rel, from: h.line, to: h.end, hl: h.line, title: `${h.owner}.${h.name}` })}>Show handler code</button>}
            {a.entry.member && openFlow && <button className="lc-btn main" onClick={() => openFlow(a.entry.id)}>Trace in Code flow breakdown →</button>}
          </div>
        </div>
      )}
    </div>
  );
}
const Row = ({ k, children }) => <div className="lc-row"><div className="lc-k">{k}</div><div className="lc-v">{children}</div></div>;

function CodeDrawer({ idx, sel, close }) {
  if (!sel) return null;
  return (
    <div className="bp-drawer">
      <div className="bp-drawerhead"><div className="bp-selhead">{sel.title}{sel.hl ? ` — line ${sel.hl}` : ""}</div><button className="btn ghost" onClick={close}>✕ Close</button></div>
      <Code idx={idx} rel={sel.rel} from={sel.from} to={sel.to} hl={sel.hl} />
    </div>
  );
}

/* ---------------------------------------------------------------- form tab */
export function FormLocator({ idx, f, A, cache, openFlow }) {
  const [L, setL] = useState(null);
  const [info, setInfo] = useState(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");
  const [openAll, setOpenAll] = useState(null);
  const [sel, setSel] = useState(null);
  useEffect(() => {
    let alive = true;
    setL(null);
    (async () => {
      if (!cache.has("loc:" + f.key)) cache.set("loc:" + f.key, await locateForm(idx, f.key, A));
      const m = await widgetInfo(idx, f.key);
      if (alive) { setInfo(m); setL(cache.get("loc:" + f.key)); }
    })();
    return () => { alive = false; };
  }, [idx, f, A, cache]);
  if (!L) return <p className="note">Locating every action of {f.name}: widgets, components, wiring and handlers…</p>;
  const ql = q.trim().toLowerCase();
  return (
    <div className="lc">
      <FilterBar q={q} setQ={setQ} filter={filter} setFilter={setFilter} n={counts(L.acts)} open={(o) => setOpenAll(o ? { v: true } : { v: false })} />
      <LocatorTree idx={idx} L={L} info={info} filter={filter} ql={ql} openAll={openAll && openAll.v} openFlow={openFlow} onCode={setSel} />
      <CodeDrawer idx={idx} sel={sel} close={() => setSel(null)} />
    </div>
  );
}

/* ---------------------------------------------------------------- the whole project */
export function ProjectLocator({ idx, cache, openFormTab, openFormFlow }) {
  const forms = useMemo(() => [...idx.forms.keys()].sort((a, b) => a.localeCompare(b)), [idx]);
  const [done, setDone] = useState(() => forms.filter((k) => cache.has("loc:" + k)).length);
  const [running, setRunning] = useState(true);
  const [current, setCurrent] = useState(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");
  const [mod, setMod] = useState("");
  const [openForms, setOpenForms] = useState(() => new Set());
  const [limit, setLimit] = useState(40);
  const [sel, setSel] = useState(null);
  const [infos] = useState(() => new Map());
  const [, bump] = useState(0);
  const errors = useRef([]);

  // read every form in the background; results stay in the project cache, so leaving and coming back resumes
  useEffect(() => {
    if (!running) return;
    let alive = true;
    (async () => {
      for (const k of forms) {
        if (!alive) return;
        if (cache.has("loc:" + k)) continue;
        setCurrent(k);
        try { await locate(idx, cache, k); } catch (e) { errors.current.push(`${k}: ${e.message}`); cache.set("loc:" + k, null); }
        setDone((n) => n + 1);
        await new Promise((r) => setTimeout(r));
      }
      if (alive) { setRunning(false); setCurrent(null); }
    })();
    return () => { alive = false; };
  }, [running, forms, idx, cache]);

  const all = forms.map((k) => [k, cache.get("loc:" + k)]).filter(([, L]) => L);
  const modules = [...new Set(forms.map((k) => k.split("/").slice(0, -1).join("/")))].sort();
  const ql = q.trim().toLowerCase();
  const inMod = all.filter(([k]) => !mod || k.startsWith(mod + "/"));
  const acts = inMod.flatMap(([, L]) => L.acts);
  const n = counts(acts);
  const matches = inMod.map(([k, L]) => [k, L, L.acts.filter((a) => keep(a, filter, ql))]).filter(([, , m]) => m.length);
  const narrowed = !!ql || filter !== "all";
  const toggleForm = async (k) => {
    if (!infos.has(k)) { infos.set(k, await widgetInfo(idx, k)); bump((x) => x + 1); }
    setOpenForms((s) => { const c = new Set(s); if (c.has(k)) c.delete(k); else c.add(k); return c; });
  };
  const exportCsv = () => {
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const head = ["Module", "Form", "Group", "Component instance", "Component", "Widget path", "Event", "Wired by", "Wired in", "Handler", "Handler lives in", "Handler file:line", "Calls next", "Visibility", "Status", "Notes"];
    const lines = [head.map(esc).join(",")];
    for (const [k, L, m] of matches) for (const a of m) {
      const g = L.groups.find((x) => x.id === a.group);
      lines.push([L.form.module, L.form.name, a.group === "events" ? "Form events" : a.group === "form" ? "Form widgets" : "Component", a.inst || "", g && g.ns ? g.ns : a.inst ? "(another app)" : "", a.path, a.event,
        a.wired.map((w) => w.how).join(" + "), a.wired.map((w) => (w.how === "code" ? `${w.rel}:${w.line}` : w.rel || w.text || "")).join(" | "),
        a.handler ? a.handler.name : "", a.handler ? a.handler.where : "", a.handler && a.handler.rel ? `${a.handler.rel}:${a.handler.line}` : "",
        [...a.hops.map((x) => x.text), a.screen ? `${a.screen} screen updates` : ""].filter(Boolean).join("; "), a.reach.state, a.problem || "ok", a.status.map((s) => s.text).join(" | ")].map(esc).join(","));
      void k;
    }
    const url = URL.createObjectURL(new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv" }));
    const el = document.createElement("a");
    el.href = url; el.download = `action-locator-${idx.project.name}-${idx.ch}.csv`; el.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
  const pct = forms.length ? (done / forms.length) * 100 : 100;
  return (
    <div className="bp-page lc">
      <h2 className="page">⌖ Action locator</h2>
      <div className="crumb">Every action in {idx.project.name} ({idx.ch}): which form, which component, which file wires it, which controller runs it — and what is broken or unreachable.</div>
      <div className="lc-scan">
        <div className="lc-tiles">
          <Tile n={inMod.length} l="forms read" sub={`of ${nf(mod ? forms.filter((k) => k.startsWith(mod + "/")).length : forms.length)}`} />
          <Tile n={n.all} l="actions" />
          <Tile n={inMod.reduce((s, [, L]) => s + L.counts.comps, 0)} l="component instances" />
          <Tile n={n.bad} l="problems" tone="bad" />
          <Tile n={n.hidden} l="unreachable" tone="warn" />
          <Tile n={n.replaced} l="replaced at run time" tone="info" />
        </div>
        {done < forms.length && (
          <div className="lc-progress">
            <div className="lc-ptext"><b>{running ? "Reading" : "Paused at"} form {nf(done)} of {nf(forms.length)}</b>{current && <span className="mono"> · {current}</span>}<button onClick={() => setRunning((r) => !r)}>{running ? "Pause" : "Resume"}</button></div>
            <div className="lc-pbar"><div style={{ width: pct + "%" }} /></div>
          </div>
        )}
        {errors.current.length > 0 && <div className="tag">{errors.current.length} form(s) could not be read: {errors.current.slice(0, 3).join(" · ")}</div>}
      </div>
      <FilterBar q={q} setQ={(v) => { setQ(v); setLimit(40); }} filter={filter} setFilter={(v) => { setFilter(v); setLimit(40); }} n={n}
        extra={<>
          <select value={mod} onChange={(e) => { setMod(e.target.value); setLimit(40); }}><option value="">All modules</option>{modules.map((m) => <option key={m} value={m}>{m}</option>)}</select>
          <button className="lc-btn" onClick={exportCsv} disabled={!matches.length}>⇩ Export CSV</button>
        </>} />
      <div className="lc-forms">
        {matches.slice(0, limit).map(([k, L, m], i) => {
          const open = openForms.has(k) || (narrowed && i < 12 && !openForms.has("!" + k));
          return (
            <div key={k} className={"lc-form" + (open ? " open" : "")} style={{ "--d": Math.min(i, 20) * 25 + "ms" }}>
              <div className="lc-fhead" onClick={() => (narrowed && i < 12 ? setOpenForms((s) => { const c = new Set(s); if (c.has("!" + k)) c.delete("!" + k); else c.add("!" + k); return c; }) : toggleForm(k))}>
                <span className={"lc-caret" + (open ? " open" : "")}>▸</span>
                <span className="lc-gico">▤</span>
                <b className="mono">{L.form.name}</b>
                <span className="tag">{L.form.module}</span>
                <span className="lc-aright">
                  {L.counts.bad > 0 && <span className="lc-pill bad">✕ {L.counts.bad}</span>}
                  {L.counts.warn > 0 && <span className="lc-pill warn">! {L.counts.warn}</span>}
                  <span className="lc-gcount">{m.length}{m.length !== L.acts.length ? ` of ${L.acts.length}` : ""} actions</span>
                  <button className="lc-mini" onClick={(e) => { e.stopPropagation(); openFormTab(k); }}>Open form</button>
                </span>
              </div>
              {open && <OpenForm idx={idx} k={k} L={L} infos={infos} bump={bump} filter={filter} ql={ql} openFlow={(id) => openFormFlow(k, id)} onCode={setSel} />}
            </div>
          );
        })}
        {matches.length > limit && <button className="lc-more" onClick={() => setLimit((x) => x + 40)}>Show {Math.min(40, matches.length - limit)} more forms ({nf(matches.length - limit)} left)</button>}
        {!matches.length && done >= forms.length && <div className="lc-none">No action matches.</div>}
      </div>
      <CodeDrawer idx={idx} sel={sel} close={() => setSel(null)} />
    </div>
  );
}
function OpenForm({ idx, k, L, infos, bump, filter, ql, openFlow, onCode }) {
  useEffect(() => { if (!infos.has(k)) widgetInfo(idx, k).then((m) => { infos.set(k, m); bump((x) => x + 1); }); }, [idx, k, infos, bump]);
  return <div className="lc-formbody"><LocatorTree idx={idx} L={L} info={infos.get(k)} filter={filter} ql={ql} openFlow={openFlow} onCode={onCode} /></div>;
}
function Tile({ n, l, sub, tone }) {
  return <div className={"lc-tile" + (tone ? " " + tone : "")}><b>{nf(n)}</b><span>{l}{sub ? <em> {sub}</em> : null}</span></div>;
}
