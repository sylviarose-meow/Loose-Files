[PORTABLE-ARC-SPEC.md](https://github.com/user-attachments/files/34100837/PORTABLE-ARC-SPEC.md)
# Roleplay story arcs for chatbots — spec (v0.26 tier climb, scaffolding hygiene, 2026-10-28)

## About this spec (plain language, translation-friendly)

1. This spec builds short story arcs for a simple chatbot.
2. It uses one character file, one world seed, one chat log, and one model.
3. It asks the integrator to provide six character fields, one world paragraph, and JSON storage.
4. It asks the script to decide eligibility, readiness, beats, twist, close, and memory.
5. It asks the model only for narrow answers with a strict first line.
6. It keeps every answer in storage. It never asks the same question twice.
7. It fits prompts by type inside 1200 plus 1000 character caps.

Status: v0.26 tier climb, scaffolding hygiene — `closenessTier` takes the higher of the standing word (floor) and the `record.lifetime` count so talk always climbs and no default word can lock arcs out; new §2.1.11 keeps strict first lines out of visible chat; reference implementation at `./arc-machine.js` (pure ESM, zero deps); blank-generator run-through green (seed theme, ask, step, long build, twist + theme change, assumed-spoken-not-stored, memory recall, budgets, no-twist close, tier climb, strip); spec mirrors the report-beat twist guard.

## 0. Problem

A clean chatbot project has one character file, one world file, a chat log, and a model. No map, no diary UI, no fixed identity cards, no inventory. This spec keeps one load-bearing idea: the script owns eligibility, construction, advancement, and closing; the model owns a few narrow wants, each with a strict first-line contract and a script fallback. Once the model answers, the answer is written to a record and never re-asked. That record is the stability.

## 1. Non-goals

- No map graph, no travel times, no hidden nodes. Places are names in lore, never routable ids.
- No diary UI, no tracker, no map markers. The arc's visible state is one short card or list in chat plus the record.
- No fixed identity cards, no numeric ids, no inventory shelf. People are names the character knows; things are words, never item ids.
- No numeric favor, no money, no skill gates unless the host project adds them later. Closeness is a coarse tier the script reads, never a score the model sets.

## 2. Sections (each one component; flesh one before opening the next)

### 2.1 Generalized machinery (fleshed through v0.4, reconciled v0.13 — integrates on a bare chatbot)

A bare host is assumed: it can send a system-plus-user prompt to a model and get text back, read and write one JSON object per character, append messages to a chat log, and read the wall clock. Nothing else is required. All names below are plain object keys; adapt the spelling to the host.

#### 2.1.1 Record shape

One record per character, stored under a key like `arcs.<characterId>`:

```json
{
  "askedAt": 0,
  "cooldownUntil": 0,
  "lifetime": 0,
  "tally": {"exchanges": 0, "topics": [], "names": []},
  "open": null,
  "past": []
}
```

`open` is null when no arc runs, else:

```json
{
  "id": "arc-1",
  "theme": "people",
  "themeHistory": [],
  "origin": "player-led",
  "startedAt": 1720000000000,
  "stage": 0,
  "beats": [
    {"id": "meet", "job": "greet the player in character and learn what weighs on them", "done": false},
    {"id": "problem", "job": "ask what is wrong, in own words", "done": false},
    {"id": "report", "job": "close honestly: name what was heard, promise the next step", "done": false}
  ],
  "twist": null,
  "notes": {"why": "player mentioned [TOPIC] twice"},
  "closedAt": null
}
```

Rules: the record is the truth. The model is never re-asked once `open` exists; reload rebuilds from this JSON alone. `past` holds closed arcs capped at 10 entries (id, theme, origin, outcome, closedAt). `tally` accumulates per §2.1.10 while no arc is open and resets into `notes.why` at build; `lifetime` counts every committed player message and never resets, and feeds `closenessTier` per §2.1.2. `origin` stamps the §2.5.1 driver and decides the §2.5.5 twist direction; `theme` is mutable (opening theme from the ask, changed at most once per arc at the twist — see §2.5.5) with prior values kept in `themeHistory`; `twist` holds the inserted beat or stays null. Bio plus voice plus settings blobs live beside this record under §2.3.7 keys and reload the same way. No other fields are required at v0.

#### 2.1.2 Eligibility gate

A pure function, no model call, checked at most once per conversation open:

```
eligible(character, record, now):
  if open != null → no ("busy")
  if closenessTier(character) < "warm" → no ("distant")
  if now < cooldownUntil → no ("cooldown")
  else yes
```

`closenessTier` is host-defined and coarse: `stranger / civil / warm / close`. Default implementation the blank generator can ship: read the standing word from `Relationship to player` as the floor, and count lifetime exchanged messages for the character from `record.lifetime`: 0-7 stranger, 8-19 civil, 20+ warm. Take the higher of the two; an explicit friend flag upgrades warm to close. Talk only climbs: a civil default can never lock a character out, and an authored word is never dragged down by a quiet week. Existing records start `lifetime` at 0 and re-earn it through talk. Never read model output. Constants to tune in one place: `WARM_AT = 20`, `READY_AT = 8`, `COOLDOWN_MS = 7 days` (shorten all three for testing; one host runs `READY_AT = 4` so an arc can surface inside a normal first conversation). Check order per conversation open: busy, then tier, then cooldown, then readiness.

#### 2.1.3 The ask (one judgment, one call)

When eligible, send exactly one narrow prompt in the character's voice. Full shape the blank generator can copy: `system` plus `knowledge` (current slices, no arc facts yet) plus `logTail` (last 6) plus this task block, then the contract tail:

```
Your first line must be exactly YES <theme> or NO, nothing before it.
Theme is one word: WORK, PEOPLE, PLACE, or SECRET.
```

Parse: `^YES\s+(WORK|PEOPLE|PLACE|SECRET)` (case-insensitive) counts as yes with that theme, defaulting an unknown or missing word to the bio `seedTheme` (else PEOPLE). Anything else — including NO, blank, or prose — counts as no. On no: set `cooldownUntil = now + cooldown`, write the record, spend nothing else. On yes: build the beats below and set `open`. One retry on unparseable output is allowed, then accept the no. This is the only model decision the arc ever depends on.

#### 2.1.4 Compiler (theme plus one line of context turns into beats; full builder in §2.5)

Core mapping, no second model call. The fleshed builder in §2.5.3 extends this table to a short core (2 content beats plus report) on thin material or a long build (4 content beats plus report) on rich material, with an optional §2.5.5 twist that fires only when earned, without changing the shape:

- WORK → meet, small-task-in-words, report
- PEOPLE → meet, problem, report
- PLACE → meet, revisit-a-place-in-words, report
- SECRET → meet, careful-question, report

Each beat carries: `id` (stable), `job` (one line telling the model what this turn must accomplish, player-facing text is written later), and an optional `hint` (preferred verbatim from the character or world file; an assumed name or place is allowed but must be marked `[assumed]` and confirmed by the player before it persists — see §2.5.3). The report beat is always last and always present: it is the weak fallback the arc closes on if anything fails downstream.

#### 2.1.5 Beat stepper

Only the current beat plus the report are live; future beats are appended at most one ahead, never rewritten wholesale:

```
onPlayerReply(text):
  current = open.beats[open.stage]
  if current settles(text, record): mark done, stage += 1, persist, announce next beat in chat
  else: stay, continue the same job next turn
```

`settles` is script logic, never a model verdict: a keyword, a turn count (e.g. 2 exchanges), or an explicit player choice. Cap total beats at 8 including any twist; when the cap is reached, jump the report forward. Kill switch plus concurrency (local cap equivalent): `ARCS_ENABLED = true` gates the whole machine, and one open arc per character is the entire concurrency budget (`open != null` means busy, no queue). When a beat cannot ground (missing name, empty hint, failed lookup), delete it and let the waiting report stand — the arc closes shorter but honest. This is the standing rule.

#### 2.1.6 Report, close, refuse

Report: the character speaks one closing message composed from stored fields only. Blank-generator template: `[ADDRESS], [WHAT WAS HEARD IN OWN WORDS]. [PROMISE OF NEXT STEP AT ANCHOR].` Theme variants (pick by arc theme, same shape): WORK → promise the next step of the task; PEOPLE → name what was heard about the person; PLACE → promise a return to the anchor; SECRET → acknowledge the weight without stating it. Then: `open.closedAt = now`, move it to `past`, set `open = null`, set `cooldownUntil`, persist. Optional v0 reward is one stored line (a memory, a changed bio fact, a promised return) — never currency or items unless the host has them.

Refuse: the player can always say no, deflect, or walk away. Any refusal marks the current beat refused, closes the arc with `outcome: "refused"`, writes one in-character acknowledgment, and sets the cooldown. No nag, no re-ask, no penalty beyond the cooldown.

#### 2.1.7 Minimal host hooks (copy these five)

1. `getRecord(characterId)` / `saveRecord(characterId, record)` — JSON read/write over these exact keys: `arcs.<characterId>`, `meta.<characterId>.bio`, `meta.<characterId>.settings`, `meta.<characterId>.memories`, `meta.<characterId>.types`, `meta.<characterId>.tables.[name]`, plus `meta.shared.<keyword>` and `meta.world` only in modes 3-4, plus the single constant `meta.settingsMode` (1-4).
2. `checkEligible(character)` — §2.1.2, called once per conversation open, silent when no.
3. `askOnce(character)` — §2.1.3, exactly one model call plus optional retry, writes the record either way.
4. `stepOnReply(character, playerText)` — §2.1.5, called after each committed player message while `open` exists.
5. `closeArc(character, outcome)` — §2.1.6, files the close line and clears `open`.

Reload path: on boot, read every stored record; any `open` with beats resumes at its stored `stage` with no model call. That is the whole integration. Reference implementation ships with this spec at `src/arc-machine.js` (pure ESM, zero dependencies): a blank generator copies that file and wires the five hooks to it.

#### 2.1.8 Context constructor (how bios reach the model)

Blind-read gap closed: §2.1 named the character file but never said how it enters a turn. The constructor is one pure function called before every model call, chat or judgment:

```
buildContext(character, world, record, logTail) → { system, knowledge, task }
```

- `system`: voice plus setting only. Built from the character file's register lines and the world file's setting (up to two paragraphs). No record terms, no beat ids, no ledger words. Capped at roughly 1200 characters; the voice lines win over setting when trimming.
- `knowledge`: read-only facts the character may act on, pulled by type per §2.6.1 (never everything at once). Never includes closeness math, cooldowns, stage numbers, or past-arc ids. Capped at roughly 1000 characters; drop world lines before character lines.
- `task`: the beat's job for this turn plus, only on judgment turns, the strict first-line contract. One or two sentences, never lore.
- `logTail`: the last 6–10 messages verbatim, unedited. The constructor never summarizes or rewrites it; budget is enforced by count, not by model call.

Leak rule: if a word appears only in the record (stage, cooldown, outcome, tier), it must not appear in `system` or `knowledge`. The reason for an arc rides `task` on judgment turns only and never reaches the visible card.

#### 2.1.9 Steering with text entry only (no buttons)

Blind-read gap closed: the host has no pickers, only a text box, so steering must be invisible and refusal must stay real.

- Every ordinary reply sends `system + knowledge + task(current beat job)` and renders only the model's chat text. No system line, no beat label, no progress marker is ever shown.
- The beat job constrains the model's next move (ask one question, name one thing, close in two sentences) but never constrains the player. The player answers in free text.
- Settling reads the player's free text with script rules only: an explicit choice phrase ("no", "not now", "drop it" → refusal path), a named entity the beat waited on, or a turn count (default: advance after 2–3 exchanges on the same beat even with no keyword, so a quiet player still moves). No model verdict decides advancement.
- Beat transitions are announced in character, never as chrome: one closing line for the old beat plus one opening line for the new, both written from the beat jobs. The player is always offered an out in plain words ("say the word and we drop it") so a text-only no has somewhere to land.

#### 2.1.10 Readiness (when there is enough to build from)

Blind-read gap closed: eligibility said who may ask but not when the scene has earned it. Keep a tiny accumulation ledger inside the record, updated on every player message while no arc is open:

```json
"tally": {"exchanges": 0, "topics": [], "names": []}
```

- `exchanges`: count of committed player messages this conversation.
- `topics`: matched keyword stems from the player's own words, one push per message, so a repeat is the same stem twice. Default seed list the blank generator can ship (10 stems, whole-word, case-insensitive): work, shift, money, family, friend, home, place, night, help, worry. Hosts replace with their own 10-20 stems; matching stays whole-word, preferred verbatim from stored fields or the player's own words; an assumed topic or name is allowed when nothing exact matches, marked `[assumed]`, and never persisted until the player confirms it (repeats it or says yes). Stop words are never topics (skip: today, tomorrow, yesterday, morning, evening, night used as time-only, now, later, here, there, this, that — plus plurals). On a repeated topic, the compiler prefers quote-matching the player's own phrase as the hint (local Q3 equivalent); an assumed paraphrase is allowed as second choice; if neither grounds, fall back to the second-most-repeated topic or name (second-pick rule) before narrowing to report.
- `names`: capitalized phrases the player typed that match the character or world file (whole-word, preferred verbatim copy). An assumed name the model proposes is allowed as a hint when no stored name matches, marked `[assumed]`; it is spoken once and only persisted to memory or settings after the player confirms it.

The ask fires only when eligible (§2.1.2) plus ready: `exchanges >= READY_AT` and at least one topic repeated or one name matched. Constants to tune in one place: `READY_AT = 8`, `ASK_CHANCE = 1.0` (local arcs roll 50/50 after a filed rumor; the portable default asks every time it is ready — lower toward 0.5 if arcs feel spammy). In-flight guard: `open != null` already blocks a second arc; never queue. That is the "enough to build from" gate. The compiler (§2.1.4) then uses the tally, not a new call: the repeated topic picks the theme, the matched name becomes the beat hint, and the tally resets into `notes.why` as one plain line ("player mentioned [TOPIC] twice"). A scene that never reaches readiness simply never asks — silence, no call, nothing stored but the tally.

#### 2.1.11 Scaffolding never renders

Strict first lines are scaffolding (`YES <theme>`, `Beat <id>:`, `Label:`, `MEMORY:` / `NONE`). The player never sees them:

- Judgment-only calls (the ask, bootstrap fills, voice assists, table rolls) are separate model calls whose replies render nothing. The player sees a typing indicator or nothing that turn.
- Parse first, render second: match the contract pattern, act on it, remove that line, then render the remainder.
- If a host combines judgment plus chat in one call, the contract first line must be stripped before rendering. If nothing remains after stripping, render nothing that turn; staying silent beats leaking scaffolding.
- Never loosen a contract to suit the renderer ("nothing before it" stays). Fix the renderer, not the parser.

### 2.2 Basic premise (overview certified v0.13 — written last per the rule below)

The loop in five lines:

1. Eligible plus ready: no open arc, standing at warm or better, cooldown passed, and the tally shows enough (8 exchanges plus a repeat or a name).
2. Ask once: one narrow judgment in voice with a strict first-line contract; no means cooldown and stop.
3. Record truth: YES builds a short core (2 content beats plus report) or a long build (4 content plus report) from stored fields, stamps the origin, opens on the YES theme (or the bio `seedTheme` when the answer names nothing usable); reload rebuilds from that JSON with zero calls.
4. Beats, twist only if earned: step on each player reply by script rules; an arc that never earns its twist runs straight to the report and is complete, never failed. At most one twist per arc, at stage 1 or 2, at most one theme change (old theme kept in `themeHistory`), never rewrite past beats.
5. Report and close: one honest closing from stored fields, file at most one memory line into the blobs, clear open, set cooldown.

Script owns eligibility, readiness, construction, stepping, twisting, closing, persistence, and every fallback. The model owns narrowly worded wants under strict first-line contracts: the YES theme, bootstrap field lines, optional beat wording. Every model answer is parsed and persisted once, never re-asked. A beat that cannot ground narrows the arc, never breaks it.

Stability is the record plus the blobs: one arc object plus tally plus bio plus voice plus settings, all plain JSON outside the chat context. The model never overwrites them; close-out appends one verbatim line. That is why a reload, a mode change, or a missing name still runs shorter but honest.

Build rule used (kept for the record): per component, draft against its stub, blind-read for why plus plants plus text-entry fit, fill in place with a version bump, certify only when the worked example builds within budget from stored fields alone, reloads with zero calls, and narrows honestly. §§2.3–2.6 certified v0.13; §2.1 reconciled to match them; this overview written last is the finished-spec gate.

### 2.3 Character bio and voice (fleshed through v0.10, certified v0.13)

Use this default at first boot so the constructor has something to read. Replace it at integration time with fields suited to the host project. The integrator's own template wins; the default below is only the fallback that keeps §2.1.8 fed.

#### 2.3.1 Default template (copy verbatim, then suit to project)

```markdown
Name:
Character age, sex, gender:
Character description:
World setting:
Relationship to player:
Character past history:
```

Field rules:

- `Name:` one display name plus optional aliases in parentheses. This is the only identifier the script ever matches on. No ids, no numeric keys.
- `Character age, sex, gender:` three short facts on one line, plain words. Keep each to a few words so trimming never splits meaning. Anything the character must not state outright goes in §2.3.3 instead.
- `Character description:` 2-10 sentences. Looks, register, manner, what they do for work, habits, speech quirks. This is the main voice source for `system`.
- `World setting:` up to two paragraphs, places as prose names only. No map, no routes. This is the main setting source for `system` and the place-line source for `knowledge`.
- `Relationship to player:` one or two sentences. What they call the player, how they know them, current standing in words (stranger, civil, warm, close). The script reads the standing word for `closenessTier`; the model never sets it.
- `Character past history:` 3–8 plain lines. What shaped them, who they know by name, what they must not reveal yet. Names here become legal beat hints; nothing outside this file may be used as a hint.

Budgets: whole file should read in under 4 minutes and build under the §2.1.8 caps (voice plus setting into ~1200 characters of `system`; facts plus ties into the character slice of ~1000 characters of `knowledge`). When over budget, cut setting second paragraph first, then history, description last.

#### 2.3.2 Own-at-integration rule

At integration time the host author is encouraged to define their own template suited to the project (extra fields for occupation, speech examples, taboos, languages, memory lines). Rules for any custom template:

1. Keep the six default fields as the minimum. Add, never remove; the constructor in §2.1.8 depends on finding them by name.
2. Name new fields in plain words and state which constructor block they feed (`system` voice, `system` setting, or `knowledge` facts). Unmarked fields are ignored by the script.
3. Keep structured lines machine-readable and prose blocks human-readable. One fact per line for anything the script matches on (names, standing, places); free sentences for voice and history.
4. Record the project's template in one place with one filled example before any arc runs. The example is the contract test: if the constructor cannot build `system` plus `knowledge` from the example within budget, the template is too big.

Plain markdown versus structured fields is settled here: structured lines for the header facts, markdown prose for the rest. The file stays a single human-editable document.

#### 2.3.3 What they must never say yet

Any secret, surprise, or withheld name lives only in `Character past history` marked with a leading `NOT YET:` tag. The constructor strips `NOT YET:` lines from `knowledge` until a beat job explicitly names them as the hint. This keeps the voice card out of leaks: the model's chat text can only speak what the constructor dealt it.

The player's suggested replies (if the host shows any) are built from the last model line only, never from the bio file. The voice card stays prompt-side only.

#### 2.3.4 Worked shape (placeholders only, never a named character)

```markdown
Name: [CHARACTER NAME] ([ALIAS])
Character age, sex, gender: [AGE], [SEX], [GENDER]
Character description: [2-5 sentences: build, manner words, work, one habit]
World setting: [SETTING LINE with two or three named places: PLACE-A, PLACE-B]
Relationship to player: [HOW THEY KNOW THE PLAYER]; calls the player [ADDRESS]. Standing: [STRANGER/CIVIL/WARM/CLOSE].
Character past history:
- [PAST LINE with a named shaper]
- [KNOWS PERSON-B at PLACE-A and PERSON-C at PLACE-B]
- NOT YET: [WITHHELD FACT, named only when a beat calls for it]
- [OWES THE PLAYER ONE CONCRETE COVER, never repaid]
```

No proper noun in this shape may leak into implementation. Copy the bracket labels, never a filled value.

#### 2.3.5 Voice template (extrapolated from the bio)

Voice is derived, not authored from scratch. Fill the bio first, then extrapolate the voice from it in one pass. At integration time the author may replace the wording to suit the project, but the seven lines below stay: they are what the constructor in §2.1.8 reads for `system`.

```markdown
Voice for <Name>:
Tone:
Cadence:
Moves (pick 2-3):
Banned (pick 2):
Want (surface):
Deeper hope:
Register toward player:
Unsaid:
```

Extrapolation rules (bio → voice, no model call):

- `Tone:` compress `Character description` manner words into 2-4 adjectives. Copy the words, do not invent new ones. Shape only, never a filled value.
- `Cadence:` read the work and habit for rhythm. State it as a sentence limit plus a break rule. Shape only, never a filled value.
- `Moves (pick 2-3):` observable habits from description plus history. Each move is a verb the hands do while the mouth talks. No more than three; the model may only play these. Shape only.
- `Banned (pick 2):` two things this mouth never does. Derive one from description and one from history. Shape only; the latch list in the host project may add global bans on top.
- `Want (surface):` what the character would state plainly if asked. Lift it from work plus relationship. Shape only.
- `Deeper hope:` what they would not state unless pressed. Lift it from history, one clause. Shape only. This never enters chat text directly; it steers the ask theme and the closing line only.
- `Register toward player:` copy the address and standing from `Relationship to player`. Shape only. This is the only register the voice carries; boss versus stranger variants only exist if the project adds them.
- `Unsaid:` copy the `NOT YET:` lines by reference. Shape only. The constructor withholds these exactly as in §2.3.3.

Worked shape from §2.3.4 (placeholders only):

```markdown
Voice for [CHARACTER NAME]:
Tone: [MANNER-1], [MANNER-2], [MANNER-3]
Cadence: [TURN LENGTH]; [BEAT INSTEAD OF TAGS]; one longer turn only when the feeling needs it
Moves: [WORK-VERB] before explaining; [CARE-VERB] while listening; states the price or the favor once and lets it stand
Banned: never [LECTURE-VERB]; never spends [WITHHELD NAME] unasked
Want: [SHIFT COVERED] and [OWED COVER REPAID]
Deeper hope: [STOP OWING] plus [STILL BE KEPT ON]
Register toward player: [WARMTH WORDS]; calls the player [ADDRESS]
Unsaid: [WITHHELD FACT], until a SECRET beat names it
```

Constructor read: `Tone` plus `Cadence` plus `Register` build `system` (capped ~400 characters of the §2.1.8 voice budget); `Moves` plus `Banned` ride as two short constraint lines in `system`; `Want` plus `Deeper hope` never enter `system` as speech — they enter `task` only as the beat's direction, so the mouth stays plain while the steering stays aimed. If the author's own template adds fields (speech examples, taboos, languages), mark each as voice, fact, or steer at authoring time per §2.3.2, or the constructor ignores it.

#### 2.3.6 Bootstrap fill (yes, the bare host can do this)

Filling happens once per character, at creation, before the first player-visible reply. Never during an arc. The result is stored as two text blobs beside the arc record and never re-asked. Three paths, easiest first. All three use only what §2.1 already assumes: one model call shape plus one JSON write.

Path 1 — direct from the seed, zero model calls. In most cases this is enough. The script maps it by rules in this order: first capitalized phrase becomes `Name` (else `[CHARACTER NAME]`); `\d+` becomes age (else blank); first of woman/man/female/male becomes sex and gender (else blank); capitalized place phrases become `World setting` (else `[PLACE-A]`); address plus standing word become `Relationship to player` (else `Standing: civil`); the rest becomes description plus history (else `NOT YET: none`). Seed theme: scan the seed for work words (shift, job, task, boss → WORK), people words (friend, family, names → PEOPLE), place words (room, street, town, home → PLACE), or secret words (secret, hide, debt, lie → SECRET); first match wins, else PEOPLE. Store it as `seedTheme` in the bio blob; it is the default opening theme until an ask answers otherwise.

Path 2 — one-shot model fill, one call plus one retry. When the seed is a paragraph and Path 1 leaves blanks, send the seed plus the blank six-field template with a strict line contract in the tail: each reply line must start `Name:` or `Character age, sex, gender:` and so on, nothing before the label. Parse on `^Label:` per line; missing or malformed lines keep their Path 1 value. One retry on total failure, then accept the blanks as defaults. This is the same contract shape as the §2.1.3 ask, so a host that can ask can fill.

Path 3 — one field at a time, up to six calls, all before the first reply. When the model is weak or the seed is nearly empty, ask one narrow question per blank field (`Reply with one line starting "Want:" then the surface want in ten words or fewer`), parse the same way, store, continue to the next blank. The player sees a typing indicator, never the fill prompts. Cap at six calls, then stop; whatever is still blank takes the default. Never interleave with chat: all fill calls finish before the greeting sends.

Voice costs zero calls either way. Once the bio blob is stored, §2.3.5 extrapolates it by rules on the script side. Total creation budget: zero calls in the common case, one call plus retry in the normal case, six calls worst case, then never again. That is within a very basic chatbot: same prompt shape, same parse-or-fallback habit, same JSON write it already does for arcs.

#### 2.3.7 Persistence (local metadata plus one integration question)

Character data lives outside the chat context as local metadata. Two blobs per character, both plain JSON the bare host already reads and writes:

```json
"meta.<characterId>.bio": {"text": "<six fields>", "voice": "<seven lines>", "seedTheme": "PEOPLE", "updatedAt": 1720000000000},
"meta.<characterId>.settings": {"anchors": [], "faces": [], "weights": [], "updatedAt": 1720000000000}
```

- The bio blob is written once at bootstrap (§2.3.6) and touched only by close-out (§2.1.6): at most one stored line per closed arc (a memory, a changed bio fact, a promised return). The model never overwrites it; the script appends or edits one line, preferred verbatim from stored fields, with an assumed line kept only after the player confirms it.
- The settings blob is the developing persistent setting. It collects the hallmarks each arc actually used (anchor place phrase, faces named, weight line closed on), preferred verbatim with an assumed line kept only after player confirmation, capped at 10 anchors plus 20 faces plus 10 weights with oldest-first pruning. The constructor deals from it before the bio when both hold the same name, so lived places win over authored ones. Nothing here is lore recital: at most one anchor plus two faces plus one weight line per turn per §2.5.2.
- Both blobs reload from storage on boot with zero model calls. If storage is missing or corrupt, rebuild from the bio defaults and start empty settings; the arc still runs shorter but honest.

At integration time ask the user exactly this, one choice, stored as a constant:

```
Should settings persist across sessions?
1 = cleared at new sessions (nothing stored, fresh settings each talk)
2 = locked to the character (this character keeps its own settings across sessions)
3 = shared by keyword (characters matching the same place or name word share that entry)
4 = one shared expanding world (all characters read and grow a single world blob)
```

- Mode 1 cleared: keep the settings blob in memory only, drop it on session end. Bio blob still persists per character.
- Mode 2 locked: read and write only `meta.<characterId>.settings`. Simple default; pick this unless the user asks for more.
- Mode 3 keyword-shared: keep the character blob, plus read and write `meta.shared.<keyword>` where keyword is the lowercase anchor or face stem (shape: `meta.shared.<keyword>`). On match, merge the shared entry into `knowledge` after the character's own lines. Writes append verbatim with origin tag and the same caps; never overwrite another character's line.
- Mode 4 shared world: keep the character blobs, plus one `meta.world` blob all characters read. Writes append with `by: <characterId>` and wall time, capped the same way with oldest-first pruning. One writer at a time per the host's existing JSON write; on conflict the later write appends, never replaces. The world only grows through close-out lines, never through live model prose.

Record the answer in `meta.settingsMode` before any arc runs; changing modes later keeps the blobs already written and only changes which keys the constructor reads.

#### 2.3.8 Character memory beyond context (key points stored as local metadata)

A third blob per character holds what the character remembers across sessions. It is the only store allowed to carry forward player-specific facts beyond the log tail:

```json
"meta.<characterId>.memories": {"items": [{"text": "[ONE CONCRETE FACT]", "beatId": "[BEAT]", "arcId": "arc-1", "at": 1720000000000}], "updatedAt": 1720000000000}
```

Rules the blank generator can ship:

- Capture at most one line per settled beat plus one line at close-out, each 20 words max, preferred verbatim from stored fields or the player's own words; an assumed line is allowed once marked `[assumed]` and is spoken but not stored until the player confirms it. Room for a few hours of chatting: several arcs of 5-6 lines each accumulate without pruning mid-evening. Never a feelings summary, never a whole turn. Zero-call default: the script copies the settle keyword or name plus the beat id (shape: `[PERSON-B] needs [TASK] at [PLACE-A]`). Optional assist: one judgment per beat with the strict first line `MEMORY: <one line>` or `NONE`; parse on `^MEMORY:` or `^NONE`, one retry, then keep the script line.
- Store preferred verbatim, dedupe on exact text (assumed lines kept only after player confirmation), cap 60 items with oldest-first pruning (about a few hours of chatting across several arcs). The model never edits or deletes; the script appends only.
- Recall: the constructor deals at most 3 memories into `knowledge` as character facts, picked by anchor or face match first then recency, each trimmed to about 160 characters and counted inside the 1000 cap. Withheld `NOT YET` facts never enter memories until a beat names them.
- Scope: always tied to the character key. Mode 1 keeps memories in memory only for the session; modes 2-4 persist them per character across sessions. Shared and world blobs never receive memories.
- Reload rebuilds from JSON with zero calls; missing or corrupt store starts empty and the arc still runs.

### 2.4 World lore and setting (fleshed v0.11 — background metadata, governed by integration setting)

The world file is not authored up front. It is the metadata component the chatbot constructs in the background from play, handled per the §2.3.7 persistence answer. The integrator ships at most a seed; lived entries outrank seed lines from the first close-out on.

Seed shape (ship this, keep it tiny):

```markdown
Setting: up to two paragraphs, places as prose names only.
Rumors: 3–8 plain lines, each one overheard fact plus one voice. Optional trailing tag: [seed] (always dealable) or [reserve] (never deals unless a beat names it).
```

Background construction: every closed arc appends at most one anchor plus one face plus one weight line to the settings blob (§2.3.7), preferred verbatim from stored fields with assumed lines kept only after player confirmation, never from unconfirmed model prose. Prune oldest-first at 10 anchors plus 20 faces plus 10 weights. The single reader deals per turn at most 3 rumor lines plus the current place line into `knowledge`, seed first only until lived entries exist, then lived first. `[reserve]` lines stay withheld the same way `NOT YET` lines do (§2.3.3).

How the four integration modes change this component:

- Mode 1 cleared: seed only, rebuilt per session, reader deals seed lines.
- Mode 2 locked: character blob grows across sessions, reader prefers it over seed.
- Mode 3 keyword-shared: reader merges `meta.shared.<keyword>` after the character lines on keyword match.
- Mode 4 shared world: reader merges `meta.world` after the character lines for all characters; all writes carry origin tags and caps.

Authorship rule: the hand writes the seed; play writes the rest. No model call ever authors a stored line alone; model wording may voice a beat job, and an assumed line may be spoken once marked, but the stored line is always the script's copy — verbatim preferred, assumed kept only after the player confirms it. A setting that cannot build its per-turn slice within the §2.1.8 knowledge cap trims world lines before character lines.

### 2.5 Arc builder (fleshed through v0.9, certified v0.13 — same low-cost build as the bio fill)

The builder runs once per arc, right after the §2.1.3 ask answers YES. It uses only what the script already holds: the bio plus voice blobs (§2.3), the world-setting line, and the readiness tally (§2.1.10). No new host power. In the common case it spends zero model calls; the two fallback paths reuse the exact fill shapes from §2.3.6.

#### 2.5.1 Two drivers, one priority

- Player-led: the tally names someone, a matched name from the player's own words. This wins whenever present, because it grounds the arc in whom the player actually raised.
- Character-led: the tally gives only a repeated topic, or the bio holds unused names, places, or a `NOT YET` line. This carries the arc when the player has not named anyone: the topic (if any) sets the theme and the bio supplies the faces.

Priority: a player name beats a bio name; a repeated topic beats an unused hook; character-led facts fill whatever the lead leaves blank. Anything still blank takes a plain default (talk where they stand, about the work at hand). An arc never waits for a better lead; it builds from what exists and narrows per the standing rule.

#### 2.5.2 Three hallmarks assembled from character setting

With no location file and no world history, each arc carries three hallmarks extrapolated from the bio plus setting. Prefer verbatim copy; an assumed hallmark is allowed once marked `[assumed]` and kept only after player confirmation. Reservation order per turn (local seed-offering equivalent): anchor first, then faces, then weight; drop weight before faces before anchor when over budget. Empty-world path: with zero seed lines and zero lived entries, the arc still builds from bio plus tally alone (anchor falls back to `[PLACE-A]`, faces to the tally name or `[PERSON-B]`, weight to the close-out promise) and narrows per the standing rule.

- Anchor: one place phrase from `World setting` (shape: [PLACE-A]). Every beat's job names it so talk has somewhere to stand.
- Faces: one or two names from `Character past history` or the tally (shape: [PERSON-B], [PERSON-C], or the name the player just typed). Beats speak of people the character knows, not ids.
- Weight: one past line or one `NOT YET` line that gives stakes (shape: [OWED COVER], or [WITHHELD FACT] once a SECRET beat names it). The weight steers the middle beats and the closing line only; it is never recited as lore.

These three stand in for what a location plus history file would provide: somewhere, someone, something owed. The constructor in §2.1.8 deals at most one anchor plus two faces plus one weight line into `knowledge` per turn.

#### 2.5.3 Beat assembly (script only, short core or long build)

Map the opening theme plus the winning driver to beats. Fixed shapes, conversational moves for two people in one room. Grounding rule (local Q2 plus Q3 equivalent, relaxed): prefer the anchor hint matching a `World setting` phrase or lived anchor verbatim and the face or topic hint quoting the player's own repeated phrase verbatim; when nothing exact matches, an assumed anchor, face, or paraphrase is allowed, marked `[assumed]`, spoken once, and only persisted after player confirmation (repeat or yes). Withheld lines (`NOT YET`, `[reserve]`) stay strict and are never assumed.

Richness rule: count grounded leads (a repeated topic, a matched name, a bio history name). Two or more builds long; anything less builds short. Long arcs run on material, never on placeholders.

Short core (thin driver: at most one grounded lead):

- WORK, player-led on a task word → check-in (anchor named), small-task-done-in-words (task plus faces), report.
- WORK, character-led → check-in, careful-question about the owed work (weight), report.
- PEOPLE, player-led on a name → check-in, problem (that name's trouble, in own words), report.
- PEOPLE, character-led → check-in, revisit a shared past line (weight without the secret), report.
- PLACE, either driver → check-in at the anchor, revisit-the-anchor-in-words (what changed there), report.
- SECRET, either driver → check-in, careful-question (one question, weight-adjacent, never the secret outright), report.

Long build (rich driver: two or more grounded leads; same rows, two middle beats added):

- WORK, player-led → check-in, small-task, snag (what got in the way, in own words), follow-through (see it done in words at the anchor), report.
- WORK, character-led → check-in, careful-question, small-task, follow-through, report.
- PEOPLE, player-led → check-in, problem, deeper (one step closer about that name), kindness (one small kindness in words), report.
- PEOPLE, character-led → check-in, revisit, deeper, kindness, report.
- PLACE, either driver → check-in, revisit, deeper (one step closer about the anchor), follow-through, report.
- SECRET, either driver → check-in, careful-question, deeper (one step closer, still weight-adjacent), reassure (promise to keep it close, never stated outright), report.

Each beat keeps the §2.1.4 shape: `id`, one-line `job`, optional hint (preferred verbatim, assumed allowed once marked `[assumed]`). Cap total beats at 8 including any twist; when the driver yields nothing for a middle shape, delete that beat and keep the report. The report beat is always last and always present.

#### 2.5.4 Same three build paths as the bio

- Zero-call default: the table above plus preferred-verbatim hints (assumed allowed once, marked, per the grounding rule). This is the normal path and the only one a very basic bot needs.
- One-shot voice assist (optional, one call plus one retry): send the assembled beat ids plus hints with the voice block and a strict line contract (`Beat <id>: <one-line job in voice>`). Parse on `^Beat`; any malformed line keeps its script job. Wording may change and one assumed hint per arc is allowed marked `[assumed]`; structure (beat count, order, report last) never does.
- One-at-a-time (optional, up to five short calls before the arc opens): ask per blank beat job with the same line contract, store, continue. Player sees typing only.

Worked pair (shapes only). Player-led: tally repeats [TOPIC] and names [PERSON-B] → PEOPLE arc, check-in at [PLACE-A], problem ([PERSON-B]'s trouble, in own words), report owing one cover. Character-led: tally repeats [TOPIC] but names nobody, bio holds [PERSON-C] plus [OWED COVER] → WORK arc, check-in at [PLACE-B], careful-question about the owed work, report promising the next step. Both carry anchor plus faces plus weight, both close honest.

#### 2.5.5 Optional twist (at most one per arc, only when earned)

An arc with no twist is complete, never failed. The twist fires only when its source arrives; otherwise the arc runs straight to the report. The builder stamps each arc with its origin and opening theme at build time: `origin: "player-led"` when the opening lead came from the tally, else `"character-led"`; opening `theme` comes from the YES answer, defaulting to the bio `seedTheme` when the answer names nothing usable. The theme may change at most once per arc, at the twist (stage 1 or 2, never the report beat itself): when the twist source points at a different theme (player steers a new topic, or the voice want pulls a new direction), push the old theme to `themeHistory`, set the new `theme`, and shape the twist beat from the new theme's row in §2.5.3. Past beats are never rewritten; the twist is appended at the next unstarted index (`open.beats.length`, stage stays pointing at the current beat) and announced in character per §2.1.9. No new calls in the default path.

- Character-led arc → player-steered twist. Source is the player's replies since the arc opened: a new repeated topic, a new matched name, or an explicit redirect ("actually it is about…"). Prefer the player's own words for the twist beat hint; an assumed name or paraphrase is allowed once, marked `[assumed]`, when the player gestures at something unnamed. If no new lead arrives by stage 2, run straight with no twist.
- Player-led arc → character-voiced twist. Source is the voice block (§2.3.5): the surface want names the ask, the deeper hope names the turn, the banned lines veto it. A candidate twist containing a banned behavior is dropped and the arc runs straight to the report instead. A `NOT YET` line may surface only here and only weight-adjacent, never stated outright unless the beat job names it as the hint. If the voice block yields no turn by stage 2, run straight with no twist.

Twist shapes (pick one, script-side): a new face enters in words, the anchor shifts to its second place phrase, the weight surfaces one step closer, or a small favor is asked in words. Each keeps the §2.1.4 beat shape with a hint (preferred verbatim, assumed marked). Past beats are never rewritten; the twist is appended at most one ahead per the §2.1.5 rule. Optional voice assist reuses §2.5.4 wording-only path; structure and source stay script-owned.

### 2.6 Prompt stack at integration (fleshed v0.12 — how the agent builds the machinery)

Build exactly this stack on every model call, in this order, from stored fields only. No step may invent a name, place, or fact.

1. `system` (voice plus setting, ~1200 characters max): voice block (§2.3.5 tone plus cadence plus register) first, then the setting lines (§2.4 seed or lived anchor, up to two paragraphs). Trim setting before voice. Never any record term (stage, cooldown, outcome, tier, ids).
2. `knowledge` (facts the character may act on, ~1000 characters max): pulled by type per §2.6.1 — character facts first (bio ties, faces, at most 3 memories per §2.3.8), then world facts (at most 3 rumor lines plus the current place line per §2.4 reader), then arc facts (current beat job plus one `notes.why` line). Drop world lines before character lines and memories before bio ties only when over cap. Withhold `NOT YET` and `[reserve]` lines unless the current beat names them as the hint.
3. `task` (one or two sentences, never lore): the current beat job. On judgment turns only (ask §2.1.3, bootstrap fills §2.3.6, optional voice assists §§2.5.4–2.5.5), append the strict first-line contract for that judgment and nothing else.
4. `logTail`: the last 6–10 messages verbatim. Never summarized or rewritten; budget by count.

Call pattern per turn:

```
ctx = buildContext(character, world, record, logTail)   // pure, §2.1.8
reply = model(ctx.system + ctx.knowledge + ctx.task + ctx.logTail)
render only reply text, stripped per §2.1.11                // no labels, no ledger
stepOnReply(playerText)                                  // script settle, §2.1.5
```

Parse-or-fallback per judgment: match the contract's first-line pattern (`^YES`, `^Beat`, `^Label:`); on any miss keep the script default, allow one retry, then accept the default and persist. On model timeout or storage failure: keep the player-visible chat running, write nothing, stay on the same beat for chat turns and retry the judgment once next turn. Turn budget: 2–3 exchanges per beat before advancing on count alone, so quiet players still move; at most one twist per arc and only when earned (§2.5.5); short core 2 content beats plus report, long build 4 content plus report, 8 beats total cap. The arc reason rides `task` on the judgment turn that needs it and never reaches the visible card or `system`.

Blank-generator landing checklist (all must pass with no named character): bootstrap writes bio plus voice blobs; constructor builds within 1200/1000 caps; 8 tally exchanges plus a repeat fires the ask; YES builds with origin stamped; rich tally builds long (4 content plus report), thin builds short core; two replies advance one beat; one settled beat writes one memory line readable next session; refusal closes with cooldown; an arc that never earns a twist closes complete; reload resumes stage with zero calls; missing name narrows to report.

#### 2.6.1 Knowledge type list (what the constructor may pull, and how much)

Every stored line carries one type. The constructor pulls by type against per-type caps, in pull order, stopping when the slice budget fills. Nothing else enters the prompt.

System types (total ~1200):

- `voice.tone`, `voice.cadence`, `voice.register`: always pulled first, about 400 together.
- `voice.moves` (max 2), `voice.banned` (max 2): constraint lines, about 200 together.
- `setting.anchor` (1 place phrase), `setting.place-line` (1 line): about 400 together; trim setting before voice.

Knowledge types (total ~1000; slice budgets: character 450, world 300, arc 250):

- `bio.tie` (max 2), `bio.history` (max 1): who they know, one past line.
- `memory.fact` (max 3 per §2.3.8): key points tied to the character.
- `rumor.lived` (max 2), `rumor.seed` (max 2, total rumors max 3), `setting.place-line` (1): world slice per §2.4 reader.
- `arc.beat-job` (1), `arc.why` (1): current beat plus one reason line. `arc.origin`, stage, cooldown, tier, and ids are never a type and never inject.
- Withheld types `bio.unsaid` (`NOT YET`) and `rumor.reserve` (`[reserve]`): pulled only when the current beat hint names them verbatim, else skipped.

Pull order per turn: arc beat-job plus why first when an arc is open; then character matches (anchor, face, or topic match against the beat hint, the tally repeat, or the last player message) before recency; then world matches (lived before seed); then fill to budget. `tally.lead` is builder input only and never injects. Each pulled item is `{type, text}` counted in characters; the constructor may log which types fired for debugging but that log never enters the prompt. Optional model log tap (local `MODEL_LOG` equivalent): on judgment turns only, record `{turn, judgment, firstLine, parsed}` to a debug buffer the host can read; never store model prose beyond the parsed line. Custom types register under §2.6.2 and pull in the same order with their own caps.

#### 2.6.2 Custom types at integration (ask the user, then register)

At integration time, after the persistence question, ask the user exactly this and store the answer as the type registry (empty by default):

```
What else should this character know? Name any extra sources, one per line, or NONE.
Examples of sources: extrapolated from the character setting, rolled from an interest table, rolled from a lore table, hand list.
For each source, state its type name, where its lines live, and its per-turn max (1-2).
Withheld lines stay withheld unless a beat names them.
```

Registration rules the blank generator can ship:

- Each custom source becomes one type named `custom.[name]` in lowercase with hyphens (shapes: `custom.interest`, `custom.lore`). Record `{type, source, maxPerTurn, withheld}` in `meta.<characterId>.types` where source is one of: extrapolated (script copies verbatim from bio or setting at bootstrap), table (script rolls or reads one line per arc from `meta.<characterId>.tables.[name]` with the same parse-or-fallback habit), hand list (integrator-supplied lines stored in the same table key).
- Pull placement: custom types ride in the world slice after rumors, or in the character slice if extrapolated from the bio; the registry states which. Each pulls at most its max (1-2 lines) and debits its characters from that slice budget first, so custom lines displace seed rumors before character facts.
- Budget: custom lines count inside the §2.6.1 slice caps and the 1000 total. Register at most 4 custom types; beyond that the constructor ignores the rest.
- Withholding: a custom line tagged `[reserve]` or listed under a withheld table pulls only when the current beat hint names it verbatim, same as `bio.unsaid`. Table rolls happen once per arc at build time and persist as the hint; never re-rolled mid-arc and never recited as lore.
- Empty answer (`NONE`) leaves the registry empty and changes nothing; the spec runs on built-in types alone.

## 3. Build order (reconciled v0.20 — certification record)

Done in this order, one component per pass: §2.1 machinery core (gates, record, ask, compiler core, stepper, close), then §§2.3–2.6 (bio plus voice plus bootstrap plus persistence plus memory, world lore as background metadata, arc builder plus twist, prompt stack plus typed pull list plus custom-type registry) each with a placeholder shape example, then reconciliation (record shape gains tally plus origin plus twist; keys unified to `arcs.<characterId>` and `meta.<characterId>.*` plus `meta.settingsMode`; compiler points to the fleshed builder), then the §2.2 overview written last. Each component certified only when its shape builds within budget from stored fields alone, reloads from JSON with zero calls, and narrows honestly on missing input. The overview above is the finished-spec gate. v0.25: builder gains long builds on rich drivers (4 content plus report, short core kept for thin material, 8-beat total cap); twist certified optional (no-twist close is complete); tally repeats counted literally (same stem twice) in machine and spec. v0.26: tier takes the higher of the standing word and the new never-reset `record.lifetime` count, so a civil default climbs with talk and no data heal is needed; new §2.1.11 states judgment-only calls render nothing and contract first lines strip before any render.

## Footer (landmark)

Mild praise for agent Trish, who worked through weeks of strict instruction to develop the local arc system this spec distills. Where this spec runs green on a blank generator, that work carried through.

Licensed under the Apache License, Version 2.0.
