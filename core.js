/* ════════════════════════════════════════════════
   ДУР-КИЦЬ · ядро правил v2 · 2–5 гравців
   сидіння: 'A'..'E'. чиста логіка, без текстів і сокетів.
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

const NIP_VS_NIP = "any";
const MAX_SEATS = 5;
const SEATS_ALL = ["A", "B", "C", "D", "E"];

/* няв-няв-няв: лапка > кіготь > хвіст > лапка */
const NYAV = ["lapka", "kihot", "khvist"];
const NYAV_BEATS = { lapka: "kihot", kihot: "khvist", khvist: "lapka" };

/* груповий няв: повертає {winners:[seats]} — може лишитись >1, тоді ще раунд */
function resolveNyavGroup(picks) {
  const seats = Object.keys(picks);
  const signs = [...new Set(seats.map((s) => picks[s]))];
  if (signs.length !== 2) return { winners: seats }; // всі однакові або всі три — ще раз
  const winSign = NYAV_BEATS[signs[0]] === signs[1] ? signs[0] : signs[1];
  return { winners: seats.filter((s) => picks[s] === winSign) };
}

/* ── ранги: проста унісекс-драбина (для киць і жаб) ✎ ── */
const RANKS = [
  [0,   "новачок"],
  [75,  "спритник"],
  [175, "хитрюга"],
  [300, "майстер"],
  [450, "дур-маф"],
  [650, "маф-легенда"],
];
function rankOf(sp) {
  sp = Math.max(0, sp | 0);
  return [...RANKS].reverse().find(([min]) => sp >= min)[1];
}

/* ── базові помічники ── */

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

/* наступний активний після seat (за колом сидінь) */
function nextActive(s, seat) {
  const i = s.seats.indexOf(seat);
  for (let k = 1; k <= s.seats.length; k++) {
    const cand = s.seats[(i + k) % s.seats.length];
    if (s.active.includes(cand)) return cand;
  }
  return null;
}

/* добір: атакер → решта за колом → захисник останнім */
function drawUp(s, attacker, defender) {
  const order = [];
  let cur = attacker;
  for (let k = 0; k < s.seats.length; k++) {
    if (s.active.includes(cur) && cur !== defender && !order.includes(cur)) order.push(cur);
    cur = s.seats[(s.seats.indexOf(cur) + 1) % s.seats.length];
  }
  if (defender && s.active.includes(defender)) order.push(defender);
  for (const who of order)
    while (s.hands[who].length < 6 && s.deck.length > 0) s.hands[who].push(s.deck.pop());
}

/* підкидачі: всі активні, крім захисника */
const throwers = (s) => s.active.filter((x) => x !== s.defender);

function canAnyoneThrow(s) {
  if (s.nipUsed || s.table.length >= s.limit) return false;
  const vals = tableVals(s.table);
  return throwers(s).some((seat) =>
    s.hands[seat].some((c) => !isNip(c) && vals.has(c.value))
  );
}

function canSeatThrow(s, seat) {
  if (seat === s.defender || !s.active.includes(seat)) return false;
  if (s.nipUsed || s.table.length >= s.limit) return false;
  const vals = tableVals(s.table);
  return s.hands[seat].some((c) => !isNip(c) && vals.has(c.value));
}

function setupBout(s) {
  s.defender = nextActive(s, s.attacker);
  s.limit = Math.min(6, s.hands[s.defender].length);
  s.table = [];
  s.nipUsed = false;
  s.passes = [];
  s.phase = "attack";
  return s;
}

/* вихід гравців після добору (добір пустий):
   спершу порожні руки, потім останній-ніп. одночасні ділять місце. */
function processExits(s) {
  if (s.deck.length > 0) return [];
  const out = [];
  const empt = s.active.filter((x) => s.hands[x].length === 0);
  if (empt.length) {
    for (const seat of empt) { s.places[seat] = s.placeNext; s.exitKind[seat] = "shed"; out.push(seat); }
    s.placeNext += empt.length;
    s.active = s.active.filter((x) => !empt.includes(x));
  }
  const nip1 = s.active.filter((x) => s.hands[x].length === 1 && isNip(s.hands[x][0]));
  if (nip1.length) {
    for (const seat of nip1) { s.places[seat] = s.placeNext; s.exitKind[seat] = "nip"; out.push(seat); }
    s.placeNext += nip1.length;
    s.active = s.active.filter((x) => !nip1.includes(x));
  }
  return out;
}

function maybeEnd(s) {
  if (s.active.length > 1) return false;
  if (s.active.length === 1) {
    const last = s.active[0];
    s.places[last] = s.placeNext++;
    s.exitKind[last] = "durkyts";
    s.active = [];
  }
  s.phase = "over";
  s.result = {
    standings: [...s.seats].sort((a, b) => (s.places[a] ?? 99) - (s.places[b] ?? 99)),
    places: s.places,
    exitKind: s.exitKind,
  };
  return true;
}

/* завершення бою */
function finishBout(s, defended) {
  const oldAtt = s.attacker, oldDef = s.defender;
  const cards = s.table.flatMap((p) => (p.d ? [p.a, p.d] : [p.a]));
  const ev = {
    type: "bout", defended, count: cards.length,
    nipOnly: cards.length === 1 && isNip(cards[0]),
    taker: defended ? null : oldDef,
  };
  if (defended) s.discard += cards.length;
  else s.hands[oldDef] = [...s.hands[oldDef], ...cards];
  s.table = [];
  drawUp(s, oldAtt, oldDef);
  ev.exited = processExits(s);
  if (maybeEnd(s)) return ev;
  /* наступний атакер: відбився — захисник; забрав — гравець за ним */
  let nxt = defended ? oldDef : nextActive(s, oldDef);
  if (!s.active.includes(nxt)) nxt = nextActive(s, nxt ?? oldDef) ?? s.active[0];
  s.attacker = nxt;
  setupBout(s);
  return ev;
}

/* нова роздача на seats (2–5) */
function deal(seats) {
  if (seats.length < 2 || seats.length > MAX_SEATS) throw new Error("2–5 гравців");
  const deck = buildDeck();
  const hands = {};
  for (const seat of seats) hands[seat] = deck.splice(0, 6);
  const s = {
    seats: [...seats], active: [...seats], hands,
    deck, discard: 0,
    attacker: null, defender: null,
    table: [], nipUsed: false, limit: 6, passes: [],
    places: {}, exitKind: {}, placeNext: 1,
    phase: "attack", result: null,
    nyavSet: null,
  };
  const mins = seats.map((x) => [x, minSuitVal(hands[x])]);
  const best = Math.min(...mins.map(([, v]) => v));
  const lows = mins.filter(([, v]) => v === best).map(([x]) => x);
  if (lows.length === 1) {
    s.attacker = lows[0];
    setupBout(s);
    s.first = { type: "low", seat: lows[0], val: best };
  } else {
    s.phase = "nyav";
    s.nyavSet = lows;
    s.first = { type: "nyav", seats: lows };
  }
  return s;
}

/* застосувати результат групового няву; повертає {done, winner?} */
function applyNyav(s, picks) {
  const { winners } = resolveNyavGroup(picks);
  if (winners.length === 1) {
    s.attacker = winners[0];
    s.nyavSet = null;
    setupBout(s);
    return { done: true, winner: winners[0] };
  }
  s.nyavSet = winners;
  return { done: false, winners };
}

/* ── ходи ── */

function moveAttack(s, seat, uid) {
  if (s.phase !== "attack" || s.attacker !== seat) return { ok: false };
  const card = s.hands[seat].find((c) => c.uid === uid);
  if (!card) return { ok: false };
  s.hands[seat] = s.hands[seat].filter((c) => c.uid !== uid);
  s.table.push({ a: card, d: null });
  if (isNip(card)) s.nipUsed = true;
  s.phase = "defend";
  s.passes = [];
  return { ok: true, ev: { type: "attack", nip: isNip(card) } };
}

function afterAllBeaten(s) {
  if (s.nipUsed) return { type: "bout", reason: "nip", ...finishBout(s, true) };
  if (s.table.length >= s.limit) return { type: "bout", reason: "limit", ...finishBout(s, true) };
  if (s.hands[s.defender].length === 0) return { type: "bout", reason: "empty", ...finishBout(s, true) };
  if (!canAnyoneThrow(s)) return { type: "bout", reason: "dry", ...finishBout(s, true) };
  s.phase = "throw";
  s.passes = [];
  return { type: "defend", allBeaten: true };
}

function moveDefend(s, seat, uid) {
  if (s.phase !== "defend" || s.defender !== seat) return { ok: false };
  const i = undefIdx(s.table);
  if (i < 0) return { ok: false };
  const card = s.hands[seat].find((c) => c.uid === uid);
  if (!card || !canBeat(s.table[i].a, card)) return { ok: false };
  s.hands[seat] = s.hands[seat].filter((c) => c.uid !== uid);
  s.table[i].d = card;
  if (isNip(card)) s.nipUsed = true;
  if (undefIdx(s.table) >= 0) return { ok: true, ev: { type: "defend" } };
  return { ok: true, ev: afterAllBeaten(s) };
}

function moveTake(s, seat) {
  if (s.phase !== "defend" || s.defender !== seat) return { ok: false };
  if (!canAnyoneThrow(s))
    return { ok: true, ev: { type: "bout", reason: "take", ...finishBout(s, false) } };
  s.phase = "pileOn";
  s.passes = [];
  return { ok: true, ev: { type: "taking" } };
}

function moveThrow(s, seat, uid) {
  const inThrow = s.phase === "throw", inPile = s.phase === "pileOn";
  if ((!inThrow && !inPile) || seat === s.defender || !s.active.includes(seat)) return { ok: false };
  const card = s.hands[seat].find((c) => c.uid === uid);
  if (!card || isNip(card)) return { ok: false };
  if (!tableVals(s.table).has(card.value) || s.table.length >= s.limit || s.nipUsed)
    return { ok: false };
  s.hands[seat] = s.hands[seat].filter((c) => c.uid !== uid);
  s.table.push({ a: card, d: null });
  s.passes = [];
  if (inPile) {
    if (s.table.length >= s.limit || !canAnyoneThrow(s))
      return { ok: true, ev: { type: "bout", reason: "take", ...finishBout(s, false) } };
    return { ok: true, ev: { type: "pileThrow" } };
  }
  s.phase = "defend";
  return { ok: true, ev: { type: "throw" } };
}

/* пас/бито у фазі throw та «досить» у pileOn — однакова механіка згоди */
function movePass(s, seat) {
  const inThrow = s.phase === "throw", inPile = s.phase === "pileOn";
  if ((!inThrow && !inPile) || seat === s.defender || !s.active.includes(seat)) return { ok: false };
  if (inThrow && undefIdx(s.table) >= 0) return { ok: false };
  if (!s.passes.includes(seat)) s.passes.push(seat);
  const need = throwers(s);
  const all = need.every((x) => s.passes.includes(x));
  if (all || !canAnyoneThrow(s)) {
    if (inThrow) return { ok: true, ev: { type: "bout", reason: "bito", ...finishBout(s, true) } };
    return { ok: true, ev: { type: "bout", reason: "take", ...finishBout(s, false) } };
  }
  return { ok: true, ev: { type: "pass" } };
}

/* викидання гравця (вихід/розрив/тиша). місце — з хвоста. */
function dropPlayer(s, seat, reason) {
  if (!s.active.includes(seat)) return { gone: false };
  s.discard += s.hands[seat].length;
  s.hands[seat] = [];
  s.active = s.active.filter((x) => x !== seat);
  s.bottomNext = s.bottomNext ?? s.seats.length;
  s.places[seat] = s.bottomNext--;
  s.exitKind[seat] = reason || "drop";
  const wasDef = s.defender === seat, wasAtt = s.attacker === seat;
  if (s.phase === "nyav") {
    s.nyavSet = (s.nyavSet || []).filter((x) => x !== seat);
    if (s.nyavSet.length === 1 && s.active.length > 1) {
      s.attacker = s.nyavSet[0]; s.nyavSet = null; setupBout(s);
    } else if (s.nyavSet.length === 0 && s.active.length > 1) {
      s.attacker = s.active[0]; setupBout(s);
    }
  } else if (wasDef || wasAtt) {
    s.discard += s.table.flatMap((p) => (p.d ? [p.a, p.d] : [p.a])).length;
    s.table = [];
    if (s.active.length > 1) {
      let nxt = nextActive(s, seat);
      s.attacker = nxt;
      setupBout(s);
    }
  } else {
    s.passes = s.passes.filter((x) => x !== seat);
    if ((s.phase === "throw" || s.phase === "pileOn") && s.active.length > 1) {
      const need = throwers(s);
      if (need.every((x) => s.passes.includes(x)) || !canAnyoneThrow(s)) {
        if (s.phase === "throw" && undefIdx(s.table) < 0) finishBout(s, true);
        else if (s.phase === "pileOn") finishBout(s, false);
      }
    }
  }
  const ended = maybeEndAfterDrop(s);
  return { gone: true, ended };
}

function maybeEndAfterDrop(s) {
  if (s.result) return true;
  if (s.active.length <= 1) return maybeEnd(s);
  return false;
}

module.exports = {
  SUITS, NIPS, NYAV, NYAV_BEATS, RANKS, MAX_SEATS, SEATS_ALL,
  NIP_VS_NIP,
  resolveNyavGroup, applyNyav, rankOf,
  isNip, canBeat, tableVals, undefIdx, minSuitVal, nextActive,
  buildDeck, deal, setupBout, finishBout, processExits,
  canAnyoneThrow, canSeatThrow, throwers,
  moveAttack, moveDefend, moveTake, moveThrow, movePass, dropPlayer,
};
