// A traced flow told as a short story for non-technical readers: what the person does, what the screen does,
// when the bank's systems are asked something, what happens when they answer, and where the person ends up.
// Helper calls, storage, logging and layout tweaks are left out; every card keeps its code location for "show code".

export const STATIONS = [
  { key: "form", icon: "🖥️", label: "Screen", sub: "what you see" },
  { key: "controller", icon: "⚙️", label: "Screen logic", sub: "reacts to you" },
  { key: "presentation", icon: "🧭", label: "App logic", sub: "decides what's next" },
  { key: "business", icon: "📋", label: "Business rules", sub: "prepares the request" },
  { key: "model", icon: "🏦", label: "Bank systems", sub: "the server" },
];
const ST = Object.fromEntries(STATIONS.map((s, i) => [s.key, i]));

const ACRONYM = /^(CIF|OTP|MFA|ID|PIN|CVV|ATM|NRC|SSN|URL|PDF|KYC|P2P|API|QR|SMS|IBAN|SWIFT|ACH|TNC|KBZ|UI)$/i;
const PREFIX = /^(frm|lbl|btn|flx|tbx|txt|img|rtx|seg|lst|lbx|cal|sw|chk|rb|tab|brw|uw|cmp)(?=[A-Z0-9_])/;
// "getCustomerAccountListMultiCIF" -> "Get customer account list multi CIF"
export function words(id, lowerFirst) {
  const s = String(id || "").replace(PREFIX, "").replace(/[_-]+/g, " ");
  const parts = s.match(/P2P|[A-Z]{2,}(?![a-z])|[A-Z]?[a-z]+|\d+|[A-Z]/g) || [];
  return parts.map((w, i) => (ACRONYM.test(w) ? w.toUpperCase() : i === 0 && !lowerFirst ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase())).join(" ");
}
export const screenName = (form) => (form ? words(form) : "another");

const NOUN = { Button: "button", Label: "text", RichText: "message", TextField: "field", TextArea: "text box", Image: "image", Segment: "list", ListBox: "dropdown", FlexContainer: "section", FlexScrollContainer: "section", UserWidgetInstance: "panel", CheckBoxGroup: "checkbox", RadioButtonGroup: "choice", Switch: "switch", Calendar: "date picker", Slider: "slider", Browser: "web view" };
// "the “Sign In” button" — the widget's own text when it is short, otherwise its name in words
export function widgetPhrase(path, info) {
  const i = info && info.get(path);
  const id = String(path || "").split(".").pop();
  const noun = (i && NOUN[i.type]) || "item";
  const t = i && i.text && String(i.text).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const name = t && t.length <= 32 ? t : words(id) || id;
  return `the “${name}” ${noun}`;
}
const cap = (s) => s[0].toUpperCase() + s.slice(1);

const EVENT = {
  onClick: "click", onTouchEnd: "tap", onTouchStart: "touch", onRowClick: "pick a row in", onTextChange: "type in", onKeyUp: "type in",
  onSelection: "choose from", onDone: "finish typing in", onEndEditing: "leave", onBeginEditing: "start typing in", onSlide: "slide", onScrollEnd: "scroll",
};
const LIFE = { preShow: "The screen is about to appear", postShow: "The screen has just appeared", init: "The screen is being created", onNavigate: "You arrive at this screen", onBreakpointChange: "The window changes size", onDeviceBack: "You press Back", onHide: "The screen is closed", onTouchEnd: "You tap on the screen" };
export function triggerText(entry, info) {
  if (entry.group === "lifecycle") return LIFE[entry.event] || `The screen fires “${words(entry.event, true)}”`;
  if (entry.group === "arrival") return "Another part of the app opens this screen";
  const verb = EVENT[entry.event];
  const w = widgetPhrase(entry.widget, info);
  if (verb) return `You ${verb} ${w}`;
  return `${cap(w)} reports “${words(String(entry.event).replace(/^on/, ""), true)}”`;
}

const VERBS = /^(get|fetch|create|update|delete|verify|validate|send|check|save|submit|login|logout|request|reset|set|add|remove|cancel|download|upload|track|query|search|register|activate|deactivate|enroll|transfer|pay|approve|reject|generate|change|confirm|lock|unlock|block|unblock|retrieve|load|read|post|edit|modify|initiate|resend|link|unlink|accept|apply|open|close|calculate|list|find|issue|renew)$/i;
function serviceText(st) {
  const verb = words(st.verb, true);
  const ask = VERBS.test(verb.split(" ")[0]) ? `to ${verb}` : `for “${verb}”`;
  if (st.svcKind === "identity") return st.verb === "login" ? "Asks the bank to sign you in" : st.verb === "logout" ? "Asks the bank to sign you out" : `Asks the bank's sign-in service ${ask}`;
  const obj = st.obj && st.obj !== "?" ? words(st.obj) : null;
  return `Asks the bank's systems ${ask}${obj ? ` (${obj})` : ""}`;
}
function outcomeLabel(name, i, n) {
  const s = String(name || "");
  if (/success|succeed|done|ok\b|complete/i.test(s)) return { tone: "good", label: "If it works" };
  if (/fail|error|reject|cancel|denied/i.test(s)) return { tone: "bad", label: "If something goes wrong" };
  return { tone: "plain", label: n > 1 ? `Answer ${i + 1}` : "When the answer comes back" };
}
// one screen change in plain words; null = layout / focus / data plumbing that is left out
function changeText(step) {
  const v = String(step.value || "").trim(), a = step.action;
  const lit = /^(true|false)$/.test(v) ? v === "true" : null;
  if (a === "isVisible =" || a === "setVisibility()") return lit === true ? "Shows" : lit === false ? "Hides" : "Shows or hides";
  if (a === "text =") return "Fills in";
  if (a === "skin =") return "Changes the look of";
  if (a === "setData()" || a === "data =") return "Fills";
  if (a === "src =") return "Changes the picture in";
  if (a === "setEnabled()" || a === "enable =") return lit === true ? "Enables" : lit === false ? "Disables" : "Enables or disables";
  if (a === "placeholder =") return "Changes the hint in";
  return null;
}

// walk the trace into cards; branch blocks for answers from the bank and success / failure callbacks
export function buildJourney(T, entry, ctx) {
  const { info, formName } = ctx;
  const seen = new Set();
  let trail = [];
  const root = { cards: [] };
  const push = (list, card) => {
    card.trail = trail.filter((x, i, a) => a.indexOf(x) === i && x !== card.station);
    trail = [];
    const last = list.cards[list.cards.length - 1];
    if (card.kind === "screen" && last && last.kind === "screen" && last.form === card.form) { last.items.push(...card.items); return; }
    if (last && card.kind !== "branch" && card.kind !== "screen" && last.kind === card.kind && last.title === card.title) return;
    list.cards.push(card);
  };
  const where = (n, line) => ({ rel: n.rel, from: n.line, to: n.end, line, title: `${n.clsLabel}.${n.name}` });
  // a fork: keep only branches that show something; a single plain branch is just the next steps
  const fork = (list, station, branches, fill) => {
    const block = { kind: "branch", station, branches };
    push(list, block);
    branches.forEach((b, k) => fill(b, k));
    block.branches = block.branches.filter((b) => b.cards.length);
    const at = list.cards.indexOf(block);
    if (!block.branches.length) list.cards.splice(at, 1);
    else if (block.branches.length === 1 && block.branches[0].tone === "plain") list.cards.splice(at, 1, ...block.branches[0].cards);
  };
  const visit = (n, list, depth, screen) => {
    if (!n || n.cycle || n.cut || n.ref || depth > 60 || seen.has(n.uid)) return;
    seen.add(n.uid);
    trail.push(ST[n.layer] ?? 1);
    const edges = n.edges.filter((e) => e.effect || e.missing);
    for (let i = 0; i < edges.length; i++) {
      const e = edges[i], s = e.step;
      if (e.missing) { push(list, { kind: "problem", station: ST[n.layer] ?? 1, title: "This step points at something that is missing from the project", sub: e.missing, sometimes: s.conds.length > 0, code: where(n, s.line) }); continue; }
      switch (e.kind) {
        case "widget": {
          const verb = changeText(s), path = e.path || s.path;
          if (!verb || !path) break;
          const form = n.viewPrefix ? formName : (/^controller:(?:.*\/)?(\w+?)Controller$/.exec(n.cls) || [])[1] || screen;
          push(list, { kind: "screen", station: 0, form, items: [{ verb, what: widgetPhrase(path, form === formName ? info : null), sometimes: s.conds.length > 0, cond: s.conds[s.conds.length - 1], code: where(n, s.line) }] });
          break;
        }
        case "service": {
          push(list, { kind: "service", station: 4, title: serviceText(s), sometimes: s.conds.length > 0, sub: s.svcKind === "model" ? `${s.obj}.${s.verb}` : `${s.svcKind} · ${s.verb}`, code: where(n, s.line) });
          const rets = (e.returns || []).filter((r) => r.node);
          if (rets.length) fork(list, 4, rets.map((r, k) => ({ ...outcomeLabel(r.label, k, rets.length), name: r.label, cards: [] })), (b, k) => { trail = [4]; visit(rets[k].node, b, depth + 1, screen); });
          break;
        }
        case "param": {
          // the business code handing the answer back: a run of these is a fork (success / failure)
          const group = [e];
          while (edges[i + 1] && edges[i + 1].kind === "param") group.push(edges[++i]);
          const live = group.filter((g) => g.child);
          if (!live.length) break;
          if (live.length === 1 && outcomeLabel(live[0].step.name, 0, 1).tone === "plain") { visit(live[0].child, list, depth + 1, screen); break; }
          fork(list, ST[n.layer] ?? 3, live.map((g, k) => ({ ...outcomeLabel(g.step.name, k, live.length), name: g.step.name, cards: [] })), (b, k) => visit(live[k].child, b, depth + 1, screen));
          break;
        }
        case "nav":
          push(list, { kind: "navigate", station: 0, title: s.form ? `Takes you to the ${screenName(s.form)} screen` : "Takes you to another screen", sometimes: s.conds.length > 0, sub: s.form || s.formExpr, code: where(n, s.line), form: s.form });
          if (s.form) screen = s.form;
          break;
        case "compEvent":
          if (e.child) {
            const ev = words(String(e.event).replace(/^on/, "").replace(/call ?back$/i, ""), true) || words(e.event, true);
            const panel = n.viewPrefix ? widgetPhrase(n.viewPrefix, info) : "the panel";
            push(list, { kind: "event", station: 1, title: `${cap(panel)} reports “${ev}” to the screen`, sub: e.event, code: where(n, s.line) });
            visit(e.child, list, depth + 1, screen);
          }
          break;
        case "updateForm": case "present":
          visit(e.child, list, depth + 1, e.target || screen);
          break;
        default:
          if (e.child) visit(e.child, list, depth + 1, screen);
      }
    }
    // a handler that only calls a function its screen does not have does nothing visible
    if (depth === 0 && list.cards.length <= 1) {
      const dead = n.edges.find((e) => e.kind === "unresolved" && /^this\.\w+\(\)$/.test(e.step.what) && n.layer === "controller");
      if (dead) push(list, { kind: "problem", station: 1, title: `This action calls “${dead.step.what.slice(5, -2)}”, which is not in this screen's code`, sub: "So it probably does nothing — worth checking with the team.", code: where(n, dead.step.line) });
    }
  };
  push(root, { kind: "trigger", station: entry.group === "arrival" ? 2 : 0, title: triggerText(entry, info), sub: entry.label });
  trail = [];
  visit(T.root, root, 0, formName);
  const tally = { services: 0, screens: new Set(), changes: 0, problems: 0 };
  const count = (list) => { for (const c of list.cards) { if (c.kind === "service") tally.services++; if (c.kind === "navigate" && c.form) tally.screens.add(c.form); if (c.kind === "screen") tally.changes += c.items.length; if (c.kind === "problem") tally.problems++; for (const b of c.branches || []) count(b); } };
  count(root);
  return { root, tally: { ...tally, screens: [...tally.screens] } };
}

// the cards along one path through the forks (choice: fork id -> branch index); default = the "If it works" branch
export function pathOf(J, choice) {
  const out = [];
  const walk = (list, prefix) => {
    list.cards.forEach((c, i) => {
      const id = `${prefix}${i}`;
      out.push({ ...c, id });
      if (c.kind === "branch") {
        const def = Math.max(0, c.branches.findIndex((b) => b.tone === "good"));
        const k = choice.has(id) ? choice.get(id) : def;
        const b = c.branches[k];
        if (b) walk(b, `${id}.${k}.`);
      }
    });
  };
  walk(J.root, "");
  return out;
}
