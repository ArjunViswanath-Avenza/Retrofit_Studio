import { useState } from "react";
import "./App.css";
import { extract, buildModel } from "./lib/analyzer";
import { TwoCol, ThreeCol } from "./components/DiffView";
import { Checklist } from "./components/Checklist";

const DEFAULT_LABELS = ["R21", "KBZ", "R26"];

export default function App() {
  const [slots, setSlots] = useState([
    { label: "R21", name: "", src: "" },
    { label: "KBZ", name: "", src: "" },
    { label: "R26", name: "", src: "" },
  ]);
  const [model, setModel] = useState(null);
  const [tab, setTab] = useState("overview");
  const [member, setMember] = useState(null);
  const [view, setView] = useState("OLD_CUST");
  const [err, setErr] = useState("");

  const onFile = (i, file) => {
    if (!file) return;
    const r = new FileReader();
    r.onload = () => {
      setSlots((s) => {
        const c = [...s];
        const m = file.name.match(/_([A-Za-z0-9]+)\.js$/);
        c[i] = { label: m ? m[1] : c[i].label || DEFAULT_LABELS[i], name: file.name, src: r.result };
        return c;
      });
    };
    r.readAsText(file);
  };

  const setLabel = (i, v) => setSlots((s) => { const c = [...s]; c[i] = { ...c[i], label: v }; return c; });

  const canAnalyze = slots[0].src && slots[1].src;

  const analyze = () => {
    setErr("");
    try {
      const files = slots
        .filter((s) => s.src)
        .map((s) => ({ label: s.label.trim() || "?", name: s.name, src: s.src, parsed: extract(s.src) }));
      const m = buildModel(files);
      setModel(m);
      setMember(m.genuine[0] || null);
      setView("OLD_CUST");
      setTab("overview");
    } catch (e) {
      setErr(String(e.message || e));
    }
  };

  const reset = () => { setModel(null); setErr(""); };

  return (
    <div className="app">
      <header>
        <h1>Retrofit Studio</h1>
        <span className="meta">{model ? model.names.join("  •  ") : "Format + compare Kony/Temenos controllers"}</span>
        <span className="spacer" />
        {model && <button className="btn ghost" onClick={reset}>New comparison</button>}
      </header>
      <main>
        {!model ? (
          <Uploader slots={slots} onFile={onFile} setLabel={setLabel} canAnalyze={canAnalyze} analyze={analyze} err={err} />
        ) : (
          <Report model={model} tab={tab} setTab={setTab} member={member} setMember={setMember} view={view} setView={setView} />
        )}
      </main>
    </div>
  );
}

function Uploader({ slots, onFile, setLabel, canAnalyze, analyze, err }) {
  const titles = ["Base (old) — required", "Custom — required", "New base — optional"];
  return (
    <div className="uploader">
      <div className="rules">
        Upload 2–3 controller versions. Each file is <b>formatted</b> (K&amp;R braces, <code>key: value</code>, no line
        wrapping) and then <b>compared</b> — so only real code changes show. Everything runs in your browser.
      </div>
      <div className="grid">
        {slots.map((s, i) => (
          <div key={i} className={"slot" + (s.src ? " filled" : "")}>
            <h3>{titles[i]}</h3>
            <input type="text" value={s.label} onChange={(e) => setLabel(i, e.target.value)} placeholder="label" />
            <div className="fname">{s.name}</div>
            <input type="file" accept=".js" onChange={(e) => onFile(i, e.target.files[0])} />
          </div>
        ))}
      </div>
      <div style={{ marginTop: 14 }}>
        <button className="btn" disabled={!canAnalyze} onClick={analyze}>Format &amp; Compare</button>
        {err && <div style={{ color: "#e0533d", marginTop: 8 }}>{err}</div>}
      </div>
    </div>
  );
}

function Report({ model, tab, setTab, member, setMember, view, setView }) {
  const [O, C, N] = model.labels;
  const bc = {};
  Object.values(model.members).forEach((x) => { if (x.bucket) bc[x.bucket] = (bc[x.bucket] || 0) + 1; });
  const tabs = [["overview", "Overview"], ["genuine", `Genuine Changes (${C}→${O})`]];
  if (model.hasNew) tabs.push(["threeway", "3-Way + Buckets"], ["checklist", "Retrofit Checklist"], ["widgets", "Widget Remap"]);

  const gotoMember = (name) => { setMember(name); setTab("genuine"); };

  return (
    <div>
      <div className="cards">
        {model.labels.map((l) => (
          <div className="card" key={l}><div className="n">{model.counts[l]}</div><div className="l">{l} members</div></div>
        ))}
        <div className="card"><div className="n">{model.genuine.length}</div><div className="l">{C} vs {O} changes</div></div>
        {model.hasNew && (
          <div className="card"><div className="n">{[1, 2, 3, 4, 5].map((k) => bc[k] || 0).join("/")}</div><div className="l">buckets 1·2·3·4·5</div></div>
        )}
      </div>

      <div className="tabs">
        {tabs.map(([k, t]) => (
          <div key={k} className={"tab" + (k === tab ? " active" : "")} onClick={() => setTab(k)}>{t}</div>
        ))}
      </div>

      <div className="view">
        {tab === "overview" && <Overview model={model} O={O} C={C} N={N} />}
        {tab === "genuine" && (
          <Genuine model={model} O={O} C={C} N={N} member={member} setMember={setMember} view={view} setView={setView} />
        )}
        {tab === "threeway" && <ThreeWay model={model} O={O} C={C} N={N} gotoMember={gotoMember} />}
        {tab === "checklist" && <Checklist model={model} />}
        {tab === "widgets" && <Widgets model={model} />}
      </div>
    </div>
  );
}

function Overview({ model, O, C, N }) {
  return (
    <div>
      <p className="note">
        <b>{O}</b> = old base (common ancestor) · <b>{C}</b> = customisation on {O} · <b>{N || "—"}</b> = new base / upgrade target.
        Each <b>{C}</b> change must be re-expressed on <b>{N || "the new base"}</b>.
      </p>
      <table>
        <thead><tr><th>Module signature</th>{model.labels.map((l) => <th key={l}>{l}</th>)}</tr></thead>
        <tbody><tr><td>define()</td>{model.labels.map((l) => <td key={l} className="mono">{model.moduleNames[l] ? `"${model.moduleNames[l]}"` : "(anonymous)"}</td>)}</tr></tbody>
      </table>
      {model.hasNew && (
        <>
          <h3>Customisations to retrofit onto {N}</h3>
          <table>
            <thead><tr><th>Member</th><th>Change</th><th>Bucket</th><th>Deterministic note</th></tr></thead>
            <tbody>
              {model.genuine.map((n) => {
                const x = model.members[n];
                return <tr key={n}><td><b>{n}</b></td><td><span className={"pill " + x.change}>{x.change}</span></td>
                  <td className={"b" + (x.bucket || "q")}>{x.bucket ? "Bucket " + x.bucket : ""}</td><td>{x.note}</td></tr>;
              })}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

function Genuine({ model, O, C, N, member, setMember, view, setView }) {
  if (!model.genuine.length) return <p>No changes detected.</p>;
  const cur = member && model.genuine.includes(member) ? member : model.genuine[0];
  const x = model.members[cur];
  const views = [["OLD_CUST", `${O} vs ${C}`]];
  if (model.hasNew) views.push(["OLD_NEW", `${O} vs ${N}`], ["CUST_NEW", `${C} vs ${N}`], ["ALL3", "All 3"]);
  const pairMap = { OLD_CUST: [O, C], OLD_NEW: [O, N], CUST_NEW: [C, N] };
  const activeView = model.hasNew ? view : "OLD_CUST";

  return (
    <div className="split">
      <div className="memberlist">
        {model.genuine.map((n) => {
          const m = model.members[n];
          return (
            <div key={n} className={"memrow" + (n === cur ? " sel" : "")} onClick={() => setMember(n)}>
              <b>{n}</b> <span className={"pill " + (m.change || "")}>{m.change}</span>{" "}
              {m.bucket && <span className={"pill b" + m.bucket}>B{m.bucket}</span>}
              <div className="tag">{m.kind}{model.hasNew ? ` · in ${N}: ${m.inNew || ""}` : ""}</div>
            </div>
          );
        })}
      </div>
      <div>
        <h3 style={{ margin: "0 0 4px" }}>{cur}</h3>
        <div className="tag">kind: {x.kind} · change: {x.change || "—"} {x.bucket ? "· bucket " + x.bucket : ""}</div>
        {x.note && <div className="note">{x.note}</div>}
        <div className="seg">
          {views.map(([k, t]) => <button key={k} className={k === activeView ? "on" : ""} onClick={() => setView(k)}>{t}</button>)}
        </div>
        {activeView === "ALL3" ? (
          <>
            <div className="legend">
              <span style={{ background: "var(--add-bg)" }}>green = added vs {O}</span>{" "}
              <span style={{ background: "var(--del-bg)" }}>red = missing vs {O}</span>{" "}
              <span style={{ background: "var(--chg-bg)" }}>amber = {O} line changed in a branch</span>
            </div>
            <ThreeCol base={x.bodies[O]} custom={x.bodies[C]} next={x.bodies[N]} lo={O} lc={C} ln={N} />
          </>
        ) : (
          (() => {
            const [la, lb] = pairMap[activeView];
            return (
              <>
                <div className="legend">
                  <span style={{ background: "var(--del-bg)" }}>red = only in {la}</span>{" "}
                  <span style={{ background: "var(--add-bg)" }}>green = only in {lb}</span>
                </div>
                <TwoCol aBody={x.bodies[la]} bBody={x.bodies[lb]} la={la} lb={lb} />
              </>
            );
          })()
        )}
      </div>
    </div>
  );
}

function ThreeWay({ model, O, C, N, gotoMember }) {
  const rows = Object.keys(model.members).filter((n) => model.members[n].note);
  return (
    <div>
      <p className="note">Members with a {C} delta vs {O}. Click a row to inspect the diff.</p>
      <table>
        <thead><tr><th>#</th><th>Member</th><th>{O}</th><th>{C}</th><th>{N}</th><th>Bucket</th><th>Note</th></tr></thead>
        <tbody>
          {rows.map((n, i) => {
            const x = model.members[n];
            const mk = (l) => (x.present[l] ? "Y" : "–");
            return (
              <tr key={n} style={{ cursor: "pointer" }} onClick={() => gotoMember(n)}>
                <td>{i + 1}</td><td><b>{n}</b></td>
                <td style={{ textAlign: "center" }}>{mk(O)}</td><td style={{ textAlign: "center" }}>{mk(C)}</td><td style={{ textAlign: "center" }}>{mk(N)}</td>
                <td className={"b" + (x.bucket || "q")} style={{ textAlign: "center" }}>{x.bucket}</td><td>{x.note}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Widgets({ model }) {
  const w = model.widgets.filter((x) => x.remap);
  return (
    <div>
      <p className="note">
        Widgets whose presence differs across versions — a likely field/index remap or added/removed widget.
        A <span style={{ background: "var(--del-bg)", padding: "0 6px" }}>0</span> means the widget is absent in that version (form-layer work needed).
      </p>
      <table>
        <thead><tr><th>Widget token</th>{model.labels.map((l) => <th key={l}>{l}</th>)}</tr></thead>
        <tbody>
          {w.map((x) => (
            <tr key={x.token}>
              <td className="mono">{x.token}</td>
              {model.labels.map((l) => (
                <td key={l} style={{ textAlign: "center", background: x.counts[l] === 0 ? "var(--del-bg)" : undefined }}>{x.counts[l]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="tag">{w.length} of {model.widgets.length} widget tokens differ across versions.</p>
    </div>
  );
}
