// Move to R26 (TemplateTwin, COMP-are and FormForge): KBZ's changes to one segment template, user widget or form,
// change by change, onto its R26 copies.
// R21 = base, KBZ = the customisation, R26 = target (lib/segmerge.js sorts every change: clean / already in R26 /
// conflict / removal). Pick what moves, see KBZ · R26 now · the result drawn, then write the whole merged widget
// folder for every ticked R26 copy into a separate output folder (server/output.js). Nothing is generated while a
// conflict is undecided or an added widget has no parent.
import { useState, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { renderTemplate, renderForm, previewAssets } from "../lib/preview";
import { versionIndex } from "../lib/visual";
import { partsOf } from "../lib/components";
import { looseJson } from "../lib/blueprint";
import { mergeRows, defaultChoice, applyMerge, dependencyIssues, fileStyle, templateFiles, rowLabel, aboutOf, breakpointOf, ruleChoice } from "../lib/segmerge";
import "./widgetdialog.css";
import "./segmerge.css";

const WIDTHS = [[768, "768"], [1024, "1024"], [1366, "1366"]];
const FORM_H = 900; // a form is drawn as a screen this tall (it scrolls inside)
const KIND = { prop: "property", add: "widget added", remove: "widget removed", parent: "new parent", order: "child order", gone: "R26 dropped it" };
const STATE = { clean: "clean", already: "already in R26", conflict: "conflict", removal: "removal" };
const HL = `
.kw.mg-add>.kin{outline:2px solid #2f9e5b;outline-offset:-2px;box-shadow:inset 0 0 0 9999px rgba(47,158,91,.13)}
.kw.mg-chg>.kin{outline:2px dashed #d99a14;outline-offset:-2px;box-shadow:inset 0 0 0 9999px rgba(230,163,35,.12)}
.kw.mg-del>.kin{outline:2px solid #d64545;outline-offset:-2px;box-shadow:inset 0 0 0 9999px rgba(214,69,69,.13)}
.kw.mg-sel>.kin{outline:3px solid #F26A21!important;outline-offset:-3px}
.kw:hover>.kin{outline:1px solid rgba(242,106,33,.6);outline-offset:-1px;cursor:pointer}
`;
const short = (v, n = 34) => { if (v === undefined) return "∅"; const s = typeof v === "string" ? v : JSON.stringify(v); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
const full = (v) => (v === undefined ? "(not set)" : typeof v === "string" ? v : JSON.stringify(v, null, 2));
const OUT_KEY = "rs.mergeOut";
const NONE = {};

async function readSet(map) {
  const W = {}, raw = {};
  if (!map) return { W, raw };
  const entries = [...map];
  const texts = await Promise.all(entries.map(([, f]) => f.text()));
  entries.forEach(([id], k) => { raw[id] = texts[k]; try { W[id] = JSON.parse(texts[k].replace(/^\uFEFF/, "")); } catch { /* unreadable widget file */ } });
  return { W, raw };
}

// every i18n key R26 has: each project's own i18n.json (R26 keeps one in several micro apps), every language
const i18nOf = new WeakMap();
function i18nKeys(p) {
  if (!i18nOf.has(p)) i18nOf.set(p, (async () => {
    const keys = new Set();
    const files = p.appFiles ? [...p.appFiles.values()].flat() : p.all || [];
    const roots = files.filter((f) => /^(?:[^/]+\/){1,2}i18n\.json$/i.test((f.webkitRelativePath || "").replace(/\\/g, "/")));
    for (const t of await Promise.all(roots.map((f) => f.text()))) {
      const j = looseJson(t);
      for (const loc of Object.values((j && j.locales) || {})) for (const k of Object.keys((loc && (loc.i18nStrings || loc)) || {})) keys.add(k);
    }
    return keys;
  })());
  return i18nOf.get(p);
}

// what the popup merges — one segment template or one user widget:
// { noun, name, ch, baseFiles, kbzFiles: Map(id -> File), copies: [{ app, label, best, score, path (output folder),
//   files() -> { map: Map(id -> File), other: [names of non-widget files] } }] }

// one widget folder inside one R26 micro app: its widget files and anything else lying in it (a sub-folder as "name/")
function folderFiles(p26, app, dir) {
  const map = new Map(), other = [];
  for (const f of (p26.appFiles && p26.appFiles.get(app)) || p26.all || []) {
    const rel = (f.webkitRelativePath || "").replace(/\\/g, "/");
    const k = rel.indexOf(dir);
    if (k < 0) continue;
    const rest = rel.slice(k + dir.length);
    if (rest.includes("/")) { const d = rest.slice(0, rest.indexOf("/") + 1); if (!other.includes(d)) other.push(d); continue; }
    if (/\.json$/i.test(rest)) map.set(rest.slice(0, -5), f); else other.push(rest);
  }
  return { map, other };
}
// a form built on a form template keeps the widgets placed in the template in __<instance>__/ sub-folders: writing the
// folder whole would drop them, so such an R26 form is not generated
const templateDirs = (other) => (other || []).filter((x) => /^__.+__\/$/.test(x));

// a form: the R26 form the micro-app map matched (x = its row), then the other candidates (same name elsewhere, same
// root kuid). Written to <MA>/forms/<channel>/<R26 module>/<R26 name>.sm (monolith R26: forms/<channel>/<module>/…)
export function formSource(r, picked, x) {
  const p26 = picked[2];
  const ch = r.key.split("/")[0];
  const base = { noun: "form", render: "form", name: r.name, ch, baseFiles: picked[0] && picked[0].forms.get(r.key), kbzFiles: picked[1] && picked[1].forms.get(r.key), rules: true };
  if (p26 && !p26.appFiles) { // R26 as a monolith: the same form key
    return { ...base, copies: p26.forms && p26.forms.has(r.key) ? [{ app: "", label: r.name, best: true, path: `forms/${r.key}`, files: () => ({ ...folderFiles(p26, "", `/forms/${r.key}/`), map: p26.forms.get(r.key) }) }] : [] };
  }
  const list = x && x.copies && x.copies.length && x.target ? x.copies : [];
  return {
    ...base,
    copies: list.map((c, i) => ({
      app: c.app, label: c.name, best: i === 0, score: c.score, path: `${c.app}/forms/${c.key}`,
      files: () => folderFiles(p26, c.app, `/forms/${c.key}/`),
    })),
  };
}

// a segment template: the R26 copy TemplateTwin compared, then every other copy
export function segmentSource(r, picked, x) {
  const p26 = picked[2], ch = r.channel;
  const list = [];
  const best = r.copies[2];
  if (best) list.push({ app: best.app, name: best.name, best: true });
  for (const a of (x && x.alts) || []) if (!list.some((c) => c.app === a.app && c.name === a.name)) list.push({ app: a.app, name: a.name, score: a.score });
  return {
    noun: "template", name: r.name, ch,
    baseFiles: picked[0].segs.get(r.key), kbzFiles: picked[1].segs.get(r.key),
    copies: list.map((c) => ({
      ...c, label: c.name, path: `${c.app ? c.app + "/" : ""}templates/${ch}/segments/${c.name}.sm`,
      files: () => {
        const f = folderFiles(p26, c.app, `/templates/${ch}/segments/${c.name}.sm/`);
        return c.best && p26.segs && p26.segs.get(r.key) ? { ...f, map: p26.segs.get(r.key) } : f;
      },
    })),
  };
}

// a user widget: its userwidgetmodel.sm widget files; the R26 copy the micro-app map chose, then every other copy
// (R26 may keep it under another namespace — the folder is written under R26's own name). perCopy: R26 uses per copy
// ("app/key" -> n, from usesPerCopy) — the copies forms use start ticked
export function componentSource(r, picked, x, perCopy) {
  const p26 = picked[2];
  const structure = (p) => { const parts = p && p.comps && p.comps.get(r.key) ? partsOf(r.key, p.comps.get(r.key)) : null; return parts ? parts.structure : null; };
  const base = { noun: "component", name: r.name, ch: "desktop", baseFiles: structure(picked[0]), kbzFiles: structure(picked[1]) };
  // R26 as a monolith (monolith → monolith): one copy, in the project itself
  if (p26 && !p26.appFiles) {
    return { ...base, copies: p26.comps && p26.comps.has(r.key) ? [{ app: "", label: r.key, best: true, path: `userwidgets/${r.key}/userwidgetmodel.sm`, files: () => ({ map: structure(p26), other: [] }) }] : [] };
  }
  let list = x && x.copies && x.copies.length ? x.copies : [];
  if (!list.length && p26 && p26.compApp && p26.compApp.get(r.key)) list = [{ app: p26.compApp.get(r.key), key: x && x.target ? x.target.key : r.key, score: null }];
  return {
    ...base,
    copies: list.map((c, i) => ({
      app: c.app, label: c.key, best: i === 0, score: c.score, path: `${c.app}/userwidgets/${c.key}/userwidgetmodel.sm`,
      uses: perCopy ? perCopy.get(`${c.app}/${c.key}`) || 0 : null,
      files: () => folderFiles(p26, c.app, `/userwidgets/${c.key}/userwidgetmodel.sm/`),
    })),
  };
}
// the copies ticked to begin with: those R26 forms use (when known), else the copy compared
const firstTicked = (copies) => {
  const used = copies.map((c, i) => (c.uses ? i : -1)).filter((i) => i >= 0);
  return new Set(used.length ? used : [0]);
};

// rules / setRules (forms): conflict decisions kept for every form ([{ by: "about" | "bp", k, choice }]) — applied to the
// conflicts of every form opened, and set from the "every form" buttons
export function SegmentMerge({ source, picked, labels, onClose, rules, setRules }) {
  const [O, C, N] = labels;
  const p26 = picked[2];
  const copies = source.copies;
  const [base, setBase] = useState(null); // { W0, W1 }
  const [data, setData] = useState({}); // copy index -> { W2, raw2, rows, style, other }
  const [include, setInclude] = useState(() => firstTicked(copies));
  const [active, setActive] = useState(0);
  const [choices, setChoices] = useState({}); // copy index -> { rid: "kbz" | "r26" }
  const [parentFor, setParentFor] = useState({}); // copy index -> { rid: parent id }
  const [assets, setAssets] = useState({}); // "kbz" | copy index -> previewAssets
  const [show, setShow] = useState(new Set(["conflict", "clean", "removal"]));
  const [showDesign, setShowDesign] = useState(false); // design-time / kuid rows: kept as R26, listed on request
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(null); // widget id
  const [width, setWidth] = useState(1024);
  const [out, setOut] = useState(() => { try { return localStorage.getItem(OUT_KEY) || ""; } catch { return ""; } });
  const [gen, setGen] = useState(null); // { running } | { done: [...], errors: [...] }
  const rulesNow = useRef(rules || []);
  rulesNow.current = rules || [];
  const canRule = !!(source.rules && setRules);

  useEffect(() => { const k = (e) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  useEffect(() => {
    let alive = true;
    (async () => {
      const [a, b] = await Promise.all([readSet(source.baseFiles), readSet(source.kbzFiles)]);
      if (alive) setBase({ W0: a.W, W1: b.W });
      const ka = await previewAssets(versionIndex(picked[1], "", source.ch));
      if (alive) setAssets((s) => ({ ...s, kbz: ka }));
    })();
    return () => { alive = false; };
  }, [picked, source]);
  // a copy's files and rows, read when it is opened or ticked
  const loading = useRef(new Set());
  useEffect(() => {
    if (!base) return;
    for (const i of new Set([active, ...include])) {
      if (data[i] || loading.current.has(i)) continue;
      loading.current.add(i);
      (async () => {
        const c = copies[i];
        const { map, other } = c.files();
        const { W, raw } = await readSet(map);
        const rows = mergeRows(base.W0, base.W1, W);
        setData((d) => ({ ...d, [i]: { W2: W, raw2: raw, rows, style: fileStyle(Object.values(raw)[0]), other } }));
        // conflicts a saved rule decides start decided
        setChoices((s) => ({ ...s, [i]: Object.fromEntries(rows.map((row) => [row.rid, (row.state === "conflict" && !row.design && ruleChoice(row, rulesNow.current)) || defaultChoice(row)])) }));
        const [ra, keys] = await Promise.all([previewAssets(versionIndex(p26, c.app, source.ch)), i18nKeys(p26)]);
        setAssets((s) => ({ ...s, [i]: ra, i18n: keys }));
      })();
    }
  }, [base, active, include, copies, p26, source, data]);

  const D = data[active];
  const ch = choices[active] || NONE;
  const pf = parentFor[active] || NONE;
  const merged = useMemo(() => (base && D ? applyMerge(base.W1, D.W2, D.rows, ch, pf) : null), [base, D, ch, pf]);
  const issues = useMemo(() => (merged && assets[active] ? dependencyIssues(D.rows, ch, merged, assets.kbz, assets[active], assets.i18n) : []), [merged, assets, active, D, ch]);
  const problemOf = useMemo(() => new Map((merged ? merged.problems : []).map((p) => [p.rid, p.text])), [merged]);
  const issuesOf = useMemo(() => { const m = new Map(); for (const i of issues) if (i.rid) { if (!m.has(i.rid)) m.set(i.rid, []); m.get(i.rid).push(i); } return m; }, [issues]);

  const setChoice = (rid, v) => setChoices((s) => ({ ...s, [active]: { ...s[active], [rid]: v } }));
  const setMany = (pred, v) => setChoices((s) => ({ ...s, [active]: { ...s[active], ...Object.fromEntries(D.rows.filter(pred).map((row) => [row.rid, v])) } }));
  const setParent = (rid, p) => setParentFor((s) => ({ ...s, [active]: { ...s[active], [rid]: p } }));

  // per copy: what still blocks generating
  const blockers = (i) => {
    const d = data[i], c = choices[i];
    if (!d || !c) return ["still reading"];
    const out = [];
    const tpl = templateDirs(d.other);
    if (tpl.length) out.push(`built on a form template (${tpl.join(", ")}) — not supported yet`);
    const undecided = d.rows.filter((row) => row.state === "conflict" && !c[row.rid]).length;
    if (undecided) out.push(`${undecided} conflict${undecided === 1 ? "" : "s"} to decide`);
    const m = applyMerge(base.W1, d.W2, d.rows, c, parentFor[i] || {});
    if (m.problems.length) out.push(`${m.problems.length} widget${m.problems.length === 1 ? "" : "s"} without a parent`);
    return out;
  };
  const blocked = [...include].map((i) => [i, base ? blockers(i) : ["still reading"]]).filter(([, b]) => b.length);
  const canGenerate = base && include.size && !blocked.length && out.trim() && !(gen && gen.running);

  const generate = async () => {
    setGen({ running: true });
    try { localStorage.setItem(OUT_KEY, out.trim()); } catch { /* remembered for this session only */ }
    const done = [], errors = [];
    for (const i of include) {
      const d = data[i], c = copies[i];
      const m = applyMerge(base.W1, d.W2, d.rows, choices[i], parentFor[i] || {});
      const files = templateFiles(m, d.W2, d.raw2, d.style);
      try {
        const res = await fetch("/api/output/template", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ root: out.trim(), dir: c.path, files }) });
        const j = await res.json().catch(() => ({}));
        if (!res.ok || j.error) throw new Error(j.error || `HTTP ${res.status}`);
        const moved = d.rows.filter((row) => choices[i][row.rid] === "kbz").length;
        done.push({ copy: c, path: j.path, written: j.written, moved, changedFiles: [...m.touched].filter((id) => m.W[id]).length, removed: Object.keys(d.W2).filter((id) => !m.W[id]).length, other: d.other });
      } catch (e) { errors.push({ copy: c, error: String(e.message || e) }); }
    }
    setGen({ done, errors });
  };

  // the change list, grouped by widget
  const counts = useMemo(() => {
    const n = { clean: 0, already: 0, conflict: 0, removal: 0, undecided: 0, moving: 0, design: 0, designMoving: 0 };
    if (!D) return n;
    for (const row of D.rows) {
      if (ch[row.rid] === "kbz") n.moving++;
      if (row.design) { n.design++; if (ch[row.rid] === "kbz") n.designMoving++; continue; }
      n[row.state]++; if (row.state === "conflict" && !ch[row.rid]) n.undecided++;
    }
    return n;
  }, [D, ch]);
  const groups = useMemo(() => {
    if (!D) return [];
    const ql = q.trim().toLowerCase();
    const m = new Map();
    for (const row of D.rows) {
      if (row.design ? !showDesign : !show.has(row.state)) continue;
      if (ql && !(row.wid.toLowerCase().includes(ql) || (row.kind === "prop" && rowLabel(row).toLowerCase().includes(ql)) || KIND[row.kind].includes(ql))) continue;
      if (!m.has(row.wid)) m.set(row.wid, []);
      m.get(row.wid).push(row);
    }
    return [...m];
  }, [D, show, showDesign, q]);
  // conflicts by what they are about (a property, or one value of it: responsiveData › width), and — for responsiveData —
  // by breakpoint (b1 … b4), to decide many at once (here, or for every form with a saved rule)
  const conflictGroups = useMemo(() => {
    if (!D) return [];
    const m = new Map();
    const add = (by, k, label, row) => { const id = by + "|" + k; if (!m.has(id)) m.set(id, { by, k, label, total: 0, open: 0, pred: (x) => x.state === "conflict" && !x.design && (by === "bp" ? breakpointOf(x) === k : aboutOf(x) === k) }); const g = m.get(id); g.total++; if (!ch[row.rid]) g.open++; };
    for (const row of D.rows) if (row.state === "conflict" && !row.design) {
      const a = aboutOf(row);
      add("about", a, row.kind !== "prop" ? KIND[row.kind] : a, row);
      const bp = breakpointOf(row);
      if (bp) add("bp", bp, `responsiveData › ${bp} (every value at this breakpoint)`, row);
    }
    return [...m.values()].sort((a, b) => (a.by === b.by ? b.total - a.total : a.by === "about" ? -1 : 1));
  }, [D, ch]);
  const ruleOf = (g) => (rules || []).find((x) => x.by === g.by && x.k === g.k);
  // a rule for every form: kept (replacing an older one on the same thing) and applied to this form's conflicts now
  const setRule = (g, choice) => {
    setRules((rs) => [...(rs || []).filter((x) => !(x.by === g.by && x.k === g.k)), ...(choice ? [{ by: g.by, k: g.k, choice }] : [])]);
    if (choice) setMany(g.pred, choice);
  };
  const containers = useMemo(() => (merged ? Object.entries(merged.W).filter(([, w]) => Array.isArray(w.children) || /Flex|Form/.test(w.wType || "")).map(([id]) => id).sort() : []), [merged]);
  const toggleShow = (s) => setShow((v) => { const n = new Set(v); if (n.has(s)) n.delete(s); else n.add(s); return n; });

  // what the panes outline
  const marks = useMemo(() => {
    if (!merged || !D) return {};
    const res = new Map(), now = new Map();
    for (const id of merged.touched) if (merged.W[id]) res.set(id, D.W2[id] ? "chg" : "add");
    for (const id of Object.keys(D.W2)) if (!merged.W[id]) now.set(id, "del");
    return { res, now };
  }, [merged, D]);
  const c = copies[active];
  const W2sel = D && sel ? D.W2[sel] : null, Wmsel = merged && sel ? merged.W[sel] : null;

  return createPortal(
    <div className="wd-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="wd mg" role="dialog" aria-label={`Move ${C} changes to ${N}`}>
        <div className="wd-head">
          <div className="wd-title"><span className="wd-k">Move {C} changes to {N}</span><b className="mono">{source.name}</b>
            <span className="tag">{O} = base · {C} = customisation · {N} = target</span></div>
          <div className="seg" style={{ margin: 0 }}>{WIDTHS.map(([w, l]) => <button key={w} className={width === w ? "on" : ""} onClick={() => setWidth(w)}>{l}</button>)}</div>
          <button className="wd-x" onClick={onClose} title="Close (Esc)">✕</button>
        </div>

        <div className="mg-copies">
          <span className="tag">{N} copies — tick the ones to generate, click one to work on it:</span>
          {copies.map((cp, i) => {
            const b = include.has(i) && base ? blockers(i) : [];
            return (
              <span key={i} className={"mg-copy" + (i === active ? " on" : "") + (include.has(i) ? " inc" : "")} onClick={() => setActive(i)}>
                <input type="checkbox" checked={include.has(i)} onClick={(e) => e.stopPropagation()} onChange={() => setInclude((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; })} />
                <b>{cp.app || N}</b>{cp.label !== source.name && <span className="tag mono"> {source.noun === "component" ? cp.label : `as ${cp.label}`}</span>}
                {cp.best ? <span className="mg-best">compared copy</span> : cp.score != null && <span className="tag"> {Math.round(cp.score * 100)}%</span>}
                {cp.uses != null && <span className={"tag" + (cp.uses ? "" : " mg-unused")} title={`${N} forms, templates and components placing this copy`}> · {cp.uses ? `used ×${cp.uses}` : "placed nowhere"}</span>}
                {include.has(i) && (b.length ? <span className="mg-blk" title={b.join(" · ")}>{b[0]}</span> : <span className="mg-ok">ready</span>)}
              </span>
            );
          })}
        </div>

        <div className="mg-body">
          <div className="mg-left">
            {!D ? <p className="note" style={{ padding: 14 }}>Reading {O}, {C} and {N}{c && c.app ? ` (${c.app})` : ""}…</p> : (
              <>
                <div className="mg-sum">
                  <span className={"mg-st conflict" + (counts.undecided ? " open" : "")}>{counts.conflict} conflicts{counts.undecided ? ` · ${counts.undecided} to decide` : " · all decided"}</span>
                  <span className="mg-st clean">{counts.clean} clean</span>
                  <span className="mg-st removal">{counts.removal} removals</span>
                  <span className="mg-st already">{counts.already} already in {N}</span>
                  <span className="tag">{counts.moving} change{counts.moving === 1 ? "" : "s"} will move</span>
                  {counts.design > 0 && <span className="tag" title="Visualizer's own canvas settings (context, breakpointInfo, prevDevice …) and widget ids (kuid): noise when moved, and a kuid change can break the component contract's links">· {counts.design} design-time / kuid row{counts.design === 1 ? "" : "s"} kept as {N}{counts.designMoving ? ` (${counts.designMoving} set to move)` : ""}</span>}
                </div>
                <div className="mg-tools">
                  {["conflict", "clean", "removal", "already"].map((s) => <span key={s} className={"chip" + (show.has(s) ? " on" : "")} onClick={() => toggleShow(s)}>{show.has(s) ? "✓ " : ""}{STATE[s]}</span>)}
                  {counts.design > 0 && <span className={"chip" + (showDesign ? " on" : "")} onClick={() => setShowDesign((v) => !v)}>{showDesign ? "✓ " : ""}design-time ({counts.design})</span>}
                  <input type="text" placeholder="Find widget or property…" value={q} onChange={(e) => setQ(e.target.value)} />
                  <button className="btn ghost tiny" onClick={() => setMany((x) => x.state === "clean" && !x.design, "kbz")}>Tick all clean</button>
                  <button className="btn ghost tiny" onClick={() => setMany((x) => x.state === "clean" && !x.design, "r26")}>Untick all clean</button>
                </div>
                {conflictGroups.length > 0 && (
                  <div className="mg-bulk">
                    <span className="tag">Decide conflicts together{canRule ? " — on this form, or for every form (a rule, kept and applied to every form you open)" : ""}:</span>
                    {conflictGroups.map((g) => {
                      const rule = canRule && ruleOf(g);
                      return (
                        <span key={g.by + g.k} className={"mg-bk" + (g.open ? " open" : "") + (g.by === "bp" ? " bp" : "")}>
                          <span className="mono">{g.label}</span> ×{g.total}{g.open ? ` (${g.open} open)` : ""}
                          <button onClick={() => setMany(g.pred, "r26")}>keep {N}</button><button onClick={() => setMany(g.pred, "kbz")}>take {C}</button>
                          {canRule && (rule
                            ? <span className="mg-rule on" title="a rule for every form">every form: {rule.choice === "kbz" ? `take ${C}` : `keep ${N}`} <button onClick={() => setRule(g, null)} title="remove the rule (choices made on this form stay)">✕</button></span>
                            : <span className="mg-rule">every form: <button onClick={() => setRule(g, "r26")}>keep {N}</button><button onClick={() => setRule(g, "kbz")}>take {C}</button></span>)}
                        </span>
                      );
                    })}
                  </div>
                )}
                {canRule && rules && rules.length > 0 && <div className="mg-rules tag">Rules for every form: {rules.map((x) => `${x.by === "bp" ? `responsiveData › ${x.k}` : KIND[x.k.slice(1, -1)] || x.k} → ${x.choice === "kbz" ? `take ${C}` : `keep ${N}`}`).join(" · ")} — a later rule wins where two apply.</div>}
                <div className="mg-list">
                  {!groups.length && <p className="note" style={{ padding: 12 }}>{D.rows.length ? "No changes under these filters." : `${C} did not change this ${source.noun} compared with ${O} — nothing to move.`}</p>}
                  {groups.map(([wid, list]) => (
                    <div key={wid} className={"mg-w" + (sel === wid ? " sel" : "")}>
                      <div className="mg-wh" onClick={() => setSel(wid)}><b className="mono">{wid}</b><span className="tag">{list[0].wType}</span></div>
                      {list.map((row) => {
                        const v = ch[row.rid];
                        const prob = problemOf.get(row.rid), iss = issuesOf.get(row.rid);
                        return (
                          <div key={row.rid} className={"mg-row s-" + row.state + (row.state === "conflict" && !v ? " undecided" : "")} onClick={() => setSel(wid)}>
                            <span className={"mg-pill " + row.state}>{STATE[row.state]}</span>
                            <span className="mg-what">{row.kind === "prop" ? <span className="mono" title={row.path && row.path.length ? "one value of this property — compared value by value" : undefined}>{rowLabel(row)}</span> : KIND[row.kind]}{row.design && <span className="tag"> · design-time, kept as {N} unless ticked</span>}{row.note && <span className="tag"> · {row.note}</span>}</span>
                            {(row.kind === "prop" || row.kind === "parent" || row.kind === "order") && (
                              <span className="mg-vals">
                                <span title={full(row.base)}><i>{O}</i> {short(row.base)}</span>
                                <span title={full(row.kbz)} className="k"><i>{C}</i> {short(row.kbz)}</span>
                                <span title={full(row.r26)}><i>{N}</i> {short(row.r26)}</span>
                              </span>
                            )}
                            {(row.kind === "add" || row.kind === "gone") && <span className="mg-vals"><span><i>parent</i> {pf[row.rid] || row.parent || "—"}</span></span>}
                            <span className="mg-ctl" onClick={(e) => e.stopPropagation()}>
                              {row.state === "already" ? <span className="tag">nothing to do</span>
                                : row.state === "conflict" ? (
                                  <span className="seg mg-seg">
                                    <button className={v === "r26" ? "on" : ""} onClick={() => setChoice(row.rid, "r26")}>keep {N}</button>
                                    <button className={v === "kbz" ? "on" : ""} onClick={() => setChoice(row.rid, "kbz")}>take {C}</button>
                                  </span>
                                ) : (
                                  <label className="mg-tick"><input type="checkbox" checked={v === "kbz"} onChange={(e) => setChoice(row.rid, e.target.checked ? "kbz" : "r26")} /> {row.kind === "remove" ? "remove" : "move"}</label>
                                )}
                            </span>
                            {row.kind === "remove" && v === "kbz" && merged && merged.removedWith[row.rid] && merged.removedWith[row.rid].length > 0 && <div className="mg-sub">also removes {merged.removedWith[row.rid].join(", ")} (under it in {N})</div>}
                            {prob && (
                              <div className="mg-sub err">{prob}
                                <select value={pf[row.rid] || ""} onChange={(e) => setParent(row.rid, e.target.value || undefined)}>
                                  <option value="">choose a parent…</option>
                                  {containers.map((id) => <option key={id} value={id}>{id}</option>)}
                                </select>
                              </div>
                            )}
                            {iss && iss.map((i) => <div key={i.value} className="mg-sub warn">⚠ {i.text}</div>)}
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          <div className="mg-right">
            <div className="mg-panes">
              <MergePane label={`${C} (customisation)`} p={picked[1]} app="" ch={source.ch} W={base && base.W1} width={width} sel={sel} onPick={setSel} render={source.render} />
              <MergePane label={`${N} now${c && c.app ? ` · ${c.app}` : ""}`} p={p26} app={c && c.app} ch={source.ch} W={D && D.W2} width={width} sel={sel} marks={marks.now} onPick={setSel} render={source.render} />
              <MergePane label={`Result${c && c.app ? ` · ${c.app}` : ""}`} p={p26} app={c && c.app} ch={source.ch} W={merged && merged.W} width={width} sel={sel} marks={marks.res} onPick={setSel} result render={source.render} />
            </div>
            {sel && D && (
              <div className="mg-detail">
                <div className="mg-dh"><b className="mono">{sel}</b><span className="tag">{O} · {C} · {N} now · result</span><button className="btn ghost tiny" onClick={() => setSel(null)}>close</button></div>
                <WidgetCompare ids={[base.W0[sel], base.W1[sel], W2sel, Wmsel]} labels={[O, C, `${N} now`, "Result"]} />
              </div>
            )}
          </div>
        </div>

        <div className="mg-foot">
          {issues.length > 0 && <details className="mg-issues"><summary>⚠ {issues.length} dependency warning{issues.length === 1 ? "" : "s"} for {c && c.app} — {C} values {N} may not have</summary>{issues.map((i, k) => <div key={k}><span className="mono">{i.wid}</span> · {i.text}</div>)}</details>}
          <div className="mg-out">
            <label>Output folder <input type="text" value={out} onChange={(e) => setOut(e.target.value)} placeholder="e.g. C:\Projects\KBZ\R26-merged — not inside a Visualizer project" /></label>
            <button className="btn" disabled={!canGenerate} onClick={generate}>{gen && gen.running ? "Writing…" : `Generate ${include.size} ${source.noun} folder${include.size === 1 ? "" : "s"}`}</button>
            <span className="tag">{!include.size ? "Tick at least one copy." : blocked.length ? `${copies[blocked[0][0]].app}: ${blocked[0][1].join(" · ")}` : !out.trim() ? "Give an output folder." : `Writes <output>/${copies[0] ? copies[0].path : ""}${include.size > 1 ? " and the other ticked copies" : ""} — the whole folder, replaced if it is there.`}</span>
          </div>
          {gen && gen.done && (
            <div className="mg-done">
              {gen.done.map((d, k) => <div key={k} className="ok">✓ {d.copy.app}: {d.written} widget files written to <span className="mono">{d.path}</span> — {d.moved} change{d.moved === 1 ? "" : "s"} moved, {d.changedFiles} file{d.changedFiles === 1 ? "" : "s"} differ from {N}{d.removed ? `, ${d.removed} widget${d.removed === 1 ? "" : "s"} removed` : ""}{d.other.length ? ` · not copied (not widget files): ${d.other.join(", ")}` : ""}</div>)}
              {gen.errors.map((d, k) => <div key={"e" + k} className="err">✕ {d.copy.app}: {d.error}</div>)}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// one widget across the versions: every property that differs anywhere, plus parent and children
function WidgetCompare({ ids, labels }) {
  const keys = [...new Set(ids.flatMap((w) => (w ? Object.keys(w) : [])))].filter((k) => !/^__.*__$/.test(k) && k !== "_vizProps_");
  const val = (w, k) => (w ? (k in w ? JSON.stringify(w[k]) : "") : null);
  const rows = keys.filter((k) => new Set(ids.map((w) => val(w, k))).size > 1).sort((a, b) => (a === "parent" ? -2 : a === "children" ? -1 : 0) - (b === "parent" ? -2 : b === "children" ? -1 : 0) || a.localeCompare(b));
  if (!ids.some(Boolean)) return <p className="tag">Not in any version.</p>;
  return (
    <table className="mg-cmp">
      <thead><tr><th>Property</th>{labels.map((l) => <th key={l}>{l}</th>)}</tr></thead>
      <tbody>
        {!rows.length && <tr><td colSpan={5} className="tag">Same in every version.</td></tr>}
        {rows.map((k) => (
          <tr key={k}><td className="mono">{k}</td>{ids.map((w, i) => <td key={i} className={"mono" + (i === 3 && ids[2] && val(w, k) !== val(ids[2], k) ? " ch" : "")}>{w === undefined || w === null ? <span className="tag">no widget</span> : k in w ? short(w[k], 80) : <span className="tag">—</span>}</td>)}</tr>
        ))}
      </tbody>
    </table>
  );
}

function MergePane({ label, p, app, ch, W, width, sel, marks, onPick, result, render }) {
  const frame = useRef(null), box = useRef(null), res = useRef(null);
  const [h, setH] = useState(80);
  const [state, setState] = useState("drawing");
  const [boxW, setBoxW] = useState(600);
  const [rev, setRev] = useState(0);
  useEffect(() => { const el = box.current; if (!el) return undefined; const ro = new ResizeObserver(() => setBoxW(el.clientWidth)); ro.observe(el); return () => ro.disconnect(); }, []);
  useEffect(() => {
    if (!W || !frame.current) return undefined;
    let alive = true;
    setState("drawing");
    const t = setTimeout(async () => { // the result redraws as choices change: wait for a pause
      try {
        const idx = versionIndex(p, app, ch);
        const doc = frame.current.contentDocument;
        const out = render === "form" ? await renderForm(idx, new Map(Object.entries(W)), doc, { width, height: FORM_H, extraCss: HL }) : await renderTemplate(idx, new Map(Object.entries(W)), doc, { width, extraCss: HL });
        if (!alive) return;
        res.current = out;
        setH(out ? (render === "form" ? FORM_H : out.height) : 40);
        doc.body.onclick = (e) => { const w = e.target.closest(".kw"); if (w) onPick(w.dataset.path.split(".").pop()); };
        setState(out ? "ok" : "empty");
        setRev((x) => x + 1);
      } catch (e) { if (alive) setState("error:" + (e.message || e)); }
    }, result ? 250 : 0);
    return () => { alive = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [W, width, p, app, ch]);
  useEffect(() => {
    const out = res.current;
    if (!out || !frame.current) return;
    const doc = frame.current.contentDocument;
    for (const el of doc.querySelectorAll(".mg-add,.mg-chg,.mg-del,.mg-sel")) el.classList.remove("mg-add", "mg-chg", "mg-del", "mg-sel");
    if (marks) for (const [id, k] of marks) { const n = out.byId.get(id); if (n && n.el) n.el.classList.add("mg-" + k); }
    const n = sel && out.byId.get(sel);
    if (n && n.el) n.el.classList.add("mg-sel");
  }, [marks, sel, rev]);
  const scale = Math.min(1, Math.max(0.15, (boxW - 2) / width));
  return (
    <div className={"wd-pane" + (result ? " mg-res" : "")}>
      <div className="wd-ph"><b>{label}</b>{state === "ok" && <span className="tag">{Math.round(scale * 100)}%</span>}{marks && marks.size > 0 && <span className="tag">{marks.size} outlined</span>}</div>
      <div className="wd-box" ref={box}>
        {(!W || state === "drawing") && <div className="wd-load">{W ? "Drawing…" : "Reading…"}</div>}
        {state.startsWith("error") && <div className="wd-none">Could not draw: {state.slice(6)}</div>}
        <div className="wd-frame" style={{ width: width * scale, height: h * scale }}>
          <iframe ref={frame} title={label} className="wd-iframe" style={{ width, height: h, transform: `scale(${scale})` }} />
        </div>
      </div>
    </div>
  );
}
