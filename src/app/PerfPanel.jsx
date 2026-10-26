// ⏱ Timings: how long each heavy step took and how much it read.
import { useSyncExternalStore } from "react";
import { perfSubscribe, perfVersion, perfRuns, perfTotals, clearRuns } from "../lib/perf";

const fmtMs = (ms) => (ms < 1000 ? `${Math.round(ms)} ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.floor(ms / 60000)} min ${Math.round((ms % 60000) / 1000)} s`);
const fmtMb = (b) => (b < 1e6 ? `${Math.round(b / 1e3)} KB` : `${(b / 1e6).toFixed(1)} MB`);

// how many steps are running — the top bar redraws only when this number changes
const busyCount = () => perfRuns().filter((r) => r.running).length;
export function usePerfBusy() {
  return useSyncExternalStore(perfSubscribe, busyCount);
}

export function PerfPanel({ onClose }) {
  useSyncExternalStore(perfSubscribe, perfVersion);
  const runs = perfRuns(), tot = perfTotals();
  const mem = typeof performance !== "undefined" && performance.memory ? performance.memory.usedJSHeapSize : null;
  return (
    <div className="perf" role="dialog" aria-label="Timings">
      <div className="perf-h">
        <b>⏱ Timings</b>
        <span className="tag">{tot.reads.toLocaleString()} file reads · {fmtMb(tot.bytes)} read{mem ? ` · ${fmtMb(mem)} memory in use` : ""}</span>
        <span className="spacer" />
        <button className="btn ghost tiny" onClick={clearRuns}>Clear</button>
        <button className="btn ghost tiny" onClick={onClose}>Close</button>
      </div>
      {!runs.length ? <p className="tag" style={{ padding: "8px 2px" }}>Nothing measured yet — load folders and open a comparison.</p> : (
        <table className="perf-t">
          <thead><tr><th>Step</th><th>Time</th><th>Files read</th><th>Read</th></tr></thead>
          <tbody>
            {runs.map((r, i) => (
              <tr key={i} className={r.running ? "run" : r.error ? "err" : ""}>
                <td>{r.label}{r.error && <span className="tag"> · {r.error}</span>}<div className="tag">{r.at.toLocaleTimeString()}</div></td>
                <td>{r.running ? <span className="perf-live">{fmtMs(r.ms)}…</span> : fmtMs(r.ms)}</td>
                <td>{r.reads ? r.reads.toLocaleString() : "—"}</td>
                <td>{r.bytes ? fmtMb(r.bytes) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="tag" style={{ marginTop: 6 }}>Steps that overlap share the counts of files read. Background steps pause while the open page is working.</p>
    </div>
  );
}
