// One queue for the heavy work. What the open page is waiting for runs in the foreground; background scans (where each
// template is used, files for side by side) pause while any foreground step runs, and stop when their tool starts over.
import { track } from "./perf.js";

let active = 0;
let waiters = [];

export async function foreground(label, fn) {
  active++;
  try {
    return await track(label, fn);
  } finally {
    active--;
    if (!active) { const w = waiters; waiters = []; w.forEach((r) => r()); }
  }
}

// fn(signal): call bgTurn(signal) between batches
export function background(label, fn) {
  const ctl = new AbortController();
  const promise = track(`${label} · background`, () => fn(ctl.signal));
  promise.catch(() => { /* stopped or failed: shown in the timings panel */ });
  return { promise, cancel: () => ctl.abort() };
}

// give the page a turn (input, drawing) between batches. A message, not setTimeout: timers are slowed to one a second
// while the tab is in the background, which made long scans crawl whenever another tab was open
const chan = typeof MessageChannel !== "undefined" ? new MessageChannel() : null;
const turns = [];
if (chan) chan.port1.onmessage = () => { const r = turns.shift(); if (r) r(); };
if (chan && chan.port1.unref) chan.port1.unref(); // Node scripts that use the analysis libs can still exit
export const yieldNow = () => new Promise((r) => { if (chan) { turns.push(r); chan.port2.postMessage(0); } else setTimeout(r); });

// fn(i) for every i below n, conc at a time — their file reads go out together (one batch to the local file service,
// or parallel reads of picked files) instead of one after another
export async function pool(n, conc, fn) {
  let next = 0;
  const worker = async () => { while (next < n) { const i = next++; await fn(i); } };
  await Promise.all(Array.from({ length: Math.min(conc, n) }, worker));
}

const stopped = () => new DOMException("stopped", "AbortError");

// let the page breathe, wait while foreground work runs, and stop when cancelled
export async function bgTurn(signal) {
  if (signal && signal.aborted) throw stopped();
  while (active) await new Promise((r) => waiters.push(r));
  await yieldNow();
  if (signal && signal.aborted) throw stopped();
}

export const isStopped = (e) => e && e.name === "AbortError";
