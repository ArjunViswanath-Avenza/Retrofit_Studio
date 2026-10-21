// Blueprint: one monolith, part by part — modules, forms, controllers, presentation and business code, and every
// action on a form traced to the model and back, with the code at each step.
import { useState, useEffect, useMemo, useRef } from "react";
import "./blueprint.css";
import { FormPreview } from "./FormPreview";
import { FlowJourney } from "./FlowJourney";
import { triggerText } from "../lib/journey";
import { widgetInfo } from "../lib/preview";
import { getClass, analyzeFn, traceEntry, formActions, formArrivals, formWidgets, componentIndex, i18nText, LAYERS, LAYER_LABEL, clsLabel } from "../lib/blueprint";

const nf = (n) => Number(n || 0).toLocaleString("en-US");
const CH_LABEL = { desktop: "Web (desktop)", mobile: "Mobile", tablet: "Tablet", watch: "Watch" };
const short = (rel) => rel.split("/").slice(-2).join("/");

/* ================================================================ upload */
export function BlueprintUpload({ pick, onFolder, ch, setCh, go, busy }) {
  const chans = pick ? Object.keys(pick.channels) : [];
  return (
    <div>
      <h2 className="page">⌗ Blueprint · a monolith, part by part</h2>
      <div className="crumb">Pick one Visualizer project folder (Online Banking or Mobile Banking). Everything is read in your browser.</div>
      <div className="rules">
        Blueprint lays the project out as <b>modules</b> → <b>forms</b>, <b>form controllers</b>, <b>presentation</b> and <b>business controllers</b>.
        Open a form to see its screen, every action a user can trigger, the data it sends and receives, and a <b>code flow breakdown</b> that follows one action
        from the widget through the presentation and business code to the service, and the callbacks back to the widgets — with the code line at every step.
        Only calls written literally in the code are followed; anything else is shown as <i>not resolved</i>.
      </div>
      <div className="folders" style={{ gridTemplateColumns: "1fr" }}>
        <div className={"folder" + (pick ? " filled" : "")}>
          <h3>Monolith project</h3>
          <div className="cnt">{pick ? nf(pick.files.size) : 0}</div>
          <div className="cl">project files</div>
          <label className="pick">Choose project folder
            <input type="file" webkitdirectory="" directory="" multiple style={{ display: "none" }} onChange={(e) => onFolder(e.target.files)} />
          </label>
          {pick && <div className="sub2"><b>{pick.name}</b>{!pick.hasProps && <span className="bp-warn"> · no projectProperties.json — is this a Visualizer project?</span>}
            {Object.keys(pick.excluded).length > 0 && <div className="tag">not read (build output): {Object.entries(pick.excluded).map(([d, n]) => `${d} ${nf(n)}`).join(" · ")}</div>}</div>}
        </div>
      </div>
      {pick && (
        <div style={{ marginTop: 12 }}>
          <div className="tag" style={{ marginBottom: 6 }}>Channel (form folders found in this project)</div>
          <div className="seg">{chans.map((c) => <button key={c} className={ch === c ? "on" : ""} onClick={() => setCh(c)}>{CH_LABEL[c] || c} · {nf(pick.channels[c])} forms</button>)}</div>
          {!chans.length && <p className="bp-warn">No forms/&lt;channel&gt;/…/*.sm folders found.</p>}
        </div>
      )}
      <div style={{ marginTop: 14 }}>
        <button className="btn vz-go" disabled={!pick || !ch || busy} onClick={go}>{busy ? "Reading the project…" : "Open Blueprint →"}</button>
      </div>
    </div>
  );
}

export const BP_MENU = [
  { id: "bp-home", ico: "⌗", label: "Project blueprint", desc: "Every module, part by part" },
  { id: "bp-module", ico: "▦", label: "Module", desc: "Forms, controllers, presentation, business" },
  { id: "bp-form", ico: "▤", label: "Form", desc: "Screen, actions, data in & out" },
  { id: "bp-flow", ico: "⇄", label: "Code flow breakdown", desc: "One action to the model and back" },
];

/* ================================================================ project blueprint */
export function BlueprintHome({ idx, open }) {
  const [q, setQ] = useState("");
  const [onlyForms, setOnlyForms] = useState(true);
  const [fnCounts, setFnCounts] = useState({});
  const mods = useMemo(() => [...idx.modules.values()].sort((a, b) => a.name.localeCompare(b.name)), [idx]);
  useEffect(() => {
    let alive = true;
    (async () => {
      const out = {};
      for (const M of mods) {
        const [pc, bc] = [await getClass(idx, "pc", M.name), await getClass(idx, "bc", M.name)];
        out[M.name] = { pc: pc.members.size, bc: bc.members.size, pcFiles: pc.files.length, bcFiles: bc.files.length, errors: pc.errors.length + bc.errors.length };
        if (!alive) return;
      }
      if (alive) setFnCounts(out);
    })();
    return () => { alive = false; };
  }, [idx, mods]);
  const shown = mods.filter((M) => (!onlyForms || M.forms.length) && (!q || M.name.toLowerCase().includes(q.toLowerCase()) || M.forms.some((k) => k.toLowerCase().includes(q.toLowerCase()))));
  const tot = { forms: idx.forms.size, ctrls: [...idx.controllers.values()].length, mods: mods.length };
  return (
    <div className="bp-page">
      <h2 className="page">Project blueprint</h2>
      <div className="crumb">{idx.project.name} · {CH_LABEL[idx.ch] || idx.ch} · {nf(tot.mods)} modules · {nf(tot.forms)} forms · {nf(tot.ctrls)} form controllers</div>
      <div className="bp-legend">
        <span><i className="bp-dot f" /> forms</span><span><i className="bp-dot c" /> form controllers</span><span><i className="bp-dot p" /> presentation functions</span><span><i className="bp-dot b" /> business functions</span>
      </div>
      <div className="searchbar">
        <input type="text" placeholder="Find a module or form…" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className={"chip" + (onlyForms ? " on" : "")} onClick={() => setOnlyForms((v) => !v)}>{onlyForms ? "✓ " : ""}modules with forms</span>
        <span className="tag">{nf(shown.length)} shown · {mods.length - mods.filter((m) => m.forms.length).length} modules have only presentation / business code (managers)</span>
      </div>
      <div className="bp-grid">
        {shown.map((M, i) => {
          const c = fnCounts[M.name];
          return (
            <div key={M.name} className="bp-mod" style={{ "--d": Math.min(i, 40) * 18 + "ms" }} onClick={() => open(M.name)}>
              <div className="bp-modname">{M.name}</div>
              <div className="bp-bars">
                <Bar k="f" n={M.forms.length} l="forms" />
                <Bar k="c" n={M.controllers.length} l="controllers" />
                <Bar k="p" n={c ? c.pc : null} l="presentation fns" />
                <Bar k="b" n={c ? c.bc : null} l="business fns" />
              </div>
              {M.configError && <div className="bp-warn">{M.configError}</div>}
              {c && c.errors > 0 && <div className="bp-warn">{c.errors} file(s) could not be parsed</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
function Bar({ k, n, l }) {
  return <div className="bp-bar"><i className={"bp-dot " + k} /><b>{n == null ? "…" : nf(n)}</b><span>{l}</span></div>;
}

/* ================================================================ module */
export function BlueprintModule({ idx, module, setModule, openForm, traceFrom }) {
  const [tab, setTab] = useState("forms");
  const [cls, setCls] = useState({});
  const [sel, setSel] = useState(null); // { kind, key, fn }
  const M = module && idx.modules.get(module);
  useEffect(() => {
    if (!M) return;
    let alive = true;
    (async () => { const pc = await getClass(idx, "pc", M.name), bc = await getClass(idx, "bc", M.name); if (alive) setCls({ pc, bc }); })();
    setSel(null);
    return () => { alive = false; };
  }, [idx, M]);
  if (!M) return <Picker title="Module" items={[...idx.modules.keys()].sort()} onPick={setModule} />;
  const conf = M.config || {};
  const mgrs = cls.pc ? [...new Set([...cls.pc.members.values()].flatMap((m) => analyzeFn(cls.pc, idx, m, m.node).steps.filter((s) => s.type === "bc").map((s) => s.module)))].sort() : null;
  return (
    <div className="bp-page">
      <h2 className="page">▦ {M.name}</h2>
      <div className="crumb">{M.forms.length} forms · {M.controllers.length} form controllers · presentation {cls.pc ? `${nf(cls.pc.members.size)} functions in ${cls.pc.files.length} file(s)` : "…"} · business {cls.bc ? `${nf(cls.bc.members.size)} functions in ${cls.bc.files.length} file(s)` : "…"}</div>
      {mgrs && mgrs.length > 0 && <p className="bp-note">Its presentation code calls business code in <b>{mgrs.length}</b> manager module{mgrs.length > 1 ? "s" : ""}: {mgrs.map((m) => <span key={m} className="bp-ev" onClick={() => setModule(m)}>{m}</span>)}</p>}
      <div className="tabs">
        {[["forms", `Forms · ${M.forms.length}`], ["ctrls", `Form controllers · ${M.controllers.length}`], ["pc", "Presentation controller"], ["bc", "Business controller"], ["config", "Module config"]].map(([k, l]) => <div key={k} className={"tab" + (tab === k ? " active" : "")} onClick={() => { setTab(k); setSel(null); }}>{l}</div>)}
      </div>
      <div className="view">
        {tab === "forms" && (
          <div className="bp-cards">
            {M.forms.map((k) => { const f = idx.forms.get(k); const hasC = (idx.ctrlByForm.get(f.name) || []).length > 0; return (
              <div key={k} className="bp-card" onClick={() => openForm(k)}>
                <b>{f.name}</b><span className="tag">{nf(f.files.length)} widget files{hasC ? "" : " · no controller found"}</span>
              </div>); })}
            {!M.forms.length && <p className="note">This module has no forms in this channel — it holds presentation / business code used by other modules.</p>}
          </div>
        )}
        {tab === "ctrls" && <ClassList idx={idx} keys={M.controllers} kind="controller" sel={sel} setSel={setSel} traceFrom={traceFrom} />}
        {(tab === "pc" || tab === "bc") && (cls[tab] ? <ClassView idx={idx} cls={cls[tab]} sel={sel} setSel={setSel} traceFrom={traceFrom} /> : <p className="note">Reading…</p>)}
        {tab === "config" && (
          <div>
            {M.configError && <p className="bp-warn">{M.configError}</p>}
            {!M.configRel && <p className="note">No ModuleConfig.json for this module.</p>}
            {M.config && (
              <table className="bp-mini">
                <tbody>
                  <tr><td>Presentation class</td><td className="mono">{Object.entries(conf.PresentationControllerConfig || {}).map(([k, v]) => `${k}: ${v.PresentationControllerClass}`).join(" · ") || "—"}</td></tr>
                  <tr><td>Presentation extensions</td><td className="mono">{Object.values(conf.PresentationControllerConfig || {}).flatMap((v) => v.PresentationExtensions || []).join(", ") || "—"}</td></tr>
                  <tr><td>Business class</td><td className="mono">{(conf.BusinessControllerConfig || {}).BusinessControllerClass || "—"}</td></tr>
                  <tr><td>Business extensions</td><td className="mono">{((conf.BusinessControllerConfig || {}).BusinessExtensions || []).join(", ") || "—"}</td></tr>
                  {Object.entries(conf.Forms || {}).map(([ch, fs]) => <tr key={ch}><td>Forms registered · {ch}</td><td className="mono">{Object.keys(fs || {}).join(", ")}</td></tr>)}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ClassList({ idx, keys, kind, sel, setSel, traceFrom }) {
  const [open, setOpen] = useState(null);
  const [cls, setCls] = useState(null);
  useEffect(() => { let alive = true; if (open) getClass(idx, kind, open).then((c) => alive && setCls(c)); else setCls(null); return () => { alive = false; }; }, [idx, kind, open]);
  if (open && cls) return <div><button className="btn ghost" onClick={() => setOpen(null)} style={{ marginBottom: 8 }}>← All form controllers</button><ClassView idx={idx} cls={cls} sel={sel} setSel={setSel} traceFrom={traceFrom} /></div>;
  return <div className="bp-cards">{keys.map((k) => { const c = idx.controllers.get(k); return <div key={k} className="bp-card" onClick={() => setOpen(k)}><b>{c.name}</b><span className="tag">{c.files.map((r) => r.split("/").pop()).join(" · ")}</span></div>; })}</div>;
}

// every function of a class, what it calls, and its code
function ClassView({ idx, cls, sel, setSel, traceFrom }) {
  const [q, setQ] = useState("");
  const members = [...cls.members.values()].filter((m) => !q || m.name.toLowerCase().includes(q.toLowerCase())).sort((a, b) => a.rel.localeCompare(b.rel) || a.line - b.line);
  const cur = sel && sel.cls === cls.id ? cls.members.get(sel.fn) : null;
  const steps = useMemo(() => (cur ? analyzeFn(cls, idx, cur, cur.node).steps : null), [cls, idx, cur]);
  return (
    <div>
      <div className="tag" style={{ marginBottom: 6 }}>{cls.files.map((r, i) => <span key={r} className="mono">{i ? " + " : ""}{short(r)}{i ? " (loaded after, its functions win)" : ""}</span>)}</div>
      {cls.errors.map((e) => <div key={e} className="bp-warn">Could not parse {e}</div>)}
      <div className="bp-split">
        <div className="bp-list">
          <input type="text" placeholder={`Find one of ${nf(cls.members.size)} functions…`} value={q} onChange={(e) => setQ(e.target.value)} />
          {members.map((m) => (
            <div key={m.name} className={"bp-item" + (cur === m ? " sel" : "")} onClick={() => setSel({ cls: cls.id, fn: m.name })}>
              <span className="mono">{m.name}</span><span className="tag">{short(m.rel)}:{m.line}{m.overrides ? " · replaces " + short(m.overrides) : ""}</span>
            </div>
          ))}
        </div>
        <div>
          {cur ? (
            <>
              <div className="bp-fnhead"><b className="mono">{cur.name}</b> <span className="tag">{cur.rel}:{cur.line}–{cur.end}</span>
                <button className="btn" onClick={() => traceFrom({ cls, member: cur, label: `${clsLabel(cls)}.${cur.name}` })}>Trace from here →</button></div>
              <StepList steps={steps} />
              <Code idx={idx} rel={cur.rel} from={cur.line} to={cur.end} />
            </>
          ) : <p className="note">Pick a function to see what it calls and its code.</p>}
        </div>
      </div>
    </div>
  );
}
function StepList({ steps }) {
  const shown = (steps || []).filter((s) => s.type !== "i18n");
  if (!shown.length) return <p className="tag">This function makes no calls Blueprint follows.</p>;
  return <div className="bp-steps">{shown.map((s, i) => <div key={i} className={"bp-st k-" + s.type}><span className="tag">L{s.line}</span> {stepText(s)}</div>)}</div>;
}

/* ================================================================ shared: code, pickers, step text */
export function Code({ idx, rel, from, to, hl }) {
  const [lines, setLines] = useState(null);
  const ref = useRef(null);
  useEffect(() => { let alive = true; idx.read(rel).then((t) => alive && setLines((t || "").split("\n"))); return () => { alive = false; }; }, [idx, rel]);
  useEffect(() => { if (ref.current && hl) { const el = ref.current.querySelector(".hl"); if (el) el.scrollIntoView({ block: "center" }); } }, [lines, hl]);
  if (!lines) return <p className="note">Reading {rel}…</p>;
  const a = Math.max(1, from), b = Math.min(lines.length, to || from + 40);
  return (
    <div className="bp-code" ref={ref}>
      <div className="bp-codehead mono">{rel} · lines {a}–{b}</div>
      {lines.slice(a - 1, b).map((l, i) => <div key={i} className={"bp-cl" + (a + i === hl ? " hl" : "")}><span>{a + i}</span><code>{l || " "}</code></div>)}
    </div>
  );
}
function Picker({ title, items, onPick, render }) {
  const [q, setQ] = useState("");
  const list = items.filter((x) => !q || (render ? render(x) : x).toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="bp-page">
      <h2 className="page">Choose a {title.toLowerCase()}</h2>
      <div className="searchbar"><input type="text" placeholder={`Find a ${title.toLowerCase()}…`} value={q} onChange={(e) => setQ(e.target.value)} autoFocus /><span className="tag">{nf(list.length)}</span></div>
      <div className="bp-cards">{list.slice(0, 600).map((x) => <div key={x} className="bp-card" onClick={() => onPick(x)}><b>{render ? render(x) : x}</b></div>)}</div>
    </div>
  );
}
export function stepText(s, e) {
  if (e && e.kind === "compEvent") return <>the component raises its event <b className="mono">{e.event}</b> {e.noHandler ? <span className="tag">— this form wires no handler to it</span> : <span className="tag">— the form handles it</span>}</>;
  if (e && e.kind === "compCall") return <>calls component <b className="mono">{e.comp}</b> method <b className="mono">{s.action}</b></>;
  if (e && e.kind === "widget" && e.path !== s.path) return <>screen: <b className="mono">{e.path || "(form)"}</b> {s.action}{s.value ? <span className="mono tag"> {s.value}</span> : null}</>;
  switch (s.type) {
    case "self": return <>calls <b className="mono">{s.fn}()</b> in the same class</>;
    case "local": return <>calls local function <b className="mono">{s.name}()</b></>;
    case "pc": return <>calls <b className="mono">{s.module}</b> presentation <b className="mono">{s.fn}()</b> <span className="tag">via {s.how}</span></>;
    case "bc": return <>calls <b className="mono">{s.module}.{s.fn}()</b> <span className="tag">via {s.how}</span></>;
    case "ctrl": return <>calls form controller <b className="mono">{s.form}.{s.fn}()</b></>;
    case "service": return <>calls service <b className="mono">{s.obj}.{s.verb}</b> <span className="tag">{s.svcKind === "model" ? "object service" : s.svcKind}{s.how ? ` · ${s.how}` : ""}</span></>;
    case "nav": return <>opens form <b className="mono">{s.form || `chosen at run time (${s.formExpr})`}</b></>;
    case "updateForm": return <>sends data to <b className="mono">{(e && e.target) || s.form || "the form on screen"}</b>{e && e.targetGuess ? <span className="tag"> (no form named: the form on screen at that moment)</span> : null} — <span className="mono">{s.keys ? s.keys.map((k) => k.key + (k.value != null ? `="${k.value}"` : "")).join(", ") : s.dataText}</span></>;
    case "present": return <>shows <b className="mono">{s.form}</b> with data (presentUserInterface)</>;
    case "widget": return <>screen: <b className="mono">{s.path || "(form)"}</b> {s.action}{s.value ? <span className="mono tag"> {s.value}</span> : null}</>;
    case "infoSet": return <>stores data for later under <b className="mono">{s.key || "(name at run time)"}</b> (setCustomInfo)</>;
    case "infoGet": return <>reads stored data <b className="mono">{s.key || "(name at run time)"}</b> (getCustomInfo)</>;
    case "param": return <>calls back the function it was given as <b className="mono">{s.name}</b></>;
    case "bind": return <>sets <b className="mono">{s.path || "(form)"}.{s.event}</b> → {s.handlerText}</>;
    case "unresolved": return <span className="bp-muted">not resolved: <span className="mono">{s.what}</span> — {s.why}</span>;
    default: return s.type;
  }
}

/* ================================================================ form */
export function BlueprintForm({ idx, formKey, setForm, tab, setTab, openFlow, cache }) {
  const f = formKey && idx.forms.get(formKey);
  const [A, setA] = useState(null); // formActions + arrivals
  const [sum, setSum] = useState(null); // per-entry trace summaries
  const [prog, setProg] = useState(null);
  useEffect(() => {
    if (!f) return;
    let alive = true;
    setA(null); setSum(null); setProg(null);
    (async () => {
      const key = "form:" + formKey;
      let base = cache.get(key);
      if (!base) {
        const r = await formActions(idx, formKey);
        const arr = await formArrivals(idx, f.name);
        base = { ...r, arrivals: arr.map((a, i) => ({ id: `arr:${i}:${a.cls.id}#${a.member.name}`, group: "arrival", source: a.how.join(", "), widget: clsLabel(a.cls), event: a.member.name, label: `${clsLabel(a.cls)}.${a.member.name}`, cls: a.cls, member: a.member, lines: a.lines })) };
        cache.set(key, base);
      }
      if (!alive) return;
      setA(base);
      // trace every entry once, in the background, for the summary and data in & out
      const all = [...base.entries, ...base.arrivals].filter((e) => e.member);
      const out = {};
      for (let i = 0; i < all.length; i++) {
        if (!alive) return;
        const e = all[i];
        out[e.id] = summarize(await cachedTrace(idx, cache, e, f));
        if (i % 6 === 5) { setProg({ done: i + 1, total: all.length }); await new Promise((r) => setTimeout(r)); }
      }
      if (alive) { setSum(out); setProg(null); }
    })();
    return () => { alive = false; };
  }, [idx, formKey, f, cache]);
  if (!f) return <Picker title="Form" items={[...idx.forms.keys()].sort((a, b) => a.split("/").pop().localeCompare(b.split("/").pop()))} onPick={setForm} render={(k) => `${k.split("/").pop()}  ·  ${k.split("/").slice(0, -1).join("/")}`} />;
  const tabs = [["preview", "Preview"], ["summary", "Summary"], ["screen", "Screen structure"], ["actions", "User actions"], ["data", "Data in & out"]];
  return (
    <div className="bp-page">
      <h2 className="page">▤ {f.name}</h2>
      <div className="crumb">Module {f.module} · {CH_LABEL[idx.ch] || idx.ch} · {nf(f.files.length)} widget files{A && A.cls ? ` · controller ${A.cls.files.map(short).join(" + ")}` : ""}</div>
      <div className="tabs">
        {tabs.map(([k, l]) => <div key={k} className={"tab" + (tab === k ? " active" : "")} onClick={() => setTab(k)}>{l}</div>)}
        <div className="tab bp-flowtab" onClick={() => openFlow(null)}>Code flow breakdown →</div>
      </div>
      <div className="view">
        {!A ? <p className="note">Reading {f.name}: widgets, controller, actions and the code that opens it…</p> : (
          <>
            {prog && <div className="bp-prog"><span className="tag">Tracing every action to build the summary and data in & out · {prog.done} / {prog.total}</span><div className="progress"><div style={{ width: (prog.done / prog.total) * 100 + "%" }} /></div></div>}
            {tab === "preview" && <FormPreview idx={idx} f={f} A={A} cache={cache} openFlow={openFlow} />}
            {tab === "summary" && <FormSummary idx={idx} f={f} A={A} sum={sum} openFlow={openFlow} />}
            {tab === "screen" && <ScreenTree idx={idx} f={f} A={A} openFlow={openFlow} />}
            {tab === "actions" && <ActionList A={A} sum={sum} openFlow={openFlow} />}
            {tab === "data" && <DataInOut idx={idx} A={A} sum={sum} openFlow={openFlow} />}
          </>
        )}
      </div>
    </div>
  );
}

export async function cachedTrace(idx, cache, e, f) {
  const k = "trace:" + f.key + ":" + e.id;
  const base = cache.get("form:" + f.key);
  if (!cache.has(k)) cache.set(k, await traceEntry(idx, { cls: e.cls, member: e.member, fnNode: e.fnNode, outerScope: e.outerScope, label: e.handlerLabel, form: f.name, module: f.module, viewPrefix: e.viewPrefix || null, instances: base && base.instances, formEntries: base && base.entries }));
  return cache.get(k);
}

// what one traced action ends up doing
function summarize(T) {
  const s = { services: new Map(), navs: new Set(), updates: [], widgets: new Set(), stores: new Set(), unresolved: 0, missing: [], nodes: T.nodes, truncated: T.truncated };
  const seen = new Set();
  const walk = (n) => {
    if (!n || seen.has(n.uid)) return;
    seen.add(n.uid);
    for (const e of n.edges) {
      const st = e.step;
      if (e.kind === "service") s.services.set(`${st.svcKind}:${st.obj}.${st.verb}`, st);
      if (e.kind === "nav") s.navs.add(st.form || `(chosen at run time: ${st.formExpr})`);
      if (e.kind === "updateForm" || e.kind === "present") s.updates.push({ form: e.target || st.form || "(form on screen)", keys: st.keys ? st.keys.map((k) => k.key) : [st.dataText] });
      if (e.kind === "widget") s.widgets.add(e.path || st.path || "(form)");
      if (e.kind === "infoSet") s.stores.add(st.key || "(run time)");
      if (e.kind === "unresolved") s.unresolved++;
      if (e.missing) s.missing.push(e.missing);
      walk(e.child);
      for (const r of e.returns || []) walk(r.node);
    }
  };
  walk(T.root);
  return s;
}

function serviceLabel(idx, st) {
  if (st.svcKind === "identity") return `Identity service · ${st.verb}`;
  if (st.svcKind === "integration") return `Integration ${st.obj} · ${st.verb}`;
  const svc = idx.models[st.obj];
  return `${svc ? svc.join(", ") + " · " : st.obj === "?" ? "(object not named in the code) · " : ""}${st.obj}.${st.verb}`;
}
const list = (arr, n = 6) => (arr.length <= n ? arr.join(", ") : `${arr.slice(0, n).join(", ")} and ${arr.length - n} more`);

function FormSummary({ idx, f, A, sum, openFlow }) {
  const [W, setW] = useState(null);
  const [comps, setComps] = useState(null);
  useEffect(() => { let alive = true; (async () => { const w = await formWidgets(idx, f.key), c = await componentIndex(idx); if (alive) { setW(w); setComps(c); } })(); return () => { alive = false; }; }, [idx, f]);
  const types = W ? [...W.values()].reduce((o, w) => ((o[w.wType] = (o[w.wType] || 0) + 1), o), {}) : {};
  const uwis = W ? [...W.values()].filter((w) => w.wType === "UserWidgetInstance").map((w) => (comps && comps.get(w.sourceUserWidget)) || w.id) : [];
  const segs = W ? [...W.values()].filter((w) => w.wType === "Segment").map((w) => `${w.id}${w.rowtemplate ? ` (rows: ${w.rowtemplate})` : ""}`) : [];
  const acts = A.entries.filter((e) => e.group === "action"), life = A.entries.filter((e) => e.group === "lifecycle");
  const agg = aggregate(sum, f.name);
  return (
    <div className="bp-summary">
      <p><b>{f.name}</b> is a form of module <b>{f.module}</b>{W ? <> with <b>{nf(W.size)}</b> widgets ({list(Object.entries(types).sort((a, b) => b[1] - a[1]).map(([t, n]) => `${n} ${t}`), 5)})</> : null}.
        {A.cls ? <> Its controller <b className="mono">{clsLabel(A.cls)}</b> has <b>{nf(A.cls.members.size)}</b> functions{A.cls.files.length > 1 ? ` across ${A.cls.files.length} files` : ""}.</> : <span className="bp-warn"> No form controller was found for it.</span>}</p>
      {uwis.length > 0 && <p>It uses components <b>{uwis.length}</b> time{uwis.length > 1 ? "s" : ""} ({new Set(uwis).size} different): <span className="mono">{list([...new Set(uwis)], 8)}</span>.</p>}
      {segs.length > 0 && <p>It shows lists in <b>{segs.length}</b> segment{segs.length > 1 ? "s" : ""}: <span className="mono">{list(segs, 6)}</span>.</p>}
      <p>A user can trigger <b>{acts.length}</b> action{acts.length !== 1 ? "s" : ""} on it ({acts.filter((e) => e.source === "Visualizer action sequence").length} wired in Visualizer, {acts.filter((e) => e.source.startsWith("set in code")).length} set in the controller code), and <b>{life.length}</b> form event{life.length !== 1 ? "s" : ""} run as it opens and changes ({list([...new Set(life.map((e) => e.event))])}).</p>
      <p>It is opened or updated from <b>{A.arrivals.length}</b> place{A.arrivals.length !== 1 ? "s" : ""} in the code{A.arrivals.length ? <>: <span className="mono">{list(A.arrivals.map((a) => a.label), 5)}</span></> : ""}.</p>
      {sum ? (
        <>
          <p>Following every one of these through the code, the form reaches <b>{agg.services.size}</b> service call{agg.services.size !== 1 ? "s" : ""}{agg.services.size ? <>: <span className="mono">{list([...agg.services.values()].map((s) => serviceLabel(idx, s)), 5)}</span></> : ""}.</p>
          <p>It can open <b>{agg.navs.size}</b> form{agg.navs.size !== 1 ? "s" : ""}{agg.navs.size ? <>: <span className="mono">{list([...agg.navs], 8)}</span></> : ""}, and data comes back to it (updateForm → <span className="mono">updateFormUI</span>) with <b>{agg.keysIn.size}</b> different key{agg.keysIn.size !== 1 ? "s" : ""}{agg.keysIn.size ? <>: <span className="mono">{list([...agg.keysIn], 10)}</span></> : ""}.</p>
          {(agg.unresolved > 0 || agg.missing.size > 0) && <p className="bp-warn">{agg.unresolved} call(s) could not be resolved from the code{agg.missing.size ? `, and ${agg.missing.size} call(s) point at a function that does not exist: ${list([...agg.missing], 4)}` : ""}.</p>}
        </>
      ) : <p className="note">Tracing every action for the services, forms and data it reaches…</p>}
      <div className="bp-facts">
        <button className="btn" onClick={() => openFlow(null)}>Open code flow breakdown →</button>
      </div>
    </div>
  );
}
function aggregate(sum, formName) {
  const a = { services: new Map(), navs: new Set(), keysIn: new Set(), unresolved: 0, missing: new Set(), byService: new Map(), byNav: new Map() };
  for (const [id, s] of Object.entries(sum || {})) {
    for (const [k, v] of s.services) { a.services.set(k, v); if (!a.byService.has(k)) a.byService.set(k, new Set()); a.byService.get(k).add(id); }
    for (const n of s.navs) { a.navs.add(n); if (!a.byNav.has(n)) a.byNav.set(n, new Set()); a.byNav.get(n).add(id); }
    a.unresolved += s.unresolved; s.missing.forEach((m) => a.missing.add(m));
    for (const u of s.updates) if (u.form === formName) u.keys.forEach((k) => k && a.keysIn.add(k));
  }
  return a;
}

const WICON = { FlexContainer: "▢", FlexScrollContainer: "⇕", Label: "T", Button: "⏺", Image: "🖼", TextField: "⌨", TextArea: "¶", Segment: "☰", UserWidgetInstance: "⧉", ListBox: "▾", CheckBoxGroup: "☑", RadioButtonGroup: "◉", RichText: "✎", Browser: "🌐", Calendar: "📅", Switch: "⇆", Form: "▤" };
function ScreenTree({ idx, f, A, openFlow }) {
  const [W, setW] = useState(null);
  const [extra, setExtra] = useState({});
  const [open, setOpen] = useState(() => new Set());
  const [q, setQ] = useState("");
  useEffect(() => { let alive = true; (async () => { const w = await formWidgets(idx, f.key); const c = await componentIndex(idx); const t = await i18nText(idx); if (alive) { setW(w); setExtra({ comps: c, i18n: t }); const root = [...w.values()].find((x) => !x.parent); setOpen(new Set(root ? [root.id] : [])); } })(); return () => { alive = false; }; }, [idx, f]);
  if (!W) return <p className="note">Reading widgets…</p>;
  const evBy = new Map();
  for (const e of A.entries) { const k = e.widget.split(".")[0]; if (!evBy.has(k)) evBy.set(k, []); evBy.get(k).push(e); }
  const root = [...W.values()].find((x) => !x.parent);
  const ql = q.toLowerCase();
  const matches = (w) => w.id.toLowerCase().includes(ql) || (textOf(w, extra.i18n) || "").toLowerCase().includes(ql);
  const keep = new Set();
  if (q) for (const w of W.values()) if (matches(w)) { let p = w; while (p) { keep.add(p.id); p = W.get(p.parent); } }
  const row = (w, d) => {
    if (q && !keep.has(w.id)) return null;
    const kids = (w.children || []).map((id) => W.get(id)).filter(Boolean);
    const isOpen = open.has(w.id) || !!q;
    const t = textOf(w, extra.i18n);
    const evs = evBy.get(w.id) || [];
    return (
      <div key={w.id}>
        <div className="bp-w" style={{ paddingLeft: 8 + d * 16 }}>
          <span className="bp-tog" onClick={() => setOpen((s) => { const n = new Set(s); if (n.has(w.id)) n.delete(w.id); else n.add(w.id); return n; })}>{kids.length ? (isOpen ? "▾" : "▸") : "·"}</span>
          <span className="bp-wi" title={w.wType}>{WICON[w.wType] || "◇"}</span>
          <b className="mono">{w.id}</b> <span className="tag">{w.wType}{w.wType === "UserWidgetInstance" && extra.comps ? ` · ${extra.comps.get(w.sourceUserWidget) || "component"}` : ""}{w.wType === "Segment" && w.rowtemplate ? ` · rows: ${w.rowtemplate}` : ""}</span>
          {w.isvisible === false && <span className="bp-hidden">hidden at start</span>}
          {t && <span className="bp-wt">“{t.length > 60 ? t.slice(0, 59) + "…" : t}”</span>}
          {[...evs.reduce((m, e) => m.set(e.event, [...(m.get(e.event) || []), e]), new Map())].map(([ev, es]) => <span key={ev} className="bp-ev" onClick={() => openFlow(es[0].id)} title={es.map((e) => e.source).join(" · ")}>{ev}{es.length > 1 ? ` ×${es.length}` : ""} →</span>)}
        </div>
        {isOpen && kids.map((k) => row(k, d + 1))}
      </div>
    );
  };
  return (
    <div>
      <div className="searchbar"><input type="text" placeholder="Find a widget or text…" value={q} onChange={(e) => setQ(e.target.value)} /><span className="tag">{nf(W.size)} widgets · click an event to trace it</span>
        <button className="btn ghost" onClick={() => setOpen(new Set(W.keys()))}>Expand all</button><button className="btn ghost" onClick={() => setOpen(new Set(root ? [root.id] : []))}>Collapse</button></div>
      <div className="bp-tree">{root ? row(root, 0) : <p className="note">No root widget found.</p>}</div>
    </div>
  );
}
function textOf(w, i18n) {
  const key = w.texti18n || w.placeholderi18n || w.tooltipi18n;
  if (key) return (i18n && i18n[key]) || key;
  const t = w._text_ || w.text;
  return typeof t === "string" && t.trim() ? t : null;
}

const GROUP_LABEL = { lifecycle: "Form events (as the form opens and changes)", action: "User actions", arrival: "Arrivals — code elsewhere that opens or updates this form" };
function outcome(s) {
  if (!s) return <span className="tag">…</span>;
  const bits = [];
  if (s.services.size) bits.push(`${s.services.size} service${s.services.size > 1 ? "s" : ""}`);
  if (s.navs.size) bits.push(`opens ${list([...s.navs], 2)}`);
  if (s.updates.length) bits.push(`updates ${list([...new Set(s.updates.map((u) => u.form))], 2)}`);
  if (s.widgets.size) bits.push(`${s.widgets.size} widget${s.widgets.size > 1 ? "s" : ""} changed`);
  if (!bits.length) bits.push("no service, navigation or screen change found");
  return <span className="tag">{bits.join(" · ")}{s.unresolved ? ` · ${s.unresolved} not resolved` : ""}{s.missing.length ? ` · ${s.missing.length} missing function` : ""}</span>;
}
function ActionList({ A, sum, openFlow }) {
  const groups = ["lifecycle", "action", "arrival"].map((g) => [g, (g === "arrival" ? A.arrivals : A.entries.filter((e) => e.group === g))]);
  return (
    <div>
      {groups.map(([g, rows]) => (
        <div key={g} className="bp-group">
          <h3>{GROUP_LABEL[g]} · {rows.length}</h3>
          {!rows.length ? <p className="tag">None found.</p> : (
            <table className="bp-mini">
              <thead><tr><th>{g === "arrival" ? "Function" : "Widget · event"}</th><th>Wired</th><th>Runs</th><th>What it leads to</th><th /></tr></thead>
              <tbody>{rows.map((e) => (
                <tr key={e.id} className={e.member ? "clickable" : ""} onClick={() => e.member && openFlow(e.id)}>
                  <td><b className="mono">{e.label}</b>{e.conds && e.conds.length ? <div className="tag">only {e.conds[e.conds.length - 1]}</div> : null}</td>
                  <td className="tag">{e.source}{e.wiredInForm === false && e.source === "Visualizer action sequence" ? " · not found in the form's widget files" : ""}</td>
                  <td className="mono">{e.member ? (e.fnNode && e.fnNode !== e.member.node ? e.handlerLabel : e.member.name) : <span className="bp-warn">{e.unresolved}</span>}</td>
                  <td>{e.member ? outcome(sum && sum[e.id]) : null}</td>
                  <td>{e.member && <span className="bp-link">trace →</span>}</td>
                </tr>))}</tbody>
            </table>
          )}
        </div>
      ))}
    </div>
  );
}

function DataInOut({ idx, A, sum, openFlow }) {
  const [inKeys, setInKeys] = useState(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      const cls = A.cls; if (!cls) { setInKeys([]); return; }
      const out = [];
      for (const fn of ["updateFormUI", "willUpdateUI", "onNavigate", "preShow"]) {
        const m = cls.members.get(fn); if (!m) continue;
        const { steps } = analyzeFn(cls, idx, m, m.node);
        const conds = new Map();
        for (const s of steps) for (const c of s.conds) if (/^if \(/.test(c) && !conds.has(c)) conds.set(c, s.line);
        out.push({ fn, m, conds: [...conds.entries()], reads: steps.filter((s) => s.type === "infoGet").map((s) => s.key) });
      }
      for (const m of cls.members.values()) if (!["updateFormUI", "willUpdateUI", "onNavigate", "preShow"].includes(m.name)) {
        const { steps } = analyzeFn(cls, idx, m, m.node);
        const r = steps.filter((s) => s.type === "infoGet").map((s) => s.key);
        if (r.length) out.push({ fn: m.name, m, conds: [], reads: r });
      }
      if (alive) setInKeys(out);
    })();
    return () => { alive = false; };
  }, [idx, A]);
  const agg = aggregate(sum);
  const entryLabel = (id) => { const e = [...A.entries, ...A.arrivals].find((x) => x.id === id); return e ? e.label : id; };
  return (
    <div className="bp-data">
      <section>
        <h3>⇢ Data out — services this form reaches</h3>
        {!sum ? <p className="note">Tracing…</p> : !agg.services.size ? <p className="tag">No service call found.</p> : (
          <table className="bp-mini"><thead><tr><th>Service</th><th>Reached from</th></tr></thead>
            <tbody>{[...agg.services.entries()].sort().map(([k, s]) => <tr key={k}><td className="mono">{serviceLabel(idx, s)}</td><td>{[...agg.byService.get(k)].slice(0, 8).map((id) => <span key={id} className="bp-ev" onClick={() => openFlow(id)}>{entryLabel(id)} →</span>)}{agg.byService.get(k).size > 8 ? <span className="tag"> +{agg.byService.get(k).size - 8}</span> : null}</td></tr>)}</tbody></table>
        )}
      </section>
      <section>
        <h3>⇢ Forms it opens</h3>
        {!sum ? <p className="note">Tracing…</p> : !agg.navs.size ? <p className="tag">No navigation found.</p> : (
          <table className="bp-mini"><tbody>{[...agg.navs].sort().map((n) => <tr key={n}><td className="mono">{n}</td><td>{[...agg.byNav.get(n)].slice(0, 8).map((id) => <span key={id} className="bp-ev" onClick={() => openFlow(id)}>{entryLabel(id)} →</span>)}</td></tr>)}</tbody></table>
        )}
      </section>
      <section>
        <h3>⇠ Data in — what the controller reacts to</h3>
        {!inKeys ? <p className="note">Reading…</p> : !inKeys.length ? <p className="tag">No updateFormUI / willUpdateUI / onNavigate / stored-data reads found.</p> : inKeys.map((x) => (
          <div key={x.fn} className="bp-in">
            <b className="mono">{x.fn}</b> <span className="tag">{short(x.m.rel)}:{x.m.line}</span>
            {x.conds.length > 0 && <div className="bp-conds">{x.conds.slice(0, 60).map(([c, l]) => <code key={c} title={`line ${l}`}>{c.replace(/^if \(|\)$/g, "")}</code>)}{x.conds.length > 60 ? <span className="tag"> +{x.conds.length - 60}</span> : null}</div>}
            {x.reads.length > 0 && <div className="tag">reads stored data: <span className="mono">{[...new Set(x.reads.map((r) => r || "(name at run time)"))].join(", ")}</span></div>}
          </div>
        ))}
      </section>
      <section>
        <h3>⇠ Who opens or updates it</h3>
        {!A.arrivals.length ? <p className="tag">No literal reference found in presentation or controller code.</p> : (
          <table className="bp-mini"><tbody>{A.arrivals.map((a) => <tr key={a.id} className="clickable" onClick={() => openFlow(a.id)}><td className="mono">{a.label}</td><td className="tag">{a.source} · line {a.lines.join(", ")}</td><td><span className="bp-link">trace →</span></td></tr>)}</tbody></table>
        )}
      </section>
    </div>
  );
}

/* ================================================================ code flow breakdown */
export function BlueprintFlow({ idx, formKey, setForm, entryId, setEntry, cache, external }) {
  const f = useMemo(() => (formKey && idx.forms.get(formKey)) || (external ? { key: "(function)", name: null, module: external.cls.module } : null), [idx, formKey, external]);
  const [A, setA] = useState(null);
  const [T, setT] = useState(null);
  const [view, setView] = useState("seq");
  const [onlyEffect, setOnlyEffect] = useState(true);
  const [sel, setSel] = useState(null); // { rel, line, from, to }
  const [q, setQ] = useState("");
  const [dev, setDev] = useState(false);
  const [info, setInfo] = useState(null);
  useEffect(() => { let alive = true; if (formKey) widgetInfo(idx, formKey).then((m) => alive && setInfo(m)); else setInfo(new Map()); return () => { alive = false; }; }, [idx, formKey]);
  useEffect(() => {
    if (!f || !formKey) return;
    let alive = true;
    (async () => {
      let base = cache.get("form:" + formKey);
      if (!base) { const r = await formActions(idx, formKey); const arr = await formArrivals(idx, f.name); base = { ...r, arrivals: arr.map((a, i) => ({ id: `arr:${i}:${a.cls.id}#${a.member.name}`, group: "arrival", source: a.how.join(", "), widget: clsLabel(a.cls), event: a.member.name, label: `${clsLabel(a.cls)}.${a.member.name}`, cls: a.cls, member: a.member, lines: a.lines })) }; cache.set("form:" + formKey, base); }
      if (alive) setA(base);
    })();
    return () => { alive = false; };
  }, [idx, formKey, f, cache]);
  const entries = A ? [...A.entries, ...A.arrivals] : [];
  const entry = external || entries.find((e) => e.id === entryId) || null;
  useEffect(() => {
    if (!entry || !entry.member || !f) { setT(null); return; }
    let alive = true;
    setT(null); setSel(null);
    cachedTrace(idx, cache, entry, f).then((t) => alive && setT(t));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, f, entry && entry.id, cache]);
  if (!f) return <Picker title="Form" items={[...idx.forms.keys()].sort((a, b) => a.split("/").pop().localeCompare(b.split("/").pop()))} onPick={setForm} render={(k) => `${k.split("/").pop()}  ·  ${k.split("/").slice(0, -1).join("/")}`} />;
  const ql = q.toLowerCase();
  const nice = (e) => (info ? triggerText(e, info) : e.label);
  const groups = ["action", "lifecycle", "arrival"].map((g) => [g, entries.filter((e) => e.group === g && (!ql || e.label.toLowerCase().includes(ql) || nice(e).toLowerCase().includes(ql)))]);
  const FRIENDLY = { action: "Things you can do", lifecycle: "When the screen opens or changes", arrival: "Opened from elsewhere in the app" };
  return (
    <div className="bp-page">
      <h2 className="page">⇄ Code flow breakdown · {f.name || external.label}</h2>
      <div className="crumb">Pick something a person can do on this screen and watch, step by step, what the app does — on screen, behind the scenes and with the bank's systems — and where it ends up.</div>
      <div className="bp-flowgrid">
        <div className="bp-list bp-entries">
          <input type="text" placeholder="Find an action…" value={q} onChange={(e) => setQ(e.target.value)} />
          {!A && formKey && <p className="note">Reading actions…</p>}
          {external && <div className="bp-item sel"><span className="mono">{external.label}</span><span className="tag">started from a function</span></div>}
          {groups.map(([g, rows]) => rows.length > 0 && (
            <div key={g}>
              <div className="bp-ghead">{FRIENDLY[g]} · {rows.length}</div>
              {rows.map((e) => (
                <div key={e.id} className={"bp-item fj-entry" + (entry && entry.id === e.id ? " sel" : "") + (e.member ? "" : " dead")} onClick={() => e.member && setEntry(e.id)} title={`${e.label} · ${e.source}`}>
                  <span>{nice(e)}</span><span className="tag mono">{e.label}{e.member ? "" : " · handler not found"}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="bp-flowmain">
          {!entry ? <div className="fj-empty"><div className="fj-emptyico">👈</div><b>Pick something to do on the left</b><span>For example a button to click — you'll see what happens, one step at a time.</span></div> : !T || !info ? <p className="note">Following {entry.label} through the code…</p> : !dev ? (
            <>
              <FlowJourney entry={entry} T={T} info={info} formName={f.name} onCode={(c) => c && setSel(c)} onDeveloper={() => setDev(true)} />
              {sel && (
                <div className="bp-drawer">
                  <div className="bp-drawerhead"><div className="bp-selhead">{sel.title} — line {sel.line}</div><button className="btn ghost" onClick={() => setSel(null)}>✕ Close</button></div>
                  <Code idx={idx} rel={sel.rel} from={sel.from} to={sel.to} hl={sel.line} />
                </div>
              )}
            </>
          ) : (
            <>
              <div className="bp-devbar"><button className="btn" onClick={() => { setDev(false); setSel(null); }}>← Back to the story</button><span className="tag">Developer view: every call, callback and condition, with the code.</span></div>
              <FlowStory idx={idx} entry={entry} T={T} />
              <div className="bp-flowbar">
                <div className="seg" style={{ margin: 0 }}><button className={view === "seq" ? "on" : ""} onClick={() => setView("seq")}>Sequence diagram</button><button className={view === "tree" ? "on" : ""} onClick={() => setView("tree")}>Call tree</button></div>
                <span className={"chip" + (onlyEffect ? " on" : "")} onClick={() => setOnlyEffect((v) => !v)}>{onlyEffect ? "✓ " : ""}only steps that reach a service, a navigation or the screen</span>
                <span className="tag">Click any step to see its code · {nf(T.nodes)} function calls followed{T.truncated ? " · stopped at the depth limit on some paths (marked …)" : ""}</span>
              </div>
              <div className="bp-flowbody">
                <div className="bp-flowview">
                  {view === "seq" ? <Sequence entry={entry} T={T} onlyEffect={onlyEffect} onPick={setSel} sel={sel} /> : <CallTree T={T} onlyEffect={onlyEffect} onPick={setSel} sel={sel} />}
                </div>
                {sel && (
                  <div className="bp-drawer">
                    <div className="bp-drawerhead"><div className="bp-selhead">{sel.title}</div><button className="btn ghost" onClick={() => setSel(null)}>✕ Close</button></div>
                    {sel.cond && <div className="tag" style={{ marginBottom: 6 }}>only {sel.cond}</div>}
                    <Code idx={idx} rel={sel.rel} from={sel.from} to={sel.to} hl={sel.line} />
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// the flow in plain words: what happens, in order, for the steps that matter
export function FlowStory({ idx, entry, T }) {
  const lines = [];
  const seen = new Set();
  const walk = (n, depth) => {
    if (!n || seen.has(n.uid) || lines.length > 40) return;
    seen.add(n.uid);
    const ws = [];
    for (const e of n.edges) {
      if (!e.effect) continue;
      const s = e.step;
      if (e.kind === "pc" || e.kind === "bc" || e.kind === "ctrl") { if (e.child) lines.push({ d: depth, t: <>→ <b>{LAYER_LABEL[e.child.layer]}</b> <span className="mono">{e.child.clsLabel}.{e.child.name}</span></> }); walk(e.child, depth + 1); }
      else if (e.kind === "self" || e.kind === "local") walk(e.child, depth);
      else if (e.kind === "service") {
        lines.push({ d: depth, t: <>⇒ calls <b>service</b> <span className="mono">{serviceLabel(idx, s)}</span></> });
        for (const r of e.returns || []) { if (r.node) { lines.push({ d: depth + 1, t: <>↩ when it answers, <span className="mono">{r.label}</span> runs in <span className="mono">{r.node.clsLabel}</span></> }); walk(r.node, depth + 1); } }
      } else if (e.kind === "param" && e.child) { lines.push({ d: depth, t: <>↩ calls back <span className="mono">{e.child.clsLabel}.{e.child.name}</span>{s.conds.length ? <span className="tag"> — {s.conds[s.conds.length - 1]}</span> : null}</> }); walk(e.child, depth + 1); }
      else if (e.kind === "nav") lines.push({ d: depth, t: <>⇢ opens form <b className="mono">{s.form || `chosen at run time (${s.formExpr})`}</b></> });
      else if ((e.kind === "updateForm" || e.kind === "present") && e.child) { lines.push({ d: depth, t: <>⇠ sends <span className="mono">{s.keys ? s.keys.map((k) => k.key).join(", ") : "data"}</span> back to <b className="mono">{e.target}</b> → <span className="mono">{e.child.name}</span></> }); walk(e.child, depth + 1); }
      else if (e.kind === "widget") ws.push(e.path || s.path || "(form)");
      else if (e.kind === "compEvent") { lines.push({ d: depth, t: <>↩ the component raises <span className="mono">{e.event}</span>{e.child ? <> → the form handles it in <span className="mono">{e.child.clsLabel}.{e.child.name}</span></> : " (no handler on this form)"}</> }); walk(e.child, depth + 1); }
      else if (e.kind === "compCall") { lines.push({ d: depth, t: <>→ calls component <span className="mono">{e.comp}</span></> }); walk(e.child, depth + 1); }
      else if (e.kind === "infoSet") lines.push({ d: depth, t: <>• stores data for later under <span className="mono">{s.key || "(run time)"}</span></> });
    }
    if (ws.length) lines.push({ d: depth, t: <>▣ changes on screen: <span className="mono">{list([...new Set(ws)], 8)}</span></> });
  };
  walk(T.root, 0);
  return (
    <div className="bp-story">
      <div className="bp-storyhead">When <b className="mono">{entry.label}</b> {entry.group === "arrival" ? "runs" : "happens"}, <span className="mono">{T.root.clsLabel}.{T.root.name}</span> runs{entry.source ? <span className="tag"> ({entry.source})</span> : null}.</div>
      {lines.length ? <ol>{lines.slice(0, 40).map((l, i) => <li key={i} style={{ marginLeft: l.d * 14 }}>{l.t}</li>)}</ol> : <p className="tag">This action reaches no service, navigation or screen change that can be read from the code. Turn off “only steps that reach…” below to see every call it makes.</p>}
      {lines.length > 40 && <p className="tag">First 40 steps shown — the full flow is below.</p>}
    </div>
  );
}

// rows of the sequence diagram, in the order the code runs them
function seqRows(entry, T, onlyEffect) {
  const rows = [];
  const lane = (l) => LAYERS.indexOf(l);
  rows.push({ from: 0, to: lane(T.root.layer), label: entry.group === "arrival" ? `${entry.label}` : `${entry.label} (user / form event)`, node: T.root, line: T.root.line, kind: "start" });
  const seen = new Set(), rowOf = new Map([[T.root.uid, 1]]);
  const into = (child) => { if (child && !rowOf.has(child.uid)) rowOf.set(child.uid, rows.length); };
  const walk = (n) => {
    if (!n) return;
    if (n.ref) { rows.push({ from: lane(n.layer), to: lane(n.layer), label: `${n.name}() — same as step ${rowOf.get(n.ref) || "?"} above`, node: n, line: n.line, kind: "ref", mute: true }); return; }
    if (n.cycle) { rows.push({ from: lane(n.layer), to: lane(n.layer), label: `${n.name}() — already running on this path (loop)`, node: n, line: n.line, kind: "ref", mute: true }); return; }
    if (n.cut) { rows.push({ from: lane(n.layer), to: lane(n.layer), label: `${n.name}() … stopped at the depth limit`, node: n, line: n.line, kind: "ref", mute: true }); return; }
    if (seen.has(n.uid)) return;
    seen.add(n.uid);
    const me = lane(n.layer);
    for (const e of n.edges) {
      if (onlyEffect && !e.effect) continue;
      const s = e.step, base = { node: n, line: s.line, cond: s.conds[s.conds.length - 1], step: s, uid: n.uid };
      switch (e.kind) {
        case "self": case "local": rows.push({ ...base, from: me, to: me, label: `${s.fn || s.name}()`, kind: "self" }); into(e.child); walk(e.child); break;
        case "pc": case "bc": case "ctrl":
          rows.push({ ...base, from: me, to: e.child ? lane(e.child.layer) : me, label: e.kind === "ctrl" ? `${s.form}.${s.fn}()` : `${s.module}.${s.fn}()`, kind: "call", missing: e.missing });
          into(e.child); walk(e.child); break;
        case "service":
          rows.push({ ...base, from: me, to: 4, label: `${s.obj}.${s.verb}`, kind: "service" });
          for (const r of e.returns || []) if (r.node) { rows.push({ ...base, from: 4, to: lane(r.node.layer), label: `↩ answer → ${r.label}`, kind: "return" }); into(r.node); walk(r.node); }
          break;
        case "param":
          if (e.child) { rows.push({ ...base, from: me, to: lane(e.child.layer), label: `↩ ${s.name}() → ${e.child.clsLabel}.${e.child.name}`, kind: "return" }); into(e.child); walk(e.child); }
          else rows.push({ ...base, from: me, to: me, label: `↩ calls back ${s.name}() (given by its caller)`, kind: "self", mute: true });
          break;
        case "updateForm": case "present":
          rows.push({ ...base, from: me, to: 1, label: `↩ ${e.kind === "present" ? "presentUserInterface" : "updateForm"} → ${e.target || "?"}.${e.child ? e.child.name : "?"}  {${s.keys ? s.keys.map((k) => k.key).join(", ") : "data"}}`, kind: "return", missing: e.missing });
          into(e.child); walk(e.child); break;
        case "nav": rows.push({ ...base, from: me, to: 0, label: `opens ${s.form || "(form chosen at run time)"}`, kind: "nav" }); break;
        case "widget": rows.push({ ...base, from: me, to: 0, label: `${e.path || s.path || "(form)"} ${s.action}`, kind: "widget" }); break;
        case "compEvent": rows.push({ ...base, from: me, to: 1, label: `↩ raises ${e.event}${e.child ? ` → ${e.child.clsLabel}.${e.child.name}` : " (not handled)"}`, kind: "return" }); into(e.child); walk(e.child); break;
        case "compCall": rows.push({ ...base, from: me, to: 1, label: `${e.comp}.${s.action}`, kind: "call" }); into(e.child); walk(e.child); break;
        case "infoSet": rows.push({ ...base, from: me, to: me, label: `stores "${s.key || "?"}" (setCustomInfo)`, kind: "self" }); break;
        case "unresolved": rows.push({ ...base, from: me, to: me, label: `? ${s.what} — ${s.why}`, kind: "self", mute: true }); break;
        default: break;
      }
    }
  };
  walk(T.root);
  return rows;
}

function Sequence({ entry, T, onlyEffect, onPick, sel }) {
  const rows = useMemo(() => seqRows(entry, T, onlyEffect), [entry, T, onlyEffect]);
  const W = 1000, X = [70, 270, 470, 670, 880], RH = 30, TOP = 54;
  const H = TOP + rows.length * RH + 20;
  const shownRows = rows.slice(0, 1500);
  const pick = (r, i) => onPick({ rel: r.node.rel, line: r.line, from: r.node.line, to: r.node.end, cond: r.cond, title: `${i + 1}. ${r.node.clsLabel}.${r.node.name} — line ${r.line}`, i });
  return (
    <div className="bp-seqwrap">
      <svg className="bp-seq" width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        <defs>
          <marker id="bpA" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" className="bp-ah" /></marker>
          <marker id="bpR" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" className="bp-ahr" /></marker>
        </defs>
        {LAYERS.map((l, i) => (
          <g key={l}>
            <rect x={X[i] - 78} y={6} width={156} height={30} rx={8} className={"bp-lanehead l" + i} />
            <text x={X[i]} y={26} textAnchor="middle" className="bp-lanet">{LAYER_LABEL[l]}</text>
            <line x1={X[i]} y1={36} x2={X[i]} y2={H} className="bp-life" />
          </g>
        ))}
        {shownRows.map((r, i) => {
          const y = TOP + i * RH + RH / 2;
          const on = sel && sel.i === i;
          const cls = `bp-msg k-${r.kind}${r.mute ? " mute" : ""}${on ? " on" : ""}${r.missing ? " miss" : ""}`;
          const lx = Math.min(X[r.from], X[r.to]);
          if (r.from === r.to) {
            const x = X[r.from];
            return (
              <g key={i} className={cls} onClick={() => pick(r, i)} style={{ "--d": Math.min(i, 60) * 25 + "ms" }}>
                <rect x={0} y={y - RH / 2} width={W} height={RH} className="bp-hit" />
                <path d={`M${x},${y - 6} h18 v12 h-18`} className="bp-line" markerEnd="url(#bpA)" />
                <text x={x + 24} y={y + 4} className="bp-ml">{i + 1}. {trunc(r.label, 74)}</text>
              </g>
            );
          }
          return (
            <g key={i} className={cls} onClick={() => pick(r, i)} style={{ "--d": Math.min(i, 60) * 25 + "ms" }}>
              <rect x={0} y={y - RH / 2} width={W} height={RH} className="bp-hit" />
              <line x1={X[r.from]} y1={y + 4} x2={X[r.to]} y2={y + 4} className="bp-line" markerEnd={r.kind === "return" ? "url(#bpR)" : "url(#bpA)"} />
              <text x={lx + 6} y={y - 2} className="bp-ml">{i + 1}. {trunc(r.label, Math.max(26, Math.round(Math.abs(X[r.to] - X[r.from]) / 6.4)))}{r.missing ? " — missing" : ""}</text>
            </g>
          );
        })}
      </svg>
      {rows.length > 1500 && <p className="tag">First 1,500 steps drawn. Switch to the call tree for the rest.</p>}
    </div>
  );
}
const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

function CallTree({ T, onlyEffect, onPick, sel }) {
  const [closed, setClosed] = useState(() => new Set());
  const toggle = (k) => setClosed((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const node = (n, d, key) => {
    const kids = [];
    for (const [i, e] of n.edges.entries()) {
      if (onlyEffect && !e.effect) continue;
      kids.push(<EdgeRow key={key + "." + i} e={e} n={n} d={d + 1} k={key + "." + i} closed={closed} toggle={toggle} onPick={onPick} sel={sel} node={node} />);
    }
    return kids;
  };
  return (
    <div className="bp-ctree">
      <div className={"bp-cn l-" + T.root.layer} onClick={() => onPick({ rel: T.root.rel, line: T.root.line, from: T.root.line, to: T.root.end, title: `${T.root.clsLabel}.${T.root.name}` })}>
        <span className="bp-lay">{LAYER_LABEL[T.root.layer]}</span> <b className="mono">{T.root.clsLabel}.{T.root.name}</b> <span className="tag">{short(T.root.rel)}:{T.root.line}</span>
      </div>
      {node(T.root, 0, "r")}
    </div>
  );
}
function EdgeRow({ e, n, d, k, closed, toggle, onPick, sel, node }) {
  const s = e.step;
  const child = e.child;
  const isOpen = !closed.has(k);
  const pick = () => onPick({ rel: n.rel, line: s.line, from: n.line, to: n.end, cond: s.conds[s.conds.length - 1], title: `${n.clsLabel}.${n.name} — line ${s.line}`, k });
  const kids = [];
  if (child && !child.ref && !child.cycle && !child.cut) kids.push(...node(child, d, k));
  for (const [j, r] of (e.returns || []).entries()) if (r.node) {
    kids.push(
      <div key={k + "r" + j} style={{ marginLeft: (d + 1) * 18 }}>
        <div className={"bp-cn ret l-" + r.node.layer} onClick={() => onPick({ rel: r.node.rel, line: r.node.line, from: r.node.line, to: r.node.end, title: `${r.node.clsLabel}.${r.node.name}` })}>
          <span className="bp-lay">↩ answer</span> <b className="mono">{r.label}</b> <span className="tag">runs {r.node.clsLabel}.{r.node.name} · {short(r.node.rel)}:{r.node.line}</span>
        </div>
        {!r.node.ref && !r.node.cycle && node(r.node, d + 1, k + "r" + j)}
      </div>
    );
  }
  return (
    <div style={{ marginLeft: d * 18 }}>
      <div className={"bp-cn k-" + e.kind + (sel && sel.k === k ? " on" : "")} onClick={pick}>
        {kids.length > 0 ? <span className="bp-tog" onClick={(ev) => { ev.stopPropagation(); toggle(k); }}>{isOpen ? "▾" : "▸"}</span> : <span className="bp-tog">·</span>}
        <span className="tag">L{s.line}</span> {stepText(s, e)}
        {child && <span className="tag"> → <span className={"bp-lay l-" + child.layer}>{LAYER_LABEL[child.layer]}</span> {child.clsLabel}.{child.name}{child.ref ? ` (same as #${child.ref}, shown above)` : child.cycle ? " (loop)" : child.cut ? " (depth limit)" : ""}</span>}
        {e.missing && <span className="bp-warn"> — {e.missing}</span>}
        {s.conds.length > 0 && <div className="bp-cond">only {s.conds[s.conds.length - 1]}</div>}
      </div>
      {isOpen && kids}
    </div>
  );
}
