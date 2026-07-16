/* інтеграційний тест: двоє клієнтів → кімната → партія → реванш → рекорди */
const { io } = require("socket.io-client");
const core = require("./core");

const URL = "http://localhost:3111";
const rnd = (a) => a[(Math.random() * a.length) | 0];

function mkClient(name, tok) {
  const s = io(URL, { transports: ["websocket"] });
  const c = { s, name, tok, view: null, done: 0 };
  s.on("state", (v) => {
    c.view = v;
    act(c);
  });
  return c;
}

let gamesFinished = 0;
const WANT_GAMES = 3;

function act(c) {
  const v = c.view;
  if (!v) return;
  if (v.result) {
    if (!c.reported) {
      c.reported = true;
      gamesFinished++;
      console.log(`[${c.name}] фінал: ${v.result.big} (Δ${v.result.ratingDelta}, рейтинг ${v.result.rating})`);
      if (gamesFinished % 2 === 0 && gamesFinished / 2 < WANT_GAMES) {
        setTimeout(() => { c.reported = false; c.s.emit("rematch"); }, 50);
      } else if (gamesFinished / 2 < WANT_GAMES) {
        setTimeout(() => { c.reported = false; c.s.emit("rematch"); }, 50);
      }
    }
    return;
  }
  c.reported = false;
  if (!v.yourTurn) return;

  if (v.phase === "nyav") {
    c.s.emit("nyav", { sign: rnd(core.NYAV) });
    return;
  }
  const t = v.table;
  const hand = v.you.hand;
  if (v.phase === "attack" && v.youAttack) {
    c.s.emit("move", { type: "attack", uid: rnd(hand).uid });
  } else if (v.phase === "defend" && !v.youAttack) {
    const i = core.undefIdx(t);
    const opts = hand.filter((x) => core.canBeat(t[i].a, x));
    if (!opts.length || Math.random() < 0.3) c.s.emit("move", { type: "take" });
    else c.s.emit("move", { type: "defend", uid: rnd(opts).uid });
  } else if (v.phase === "throw" && v.youAttack) {
    const vals = core.tableVals(t);
    const opts = hand.filter((x) => !core.isNip(x) && vals.has(x.value));
    if (opts.length && t.length < v.limit && !v.nipUsed && Math.random() < 0.5)
      c.s.emit("move", { type: "throw", uid: rnd(opts).uid });
    else c.s.emit("move", { type: "bito" });
  } else if (v.phase === "pileOn" && v.youAttack) {
    const vals = core.tableVals(t);
    const opts = hand.filter((x) => !core.isNip(x) && vals.has(x.value));
    if (opts.length && Math.random() < 0.5)
      c.s.emit("move", { type: "throw", uid: rnd(opts).uid });
    else c.s.emit("move", { type: "done" });
  }
}

async function main() {
  const c1 = mkClient("Мурка", "test-token-aaaa-1111");
  const c2 = mkClient("Базіліо", "test-token-bbbb-2222");
  await new Promise((r) => setTimeout(r, 400));

  await new Promise((r) => c1.s.emit("hello", { token: c1.tok, nick: "мурка" }, (x) => { console.log("hello1:", JSON.stringify(x)); r(); }));
  await new Promise((r) => c2.s.emit("hello", { token: c2.tok, nick: "базіліо" }, (x) => { console.log("hello2:", JSON.stringify(x)); r(); }));

  const code = await new Promise((r) => c1.s.emit("createRoom", (x) => { console.log("кімната:", x.code); r(x.code); }));
  await new Promise((r) => c2.s.emit("joinRoom", { code }, (x) => { console.log("зайшов:", JSON.stringify(x)); r(); }));

  // чекаємо WANT_GAMES*2 фіналів (по одному на клієнта)
  const t0 = Date.now();
  while (gamesFinished < WANT_GAMES * 2) {
    if (Date.now() - t0 > 60_000) throw new Error("тест завис: " + gamesFinished);
    await new Promise((r) => setTimeout(r, 100));
  }

  const top = await new Promise((r) => c1.s.emit("top", r));
  console.log("рекорди:", JSON.stringify(top));
  if (!top.find((p) => p.nick === "мурка") || !top.find((p) => p.nick === "базіліо"))
    throw new Error("гравці не в таблиці!");
  const sum = top.filter(p => ["мурка","базіліо"].includes(p.nick)).reduce((a,p)=>a+p.rating,0);
  console.log("сума рейтингів двох (має бути 2000):", sum);
  if (sum !== 2000) throw new Error("Ело не нульова сума!");
  console.log("ТЕСТ OK: " + WANT_GAMES + " партії зіграно, рейтинг рахується, таблиця живе. няв.");
  c1.s.close(); c2.s.close();
  process.exit(0);
}

main().catch((e) => { console.error("ТЕСТ ВПАВ:", e.message); process.exit(1); });
