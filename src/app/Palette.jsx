// Search (Ctrl+K): every tool and page, plus what the open tools hold — forms, controllers, components, templates,
// modules. Choosing a result opens its page address.
import { useState, useEffect, useMemo, useRef } from "react";
import { TOOLS, TOOL_ORDER, AREAS } from "./tools";
import { useRegistry } from "./Shell";
import { useProjects } from "./projects";

const MAX = 60;

export function Palette({ onClose, go }) {
  const { entities } = useRegistry();
  const { L } = useProjects();
  const [q, setQ] = useState("");
  const [at, setAt] = useState(0);
  const input = useRef(null);
  const list = useRef(null);
  useEffect(() => { if (input.current) input.current.focus(); }, []);

  const pages = useMemo(() => {
    const out = [{ label: "Projects", sub: "load folders · version names", kind: "Page", route: { tool: "projects" } }];
    for (const t of TOOL_ORDER) {
      const T = TOOLS[t], area = AREAS.find((a) => a.id === T.area).label;
      out.push({ label: T.title, sub: area, kind: "Tool", route: { tool: t } });
      for (const m of T.menu(L[T.names === "fabric" ? "fabric" : "viz"])) {
        for (const it of m.items || [m]) out.push({ label: m.items ? `${m.label} · ${it.label}` : m.label, sub: `${area} · ${T.title}`, kind: "Page", route: { tool: t, nav: it.id } });
      }
    }
    return out;
  }, [L]);

  const results = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const all = [...pages, ...Object.values(entities).flat()];
    if (!ql) return pages.slice(0, MAX);
    const scored = [];
    for (const e of all) {
      const l = e.label.toLowerCase(), s = (e.sub || "").toLowerCase();
      const score = l === ql ? 0 : l.startsWith(ql) ? 1 : l.includes(ql) ? 2 : s.includes(ql) ? 3 : -1;
      if (score >= 0) scored.push([score, e]);
      if (scored.length > 4000) break;
    }
    scored.sort((a, b) => a[0] - b[0] || a[1].label.length - b[1].label.length || (a[1].sub || "").length - (b[1].sub || "").length);
    return scored.slice(0, MAX).map((x) => x[1]);
  }, [q, pages, entities]);

  useEffect(() => setAt(0), [q]);
  useEffect(() => { const el = list.current && list.current.children[at]; if (el) el.scrollIntoView({ block: "nearest" }); }, [at]);
  const choose = (e) => { if (!e) return; onClose(); go(e.route); };
  const onKey = (ev) => {
    if (ev.key === "ArrowDown") { ev.preventDefault(); setAt((i) => Math.min(results.length - 1, i + 1)); }
    else if (ev.key === "ArrowUp") { ev.preventDefault(); setAt((i) => Math.max(0, i - 1)); }
    else if (ev.key === "Enter") { ev.preventDefault(); choose(results[at]); }
    else if (ev.key === "Escape") onClose();
  };
  const loaded = Object.values(entities).reduce((n, l) => n + l.length, 0);

  return (
    <div className="pal-back" onMouseDown={onClose}>
      <div className="pal" role="dialog" aria-label="Search" onMouseDown={(e) => e.stopPropagation()}>
        <input ref={input} className="pal-in" placeholder="Search tools, pages, forms, controllers, components, templates…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} />
        <div className="pal-list" ref={list}>
          {results.map((e, i) => (
            <div key={i} className={"pal-row" + (i === at ? " on" : "")} onMouseEnter={() => setAt(i)} onClick={() => choose(e)}>
              <span className="pal-k">{e.kind}</span>
              <b>{e.label}</b>
              <span className="pal-s">{e.kind !== "Tool" && e.kind !== "Page" && TOOLS[e.route.tool] ? `${TOOLS[e.route.tool].title} · ` : ""}{e.sub}</span>
            </div>
          ))}
          {!results.length && <div className="pal-none">Nothing matches “{q}”.</div>}
        </div>
        <div className="pal-foot">↑ ↓ to move · Enter to open · Esc to close · {loaded ? `${loaded.toLocaleString()} items from the open tools` : "open a comparison or Blueprint to search its forms, controllers and templates"}</div>
      </div>
    </div>
  );
}
