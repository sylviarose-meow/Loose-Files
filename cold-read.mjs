// Cold-read trace check — the mechanical half of "revise, don't trace".
//
// THE METHOD (the human half — this file checks steps 4 and 5):
//   1. FACTS FIRST: read the source once and list its facts as short
//      noun-phrase bullets in a facts file (one per line). No full
//      sentence from the source may survive into the bullets.
//   2. MEANINGS NEXT: under each fact, one line saying what it means to
//      a cold reader (podium = her own force to conduct; trials = ranked
//      crossings). A fact with no meaning line is lean — pull information
//      or mark it DELIBERATE before drafting.
//   3. SOURCE SHUT: close the source. Draft from the facts and meanings.
//   4. COLD READ: read the draft aloud with the source still shut —
//      anything that trips gets rewritten before any tool runs.
//   5. TRACE + GAP CHECK (this file): diff the draft against the source
//      for shared word-runs AND against the facts for coverage. A shared
//      run that carries no proper noun is tracing until rewritten; a
//      shared run of names and terms is the facts wearing the same
//      clothes, and stands. Every gap below ships as an explicit
//      QUESTION with three legal answers: PULL (fill it), DELIBERATE
//      (leave thin on purpose, recorded), CROSSREF (established
//      in an earlier pass — cite where).
//   6. REWRITE AND RE-RUN: rewrite every flagged run, answer every
//      question, then run the check again. Two clean runs in a row
//      closes the pass.
//
// WHAT IT CHECKS.
//   traceReport(source, revision): contiguous shared word-runs,
//      normalized (lowercase, possessives and punctuation stripped).
//      Proper nouns come from the source itself: words it capitalizes
//      mid-sentence (Academy, Gloom — never sentence starts).
//   coverageReport(facts, revision): per fact bullet, the fraction of
//      content words present in the revision. Below 1.0 is lean or
//      dropped — pull or cut deliberately, never silently.
//   gapQuestions(source, facts, revision): the pull list —
//      [actor] vague doers in the revision (somebody, passives with no
//      agent: who?); [term] first-use proper nouns with no gloss in
//      their sentence (comma, which/who/called/as appositives count);
//      [coverage] facts the revision covers thinly or not at all.
//      Questions about people and places settled in an earlier pass
//      answer CROSSREF with the citation.
//
// HOW TO RUN (node).
//   node src/tools/cold-read.mjs --source <src.txt> --revision <rev.txt>
//   [--facts <facts.txt>] [--min-words 4] [--info]
// Exit 0: no suspicious runs and no gap questions. Exit 1: either found
// (or a usage/IO error). `--info` also prints carrying runs.
//
// HOW TO RUN (this harness — no node here).
//   Blob-import this file in execute_js and call the pure functions:
//   traceReport(source, revision, {minWords}),
//   coverageReport(factsText, revision),
//   gapQuestions(source, factsText, revision, {minWords}).
//   Pure means pure: no imports at module top level (node builtins load
//   inside main() only), no DOM, no process access outside main().

export const MIN_WORDS = 4;

// normText: strip markdown structure so boilerplate, code, and link
// wrappers don't count as shared prose. Applied inside every report
// function (both sides), so token positions stay consistent.
export function normText(s) {
  return String(s == null ? "" : s)
    .replace(/```[\s\S]*?```/g, "\n")
    .replace(/`[^`]*`/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^[>\-|]+/gm, " ");
}

const STOPWORDS = new Set(
  "the,a,an,and,or,but,with,from,into,that,this,these,those,for,its,his,her,their,our,your,who,which,what,when,while,after,before,over,under,out,onto,through,between,among,each,other,more,most,only,still,just,even,also,than,then,there,they,them,as,are,was,were,gets,got,get,has,have,had,does,did,will,would,can,could,should,been,being,upon,once,here,how,all,any,both,few,nor,own,same,very,about,into".split(",")
);

const VAGUE_ACTOR = /\b(somebody|someone|something|somewhere|anybody)\b/i;
const VAGUE_SPEC = /\betc\.|\bvarious\b|\brelevant\b|\bappropriate\b|\bnormally\b/i;
const PASSIVE_NO_AGENT = /\b(is|are|was|were|be|been|gets?|got)\s+[a-z]+(ed|en|wn)\b/i;
const GLOSS_MARK = /,|—|–|:|\(|\)|\bwhich\b|\bwho\b|\bcalled\b|\bknown as\b|\bas\b|\bmeans\b/i;

export function tokenize(s) {
  const orig = String(s == null ? "" : s).split(/\s+/).filter(Boolean);
  const out = [];
  for (const w of orig) {
    const t = w
      .toLowerCase()
      .replace(/'s\b/g, "")
      .replace(/[^a-z0-9]/g, "");
    if (t) out.push({ t, orig: w.replace(/^[“"‘']+|[”"’']+$/g, "") });
  }
  return out;
}

export function contentWords(s) {
  return tokenize(s)
    .map((x) => x.t)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

export function splitSentences(s) {
  return String(s == null ? "" : s).split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean);
}

export function properNouns(source) {
  const toks = tokenize(source);
  const lowerForms = new Set();
  for (const t of toks) {
    if (!/^[A-Z]/.test(t.orig)) lowerForms.add(t.t);
  }
  const stemS = (w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);
  const names = new Set();
  // Workspace identifiers (T1, A1, VCB, LIC-DEPTH, q1, v0.61.0) are
  // terms wherever they appear — never sentence-case prose. Shapes:
  // letter+digit mixes (q1, T1, v0610), ALLCAPS tokens (VCB,
  // LIC-DEPTH), internal-uppercase mixes (VPs, SketchUp). Plain
  // Titlecase ("The", "Every") is NOT an identifier — sentence-start
  // exclusion still applies to it.
  for (const t of toks) {
    const o = t.orig.replace(/^[“"‘'([{\-]+|[”"’'.,;:!?)\]}\-]+$/g, "");
    if (o.length < 2 || /^[0-9.,]+$/.test(o)) continue;
    if (/\d/.test(o) && /[A-Za-z]/.test(o)) names.add(t.t);
    else if (/^[A-Z0-9][A-Z0-9\-]*$/.test(o)) names.add(t.t);
    else if (/[a-z][A-Z]/.test(o) || /[A-Z][a-z].*[A-Z]/.test(o)) names.add(t.t);
  }
  for (const s of splitSentences(source)) {
    const st = tokenize(s);
    st.forEach((tok, i) => {
      if (i > 0 && /^[A-Z]/.test(tok.orig)) {
        // Title-case words from headings ("Trial", "Seven", "Bridges") also
        // occur lowercase in the body — those are not proper nouns.
        let common = false;
        for (const l of lowerForms) {
          if (l === tok.t || stemS(l) === stemS(tok.t)) {
            common = true;
            break;
          }
        }
        if (!common) names.add(tok.t);
      }
    });
  }
  return names;
}

export function sharedRuns(source, revision, minWords = MIN_WORDS) {
  const st = tokenize(source);
  const rt = tokenize(revision);
  const sn = st.map((x) => x.t);
  const rn = rt.map((x) => x.t);
  const index = new Map();
  for (let i = 0; i + minWords <= sn.length; i++) {
    const k = sn.slice(i, i + minWords).join(" ");
    if (!index.has(k)) index.set(k, []);
    index.get(k).push(i);
  }
  const found = new Map();
  for (let j = 0; j + minWords <= rn.length; j++) {
    const k = rn.slice(j, j + minWords).join(" ");
    if (!index.has(k)) continue;
    for (const i of index.get(k)) {
      let a = i + minWords;
      let b = j + minWords;
      while (a < sn.length && b < rn.length && sn[a] === rn[b]) {
        a++;
        b++;
      }
      const key = `${j}:${b}`;
      if (!found.has(key) || found.get(key).srcAt > i) {
        found.set(key, {
          run: rn.slice(j, b).join(" "),
          revWords: rt.slice(j, b).map((x) => x.orig),
          srcAt: i,
          revAt: j,
          len: b - j,
        });
      }
    }
  }
  const runs = [...found.values()].sort((a, b) => b.len - a.len || a.revAt - b.revAt);
  return runs.filter(
    (r, _, arr) => !arr.some((o) => o !== r && o.revAt <= r.revAt && o.revAt + o.len >= r.revAt + r.len)
  );
}

export function corpusRuns(texts, minWords = 5) {
  // The tripwire the pair battery missed: shared word-runs across a whole
  // corpus, not just source-vs-revision. texts = [{ord, text}].
  // Returns [{run, ords}] for every run with 2+ owners, longest first.
  // Deliberate quotations (family-story titles, mutual handoffs) still need
  // a written craft note — this reports, never licenses.
  const seqs = (Array.isArray(texts) ? texts : [])
    .map((b) => ({ ord: b && (b.ord !== undefined ? b.ord : b.id), toks: tokenize(normText(b ? b.text : "")).map((x) => x.t) }))
    .filter((b) => b.ord !== undefined && b.toks.length >= minWords);
  const index = new Map();
  for (const b of seqs) {
    const seen = new Set();
    for (let i = 0; i + minWords <= b.toks.length; i++) {
      const k = b.toks.slice(i, i + minWords).join(" ");
      if (seen.has(k)) continue;
      seen.add(k);
      if (!index.has(k)) index.set(k, []);
      index.get(k).push(b.ord);
    }
  }
  const out = [];
  for (const [run, ords] of index) {
    if (ords.length > 1) out.push({ run, ords: [...new Set(ords)].sort((a, b) => a - b) });
  }
  // Drop runs fully contained in a longer shared run with the same owners.
  return out.sort((a, b) => b.run.length - a.run.length || a.ords[0] - b.ords[0]).filter(
    (r, _, arr) => !arr.some((o) => o !== r && o.run.includes(r.run) && r.ords.every((x) => o.ords.includes(x)))
  );
}

export function traceReport(source, revision, opts = {}) {
  const minWords = opts.minWords || MIN_WORDS;
  source = normText(source);
  revision = normText(revision);
  const names = properNouns(source);
  const runs = sharedRuns(source, revision, minWords);
  const revText = String(revision == null ? "" : revision);
  const sentences = splitSentences(revText).map((text) => {
    const toks = tokenize(text);
    let longestRun = 0;
    const hits = [];
    const start = tokenize(revText.split(text)[0]).length;
    for (const r of runs) {
      if (r.revAt + r.len > start && r.revAt < start + toks.length) {
        longestRun = Math.max(longestRun, r.len);
        hits.push(r.run);
      }
    }
    return { text, longestRun, runs: hits };
  });
  const clean = (w) => w.toLowerCase().replace(/'s$/g, "").replace(/[^a-z0-9]/g, "");
  const tag = (r) => ({ ...r, carrying: r.revWords.some((w) => names.has(clean(w))) });
  const tagged = runs.map(tag);
  const suspiciousRuns = tagged.filter((r) => !r.carrying);
  const carryingRuns = tagged.filter((r) => r.carrying);
  const total = tokenize(revText).length;
  const covered = new Set();
  for (const r of suspiciousRuns) {
    for (let k = r.revAt; k < r.revAt + r.len; k++) covered.add(k);
  }
  return {
    sentences,
    suspiciousRuns,
    carryingRuns,
    score: total ? covered.size / total : 0,
    minWords,
  };
}

export function coverageReport(factsText, revision, opts = {}) {
  // Stem both sides so a re-inflected fact still counts (examiner for
  // examiners, destroy for destroyed). A genuinely reworded fact still
  // misses — answer it DELIBERATE with the rewording noted.
  // opts.extra: words counted as present without appearing in the text —
  // pass turn speakers so a fact naming MOMO matches her turns.
  const stemAll = (w) => {
    const irr = { redrawn: "redraw", drawn: "draw", blown: "blow", sung: "sing", taken: "take", given: "give", eaten: "eat", beaten: "beat", chosen: "choose", fallen: "fall", gone: "go", done: "do", said: "say", kept: "keep", slept: "sleep", left: "leave", felt: "feel" };
    if (irr[w]) return irr[w];
    if (w.length > 4 && w.endsWith("ing")) return w.slice(0, -3);
    if (w.length > 4 && w.endsWith("ed")) return w.slice(0, -2);
    if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
    return w;
  };
  const rev = new Set();
  for (const x of tokenize(normText(revision))) rev.add(stemAll(x.t));
  for (const x of tokenize(normText(opts.extra || ""))) rev.add(stemAll(x.t));
  return String(factsText == null ? "" : normText(factsText))
    .split("\n")
    .map((x) => x.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean)
    .map((fact) => {
      const cw = contentWords(fact);
      const missing = cw.filter((w) => !rev.has(stemAll(w)));
      return { fact, coverage: cw.length ? (cw.length - missing.length) / cw.length : 1, missing };
    });
}

export function gapQuestions(source, factsText, revision, opts = {}) {
  const minWords = opts.minWords || MIN_WORDS;
  source = normText(source);
  revision = normText(revision);
  const questions = [];
  const names = properNouns(source);
  const sentences = splitSentences(revision);
  sentences.forEach((s, i) => {
    const va = s.match(VAGUE_ACTOR);
    if (va) {
      questions.push({
        kind: "actor",
        quote: s,
        ask: `Who or what is "${va[0]}"? PULL (name it) or DELIBERATE (the source never says).`,
      });
    }
    const vs = s.match(VAGUE_SPEC);
    if (vs) {
      questions.push({
        kind: "vague",
        quote: s,
        ask: `"${vs[0]}" is a weasel word — pin it (a number, a name, a predicate) or DELIBERATE.`,
      });
    }
    const pm = s.match(PASSIVE_NO_AGENT);
    if (pm && !/,|by\b/i.test(s)) {
      questions.push({
        kind: "actor",
        quote: s,
        ask: `Who acts — "${pm[0]}" carries no agent. PULL or DELIBERATE.`,
      });
    }
    void i;
  });
  const seen = new Set();
  // The self-naming opener ("I'm Wade Rogers") introduces the speaker by
  // license — never a gloss gap. First-person pronouns are never terms.
  // Caught 2026-10-16 dry run: "I'm"/"I"/"Wade" flagged on Wade ord-28.
  const FIRST_PERSON = new Set("i,im,ive,ill,id,me,my,mine,myself,we,us,our,ours,ourselves".split(","));
  sentences.forEach((s, si) => {
    if (si === 0) return;
    for (const tok of tokenize(s)) {
      if (!names.has(tok.t) || seen.has(tok.t)) continue;
      if (FIRST_PERSON.has(tok.t)) continue;
      seen.add(tok.t);
      if (!GLOSS_MARK.test(s)) {
        const shown = tok.orig.replace(/[.,;:!?]+$/, "");
        questions.push({
          kind: "term",
          quote: s,
          ask: `"${shown}" first appears here with no gloss — what is it to a cold reader? PULL (gloss it), CROSSREF (cite the earlier pass), or DELIBERATE.`,
        });
      }
    }
  });
  for (const c of coverageReport(factsText, revision, opts)) {
    if (c.coverage < 1) {
      questions.push({
        kind: "coverage",
        quote: c.fact,
        ask: `Fact covered ${Math.round(c.coverage * 100)}% — missing: ${c.missing.join(", ")}. PULL (write it in) or DELIBERATE (cut on purpose).`,
      });
    }
  }
  void minWords;
  return questions;
}

// specLint: unresolved markers that must not survive into a build.
// A spec that passes ([]) has no open items — every NEEDS/TODO is
// answered, deliberately recorded, or removed.
const MARKERS = ["NEEDS USER APPROVAL", "NEEDS APPROVAL", "TODO", "TBD", "FIXME", "XXX", "HACK", "PLACEHOLDER", "NEEDS DECISION"];
export function specLint(text) {
  const out = [];
  String(text == null ? "" : text).split("\n").forEach((line, i) => {
    const hit = MARKERS.find((m) => line.toUpperCase().includes(m));
    if (hit) out.push({ line: i + 1, marker: hit, text: line.trim().slice(0, 160) });
  });
  return out;
}

async function main(args) {
  const { default: fs } = await import("node:fs");
  const at = (flag) => {
    const i = args.indexOf(flag);
    return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
  };
  const srcPath = at("--source");
  const revPath = at("--revision");
  const factsPath = at("--facts");
  const minWords = parseInt(at("--min-words") || "", 10) || MIN_WORDS;
  const info = args.includes("--info");
  if (!srcPath || !revPath) {
    console.error("usage: cold-read.mjs --source <src.txt> --revision <rev.txt> [--facts <facts.txt>] [--min-words N] [--info]");
    process.exit(1);
  }
  let source, revision, facts = "";
  try {
    source = fs.readFileSync(srcPath, "utf8");
    revision = fs.readFileSync(revPath, "utf8");
    if (factsPath) facts = fs.readFileSync(factsPath, "utf8");
  } catch (e) {
    console.error(`cold-read: cannot read inputs: ${e.message}`);
    process.exit(1);
  }
  const rep = traceReport(source, revision, { minWords });
  for (const s of rep.sentences) {
    console.log(`[${s.longestRun}w] ${s.text}`);
  }
  if (rep.suspiciousRuns.length) {
    console.log("--- suspicious (no proper noun — rewrite these) ---");
    for (const r of rep.suspiciousRuns) console.log(`(${r.len}w) "${r.run}"`);
  }
  if (info && rep.carryingRuns.length) {
    console.log("--- carrying (terms shared — standing) ---");
    for (const r of rep.carryingRuns) console.log(`(${r.len}w) "${r.run}"`);
  }
  console.log(`trace: ${(rep.score * 100).toFixed(1)}% suspicious (${rep.suspiciousRuns.length} runs, ${rep.carryingRuns.length} carrying)`);
  let gaps = [];
  if (facts) {
    console.log("--- coverage (per fact bullet) ---");
    for (const c of coverageReport(facts, revision)) {
      console.log(`[${Math.round(c.coverage * 100)}%] ${c.fact}${c.missing.length ? ` — missing: ${c.missing.join(", ")}` : ""}`);
    }
    gaps = gapQuestions(source, facts, revision, { minWords });
  }
  if (gaps.length) {
    console.log("--- questions (PULL, DELIBERATE, or CROSSREF each) ---");
    gaps.forEach((q, i) => console.log(`Q${i + 1} [${q.kind}] ${q.ask}\n    > ${q.quote}`));
  }
  process.exit(rep.suspiciousRuns.length || gaps.length ? 1 : 0);
}

if (typeof process !== "undefined" && process.argv && process.argv[1] && String(process.argv[1]).endsWith("cold-read.mjs")) {
  main(process.argv.slice(2));
}
// ADAPTED from Trish's original from another project,
// with thanks; method header above unchanged).
// Mapping: source = evidence/owning doc, revision = new draft text,
// facts = noun-phrase bullets (LEDGER rows work: one premise per line).
// Adaptations: markdown-aware matching (fenced/inline code stripped so
// boilerplate and formulas don't count as traced prose), ALLCAPS
// workspace terms (T1, A1, VCB, LIC-DEPTH, R1…) treated as proper
// nouns wherever they appear, a couple of spec-weasel words added to
// the vague list, and specLint() for unresolved markers.
//
// HOW TO RUN (this workspace — execute_js, no node here):
//   const code = await fs.readTextFile("src/tools/cold-read.mjs");
//   const mod = await import(URL.createObjectURL(new Blob([code], {type:"text/javascript"})));
//   const src = await fs.readTextFile("src/plans/option4-modeler-spec.md");
//   mod.specLint(src);                        // unresolved markers
//   mod.traceReport(source, revision);        // shared word-runs
//   mod.coverageReport(factsText, revision);  // per-fact coverage
//   mod.gapQuestions(source, factsText, revision); // PULL/DELIBERATE/CROSSREF
// Node CLI unchanged: node src/tools/cold-read.mjs --source a --revision b
