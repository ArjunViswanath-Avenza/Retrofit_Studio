// Draws a Visualizer form the way the desktop web runtime does, from the project's own files.
// Layout rules are ported from the runtime (konyframework.js · $KW.FlexLayoutEngine / $KW.FlexUtils):
//  free-form: left/right/centerX + width (or the width implied by two of them), the same for y
//  vertical flow: y = previous visible sibling's bottom + top (+ previous bottom); x as free-form
//  horizontal flow: x = previous visible sibling's right + left (+ previous right); y as free-form
//  % is taken of the parent's size minus its border; dp = px; no size -> the widget's preferred size
//  (measured in the page, white-space nowrap), FlexContainer with AUTOGROW_HEIGHT -> its children's extent,
//  other missing sizes -> the runtime's default size for that widget type.
import { skinStyle, skinFont } from "./skins.js";
import { looseJson } from "./blueprint.js";

const LAYOUT = { 2: "free", 3: "hflow", 4: "vflow" }; // form-file codes -> layout (checked against compiled forms)
const ALIGN = { 1: "cnttopleftalign", 2: "cnttopcenteralign", 3: "cnttoprightalign", 4: "cntmiddleleftalign", 5: "cntmiddlecenteralign", 6: "cntmiddlerightalign", 7: "cntbottomleftalign", 8: "cntbottomcenteralign", 9: "cntbottomrightalign" };
const DEF_W = { TabPane: "100%", Calendar: "200dp", DataGrid: "100%", CheckBoxGroup: "100%", RadioButtonGroup: "260dp", Slider: "260dp", Switch: "200dp", Segment: "100%", Browser: "100%", Map: "100%", FlexContainer: "100%", FlexScrollContainer: "100%", TextField: "260dp", TextArea: "260dp", ListBox: "260dp", CollectionView: "120dp", Canvas: "100%", UserWidgetInstance: "100%" };
const DEF_H = { Segment: "120dp", Browser: "220dp", Map: "75%", TabPane: "220dp", FlexContainer: "220dp", FlexScrollContainer: "220dp", Slider: "100dp", ListBox: "40dp", CheckBoxGroup: "120dp", RadioButtonGroup: "40dp", TextArea: "120dp", TextField: "40dp", DataGrid: "120dp", CollectionView: "120dp", Canvas: "220dp", UserWidgetInstance: "220dp" };
const CONTAINERS = new Set(["Form", "FlexContainer", "FlexScrollContainer", "UserWidgetInstance", "_row"]);
const IMG = /\.(png|jpe?g|gif|svg|webp|bmp)$/i, FONT = /\.(ttf|otf|woff2?)$/i;
const RESP_KEY = { left: "left", top: "top", right: "right", bottom: "bottom", width: "width", height: "height", centerX: "centerX", centerY: "centerY", minWidth: "minWidth", maxWidth: "maxWidth", minHeight: "minHeight", maxHeight: "maxHeight", zIndex: "zIndex", isVisible: "isVisible", skin: "skin", text: "text", layoutType: "layoutType" };

/* ================================================================ project assets */
export async function previewAssets(idx) {
  if (idx.previewAssets) return idx.previewAssets;
  const F = idx.project.files;
  const pp = looseJson(await idx.read("projectProperties.json")) || {};
  const theme = pp.defaulttheme || "defaultTheme";
  const skinsByKuid = new Map(), skinsByName = new Map();
  // the active theme first, then the others for skins it lacks; read in parallel batches (themes hold thousands)
  const themed = [];
  for (const rel of F.keys()) { const m = rel.match(/^themes\/([^/]+)\/([^/]+)\.json$/); if (m) themed.push({ rel, name: m[2], active: m[1] === theme }); }
  themed.sort((x, y) => (y.active ? 1 : 0) - (x.active ? 1 : 0));
  for (let i = 0; i < themed.length; i += 128) {
    const part = themed.slice(i, i + 128).filter((t) => t.active || !skinsByName.has(t.name));
    const texts = await Promise.all(part.map((t) => idx.read(t.rel)));
    part.forEach((t, k) => {
      const j = looseJson(texts[k]);
      if (!j) return;
      if (t.active || !skinsByName.has(t.name)) skinsByName.set(t.name, j);
      if (j.kuid && (t.active || !skinsByKuid.has(j.kuid))) skinsByKuid.set(j.kuid, { ...j, _name: t.name });
    });
  }
  const images = new Map(), fonts = new Map();
  const rank = (rel) => (/\/desktop\//.test(rel) ? 0 : /\/common\//.test(rel) ? 1 : /^web\//.test(rel) ? 3 : 2);
  for (const rel of F.keys()) {
    if (!/^(resources|web)\//.test(rel)) continue;
    const base = rel.split("/").pop();
    if (IMG.test(rel)) { const cur = images.get(base.toLowerCase()); if (!cur || rank(rel) < rank(cur)) images.set(base.toLowerCase(), rel); }
    if (FONT.test(rel)) fonts.set(base.replace(FONT, "").toLowerCase(), rel);
  }
  // components: kuid of the component's root widget -> its files
  const comps = new Map();
  const compFiles = new Map();
  for (const rel of F.keys()) { const m = rel.match(/^userwidgets\/([^/]+)\/userwidgetmodel\.sm\/[^/]+\.json$/); if (m) { if (!compFiles.has(m[1])) compFiles.set(m[1], []); compFiles.get(m[1]).push(rel); } }
  // segment row templates: template root id -> files
  const templates = new Map();
  for (const rel of F.keys()) { const m = rel.match(/^templates\/([^/]+)\/[^/]+\/([^/]+)\.sm\/[^/]+\.json$/); if (m && (m[1] === idx.ch || !templates.has(m[2]))) { if (!templates.has(m[2])) templates.set(m[2], { ch: m[1], files: [] }); templates.get(m[2]).files.push(rel); } }
  const i18nJ = looseJson(await idx.read("i18n.json"));
  const L = (i18nJ && i18nJ.locales) || {};
  const loc = L.en_US || L.en || Object.values(L)[0];
  const i18n = (loc && (loc.i18nStrings || loc)) || {};
  idx.previewAssets = { theme, skinsByKuid, skinsByName, images, fonts, comps, compFiles, templates, i18n, blobs: new Map(), imgSize: new Map() };
  return idx.previewAssets;
}
async function treeOf(idx, files) {
  const W = new Map();
  for (const rel of files) { const j = looseJson(await idx.read(rel)); if (j && j.id) W.set(j.id, j); }
  return W;
}
async function compTree(idx, A, kuid) {
  if (A.comps.has(kuid)) return A.comps.get(kuid);
  let found = null;
  for (const [ns, files] of A.compFiles) {
    const rootFile = files.find((r) => r.endsWith(`/${ns.split(".").pop()}.json`));
    const j = rootFile ? looseJson(await idx.read(rootFile)) : null;
    if (j && j.kuid === kuid) { found = { ns, W: await treeOf(idx, files) }; break; }
  }
  A.comps.set(kuid, found);
  return found;
}
async function blobUrl(idx, A, rel) {
  if (!rel) return null;
  if (A.blobs.has(rel)) return A.blobs.get(rel);
  const f = idx.project.files.get(rel);
  const u = f ? URL.createObjectURL(f) : null;
  A.blobs.set(rel, u);
  return u;
}

/* ================================================================ widget model */
function unitVal(v) {
  if (v == null) return undefined;
  if (typeof v === "number") return { v, u: "dp" };
  if (typeof v === "object" && "value" in v) {
    if (v.value === "" || v.value == null) return undefined;
    if (v.type === "ref" || v.value === "preferred") return v.value === "preferred" ? "preferred" : undefined;
    return unitVal(v.value);
  }
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return undefined;
    if (s === "preferred") return "preferred";
    const m = s.match(/^(-?[\d.]+)\s*(dp|px|%)?$/);
    if (!m) return undefined;
    return { v: parseFloat(m[1]), u: m[2] || "dp" };
  }
  return undefined;
}
// props of one widget, with the current breakpoint's overrides applied
function propsOf(j, bpKey, extra) {
  const p = {
    left: unitVal(j._left_), top: unitVal(j._top_), right: unitVal(j._right_), bottom: unitVal(j._bottom_),
    width: unitVal(j._width_), height: unitVal(j._height_), centerX: unitVal(j.centerx), centerY: unitVal(j.centery),
    minWidth: unitVal(j.minwidth), maxWidth: unitVal(j.maxwidth), minHeight: unitVal(j.minheight), maxHeight: unitVal(j.maxheight),
    zIndex: j.zindex ?? 1, isVisible: j.isvisible !== false, skin: j._skin_ || null, layout: LAYOUT[j.layouttype] || "free",
    autogrow: j.autogrowmode === 1, clip: j.clipbounds !== false, padding: Array.isArray(j._padding_) ? j._padding_ : null, padPx: !!j.paddinginpixel,
    align: ALIGN[j.contentalignment] || "cntmiddleleftalign", text: j._text_ ?? null, textKey: j.texti18n || null, placeholder: j._placeholder_ ?? null, placeholderKey: j.placeholderi18n || null,
    src: j._src_ || null, scale: j.imagescalemode === 0 ? "fill" : "contain", wType: j.wType,
  };
  const apply = (o) => {
    if (!o || typeof o !== "object") return;
    for (const [k, v] of Object.entries(o)) {
      const key = RESP_KEY[k];
      if (!key) continue;
      if (key === "isVisible") p.isVisible = v !== false && v !== "false";
      else if (key === "skin") { if (v) p.skin = v; }
      else if (key === "zIndex") p.zIndex = v;
      else if (key === "text") p.text = v;
      else if (key === "layoutType") p.layout = LAYOUT[v] || p.layout;
      else p[key] = unitVal(v && typeof v === "object" && "Default" in v ? v.Default : v);
    }
  };
  if (extra) apply(extra);
  if (bpKey && j.responsiveData && j.responsiveData[bpKey]) apply(j.responsiveData[bpKey]);
  if (bpKey && extra && extra.responsiveData && extra.responsiveData[bpKey]) apply(extra.responsiveData[bpKey]);
  return p;
}
// component-instance overrides (dataDiffs on the instance), per inner widget id
function diffsOf(inst) {
  const out = {};
  for (const [id, d] of Object.entries((inst && inst.dataDiffs) || {})) {
    if (!d || typeof d !== "object") continue;
    const o = {};
    for (const [k, v] of Object.entries(d)) if (!k.startsWith("__")) o[k] = v && typeof v === "object" && "Default" in v ? v.Default : v;
    out[id] = { o, isRoot: !!(d.__info__ && d.__info__.isRoot) };
  }
  return out;
}

export function currentBreakpoint(formJson, width) {
  const info = (formJson && formJson.breakpointInfo) || {};
  const list = Object.entries(info).map(([k, v]) => [k, v && v.width]).filter(([, w]) => typeof w === "number").sort((a, b) => a[1] - b[1]);
  for (const [k, w] of list) if (width <= w) return { key: k, width: w, list };
  return { key: null, width: null, list };
}

/* ================================================================ build the tree */
// node: { id, path, j, p, kids, comp?, seg? }
async function buildTree(idx, A, W, bpKey, prefix, diffs, depth, overrides) {
  const root = [...W.values()].find((x) => !x.parent);
  if (!root) return null;
  const make = async (j, parentPath) => {
    const path = parentPath ? `${parentPath}.${j.id}` : j.id;
    const d = diffs && diffs[j.id];
    const p = propsOf(j, bpKey, d && d.o);
    const ov = overrides && overrides.get(prefix ? `${prefix}.${j.id}` : j.id);
    if (ov) Object.assign(p, ov);
    const node = { id: j.id, path: prefix ? `${prefix}.${j.id}` : j.id, j, p, kids: [] };
    if (j.wType === "UserWidgetInstance" && depth < 6) {
      const c = j.sourceUserWidget ? await compTree(idx, A, j.sourceUserWidget) : null;
      if (c) {
        const rootJ = [...c.W.values()].find((x) => !x.parent);
        const dd = diffsOf(j);
        const rootDiff = Object.values(dd).find((x) => x.isRoot);
        const rp = propsOf(rootJ, bpKey, rootDiff && rootDiff.o);
        // the instance positions the component; the component's root gives its look and layout
        p.skin = (rootDiff && rootDiff.o.skin) || rp.skin; p.layout = rp.layout; p.clip = rp.clip;
        if (!p.height && rp.height) p.height = rp.height;
        if (p.height === "preferred" && rp.autogrow) p.autogrow = true;
        node.comp = c.ns;
        const sub = await buildTree(idx, A, c.W, bpKey, node.path, dd, depth + 1, overrides);
        if (sub) node.kids = sub.kids;
      }
      return node;
    }
    if (j.wType === "Segment") {
      // forms name a template by its root flex id; that widget's file sits in the template's .sm folder
      const t = j.rowtemplate && (A.templates.get(j.rowtemplate) || [...A.templates.values()].find((x) => x.files.some((r) => r.endsWith(`/${j.rowtemplate}.json`))));
      if (t) {
        const TW = await treeOf(idx, t.files);
        node.seg = [];
        for (let r = 0; r < 3; r++) { const row = await buildTree(idx, A, TW, bpKey, `${node.path}[${r}]`, null, depth + 1, null); if (row) node.seg.push(row); }
      }
      return node;
    }
    for (const cid of j.children || []) { const cj = W.get(cid); if (cj) node.kids.push(await make(cj, path)); }
    return node;
  };
  const top = await make(root, "");
  return top;
}

/* ================================================================ render + layout in a document */
const BASE_CSS = `
*{box-sizing:border-box} html,body{margin:0;padding:0;background:#fff;font:normal normal 12px Helvetica, Arial, sans-serif}
.kw{position:absolute;left:0;top:0} .kin{width:100%;height:100%;position:relative;overflow:hidden}
.kin.noclip{overflow:visible} .kin.scroll{overflow:auto}
.kt{white-space:nowrap} .kt.wrap{white-space:pre-wrap;word-break:break-word}
.cnttopleftalign{display:flex;justify-content:flex-start;align-items:flex-start}.cnttopcenteralign{display:flex;justify-content:center;align-items:flex-start;text-align:center}.cnttoprightalign{display:flex;justify-content:flex-end;align-items:flex-start;text-align:right}
.cntmiddleleftalign{display:flex;justify-content:flex-start;align-items:center}.cntmiddlecenteralign{display:flex;justify-content:center;align-items:center;text-align:center}.cntmiddlerightalign{display:flex;justify-content:flex-end;align-items:center;text-align:right}
.cntbottomleftalign{display:flex;justify-content:flex-start;align-items:flex-end}.cntbottomcenteralign{display:flex;justify-content:center;align-items:flex-end;text-align:center}.cntbottomrightalign{display:flex;justify-content:flex-end;align-items:flex-end;text-align:right}
.kimg{width:100%;height:100%;display:block}
.kph{border:1px dashed #9aa3ad;color:#6b7280;font:11px Arial;display:flex;align-items:center;justify-content:center;background:repeating-linear-gradient(45deg,#f6f7f9,#f6f7f9 6px,#eef0f3 6px,#eef0f3 12px)}
input.kin,textarea.kin,select.kin{font:inherit;border-style:solid;outline:none;padding:0 6px;background-clip:padding-box}
.krow{position:relative}
.kw.bp-hover>.kin{outline:2px solid rgba(242,106,33,.55);outline-offset:-2px}
.kw.bp-sel>.kin{outline:3px solid #F26A21;outline-offset:-3px}
.kw.bp-flash>.kin{animation:bpflash 1.1s ease 2}
@keyframes bpflash{0%{box-shadow:0 0 0 0 rgba(242,106,33,.85) inset}50%{box-shadow:0 0 0 6px rgba(242,106,33,.85) inset}100%{box-shadow:0 0 0 0 rgba(242,106,33,0) inset}}
.kw.bp-changed>.kin{outline:2px dashed #3e5f8a;outline-offset:-2px}
.kw.bp-maybe>.kin{outline:2px dashed #b45309;outline-offset:-2px}
.bp-badge{position:absolute;right:2px;top:2px;background:#3e5f8a;color:#fff;font:700 9px Arial;padding:1px 4px;border-radius:6px;z-index:99999;pointer-events:none}
.bp-badge.maybe{background:#b45309}
`;

export async function renderPreview(idx, formKey, doc, opts) {
  const { width, height, overrides, onPick, onHover } = opts;
  const A = await previewAssets(idx);
  const f = idx.forms.get(formKey);
  const W = await treeOf(idx, f.files);
  const formJ = [...W.values()].find((x) => !x.parent);
  const bp = currentBreakpoint(formJ, width);
  const tree = await buildTree(idx, A, W, bp.key, "", null, 0, overrides);
  await writeDoc(idx, A, tree, doc);
  const body = doc.body;
  const formEl = doc.createElement("div");
  formEl.className = "kin " + (tree.p.skin ? "k_" + cssId(tree.p.skin) : "");
  formEl.style.cssText = `position:relative;width:${width}px;height:${height}px;overflow:auto`;
  body.appendChild(formEl);
  const ctx = { doc, A, i18n: A.i18n, byPath: new Map(), stats: { widgets: 0, placeholders: 0, hiddenWidgets: 0 } };
  for (const k of tree.kids) mount(ctx, k, formEl);
  layoutChildren(ctx, tree, formEl, width, height);
  // pick + hover
  body.addEventListener("click", (e) => { const w = e.target.closest(".kw"); if (w) { e.preventDefault(); if (onPick) onPick(w.dataset.path); } }, true);
  body.addEventListener("mouseover", (e) => { const w = e.target.closest(".kw"); for (const x of doc.querySelectorAll(".bp-hover")) x.classList.remove("bp-hover"); if (w) { w.classList.add("bp-hover"); if (onHover) onHover(w.dataset.path); } });
  return { tree, bp, byPath: ctx.byPath, stats: ctx.stats, formJ };
}

// a segment template drawn as one row of a segment `width` px wide: W = Map(widget id -> widget JSON) of its .sm
// folder (the top file is a Form whose one child is the row's root flex). showHidden: draw widgets hidden in the
// design too. Returns the tree, id -> node (node.el is the widget's element) and the row height.
export async function renderTemplate(idx, W, doc, { width, showHidden, extraCss = "" }) {
  const A = await previewAssets(idx);
  const top = [...W.values()].find((x) => !x.parent);
  const bp = currentBreakpoint(top, width);
  const tree = await buildTree(idx, A, W, bp.key, "", null, 0, null);
  if (!tree) return null;
  const byId = new Map();
  const walk = (n) => { byId.set(n.id, n); if (showHidden) n.p.isVisible = true; for (const k of n.kids) walk(k); };
  walk(tree);
  await writeDoc(idx, A, tree, doc, extraCss);
  const body = doc.body;
  const ctx = { doc, A, i18n: A.i18n, byPath: new Map(), stats: { widgets: 0, placeholders: 0, hiddenWidgets: 0 } };
  let total = 0;
  for (const row of tree.kids) {
    // like a segment row: the root flex's skin on the row, its children laid out inside; a dp height is kept, any
    // other height grows with the content
    const rowEl = doc.createElement("div"); rowEl.className = "krow kw"; rowEl.dataset.path = row.path; rowEl.style.position = "relative"; rowEl.style.width = width + "px";
    const rw = doc.createElement("div"); rw.className = "kin" + (row.p.skin ? " k_" + cssId(row.p.skin) : ""); rw.style.position = "relative";
    rowEl.appendChild(rw); body.appendChild(rowEl);
    row.el = rowEl; row.inner = rw;
    for (const k of row.kids) mount(ctx, k, rw);
    const bw = borderW(rw, "Left") + borderW(rw, "Right");
    const fixed = row.p.height && row.p.height !== "preferred" && row.p.height.u !== "%" ? row.p.height.v : null;
    const h = fixed != null ? fixed : layoutChildren(ctx, row, rw, width - bw, 0);
    rowEl.style.height = h + "px"; rw.style.height = h + "px";
    layoutChildren(ctx, row, rw, width - bw, h);
    total += h;
  }
  return { tree, byId, height: Math.max(1, Math.ceil(total)), stats: ctx.stats, bp };
}

// the iframe document: base CSS, the skins / fonts / images the tree uses
async function writeDoc(idx, A, tree, doc, extraCss = "") {
  const used = new Set(), fontsUsed = new Set(), imgs = new Set();
  const walk = (n) => { if (!n) return; if (n.p.skin) used.add(n.p.skin); if (n.p.src) imgs.add(n.p.src); for (const k of n.kids) walk(k); for (const r of n.seg || []) walk(r); };
  walk(tree);
  let css = BASE_CSS;
  for (const s of used) {
    const sk = A.skinsByKuid.get(s) || A.skinsByName.get(s);
    if (!sk) continue;
    const fn = skinFont(sk); if (fn) fontsUsed.add(fn);
    css += `.k_${cssId(s)}{${fixImages(skinStyle(sk), A)}}\n`;
  }
  for (const fn of fontsUsed) {
    const rel = A.fonts.get(fn.toLowerCase());
    if (rel) css += `@font-face{font-family:"${fn}";src:url("${await blobUrl(idx, A, rel)}")}\n`;
  }
  for (const s of imgs) { const rel = A.images.get(String(s).toLowerCase()); if (rel) await blobUrl(idx, A, rel); }
  for (const s of used) { const sk = A.skinsByKuid.get(s) || A.skinsByName.get(s); if (sk && sk.background_image) { const rel = A.images.get(String(sk.background_image).toLowerCase()); if (rel) await blobUrl(idx, A, rel); } }
  css = css.replace(/url\("__IMG__([^"]+)"\)/g, (_, n) => { const rel = A.images.get(n.toLowerCase()); return rel && A.blobs.get(rel) ? `url("${A.blobs.get(rel)}")` : "none"; });
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><style>${css}${extraCss}</style></head><body></body></html>`);
  doc.close();
  // image natural sizes are needed for preferred sizes
  for (const s of imgs) { const key = String(s).toLowerCase(); const v = A.imgSize.get(key); if (v === undefined || (v && typeof v.then === "function")) A.imgSize.set(key, (await imageSize(A, s)) || null); }
  // web fonts are only fetched once text uses them: load them all now, or preferred sizes are measured in a fallback font
  if (doc.fonts) { try { await Promise.race([Promise.all([...doc.fonts].map((ff) => ff.load().catch(() => null))), new Promise((r) => setTimeout(r, 4000))]); } catch { /* a missing font falls back */ } }
}
const cssId = (s) => String(s).replace(/[^A-Za-z0-9_-]/g, "_");
function fixImages(style, A) { return style.replace(/url\("([^"]+)"\)/g, (m, n) => (A.images.has(n.toLowerCase()) ? `url("__IMG__${n}")` : "none")); }
function imageSize(A, src) {
  const rel = A.images.get(String(src).toLowerCase()), url = rel && A.blobs.get(rel);
  return new Promise((res) => { if (!url) return res(null); const im = new Image(); im.onload = () => res({ w: im.naturalWidth, h: im.naturalHeight }); im.onerror = () => res(null); im.src = url; });
}

function textOf(ctx, p, which) {
  const key = which === "placeholder" ? p.placeholderKey : p.textKey;
  if (key && ctx.i18n[key] != null) return String(ctx.i18n[key]);
  const t = which === "placeholder" ? p.placeholder : p.text;
  return t == null ? "" : String(t);
}
function sanitize(doc, html) {
  const tpl = doc.createElement("template");
  tpl.innerHTML = String(html);
  for (const el of tpl.content.querySelectorAll("*")) {
    if (/^(script|style|iframe|object|embed|link|meta)$/i.test(el.tagName)) { el.remove(); continue; }
    for (const a of [...el.attributes]) if (/^on/i.test(a.name) || (/^(href|src)$/i.test(a.name) && /^\s*javascript:/i.test(a.value))) el.removeAttribute(a.name);
  }
  return tpl.innerHTML;
}

// create the DOM of a widget (wrapper + content), recursively
function mount(ctx, n, parentEl) {
  const { doc, A } = ctx;
  const p = n.p, t = p.wType;
  const w = doc.createElement("div");
  w.className = "kw"; w.dataset.path = n.path; w.style.zIndex = p.zIndex;
  n.el = w;
  ctx.byPath.set(n.path, n);
  ctx.stats.widgets++;
  if (!p.isVisible) { w.style.display = "none"; ctx.stats.hiddenWidgets++; }
  const skin = p.skin ? " k_" + cssId(p.skin) : "";
  let inner;
  if (CONTAINERS.has(t)) {
    inner = doc.createElement("div");
    inner.className = "kin" + skin + (t === "FlexScrollContainer" ? " scroll" : p.clip ? "" : " noclip");
    for (const k of n.kids) mount(ctx, k, inner);
  } else if (t === "Label" || t === "Button" || t === "RichText") {
    inner = doc.createElement("div");
    inner.className = "kin kt " + p.align + skin;
    if (t === "RichText") { const span = doc.createElement("div"); span.innerHTML = sanitize(doc, textOf(ctx, p)); inner.appendChild(span); }
    else inner.textContent = textOf(ctx, p);
  } else if (t === "Image") {
    inner = doc.createElement("div");
    inner.className = "kin" + skin;
    const rel = p.src && A.images.get(String(p.src).toLowerCase());
    if (rel && A.blobs.get(rel)) { const im = doc.createElement("img"); im.className = "kimg"; im.src = A.blobs.get(rel); im.style.objectFit = p.scale; inner.appendChild(im); }
    else { inner.classList.add("kph"); inner.textContent = p.src ? `image ${p.src} not in project` : "image"; ctx.stats.placeholders++; }
  } else if (t === "TextField" || t === "TextArea") {
    inner = doc.createElement(t === "TextArea" ? "textarea" : "input");
    inner.className = "kin" + skin; inner.readOnly = true; inner.tabIndex = -1;
    inner.placeholder = textOf(ctx, p, "placeholder"); inner.value = textOf(ctx, p);
  } else if (t === "ListBox") {
    inner = doc.createElement("select");
    inner.className = "kin" + skin; inner.tabIndex = -1;
    const md = Array.isArray(n.j.masterdata) ? n.j.masterdata : [];
    for (const it of md.slice(0, 20)) { const o = doc.createElement("option"); o.textContent = Array.isArray(it) ? String(it[1] ?? it[0]) : String(it); inner.appendChild(o); }
  } else if (t === "Segment") {
    inner = doc.createElement("div");
    inner.className = "kin scroll" + skin;
    for (const row of n.seg || []) {
      const r = doc.createElement("div"); r.className = "krow"; inner.appendChild(r);
      row.rowEl = r;
      const rw = doc.createElement("div"); rw.className = "kin" + (row.p.skin ? " k_" + cssId(row.p.skin) : ""); rw.style.position = "relative"; r.appendChild(rw);
      row.rowInner = rw;
      for (const k of row.kids) mount(ctx, k, rw);
    }
    if (!n.seg || !n.seg.length) { inner.classList.add("kph"); inner.textContent = `segment ${n.id} · row template ${n.j.rowtemplate || "?"} not found`; ctx.stats.placeholders++; }
  } else {
    inner = doc.createElement("div");
    inner.className = "kin kph" + skin; inner.textContent = `${t} ${n.id}`;
    ctx.stats.placeholders++;
  }
  w.appendChild(inner);
  n.inner = inner;
  parentEl.appendChild(w);
}

const px = (u, base) => (u == null || u === "preferred" ? undefined : u.u === "%" ? (u.v * base) / 100 : u.v);
const borderW = (el, side) => parseFloat(el.ownerDocument.defaultView.getComputedStyle(el)[`border${side}Width`]) || 0;

// lay out the children of a container whose content box is cw x ch (already set)
function layoutChildren(ctx, cont, box, cw, ch) {
  const kids = cont.kids;
  let prev = null;
  let extent = 0;
  for (const n of kids) {
    if (!n.p.isVisible) continue;
    const L = {};
    for (const k of ["left", "right", "centerX", "minWidth", "maxWidth"]) L[k] = px(n.p[k], cw);
    for (const k of ["top", "bottom", "centerY", "minHeight", "maxHeight"]) L[k] = px(n.p[k], ch);
    const free = cont.p.layout === "free";
    // padding is a % of the parent's width
    if (n.p.padding && !CONTAINERS.has(n.p.wType)) {
      const [pl, pt, pr, pb] = n.p.padding.map((x) => (n.p.padPx ? x : Math.floor((x * cw) / 100)));
      n.inner.style.padding = `${pt}px ${pr}px ${pb}px ${pl}px`;
    }
    // width
    let w = px(n.p.width, cw), measured = false;
    if (w == null) {
      if (free && L.centerX != null && L.left != null) w = (L.centerX - L.left) * 2;
      else if (free && L.centerX != null && L.right != null) w = (cw - L.centerX - L.right) * 2;
      else if (free && L.left != null && L.right != null) w = cw - L.left - L.right;
      else if (n.p.width !== "preferred" && DEF_W[n.p.wType]) w = px(unitVal(DEF_W[n.p.wType]), cw);
      else { w = prefWidth(ctx, n); measured = true; }
    }
    w = clamp(Math.max(0, w), L.minWidth, L.maxWidth);
    n.el.style.width = w + "px";
    if (!measured && n.inner.classList.contains("kt")) n.inner.classList.add("wrap");
    // height
    let h = px(n.p.height, ch);
    let grownKids = false;
    if (h == null) {
      if (free && L.centerY != null && L.top != null) h = (L.centerY - L.top) * 2;
      else if (free && L.centerY != null && L.bottom != null) h = (ch - L.centerY - L.bottom) * 2;
      else if (free && L.top != null && L.bottom != null) h = ch - L.top - L.bottom;
      else if (CONTAINERS.has(n.p.wType) && (n.p.autogrow || n.p.height === "preferred")) {
        const bw = borderW(n.inner, "Left") + borderW(n.inner, "Right"), bh = borderW(n.inner, "Top") + borderW(n.inner, "Bottom");
        h = layoutChildren(ctx, n, n.inner, w - bw, 0) + bh;
        grownKids = true;
      } else if (n.p.wType === "Segment") h = n.p.autogrow && n.seg && n.seg.length ? layoutSegment(ctx, n, w) : px(unitVal(DEF_H.Segment), ch);
      else if (n.p.height !== "preferred" && DEF_H[n.p.wType]) h = px(unitVal(DEF_H[n.p.wType]), ch);
      else h = prefHeight(ctx, n, w);
    }
    h = clamp(Math.max(0, h), L.minHeight, L.maxHeight);
    n.el.style.height = h + "px";
    // position
    let x, y;
    if (cont.p.layout === "hflow") {
      x = prev ? prev.x + prev.w : 0;
      if (L.centerX != null) x += L.centerX - w / 2; else if (L.left != null) x += L.left;
      if (prev && prev.L.right != null) x += prev.L.right;
    } else x = L.centerX != null ? centred(n.p.centerX, cont.p.layout, L.centerX, w, cw) : L.left != null ? L.left : L.right != null ? cw - (w + L.right) : 0;
    if (cont.p.layout === "vflow") {
      y = prev ? prev.y + prev.h : 0;
      if (L.centerY != null) y += L.centerY - h / 2; else if (L.top != null) y += L.top;
      if (prev && prev.L.bottom != null) y += prev.L.bottom;
    } else y = L.centerY != null ? centred(n.p.centerY, cont.p.layout, L.centerY, h, ch) : L.top != null ? L.top : L.bottom != null ? ch - (h + L.bottom) : 0;
    x = Math.trunc(x); y = Math.trunc(y);
    n.el.style.left = x + "px"; n.el.style.top = y + "px";
    n.frame = { x, y, w, h };
    // children (again after an autogrow, now that the real height is known)
    if (CONTAINERS.has(n.p.wType) && n.kids.length && (!grownKids || hasRelativeY(n))) {
      const bw = borderW(n.inner, "Left") + borderW(n.inner, "Right"), bh = borderW(n.inner, "Top") + borderW(n.inner, "Bottom");
      layoutChildren(ctx, n, n.inner, w - bw, h - bh);
    }
    if (n.p.wType === "Segment") layoutSegment(ctx, n, w);
    // extent used by an autogrowing parent (runtime: getAutoGrowFlexHeight)
    const e = (L.centerY != null ? L.centerY + h / 2 : (L.top || 0) + h) + (L.bottom || 0);
    if (cont.p.layout === "vflow") extent += e; else extent = Math.max(extent, e);
    prev = { x, y, w, h, L };
  }
  return extent;
}
// runtime determineX/Y: a % centre in a free-form parent is computed in whole percents
// (size% = floor(size / parent * 100); start% = parseInt(centre% - size% / 2))
function centred(raw, layout, c, size, parent) {
  if (raw && raw.u === "%" && layout === "free" && parent > 0) return (parseInt(raw.v - Math.floor((size / parent) * 100) / 2, 10) * parent) / 100;
  return c - size / 2;
}
const hasRelativeY = (n) => n.kids.some((k) => k.p.centerY || k.p.bottom || (k.p.top && k.p.top.u === "%") || (k.p.height && k.p.height !== "preferred" && k.p.height.u === "%"));
function clamp(v, mn, mx) { let r = v; if (mn != null && r < mn) r = mn; if (mx != null && r > mx) r = mx; return r; }
function prefWidth(ctx, n) {
  if (n.p.wType === "Image") { const s = sizeNow(ctx, n.p.src); return s ? s.w : 0; }
  const w = n.el;
  w.style.width = "auto"; w.style.left = "0px";
  n.inner.style.width = "auto";
  const r = w.offsetWidth;
  n.inner.style.width = "";
  return r;
}
function prefHeight(ctx, n, width) {
  if (n.p.wType === "Image") { const s = sizeNow(ctx, n.p.src); return s ? (s.w ? (s.h * width) / s.w : s.h) : 0; }
  const w = n.el;
  w.style.width = width + "px"; w.style.height = "auto";
  n.inner.style.height = "auto";
  const r = w.offsetHeight;
  n.inner.style.height = "";
  return r;
}
function sizeNow(ctx, src) {
  const v = ctx.A.imgSize.get(String(src || "").toLowerCase());
  return v && typeof v.then !== "function" ? v : null;
}
function layoutSegment(ctx, n, w) {
  let total = 0;
  for (const row of n.seg || []) {
    const rh = px(row.p.height, 0);
    const bw = borderW(row.rowInner, "Left") + borderW(row.rowInner, "Right");
    let h = rh;
    if (h == null) h = layoutChildren(ctx, row, row.rowInner, w - bw, 0);
    row.rowEl.style.height = h + "px"; row.rowInner.style.height = h + "px";
    layoutChildren(ctx, row, row.rowInner, w - bw, h);
    total += h;
  }
  return total;
}

// path -> { type, text } for every widget of a form and of the components on it (for plain-language names)
export async function widgetInfo(idx, formKey) {
  idx.widgetInfo = idx.widgetInfo || new Map();
  if (idx.widgetInfo.has(formKey)) return idx.widgetInfo.get(formKey);
  const A = await previewAssets(idx);
  const f = idx.forms.get(formKey);
  const out = new Map();
  const text = (j) => { const k = j.texti18n || j.placeholderi18n || j.tooltipi18n; if (k && A.i18n[k] != null) return String(A.i18n[k]); const t = j._text_ || j._placeholder_ || j.tooltip; return typeof t === "string" && t.trim() ? t : null; };
  if (f) {
    const W = await treeOf(idx, f.files);
    for (const j of W.values()) {
      out.set(j.id, { type: j.wType, text: text(j) });
      if (j.wType === "UserWidgetInstance" && j.sourceUserWidget) {
        const c = await compTree(idx, A, j.sourceUserWidget);
        if (c) for (const cj of c.W.values()) if (cj.parent) out.set(`${j.id}.${cj.id}`, { type: cj.wType, text: text(cj) });
      }
    }
  }
  idx.widgetInfo.set(formKey, out);
  return out;
}
