// Java .class reader + disassembler for the JAR comparison — runs in the browser, no Java needed.
// Output is deliberately free of compile noise: constant-pool indexes are resolved to their values, branch targets
// become labels (L1, L2 … in order), and debug attributes (line numbers, local variable names) are left out — so two
// builds of the same code compare equal and a real change shows only where it happened.
import { unzipSync } from "fflate";

// ---------------------------------------------------------------- jar
export async function readJar(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  return unzipSync(buf); // { "path/in/jar": Uint8Array }
}

// jar file name -> library name without version ("dom4j-2.1.3.jar" -> "dom4j", "AdminConsoleServices.jar" -> itself)
export const jarBase = (name) => name.replace(/\.jar$/i, "").replace(/-\d[\w.]*$/, "");
export const jarVersion = (name) => { const m = name.replace(/\.jar$/i, "").match(/-(\d[\w.]*)$/); return m ? m[1] : ""; };

// ---------------------------------------------------------------- class file
function utf8(bytes, s, n) { // modified UTF-8 (good enough for identifiers / string constants)
  let out = "";
  for (let i = s; i < s + n;) {
    const a = bytes[i++];
    if (a < 0x80) out += String.fromCharCode(a);
    else if ((a & 0xe0) === 0xc0) out += String.fromCharCode(((a & 0x1f) << 6) | (bytes[i++] & 0x3f));
    else { const b = bytes[i++], c = bytes[i++]; out += String.fromCharCode(((a & 0x0f) << 12) | ((b & 0x3f) << 6) | (c & 0x3f)); }
  }
  return out;
}

export function parseClass(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = 0;
  const u1 = () => bytes[p++], u2 = () => { const v = dv.getUint16(p); p += 2; return v; }, u4 = () => { const v = dv.getUint32(p); p += 4; return v; };
  if (u4() !== 0xcafebabe) throw new Error("not a class file");
  const minor = u2(), major = u2();
  const n = u2();
  const cp = new Array(n);
  for (let i = 1; i < n; i++) {
    const tag = u1();
    switch (tag) {
      case 1: { const len = u2(); cp[i] = { tag, v: utf8(bytes, p, len) }; p += len; break; }
      case 3: cp[i] = { tag, v: dv.getInt32(p) }; p += 4; break;
      case 4: cp[i] = { tag, v: dv.getFloat32(p) }; p += 4; break;
      case 5: cp[i] = { tag, v: dv.getBigInt64(p) }; p += 8; i++; break;
      case 6: cp[i] = { tag, v: dv.getFloat64(p) }; p += 8; i++; break;
      case 7: case 8: case 16: case 19: case 20: cp[i] = { tag, a: u2() }; break;
      case 9: case 10: case 11: case 12: case 17: case 18: cp[i] = { tag, a: u2(), b: u2() }; break;
      case 15: cp[i] = { tag, a: u1(), b: u2() }; break;
      default: throw new Error(`bad constant tag ${tag}`);
    }
  }
  const str = (i) => (cp[i] && cp[i].tag === 1 ? cp[i].v : "");
  const cls = (i) => (cp[i] ? str(cp[i].a) : "");
  const nat = (i) => (cp[i] ? `${str(cp[i].a)}:${str(cp[i].b)}` : "");
  const show = (i) => { // a constant as readable text
    const c = cp[i];
    if (!c) return `#${i}`;
    switch (c.tag) {
      case 1: return JSON.stringify(c.v);
      case 3: case 4: case 6: return String(c.v);
      case 5: return `${c.v}L`;
      case 7: return str(c.a);
      case 8: return JSON.stringify(str(c.a));
      case 9: case 10: case 11: return `${cls(c.a)}.${nat(c.b)}`;
      case 12: return nat(i);
      case 15: return `MethodHandle(${c.a}, ${show(c.b)})`;
      case 16: return `MethodType ${str(c.a)}`;
      case 17: case 18: return `dynamic ${nat(c.b)}`;
      default: return `#${i}`;
    }
  };
  const access = u2(), thisClass = cls(u2()), superIdx = u2();
  const superClass = superIdx ? cls(superIdx) : "";
  const interfaces = Array.from({ length: u2() }, () => cls(u2()));
  const readAttrs = () => {
    const out = [];
    for (let k = u2(); k > 0; k--) { const name = str(u2()), len = u4(); out.push({ name, start: p, len }); p += len; }
    return out;
  };
  const members = () => Array.from({ length: u2() }, () => {
    const acc = u2(), name = str(u2()), desc = str(u2());
    return { access: acc, name, desc, attrs: readAttrs() };
  });
  const fields = members(), methods = members();
  const classAttrs = readAttrs();
  return { version: `${major}.${minor}`, access, name: thisClass, superClass, interfaces, fields, methods, classAttrs, bytes, dv, cp, str, cls, show };
}

// ---------------------------------------------------------------- disassembly
const OPS = ("nop aconst_null iconst_m1 iconst_0 iconst_1 iconst_2 iconst_3 iconst_4 iconst_5 lconst_0 lconst_1 fconst_0 fconst_1 fconst_2 dconst_0 dconst_1 " +
  "bipush sipush ldc ldc_w ldc2_w iload lload fload dload aload iload_0 iload_1 iload_2 iload_3 lload_0 lload_1 lload_2 lload_3 fload_0 fload_1 fload_2 fload_3 " +
  "dload_0 dload_1 dload_2 dload_3 aload_0 aload_1 aload_2 aload_3 iaload laload faload daload aaload baload caload saload istore lstore fstore dstore astore " +
  "istore_0 istore_1 istore_2 istore_3 lstore_0 lstore_1 lstore_2 lstore_3 fstore_0 fstore_1 fstore_2 fstore_3 dstore_0 dstore_1 dstore_2 dstore_3 astore_0 astore_1 astore_2 astore_3 " +
  "iastore lastore fastore dastore aastore bastore castore sastore pop pop2 dup dup_x1 dup_x2 dup2 dup2_x1 dup2_x2 swap iadd ladd fadd dadd isub lsub fsub dsub " +
  "imul lmul fmul dmul idiv ldiv fdiv ddiv irem lrem frem drem ineg lneg fneg dneg ishl lshl ishr lshr iushr lushr iand land ior lor ixor lxor iinc i2l i2f i2d " +
  "l2i l2f l2d f2i f2l f2d d2i d2l d2f i2b i2c i2s lcmp fcmpl fcmpg dcmpl dcmpg ifeq ifne iflt ifge ifgt ifle if_icmpeq if_icmpne if_icmplt if_icmpge if_icmpgt if_icmple " +
  "if_acmpeq if_acmpne goto jsr ret tableswitch lookupswitch ireturn lreturn freturn dreturn areturn return getstatic putstatic getfield putfield invokevirtual " +
  "invokespecial invokestatic invokeinterface invokedynamic new newarray anewarray arraylength athrow checkcast instanceof monitorenter monitorexit wide " +
  "multianewarray ifnull ifnonnull goto_w jsr_w").split(" ");
const ATYPE = { 4: "boolean", 5: "char", 6: "float", 7: "double", 8: "byte", 9: "short", 10: "int", 11: "long" };
const BRANCH2 = new Set([...Array.from({ length: 0xa8 - 0x99 + 1 }, (_, i) => 0x99 + i), 0xc6, 0xc7]); // if*, goto, jsr, ifnull, ifnonnull

function disassemble(c, attr) {
  const { bytes, dv, show } = c;
  let p = attr.start;
  const maxStack = dv.getUint16(p), maxLocals = dv.getUint16(p + 2), codeLen = dv.getUint32(p + 4);
  const code0 = p + 8, end = code0 + codeLen;
  // pass 1: decode, collect branch targets
  const ins = [];
  const targets = new Set();
  for (let q = code0; q < end;) {
    const off = q - code0, op = bytes[q++];
    // ldc_w / goto_w / jsr_w are the same instructions as ldc / goto / jsr with a wider operand — which form javac
    // picks depends on constant-pool size or method length, not on the code, so they print the same
    let text = op === 0x13 ? "ldc" : op === 0xc8 ? "goto" : op === 0xc9 ? "jsr" : OPS[op] || `op_${op}`, tgt = [];
    const s1 = () => dv.getInt8(q++), u1v = () => bytes[q++], s2 = () => { const v = dv.getInt16(q); q += 2; return v; }, u2v = () => { const v = dv.getUint16(q); q += 2; return v; }, s4 = () => { const v = dv.getInt32(q); q += 4; return v; };
    if (op === 0x10) text += ` ${s1()}`;
    else if (op === 0x11) text += ` ${s2()}`;
    else if (op === 0x12) text += ` ${show(u1v())}`;
    else if (op === 0x13 || op === 0x14) text += ` ${show(u2v())}`;
    else if ((op >= 0x15 && op <= 0x19) || (op >= 0x36 && op <= 0x3a) || op === 0xa9) text += ` ${u1v()}`;
    else if (op === 0x84) { const v = u1v(); text += ` ${v} ${s1()}`; }
    else if (BRANCH2.has(op)) { const t = off + s2(); tgt = [t]; }
    else if (op === 0xc8 || op === 0xc9) { const t = off + s4(); tgt = [t]; }
    else if (op === 0xaa) { // tableswitch
      q = code0 + ((q - code0 + 3) & ~3);
      const def = off + s4(), lo = s4(), hi = s4();
      const cases = []; for (let k = lo; k <= hi; k++) cases.push([k, off + s4()]);
      tgt = [def, ...cases.map((x) => x[1])];
      text = { sw: "tableswitch", def, cases };
    } else if (op === 0xab) { // lookupswitch
      q = code0 + ((q - code0 + 3) & ~3);
      const def = off + s4(), np = s4();
      const cases = []; for (let k = 0; k < np; k++) { const key = s4(); cases.push([key, off + s4()]); }
      tgt = [def, ...cases.map((x) => x[1])];
      text = { sw: "lookupswitch", def, cases };
    } else if ((op >= 0xb2 && op <= 0xb8) || op === 0xbb || op === 0xbd || op === 0xc0 || op === 0xc1) text += ` ${show(u2v())}`;
    else if (op === 0xb9) { text += ` ${show(u2v())}`; q += 2; }
    else if (op === 0xba) { text += ` ${show(u2v())}`; q += 2; }
    else if (op === 0xbc) text += ` ${ATYPE[u1v()] || "?"}`;
    else if (op === 0xc5) { text += ` ${show(u2v())} ${u1v()}`; }
    else if (op === 0xc4) { // wide
      const op2 = bytes[q++];
      text = `wide ${OPS[op2]} ${u2v()}`;
      if (op2 === 0x84) text += ` ${s2()}`;
    }
    tgt.forEach((t) => targets.add(t));
    ins.push({ off, text, tgt });
  }
  // exception table
  let e = end;
  const nEx = dv.getUint16(e); e += 2;
  const ex = [];
  for (let k = 0; k < nEx; k++) {
    const s = dv.getUint16(e), en = dv.getUint16(e + 2), h = dv.getUint16(e + 4), t = dv.getUint16(e + 6); e += 8;
    ex.push({ s, en, h, type: t ? show(t) : "any" });
    [s, en, h].forEach((x) => targets.add(x));
  }
  const label = new Map([...targets].sort((a, b) => a - b).map((t, i) => [t, `L${i + 1}`]));
  const L = (t) => label.get(t) || `@${t}`;
  const lines = [`    // stack ${maxStack}, locals ${maxLocals}`];
  for (const x of ins) {
    if (label.has(x.off)) lines.push(`  ${L(x.off)}:`);
    if (typeof x.text === "object") {
      lines.push(`    ${x.text.sw} {`);
      for (const [k, t] of x.text.cases) lines.push(`      ${k}: ${L(t)}`);
      lines.push(`      default: ${L(x.text.def)}`, "    }");
    } else lines.push(`    ${x.text}${x.tgt.length ? ` ${L(x.tgt[0])}` : ""}`);
  }
  if (label.has(codeLen)) lines.push(`  ${L(codeLen)}:`);
  for (const x of ex) lines.push(`    catch ${x.type} ${L(x.s)}-${L(x.en)} -> ${L(x.h)}`);
  return lines.join("\n");
}

const BASE = [[0x0001, "public"], [0x0002, "private"], [0x0004, "protected"], [0x0008, "static"], [0x0010, "final"]];
const FLAGS = {
  class: [...BASE, [0x0200, "interface"], [0x0400, "abstract"], [0x1000, "synthetic"], [0x2000, "annotation"], [0x4000, "enum"]],
  field: [...BASE, [0x0040, "volatile"], [0x0080, "transient"], [0x1000, "synthetic"], [0x4000, "enum"]],
  method: [...BASE, [0x0020, "synchronized"], [0x0040, "bridge"], [0x0080, "varargs"], [0x0100, "native"], [0x0400, "abstract"], [0x0800, "strictfp"], [0x1000, "synthetic"]],
};
const flags = (a, kind = "method") => FLAGS[kind].filter(([b]) => a & b).map(([, n]) => n).join(" ");
const typeName = (n) => n.replace(/\//g, ".");
const PRIM = { B: "byte", C: "char", D: "double", F: "float", I: "int", J: "long", S: "short", Z: "boolean", V: "void" };
// descriptor -> Java types: "Ljava/lang/String;" -> "java.lang.String", "(I[B)V" -> { args: ["int","byte[]"], ret: "void" }
function types(desc) {
  const out = [];
  for (let i = 0; i < desc.length;) {
    let dims = 0;
    while (desc[i] === "[") { dims++; i++; }
    let t;
    if (desc[i] === "L") { const e = desc.indexOf(";", i); t = typeName(desc.slice(i + 1, e)); i = e + 1; }
    else t = PRIM[desc[i++]] || "?";
    out.push(t + "[]".repeat(dims));
  }
  return out;
}
const fieldType = (d) => types(d)[0];
const methodSig = (d) => { const c = d.indexOf(")"); return { args: types(d.slice(1, c)), ret: types(d.slice(c + 1))[0] }; };

// readable members of one class: { header, members: { key: { kind, text } } } — key = "name(descriptor)" / field name
export function classModel(bytes) {
  const c = parseClass(bytes);
  const members = {};
  const sig = (m) => { const a = m.attrs.find((x) => x.name === "Signature"); return a ? c.str(c.dv.getUint16(a.start)) : ""; };
  const exc = (m) => { const a = m.attrs.find((x) => x.name === "Exceptions"); if (!a) return ""; const n = c.dv.getUint16(a.start); return " throws " + Array.from({ length: n }, (_, i) => typeName(c.cls(c.dv.getUint16(a.start + 2 + i * 2)))).join(", "); };
  for (const f of c.fields) {
    const cv = f.attrs.find((x) => x.name === "ConstantValue");
    members[f.name] = { kind: "field", label: f.name, text: `${flags(f.access, "field")} ${fieldType(f.desc)} ${f.name}${cv ? ` = ${c.show(c.dv.getUint16(cv.start))}` : ""}${sig(f) ? `  // ${sig(f)}` : ""}`.trim() };
  }
  for (const m of c.methods) {
    const code = m.attrs.find((x) => x.name === "Code");
    const s = methodSig(m.desc);
    const head = `${flags(m.access)} ${m.name === "<init>" || m.name === "<clinit>" ? "" : s.ret + " "}${m.name}(${s.args.join(", ")})${exc(m)}${sig(m) ? `  // ${sig(m)}` : ""}`.trim();
    let body = "";
    try { body = code ? disassemble(c, code) : "    // no code (abstract / native)"; } catch (e) { body = `    // could not disassemble: ${e.message}`; }
    members[`${m.name}${m.desc}`] = { label: `${m.name}(${s.args.join(", ")})`, kind: m.name === "<init>" ? "constructor" : m.name === "<clinit>" ? "static init" : "method", text: `${head}\n${body}` };
  }
  // javac numbers lambda bodies across the whole class (lambda$load$44), so one new lambda anywhere renames all the
  // others. Renumber them per enclosing method (lambda$load$1, $2 …) so only real changes show.
  const lam = {};
  for (const m of c.methods) { const x = m.name.match(/^lambda\$(.*)\$(\d+)$/); if (x) (lam[x[1]] ||= []).push(+x[2]); }
  const rename = new Map();
  for (const [outer, nums] of Object.entries(lam)) [...new Set(nums)].sort((a, b) => a - b).forEach((n, i) => rename.set(`lambda$${outer}$${n}`, `lambda$${outer}$${i + 1}`));
  if (rename.size) {
    const fix = (t) => t.replace(/lambda\$[\w$]*\$\d+/g, (w) => rename.get(w) || w);
    const old = Object.entries(members);
    for (const k of Object.keys(members)) delete members[k];
    for (const [k, v] of old) members[fix(k)] = { ...v, label: fix(v.label), text: fix(v.text) };
  }
  const header = `${flags(c.access & ~0x0200 & ~0x2000, "class")} ${c.access & 0x2000 ? "@interface" : c.access & 0x0200 ? "interface" : "class"} ${typeName(c.name)}${c.superClass && c.superClass !== "java/lang/Object" ? ` extends ${typeName(c.superClass)}` : ""}${c.interfaces.length ? ` implements ${c.interfaces.map(typeName).join(", ")}` : ""}`.trim();
  return { name: c.name, version: c.version, header, members };
}

// whole class as one text (for the side-by-side view)
export function classText(model) {
  const keys = Object.keys(model.members);
  const fields = keys.filter((k) => model.members[k].kind === "field").sort();
  const methods = keys.filter((k) => model.members[k].kind !== "field").sort();
  return [`// class file version ${model.version}`, `${model.header} {`, ...fields.map((k) => `  ${model.members[k].text};`), "", ...methods.map((k) => `  ${model.members[k].text.replace(/\n/g, "\n  ")}\n`), "}"].join("\n");
}
