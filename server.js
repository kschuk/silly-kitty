/* ════════════════════════════════════════════════
   ДУР-КИЦЬ · онлайн-сервер v4 · столи 2–5
   ════════════════════════════════════════════════ */

const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");
const core = require("./core");
const store = require("./store");
let GREG = [];
try { GREG = require("./greg"); } catch (e) { GREG = ["няв? квак."]; }

const PORT = process.env.PORT || 3000;
const RECONNECT_MS = 10 * 60_000;
const IDLE_ATTACK_MS = 180_000;
const IDLE_SOFT_MS = 90_000;

/* очки: база + веселі модифікатори (лише до плюса) */
const P = { WIN: 25, MID: 5, LOSS: -15, SHARED_TOP: 10 };
const BONUS = { SPEED: 10, NIP_FINAL: 5, FULL_TABLE: 5, DRY: 5, STREAK: 5 };
const SPEED_MS = 5 * 60_000;
/* анти-накрутка */
const OVERHEAT_STREAK = 7;      // 7+ перемог поспіль → плюс ×0.25
const OVERHEAT_MULT = 0.25;
const FASTWIN_MS = 60_000;      // перемога швидше хвилини
const FASTWIN_LIMIT = 3;        // три поспіль → бан
const BAN_MS = 4 * 60_000 + 20_000; // 4:20
const RANK_SHOW_GAMES = 10;

const AVATARS = ["cat_black", "cat_white", "cat_rudy", "frog_green", "frog_violet", "frog_blue"];

/* досягнення: челенж → унікальне звання ✎ */
const ACH = {
  blyskavka:   { name: "блискавка",     desc: "перемога швидше 3 хвилин" },
  nipdyp:      { name: "ніп-дипломат",  desc: "вийти з партії ніп-виходом" },
  sukha:       { name: "суха лапка",    desc: "перемога, не взявши зі столу жодного разу" },
  pyatykut:    { name: "п'ятикутник",   desc: "перемога за столом на п'ятьох" },
  seriya:      { name: "хвиля няву",    desc: "три перемоги поспіль" },
  maraton:     { name: "марафонець",    desc: "дожити до кінця партії, довшої за 15 хвилин" },
  kolektsioner:{ name: "колекціонер",   desc: "забрати 20+ карт за партію і не стати дур-кицем" },
  nyavmaster:  { name: "нявмайстер",    desc: "виграти няв-няв-няв двічі за одну партію" },
  feniks:      { name: "фенікс",        desc: "перемога після трьох і більше заборів" },
};
const TITLE_IDS = Object.keys(ACH);

const app = express();
app.use(express.static(path.join(__dirname, "public")));
app.get("/health", (_q, r) => r.json({ ok: true }));
app.get("/top", (_q, r) =>
  r.json(store.top(50).map((p) => ({ ...p, rank: core.rankOf(p.sp) })))
);

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const rooms = new Map();
const byToken = new Map();
let queue = [];

const CODE_ABC = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function newCode() {
  let c;
  do { c = Array.from({ length: 4 }, () => CODE_ABC[(Math.random() * CODE_ABC.length) | 0]).join(""); }
  while (rooms.has(c));
  return c;
}

function newGame(code) {
  return {
    code, players: {}, order: [],
    state: null, nyavPicks: {}, rematch: {}, chat: [],
    takes: {}, cardsTaken: {}, nyavWins: {}, newAch: {}, banNote: {},
    lastSide: {}, coinNotes: {}, feeNote: {},
    startedAt: 0, finished: false, settled: false, deltas: null, boosts: null,
  };
}

const seatOf = (g, token) =>
  Object.keys(g.players).find((s) => g.players[s].token === token) || null;
const nickOf = (g, seat) => g.players[seat]?.nick || "хтось";

function tagOf(g, seat) {
  const p = store.get(g.players[seat]?.token);
  if (!p) return "";
  if (p.title === "none") return "";
  if (p.title && ACH[p.title] && p.ach.includes(p.title)) return ` [${ACH[p.title].name}]`;
  return ` [${core.rankOf(p.sp)}]`;
}
const avatarOf = (g, seat) => store.get(g.players[seat]?.token)?.avatar || "cat_black";

function banLeft(token) {
  const p = store.get(token);
  if (!p || !p.banUntil) return 0;
  return Math.max(0, p.banUntil - Date.now());
}

/* ── очки, анти-накрутка, історія, досягнення ── */

function settle(game) {
  if (game.settled || !game.state?.result) return;
  game.settled = true;
  game.finished = true;
  const st = game.state;
  const seats = st.seats;
  const dur = Date.now() - game.startedAt;
  const topShared = seats.filter((x) => st.places[x] === 1).length > 1;
  const last = Math.max(...seats.map((x) => st.places[x]));
  game.deltas = {}; game.boosts = {}; game.newAch = {}; game.banNote = {};

  for (const seat of seats) {
    const tok = game.players[seat].token;
    const p = store.get(tok);
    const pl = st.places[seat];
    const won = pl === 1 && !topShared;
    let d = pl === 1 ? (topShared ? P.SHARED_TOP : P.WIN) : pl === last ? P.LOSS : P.MID;
    const boosts = [];
    if (d > 0) {
      if (dur < SPEED_MS) { d += BONUS.SPEED; boosts.push(`швидка партія +${BONUS.SPEED}`); }
      if (won && st.exitKind[seat] === "nip") { d += BONUS.NIP_FINAL; boosts.push(`ніп-фінал +${BONUS.NIP_FINAL}`); }
      if (won && seats.length === 5) { d += BONUS.FULL_TABLE; boosts.push(`повний стіл +${BONUS.FULL_TABLE}`); }
      if (won && !(game.takes[seat] > 0)) { d += BONUS.DRY; boosts.push(`сухо +${BONUS.DRY}`); }
      const prosp = won ? (p.streak || 0) + 1 : 0;
      if (prosp >= 3 && prosp < OVERHEAT_STREAK) { d += BONUS.STREAK; boosts.push(`серія +${BONUS.STREAK}`); }
      if (prosp >= OVERHEAT_STREAK) { d = Math.max(1, Math.round(d * OVERHEAT_MULT)); boosts.push(`перегрів серії ×${OVERHEAT_MULT}`); }
    }
    game.deltas[seat] = d;
    game.boosts[seat] = boosts;
  }

  store.applyMatch(seats.map((seat) => ({
    token: game.players[seat].token,
    delta: game.deltas[seat],
    won: st.places[seat] === 1 && !topShared,
    drew: st.places[seat] === 1 && topShared,
  })));

  for (const seat of seats) {
    const tok = game.players[seat].token;
    const p = store.get(tok);
    const won = st.places[seat] === 1 && !topShared;

    /* правило 4:20 — три перемоги поспіль швидше хвилини */
    if (won && dur < FASTWIN_MS) {
      p.fastWins = (p.fastWins || 0) + 1;
      if (p.fastWins >= FASTWIN_LIMIT) {
        p.banUntil = Date.now() + BAN_MS;
        p.fastWins = 0;
        game.banNote[seat] = "правило 4:20 — три блискавичні перемоги поспіль. охолонь 4 хв 20 с.";
      }
    } else if (won) p.fastWins = 0;
    else p.fastWins = 0;

    /* історія матчів */
    store.pushHist(tok, {
      ts: Date.now(), dur,
      delta: game.deltas[seat],
      place: st.places[seat], n: seats.length,
      opps: seats.filter((x) => x !== seat).map((x) => nickOf(game, x)),
      streak: p.streak || 0,
    });

    /* досягнення */
    const got = [];
    const tryAch = (id, cond) => { if (cond && store.award(tok, id)) got.push(ACH[id].name); };
    tryAch("blyskavka", won && dur < 180_000);
    tryAch("nipdyp", st.exitKind[seat] === "nip");
    tryAch("sukha", won && !(game.takes[seat] > 0));
    tryAch("pyatykut", won && seats.length === 5);
    tryAch("seriya", (p.streak || 0) >= 3);
    tryAch("maraton", dur >= 15 * 60_000 && st.exitKind[seat] !== "drop" && st.exitKind[seat] !== "dc" && st.exitKind[seat] !== "idle");
    tryAch("kolektsioner", (game.cardsTaken[seat] || 0) >= 20 && st.places[seat] < last);
    tryAch("nyavmaster", (game.nyavWins[seat] || 0) >= 2);
    tryAch("feniks", won && (game.takes[seat] || 0) >= 3);
    game.newAch[seat] = got;

    /* жетони киць / анти-киць */
    if (!p.tk) p.tk = { k: 100, a: 100 };
    const notes = [];
    const sideUa = (x) => (x === "kyts" || x === "k" ? "ж.к" : "ж.а");
    const sideKey = (x) => (x === "kyts" || x === "k" ? "k" : "a");
    if (won) {
      const side = game.lastSide[seat] || "kyts";
      p.tk[sideKey(side)] += 3;
      notes.push(`+3 ${sideUa(side)} — перемога ${side === "kyts" ? "кицями" : "анти-кицями"}`);
    } else if (st.places[seat] === 1 && topShared) {
      p.tk.k += 1; p.tk.a += 1;
      notes.push("+1 ж.к і +1 ж.а — нічия нагорі");
    } else if (st.places[seat] === last) {
      const rndSide = Math.random() < 0.5 ? "k" : "a";
      p.tk[rndSide] += 1;
      notes.push(`+1 ${sideUa(rndSide)} — жетон співчуття`);
    }
    if (st.exitKind[seat] === "nip") {
      const nip = st.hands[seat]?.[0];
      const serve = nip && nip.prey === "kyts" ? "a" : "k";
      p.tk[serve] += 2;
      notes.push(`+2 ${sideUa(serve)} — ніп-вихід`);
    }
    if (got.length) {
      p.tk.k += 5 * got.length; p.tk.a += 5 * got.length;
      notes.push(`+${5 * got.length} ж.к і +${5 * got.length} ж.а — нові звання`);
    }
    game.coinNotes[seat] = notes;
  }
  store.dirty();
}

/* ── тексти ── */

const nyavUa = { lapka: "лапка", kihot: "кіготь", khvist: "хвіст" };
const nyavVerb = { lapka: "притискає", kihot: "чіпляє", khvist: "вислизає з-під" };
const nyavGen = { lapka: "лапки", kihot: "кігтя", khvist: "хвоста" };

function exitText(kind, mine, nick) {
  if (kind === "shed") return mine ? "ти скинув усі карти. вийшов!" : `${nick} скинув усі карти.`;
  if (kind === "nip") return mine ? "останній ніп у руці! ніп-вихід." : `${nick}: останній ніп. ніп-вихід.`;
  if (kind === "durkyts") return mine ? "ти — дур-киць. буває." : `${nick} — дур-киць.`;
  return mine ? "тебе викинуло з гри." : `${nick} покинув гру.`;
}

function resultView(game, seat) {
  const st = game.state;
  const myPlace = st.places[seat];
  const shared = st.seats.filter((x) => st.places[x] === myPlace).length > 1;
  const kind = st.exitKind[seat];
  let big, text;
  if (kind === "drop" || kind === "dc" || kind === "idle") { big = "ТЕХНІЧНИЙ ВИХІД"; text = "тебе не дочекались."; }
  else if (myPlace === 1 && shared) { big = "НІЧИЯ НАГОРІ"; text = "поділили вершину. підозріло."; }
  else if (myPlace === 1) { big = kind === "nip" ? "НІП-ПЕРЕМОГА" : "ПЕРЕМОГА"; text = kind === "nip" ? "останній ніп у руці, добір пустий!" : "стіл твій. вітаю."; }
  else if (kind === "durkyts") { big = "ТИ — ДУР-КИЦЬ"; text = "останній з картами. буває."; }
  else { big = `${myPlace}-Е МІСЦЕ`; text = kind === "nip" ? "ніп-вихід. елегантно." : "непогано."; }
  const p = store.get(game.players[seat].token);
  return {
    big, text,
    standings: st.result.standings.map((x) => ({
      nick: nickOf(game, x) + tagOf(game, x),
      avatar: avatarOf(game, x),
      place: st.places[x],
      delta: game.deltas ? game.deltas[x] : 0,
      you: x === seat,
    })),
    spDelta: game.deltas ? game.deltas[seat] : 0,
    boosts: game.boosts ? game.boosts[seat] : [],
    newAch: game.newAch ? game.newAch[seat] : [],
    coinNotes: game.coinNotes ? game.coinNotes[seat] || [] : [],
    tk: store.get(game.players[seat].token)?.tk || { k: 0, a: 0 },
    banNote: game.banNote ? game.banNote[seat] || "" : "",
    sp: p?.sp ?? 0,
    rank: core.rankOf(p?.sp ?? 0),
    dur: game.startedAt ? Date.now() - game.startedAt : 0,
  };
}

function viewFor(game, seat, msg = "") {
  const st = game.state;
  const p = store.get(game.players[seat].token);
  const others = (st ? st.seats : game.order).filter((x) => x !== seat).map((x) => {
    const pl = game.players[x];
    return {
      seat: x, nick: pl.nick, tag: tagOf(game, x), avatar: avatarOf(game, x),
      handCount: st ? st.hands[x].length : 0,
      connected: pl.connected,
      active: st ? st.active.includes(x) : true,
      role: st ? (st.attacker === x ? "attack" : st.defender === x ? "defend" : null) : null,
      passed: st ? st.passes.includes(x) : false,
      place: st ? st.places[x] ?? null : null,
    };
  });
  return {
    code: game.code, seat,
    host: game.order[0] === seat,
    started: !!st,
    startedAt: game.startedAt,
    players: game.order.map((x) => ({
      nick: nickOf(game, x), tag: tagOf(game, x), avatar: avatarOf(game, x),
      you: x === seat, host: x === game.order[0],
    })),
    chat: game.chat,
    you: {
      nick: game.players[seat].nick, tag: tagOf(game, seat), avatar: avatarOf(game, seat),
      sp: p?.sp ?? 0, rank: core.rankOf(p?.sp ?? 0),
      games: p?.games ?? 0, achIds: p?.ach ?? [], title: p?.title ?? "",
      tk: p?.tk || { k: 0, a: 0 },
      hand: st ? st.hands[seat] : [],
      active: st ? st.active.includes(seat) : true,
      role: st ? (st.attacker === seat ? "attack" : st.defender === seat ? "defend" : "thrower") : null,
      passed: st ? st.passes.includes(seat) : false,
      place: st ? st.places[seat] ?? null : null,
    },
    others,
    deckCount: st ? st.deck.length : 0,
    discard: st ? st.discard : 0,
    table: st ? st.table : [],
    phase: st ? st.phase : "lobby",
    limit: st ? st.limit : 6,
    nipUsed: st ? st.nipUsed : false,
    nyav: st?.phase === "nyav"
      ? { inSet: st.nyavSet.includes(seat), youPicked: !!game.nyavPicks[seat], set: st.nyavSet.map((x) => nickOf(game, x)) }
      : null,
    msg,
    result: st?.result ? resultView(game, seat) : null,
  };
}

function pushState(game, msgFn) {
  for (const seat of Object.keys(game.players)) {
    const p = game.players[seat];
    if (p?.socketId)
      io.to(p.socketId).emit("state", viewFor(game, seat, msgFn ? msgFn(seat) : ""));
  }
}

/* ── життєвий цикл ── */

function startDeal(game) {
  game.state = core.deal(game.order);
  game.nyavPicks = {}; game.rematch = {};
  game.takes = {}; game.cardsTaken = {}; game.nyavWins = {}; game.newAch = {}; game.banNote = {};
  game.finished = false; game.settled = false; game.deltas = null; game.boosts = null;
  game.startedAt = Date.now();
  game.lastSide = {}; game.coinNotes = {};
  for (const s of Object.keys(game.players)) game.players[s].lastAct = Date.now();
  const f = game.state.first;
  if (f.type === "low")
    pushState(game, (seat) => seat === f.seat
      ? `найменша карта (${f.val}) у тебе. атакуй.`
      : `найменша карта (${f.val}) у ${nickOf(game, f.seat)}.`);
  else
    pushState(game, (seat) => f.seats.includes(seat)
      ? "найменші карти рівні. няв-няв-няв: обери знак."
      : `няв-няв-няв між: ${f.seats.map((x) => nickOf(game, x)).join(", ")}. спостерігай.`);
}

function endAndSettle(game) { settle(game); pushState(game); scheduleCleanup(game); }

function scheduleCleanup(game) {
  setTimeout(() => {
    if (rooms.get(game.code) === game && game.finished && !game.rematched) {
      for (const s of Object.keys(game.players)) {
        const t = game.players[s].token;
        if (byToken.get(t) === game.code) byToken.delete(t);
      }
      rooms.delete(game.code);
    }
  }, 10 * 60_000);
}

function dropFromGame(game, seat, reason) {
  if (!game.state || game.finished) return;
  const nick = nickOf(game, seat);
  const r = core.dropPlayer(game.state, seat, reason);
  if (!r.gone) return;
  const t = game.players[seat].token;
  if (byToken.get(t) === game.code && reason !== "dc") byToken.delete(t);
  if (game.state.result) endAndSettle(game);
  else pushState(game, (s) => (s === seat ? "ти поза грою." : `${nick} вибуває. граємо далі.`));
}

/* ── socket.io ── */

io.on("connection", (socket) => {
  let token = null;

  socket.on("hello", ({ token: t, nick }, cb) => {
    if (typeof t !== "string" || t.length < 8 || t.length > 64) return cb?.({ error: "поганий жетон." });
    nick = String(nick || "").trim().slice(0, 12);
    if (nick.length < 2) return cb?.({ error: "нік закороткий." });
    token = t;
    const p = store.getOrCreate(token, nick);
    socket.data.token = token;
    const code = byToken.get(token);
    const game = code ? rooms.get(code) : null;
    const profile = {
      nick: p.nick, sp: p.sp, rank: core.rankOf(p.sp), games: p.games,
      achIds: p.ach || [], avatar: p.avatar, title: p.title, streak: p.streak,
      tk: p.tk || { k: 100, a: 100 },
    };
    if (game && !game.finished) {
      const seat = seatOf(game, token);
      if (seat) {
        game.players[seat].socketId = socket.id;
        game.players[seat].connected = true;
        game.players[seat].lastAct = Date.now();
        clearTimeout(game.players[seat].dcTimer);
        cb?.({ profile, resumed: true });
        pushState(game, (s) => (s === seat ? "з поверненням." : `${nickOf(game, seat)} повернувся.`));
        return;
      }
    }
    cb?.({ profile });
  });

  const ctx = () => {
    const code = token && byToken.get(token);
    const game = code && rooms.get(code);
    if (!game) return null;
    const seat = seatOf(game, token);
    return seat ? { game, seat } : null;
  };

  const banGuard = (cb) => {
    const left = banLeft(token);
    if (left > 0) {
      cb?.({ error: `правило 4:20 — охолонь ще ${Math.ceil(left / 1000)}с.` });
      return true;
    }
    return false;
  };

  socket.on("createRoom", (cb) => {
    if (!token) return cb?.({ error: "спершу hello." });
    if (banGuard(cb)) return;
    if (byToken.has(token)) return cb?.({ error: "ти вже в кімнаті." });
    const code = newCode();
    const game = newGame(code);
    game.players.A = { token, nick: store.get(token).nick, socketId: socket.id, connected: true, lastAct: Date.now() };
    game.order = ["A"];
    rooms.set(code, game);
    byToken.set(token, code);
    cb?.({ code });
    pushState(game);
  });

  socket.on("joinRoom", ({ code }, cb) => {
    if (!token) return cb?.({ error: "спершу hello." });
    if (banGuard(cb)) return;
    if (byToken.has(token)) return cb?.({ error: "ти вже в кімнаті." });
    code = String(code || "").toUpperCase().trim();
    const game = rooms.get(code);
    if (!game) return cb?.({ error: "кімнати нема. код точний?" });
    if (game.state) return cb?.({ error: "гра вже йде." });
    if (game.order.length >= core.MAX_SEATS) return cb?.({ error: "стіл повний (5)." });
    if (Object.values(game.players).some((p) => p.token === token)) return cb?.({ error: "сам із собою? няв." });
    const seat = core.SEATS_ALL.find((s) => !game.players[s]);
    game.players[seat] = { token, nick: store.get(token).nick, socketId: socket.id, connected: true, lastAct: Date.now() };
    game.order.push(seat);
    byToken.set(token, code);
    cb?.({ code });
    pushState(game, (s) => (s === seat ? "ти за столом. чекаємо старту." : `${nickOf(game, seat)} за столом.`));
  });

  socket.on("startGame", () => {
    const c = ctx();
    if (!c) return;
    const { game, seat } = c;
    if (game.state || game.order[0] !== seat || game.order.length < 2) return;
    startDeal(game);
  });

  socket.on("quickMatch", (cb) => {
    if (!token) return cb?.({ error: "спершу hello." });
    if (banGuard(cb)) return;
    if (byToken.has(token)) return cb?.({ error: "ти вже в кімнаті." });
    queue = queue.filter((q) => q.token !== token && io.sockets.sockets.has(q.socketId));
    const oppo = queue.find((q) => q.token !== token && banLeft(q.token) === 0);
    if (!oppo) { queue.push({ token, socketId: socket.id }); return cb?.({ queued: true }); }
    queue = queue.filter((q) => q !== oppo);
    const code = newCode();
    const game = newGame(code);
    game.players.A = { token: oppo.token, nick: store.get(oppo.token).nick, socketId: oppo.socketId, connected: true, lastAct: Date.now() };
    game.players.B = { token, nick: store.get(token).nick, socketId: socket.id, connected: true, lastAct: Date.now() };
    game.order = ["A", "B"];
    rooms.set(code, game);
    byToken.set(oppo.token, code);
    byToken.set(token, code);
    cb?.({ code });
    startDeal(game);
  });

  socket.on("leaveQueue", () => { queue = queue.filter((q) => q.token !== token); });

  /* чат кімнати — і в лобі, і під час партії */
  socket.on("chat", ({ text }) => {
    const c = ctx();
    if (!c) return;
    const { game, seat } = c;
    const pl = game.players[seat];
    const now = Date.now();
    if (pl.lastChat && now - pl.lastChat < 600) return;
    pl.lastChat = now;
    text = String(text || "").trim().slice(0, 120);
    if (!text) return;
    const entry = { nick: pl.nick, text, ts: now };
    game.chat.push(entry);
    if (game.chat.length > 40) game.chat.shift();
    for (const s of Object.keys(game.players)) {
      const pp = game.players[s];
      if (pp?.socketId) io.to(pp.socketId).emit("chat", entry);
    }
    const othersOnline = Object.keys(game.players)
      .filter((x) => x !== seat && game.players[x].connected);
    if (!othersOnline.length) {
      setTimeout(() => {
        if (rooms.get(game.code) !== game) return;
        const g = { nick: "жабка ґреґ", text: GREG[(Math.random() * GREG.length) | 0], ts: Date.now() };
        game.chat.push(g);
        if (game.chat.length > 40) game.chat.shift();
        const me = game.players[seat];
        if (me?.socketId) io.to(me.socketId).emit("chat", g);
      }, 1200);
    }
  });

  /* профіль: нік, аватар, активне звання */
  socket.on("setProfile", (data, cb) => {
    if (!token) return cb?.({ error: "спершу hello." });
    const p = store.setProfile(token, data || {}, AVATARS, TITLE_IDS.concat(["none"]));
    if (!p) return cb?.({ error: "нема профілю." });
    cb?.({ ok: true, profile: {
      nick: p.nick, sp: p.sp, rank: core.rankOf(p.sp), games: p.games,
      achIds: p.ach, avatar: p.avatar, title: p.title, streak: p.streak,
      tk: p.tk,
    }});
    const c = ctx();
    if (c) pushState(c.game);
  });

  socket.on("profileInfo", (cb) => {
    const p = token && store.get(token);
    if (!p) return cb?.(null);
    cb?.({
      nick: p.nick, sp: p.sp, rank: core.rankOf(p.sp), games: p.games,
      w: p.w, l: p.l, d: p.d, streak: p.streak,
      achIds: p.ach, avatar: p.avatar, title: p.title,
      tk: p.tk || { k: 0, a: 0 },
      hist: p.hist || [],
      pos: store.position(token),
    });
  });

  socket.on("nyav", ({ sign }) => {
    const c = ctx();
    if (!c || c.game.state?.phase !== "nyav") return;
    const { game, seat } = c;
    if (!core.NYAV.includes(sign) || !game.state.nyavSet.includes(seat) || game.nyavPicks[seat]) return;
    game.nyavPicks[seat] = sign;
    game.players[seat].lastAct = Date.now();
    const setNow = game.state.nyavSet;
    if (!setNow.every((x) => game.nyavPicks[x])) {
      pushState(game, (s) => (s === seat ? "знак прийнято. чекаємо решту." : `${nickOf(game, seat)} обрав знак.`));
      return;
    }
    const picks = {};
    for (const x of setNow) picks[x] = game.nyavPicks[x];
    const revealTxt = setNow.map((x) => `${nickOf(game, x)}: ${nyavUa[picks[x]]}`).join(" · ");
    const r = core.applyNyav(game.state, picks);
    game.nyavPicks = {};
    if (r.done) {
      game.nyavWins[r.winner] = (game.nyavWins[r.winner] || 0) + 1;
      const w = r.winner, ws = picks[w];
      const losers = setNow.filter((x) => x !== w);
      const ls = picks[losers[0]];
      const verdict = `${nyavUa[ws]} ${nyavVerb[ws]} ${nyavGen[ls]}.`;
      pushState(game, (s) => `${revealTxt}. ${verdict} ${s === w ? "атакуєш ти." : `атакує ${nickOf(game, w)}.`}`);
    } else {
      pushState(game, (s) =>
        `${revealTxt}. ще раз${game.state.nyavSet.includes(s) ? ": обери знак." : ` між: ${game.state.nyavSet.map((x) => nickOf(game, x)).join(", ")}.`}`);
    }
  });

  socket.on("move", ({ type, uid }) => {
    const c = ctx();
    if (!c || !c.game.state || c.game.finished) return;
    const { game, seat } = c;
    const s = game.state;
    const played = (type === "attack" || type === "defend" || type === "throw")
      ? s.hands[seat]?.find((x) => x.uid === uid) : null;
    let r = { ok: false };
    if (type === "attack") r = core.moveAttack(s, seat, uid);
    else if (type === "defend") r = core.moveDefend(s, seat, uid);
    else if (type === "take") r = core.moveTake(s, seat);
    else if (type === "throw") r = core.moveThrow(s, seat, uid);
    else if (type === "pass") r = core.movePass(s, seat);
    if (!r.ok) return;
    if (played)
      game.lastSide[seat] = core.isNip(played)
        ? (played.prey === "kyts" ? "anti" : "kyts")
        : played.side;
    game.players[seat].lastAct = Date.now();
    const me = nickOf(game, seat);
    const ev = r.ev;
    if (ev.type === "bout" && !ev.defended && ev.taker) {
      game.takes[ev.taker] = (game.takes[ev.taker] || 0) + 1;
      game.cardsTaken[ev.taker] = (game.cardsTaken[ev.taker] || 0) + ev.count;
    }
    let msgFn;
    if (ev.type === "attack")
      msgFn = (x) => x === seat
        ? (ev.nip ? "ніп на столі." : "атака пішла.")
        : (x === s.defender ? (ev.nip ? `${me} атакує ніпом. бий ніпом або бери.` : `${me} атакує. бий або бери.`) : `${me} атакує.`);
    else if (ev.type === "throw")
      msgFn = (x) => x === seat ? "підкинуто." : (x === s.defender ? `${me} підкидає. бий або бери.` : `${me} підкидає.`);
    else if (ev.type === "pileThrow")
      msgFn = () => `${me} докидає.`;
    else if (ev.type === "pass")
      msgFn = (x) => x === seat ? "пас прийнято." : `${me}: пас.`;
    else if (ev.type === "taking")
      msgFn = (x) => x === seat ? "береш. чекай докиду." : `${nickOf(game, s.defender)} бере. докинеш?`;
    else if (ev.type === "defend" && ev.allBeaten)
      msgFn = (x) => x === s.defender ? "відбито. хай вирішують." : "усе відбито. підкинеш чи пас?";
    else if (ev.type === "defend")
      msgFn = () => "побито. є ще.";
    else if (ev.type === "bout") {
      const base = ev.defended
        ? (ev.reason === "nip" ? "після ніпа не підкидають. бито."
          : ev.reason === "limit" ? "ліміт. бито."
          : ev.reason === "dry" ? "підкинути нічого. бито." : "бито.")
        : null;
      const exits = ev.exited?.length
        ? " " + ev.exited.map((x) => exitText(s.exitKind[x], false, nickOf(game, x))).join(" ")
        : "";
      msgFn = (x) => {
        let m = base ?? (ev.taker === x
          ? (ev.nipOnly ? "ти забираєш ніпа. тепер він твій." : `ти забираєш ${ev.count}.`)
          : (ev.nipOnly ? `${nickOf(game, ev.taker)} забирає ніпа.` : `${nickOf(game, ev.taker)} забирає ${ev.count}.`));
        m += exits;
        if (!s.result)
          m += s.attacker === x ? " твоя атака." : ` атакує ${nickOf(game, s.attacker)}.`;
        return m;
      };
      if (s.result) { settle(game); pushState(game, msgFn); scheduleCleanup(game); return; }
    }
    pushState(game, msgFn);
  });

  socket.on("rematch", () => {
    const c = ctx();
    if (!c || !c.game.finished) return;
    const { game, seat } = c;
    if (banLeft(token) > 0) {
      const p = game.players[seat];
      if (p?.socketId) io.to(p.socketId).emit("state", viewFor(game, seat, `правило 4:20 — охолонь ще ${Math.ceil(banLeft(token) / 1000)}с.`));
      return;
    }
    game.rematch[seat] = true;
    const everyone = game.order.filter((x) => game.players[x]?.connected);
    if (everyone.length >= 2 && everyone.every((x) => game.rematch[x])) {
      game.order = everyone;
      game.rematched = true;
      startDeal(game);
      game.rematched = false;
    } else {
      pushState(game, (x) => (x === seat ? "чекаємо згоди решти." : `${nickOf(game, seat)} хоче реванш.`));
    }
  });

  socket.on("leaveRoom", () => {
    const c = ctx();
    if (!c) return;
    const { game, seat } = c;
    if (game.state && !game.finished) {
      const goneFirst = game.state.active.filter((x) => x !== seat && !game.players[x].connected);
      for (const g of goneFirst) dropFromGame(game, g, "dc");
      if (game.state && !game.finished && game.state.active.includes(seat))
        dropFromGame(game, seat, "drop");
    }
    byToken.delete(token);
    if (!game.state) {
      delete game.players[seat];
      game.order = game.order.filter((x) => x !== seat);
      if (!game.order.length) rooms.delete(game.code);
      else pushState(game, () => "хтось передумав. чекаємо далі.");
    }
  });

  socket.on("shopBuy", ({ pay }, cb) => {
    const p = token && store.get(token);
    if (!p) return cb?.({ error: "нема профілю." });
    const side = pay === "a" ? "a" : "k";
    if (!p.tk || p.tk[side] < 1) return cb?.({ error: "у цій купці порожньо." });
    p.tk[side] -= 1;
    p.sp = Math.round((p.sp + 0.1) * 10) / 10;
    store.dirty();
    cb?.({ ok: true, sp: p.sp, tk: p.tk, rank: core.rankOf(p.sp) });
  });

  socket.on("top", (cb) => {
    const list = store.top(100).map((p) => ({ ...p, rank: core.rankOf(p.sp) }));
    cb?.({ list, mePos: token ? store.position(token) : null });
  });
  socket.on("achList", (cb) => cb?.(Object.entries(ACH).map(([id, a]) => ({ id, ...a }))));

  socket.on("disconnect", () => {
    queue = queue.filter((q) => q.socketId !== socket.id);
    if (!token) return;
    const code = byToken.get(token);
    const game = code && rooms.get(code);
    if (!game) return;
    const seat = seatOf(game, token);
    if (!seat || game.players[seat].socketId !== socket.id) return;
    game.players[seat].connected = false;
    if (game.state && !game.finished && game.state.active.includes(seat)) {
      pushState(game, (x) => (x === seat ? "" : `${nickOf(game, seat)} зник. чекаємо до 10 хв.`));
      game.players[seat].dcTimer = setTimeout(() => {
        if (!game.players[seat]?.connected) dropFromGame(game, seat, "dc");
      }, RECONNECT_MS);
    } else if (!game.state) {
      delete game.players[seat];
      game.order = game.order.filter((x) => x !== seat);
      byToken.delete(token);
      if (!game.order.length) rooms.delete(game.code);
      else pushState(game);
    }
  });
});

/* лагідні автодії при мовчанні */
setInterval(() => {
  const now = Date.now();
  for (const game of rooms.values()) {
    if (game.finished || !game.state) continue;
    const st = game.state;
    if (st.phase === "nyav") {
      for (const seat of st.nyavSet || []) {
        if (!game.nyavPicks[seat] && now - game.players[seat].lastAct > IDLE_SOFT_MS) {
          game.nyavPicks[seat] = core.NYAV[(Math.random() * 3) | 0];
          game.players[seat].lastAct = now;
          if (st.nyavSet.every((x) => game.nyavPicks[x])) {
            const picks = {};
            for (const x of st.nyavSet) picks[x] = game.nyavPicks[x];
            const r = core.applyNyav(st, picks);
            if (r.done) game.nyavWins[r.winner] = (game.nyavWins[r.winner] || 0) + 1;
            game.nyavPicks = {};
            pushState(game, () => "тиша — няв вирішив сам.");
          }
        }
      }
    } else if (st.phase === "attack") {
      if (now - game.players[st.attacker].lastAct > IDLE_ATTACK_MS)
        dropFromGame(game, st.attacker, "idle");
    } else if (st.phase === "defend") {
      if (now - game.players[st.defender].lastAct > IDLE_SOFT_MS * 2) {
        const r = core.moveTake(st, st.defender);
        game.players[st.defender].lastAct = now;
        if (r.ok) {
          if (r.ev?.type === "bout" && !r.ev.defended && r.ev.taker) {
            game.takes[r.ev.taker] = (game.takes[r.ev.taker] || 0) + 1;
            game.cardsTaken[r.ev.taker] = (game.cardsTaken[r.ev.taker] || 0) + r.ev.count;
          }
          if (st.result) endAndSettle(game);
          else pushState(game, () => `${nickOf(game, st.defender)} мовчить — бере.`);
        }
      }
    } else if (st.phase === "throw" || st.phase === "pileOn") {
      for (const seat of core.throwers(st)) {
        if (!st.passes.includes(seat) && now - game.players[seat].lastAct > IDLE_SOFT_MS) {
          const r = core.movePass(st, seat);
          game.players[seat].lastAct = now;
          if (r.ok && r.ev?.type === "bout" && !r.ev.defended && r.ev.taker) {
            game.takes[r.ev.taker] = (game.takes[r.ev.taker] || 0) + 1;
            game.cardsTaken[r.ev.taker] = (game.cardsTaken[r.ev.taker] || 0) + r.ev.count;
          }
          if (r.ok && st.result) { endAndSettle(game); break; }
          if (r.ok) pushState(game, () => `${nickOf(game, seat)} мовчить — пас.`);
        }
      }
    }
  }
}, 15_000);

server.listen(PORT, () => console.log(`дур-киць сервер v4 на :${PORT}. няв.`));
