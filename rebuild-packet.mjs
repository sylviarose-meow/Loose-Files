// Rebuild packet — the mechanical half of "rebuild from records, not
// from the handoff note" (the v0.61.0 lesson).
//
// ADAPTED FOR THIS WORKSPACE (Chloe, 2026-10-24 — from Trish's
// blind-packet.mjs, with thanks; fiction beats/speakers replaced by a
// build-packet shape, leak logic kept verbatim).
//
// A rebuild packet is the sole input a new build may use. It names
// every input WITH its source (citation-or-throw at packet level),
// every constraint, and the acceptance bar — plus the fenced list:
// failed files that must not be read or copied. Two checks:
//   completeness — every turn carries its paperwork (no sourceless
//     inputs, no unlicensed constraints, acceptance non-empty).
//   leak — the packet shares no word-runs with the fenced files, so
//     no failed constant, mapping, or wording travels forward.
// The tool reports, never licenses: a shared run of cited record
// names is the facts wearing the same clothes; a shared run of
// VALUES is a leak. Human judges.
//
// PACKET SHAPE:
//   {
//     "task": "rebuild snout mass through the tool only",
//     "inputs": [{name, source}],        // source = record path/face,
//                                        // measurement id, or license id
//     "constraints": [{rule, source}],   // source or license id
//     "acceptance": ["..."],             // pass predicates, with numbers
//     "fenced": ["src/lab/snoutFenceView.js", ...]  // must-not-copy list
//   }
//
// HOW TO RUN (this workspace — execute_js, no node here):
//   const code = await fs.readTextFile("src/tools/blind-packet.mjs");
//   const mod = await import(URL.createObjectURL(new Blob([code], {type:"text/javascript"})));
//   const packet = JSON.parse(await fs.readTextFile("scratch/rebuild-packet.json"));
//   mod.auditPacket(packet);
//   const fenced = await fs.readTextFile("src/lab/snoutFence.js"); // one file at a time
//   mod.leakCheck(JSON.stringify(packet), fenced, {minWords: 8});
// Node CLI: node src/tools/blind-packet.mjs --packet <packet.json>
//   [--fenced <fenced.txt>] [--min-words N]
// Exit 0: packet complete and no leak. Exit 1: anything short or leaking.
// Pure means pure: no imports at module top level (node builtins load
// inside main() only), no DOM, no process access outside main().

export const MIN_WORDS = 8;

function toks(s) {
  return String(s == null ? "" : s)
    .toLowerCase()
    .replace(/'s\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean);
}

export function auditPacket(packet, opts) {
  opts = opts || {};
  const failures = [];
  const p = packet && typeof packet === "object" ? packet : {};
  if (!p.task || !String(p.task).trim()) failures.push("packet.task: empty — what is being rebuilt?");
  const inputs = Array.isArray(p.inputs) ? p.inputs : [];
  const constraints = Array.isArray(p.constraints) ? p.constraints : [];
  if (!inputs.length) failures.push("packet.inputs: empty — no cited inputs to build from");
  inputs.forEach(function (inp, i) {
    const missing = [];
    if (!inp.name) missing.push("name");
    if (!inp.source) missing.push("source (citation-or-throw: record path/face, measurement id, or license id)");
    if (missing.length) failures.push("input " + i + " (" + (inp.name || "?") + "): missing " + missing.join(", "));
  });
  constraints.forEach(function (c, i) {
    const missing = [];
    if (!c.rule) missing.push("rule");
    if (!c.source) missing.push("source (or license id)");
    if (missing.length) failures.push("constraint " + i + ": missing " + missing.join(", "));
  });
  const acc = Array.isArray(p.acceptance) ? p.acceptance : [];
  if (!acc.length) failures.push("packet.acceptance: empty — no pass predicates");
  const fenced = Array.isArray(p.fenced) ? p.fenced : [];
  if (!fenced.length) failures.push("packet.fenced: empty — name the failed files that must not be copied");
  return { totalInputs: inputs.length, totalConstraints: constraints.length, failures: failures, ok: failures.length === 0 };
}

export function sharedRuns(a, b, minWords) {
  minWords = minWords || MIN_WORDS;
  const sa = toks(a);
  const sb = toks(b);
  const index = new Map();
  for (let i = 0; i + minWords <= sa.length; i++) {
    const k = sa.slice(i, i + minWords).join(" ");
    if (!index.has(k)) index.set(k, []);
    index.get(k).push(i);
  }
  const found = [];
  for (let j = 0; j + minWords <= sb.length; j++) {
    const k = sb.slice(j, j + minWords).join(" ");
    if (!index.has(k)) continue;
    const starts = index.get(k);
    for (const i of starts) {
      let x = i + minWords, y = j + minWords;
      while (x < sa.length && y < sb.length && sa[x] === sb[y]) { x++; y++; }
      found.push({ run: sb.slice(j, y).join(" "), len: y - j });
    }
  }
  found.sort(function (m, n) { return n.len - m.len; });
  return found
    .filter(function (r, _, arr) {
      return !arr.some(function (o) { return o !== r && o.len > r.len && o.run.indexOf(r.run) !== -1; });
    })
    .slice(0, 20);
}

export function leakCheck(packetText, fencedText, opts) {
  opts = opts || {};
  const minWords = opts.minWords || MIN_WORDS;
  if (!fencedText) return { runs: [], ok: true };
  const runs = sharedRuns(String(fencedText), String(packetText), minWords);
  return { runs: runs, ok: runs.length === 0 };
}

async function main(args) {
  const fsmod = await import("node:fs");
  const fs = fsmod.default;
  const at = function (flag) {
    const i = args.indexOf(flag);
    return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
  };
  const packetPath = at("--packet");
  const fencedPath = at("--fenced");
  const minWords = parseInt(at("--min-words") || "", 10) || MIN_WORDS;
  if (!packetPath) {
    console.error("usage: blind-packet.mjs --packet <packet.json> [--fenced <fenced.txt>] [--min-words N]");
    process.exit(1);
  }
  let packet;
  try {
    packet = JSON.parse(fs.readFileSync(packetPath, "utf8"));
  } catch (e) {
    console.error("blind-packet: cannot read packet: " + e.message);
    process.exit(1);
  }
  const rep = auditPacket(packet, {});
  console.log("inputs: " + rep.totalInputs + ", constraints: " + rep.totalConstraints);
  let leaks = { runs: [], ok: true };
  if (fencedPath) {
    let fenced = "";
    try {
      fenced = fs.readFileSync(fencedPath, "utf8");
    } catch (e) {
      console.error("blind-packet: cannot read fenced: " + e.message);
      process.exit(1);
    }
    leaks = leakCheck(JSON.stringify(packet), fenced, { minWords: minWords });
    console.log("leak: " + (leaks.ok ? "clean" : leaks.runs.length + " shared runs"));
    for (const r of leaks.runs) console.log("  (" + r.len + "w) \"" + r.run + "\"");
  }
  const all = rep.failures.concat(leaks.runs.map(function (r) { return "leak (" + r.len + "w): \"" + r.run + "\""; }));
  if (all.length) {
    console.log("--- packet failures ---");
    for (const f of all) console.log("  " + f);
  } else {
    console.log("packet: clean");
  }
  process.exit(all.length ? 1 : 0);
}

if (typeof process !== "undefined" && process.argv && process.argv[1] && String(process.argv[1]).endsWith("rebuild-packet.mjs")) {
  main(process.argv.slice(2));
}
