// Widget-tree diff for Kony / Temenos Quantum `.sm` forms.
// A `.sm` folder is one form; every `<widgetId>.json` inside it is one widget with
// `id`, `wType`, `name`, `parent` and `children` (ordered widget ids). The root is the
// widget with no parent (the Form itself). Widgets are matched across versions by id.

// Structural keys are handled as added/removed/moved; `_vizProps_` is a Visualizer
// design-time setting; `__x__` keys are IDE-internal state (e.g. `__parentReadjusting__`,
// `__info__`, `__events__`). None of these describe app behaviour.
const IGNORE_TOP = new Set(["children", "parent", "_vizProps_"]);
const isDunder = (k) => k.length > 4 && k.startsWith("__") && k.endsWith("__");
export const isNoiseKey = (k) => IGNORE_TOP.has(k) || isDunder(k);

export const STATUSES = ["added", "removed", "moved", "modified"];

// ---- property categories (for grouping + filtering; nothing is hidden by default) ----
export const CATEGORIES = ["content", "visibility", "style", "layout", "data", "events", "type", "embedded", "platform", "other"];
export const CATEGORY_LABELS = {
  content: "Text / content", visibility: "Visibility / state", style: "Style / skin", layout: "Layout / geometry",
  data: "Data / bindings", events: "Events / actions", type: "Type / identity", embedded: "Embedded widgets",
  platform: "Platform-specific", other: "Metadata / other",
};

// Some objects (e.g. a Form) carry whole widget definitions inline, keyed by widget id,
// with no separate <id>.json file. Those are reported as one embedded-widget change each.
const isWidgetLike = (v) => !!v && typeof v === "object" && !Array.isArray(v) && ("@class" in v || "DNDConfig" in v || "wType" in v);
const widgetTypeOf = (v) => (v && (v.wType || (typeof v["@class"] === "string" && v["@class"].split(".").pop().replace(/^KViz/, "")))) || "widget";
const CAT_RULES = [
  ["type", /^(wtype|name|kuid|@class)$/],
  ["platform", /^(android|iphone|ipad|kiosk|windows8|windows10|winphone8|winphone10|tabrcandroid|androidwearos|spa[a-z0-9]*|desktopweb|mobile|tablet)$/],
  ["events", /^(on\w+|ide_\w+|events)$/],
  ["content", /^(text|placeholder|tooltip|title|\w*i18n\w*|accessibilityconfig|masterdata|selectedkey|selectedkeys|src|imagewhenfailed|imagewhileloading|value)$/],
  ["visibility", /^(isvisible|visible|enable|enabled|disabled|editable|isreadonly)$/],
  ["style", /(skin|font|color|border|shadow|css|opacity)/],
  ["layout", /^(top|left|right|bottom|width|height|minwidth|maxwidth|minheight|maxheight|zindex|margin|padding|paddinginpixel|centerx|centery|layouttype|contentsize|contentoffset|contentalignment|orientation|autogrow|autogrowmode|autogrowheight|percent|responsivedata|breakpointinfo|currentbreakpoint|containerweight|hexpand|vexpand|clipbounds|reversed|displayorientation|scrolldirection|allowhorizontalbounce|allowverticalbounce)$/],
  ["data", /^(datadiffs|data|widgetdatamap|rowtemplate|sectionheadertemplate|dataset|groupcells|selectionbehavior|info|customproperties|requesturlconfig)$/],
];
export function categoryOf(key, wType) {
  const k = key.replace(/^_+|_+$/g, "").toLowerCase();
  for (const [c, re] of CAT_RULES) if (re.test(k)) return c;
  if (wType === "Segment") return "data"; // segment row-template / data sections keyed by widget id
  return "other";
}

// Strip IDE-only dunder keys recursively and collapse empty containers:
// null, {}, [] and "missing" are all treated as the same "no value".
function clean(v) {
  if (Array.isArray(v)) {
    const out = v.map(clean);
    return out.some((x) => x !== undefined) ? out : undefined;
  }
  if (v && typeof v === "object") {
    const out = {};
    let any = false;
    for (const [k, x] of Object.entries(v)) {
      if (isDunder(k)) continue;
      const c = clean(x);
      if (c !== undefined) { out[k] = c; any = true; }
    }
    return any ? out : undefined;
  }
  return v === null ? undefined : v;
}
// order-insensitive serialisation for comparison
function stable(v) {
  if (v === undefined) return "∅";
  if (Array.isArray(v)) return "[" + v.map(stable).join(",") + "]";
  if (v && typeof v === "object") return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + stable(v[k])).join(",") + "}";
  return JSON.stringify(v);
}
// nested objects -> dotted leaf paths, so a component override reads as `dataDiffs.lbl.text`
function flatten(v, prefix, out, depth) {
  if (v && typeof v === "object" && !Array.isArray(v) && depth < 6) {
    for (const [k, x] of Object.entries(v)) flatten(x, prefix + "." + k, out, depth + 1);
  } else out[prefix] = v;
  return out;
}

// two property values are the same change-wise (null / {} / [] / missing alike, IDE-only keys ignored, key order ignored)
export const sameValue = (a, b) => stable(clean(a)) === stable(clean(b));

// the common children of two versions of a container, each in its own order (only ids present in both lists)
export function commonOrder(ca, cb) {
  const A = ca || [], B = cb || [];
  const inB = new Set(B), inA = new Set(A);
  return [A.filter((c) => inB.has(c)), B.filter((c) => inA.has(c))];
}

function leafDiffs(va, vb, key, category) {
  const out = [];
  const fa = flatten(va, key, {}, 0), fb = flatten(vb, key, {}, 0);
  for (const path of new Set([...Object.keys(fa), ...Object.keys(fb)])) {
    if (stable(fa[path]) !== stable(fb[path])) out.push({ path, key, category, old: fa[path], new: fb[path] });
  }
  return out;
}

function propDiff(a, b, wType) {
  const out = [];
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (isNoiseKey(key)) continue;
    const ra = a[key], rb = b[key];
    const va = clean(ra), vb = clean(rb);
    if (stable(va) === stable(vb)) continue;
    if (isWidgetLike(ra) || isWidgetLike(rb)) {
      // one entry per embedded widget; its inner property diffs are kept for drill-in
      const inner = leafDiffs(va, vb, key, "embedded");
      out.push({
        path: key, key, category: "embedded", embedded: true,
        change: !va ? "added" : !vb ? "removed" : "changed",
        widgetType: widgetTypeOf(rb || ra), innerCount: inner.length, inner,
        old: va ? `[${widgetTypeOf(ra)} definition]` : undefined,
        new: vb ? `[${widgetTypeOf(rb)} definition]` : undefined,
      });
      continue;
    }
    out.push(...leafDiffs(va, vb, key, categoryOf(key, wType)));
  }
  return out.sort((x, y) => x.path.localeCompare(y.path));
}

// Cheap per-form summary from widget ids (filenames) only — no file reads needed.
export function idSetDiff(idsA, idsB) {
  let added = 0, removed = 0;
  for (const i of idsB) if (!idsA.has(i)) added++;
  for (const i of idsA) if (!idsB.has(i)) removed++;
  return { added, removed };
}

// Full union-tree diff. WA / WB: { widgetId: json } (either may be empty = form missing on that side).
// The tree follows the NEW (B) structure; removed widgets hang under their old parent.
export function buildFormDiff(WA, WB) {
  const nodes = new Map();
  for (const id of new Set([...Object.keys(WA), ...Object.keys(WB)])) {
    const a = WA[id], b = WB[id];
    const src = b || a;
    let status, props = [], moved = false, reorder = null;
    if (a && !b) status = "removed";
    else if (!a && b) status = "added";
    else {
      props = propDiff(a, b, src.wType);
      moved = (a.parent ?? null) !== (b.parent ?? null);
      // children kept in both versions but in another order (a flow layout draws them differently)
      const [oa, ob] = commonOrder(a.children, b.children);
      if (oa.join("|") !== ob.join("|")) reorder = { old: oa, new: ob };
      status = statusOf({ status: "both", moved, props, reorder });
    }
    nodes.set(id, {
      id, status, props, moved, reorder,
      wType: src.wType || "", name: src.name || "",
      treeParent: (b ? b.parent : a.parent) ?? null,
      oldParent: a ? a.parent ?? null : null,
      newParent: b ? b.parent ?? null : null,
      children: [], depth: 0, detached: false,
    });
  }

  // ordered children: new order first, then anything only listed in the old order
  for (const [id, n] of nodes) {
    const seen = new Set();
    const push = (c) => {
      const cn = nodes.get(c);
      if (cn && cn.treeParent === id && !seen.has(c)) { seen.add(c); n.children.push(c); }
    };
    (WB[id]?.children || []).forEach(push);
    (WA[id]?.children || []).forEach(push);
  }
  for (const [id, n] of nodes) {
    const p = n.treeParent != null && nodes.get(n.treeParent);
    if (p && !p.children.includes(id)) p.children.push(id);
  }
  const roots = [...nodes.values()].filter((n) => n.treeParent == null || !nodes.has(n.treeParent)).map((n) => n.id);
  // The Form is the real root; any other root is a widget whose parent no longer exists
  // in the form (stale/orphaned files) — shown separately as "detached".
  const formRoot = roots.find((id) => nodes.get(id).wType === "Form") || roots[0] || null;
  const detached = roots.filter((id) => id !== formRoot);

  // depth (iterative, cycle-safe) + preorder list for fast recomputation in the UI
  const order = [];
  const visited = new Set();
  for (const r of [formRoot, ...detached].filter(Boolean)) {
    const stack = [[r, 0]];
    while (stack.length) {
      const [id, d] = stack.pop();
      if (visited.has(id)) continue;
      visited.add(id);
      const n = nodes.get(id);
      n.depth = d;
      n.detached = r !== formRoot;
      order.push(id);
      for (let i = n.children.length - 1; i >= 0; i--) stack.push([n.children[i], d + 1]);
    }
  }

  const totals = { added: 0, removed: 0, moved: 0, modified: 0, same: 0, reordered: 0 };
  let propWidgets = 0, leaves = 0;
  const byCategory = {}, byKey = {};
  for (const n of nodes.values()) {
    totals[n.status]++;
    if (n.reorder) totals.reordered++;
    if (n.props.length) {
      propWidgets++;
      leaves += n.props.length;
      for (const p of n.props) {
        byCategory[p.category] = (byCategory[p.category] || 0) + 1;
        byKey[p.key] = (byKey[p.key] || 0) + 1;
      }
    }
  }
  return {
    nodes, roots, formRoot, detached, order, totals, propWidgets, leaves, byCategory, byKey,
    sizeA: Object.keys(WA).length, sizeB: Object.keys(WB).length,
  };
}

// a widget in both versions: moved (new parent), modified (properties or child order), or the same
function statusOf(n) {
  if (n.status === "added" || n.status === "removed") return n.status;
  return n.moved ? "moved" : n.props.length || n.reorder ? "modified" : "same";
}

// Per-node effective counts (self + descendants) and per-level counts, given which property
// changes are "in scope" (category / key filters). Recomputed in the UI when filters change.
export function computeCounts(diff, propInScope) {
  const eff = new Map();
  const statusOf = (n) => (n.status === "modified" ? (n.props.some(propInScope) || n.reorder ? "modified" : "same") : n.status);
  const levels = new Map();
  for (const id of diff.order) {
    const n = diff.nodes.get(id);
    const st = statusOf(n);
    eff.set(id, { status: st, added: 0, removed: 0, moved: 0, modified: 0, props: n.props.filter(propInScope).length });
    if (!n.detached) {
      const L = levels.get(n.depth) || { depth: n.depth, total: 0, added: 0, removed: 0, moved: 0, modified: 0 };
      L.total++;
      if (st !== "same") L[st]++;
      levels.set(n.depth, L);
    }
  }
  // post-order accumulation: walk the preorder list backwards
  for (let i = diff.order.length - 1; i >= 0; i--) {
    const id = diff.order[i], n = diff.nodes.get(id), e = eff.get(id);
    if (e.status !== "same") e[e.status]++;
    const p = n.treeParent != null && eff.get(n.treeParent);
    if (p && diff.nodes.get(n.treeParent).children.includes(id)) for (const k of STATUSES) p[k] += e[k];
  }
  return { eff, levels: [...levels.values()].sort((x, y) => x.depth - y.depth) };
}

// Summary used by the form list scan (drops the tree afterwards).
export function summarizeForm(WA, WB) {
  const d = buildFormDiff(WA, WB);
  return { ...d.totals, propWidgets: d.propWidgets, leaves: d.leaves, byCategory: d.byCategory };
}

// Relationship changes can be left out like parameters: "parent" (a new parent) and "children" (child order)
export const REL_KEYS = ["parent", "children"];

// the same diff with some parameters (top-level widget JSON keys, or "parent" / "children") left out: a widget whose
// only changes are excluded counts as unchanged; added / removed widgets are kept
export function withoutKeys(diff, keys) {
  if (!diff || !keys || !keys.size) return diff;
  const nodes = new Map();
  const totals = { added: 0, removed: 0, moved: 0, modified: 0, same: 0, reordered: 0 };
  let propWidgets = 0, leaves = 0;
  for (const [id, n] of diff.nodes) {
    const props = n.props.filter((p) => !keys.has(p.key));
    const m = withoutRelations(n, keys, props);
    nodes.set(id, { ...m, excluded: n.props.length - props.length });
    totals[m.status]++;
    if (m.reorder) totals.reordered++;
    if (props.length) { propWidgets++; leaves += props.length; }
  }
  return { ...diff, nodes, totals, propWidgets, leaves };
}

// one widget with excluded relationship changes dropped (properties untouched unless given)
export function withoutRelations(n, keys, props = n.props) {
  if (n.status === "added" || n.status === "removed") return props === n.props ? n : { ...n, props };
  const moved = n.moved && !keys.has("parent"), reorder = keys.has("children") ? null : n.reorder;
  return { ...n, props, moved, reorder, status: statusOf({ status: "both", moved, props, reorder }) };
}

// the diff with excluded relationship changes ("parent", "children") dropped from every widget; properties kept
export function withoutRelationKeys(diff, keys) {
  if (!diff || !keys || !REL_KEYS.some((k) => keys.has(k))) return diff;
  const nodes = new Map();
  for (const [id, n] of diff.nodes) nodes.set(id, withoutRelations(n, keys));
  return { ...diff, nodes };
}
