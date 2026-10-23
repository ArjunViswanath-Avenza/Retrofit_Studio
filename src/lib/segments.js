// TemplateTwin: segment templates compared across R21 / KBZ / R26 the way COMP-are compares components.
// A template is templates/<channel>/segments/<name>.sm/*.json — a widget tree whose top file (<name>.json) holds one
// child, the root flex. Its code is not inside the .sm: it lives in controllers/<channel>/<rootFlex>Controller/
// (<rootFlex>Controller.js + <rootFlex>ControllerActions.js). Forms and components point at a template by its root
// flex id (or the template's kuid): "rowtemplate" / "sectionheadertemplate" in the widget JSON, or
// .rowTemplate = "flx…" / sectionHeaderTemplate: "flx…" in code, or per row in the segment data: { template: "flx…" }.
// In the micro-app workspace picked[2] is R26 aligned onto the monolith's keys; segMeta says which micro app (and
// which of its templates) stands behind each key.
import { extract, extractComponent } from "./analyzer.js";
import { buildFormDiff } from "./forms.js";
import { aspect, readWidgetJson, actionLabels } from "./components.js";

const STRUCT_PAIRS = [[0, 1], [0, 2], [1, 2]];
export const segName = (key) => key.split("/").pop();
const meta = async (f) => { try { const j = JSON.parse((await f.text()).replace(/^﻿/, "")); return { root: (j.children || [])[0] || null, kuid: j.kuid || null }; } catch { return {}; } };

// one version's copy of a template: its widget files, real name, micro app and the controller files behind it
// read once per project and template (the comparison, the files view and the usage scan all need it)
const copies = new WeakMap();
export function segCopy(p, key) {
  if (!p || !p.segs || !p.segs.has(key)) return Promise.resolve(null);
  if (!copies.has(p)) copies.set(p, new Map());
  const m = copies.get(p);
  if (!m.has(key)) m.set(key, readCopy(p, key));
  return m.get(key);
}
async function readCopy(p, key) {
  const m = p.segMeta && p.segMeta.get(key);
  const ch = key.split("/")[0], name = m ? m.name : segName(key);
  const files = p.segs.get(key), tplCtrl = m ? m.tplCtrl : p.tplCtrl;
  const top = files.get(name);
  const { root = null, kuid = null } = top ? await meta(top) : {};
  const dir = root && tplCtrl ? tplCtrl.get(`${ch}/${root}Controller`) : null;
  return {
    key, ch, name, app: m ? m.app : null, root, kuid, files,
    controller: dir ? dir.get(`${root}Controller.js`) || null : null,
    actions: dir ? dir.get(`${root}ControllerActions.js`) || null : null,
    path: `${m ? m.app + "/" : ""}templates/${ch}/segments/${name}.sm`,
    ctrlPath: root ? `${m ? m.app + "/" : ""}controllers/${ch}/${root}Controller/` : null,
  };
}

// every template across the versions: structure (widget tree), controller and actions, like a component
export async function analyzeSegments(picked, labels, onProgress) {
  const n = picked[2] ? 3 : 2;
  const L = labels.slice(0, n);
  const keys = [...new Set(picked.slice(0, n).flatMap((p) => (p && p.segs ? [...p.segs.keys()] : [])))]
    .sort((a, b) => segName(a).toLowerCase().localeCompare(segName(b).toLowerCase()) || a.localeCompare(b));
  const results = [];
  onProgress({ done: 0, total: keys.length, running: true });
  for (let k = 0; k < keys.length; k++) {
    const key = keys[k];
    const copies = [];
    for (let i = 0; i < n; i++) copies.push(await segCopy(picked[i], key));
    const present = Object.fromEntries(L.map((l, i) => [l, !!copies[i]]));
    const r = { key, name: segName(key), channel: key.split("/")[0], present, copies: copies.map((c) => c && { name: c.name, app: c.app, root: c.root, kuid: c.kuid, path: c.path, ctrlPath: c.ctrlPath, hasCtrl: !!c.controller, hasActions: !!c.actions }), models: {}, errors: {}, structure: {} };
    const run = async (name, files, parse) => {
      try { r.models[name] = await aspect(L, files, parse); } catch (e) { r.models[name] = null; r.errors[name] = String(e.message || e); }
    };
    await run("controller", copies.map((c) => c && c.controller), extractComponent);
    await run("actions", copies.map((c) => c && c.actions), extract);
    if (r.models.actions) {
      const hints = {};
      for (const c of copies) if (c && c.actions) Object.assign(hints, actionLabels(await c.actions.text()));
      r.models.actions.hints = hints;
    }
    try {
      const W = [];
      for (const c of copies) W.push(c ? await readWidgetJson(c.files) : {});
      for (const [a, b] of STRUCT_PAIRS) {
        if (b >= n || (!copies[a] && !copies[b])) continue;
        const d = buildFormDiff(W[a], W[b]);
        r.structure[`${a}${b}`] = { ...d.totals, propWidgets: d.propWidgets, leaves: d.leaves, byCategory: d.byCategory };
        // which parameters changed on each changed widget — lets the dashboard recount with some parameters excluded
        r.wkeys = r.wkeys || {};
        r.wkeys[`${a}${b}`] = [];
        for (const n of d.nodes.values()) if (n.props.length) r.wkeys[`${a}${b}`].push([...new Set(n.props.map((p) => p.key))]);
        r.keyCat = r.keyCat || {};
        for (const n of d.nodes.values()) for (const p of n.props) r.keyCat[p.key] = p.category;
      }
      r.widgetCounts = Object.fromEntries(L.map((l, i) => [l, Object.keys(W[i]).length]));
    } catch (e) { r.errors.structure = String(e.message || e); }
    const g = (m) => (m ? m.genuine.length : 0);
    const s = r.structure["01"];
    r.changes = { structure: s ? s.added + s.removed + s.moved + s.propWidgets : 0, controller: g(r.models.controller), actions: g(r.models.actions) };
    r.total = r.changes.structure + r.changes.controller + r.changes.actions;
    r.conflicts = 0;
    for (const m of Object.values(r.models)) if (m) for (const x of Object.values(m.members)) if (x.bucket === "2") r.conflicts++;
    r.status = !present[L[0]] && present[L[1]] ? "new" : present[L[0]] && !present[L[1]] ? "removed"
      : !present[L[0]] && !present[L[1]] ? "absent" : r.total ? "customised" : "unchanged";
    results.push(r);
    if (k % 6 === 0) { onProgress({ done: k + 1, total: keys.length, running: true }); await new Promise((res) => setTimeout(res)); }
  }
  onProgress({ done: keys.length, total: keys.length, running: false });
  return results;
}

// files of every template for the Overall comparison: key -> Map(file id -> File) (widget JSONs, controller, actions)
// only: limit to these template keys (one template's Files tab)
export async function segmentFiles(picked, only) {
  const out = [];
  for (const p of picked) {
    if (!p || !p.segs) { out.push(null); continue; }
    const m = new Map();
    for (const key of only || p.segs.keys()) {
      const c = await segCopy(p, key);
      if (!c) continue;
      const files = new Map();
      if (c.controller) files.set(`${c.root}Controller.js`, c.controller);
      if (c.actions) files.set(`${c.root}ControllerActions.js`, c.actions);
      for (const [id, f] of c.files) files.set(`${id}.json`, f);
      m.set(key, files);
    }
    out.push({ segs: m });
  }
  return out;
}

// where each template is used, per version: forms (widget JSON or controller code) and components
// -> Map(templateKey -> [{ kind: "form" | "component" | "template", where, app, via, field }])
const REF_JSON = /"(rowtemplate|sectionheadertemplate|rowTemplate|sectionHeaderTemplate)"\s*:\s*"([^"]+)"/g;
const REF_CODE = /\b(rowTemplate|sectionHeaderTemplate|template)["']?\s*[:=]\s*["']([\w$]+)["']/g;
const LITERAL = /["']([A-Za-z_][\w$]*)["']/g;
const field = (f) => (f === "template" ? "row (set in the data)" : /^row/i.test(f) ? "row" : "section header");
// controllers/<ch>/<Module…>/<frmX>Controller/<frmX>Controller.js -> forms key <ch>/<Module…>/<frmX>.sm
const formOfCtrl = (k) => { const s = k.split("/"); return s.length >= 4 ? `${s[0]}/${s.slice(1, -2).join("/")}/${s[s.length - 2].replace(/Controller$/, "")}.sm` : null; };

export async function segmentUsage(picked, onProgress) {
  const all = [];
  const total = picked.reduce((t, p) => t + (p && p.segs ? [...(p.forms || new Map()).values()].reduce((x, m) => x + m.size, 0) + (p.controllers ? p.controllers.size : 0) + (p.mvc ? p.mvc.size : 0)
    + [...(p.comps || new Map()).values()].reduce((x, m) => x + [...m.keys()].filter((r) => /\.(js|json)$/i.test(r)).length, 0) : 0), 0);
  let done = 0;
  const tick = async () => { onProgress({ done, total, running: true }); await new Promise((r) => setTimeout(r)); };
  for (const p of picked) {
    if (!p || !p.segs) { all.push(null); continue; }
    // the ids a reference can use: root flex and kuid of every template in this version
    const byRef = new Map();
    for (const key of p.segs.keys()) {
      const c = await segCopy(p, key);
      for (const id of [c.root, c.kuid]) if (id) { if (!byRef.has(id)) byRef.set(id, []); byRef.get(id).push(key); }
    }
    const use = new Map();
    const seen = new Set();
    const add = (ref, e) => {
      for (const key of byRef.get(ref) || []) {
        const sig = `${key}|${e.kind}|${e.where}|${e.via}`;
        if (seen.has(sig)) continue;
        seen.add(sig);
        if (!use.has(key)) use.set(key, []);
        use.get(key).push({ ...e, shared: (byRef.get(ref) || []).length > 1 });
      }
    };
    // forms: every widget JSON
    for (const [fk, widgets] of p.forms || []) {
      const app = p.formApp ? p.formApp.get(fk) || null : null;
      const list = [...widgets];
      for (let i = 0; i < list.length; i += 256) {
        const texts = await Promise.all(list.slice(i, i + 256).map(([, f]) => f.text()));
        texts.forEach((t, j) => { if (!t.includes("emplate")) return; for (const m of t.matchAll(REF_JSON)) add(m[2], { kind: "form", where: fk, app, via: list[i + j][0], field: field(m[1]) }); });
        done += texts.length;
      }
      if (done % 2000 < 256) await tick();
    }
    // code: direct references, then any string literal that is a template's root flex — code often keeps the name in
    // a variable or a widgetDataMap first (this.closedTemplate = "flxX"; quest.template === "flxY")
    const lineAt = (t, i) => t.slice(0, i).split("\n").length;
    const codeRefs = (t, make) => {
      const direct = new Set(), named = new Set();
      for (const m of t.matchAll(REF_CODE)) { direct.add(m[2]); add(m[2], make(lineAt(t, m.index), field(m[1]))); }
      for (const m of t.matchAll(LITERAL)) {
        const v = m[1];
        if (direct.has(v) || named.has(v) || !byRef.has(v)) continue;
        named.add(v);
        add(v, make(lineAt(t, m.index), "named in code"));
      }
    };
    // read many files at once, then handle each
    const batch = async (items, each) => {
      for (let i = 0; i < items.length; i += 128) {
        const part = items.slice(i, i + 128);
        const texts = await Promise.all(part.map((x) => x.f.text()));
        texts.forEach((t, j) => each(part[j], t));
        done += part.length;
        await tick();
      }
    };
    // form controllers (and template controllers, which can nest segments too)
    await batch([...(p.controllers || [])].map(([ck, f]) => ({ ck, f })), ({ ck }, t) => {
      const fk = formOfCtrl(ck), app = p.ctrlApp ? p.ctrlApp.get(ck) || null : null;
      codeRefs(t, (line, fl) => (fk ? { kind: "form", where: fk, app, via: `controller line ${line}`, field: fl } : { kind: "template", where: ck.split("/")[1], app, via: `controller line ${line}`, field: fl }));
    });
    // presentation / business controllers build segment data too (per-row templates)
    await batch([...(p.mvc || [])].map(([mk, f]) => ({ mk, f })), ({ mk }, t) => codeRefs(t, (line, fl) => ({ kind: "module", where: mk, app: null, via: `line ${line}`, field: fl })));
    // components: their widget JSONs and scripts
    const compFiles = [];
    for (const [comp, files] of p.comps || []) for (const [rel, f] of files) if (/\.(js|json)$/i.test(rel)) compFiles.push({ comp, rel, f });
    await batch(compFiles, ({ comp, rel }, t) => {
      const app = p.compApp ? p.compApp.get(comp) || null : null;
      if (/\.js$/i.test(rel)) codeRefs(t, (line, fl) => ({ kind: "component", where: comp, app, via: `${rel} line ${line}`, field: fl }));
      else if (t.includes("emplate")) for (const m of t.matchAll(REF_JSON)) add(m[2], { kind: "component", where: comp, app, via: rel, field: field(m[1]) });
    });
    all.push(use);
    await tick();
  }
  onProgress({ done: total, total, running: false });
  return all;
}

// every line that names one widget of a template, in one version: the template's own controller + actions, then
// wherever the template is used — the form's segment JSON (its widgetDataMap) and controller, a component's scripts,
// presentation / business code, other templates' controllers. uses: that version's usage entries for the template.
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const ctrlOfForm = (fk) => { const s = fk.split("/"); const name = s.pop().replace(/\.sm$/i, ""); return [...s, `${name}Controller`, `${name}Controller.js`].join("/"); };
export async function widgetRefs(p, key, id, uses) {
  const c = await segCopy(p, key);
  if (!c) return [];
  const re = new RegExp(`(^|[^\\w$])${esc(id)}(?![\\w$])`);
  const out = [];
  const scan = async (file, group) => {
    if (!file) return;
    const L = (await file.text()).replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n");
    const hits = [];
    L.forEach((t, i) => { if (re.test(t)) hits.push({ line: i + 1, text: t.trim().slice(0, 240), from: Math.max(1, i - 2), ctx: L.slice(Math.max(0, i - 3), i + 4) }); });
    if (hits.length) out.push({ ...group, hits: hits.slice(0, 40), more: Math.max(0, hits.length - 40) });
  };
  await scan(c.controller, { kind: "template", label: `${c.root}Controller.js`, sub: "the template's own controller", path: c.ctrlPath });
  await scan(c.actions, { kind: "template", label: `${c.root}ControllerActions.js`, sub: "the template's action sequences", path: c.ctrlPath });
  const done = new Set();
  for (const e of uses || []) {
    if (e.kind === "form") {
      const widget = !/^controller line/.test(e.via) && p.forms && p.forms.get(e.where) ? p.forms.get(e.where).get(e.via) : null;
      const sig = widget ? `fw|${e.where}|${e.via}` : `fc|${e.where}`;
      if (done.has(sig)) continue;
      done.add(sig);
      const name = e.where.split("/").pop().replace(/\.sm$/i, "");
      if (widget) await scan(widget, { kind: "form", label: name, sub: `segment ${e.via} · its widgetDataMap / settings`, app: e.app, path: e.where });
      else await scan(p.controllers && p.controllers.get(ctrlOfForm(e.where)), { kind: "form", label: name, sub: `${name}Controller.js`, app: e.app, path: e.where });
    } else if (e.kind === "component") {
      if (done.has(`c|${e.where}`)) continue;
      done.add(`c|${e.where}`);
      for (const [rel, f] of (p.comps && p.comps.get(e.where)) || []) if (/\.js$/i.test(rel)) await scan(f, { kind: "component", label: e.where.split(".").pop(), sub: rel, app: e.app, path: e.where });
    } else if (e.kind === "module") {
      if (done.has(`m|${e.where}`)) continue;
      done.add(`m|${e.where}`);
      await scan(p.mvc && p.mvc.get(e.where), { kind: "module", label: e.where.split("/")[0], sub: e.where.split("/").slice(1).join("/"), path: e.where });
    } else if (e.kind === "template") {
      if (done.has(`t|${e.where}`)) continue;
      done.add(`t|${e.where}`);
      await scan(p.controllers && p.controllers.get(`${key.split("/")[0]}/${e.where}/${e.where}.js`), { kind: "template", label: `${e.where}.js`, sub: "another template's controller", path: e.where });
    }
  }
  return out;
}
