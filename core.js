/* ════════════════════════════════════════════════
   ДУР-КИЦЬ · ядро правил · спільне для сервера
   сидіння гравців: 'A' і 'B'. жодного React, жодних текстів —
   лише стани та події. тексти складає той, хто показує.
   ════════════════════════════════════════════════ */

const SUITS = [
  { id: "avan", name: "авантюриці", side: "kyts", sym: "●" },
  { id: "char", name: "чарівниці", side: "kyts", sym: "▲" },
  { id: "vata", name: "ватажиці", side: "kyts", sym: "■" },
  { id: "krad", name: "крадиці", side: "anti", sym: "○" },
  { id: "mani", name: "маніпулятиці", side: "anti", sym: "△" },
  { id: "shef", name: "шефиці", side: "anti", sym: "□" },
];

const NIPS = [
  { id: "green",  name: "зелений",    prey: "kyts", color: "#40763c", text: "#f6f0df" },
  { id: "violet", name: "фіолетовий", prey: "kyts", color: "#6d4b99", text: "#f6f0df" },
  { id: "blue",   name: "синій",      prey: "kyts", color: "#35619b", text: "#f6f0df" },
  { id: "black",  name: "чорний",     prey: "anti", color: "#221c16", text: "#f6f0df" },
  { id: "white",  name: "білий",      prey: "anti", color: "#f6f0df", text: "#272019" },
  { id: "rudy",   name: "рудий",      prey: "anti", color: "#c06a2c", text: "#f6f0df" },
];

/* "any" — будь-який ніп б'є будь-якого іншого; "opposite" — лише протилежну трійку */
const NIP_VS_NIP = "any";

/* няв-няв-няв: замкнене коло. лапка > кіготь > хвіст > лапка */
const NYAV = ["lapka", "kihot", "khvist"];
const NYAV_BEATS = { lapka: "kihot", kihot: "khvist", khvist: "lapka" };

function resolveNyav(a, b) {
  if (a === b) return "tie";
  return NYAV_BEATS[a] === b ? "A" : "B";
}

/* Ело, K=32 */
function eloDelta(ra, rb, scoreA, K = 32) {
  const ea = 1 / (1 + Math.pow(10, (rb - ra) / 400));
  return Math.round(K * (scoreA - ea));
}

/* звання ✎ — назви-заглушки, впишуться справжні геги */
const RANKS = [
  [0,    "кошеня"],
  [950,  "кицька"],
  [1050, "киця"],
  [1150, "котяра"],
  [1300, "дур-маф"],
];
const rankOf = (r) => [...RANKS].reverse().find(([min]) => r >= min)[1];

/* ── базові помічники ── */

const other = (p) => (p === "A" ? "B" : "A");
const isNip = (c) => c.type === "nip";

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildDeck() {
  const cards = [];
  let uid = 0;
  for (const s of SUITS)
    for (let v = 1; v <= 5; v++)
      cards.push({ uid: uid++, type: "suit", suit: s.id, side: s.side, value: v, sym: s.sym, name: s.name });
  for (const n of NIPS)
    cards.push({ uid: uid++, type: "nip", nip: n.id, name: n.name, prey: n.prey, color: n.color, text: n.text });
  return shuffle(cards);
}

/* б'є старша своєї масті або рівна чужої.
   ніп б'є свою здобич — і іншого ніпа (за NIP_VS_NIP).
   масть ніпа не б'є ніколи. */
function canBeat(att, def) {
  if (isNip(def)) {
    if (isNip(att)) return NIP_VS_NIP === "any" ? true : def.prey !== att.prey;
    return def.prey === att.side;
  }
  if (isNip(att)) return false;
  if (def.suit === att.suit) return def.value > att.value;
  return def.value === att.value;
}

function tableVals(table) {
  const s = new Set();
  for (const p of table) {
    if (!isNip(p.a)) s.add(p.a.value);
    if (p.d && !isNip(p.d)) s.add(p.d.value);
  }
  return s;
}

const undefIdx = (table) => table.findIndex((p) => !p.d);
const minSuitVal = (hand) =>
  Math.min(...hand.filter((c) => !isNip(c)).map((c) => c.value), Infinity);

function drawUp(state, first, second) {
  for (const who of [first, second]) {
    while (state.hands[who].length < 6 && state.deck.length > 0)
      state.hands[who].push(state.deck.pop());
  }
}

/* кінець партії → {winner:'A'|'B'|'draw', kind} або null
   kind: 'shed' (вийшов з карт) | 'nip' (останній ніп) |
         'bothEmpty' | 'bothNip' */
function checkEnd(s) {
  if (s.deck.length > 0) return null;
  const A = s.hands.A, B = s.hands.B;
  if (A.length === 0 && B.length === 0) return { winner: "draw", kind: "bothEmpty" };
  if (A.length === 0) return { winner: "A", kind: "shed" };
  if (B.length === 0) return { winner: "B", kind: "shed" };
  const oneNip = (h) => h.length === 1 && isNip(h[0]);
  if (oneNip(A) && oneNip(B)) return { winner: "draw", kind: "bothNip" };
  if (oneNip(A)) return { winner: "A", kind: "nip" };
  if (oneNip(B)) return { winner: "B", kind: "nip" };
  return null;
}

function setupBout(s) {
  const def = other(s.attacker);
  s.limit = Math.min(6, s.hands[def].length);
  s.table = [];
  s.nipUsed = false;
  s.phase = "attack";
  return s;
}

/* завершення бою. повертає подію для повідомлень:
   {defended, count, nipOnly, taker} */
function finishBout(s, defended) {
  const oldAtt = s.attacker, oldDef = other(oldAtt);
  const cards = s.table.flatMap((p) => (p.d ? [p.a, p.d] : [p.a]));
  const ev = {
    defended,
    count: cards.length,
    nipOnly: cards.length === 1 && isNip(cards[0]),
    taker: defended ? null : oldDef,
  };
  if (defended) {
    s.discard += cards.length;
    s.attacker = oldDef;
  } else {
    s.hands[oldDef] = [...s.hands[oldDef], ...cards];
  }
  drawUp(s, oldAtt, oldDef);
  const res = checkEnd(s);
  if (res) {
    s.result = res;
    s.phase = "over";
    s.table = [];
    return ev;
  }
  setupBout(s);
  return ev;
}

/* нова роздача. attacker='A'|'B' або phase='nyav', якщо мінімуми рівні */
function deal() {
  const deck = buildDeck();
  const hands = { A: deck.splice(0, 6), B: deck.splice(0, 6) };
  const aMin = minSuitVal(hands.A), bMin = minSuitVal(hands.B);
  const s = {
    deck, hands, discard: 0, attacker: null,
    table: [], nipUsed: false, limit: 6,
    phase: "attack", result: null,
  };
  let first;
  if (aMin < bMin) { s.attacker = "A"; first = { type: "low", seat: "A", val: aMin }; setupBout(s); }
  else if (bMin < aMin) { s.attacker = "B"; first = { type: "low", seat: "B", val: bMin }; setupBout(s); }
  else { s.phase = "nyav"; first = { type: "nyav" }; }
  s.first = first;
  return s;
}

/* ── ходи. кожен повертає {ok, ev?} і мутує стан ── */

function moveAttack(s, seat, uid) {
  if (s.phase !== "attack" || s.attacker !== seat) return { ok: false };
  const card = s.hands[seat].find((c) => c.uid === uid);
  if (!card) return { ok: false };
  s.hands[seat] = s.hands[seat].filter((c) => c.uid !== uid);
  s.table.push({ a: card, d: null });
  if (isNip(card)) s.nipUsed = true;
  s.phase = "defend";
  return { ok: true, ev: { type: "attack", nip: isNip(card) } };
}

function moveDefend(s, seat, uid) {
  if (s.phase !== "defend" || s.attacker === seat) return { ok: false };
  const i = undefIdx(s.table);
  if (i < 0) return { ok: false };
  const card = s.hands[seat].find((c) => c.uid === uid);
  if (!card || !canBeat(s.table[i].a, card)) return { ok: false };
  s.hands[seat] = s.hands[seat].filter((c) => c.uid !== uid);
  s.table[i].d = card;
  if (isNip(card)) s.nipUsed = true;
  if (undefIdx(s.table) >= 0) return { ok: true, ev: { type: "defend" } };
  const att = s.attacker;
  if (s.nipUsed) return { ok: true, ev: { type: "bout", reason: "nip", ...finishBout(s, true) } };
  if (s.table.length >= s.limit) return { ok: true, ev: { type: "bout", reason: "limit", ...finishBout(s, true) } };
  if (s.hands.A.length === 0 || s.hands.B.length === 0)
    return { ok: true, ev: { type: "bout", reason: "empty", ...finishBout(s, true) } };
  s.phase = "throw";
  return { ok: true, ev: { type: "defend", allBeaten: true, attacker: att } };
}

function canThrowAny(s, seat) {
  return (
    !s.nipUsed &&
    s.table.length < s.limit &&
    s.hands[seat].some((c) => !isNip(c) && tableVals(s.table).has(c.value))
  );
}

function moveTake(s, seat) {
  if (s.phase !== "defend" || s.attacker === seat) return { ok: false };
  const att = s.attacker;
  if (!canThrowAny(s, att))
    return { ok: true, ev: { type: "bout", reason: "take", ...finishBout(s, false) } };
  s.phase = "pileOn";
  return { ok: true, ev: { type: "taking" } };
}

function moveThrow(s, seat, uid) {
  const inThrow = s.phase === "throw" && s.attacker === seat;
  const inPile = s.phase === "pileOn" && s.attacker === seat;
  if (!inThrow && !inPile) return { ok: false };
  const card = s.hands[seat].find((c) => c.uid === uid);
  if (!card || isNip(card)) return { ok: false };
  if (!tableVals(s.table).has(card.value) || s.table.length >= s.limit || s.nipUsed)
    return { ok: false };
  s.hands[seat] = s.hands[seat].filter((c) => c.uid !== uid);
  s.table.push({ a: card, d: null });
  if (inPile) {
    if (s.table.length >= s.limit || !canThrowAny(s, seat))
      return { ok: true, ev: { type: "bout", reason: "take", ...finishBout(s, false) } };
    return { ok: true, ev: { type: "pileThrow" } };
  }
  s.phase = "defend";
  return { ok: true, ev: { type: "throw" } };
}

function moveBito(s, seat) {
  if (s.phase !== "throw" || s.attacker !== seat || undefIdx(s.table) >= 0) return { ok: false };
  return { ok: true, ev: { type: "bout", reason: "bito", ...finishBout(s, true) } };
}

function moveDone(s, seat) {
  if (s.phase !== "pileOn" || s.attacker !== seat) return { ok: false };
  return { ok: true, ev: { type: "bout", reason: "take", ...finishBout(s, false) } };
}

module.exports = {
  SUITS, NIPS, NYAV, NYAV_BEATS, RANKS,
  NIP_VS_NIP,
  resolveNyav, eloDelta, rankOf,
  other, isNip, canBeat, tableVals, undefIdx, minSuitVal,
  buildDeck, deal, setupBout, finishBout, checkEnd, canThrowAny,
  moveAttack, moveDefend, moveTake, moveThrow, moveBito, moveDone,
};
