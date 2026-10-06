import { useState } from "react";
import { ROLES, SLOTS, DEFAULT_NAMES, validate, clean } from "../lib/names";

// editor used on the upload screens (live) and in the top-bar panel (apply / cancel)
export function VersionNames({ ws, value, onChange, compact }) {
  const err = validate(value);
  const set = (i, field, v) => onChange(value.map((x, k) => (k === i ? { ...x, [field]: v } : x)));
  const isDefault = JSON.stringify(value) === JSON.stringify(DEFAULT_NAMES[ws]);
  return (
    <div className={"vnames" + (compact ? " compact" : "")}>
      <div className="vnhead">
        <b>Version names</b>
        <span className="tag">Shown everywhere in this workspace — rename to match your project.</span>
        {!isDefault && <button type="button" className="btn ghost tiny" onClick={() => onChange(DEFAULT_NAMES[ws])}>Reset to {DEFAULT_NAMES[ws].map((x) => x.name).join(" · ")}</button>}
      </div>
      <div className="vngrid" style={{ gridTemplateColumns: `repeat(${value.length}, minmax(0, 1fr))` }}>
        {SLOTS[ws].map((role, i) => (
          <div key={role} className="vnslot">
            <label htmlFor={`vn-${ws}-${i}`}>{ROLES[role].label}</label>
            <input id={`vn-${ws}-${i}`} type="text" value={value[i].name} maxLength={24} placeholder="Name" onChange={(e) => set(i, "name", e.target.value)} />
            <input id={`vn-${ws}-${i}-sub`} type="text" value={value[i].sub} maxLength={60} placeholder="Short description (optional)" onChange={(e) => set(i, "sub", e.target.value)} />
            <span className="tag">{ROLES[role].hint}</span>
          </div>
        ))}
      </div>
      {err && <div className="vnerr">{err}</div>}
    </div>
  );
}

// top-bar panel: edit a copy, apply when valid
export function VersionNamesPanel({ ws, value, onApply, onClose }) {
  const [draft, setDraft] = useState(value);
  const err = validate(draft);
  return (
    <div className="vnpanel" role="dialog" aria-label="Version names">
      <VersionNames ws={ws} value={draft} onChange={setDraft} compact />
      <div className="vnactions">
        <span className="tag">Applying re-runs this workspace's comparisons with the new names; uploaded folders stay loaded.</span>
        <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
        <button type="button" className="btn" disabled={!!err} onClick={() => { onApply(clean(draft)); onClose(); }}>Apply names</button>
      </div>
    </div>
  );
}
