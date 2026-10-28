// arc-machine.js — portable reference implementation of PORTABLE-ARC-SPEC.md (v0.26).
// Pure ESM, zero dependencies. A blank generator copies this file and wires the
// five host hooks to it; everything below is script-owned per the spec.
// Keys: arcs.<characterId>, meta.<characterId>.{bio,settings,memories,types,tables.[name]},
// meta.shared.<keyword>, meta.world, meta.settingsMode (see SPEC §2.1.7).

export const DEFAULTS = {
  WARM_AT: 20,
  READY_AT: 8,
  COOLDOWN_MS: 7 * 24 * 3600 * 1000,
  ASK_CHANCE: 1.0,
  SYSTEM_CAP: 1200,
  KNOWLEDGE_CAP: 1000,
  CHAR_SLICE: 450,
  WORLD_SLICE: 300,
  ARC_SLICE: 250,
  PAST_CAP: 10,
  MEMORY_CAP: 60,
  MEMORY_WORDS: 20,
  MEMORY_RECALL: 3,
  ANCHOR_CAP: 10,
  FACE_CAP: 20,
  WEIGHT_CAP: 10,
  MAX_BEATS: 8, // total beats cap incl. any twist (§2.1.5); builder emits short core (2 + report) or long build (4 + report)
  THEMES: ["WORK", "PEOPLE", "PLACE", "SECRET"],
};

export const TOPIC_STEMS = ["work", "shift", "money", "family", "friend", "home", "place", "night", "help", "worry"];
export const STOP_WORDS = new Set(["today", "tomorrow", "yesterday", "morning", "evening", "night", "now", "later", "here", "there", "this", "that"]);
export const REFUSAL_PHRASES = ["no", "not now", "drop it", "stop", "leave it", "never mind", "forget it"];

export const BEAT_TABLE = {
  WORK: { "player-led": ["check-in", "small-task", "report"], "character-led": ["check-in", "careful-question", "report"] },
  PEOPLE: { "player-led": ["check-in", "problem", "report"], "character-led": ["check-in", "revisit", "report"] },
  PLACE: { "player-led": ["check-in", "revisit", "report"], "character-led": ["check-in", "revisit", "report"] },
  SECRET: { "player-led": ["check-in", "careful-question", "report"], "character-led": ["check-in", "careful-question", "report"] },
};

// Long builds (§2.5.3): 4 content beats + report, used when the driver is rich
// (two or more grounded leads). Same ids and job shape as the short core.
export const BEAT_TABLE_LONG = {
  WORK: { "player-led": ["check-in", "small-task", "snag", "follow-through", "report"], "character-led": ["check-in", "careful-question", "small-task", "follow-through", "report"] },
  PEOPLE: { "player-led": ["check-in", "problem", "deeper", "kindness", "report"], "character-led": ["check-in", "revisit", "deeper", "kindness", "report"] },
  PLACE: { "player-led": ["check-in", "revisit", "deeper", "follow-through", "report"], "character-led": ["check-in", "revisit", "deeper", "follow-through", "report"] },
  SECRET: { "player-led": ["check-in", "careful-question", "deeper", "reassure", "report"], "character-led": ["check-in", "careful-question", "deeper", "reassure", "report"] },
};

export const REPORT_VARIANTS = {
  WORK: (a, h, p) => `${a}, ${h}. I will see the task through at ${p}.`,
  PEOPLE: (a, h, p) => `${a}, I heard what weighs on ${h}. I will stand by at ${p}.`,
  PLACE: (a, h, p) => `${a}, ${h}. I will come back with you to ${p}.`,
  SECRET: (a, h, p) => `${a}, I heard you. I will keep it close until ${p}.`,
};

// ---------- tiny store (host swaps this for real persistence) ----------
export function createStore(seed = {}) {
  const m = new Map(Object.entries(seed));
  return {
    get(k) { const v = m.get(k); return v === undefined ? null : JSON.parse(JSON.stringify(v)); },
    set(k, v) { m.set(k, JSON.parse(JSON.stringify(v))); },
    del(k) { m.delete(k); },
    dump() { return Object.fromEntries(m); },
  };
}
export const arcKey = (id) => `arcs.${id}`;
export const bioKey = (id) => `meta.${id}.bio`;
export const settingsKey = (id) => `meta.${id}.settings`;
export const memoriesKey = (id) => `meta.${id}.memories`;
export const typesKey = (id) => `meta.${id}.types`;
export const tableKey = (id, name) => `meta.${id}.tables.${name}`;

export function blankRecord() {
  return { askedAt: 0, cooldownUntil: 0, lifetime: 0, tally: { exchanges: 0, topics: [], names: [] }, open: null, past: [] };
}
export function blankSettings() { return { anchors: [], faces: [], weights: [], updatedAt: 0 }; }
export function blankMemories() { return { items: [], updatedAt: 0 }; }

// ---------- tally + tiers (§§2.1.2/2.1.10) ----------
function wholeWord(hay, needle) { return new RegExp(`\\b${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(hay); }

export function updateTally(record, playerText, knownNames = [], stems = TOPIC_STEMS) {
  const t = record.tally;
  t.exchanges += 1;
  record.lifetime = (record.lifetime || 0) + 1; // never reset; feeds closenessTier (§2.1.2)
  const words = playerText.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  for (const stem of stems) {
    if (STOP_WORDS.has(stem)) continue;
    // One push per message; a repeat is the same stem twice (§2.1.10).
    if (words.includes(stem)) t.topics.push(stem);
  }
  const caps = playerText.match(/\b[A-Z][a-z]+\b/g) || [];
  for (const c of caps) {
    if (knownNames.some((n) => n.toLowerCase() === c.toLowerCase()) && !t.names.includes(c)) t.names.push(c);
  }
  return t;
}

export function closenessTier({ standing, messageCount = 0, friendFlag = false } = {}, WARM_AT = DEFAULTS.WARM_AT) {
  const s = String(standing || "").toLowerCase();
  // The standing word is the floor (authored first impression); talk only climbs.
  // Extract the tier word from the raw bio line ("Standing: civil" → civil).
  const mw = s.match(/\b(stranger|civil|warm|close)\b/);
  const wordTier = mw ? mw[1] : "stranger";
  const countTier = messageCount >= WARM_AT ? "warm" : messageCount >= DEFAULTS.READY_AT ? "civil" : "stranger";
  let tier = RANK[wordTier] >= RANK[countTier] ? wordTier : countTier;
  if (friendFlag && tier === "warm") tier = "close";
  return tier;
}

const RANK = { stranger: 0, civil: 1, warm: 2, close: 3 };
export function checkEligible(record, { tier = "stranger", now = Date.now() } = {}) {
  if (record.open) return { ok: false, why: "busy" };
  if (RANK[tier] < RANK.warm) return { ok: false, why: "distant" };
  if (now < record.cooldownUntil) return { ok: false, why: "cooldown" };
  return { ok: true, why: "yes" };
}
export function checkReady(record, READY_AT = DEFAULTS.READY_AT) {
  const t = record.tally;
  const repeated = t.topics.some((s, i) => t.topics.indexOf(s) !== i);
  return t.exchanges >= READY_AT && (repeated || t.names.length > 0);
}

// ---------- ask (§2.1.3) ----------
export const ASK_CONTRACT = "Your first line must be exactly YES <theme> or NO, nothing before it.\nTheme is one word: WORK, PEOPLE, PLACE, or SECRET.";
export function buildAskTask() { return `Decide whether this scene has earned a short arc. ${ASK_CONTRACT}`; }
export function parseAsk(reply, seedTheme = "PEOPLE") {
  const m = String(reply || "").match(/^\s*YES\s+(WORK|PEOPLE|PLACE|SECRET)/i);
  if (m) return { yes: true, theme: m[1].toUpperCase() };
  if (/^\s*YES\b/i.test(String(reply || ""))) return { yes: true, theme: seedTheme };
  return { yes: false, theme: seedTheme };
}

// ---------- contract-line hygiene (§2.1.11) ----------
// Parse first, render second. Judgment-only calls render nothing; combined calls
// strip the matched contract first line and render the remainder.
export function visibleText(reply, pattern) {
  const lines = String(reply || "").split("\n");
  if (lines.length && pattern.test(lines[0])) lines.shift();
  return lines.join("\n").trim();
}

// ---------- bootstrap (§2.3.6) + seed theme ----------
export function seedThemeFrom(seed) {
  const s = String(seed || "").toLowerCase();
  if (/\b(shift|job|task|boss)\b/.test(s)) return "WORK";
  if (/\b(secret|hide|debt|lie)\b/.test(s)) return "SECRET";
  if (/\b(room|street|town|home)\b/.test(s)) return "PLACE";
  if (/\b(friend|family)\b/.test(s)) return "PEOPLE";
  return "PEOPLE";
}
export function bootstrapPath1(seed) {
  const text = String(seed || "");
  const cap = (text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\b/) || [])[0] || "[CHARACTER NAME]";
  const age = (text.match(/\b\d+\b/) || [])[0] || "";
  const sx = (text.match(/\b(woman|man|female|male)\b/i) || [])[0] || "";
  const places = [...new Set([...text.matchAll(/\b(?:at|in|near)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/g)].map((m) => m[1]))];
  return {
    Name: cap, "Character age, sex, gender": [age, sx, sx].filter(Boolean).join(", "),
    "Character description": text.slice(0, 400) || "[DESCRIPTION]",
    "World setting": places.length ? places.join("; ") : "[PLACE-A]",
    "Relationship to player": "Standing: civil",
    "Character past history": "NOT YET: none",
    seedTheme: seedThemeFrom(text),
  };
}
export function parseLabeledLines(reply, labels) {
  const out = {};
  for (const line of String(reply || "").split("\n")) {
    for (const label of labels) {
      if (line.startsWith(label)) out[label] = line.slice(label.length).trim();
    }
  }
  return out;
}

// ---------- voice (§2.3.5, script-side, zero calls) ----------
export function extrapolateVoice(bio) {
  const desc = bio["Character description"] || "";
  const manner = desc.split(/[.,;]/)[0].split(/\s+/).filter((w) => /[a-z]/i.test(w)).slice(-3).join(" ") || "[MANNER]";
  return {
    Tone: manner, Cadence: "[TURN LENGTH]; [BEAT INSTEAD OF TAGS]",
    Moves: ["[WORK-VERB] before explaining", "[CARE-VERB] while listening"],
    Banned: ["never [LECTURE-VERB]"],
    Want: "[STATED WANT]", "Deeper hope": "[UNSTATED HOPE]",
    "Register toward player": bio["Relationship to player"] || "civil",
    Unsaid: "withheld until a SECRET beat names it",
  };
}

// ---------- builder (§2.5) ----------
export function pickDriver(tally, bio) {
  // A named someone is player-led; a bare topic repeat (or nothing nameable)
  // is character-led with the bio supplying faces (§2.5.1).
  if (tally.names.length > 0) return "player-led";
  return "character-led";
}
export function buildBeats(theme, driver, hint = {}, long = false) {
  const table = long ? BEAT_TABLE_LONG : BEAT_TABLE;
  const ids = table[theme][driver];
  return ids.map((id) => ({
    id, done: false,
    job: id === "report" ? "close honestly: name what was heard, promise the next step"
      : id === "check-in" ? `greet in voice at ${hint.anchor || "[PLACE-A]"} and learn what weighs`
      : id === "small-task" ? `do the small task in words with ${hint.face || "[PERSON-B]"}`
      : id === "problem" ? `ask what troubles ${hint.face || "[PERSON-B]"}, in own words`
      : id === "revisit" ? `revisit ${hint.anchor || "[PLACE-A]"}: what changed there`
      : id === "snag" ? `ask what got in the way of the task, in own words`
      : id === "follow-through" ? `see the small thing through in words at ${hint.anchor || "[PLACE-A]"}`
      : id === "deeper" ? `ask one step closer about ${hint.face || hint.topic || "it"}, in own words`
      : id === "kindness" ? `do one small kindness in words for ${hint.face || "[PERSON-B]"}`
      : id === "reassure" ? `promise to keep it close, without stating it outright`
      : `ask one careful question, weight-adjacent, never the secret outright`,
    hint: hint.face || hint.anchor ? { ...hint } : null,
  }));
}
// Rich driver = two or more grounded leads (repeated topic, matched name, bio name).
// Long build only when rich; thin material keeps the short core (§2.5.3).
export function isRichDriver(tally, bio) {
  let leads = 0;
  if (tally.topics.some((s, i) => tally.topics.indexOf(s) !== i)) leads += 1;
  if (tally.names.length > 0) leads += 1;
  const hist = bio && bio["Character past history"] ? String(bio["Character past history"]) : "";
  if (/\b[A-Z][a-z]+\b/.test(hist.replace(/NOT YET:\s*/g, "")) && !/^NOT YET:\s*none/i.test(hist.trim())) leads += 1;
  return leads >= 2;
}
export function buildArc({ theme, tally, bio, now = Date.now() }) {
  const driver = pickDriver(tally, bio);
  const hint = {
    anchor: (bio["World setting"] || "").split(/[;.]/)[0].trim() || "[PLACE-A]",
    face: tally.names[0] || "[PERSON-B]",
    topic: tally.topics[0] || null,
  };
  const origin = driver;
  const long = isRichDriver(tally, bio);
  return {
    id: `arc-${now}`, theme, themeHistory: [], origin, startedAt: now, stage: 0,
    beats: buildBeats(theme, driver, hint, long), twist: null,
    notes: { why: `player mentioned ${hint.topic || hint.face} twice` }, closedAt: null,
  };
}

// ---------- stepper (§2.1.5) ----------
// Host tracks exchanges spent on the current beat (0, 1, 2, ...) and resets the
// count whenever stepOnReply reports "advanced". Two quiet exchanges settle.
export function settleBeat(beat, playerText, exchangesOnBeat = 1) {
  const t = String(playerText || "").toLowerCase();
  if (REFUSAL_PHRASES.some((p) => wholeWord(t, p))) return "refused";
  if (beat.hint) {
    const vals = Object.values(beat.hint).filter((v) => typeof v === "string" && !v.startsWith("["));
    if (vals.some((v) => wholeWord(t, v.toLowerCase()))) return "settled";
  }
  if (exchangesOnBeat >= 2) return "settled";
  return "stay";
}
export function stepOnReply(record, playerText, exchangesOnBeat = 1) {
  const open = record.open;
  if (!open) return { event: "no-arc" };
  const current = open.beats[open.stage];
  const r = settleBeat(current, playerText, exchangesOnBeat);
  if (r === "refused") return { event: "refused" };
  if (r === "settled") { current.done = true; open.stage += 1; return { event: "advanced", stage: open.stage }; }
  return { event: "stay" };
}

// ---------- optional twist + theme change (§2.5.5) ----------
// The twist is never required: an arc that never earns one runs straight to the
// report and closes complete. Returns null (no twist) unless the source arrives
// at stage 1 or 2; never twists the report beat itself.
export function maybeTwist(record, playerLead = null, voicePull = null) {
  const open = record.open;
  if (!open || open.twist || open.stage < 1 || open.stage > 2) return null;
  if (open.beats[open.stage] && open.beats[open.stage].id === "report") return null; // never twist the report itself
  const charLed = open.origin === "character-led";
  const hint = charLed && playerLead ? { ...playerLead, assumed: !playerLead.verbatim }
    : !charLed && voicePull ? { ...voicePull, assumed: false } : null;
  if (!hint) return null; // no source, no twist: the arc runs straight and stays complete
  const beat = {
    id: "twist-face", done: false,
    job: hint && hint.theme && hint.theme !== open.theme
      ? `turn toward ${hint.theme.toLowerCase()}: a new face enters in words`
      : "a new face enters in words",
    hint,
  };
  if (hint && hint.theme && hint.theme !== open.theme) {
    open.themeHistory.push(open.theme);
    open.theme = hint.theme; // one theme change per arc: twist consumes it
    open.twist = { themeChanged: true };
  } else {
    open.twist = { themeChanged: false };
  }
  open.beats.push(beat); // appended at next unstarted index, stage untouched
  if (open.beats.length > DEFAULTS.MAX_BEATS) {
    open.beats.splice(open.beats.length - 2, 1); // keep report last, drop the middle
  }
  return beat;
}

// ---------- report + close (§2.1.6) ----------
export function composeReport(theme, { address = "[ADDRESS]", heard = "[WHAT WAS HEARD]", anchor = "[PLACE-A]" } = {}) {
  const fn = REPORT_VARIANTS[theme] || REPORT_VARIANTS.PEOPLE;
  return fn(address, heard, anchor);
}
export function closeArc(record, { outcome = "done", now = Date.now(), cooldownMs = DEFAULTS.COOLDOWN_MS } = {}) {
  const open = record.open;
  if (!open) return null;
  open.closedAt = now;
  record.past.push({ id: open.id, theme: open.theme, origin: open.origin, outcome, closedAt: now });
  if (record.past.length > DEFAULTS.PAST_CAP) record.past.splice(0, record.past.length - DEFAULTS.PAST_CAP);
  record.open = null;
  record.cooldownUntil = now + cooldownMs;
  record.tally = { exchanges: 0, topics: [], names: [] }; // tally resets; lifetime never does
  return record.past[record.past.length - 1];
}

// ---------- memory (§2.3.8) ----------
export function captureMemory({ text, beatId, arcId, at = Date.now(), assumed = false, confirmed = false }) {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean);
  if (!words.length || words.length > DEFAULTS.MEMORY_WORDS) return null;
  if (assumed && !confirmed) return { pending: true, text: words.join(" ") }; // spoken, not stored
  return { text: words.join(" "), beatId, arcId, at };
}
export function storeMemory(memBlob, entry) {
  if (!entry || entry.pending) return false;
  if (memBlob.items.some((m) => m.text === entry.text)) return false;
  memBlob.items.push(entry);
  while (memBlob.items.length > DEFAULTS.MEMORY_CAP) memBlob.items.shift();
  memBlob.updatedAt = entry.at;
  return true;
}
export function recallMemories(memBlob, { anchor = null, face = null, n = DEFAULTS.MEMORY_RECALL } = {}) {
  const scored = memBlob.items.map((m) => ({
    m, s: (anchor && m.text.includes(anchor) ? 2 : 0) + (face && m.text.includes(face) ? 2 : 0),
  }));
  scored.sort((a, b) => b.s - a.s || b.m.at - a.m.at);
  return scored.slice(0, n).map(({ m }) => m.text.slice(0, 160));
}

// ---------- prompt assembly (§§2.1.8/2.6/2.6.1/2.6.2) ----------
function fit(lines, cap) {
  const out = [];
  let n = 0;
  for (const line of lines) {
    if (!line) continue;
    if (n + line.length + 1 > cap) break;
    out.push(line); n += line.length + 1;
  }
  return out;
}
export function buildContext({ voice, settingLines = [], bioTies = [], historyLine = "", memoryLines = [], rumorLines = [], placeLine = "", beatJob = "", whyLine = "", customLines = [], logTail = [] } = {}) {
  const v = voice || {};
  const sysLines = [
    `Tone: ${v.Tone || ""}`, `Cadence: ${v.Cadence || ""}`, `Register: ${v["Register toward player"] || ""}`,
    `Moves: ${(v.Moves || []).slice(0, 2).join("; ")}`, `Banned: ${(v.Banned || []).slice(0, 2).join("; ")}`,
    ...settingLines.slice(0, 2),
  ];
  const system = fit(sysLines, DEFAULTS.SYSTEM_CAP).join("\n");
  const knowledge = fit(
    [...bioTies.slice(0, 2), historyLine, ...memoryLines.slice(0, 3),
     ...rumorLines.slice(0, 3), placeLine, ...customLines.slice(0, 4),
     beatJob ? `Current beat: ${beatJob}` : "", whyLine ? `Why: ${whyLine}` : ""],
    DEFAULTS.KNOWLEDGE_CAP).join("\n");
  return { system, knowledge, logTail: logTail.slice(-10) };
}
