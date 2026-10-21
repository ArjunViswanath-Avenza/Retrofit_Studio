// Code flow breakdown · story view: the flow told one step at a time, with a dot travelling between the parts
// of the app (screen, screen logic, app logic, business rules, bank systems) as each step happens.
import { useState, useEffect, useMemo, useRef } from "react";
import { STATIONS, buildJourney, pathOf, screenName } from "../lib/journey";

const nf = (n) => Number(n || 0).toLocaleString("en-US");
const KIND_ICON = { trigger: "👆", screen: "🖥️", service: "🏦", navigate: "➜", event: "📣", problem: "⚠️" };

export function FlowJourney({ entry, T, info, formName, onCode, onDeveloper }) {
  const J = useMemo(() => buildJourney(T, entry, { info, formName }), [T, entry, info, formName]);
  const [choice, setChoice] = useState(() => new Map());
  const path = useMemo(() => pathOf(J, choice), [J, choice]);
  const [shown, setShown] = useState(1); // cards revealed
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [station, setStation] = useState(path[0] ? path[0].station : 0);
  const [visited, setVisited] = useState(() => new Set([0]));
  const [all, setAll] = useState(false);
  const listRef = useRef(null);

  // a new action starts from the beginning
  useEffect(() => { setChoice(new Map()); setShown(1); setPlaying(true); setStation(0); setVisited(new Set([0])); }, [J]);

  // reveal the next card: the dot first hops through the parts the code passed on the way, then lands
  useEffect(() => {
    if (!playing || all) return;
    if (shown >= path.length) { setPlaying(false); return; }
    const next = path[shown];
    const hops = [...(next.trail || []), next.station];
    let k = 0, alive = true;
    const hop = () => {
      if (!alive) return;
      if (k < hops.length) { const st = hops[k++]; setStation(st); setVisited((v) => new Set(v).add(st)); setTimeout(hop, 260 / speed); }
      else setTimeout(() => alive && setShown((n) => n + 1), 380 / speed);
    };
    const t = setTimeout(hop, 520 / speed);
    return () => { alive = false; clearTimeout(t); };
  }, [playing, shown, path, speed, all]);
  useEffect(() => {
    const el = listRef.current && listRef.current.querySelector(".fj-card.now");
    if (el) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [shown]);

  const pick = (forkId, k, at) => {
    const m = new Map(choice);
    for (const key of [...m.keys()]) if (key.startsWith(forkId + ".")) m.delete(key);
    m.set(forkId, k);
    setChoice(m);
    setShown(at + 1); setPlaying(true); setAll(false);
  };
  const replay = () => { setShown(1); setStation(0); setVisited(new Set([0])); setPlaying(true); setAll(false); };
  const visible = all ? path : path.slice(0, shown);
  const navs = [...new Set(path.filter((c) => c.kind === "navigate").map((c) => c.form ? `the ${screenName(c.form)} screen` : "another screen"))];
  const t = J.tally;
  const done = all || shown >= path.length;
  return (
    <div className="fj">
      <div className="fj-hero">
        <div className="fj-kicker">What happens when…</div>
        <h3 className="fj-title">{path[0] ? path[0].title : entry.label}</h3>
        <div className="fj-chips">
          <span className="fj-chip">🏦 {nf(t.services)} request{t.services === 1 ? "" : "s"} to the bank</span>
          <span className="fj-chip">🖥️ {nf(t.changes)} change{t.changes === 1 ? "" : "s"} on screen</span>
          {t.screens.filter((s) => s !== formName).length > 0 && <span className="fj-chip">➜ can open {t.screens.filter((s) => s !== formName).map(screenName).join(", ")}</span>}
          {t.problems > 0 && <span className="fj-chip bad">⚠️ {t.problems} problem{t.problems === 1 ? "" : "s"} found</span>}
        </div>
        <div className="fj-controls">
          <button className="fj-btn main" onClick={() => (done ? replay() : setPlaying((p) => !p))}>{done ? "↺ Play again" : playing ? "❚❚ Pause" : "▶ Play"}</button>
          <button className="fj-btn" onClick={() => { setPlaying(false); setShown((n) => Math.max(1, n - 1)); }} disabled={all}>◀ Back</button>
          <button className="fj-btn" onClick={() => { setPlaying(false); setShown((n) => Math.min(path.length, n + 1)); }} disabled={all}>Next ▶</button>
          <div className="fj-speed">{[0.5, 1, 2].map((s) => <button key={s} className={speed === s ? "on" : ""} onClick={() => setSpeed(s)}>{s}×</button>)}</div>
          <label className="fj-check"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> show every step at once</label>
          <button className="fj-btn ghost" onClick={onDeveloper}>Developer view ⌘</button>
        </div>
      </div>

      <div className="fj-track">
        <div className="fj-line" />
        {STATIONS.map((s, i) => (
          <div key={s.key} className={"fj-st" + (station === i ? " on" : "") + (visited.has(i) ? " seen" : "")} style={{ left: `${(i / (STATIONS.length - 1)) * 100}%` }}>
            <div className="fj-ico">{s.icon}</div>
            <div className="fj-stl">{s.label}</div>
            <div className="fj-sts">{s.sub}</div>
          </div>
        ))}
        <div className="fj-dot" style={{ left: `${(station / (STATIONS.length - 1)) * 100}%` }} />
      </div>

      <div className="fj-list" ref={listRef}>
        {visible.map((c, i) => (
          <Card key={c.id} c={c} now={!all && i === visible.length - 1} index={i} onCode={onCode} pick={pick} choice={choice} />
        ))}
        {done && (
          <div className="fj-end">
            <b>In short:</b> {path[0] ? path[0].title.replace(/^You /, "when you ").replace(/^The /, "when the ").replace(/^Another /, "when another ") : ""}
            {t.services ? `, the app contacts the bank ${t.services === 1 ? "once" : `${t.services} times`}` : ", the app does not contact the bank"}
            {navs.length ? ` and ${navs.length > 1 || path.some((c) => c.kind === "navigate" && c.sometimes) ? "can take you to " : "takes you to "}${navs.length > 1 ? navs.slice(0, -1).join(", ") + " or " + navs[navs.length - 1] : navs[0]}` : ""}
            {t.problems ? ` — ${t.problems} step${t.problems === 1 ? " needs" : "s need"} checking` : ""}.
            {path.some((c) => c.kind === "branch") && <div className="fj-endnote">This is one path through the flow. Use the green / red choices above to see what happens in the other cases.</div>}
          </div>
        )}
      </div>
    </div>
  );
}

function Card({ c, now, index, onCode, pick, choice }) {
  const [more, setMore] = useState(false);
  const st = STATIONS[c.station] || STATIONS[0];
  if (c.kind === "branch") {
    const def = Math.max(0, c.branches.findIndex((b) => b.tone === "good"));
    const k = choice.has(c.id) ? choice.get(c.id) : def;
    if (c.branches.length === 1) {
      const b = c.branches[0];
      return <div className={`fj-then ${b.tone}${now ? " now" : ""}`} title={b.name}>{b.tone === "good" ? "✓" : b.tone === "bad" ? "✕" : "↓"} {b.label}:</div>;
    }
    return (
      <div className={"fj-fork" + (now ? " now" : "")}>
        <div className="fj-forkq">Then it depends on the answer:</div>
        <div className="fj-forkbtns">
          {c.branches.map((b, j) => (
            <button key={j} className={`fj-path ${b.tone}${j === k ? " on" : ""}`} onClick={() => pick(c.id, j, index)} title={b.name}>
              {b.tone === "good" ? "✓ " : b.tone === "bad" ? "✕ " : "• "}{b.label}
            </button>
          ))}
        </div>
      </div>
    );
  }
  const items = c.items || [];
  return (
    <div className={`fj-card k-${c.kind} s${c.station}${now ? " now" : ""}`}>
      <div className="fj-bubble">{KIND_ICON[c.kind] || st.icon}</div>
      <div className="fj-body">
        <div className="fj-where">{st.label}{c.kind === "screen" && c.form ? ` · ${screenName(c.form)} screen` : ""}</div>
        {c.kind === "screen" ? (
          <>
            <div className="fj-text">The screen changes:</div>
            <ul className="fj-items">
              {(more ? items : items.slice(0, 4)).map((x, j) => (
                <li key={j}>{x.verb} {x.what}{x.sometimes && <span className="fj-some" title={x.cond}> · only in some cases</span>}
                  <button className="fj-codelink" onClick={() => onCode(x.code)}>code</button></li>
              ))}
            </ul>
            {items.length > 4 && <button className="fj-more" onClick={() => setMore((v) => !v)}>{more ? "Show fewer" : `and ${items.length - 4} more change${items.length - 4 === 1 ? "" : "s"}`}</button>}
          </>
        ) : (
          <>
            <div className="fj-text">{c.title}{c.sometimes && <span className="fj-some"> · only in some cases</span>}</div>
            {c.kind === "problem" && <div className="fj-sub">{c.sub}</div>}
          </>
        )}
        {c.code && <button className="fj-codelink lone" onClick={() => onCode(c.code)}>show the code</button>}
      </div>
    </div>
  );
}
