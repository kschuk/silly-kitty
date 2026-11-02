/* ════════════════════════════════════════════════
   ДУР-КИЦЬ · бот «жабка ґреґ» · 4 евристики поверх ядра
   1. не бити ніпом, якщо є дешевша карта
   2. атакувати найдешевшою немаст-картою (ніп — лише як останній шанс)
   3. підкидати десь у половині випадків найдешевшим збігом
   4. няв — чесно випадковий (жодної інформаційної переваги)
   ════════════════════════════════════════════════ */
const core = require("./core");

function cheapestBeat(card, hand, swapPrey, valueFlip) {
  const opts = hand.filter((c) => core.canBeat(card, c, swapPrey, valueFlip));
  if (!opts.length) return null;
  opts.sort((a, b) => {
    if (core.isNip(a) !== core.isNip(b)) return core.isNip(a) ? 1 : -1; // евристика 1
    return (a.value || 0) - (b.value || 0); // найдешевша
  });
  return opts[0];
}

function cheapestAttack(hand) {
  const suits = hand.filter((c) => !core.isNip(c));
  if (suits.length) { suits.sort((a, b) => a.value - b.value); return suits[0]; } // евристика 2
  return hand[0] || null; // лишились тільки ніпи — доводиться
}

function decideNyav() {
  return core.NYAV[(Math.random() * 3) | 0]; // евристика 4
}

/* повертає {type,...} — хід боту, або null якщо ще не його черга */
function botDecide(state, seat) {
  const hand = state.hands[seat] || [];
  if (state.phase === "attack" && state.attacker === seat) {
    const c = cheapestAttack(hand);
    return c ? { type: "attack", uid: c.uid } : null;
  }
  if (state.phase === "defend" && state.defender === seat) {
    const i = core.undefIdx(state.table);
    if (i < 0) return null;
    const c = cheapestBeat(state.table[i].a, hand, core.glitchSwap(state), core.glitchFlip(state));
    return c ? { type: "defend", uid: c.uid } : { type: "take" };
  }
  if ((state.phase === "throw" || state.phase === "pileOn") && seat !== state.defender) {
    if (!core.canSeatThrow(state, seat)) return { type: "pass" };
    if (Math.random() < 0.55) { // евристика 3 — не душимо захисника щоразу
      const vals = core.tableVals(state.table);
      const anyVal = core.glitchThrowAny(state);
      const opts = hand.filter((c) => !core.isNip(c) && (anyVal || vals.has(c.value)));
      opts.sort((a, b) => a.value - b.value);
      if (opts[0]) return { type: "throw", uid: opts[0].uid };
    }
    return { type: "pass" };
  }
  return null;
}

module.exports = { botDecide, decideNyav };
