/* ════════════════════════════════════════════════
   ДУР-КИЦЬ · онлайн-сервер v2 · столи 2–5
   ════════════════════════════════════════════════ */

const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");
const core = require("./core");
const store = require("./store");

const PORT = process.env.PORT || 3000;
const RECONNECT_MS = 10 * 60_000;  // лагідний таймер повернення
const IDLE_ATTACK_MS = 180_000;    // мовчання атакера → викидання
const IDLE_SOFT_MS = 90_000;       // мовчання інших → лагідна автодія

/* швидкісний буст: множник на ЗДОБУТІ очки за тривалістю партії */
function speedMult(ms) {
  const m = ms / 60000;
  if (m < 4) return 1.5;
  if (m < 8) return 1.2;
  return 1.0;
}
const STREAK_MULT = 1.25;   // серія з 3+ перемог
const ROOKIE_MULT = 1.5;    // перші 10 ігор
const K_BASE = 32;

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
    code,
    players: {},              // seat → {token, nick, socketId, connected, lastAct, dcTimer}
    order: [],                // сидіння в порядку приєднання; order[0] — хост
    state: null,
    nyavPicks: {},
    rematch: {},
    startedAt: 0,
    finished: false,
    settled: false,
    deltas: null,
  };
}

const seatOf = (g, token) =>
  Object.keys(g.players).find((s) => g.players[s].token === token) || null;

const nickOf = (g, seat) => g.players[seat]?.nick || "хтось";

/* ── очки ── */

function settle(game) {
  if (game.settled || !game.state?.result) return;
  game.settled = true;
  game.finished = true;
  const st = game.state;
  const seats = st.seats;
  const n = seats.length;
  const dur = Date.now() - game.startedAt;
  const sm = speedMult(dur);
  const raw = {};
  for (const a of seats) {
    let d = 0;
    const pa = store.get(game.players[a].token);
    for (const b of seats) {
      if (a === b) continue;
      const pb = store.get(game.players[b].token);
      const sc = st.places[a] < st.places[b] ? 1 : st.places[a] > st.places[b] ? 0 : 0.5;
      d += core.eloDelta(pa.sp, pb.sp, sc, K_BASE / (n - 1));
    }
    raw[a] = d;
  }
  game.deltas = {};
  game.boosts = {};
  for (const seat of seats) {
    const p = store.get(game.players[seat].token);
    let d = raw[seat];
    const boosts = [];
    if (d > 0) {
      if (sm > 1) { d *= sm; boosts.push(`швидкість ×${sm}`); }
      if ((p.streak || 0) >= 3) { d *= STREAK_MULT; boosts.push(`серія ×${STREAK_MULT}`); }
      if ((p.games || 0) < 10) { d *= ROOKIE_MULT; boosts.push(`новачок ×${ROOKIE_MULT}`); }
    }
    game.deltas[seat] = Math.round(d);
    game.boosts[seat] = boosts;
  }
  const results = seats.map((seat) => ({
    token: game.players[seat].token,
    delta: game.deltas[seat],
    won: st.places[seat] === 1 && !seats.some((x) => x !== seat && st.places[x] === 1),
    drew: seats.some((x) => x !== seat && st.places[x] === st.places[seat] && st.places[seat] === 1),
  }));
  store.applyMatch(results);
}

/* ── тексти ── */

const nyavUa = { lapka: "лапка", kihot: "кіготь", khvist: "хвіст" };
const nyavVerb = { lapka: "притискає", kihot: "чіпляє", khvist: "вислизає з-під" };
const nyavGen = { lapka: "лапки", kihot: "кігтя", khvist: "хвоста" };
const placeWord = (p) => `${p}-е місце`;

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
  let big;
  if (kind === "drop" || kind === "dc" || kind === "idle") big = "ТЕХНІЧНИЙ ВИХІД";
  else if (myPlace === 1 && shared) big = "НІЧИЯ НАГОРІ";
  else if (myPlace === 1) big = kind === "nip" ? "НІП-ПЕРЕМОГА" : "ПЕРЕМОГА";
  else if (kind === "durkyts") big = "ТИ — ДУР-КИЦЬ";
  else big = placeWord(myPlace).toUpperCase();
  const p = store.get(game.players[seat].token);
  return {
    big,
    text: exitText(kind, true, ""),
    standings: st.result.standings.map((x) => ({
      nick: nickOf(game, x),
      place: st.places[x],
      delta: game.deltas ? game.deltas[x] : 0,
      kind: st.exitKind[x],
      you: x === seat,
    })),
    spDelta: game.deltas ? game.deltas[seat] : 0,
    boosts: game.boosts ? game.boosts[seat] : [],
    sp: p?.sp ?? 1000,
    rank: core.rankOf(p?.sp ?? 1000),
  };
}

function viewFor(game, seat, msg = "") {
  const st = game.state;
  const p = store.get(game.players[seat].token);
  const others = (st ? st.seats : game.order).filter((x) => x !== seat).map((x) => {
    const pl = game.players[x];
    const psp = store.get(pl.token)?.sp ?? 1000;
    return {
      seat: x,
      nick: pl.nick,
      sp: psp,
      rank: core.rankOf(psp),
      handCount: st ? st.hands[x].length : 0,
      connected: pl.connected,
      active: st ? st.active.includes(x) : true,
      role: st ? (st.attacker === x ? "attack" : st.defender === x ? "defend" : null) : null,
      passed: st ? st.passes.includes(x) : false,
      place: st ? st.places[x] ?? null : null,
      inNyav: st?.nyavSet ? st.nyavSet.includes(x) : false,
      picked: st?.nyavSet ? !!game.nyavPicks[x] : false,
    };
  });
  const yourRole = st ? (st.attacker === seat ? "attack" : st.defender === seat ? "defend" : "thrower") : null;
  return {
    code: game.code,
    seat,
    host: game.order[0] === seat,
    started: !!st,
    players: game.order.map((x) => ({ nick: nickOf(game, x), you: x === seat, host: x === game.order[0] })),
    you: {
      nick: game.players[seat].nick,
      sp: p?.sp ?? 1000,
      rank: core.rankOf(p?.sp ?? 1000),
      hand: st ? st.hands[seat] : [],
      active: st ? st.active.includes(seat) : true,
      role: yourRole,
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
    canThrow: st ? core.canSeatThrow(st, seat) : false,
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

/* ── життєвий цикл кімнати ── */

function startDeal(game) {
  game.state = core.deal(game.order);
  game.nyavPicks = {};
  game.rematch = {};
  game.finished = false;
  game.settled = false;
  game.deltas = null;
  game.boosts = null;
  game.startedAt = Date.now();
  for (const s of Object.keys(game.players)) game.players[s].lastAct = Date.now();
  const f = game.state.first;
  if (f.type === "low")
    pushState(game, (seat) =>
      seat === f.seat
        ? `найменша карта (${f.val}) у тебе. атакуй.`
        : `найменша карта (${f.val}) у ${nickOf(game, f.seat)}.`
    );
  else
    pushState(game, (seat) =>
      f.seats.includes(seat)
        ? "найменші карти рівні. няв-няв-няв: обери знак."
        : `няв-няв-няв між: ${f.seats.map((x) => nickOf(game, x)).join(", ")}. спостерігай.`
    );
}

function endAndSettle(game) {
  settle(game);
  pushState(game);
  scheduleCleanup(game);
}

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

/* викидання гравця з активної гри */
function dropFromGame(game, seat, reason) {
  if (!game.state || game.finished) return;
  const nick = nickOf(game, seat);
  const r = core.dropPlayer(game.state, seat, reason);
  if (!r.gone) return;
  const t = game.players[seat].token;
  if (byToken.get(t) === game.code && reason !== "dc") byToken.delete(t);
  if (game.state.result) {
    endAndSettle(game);
  } else {
    pushState(game, (s) => (s === seat ? "ти поза грою." : `${nick} вибуває. граємо далі.`));
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
    const code = byToken.get(token);
    const game = code ? rooms.get(code) : null;
    if (game && !game.finished) {
      const seat = seatOf(game, token);
      if (seat) {
        game.players[seat].socketId = socket.id;
        game.players[seat].connected = true;
        game.players[seat].lastAct = Date.now();
        clearTimeout(game.players[seat].dcTimer);
        cb?.({ profile: { nick: p.nick, sp: p.sp, rank: core.rankOf(p.sp) }, resumed: true });
        pushState(game, (s) => (s === seat ? "з поверненням." : `${nickOf(game, seat)} повернувся.`));
        return;
      }
    }
    cb?.({ profile: { nick: p.nick, sp: p.sp, rank: core.rankOf(p.sp) } });
  });

  const ctx = () => {
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
    game.players.A = { token, nick: store.get(token).nick, socketId: socket.id, connected: true, lastAct: Date.now() };
    game.order = ["A"];
    rooms.set(code, game);
    byToken.set(token, code);
    cb?.({ code });
    pushState(game);
  });

  socket.on("joinRoom", ({ code }, cb) => {
    if (!token) return cb?.({ error: "спершу hello." });
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
    if (byToken.has(token)) return cb?.({ error: "ти вже в кімнаті." });
    queue = queue.filter((q) => q.token !== token && io.sockets.sockets.has(q.socketId));
    const oppo = queue.find((q) => q.token !== token);
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
      const w = r.winner, ws = picks[w];
      const losers = setNow.filter((x) => x !== w);
      const ls = picks[losers[0]];
      const verdict = `${nyavUa[ws]} ${nyavVerb[ws]} ${nyavGen[ls]}.`;
      pushState(game, (s) => `${revealTxt}. ${verdict} ${s === w ? "атакуєш ти." : `атакує ${nickOf(game, w)}.`}`);
    } else {
      pushState(game, (s) =>
        `${revealTxt}. ще раз${game.state.nyavSet.includes(s) ? ": обери знак." : ` між: ${game.state.nyavSet.map((x) => nickOf(game, x)).join(", ")}.`}`
      );
    }
  });

  socket.on("move", ({ type, uid }) => {
    const c = ctx();
    if (!c || !c.game.state || c.game.finished) return;
    const { game, seat } = c;
    const s = game.state;
    let r = { ok: false };
    if (type === "attack") r = core.moveAttack(s, seat, uid);
    else if (type === "defend") r = core.moveDefend(s, seat, uid);
    else if (type === "take") r = core.moveTake(s, seat);
    else if (type === "throw") r = core.moveThrow(s, seat, uid);
    else if (type === "pass") r = core.movePass(s, seat);
    if (!r.ok) return;
    game.players[seat].lastAct = Date.now();
    const me = nickOf(game, seat);
    const ev = r.ev;
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
      /* чесний вихід: спершу викидаємо тих, хто давно зник —
         щоб той, хто чекав, не платив за чужу втечу */
      const goneFirst = game.state.active.filter(
        (x) => x !== seat && !game.players[x].connected
      );
      for (const g of goneFirst) dropFromGame(game, g, "dc");
      if (game.state && !game.finished && game.state.active.includes(seat))
        dropFromGame(game, seat, "drop");
    }
    byToken.delete(token);
    if (!game.state) {
      // лобі: звільняємо стілець
      delete game.players[seat];
      game.order = game.order.filter((x) => x !== seat);
      if (!game.order.length) rooms.delete(game.code);
      else pushState(game, () => "хтось передумав. чекаємо далі.");
    }
  });

  socket.on("top", (cb) => cb?.(store.top(50).map((p) => ({ ...p, rank: core.rankOf(p.sp) }))));

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
            core.applyNyav(st, picks);
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
          if (st.result) { settle(game); pushState(game); scheduleCleanup(game); }
          else pushState(game, () => `${nickOf(game, st.defender)} мовчить — бере.`);
        }
      }
    } else if (st.phase === "throw" || st.phase === "pileOn") {
      for (const seat of core.throwers(st)) {
        if (!st.passes.includes(seat) && now - game.players[seat].lastAct > IDLE_SOFT_MS) {
          const r = core.movePass(st, seat);
          game.players[seat].lastAct = now;
          if (r.ok && st.result) { settle(game); pushState(game); scheduleCleanup(game); break; }
          if (r.ok) pushState(game, () => `${nickOf(game, seat)} мовчить — пас.`);
        }
      }
    }
  }
}, 15_000);

server.listen(PORT, () => console.log(`дур-киць сервер v2 на :${PORT}. столи 2–5. няв.`));
