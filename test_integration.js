/* інтеграційний тест v2:
   A) стіл на трьох: кімната → старт хостом → повна партія → місця й очки
   B) баг-фікс: 1v1, B закриває вкладку, A тисне «вийти» → перемога A, поразка B */
const { io } = require("socket.io-client");
const core = require("./core");

const URL = "http://localhost:3111";
const rnd = (a) => a[(Math.random() * a.length) | 0];

function mkClient(name, tok) {
  const s = io(URL, { transports: ["websocket"] });
  const c = { s, name, tok, view: null, lastResult: null, auto: true };
  s.on("state", (v) => {
    c.view = v;
    if (v.result) c.lastResult = v.result;
    if (c.auto) setTimeout(() => act(c), 10);
  });
  return c;
}

function act(c) {
  const v = c.view;
  if (!v || !v.started || v.result || !v.you.active) return;
  if (v.phase === "nyav") {
    if (v.nyav?.inSet && !v.nyav.youPicked) c.s.emit("nyav", { sign: rnd(core.NYAV) });
    return;
  }
  const t = v.table, hand = v.you.hand;
  if (v.phase === "attack" && v.you.role === "attack") {
    c.s.emit("move", { type: "attack", uid: rnd(hand).uid });
  } else if (v.phase === "defend" && v.you.role === "defend") {
    const i = core.undefIdx(t);
    if (i < 0) return;
    const opts = hand.filter((x) => core.canBeat(t[i].a, x));
    if (!opts.length || Math.random() < 0.3) c.s.emit("move", { type: "take" });
    else c.s.emit("move", { type: "defend", uid: rnd(opts).uid });
  } else if ((v.phase === "throw" || v.phase === "pileOn") && v.you.role !== "defend" && !v.you.passed) {
    const vals = core.tableVals(t);
    const opts = hand.filter((x) => !core.isNip(x) && vals.has(x.value));
    if (opts.length && t.length < v.limit && !v.nipUsed && Math.random() < 0.5)
      c.s.emit("move", { type: "throw", uid: rnd(opts).uid });
    else c.s.emit("move", { type: "pass" });
  }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms, what) {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error("таймаут: " + what);
    await wait(80);
  }
}

async function testTrio() {
  console.log("── тест A: стіл на трьох ──");
  const cs = [
    mkClient("Мурка", "trio-token-aaaa-1111"),
    mkClient("Базіліо", "trio-token-bbbb-2222"),
    mkClient("Жабокіт", "trio-token-cccc-3333"),
  ];
  await wait(300);
  for (const [i, c] of cs.entries())
    await new Promise((r) => c.s.emit("hello", { token: c.tok, nick: ["мурка", "базіліо", "жабокіт"][i] }, r));
  const code = await new Promise((r) => cs[0].s.emit("createRoom", (x) => r(x.code)));
  for (const c of cs.slice(1))
    await new Promise((r) => c.s.emit("joinRoom", { code }, (x) => { if (x.error) throw new Error(x.error); r(); }));
  await until(() => cs[0].view?.players?.length === 3, 3000, "лобі на трьох");
  cs[0].s.emit("startGame");
  await until(() => cs.every((c) => c.lastResult), 90_000, "фінал на трьох");
  const r0 = cs[0].lastResult;
  console.log("місця:", r0.standings.map((s) => `${s.place}. ${s.nick} (${s.delta >= 0 ? "+" : ""}${s.delta})`).join(" · "));
  const places = r0.standings.map((s) => s.place);
  if (Math.min(...places) !== 1) throw new Error("нема першого місця");
  if (places.length !== 3) throw new Error("не всі в підсумках");
  const winner = cs.find((c) => c.lastResult.standings.find((s) => s.you && s.place === 1));
  if (winner) {
    const me = winner.lastResult;
    console.log(`переможець ${winner.name}: +${me.spDelta}, бусти: [${me.boosts.join(", ")}], звання «${me.rank}»`);
    if (me.spDelta <= 0) throw new Error("переможець без очок!");
    if (!me.boosts.some((b) => b.includes("швидкість"))) throw new Error("швидкісний буст не спрацював на швидкій партії!");
    if (!me.boosts.some((b) => b.includes("новачок"))) throw new Error("новачковий буст не спрацював!");
  }
  cs.forEach((c) => c.s.close());
  console.log("тест A OK\n");
}

async function testLeaveBug() {
  console.log("── тест B: втеча з вкладки ──");
  const a = mkClient("Чекач", "bug-token-aaaa-1111");
  const b = mkClient("Втікач", "bug-token-bbbb-2222");
  a.auto = false; b.auto = false; // граємо вручну
  await wait(300);
  await new Promise((r) => a.s.emit("hello", { token: a.tok, nick: "чекач" }, r));
  await new Promise((r) => b.s.emit("hello", { token: b.tok, nick: "втікач" }, r));
  const code = await new Promise((r) => a.s.emit("createRoom", (x) => r(x.code)));
  await new Promise((r) => b.s.emit("joinRoom", { code }, r));
  await until(() => a.view?.players?.length === 2, 3000, "лобі 1v1");
  a.s.emit("startGame");
  await until(() => a.view?.started, 3000, "старт 1v1");
  // втікач закриває вкладку посеред гри
  b.s.close();
  await wait(500);
  // чекач не хоче чекати 10 хв — тисне «вийти з матчу»
  a.s.emit("leaveRoom");
  await until(() => a.lastResult, 5000, "результат для чекача");
  const my = a.lastResult.standings.find((s) => s.you);
  console.log(`чекач: місце ${my.place}, Δ${my.delta}, "${a.lastResult.big}"`);
  if (my.place !== 1) throw new Error("БАГ ЖИВИЙ: чекач не на 1 місці!");
  if (my.delta <= 0) throw new Error("БАГ ЖИВИЙ: чекач втратив очки!");
  const runaway = a.lastResult.standings.find((s) => !s.you);
  if (runaway.delta >= 0) throw new Error("втікач не покараний!");
  a.s.close();
  console.log("тест B OK: чекач переміг, втікач заплатив.\n");
}

(async () => {
  await testTrio();
  await testLeaveBug();
  console.log("УСІ ТЕСТИ OK. няв.");
  process.exit(0);
})().catch((e) => { console.error("ТЕСТ ВПАВ:", e.message); process.exit(1); });
