const core = require("./core");
const { io } = require("socket.io-client");
const URL = "http://localhost:" + (process.env.PORT || 3111);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms, what) {
  const t0 = Date.now();
  while (!fn()) { if (Date.now() - t0 > ms) throw new Error("таймаут: " + what); await wait(70); }
}
const rnd = (a) => a[(Math.random() * a.length) | 0];

function mkClient(tok, auto) {
  const s = io(URL, { transports: ["websocket"] });
  const c = { s, tok, view: null };
  s.on("state", (v) => { c.view = v; if (auto) setTimeout(() => act(c), 15); });
  return c;
}

/* автогра за людину — так само, як у test_integration.js */
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
    const opts = hand.filter((x) => core.canBeat(t[i].a, x, v.glitch?.active && v.glitch.kind === "prey_swap"));
    if (!opts.length || Math.random() < 0.3) c.s.emit("move", { type: "take" });
    else c.s.emit("move", { type: "defend", uid: rnd(opts).uid });
  } else if ((v.phase === "throw" || v.phase === "pileOn") && v.you.role !== "defend" && !v.you.passed) {
    const vals = core.tableVals(t);
    const anyVal = v.glitch?.active && v.glitch.kind === "throw_any";
    const opts = hand.filter((x) => !core.isNip(x) && (anyVal || vals.has(x.value)));
    if (opts.length && t.length < v.limit && !v.nipUsed && Math.random() < 0.5)
      c.s.emit("move", { type: "throw", uid: rnd(opts).uid });
    else c.s.emit("move", { type: "pass" });
  }
}

async function testPve() {
  console.log("── тест C: ПвЕ проти жабки ґрега ──");
  const a = mkClient("pve-token-aaaa-1111", true);
  await wait(200);
  await new Promise((r) => a.s.emit("hello", { token: a.tok, nick: "самотній" }, r));
  const prof = await new Promise((r) => a.s.emit("profileInfo", r));
  const spBefore = prof.sp;
  await new Promise((r, rej) => a.s.emit("playGreg", {}, (x) => x.error ? rej(new Error(x.error)) : r(x)));
  await until(() => a.view?.started, 3000, "старт ПвЕ");
  if (!a.view.others.some((o) => o.nick === "жабка ґреґ")) throw new Error("ґреґ не сів за стіл");
  await until(() => a.view?.result, 30_000, "фінал ПвЕ");
  if (a.view.result.spDelta !== 0) throw new Error("ПвЕ вплинуло на рейтинг! delta=" + a.view.result.spDelta);
  const profAfter = await new Promise((r) => a.s.emit("profileInfo", r));
  if (profAfter.sp !== spBefore) throw new Error("рейтинг змінився після ПвЕ: " + spBefore + " → " + profAfter.sp);
  if (profAfter.games !== prof.games) throw new Error("лічильник ігор зріс від ПвЕ!");
  console.log("ПвЕ дограно, рейтинг незмінний:", profAfter.sp, "· тест C OK\n");
  a.s.close();
}

async function testDaily() {
  console.log("── тест D: стіл дня — одна спроба ──");
  const a = mkClient("daily-token-bbbb-2222", true);
  await wait(200);
  await new Promise((r) => a.s.emit("hello", { token: a.tok, nick: "днювальник" }, r));
  const info1 = await new Promise((r) => a.s.emit("dailyInfo", r));
  if (info1.played) throw new Error("вже зіграно до першої спроби?!");
  await new Promise((r, rej) => a.s.emit("playDaily", {}, (x) => x.error ? rej(new Error(x.error)) : r(x)));
  await until(() => a.view?.started, 3000, "старт столу дня");
  await until(() => a.view?.result, 30_000, "фінал столу дня");
  a.s.emit("leaveRoom");
  await wait(200);
  const info2 = await new Promise((r) => a.s.emit("dailyInfo", r));
  if (!info2.played) throw new Error("стіл дня не позначився зіграним");
  const again = await new Promise((r) => a.s.emit("playDaily", {}, r));
  if (again?.error !== "already") throw new Error("повторна спроба не заблокована: " + JSON.stringify(again));
  if (!info2.board.some((e) => e.nick === "днювальник")) throw new Error("гравця нема на денній дошці");
  console.log("одна спроба на добу дотримана, дошка оновлена · тест D OK\n");
  a.s.close();
}

async function testBet() {
  console.log("── тест E: ставка няву ──");
  const a = mkClient("bet-token-cccc-3333", false);
  const b = mkClient("bet-token-dddd-4444", false);
  await wait(200);
  await new Promise((r) => a.s.emit("hello", { token: a.tok, nick: "ставкар1" }, r));
  await new Promise((r) => b.s.emit("hello", { token: b.tok, nick: "ставкар2" }, r));
  const code = await new Promise((r) => a.s.emit("createRoom", (x) => r(x.code)));
  await new Promise((r) => b.s.emit("joinRoom", { code }, r));
  await until(() => a.view?.players?.length === 2, 3000, "лобі 1v1");
  a.s.emit("startGame", { bet: true });
  await until(() => a.view?.bet?.phase === "pick", 3000, "фаза ставки");
  // обидва грають лапка/лапка — тай, тому пробуємо, доки не буде переможець (макс 6 спроб)
  let tries = 0, resolved = false;
  while (!resolved && tries++ < 8) {
    const sa = ["lapka", "kihot", "khvist"][tries % 3];
    const sb = ["kihot", "khvist", "lapka"][tries % 3];
    a.s.emit("betPick", { sign: sa, side: "k" });
    b.s.emit("betPick", { sign: sb, side: "k" });
    try { await until(() => a.view?.bet?.phase === "done" || !a.view?.bet, 2500, "резолюція ставки"); resolved = true; }
    catch (e) { await wait(200); }
  }
  if (!resolved) throw new Error("ставка не резолвнулась за розумну кількість спроб");
  await until(() => a.view?.started && !a.view?.bet, 4000, "старт матчу після ставки");
  console.log("ставка розв'язалась, матч стартував після паузи · тест E OK\n");
  a.s.close(); b.s.close();
}

async function testAmb() {
  console.log("── тест F: амбасадори в ПвЕ ──");
  const seen = new Set();
  let sawChat = false, sawAch = false;
  for (let i = 0; i < 8 && (seen.size < 2 || !sawChat); i++) {
    const a = mkClient("amb-token-" + i + "-eeee", true);
    await wait(150);
    await new Promise((r) => a.s.emit("hello", { token: a.tok, nick: "амб" + i }, r));
    a.s.on("chat", (e) => { if (e.nick.includes("ґреґ") || e.nick.includes("жреґ")) sawChat = true; });
    const res = await new Promise((r) => a.s.emit("playGreg", {}, r));
    if (res?.amb) seen.add(res.amb);
    await until(() => a.view?.started, 3000, "старт ПвЕ");
    await until(() => a.view?.result, 30_000, "фінал ПвЕ");
    if (a.view.result.newAch?.length) sawAch = true;
    if (a.view.result.spDelta !== 0) throw new Error("ПвЕ вплинуло на рейтинг!");
    a.s.emit("leaveRoom");
    a.s.close();
    await wait(120);
  }
  if (seen.size < 2) throw new Error("за 8 партій не випали обидва амбасадори: " + [...seen]);
  if (!sawChat) throw new Error("амбасадор жодного разу не написав у чат");
  if (!sawAch) throw new Error("ПвЕ-досягнення жодного разу не видались");
  console.log("обидва амбасадори (" + [...seen].join(", ") + "), чат і ПвЕ-ачівки працюють · тест F OK\n");
}

async function testGlitchQueue() {
  console.log("── тест G: матчмейкінг за режимом збою ──");
  const a = mkClient("gq-token-aaaa", false);
  const b = mkClient("gq-token-bbbb", false);
  await wait(200);
  await new Promise((r) => a.s.emit("hello", { token: a.tok, nick: "збійний" }, r));
  await new Promise((r) => b.s.emit("hello", { token: b.tok, nick: "звичайний" }, r));
  const ra = await new Promise((r) => a.s.emit("quickMatch", { glitch: true }, r));
  if (!ra?.queued) throw new Error("гравець зі збоєм мав стати в чергу");
  const rb = await new Promise((r) => b.s.emit("quickMatch", { glitch: false }, r));
  if (!rb?.queued) throw new Error("режими різні — з'єднувати не можна було!");
  const info = await new Promise((r) => a.s.emit("queueInfo", r));
  if (!info.otherModeWaiting) throw new Error("сервер не бачить гравця з іншим режимом");
  const c = mkClient("gq-token-cccc", false);
  await wait(150);
  await new Promise((r) => c.s.emit("hello", { token: c.tok, nick: "збійний2" }, r));
  const rc = await new Promise((r) => c.s.emit("quickMatch", { glitch: true }, r));
  if (!rc?.code) throw new Error("двоє зі збоєм мали зматчитись, а не стати в чергу");
  console.log("різні режими не змішуються, однакові — матчаться · тест G OK\n");
  a.s.emit("leaveRoom"); c.s.emit("leaveRoom");
  a.s.close(); b.s.close(); c.s.close();
}

(async () => {
  await testPve();
  await testDaily();
  await testBet();
  await testAmb();
  await testGlitchQueue();
  console.log("УСІ ТЕСТИ v8+v11 OK. няв.");
  process.exit(0);
})().catch((e) => { console.error("ТЕСТ ВПАВ:", e.message); process.exit(1); });
