/* headless-симуляція ядра v2: столи 2–5 */
const core = require("./core");
const rnd = (a) => a[(Math.random() * a.length) | 0];

function playOne(nSeats) {
  const seats = core.SEATS_ALL.slice(0, nSeats);
  const s = core.deal(seats);
  let steps = 0;
  while (!s.result) {
    if (++steps > 3000) throw new Error("зависло на " + nSeats + " гравцях");
    if (s.phase === "nyav") {
      const picks = {};
      for (const x of s.nyavSet) picks[x] = rnd(core.NYAV);
      core.applyNyav(s, picks);
    } else if (s.phase === "attack") {
      const h = s.hands[s.attacker];
      const r = core.moveAttack(s, s.attacker, rnd(h).uid);
      if (!r.ok) throw new Error("атака не пройшла");
    } else if (s.phase === "defend") {
      const i = core.undefIdx(s.table);
      const h = s.hands[s.defender];
      const opts = h.filter((c) => core.canBeat(s.table[i].a, c));
      if (!opts.length || Math.random() < 0.3) core.moveTake(s, s.defender);
      else core.moveDefend(s, s.defender, rnd(opts).uid);
    } else if (s.phase === "throw" || s.phase === "pileOn") {
      const pend = core.throwers(s).filter((x) => !s.passes.includes(x));
      if (!pend.length) throw new Error("нема кому пасувати, а фаза висить");
      const seat = rnd(pend);
      const vals = core.tableVals(s.table);
      const opts = s.hands[seat].filter((c) => !core.isNip(c) && vals.has(c.value));
      if (opts.length && s.table.length < s.limit && !s.nipUsed && Math.random() < 0.5)
        core.moveThrow(s, seat, rnd(opts).uid);
      else core.movePass(s, seat);
    } else throw new Error("фаза? " + s.phase);
    // збереження 36 карт
    const total =
      s.deck.length + s.discard +
      s.seats.reduce((a, x) => a + s.hands[x].length, 0) +
      s.table.flatMap((p) => (p.d ? [p.a, p.d] : [p.a])).length;
    if (total !== 36) throw new Error("витік карт: " + total);
  }
  // місця: у всіх, в межах 1..n
  for (const x of s.seats) {
    const p = s.result.places[x];
    if (!(p >= 1 && p <= nSeats)) throw new Error("погане місце " + p);
  }
  return steps;
}

let maxSteps = 0;
const perSize = {};
for (let g = 0; g < 2000; g++) {
  const n = 2 + (g % 4); // 2,3,4,5 по колу
  const st = playOne(n);
  maxSteps = Math.max(maxSteps, st);
  perSize[n] = (perSize[n] || 0) + 1;
}
console.log("СИМУЛЯЦІЯ OK · 2000 партій ·", JSON.stringify(perSize), "· maxSteps", maxSteps);
