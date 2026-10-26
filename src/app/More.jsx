// Long lists draw their first rows and add more when the end scrolls into view, instead of every row at once.
import { useState, useEffect, useRef } from "react";

export function useMore(list, step = 120) {
  const [n, setN] = useState(step);
  const shown = list.length > n ? list.slice(0, n) : list;
  return { shown, total: list.length, more: list.length > n ? () => setN((x) => x + step * 2) : null };
}

// the last row of a table (cols: its column count) or, without cols, a block under a list
export function MoreRows({ more, shown, total, cols }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!more || !ref.current || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) more(); }, { rootMargin: "400px" });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [more, shown]);
  if (!more) return null;
  const body = (
    <div ref={ref} className="more-rows">
      Showing {shown.toLocaleString()} of {total.toLocaleString()} — <button type="button" className="linkbtn" onClick={more}>show more</button>
    </div>
  );
  return cols ? <tr className="more-tr"><td colSpan={cols}>{body}</td></tr> : body;
}
