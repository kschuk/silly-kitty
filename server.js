/* ════════════════════════════════════════════════
   ДУР-КИЦЬ · онлайн-сервер
   express + socket.io. руки живуть тут, клієнт бачить лише своє.
   ════════════════════════════════════════════════ */

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const core = require("./core");
const store = require("./store");

const PORT = process.env.PORT || 3000;
const RECONNECT_MS = 60_000;   // час на повернення після розриву
const IDLE_MS = 120_000;       // бездіяльність → технічна поразка

const app = express();
app.use(express.static(require("path").join(__dirname, "public")));
app.get("/health", (_q, r) => r.json({ ok: true }));
app.get("/top", (_q, r) => r.json(store.top(50)));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

/* ── стан сервера ── */
const rooms = new Map();          // code → game
const byToken = new Map();        // token → code активної гри
let queue = [];                   // швидка гра: [{token, socketId}]

const CODE_ABC = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function newCode() {
  let c;
  do { c = Array.from({ length: 4 }, () => CODE_ABC[(Math.random() * CODE_ABC.length) | 0]).join(""); }
  while (rooms.has(c));
  return c;
}

function newGame(code) {
  return {
    code,
    seats: { A: null, B: null },  // {token, nick, socketId, connected, lastAct}
    state: null,
    nyavPicks: { A: null, B: null },
    rematch: { A: false, B: false },
    finished: false,
    ratedApplied: false,
  };
}

function seatOf(game, token) {
  if (game.seats.A?.token === token) return "A";
  if (game.seats.B?.token === token) return "B";
  return null;
}

/* ── тексти. складаються тут, персонально для кожного сидіння ── */

const nyavUa = { lapka: "лапка", kihot: "кіготь", khvist: "хвіст" };
const nyavVerb = { lapka: "притискає", kihot: "чіпляє", khvist: "вислизає з-під" };
const nyavGen = { lapka: "лапки", kihot: "кігтя", khvist: "хвоста" };

function boutMsg(ev, youWereAttacker, oppNick) {
  if (ev.defended) {
    const base =
      ev.reason === "nip" ? "після ніпа не підкидають. бито." :
      ev.reason === "limit" ? "ліміт. бито." : "бито.";
    return base;
  }
  const what = ev.nipOnly ? "ніпа" : `${ev.count}`;
  return ev.taker === "you"
    ? (ev.nipOnly ? "ти забираєш ніпа. тепер він твій." : `ти забираєш ${what}.`)
    : (ev.nipOnly ? `${oppNick} забирає ніпа.` : `${oppNick} забирає ${what}.`);
}

function resultView(game, seat) {
  const r = game.state.result;
  const opp = game.seats[core.other(seat)]?.nick || "суперник";
  const mine = r.winner === seat, draw = r.winner === "draw";
  let big, text;
  if (r.kind === "forfeit") {
    big = mine ? "ТЕХНІЧНА ПЕРЕМОГА" : "ТЕХНІЧНА ПОРАЗКА";
    text = mine ? `${opp} зник. няв.` : "тебе не дочекались.";
  } else if (r.kind === "bothEmpty") { big = "НІЧИЯ"; text = "обидві руки порожні. підозріло."; }
  else if (r.kind === "bothNip") { big = "НІЧИЯ"; text = "в обох по останньому ніпу. няв."; }
  else if (r.kind === "nip") {
    big = mine ? "НІП-ПЕРЕМОГА" : `НІП-ПЕРЕМОГА: ${opp.toUpperCase()}`;
    text = mine ? "останній ніп у руці, добір пустий. автоматична перемога!" : `у ${opp} лишився останній ніп. так буває.`;
  } else {
    big = mine ? `${opp.toUpperCase()} — ДУР-КИЦЬ` : "ТИ — ДУР-КИЦЬ";
    text = mine ? "ти вийшов з гри першим. вітаю." : `${opp} вийшов першим. буває.`;
  }
  const me = store.get(game.seats[seat].token);
  return {
    big, text, draw, win: mine,
    ratingDelta: game.deltas ? game.deltas[seat] : 0,
    rating: me?.rating ?? 1000,
    rank: core.rankOf(me?.rating ?? 1000),
  };
}

/* персональний вид стану для сидіння */
function viewFor(game, seat, msg = "") {
  const st = game.state;
  const opp = core.other(seat);
  const oppSeat = game.seats[opp];
  const me = store.get(game.seats[seat].token);
  return {
    code: game.code,
    seat,
    you: {
      nick: game.seats[seat].nick,
      rating: me?.rating ?? 1000,
      rank: core.rankOf(me?.rating ?? 1000),
      hand: st ? st.hands[seat] : [],
    },
    opp: {
      nick: oppSeat?.nick || null,
      rating: oppSeat ? (store.get(oppSeat.token)?.rating ?? 1000) : null,
      handCount: st ? st.hands[opp].length : 0,
      connected: oppSeat?.connected ?? false,
    },
    deckCount: st ? st.deck.length : 0,
    discard: st ? st.discard : 0,
    table: st ? st.table : [],
    phase: st ? st.phase : "wait",
    yourTurn: st
      ? (st.phase === "attack" || st.phase === "throw" || st.phase === "pileOn")
        ? st.attacker === seat
        : st.phase === "defend"
        ? st.attacker !== seat
        : st.phase === "nyav"
        ? !game.nyavPicks[seat]
        : false
      : false,
    youAttack: st ? st.attacker === seat : false,
    limit: st ? st.limit : 6,
    nipUsed: st ? st.nipUsed : false,
    nyav: st && st.phase === "nyav"
      ? { youPicked: !!game.nyavPicks[seat], oppPicked: !!game.nyavPicks[opp] }
      : null,
    msg,
    result: st && st.result ? resultView(game, seat) : null,
  };
}

function pushState(game, msgs = { A: "", B: "" }) {
  for (const seat of ["A", "B"]) {
    const p = game.seats[seat];
    if (p?.socketId) io.to(p.socketId).emit("state", viewFor(game, seat, msgs[seat]));
  }
}

function bothMsgs(a, b) { return { A: a, B: b }; }

/* ── завершення з рейтингом ── */

function settle(game) {
  if (game.ratedApplied || !game.state?.result) return;
  game.ratedApplied = true;
  game.finished = true;
  const r = game.state.result;
  const scoreA = r.winner === "A" ? 1 : r.winner === "draw" ? 0.5 : 0;
  const { dA, dB } = store.applyResult(
    game.seats.A.token, game.seats.B.token, scoreA, core.eloDelta
  );
  game.deltas = { A: dA, B: dB };
}

function forfeit(game, loserSeat) {
  if (game.finished || !game.state) return;
  game.state.result = { winner: core.other(loserSeat), kind: "forfeit" };
  game.state.phase = "over";
  settle(game);
  pushState(game);
  scheduleCleanup(game);
}

function scheduleCleanup(game) {
  setTimeout(() => {
    // кімната живе ще 10 хв після фіналу — на реванш
    if (rooms.get(game.code) === game && game.finished && !game.state?.rematched) {
      for (const s of ["A", "B"]) {
        const t = game.seats[s]?.token;
        if (t && byToken.get(t) === game.code) byToken.delete(t);
      }
      rooms.delete(game.code);
    }
  }, 10 * 60_000);
}

/* ── старт партії в кімнаті ── */

function startDeal(game) {
  game.state = core.deal();
  game.nyavPicks = { A: null, B: null };
  game.rematch = { A: false, B: false };
  game.finished = false;
  game.ratedApplied = false;
  game.deltas = null;
  const f = game.state.first;
  if (f.type === "low") {
    const att = f.seat;
    pushState(game, bothMsgs(
      att === "A" ? `найменша карта (${f.val}) у тебе. атакуй.` : `найменша карта (${f.val}) у суперника.`,
      att === "B" ? `найменша карта (${f.val}) у тебе. атакуй.` : `найменша карта (${f.val}) у суперника.`
    ));
  } else {
    pushState(game, bothMsgs(
      "найменші карти рівні. няв-няв-няв: обери знак.",
      "найменші карти рівні. няв-няв-няв: обери знак."
    ));
  }
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

    // повернення в активну гру, якщо була
    const code = byToken.get(token);
    const game = code ? rooms.get(code) : null;
    if (game && !game.finished) {
      const seat = seatOf(game, token);
      if (seat) {
        game.seats[seat].socketId = socket.id;
        game.seats[seat].connected = true;
        clearTimeout(game.seats[seat].dcTimer);
        cb?.({ profile: { nick: p.nick, rating: p.rating, rank: core.rankOf(p.rating) }, resumed: true });
        pushState(game, bothMsgs(
          seat === "A" ? "з поверненням." : "суперник повернувся.",
          seat === "B" ? "з поверненням." : "суперник повернувся."
        ));
        return;
      }
    }
    cb?.({ profile: { nick: p.nick, rating: p.rating, rank: core.rankOf(p.rating) } });
  });

  const requireGame = () => {
    const code = token && byToken.get(token);
    const game = code && rooms.get(code);
    if (!game) return null;
    const seat = seatOf(game, token);
    return seat ? { game, seat } : null;
  };

  socket.on("createRoom", (cb) => {
    if (!token) return cb?.({ error: "спершу hello." });
    if (byToken.has(token)) return cb?.({ error: "ти вже в кімнаті." });
    const code = newCode();
    const game = newGame(code);
    game.seats.A = { token, nick: store.get(token).nick, socketId: socket.id, connected: true, lastAct: Date.now() };
    rooms.set(code, game);
    byToken.set(token, code);
    cb?.({ code });
  });

  socket.on("joinRoom", ({ code }, cb) => {
    if (!token) return cb?.({ error: "спершу hello." });
    if (byToken.has(token)) return cb?.({ error: "ти вже в кімнаті." });
    code = String(code || "").toUpperCase().trim();
    const game = rooms.get(code);
    if (!game) return cb?.({ error: "кімнати нема. код точний?" });
    if (game.seats.B) return cb?.({ error: "кімната повна." });
    if (game.seats.A.token === token) return cb?.({ error: "сам із собою? няв." });
    game.seats.B = { token, nick: store.get(token).nick, socketId: socket.id, connected: true, lastAct: Date.now() };
    byToken.set(token, code);
    cb?.({ code });
    startDeal(game);
  });

  socket.on("quickMatch", (cb) => {
    if (!token) return cb?.({ error: "спершу hello." });
    if (byToken.has(token)) return cb?.({ error: "ти вже в кімнаті." });
    queue = queue.filter((q) => q.token !== token && io.sockets.sockets.has(q.socketId));
    const oppo = queue.find((q) => q.token !== token);
    if (!oppo) {
      queue.push({ token, socketId: socket.id });
      return cb?.({ queued: true });
    }
    queue = queue.filter((q) => q !== oppo);
    const code = newCode();
    const game = newGame(code);
    game.seats.A = { token: oppo.token, nick: store.get(oppo.token).nick, socketId: oppo.socketId, connected: true, lastAct: Date.now() };
    game.seats.B = { token, nick: store.get(token).nick, socketId: socket.id, connected: true, lastAct: Date.now() };
    rooms.set(code, game);
    byToken.set(oppo.token, code);
    byToken.set(token, code);
    cb?.({ code });
    startDeal(game);
  });

  socket.on("leaveQueue", () => {
    queue = queue.filter((q) => q.token !== token);
  });

  socket.on("nyav", ({ sign }) => {
    const ctx = requireGame();
    if (!ctx || ctx.game.state?.phase !== "nyav") return;
    if (!core.NYAV.includes(sign)) return;
    const { game, seat } = ctx;
    if (game.nyavPicks[seat]) return;
    game.nyavPicks[seat] = sign;
    game.seats[seat].lastAct = Date.now();
    const opp = core.other(seat);
    if (!game.nyavPicks[opp]) {
      pushState(game, bothMsgs(
        seat === "A" ? "знак прийнято. чекаємо суперника." : "суперник обрав знак.",
        seat === "B" ? "знак прийнято. чекаємо суперника." : "суперник обрав знак."
      ));
      return;
    }
    const a = game.nyavPicks.A, b = game.nyavPicks.B;
    const w = core.resolveNyav(a, b);
    if (w === "tie") {
      game.nyavPicks = { A: null, B: null };
      pushState(game, bothMsgs(
        `обоє: ${nyavUa[a]}. ще раз.`,
        `обоє: ${nyavUa[b]}. ще раз.`
      ));
      return;
    }
    game.state.attacker = w;
    core.setupBout(game.state);
    const ws = w === "A" ? a : b, ls = w === "A" ? b : a;
    const verdict = `${nyavUa[ws]} ${nyavVerb[ws]} ${nyavGen[ls]}.`;
    pushState(game, bothMsgs(
      `${verdict} ${w === "A" ? "атакуєш ти." : "атакує суперник."}`,
      `${verdict} ${w === "B" ? "атакуєш ти." : "атакує суперник."}`
    ));
  });

  socket.on("move", ({ type, uid }) => {
    const ctx = requireGame();
    if (!ctx || !ctx.game.state || ctx.game.finished) return;
    const { game, seat } = ctx;
    const s = game.state;
    let r = { ok: false };
    if (type === "attack") r = core.moveAttack(s, seat, uid);
    else if (type === "defend") r = core.moveDefend(s, seat, uid);
    else if (type === "take") r = core.moveTake(s, seat);
    else if (type === "throw") r = core.moveThrow(s, seat, uid);
    else if (type === "bito") r = core.moveBito(s, seat);
    else if (type === "done") r = core.moveDone(s, seat);
    if (!r.ok) return;
    game.seats[seat].lastAct = Date.now();

    const opp = core.other(seat);
    const oppNick = game.seats[opp]?.nick || "суперник";
    const meNick = game.seats[seat]?.nick || "суперник";
    let msgs;
    const ev = r.ev;
    if (ev.type === "attack")
      msgs = bothMsgs(
        seat === "A" ? (ev.nip ? "ніп на столі." : "атака пішла.") : (ev.nip ? `${oppNick} атакує ніпом. бий ніпом або бери.` : "бий або бери."),
        seat === "B" ? (ev.nip ? "ніп на столі." : "атака пішла.") : (ev.nip ? `${meNick} атакує ніпом. бий ніпом або бери.` : "бий або бери.")
      );
    else if (ev.type === "throw")
      msgs = bothMsgs(
        seat === "A" ? "підкинуто." : `${meNick} підкидає. бий або бери.`,
        seat === "B" ? "підкинуто." : `${meNick} підкидає. бий або бери.`
      );
    else if (ev.type === "defend" && ev.allBeaten)
      msgs = bothMsgs(
        seat === "A" ? "відбито. хай вирішує." : "усе відбито. підкинеш чи бито?",
        seat === "B" ? "відбито. хай вирішує." : "усе відбито. підкинеш чи бито?"
      );
    else if (ev.type === "defend")
      msgs = bothMsgs("побито. є ще.", "побито. є ще.");
    else if (ev.type === "taking")
      msgs = bothMsgs(
        seat === "A" ? "береш. чекай докиду." : `${meNick} бере. докинеш?`,
        seat === "B" ? "береш. чекай докиду." : `${meNick} бере. докинеш?`
      );
    else if (ev.type === "pileThrow")
      msgs = bothMsgs("докинуто.", "докинуто.");
    else if (ev.type === "bout") {
      const forA = boutMsg({ ...ev, taker: ev.taker === "A" ? "you" : "opp" }, s.attacker === "A", game.seats.B?.nick || "суперник");
      const forB = boutMsg({ ...ev, taker: ev.taker === "B" ? "you" : "opp" }, s.attacker === "B", game.seats.A?.nick || "суперник");
      const tail = (mySeat) =>
        s.result ? "" : s.attacker === mySeat ? " твоя атака." : " атакує суперник.";
      msgs = bothMsgs(forA + tail("A"), forB + tail("B"));
      if (s.result) settle(game), scheduleCleanup(game);
    }
    pushState(game, msgs);
  });

  socket.on("rematch", () => {
    const ctx = requireGame();
    if (!ctx || !ctx.game.finished) return;
    const { game, seat } = ctx;
    game.rematch[seat] = true;
    const opp = core.other(seat);
    if (game.rematch[opp]) {
      game.state.rematched = true;
      startDeal(game);
    } else {
      const p = game.seats[opp];
      if (p?.socketId) io.to(p.socketId).emit("state", viewFor(game, opp, "суперник хоче реванш."));
    }
  });

  socket.on("leaveRoom", () => {
    const ctx = requireGame();
    if (!ctx) return;
    const { game, seat } = ctx;
    if (!game.finished && game.seats.A && game.seats.B) forfeit(game, seat);
    byToken.delete(token);
    if (game.finished || !game.seats.B) {
      const opp = core.other(seat);
      if (!game.seats.B || !game.seats[opp]) rooms.delete(game.code);
    }
  });

  socket.on("top", (cb) => cb?.(store.top(50)));

  socket.on("disconnect", () => {
    queue = queue.filter((q) => q.socketId !== socket.id);
    if (!token) return;
    const code = byToken.get(token);
    const game = code && rooms.get(code);
    if (!game) return;
    const seat = seatOf(game, token);
    if (!seat || game.seats[seat].socketId !== socket.id) return;
    game.seats[seat].connected = false;
    const opp = core.other(seat);
    if (game.seats[opp]?.socketId)
      io.to(game.seats[opp].socketId).emit("state", viewFor(game, opp, "суперник зник. чекаємо хвилину."));
    if (!game.finished && game.seats.A && game.seats.B) {
      game.seats[seat].dcTimer = setTimeout(() => {
        if (!game.seats[seat].connected) forfeit(game, seat);
      }, RECONNECT_MS);
    } else if (!game.seats.B) {
      byToken.delete(token);
      rooms.delete(game.code);
    }
  });
});

/* бездіяльність: хто мовчить понад IDLE_MS у свій хід — технічна поразка */
setInterval(() => {
  const now = Date.now();
  for (const game of rooms.values()) {
    if (game.finished || !game.state || !game.seats.A || !game.seats.B) continue;
    const st = game.state;
    let waitingOn = null;
    if (st.phase === "nyav") {
      if (!game.nyavPicks.A) waitingOn = "A";
      else if (!game.nyavPicks.B) waitingOn = "B";
    } else if (st.phase === "attack" || st.phase === "throw" || st.phase === "pileOn") waitingOn = st.attacker;
    else if (st.phase === "defend") waitingOn = core.other(st.attacker);
    if (waitingOn && now - game.seats[waitingOn].lastAct > IDLE_MS) forfeit(game, waitingOn);
  }
}, 15_000);

server.listen(PORT, () => console.log(`дур-киць сервер на :${PORT}. няв.`));
