import { useState } from "react";

export function Checklist({ model }) {
  const ctrl = model.names[1] || "controller";
  const NEW = model.hasNew ? model.labels[2] : "";
  const keyOf = (n) => `retrofit::${ctrl}::${n}`;
  const get = (n) => { try { return JSON.parse(localStorage.getItem(keyOf(n))) || {}; } catch { return {}; } };
  const [, force] = useState(0);
  const set = (n, field, val) => {
    const s = get(n); s[field] = val;
    try { localStorage.setItem(keyOf(n), JSON.stringify(s)); } catch { /* ignore */ }
    force((x) => x + 1);
  };

  const sel = (n, field, opts) => {
    const st = get(n);
    return (
      <select value={st[field] || ""} onChange={(e) => set(n, field, e.target.value)}>
        {opts.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  };

  const exportFile = (fmt) => {
    const rows = model.genuine.map((n) => {
      const x = model.members[n], st = get(n);
      return {
        member: n, change: x.change, bucket: x.bucket, in_new: x.inNew,
        action: st.action || "", remap: st.remap || "", layers: st.layers || "",
        risk: st.risk || "", status: st.status || "TODO", validated: !!st.validated,
        notes: st.notes || "", note_auto: x.note || "",
      };
    });
    let blob, name;
    if (fmt === "json") {
      blob = new Blob([JSON.stringify({ controller: ctrl, rows }, null, 2)], { type: "application/json" });
      name = ctrl + "_retrofit.json";
    } else {
      const cols = Object.keys(rows[0] || { member: 1 });
      const csv = [cols.join(",")].concat(rows.map((r) => cols.map((c) => `"${String(r[c]).replace(/"/g, '""')}"`).join(","))).join("\n");
      blob = new Blob([csv], { type: "text/csv" });
      name = ctrl + "_retrofit.csv";
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name; a.click();
  };

  return (
    <div>
      <div className="toolbar">
        <button className="btn" onClick={() => exportFile("json")}>Export JSON</button>
        <button className="btn" onClick={() => exportFile("csv")}>Export CSV</button>
        <span className="tag">Edits auto-save in this browser, keyed per controller + member.</span>
      </div>
      <table>
        <thead>
          <tr><th>#</th><th>Member</th><th>Bucket</th><th>Action</th><th>Field re-map</th>
            <th>Other layers</th><th>Risk</th><th>Status</th><th>Valid.</th><th>Notes / logic</th></tr>
        </thead>
        <tbody>
          {model.genuine.map((n, i) => {
            const x = model.members[n], st = get(n);
            return (
              <tr key={n}>
                <td>{i + 1}</td>
                <td><b>{n}</b><div className="tag">{x.change}{NEW ? ` · in ${NEW}: ${x.inNew || ""}` : ""}</div></td>
                <td className={"b" + (x.bucket || "q")} style={{ textAlign: "center" }}>{x.bucket}</td>
                <td>{sel(n, "action", ["", "Re-apply", "Reconcile", "Adopt new", "Port new", "Drop", "Already in new"])}</td>
                <td>{sel(n, "remap", ["", "None", "Field/param remap", "Signature change"])}</td>
                <td><input style={{ width: "100%" }} value={st.layers || ""} placeholder="form/.sm, presenter…" onChange={(e) => set(n, "layers", e.target.value)} /></td>
                <td>{sel(n, "risk", ["", "Low", "Med", "High"])}</td>
                <td>{sel(n, "status", ["TODO", "In progress", "Done", "Skipped"])}</td>
                <td style={{ textAlign: "center" }}><input type="checkbox" checked={!!st.validated} onChange={(e) => set(n, "validated", e.target.checked)} /></td>
                <td><textarea value={st.notes || ""} placeholder="logic / decision" onChange={(e) => set(n, "notes", e.target.value)} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
