// The frame of an opened tool: its menu on the left, the page on the right.
import { useEffect, useRef, useSyncExternalStore } from "react";

export function Shell({ side, nav, setNav, openGroups, setOpenGroups, menu, head, foot, children }) {
  return (
    <div className={"shell" + (side ? "" : " side-collapsed")}>
      <Sidebar side={side} nav={nav} setNav={setNav} openGroups={openGroups} setOpenGroups={setOpenGroups} menu={menu} head={head} foot={foot} />
      <div className="content">{children}</div>
    </div>
  );
}

function Sidebar({ side, nav, setNav, openGroups, setOpenGroups, menu, head, foot }) {
  return (
    <div className={"side" + (side ? "" : " collapsed")}>
      <div className="wshead" title={head.sub}>
        <span className="ico">{head.ico}</span>
        <span className="lbl">{head.title}<div>{head.sub}</div></span>
      </div>
      <div className="menu">
        {menu.map((m) => {
          const hasItems = !!m.items;
          // a group opens by itself when one of its pages is open
          const isOpen = openGroups.has(m.id) || (hasItems && m.items.some((it) => it.id === nav));
          return (
            <div key={m.id} className={"mgroup" + (isOpen ? " open" : "")}>
              <div className={"mhead" + (nav === m.id && !hasItems ? " active" : "")}
                onClick={() => {
                  if (hasItems) setOpenGroups((s) => { const c = new Set(s); if (c.has(m.id)) c.delete(m.id); else c.add(m.id); return c; });
                  else setNav(m.id);
                }}>
                <span className="ico">{m.ico}</span>
                <span className="lbl">{m.label}<div style={{ fontSize: 12.5, fontWeight: 400, color: "var(--side-muted)" }}>{m.desc}</div></span>
                {hasItems && <span className="chev">▶</span>}
              </div>
              {hasItems && (
                <div className="sub">
                  {m.items.map((it) => (
                    <div key={it.id} className={"subitem" + (nav === it.id ? " active" : "")} onClick={() => setNav(it.id)}>
                      <span className="dot" /> {it.label}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="foot">{foot}</div>
    </div>
  );
}

/* ---------------------------------------------------------------- what each tool tells the frame */
// meta: { entered, status, reset } — shown in the top bar and on the Projects page
// entities: [{ label, sub, kind, route }] — what the search (Ctrl+K) can jump to inside the tool
const meta = {}, entities = {};
const subs = new Set();
let ver = 0;
const emit = () => { ver++; for (const f of subs) f(); };
const subscribe = (f) => { subs.add(f); return () => subs.delete(f); };
const snapshot = () => ver;

export function useRegistry() {
  useSyncExternalStore(subscribe, snapshot);
  return { meta, entities };
}

export function useToolMeta(tool, m) {
  const key = JSON.stringify([m.entered, m.status]);
  useEffect(() => { meta[tool] = m; emit(); }, [tool, key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (meta[tool]) meta[tool].reset = m.reset; });
}

export function useToolEntities(tool, list) {
  useEffect(() => { entities[tool] = list || []; emit(); }, [tool, list]);
}

// a page address inside a comparison (a reload, a bookmark): start it by itself once its folders are loaded
export function useAutoStart({ active, deep }, can, go) {
  const done = useRef(false);
  useEffect(() => {
    if (active && deep && can && !done.current) { done.current = true; go(); }
  }, [active, deep, can]); // eslint-disable-line react-hooks/exhaustive-deps
}
