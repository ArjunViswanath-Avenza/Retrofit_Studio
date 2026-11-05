// Exclude parameters: leave widget parameters (top-level JSON keys) and relationship changes ("parent", "children")
// out of "modified" — a widget then counts only if something else changed. Used by TemplateTwin and COMP-are; every
// item is recounted from what the analysis recorded per widget (r.wkeys, r.rel).
import { useState, useEffect, useMemo } from "react";

// one item (template / component) recounted without the excluded parameters: a widget only counts as modified when
// something else changed
export function adjust(r, excl) {
  if (!r.wkeys) return r;
  const structure = { ...r.structure };
  let hidden = 0;
  for (const [pair, s] of Object.entries(r.structure)) {
    const list = r.wkeys[pair];
    if (!list || !s) continue;
    const pw = list.filter((ks) => ks.some((k) => !excl.has(k))).length;
    if (pair === "01") hidden = s.propWidgets - pw;
    structure[pair] = { ...s, propWidgets: pw, moved: excl.has("parent") ? 0 : s.moved, reordered: excl.has("children") ? 0 : s.reordered || 0 };
  }
  const s = structure["01"];
  const st = s ? s.added + s.removed + s.moved + s.propWidgets + (s.reordered || 0) : 0;
  const changes = { ...r.changes, structure: st };
  const total = Object.values(changes).reduce((x, y) => x + (y || 0), 0);
  const status = r.status === "customised" || r.status === "unchanged" ? (total ? "customised" : "unchanged") : r.status;
  return { ...r, structure, changes, total, status, hidden, statusBefore: r.status };
}
const FRIENDLY = {
  parent: "new parent", children: "child order",
  _skin_: "skin", focusskin: "focus skin", hoverskin: "hover skin", disabledSkins: "disabled skins", pressedskin: "pressed skin", shellCSS: "custom CSS",
  _width_: "width", _height_: "height", _left_: "left", _top_: "top", _right_: "right", _bottom_: "bottom", centerx: "center X", centery: "center Y",
  minwidth: "min width", maxwidth: "max width", minheight: "min height", maxheight: "max height", zindex: "z-index", _padding_: "padding", paddinginpixel: "padding in px",
  _margin_: "margin", contentalignment: "content alignment", layouttype: "layout", autogrowmode: "auto-grow", reverselayoutdirection: "reverse layout",
  _text_: "text", texti18n: "text (i18n key)", tooltip: "tooltip", isvisible: "visible", _src_: "image", accessibilityconfig: "accessibility",
  context: "design context", breakpointInfo: "breakpoints", currentBreakpoint: "current breakpoint", kuid: "widget id (kuid)", containerId: "container id",
  currentLocale: "design locale", snapgridsize: "snap grid", snaptogrid: "snap to grid", iscustomlayout: "custom layout", clipbounds: "clip bounds",
};
const GROUPS = [
  ["Skins & styles", (k) => /skin/i.test(k) || k === "shellCSS"],
  ["Position & size", (k) => /^(_left_|_top_|_right_|_bottom_|_width_|_height_|centerx|centery|min(width|height)|max(width|height)|zindex|_padding_|paddinginpixel|_margin_|contentalignment|layouttype|autogrowmode|reverselayoutdirection)$/.test(k)],
  ["Text", (k) => /^(_text_|texti18n|tooltip|tooltipi18n|_placeholder_|placeholderi18n)$/.test(k)],
  ["Visibility", (k) => k === "isvisible"],
  ["Relationships", (k) => k === "parent" || k === "children"],
  ["Events", (k) => /^ide_on/.test(k)],
  ["Design-time settings", (k) => /^(context|breakpointInfo|currentBreakpoint|kuid|containerId|currentLocale|snapgridsize|snaptogrid|iscustomlayout)$/.test(k)],
];
export const keyName = (k) => (FRIENDLY[k] ? `${FRIENDLY[k]}` : k);

// what excluding a set of parameters would take out of the KBZ-vs-R21 counts
function impact(raw, set) {
  let widgets = 0, templates = 0;
  for (const r of raw) {
    const list = r.wkeys && r.wkeys["01"];
    if (!list) continue;
    const gone = list.filter((ks) => ks.every((k) => set.has(k))).length + (r.rel && r.rel["01"] ? (set.has("parent") ? r.rel["01"].moved : 0) + (set.has("children") ? r.rel["01"].reordered : 0) : 0);
    widgets += gone;
    if (gone && r.status === "customised") { const a = adjust(r, set); if (a.status === "unchanged") templates++; }
  }
  return { widgets, templates };
}

// noun: what one item is called ("template" / "component")
export function ExcludeBar({ raw, excl, setExcl, labels, noun = "template" }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => new Set(excl));
  const [q, setQ] = useState("");
  useEffect(() => { if (open) setDraft(new Set(excl)); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  // every parameter that changes on some widget: widgets / templates where it changed (KBZ vs R21), and in the other pairs
  const keys = useMemo(() => {
    const m = new Map();
    for (const r of raw) for (const [pair, list] of Object.entries(r.wkeys || {})) {
      const seen = new Set();
      for (const ks of list) for (const k of ks) {
        if (!m.has(k)) m.set(k, { k, cat: (r.keyCat && r.keyCat[k]) || "other", w01: 0, t01: 0, other: 0 });
        const x = m.get(k);
        if (pair === "01") { x.w01++; if (!seen.has(k)) { seen.add(k); x.t01++; } } else x.other++;
      }
    }
    // relationship changes: widgets with a new parent, containers whose children changed order
    for (const [k, f] of [["parent", "moved"], ["children", "reordered"]]) {
      const x = { k, cat: "relationships", w01: 0, t01: 0, other: 0 };
      for (const r of raw) for (const [pair, v] of Object.entries(r.rel || {})) { const n = v[f] || 0; if (!n) continue; if (pair === "01") { x.w01 += n; x.t01++; } else x.other += n; }
      if (x.w01 || x.other) m.set(k, x);
    }
    return [...m.values()].sort((a, b) => b.w01 - a.w01 || b.other - a.other || a.k.localeCompare(b.k));
  }, [raw]);
  const ql = q.trim().toLowerCase();
  const shownKeys = keys.filter((x) => !ql || x.k.toLowerCase().includes(ql) || keyName(x.k).toLowerCase().includes(ql));
  const toggle = (k) => setDraft((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const groupKeys = (f) => keys.filter((x) => f(x.k)).map((x) => x.k);
  const toggleGroup = (f) => { const g = groupKeys(f); if (!g.length) return; setDraft((s) => { const n = new Set(s); const all = g.every((k) => n.has(k)); for (const k of g) { if (all) n.delete(k); else n.add(k); } return n; }); };
  const before = useMemo(() => impact(raw, excl), [raw, excl]);
  const would = useMemo(() => impact(raw, draft), [raw, draft]);
  const missing = !raw.some((r) => r.wkeys);
  return (
    <div className="sx">
      <div className="sx-bar">
        <button className={"btn" + (excl.size ? "" : " ghost")} onClick={() => setOpen((v) => !v)}>⊘ Exclude parameters{excl.size ? ` (${excl.size})` : ""}</button>
        {excl.size > 0 ? (
          <>
            <span className="sx-sum">Not counted as a change: {[...excl].map((k) => <span key={k} className="sx-pill">{keyName(k)}<i onClick={() => setExcl((s) => { const n = new Set(s); n.delete(k); return n; })} title="Count it again">✕</i></span>)}</span>
            <span className="tag">{before.widgets} widget{before.widgets === 1 ? "" : "s"} and {before.templates} {noun}{before.templates === 1 ? "" : "s"} no longer count as changed ({labels[1]} vs {labels[0]})</span>
            <button className="btn ghost" onClick={() => setExcl(new Set())}>Clear</button>
          </>
        ) : <span className="tag">Leave out parameters (e.g. skin) — a widget then only counts as modified when something else changed.</span>}
      </div>
      {open && (
        <div className="sx-panel">
          {missing ? <p className="note">These results were read before parameter details were recorded — open the comparison again (New project → Start comparison) to use this filter.</p> : (
            <>
              <div className="sx-groups">
                <span className="tag">Quick picks:</span>
                {GROUPS.map(([name, f]) => { const g = groupKeys(f); if (!g.length) return null; const all = g.every((k) => draft.has(k)); return <span key={name} className={"chip" + (all ? " on" : "")} onClick={() => toggleGroup(f)} title={g.join(", ")}>{all ? "✓ " : ""}{name} ({g.length})</span>; })}
              </div>
              <div className="sx-search"><input type="text" placeholder={`Find among ${keys.length} parameters…`} value={q} onChange={(e) => setQ(e.target.value)} /></div>
              <div className="sx-list">
                {shownKeys.map((x) => (
                  <label key={x.k} className={"sx-row" + (draft.has(x.k) ? " on" : "")}>
                    <input type="checkbox" checked={draft.has(x.k)} onChange={() => toggle(x.k)} />
                    <b>{keyName(x.k)}</b>{FRIENDLY[x.k] && <span className="mono sx-key">{x.k}</span>}
                    <span className="sx-cat">{x.cat}</span>
                    <span className="sx-n">{x.w01 ? `${x.w01} widget${x.w01 === 1 ? "" : "s"} in ${x.t01} ${noun}${x.t01 === 1 ? "" : "s"}` : "—"}{x.other ? <em> · {x.other} in the {labels[2] || "other"} comparisons</em> : null}</span>
                  </label>
                ))}
              </div>
              <div className="sx-foot">
                <span className="tag">{draft.size} selected · applying takes {would.widgets} widget{would.widgets === 1 ? "" : "s"} and {would.templates} {noun}{would.templates === 1 ? "" : "s"} out of “changed” ({labels[1]} vs {labels[0]})</span>
                <span className="spacer" />
                <button className="btn ghost" onClick={() => setDraft(new Set())}>Clear selection</button>
                <button className="btn ghost" onClick={() => setOpen(false)}>Cancel</button>
                <button className="btn" onClick={() => { setExcl(new Set(draft)); setOpen(false); }}>Apply</button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
