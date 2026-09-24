import { twoColRows, threeColRows } from "../lib/analyzer";

function split(s) {
  return s ? s.split("\n") : [];
}

export function TwoCol({ aBody, bBody, la, lb }) {
  if (aBody == null && bBody == null) return <p className="note">Not present in either version.</p>;
  const rows = twoColRows(split(aBody), split(bBody));
  let nl = 0, nr = 0;
  return (
    <div className="diffwrap">
      <table className="dtable">
        <thead><tr><th colSpan={2}>{la}</th><th colSpan={2}>{lb}</th></tr></thead>
        <tbody>
          {rows.map((r, i) => {
            const a = r.left.t !== "" ? ++nl : "";
            const b = r.right.t !== "" ? ++nr : "";
            return (
              <tr key={i}>
                <td className="ln">{a}</td>
                <td className={"code c-" + r.left.c}>{r.left.t}</td>
                <td className="ln">{b}</td>
                <td className={"code c-" + r.right.c}>{r.right.t}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function ThreeCol({ base, custom, next, lo, lc, ln }) {
  const rows = threeColRows(split(base), split(custom), split(next));
  let n1 = 0, n2 = 0, n3 = 0;
  return (
    <div className="diffwrap">
      <table className="dtable">
        <thead><tr><th colSpan={2}>{lo} (base)</th><th colSpan={2}>{lc}</th><th colSpan={2}>{ln}</th></tr></thead>
        <tbody>
          {rows.map((r, i) => {
            const a = r.r21.t !== "" ? ++n1 : "";
            const b = r.kbz.t !== "" ? ++n2 : "";
            const c = r.r26.t !== "" ? ++n3 : "";
            return (
              <tr key={i}>
                <td className="ln">{a}</td><td className={"code c-" + r.r21.c}>{r.r21.t}</td>
                <td className="ln">{b}</td><td className={"code c-" + r.kbz.c}>{r.kbz.t}</td>
                <td className="ln">{c}</td><td className={"code c-" + r.r26.c}>{r.r26.t}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
