/* ════════════════════════════════════════════════
   ДУР-КИЦЬ · онлайн-сервер v4 · столи 2–5
   ════════════════════════════════════════════════ */

const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");
const core = require("./core");
const store = require("./store");
const TXT = require("./texts_ua");
const bot = require("./bot");
let AMB = {};
try { AMB = require("./ambassadors"); } catch (e) { AMB = {}; }
const AMB_DEF = { greg: { name: "ґреґ", idle: ["няв? квак."] }, zhreg: { name: "жреґ", idle: ["квак."] } };
for (const k of ["greg", "zhreg"]) AMB[k] = Object.assign({}, AMB_DEF[k], AMB[k] || {});
const ambLine = (who, key) => {
  const arr = (AMB[who] && AMB[who][key]) || [];
  return arr.length ? arr[(Math.random() * arr.length) | 0] : null;
};
/* доручення виконано (готове до здачі — нагороду видасть missionClaim) + власна репліка амбасадора */
function pushMissionNote(notes, mr) {
  notes.push(`доручення виконано: ${mr.text} — забери нагороду на головному екрані`);
  const line = ambLine(mr.who, "missionDone");
  const name = (AMB[mr.who] && AMB[mr.who].name) || mr.who;
  if (line) notes.push(`«${line}» — ${name}`);
}

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
/* назви/описи досягнень редагуються в texts_ua.js → ACHIEVEMENTS */
const ACH = TXT.ACHIEVEMENTS;
const TITLE_IDS = Object.keys(ACH);

const app = express();
app.use(express.static(path.join(__dirname, "public")));
app.get("/health", (_q, r) => r.json({ ok: true }));
app.get("/top", (_q, r) =>
  r.json(store.top(50).map((p) => ({ ...p, rank: core.rankOf(p.sp) })))
);

/* ── публічна візитівка гравця ── */
const escHtml = (x) => String(x ?? "").replace(/[<>&"]/g, (m) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[m]));

app.get("/api/p/:nick", (req, res) => {
  const p = store.byNick(String(req.params.nick || ""));
  if (!p) return res.status(404).json({ error: "такого гравця нема." });
  res.json({
    nick: p.nick, sp: p.sp, rank: core.rankOf(p.sp), games: p.games,
    w: p.w, l: p.l, d: p.d, streak: p.streak,
    side: p.side || "kyts", avatar: p.avatar, banner: p.banner || "",
    title: p.title && ACH[p.title] ? ACH[p.title].name : "",
    ach: (p.ach || []).map((id) => ACH[id]?.name).filter(Boolean),
    cards: (p.cards || []).filter((c) => String(c).startsWith("nip_")),
    seasonBanners: p.seasonBanners || [],
    frontier: p.frontier ?? 0, pveWins: p.pveWins || 0,
  });
});

app.get("/p/:nick", (req, res) => {
  const p = store.byNick(String(req.params.nick || ""));
  if (!p) return res.status(404).send("<meta charset='utf-8'><body style='font-family:monospace;padding:40px;text-align:center'>такого гравця нема. няв.</body>");
  const nick = escHtml(p.nick);
  const sideUa = (p.side === "anti") ? "анти-киці" : "киці";
  const nips = (p.cards || []).filter((c) => String(c).startsWith("nip_"));
  const titles = (p.ach || []).map((id) => ACH[id]?.name).filter(Boolean);
  res.type("html").send(`<!doctype html><html lang="uk"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${nick} · дур-киць</title>
<meta property="og:title" content="${nick} — дур-киць">
<meta property="og:description" content="${p.sp} очок · ${core.rankOf(p.sp)} · ${sideUa} · банерів: ${nips.length}/6">
<style>
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600&family=Unbounded:wght@800&display=swap');
body{margin:0;background:#ece3cc;color:#272019;font-family:'IBM Plex Mono',monospace;font-size:13px}
.wrap{max-width:520px;margin:0 auto;padding:20px}
h1{font-family:'Unbounded',monospace;font-size:22px;margin:0 0 2px}
.card{border:2px solid #272019;border-radius:12px;background:#f6efdc;padding:14px;box-shadow:3px 4px 0 rgba(39,32,25,.35);margin-bottom:12px}
.ban{height:110px;border:2px solid #272019;border-radius:10px;overflow:hidden;margin-bottom:10px}
.ban img{width:100%;height:100%;object-fit:cover}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:8px}
.slot{border:2px solid #272019;border-radius:9px;overflow:hidden;aspect-ratio:6/7;background:#ece3cc}
.slot.empty{border-style:dashed;opacity:.45;display:flex;align-items:center;justify-content:center;font-family:'Unbounded';font-size:20px}
.slot img{width:100%;height:100%;object-fit:cover;display:block}
.t{display:inline-block;border:2px solid #272019;border-radius:14px;padding:2px 9px;margin:3px 3px 0 0;font-size:11px;background:#f3e2c4}
.sub{opacity:.7;font-size:11px}
a{color:#b55a24;font-weight:600}
</style></head><body><div class="wrap">
${p.banner ? `<div class="ban"><img src="/cards/${escHtml(p.banner)}.jpg" alt=""></div>` : ""}
<div class="card">
  <h1>${nick}</h1>
  <div class="sub">${escHtml(core.rankOf(p.sp))}${p.title && ACH[p.title] ? ` · «${escHtml(ACH[p.title].name)}»` : ""} · фракція: ${sideUa}</div>
  <div style="margin-top:8px">${p.sp} очок · ${p.games} ігор · п ${p.w} / н ${p.d} / пр ${p.l}${p.streak >= 2 ? ` · серія ${p.streak}` : ""}</div>
  <div class="sub">перемог над амбасадорами: ${p.pveWins || 0}</div>
</div>
<div class="card">
  <b>альбом банерів — ${nips.length}/6</b>
  <div class="grid">
    ${["nip_rudy","nip_white","nip_black","nip_green","nip_violet","nip_blue"].map((id) =>
      nips.includes(id) ? `<div class="slot"><img src="/cards/${id}.jpg" alt=""></div>` : `<div class="slot empty">?</div>`).join("")}
  </div>
  ${(p.seasonBanners || []).length ? `<div class="sub" style="margin-top:8px">сезонних нагород: ${p.seasonBanners.length}</div>` : ""}
</div>
${titles.length ? `<div class="card"><b>звання</b><div style="margin-top:4px">${titles.map((t) => `<span class="t">${escHtml(t)}</span>`).join("")}</div></div>` : ""}
<div class="card" style="text-align:center">
  <a href="/">грати в дур-киць</a>
  <div class="sub" style="margin-top:4px">няв.</div>
</div>
</div></body></html>`);
});

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const rooms = new Map();
const byToken = new Map();
let queue = [];
let coopQueue = [];

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
    takes: {}, cardsTaken: {}, nyavWins: {}, newAch: {}, banNote: {}, newFrontier: {},
    throwsBy: {}, nipsPlayed: {}, fivesPlayed: {}, glitchMoved: {}, glitchPending: null,
    lastSide: {}, coinNotes: {}, feeNote: {}, lastCardPlayed: null,
    isPve: false, isDaily: false, glitchWanted: false, amb: null, ambSaid: {},
    glitchAt: 0, glitchEndAt: 0, glitchDone: false,
    bet: null,
    startedAt: 0, finished: false, settled: false, deltas: null, boosts: null,
  };
}

const seatOf = (g, token) =>
  Object.keys(g.players).find((s) => g.players[s].token === token) || null;
const nickOf = (g, seat) => g.players[seat]?.nick || "хтось";

function tagOf(g, seat) {
  if (g.players[seat]?.bot) return " [бот]";
  const p = store.get(g.players[seat]?.token);
  if (!p) return "";
  if (p.title === "none") return "";
  if (p.title && ACH[p.title] && p.ach.includes(p.title)) return ` [${ACH[p.title].name}]`;
  return ` [${core.rankOf(p.sp)}]`;
}
const avatarOf = (g, seat) => g.players[seat]?.bot ? (g.players[seat].amb === "zhreg" ? "frog_violet" : "frog_green") : (store.get(g.players[seat]?.token)?.avatar || "cat_black");

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
  game.deltas = {}; game.boosts = {}; game.newAch = {}; game.banNote = {}; game.newFrontier = {};

  /* ── ПвЄ і «стіл дня» — тренування, рейтинг/жетони/досягнення не чіпаємо ── */
  if (game.isPve) {
    for (const seat of seats) {
      game.deltas[seat] = 0; game.boosts[seat] = []; game.newAch[seat] = [];
      game.coinNotes[seat] = []; game.banNote[seat] = "";
    }
    /* ПвЄ-набір досягнень + амбасадорська мапа (рейтинг і далі не чіпаємо) */
    const hSeat = seats.find((x) => !game.players[x].bot);
    const hTok = hSeat && game.players[hSeat].token;
    if (hTok && !game.isDaily) {
      const p = store.get(hTok);
      const won = st.places[hSeat] === 1;
      const got = [], notes = [];
      const tryA = (id, cond) => { if (cond && store.award(hTok, id)) got.push(ACH[id].name); };
      tryA("pve_znaiomstvo", true);
      tryA("amb_stil", !!game.ambBoth);
      { const h = new Date().getHours(); tryA("sec_nichnyi", h >= 3 && h < 5); }
      tryA("sec_hodynnyk", (game.clockClicks?.[hSeat] || 0) >= 15);
      tryA("sec_odna", st.places[hSeat] === 1 && !!(game.wasLoneCard || {})[hSeat]);
      if (won) {
        p.pveWins = (p.pveWins || 0) + 1;
        if (game.amb === "greg") p.beatGreg = true;
        if (game.amb === "zhreg") p.beatZhreg = true;
        tryA("pve_greg", game.amb === "greg");
        tryA("pve_zhreg", game.amb === "zhreg");
        tryA("pve_obydva", p.beatGreg && p.beatZhreg);
        tryA("pve_sukho", !(game.takes[hSeat] > 0));
        tryA("pve_shvydko", dur < 120_000);
        tryA("pve_desyat", p.pveWins >= 10);
        const mr = store.missionProgress(hTok, "ambWin", 1);
        if (mr) pushMissionNote(notes, mr);
      tryA("amb_obydva", !!game.ambBoth);
      tryA("amb_ostanni", !!game.ambBoth && st.places[hSeat] === 1);
        /* амбасадорство: перемога над ПРОТИЛЕЖНИМ амбасадором рухає мапу */
        const ambSide = game.amb === "zhreg" ? "anti" : "kyts";
        const mySide = p.side || "kyts";
        if (ambSide !== mySide) {
          const fr = store.bumpFrontier(hTok, mySide);
          notes.push(`перемога над амбасадором ${ambSide === "anti" ? "анти-киць" : "киць"} — крок мапи`);
          if (fr && fr.conquered != null) {
            if (p.tk) { p.tk.k += 5; p.tk.a += 5; }
            notes.push("завойовано новий усесвіт! +5 ж.к і +5 ж.а");
            game.newFrontier[hSeat] = fr.conquered;
          }
        } else {
          notes.push("свій амбасадор — мапа не зрушилась. шукай протилежного.");
        }
      }
      if (got.length && p.tk) { p.tk.k += 3 * got.length; p.tk.a += 3 * got.length; notes.push(`+${3 * got.length} ж.к і +${3 * got.length} ж.а — ПвЄ-звання`); }
      game.newAch[hSeat] = got;
      game.coinNotes[hSeat] = notes;
      store.dirty();
      ambSay(game, won ? "playerWon" : "botWon", true);
    }
    /* ніпи — окрема нагорода. у ПвЄ вдвічі менша, щоб не обганяти рейтингову гру */
    for (const seat of seats) {
      const tok2 = game.players[seat].token;
      if (!tok2) continue;
      const p2 = store.get(tok2);
      const nips = game.nipsPlayed[seat] || 0;
      if (!p2 || !p2.tk || !nips) continue;
      const per = 1;                       /* ПвЄ: половина від рейтингової ставки */
      const gain = nips * per;
      p2.tk[(p2.side === "anti") ? "a" : "k"] += gain;
      (game.coinNotes[seat] = game.coinNotes[seat] || []).push(`+${gain} ${p2.side === "anti" ? "ж.а" : "ж.к"} — битви з ніпами (${nips})`);
    }
    store.dirty();
    if (game.isDaily) {
      const humanSeat = seats.find((x) => !game.players[x].bot);
      const tok = humanSeat && game.players[humanSeat].token;
      if (tok) {
        const won = st.places[humanSeat] === 1;
        const streak = store.recordDaily(tok, nickOf(game, humanSeat), { won, durMs: dur, place: st.places[humanSeat] });
        if (streak >= 7 && store.award(tok, "tyzhnevyk")) {
          const p = store.get(tok);
          if (p?.tk) { p.tk.k += 5; p.tk.a += 5; store.dirty(); }
          game.newAch[humanSeat] = [ACH.tyzhnevyk.name];
          game.coinNotes[humanSeat] = ["+5 ж.к і +5 ж.а — нове звання"];
        }
      }
    }
    return;
  }

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
    tryAch("nyavkosmos", (game.nyavWins[seat] || 0) >= 3);
    tryAch("movchvoda", won && !(game.throwsBy[seat] > 0));
    tryAch("zhabhor", (game.nipsPlayed[seat] || 0) >= 3);
    tryAch("pyatipyat", (game.fivesPlayed[seat] || 0) >= 5);
    tryAch("glitchsurf", won && !!game.glitchMoved[seat]);
    tryAch("zhetonoyid", p.tk && (p.tk.k >= 150 || p.tk.a >= 150));
    game.newAch[seat] = got;

    /* жетони киць / анти-киць */
    if (!p.tk) p.tk = { k: 100, a: 100 };
    const notes = [];
    const sideUa = (x) => (x === "kyts" || x === "k" ? "ж.к" : "ж.а");
    const sideKey = (x) => (x === "kyts" || x === "k" ? "k" : "a");
    /* «розшукується»: переможний хід карткою дня — премія і галас у чаті */
    if (won && game.lastCardPlayed && !core.isNip(game.lastCardPlayed)) {
      const w = store.wantedToday();
      const lc = game.lastCardPlayed;
      const lcId = `${lc.suit}_${lc.value}`;
      const hit = (lcId === w.kyts.id) ? "kyts" : (lcId === w.anti.id ? "anti" : null);
      if (hit) {
        const bonus = 10;
        p.tk[hit === "kyts" ? "k" : "a"] += bonus;
        notes.push(`+${bonus} ${hit === "kyts" ? "ж.к" : "ж.а"} — упіймано карту в розшуку!`);
        game.wantedHit = { seat, id: lcId, side: hit };
        if (store.award(tok, "sec_lovets")) got.push(ACH.sec_lovets.name);
      }
    }
    if (won) {
      const side = game.lastSide[seat] || "kyts";
      p.tk[sideKey(side)] += 3;
      notes.push(`+3 ${sideUa(side)} — перемога ${side === "kyts" ? "кицями" : "анти-кицями"}`);
      const fr = store.bumpFrontier(tok, p.side || side);
      if (fr && fr.conquered != null) {
        p.tk.k += 5; p.tk.a += 5;
        notes.push("завойовано новий усесвіт! +5 ж.к і +5 ж.а");
        game.newFrontier[seat] = fr.conquered;
      }
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
    /* рух за щоденним дорученням */
    const missionHits = [];
    const mp = (kind, val) => { const r = store.missionProgress(tok, kind, val); if (r) missionHits.push(r); };
    mp("nips", game.nipsPlayed[seat] || 0);
    mp("fives", game.fivesPlayed[seat] || 0);
    if (won) {
      if (!(game.takes[seat] > 0)) mp("dryWin", 1);
      if (dur < 240_000) mp("fastWin", 1);
      if (game.wantedHit && game.wantedHit.seat === seat) mp("wantedWin", 1);
    }
    if (dur >= 480_000) mp("longGame", 1);
    if (missionHits.length) {
      const h = missionHits[0];
      pushMissionNote(notes, h);
      (game.missionDone = game.missionDone || {})[seat] = h;
    }

    /* битви з ніпами — у рейтинговій грі ставка вдвічі більша, ніж у ПвЄ */
    const nipsHere = game.nipsPlayed[seat] || 0;
    if (nipsHere) {
      const gain = nipsHere * 2;
      p.tk[sideKey(p.side === "anti" ? "anti" : "kyts")] += gain;
      notes.push(`+${gain} ${sideUa(p.side === "anti" ? "anti" : "kyts")} — битви з ніпами (${nipsHere})`);
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

const nyavUa = TXT.nyavUa, nyavVerb = TXT.nyavVerb, nyavGen = TXT.nyavGen;

function exitText(kind, mine, nick) {
  if (kind === "shed") return mine ? TXT.exit.shedMine : TXT.exit.shedOther(nick);
  if (kind === "nip") return mine ? TXT.exit.nipMine : TXT.exit.nipOther(nick);
  if (kind === "durkyts") return mine ? TXT.exit.durkytsMine : TXT.exit.durkytsOther(nick);
  return mine ? TXT.exit.dropMine : TXT.exit.dropOther(nick);
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
    tk: p?.tk || { k: 0, a: 0 },
    banNote: game.banNote ? game.banNote[seat] || "" : "",
    sp: p?.sp ?? 0,
    rank: core.rankOf(p?.sp ?? 0),
    dur: game.startedAt ? Date.now() - game.startedAt : 0,
    isPve: !!game.isPve, isDaily: !!game.isDaily,
    frontier: p?.frontier ?? 0,
    newFrontier: game.newFrontier ? (game.newFrontier[seat] ?? null) : null,
    lastCard: game.lastCardPlayed || null,
    rematchWanted: game.order.filter((x) => x !== seat && game.rematch[x] && !game.players[x]?.bot).map((x) => nickOf(game, x)),
    youRematched: !!game.rematch[seat],
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
      frontier: p?.frontier ?? 0, frontierWins: p?.frontierWins || { kyts: 0, anti: 0 },
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
    isPve: !!game.isPve, isDaily: !!game.isDaily, amb: game.amb || null,
    haunt: game.hauntEffect || null,
    boutTable: game.boutTable || null,
    glitch: st?.glitch ? { enabled: true, active: st.glitch.active, kind: st.glitch.active ? st.glitch.kind : null } : null,
    bet: game.bet ? betView(game, seat) : null,
    nyav: st?.phase === "nyav"
      ? { inSet: st.nyavSet.includes(seat), youPicked: !!game.nyavPicks[seat], set: st.nyavSet.map((x) => nickOf(game, x)) }
      : null,
    msg,
    result: st?.result ? resultView(game, seat) : null,
  };
}

function betView(game, seat) {
  const b = game.bet;
  if (!b) return null;
  return {
    phase: b.phase, // 'pick' | 'done'
    youPicked: !!(b.picks[seat]),
    set: (b.set || game.order).map((x) => nickOf(game, x)),
    amount: b.amount,
    resultText: b.resultText || null,
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

function startDeal(game, seed) {
  game.state = core.deal(game.order, { glitch: game.glitchWanted, seed });
  game.nyavPicks = {}; game.rematch = {};
  game.takes = {}; game.cardsTaken = {}; game.nyavWins = {}; game.newAch = {}; game.banNote = {}; game.newFrontier = {};
  game.finished = false; game.settled = false; game.deltas = null; game.boosts = null;
  game.startedAt = Date.now();
  game.lastSide = {}; game.coinNotes = {}; game.lastCardPlayed = null;
  game.throwsBy = {}; game.nipsPlayed = {}; game.fivesPlayed = {}; game.glitchMoved = {}; game.glitchPending = null;
  game.ambUsed = new Set(); game.ambCount = 0; game.ambLast = 0; game.boutTable = null;
  game.ambSaid = {}; game.ambLastKey = null; game.ambLastWho = null; game.ambLastText = null;
  game.clockClicks = {}; game.wasLoneCard = {};
  game.glitchDone = false;
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
  maybeBotMove(game);
}

function endAndSettle(game) {
  clearTimeout(game.banterTimer); settle(game); pushState(game); scheduleCleanup(game); }

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


/* один хід — людини чи бота, однаковим шляхом */
function performMove(game, seat, type, uid) {
  const s = game.state;
  if (!s) return false;
  const played = (type === "attack" || type === "defend" || type === "throw")
    ? s.hands[seat]?.find((x) => x.uid === uid) : null;
  let r = { ok: false };
  if (type === "attack") r = core.moveAttack(s, seat, uid);
  else if (type === "defend") r = core.moveDefend(s, seat, uid);
  else if (type === "take") r = core.moveTake(s, seat);
  else if (type === "throw") r = core.moveThrow(s, seat, uid);
  else if (type === "pass") r = core.movePass(s, seat);
  if (!r.ok) return false;
  if (played) {
    game.lastSide[seat] = core.isNip(played) ? (played.prey === "kyts" ? "anti" : "kyts") : played.side;
    game.lastCardPlayed = played;
    if (type === "throw") game.throwsBy[seat] = (game.throwsBy[seat] || 0) + 1;
    if (core.isNip(played)) game.nipsPlayed[seat] = (game.nipsPlayed[seat] || 0) + 1;
    if (played.value === 5) game.fivesPlayed[seat] = (game.fivesPlayed[seat] || 0) + 1;
  }
  if ((s.hands[seat]?.length ?? 9) === 1 && s.deck.length === 0) { game.wasLoneCard = game.wasLoneCard || {}; game.wasLoneCard[seat] = true; }
  if (s.glitch?.active) game.glitchMoved[seat] = true;
  consumeGlitch(game, seat);

  game.players[seat].lastAct = Date.now();
  const me = nickOf(game, seat);
  const ev = r.ev;
  /* коли бій завершується тим самим ходом, ядро вже очистило стіл —
     тож клієнт ніколи не побачив би останню карту. надсилаємо знімок. */
  if (ev && ev.type === "bout" && ev.table) game.boutTable = ev.table;
  else game.boutTable = null;
  /* амбасадор реагує на ПОДІЇ, а не на кожен хід */
  if (game.isPve && !game.players[seat].bot) artifactHaunt(game, seat);
  if (game.isPve && !game.players[seat].bot && ev) {
    const myHand = s.hands[seat]?.length ?? 6;
    const botSeat = s.seats.find((x) => game.players[x]?.bot);
    const botHand = botSeat ? (s.hands[botSeat]?.length ?? 6) : 6;
    const voice = (k) => ambSay(game, k, false, game.ambBoth ? (Math.random() < 0.5 ? "greg" : "zhreg") : undefined);
    if (played && core.isNip(played) && (game.nipsPlayed[seat] || 0) === 1) voice("nip");
    else if (ev.type === "bout" && !ev.defended && ev.taker === seat && ev.count >= 4) voice("takes");
    else if (ev.type === "defend" && ev.allBeaten && s.table.length >= 3) voice("beats");
    else if (botHand + 3 <= myHand) voice("winning");
    else if (myHand + 3 <= botHand) voice("losing");
  }
  /* за столом на трьох амбасадори коментують хід одне одного */
  if (game.ambBoth && game.players[seat]?.bot && Math.random() < 0.22) {
    const other = game.players[seat].amb === "greg" ? "zhreg" : "greg";
    const lines = (AMB.cross && AMB.cross[other]) || [];
    if (lines.length) setTimeout(() => {
      const entry = { nick: AMB[other].name, text: lines[(Math.random() * lines.length) | 0], ts: Date.now() };
      if (rooms.get(game.code) !== game || game.finished) return;
      game.chat.push(entry);
      for (const s2 of Object.keys(game.players)) {
        const pp = game.players[s2];
        if (pp?.socketId) io.to(pp.socketId).emit("chat", entry);
      }
    }, 800);
  }
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
      ? (ev.reason === "nip" ? TXT.bout.nip
        : ev.reason === "limit" ? TXT.bout.limit
        : ev.reason === "dry" ? TXT.bout.dry : TXT.bout.plain)
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
    if (s.result) { settle(game); pushState(game, msgFn); scheduleCleanup(game); return true; }
  }
  pushState(game, msgFn);
  /* збій артефакта НЕ котиться одразу після бою (ev.type==="bout"): саме тоді стіл
     щойно спорожнів і клієнт розпочинає анімацію заміту карт. Другий pushState
     упритул до першого — з тим самим порожнім столом — клієнт розпізнає як ЩЕ
     один кінець бою (та сама евристика: попередній стіл був непорожній, новий —
     порожній) і програє зайву, візуально «зламану» другу сцену на порожньому
     столі. Тому котимо збій на будь-якому ІНШОМУ ході — жоден з них стіл не
     спорожнює, тож колізії з бойовою сценою просто не буде. */
  if (ev.type !== "bout") maybeGlitchRoll(game);
  maybeBotMove(game);
  return true;
}

/* збій артефакта: кожен успішний хід — маленький шанс зсуву стрілок */
function maybeGlitchRoll(game) {
  const st = game.state;
  if (!st || !st.glitch || !st.glitch.enabled || st.glitch.active || st.result) return;
  if (Math.random() < 0.5) {
    st.glitch.kind = core.GLITCH_KINDS[(Math.random() * core.GLITCH_KINDS.length) | 0];
    st.glitch.active = true;
    game.glitchPending = new Set(st.active);
    const L = { prey_swap: TXT.glitch.startPreySwap, throw_any: TXT.glitch.startThrowAny, value_flip: TXT.glitch.startValueFlip };
    pushState(game, () => L[st.glitch.kind] || TXT.glitch.startThrowAny);
    ambSay(game, "glitch", true);
  }
}

/* гравець відходив свій збійний хід */
function consumeGlitch(game, seat) {
  const st = game.state;
  if (!st?.glitch?.active || !game.glitchPending) return;
  game.glitchPending.delete(seat);
  for (const x of [...game.glitchPending]) if (!st.active.includes(x)) game.glitchPending.delete(x);
  if (game.glitchPending.size === 0) {
    st.glitch.active = false;
    game.glitchPending = null;
    if (!st.result) pushState(game, () => TXT.glitch.end);
  }
}

/* один пік у няві — людини чи бота */
function applyNyavPick(game, seat, sign) {
  const s = game.state;
  if (s && s.phase === "nyav" && !s.nyavSet?.includes(seat)) return;
  if (!s || s.phase !== "nyav" || !s.nyavSet.includes(seat) || game.nyavPicks[seat]) return;
  game.nyavPicks[seat] = sign;
  game.players[seat].lastAct = Date.now();
  const setNow = s.nyavSet;
  if (!setNow.every((x) => game.nyavPicks[x])) {
    pushState(game, (x) => (x === seat ? "знак прийнято. чекаємо решту." : `${nickOf(game, seat)} обрав знак.`));
    maybeBotMove(game);
    return;
  }
  const picks = {};
  for (const x of setNow) picks[x] = game.nyavPicks[x];
  const revealTxt = setNow.map((x) => `${nickOf(game, x)}: ${nyavUa[picks[x]]}`).join(" · ");
  const r = core.applyNyav(s, picks);
  game.nyavPicks = {};
  if (r.done) {
    game.nyavWins[r.winner] = (game.nyavWins[r.winner] || 0) + 1;
    const w = r.winner, ws = picks[w];
    const losers = setNow.filter((x) => x !== w);
    const ls = picks[losers[0]];
    const verdict = `${nyavUa[ws]} ${nyavVerb[ws]} ${nyavGen[ls]}.`;
    pushState(game, (x) => `${revealTxt}. ${verdict} ${x === w ? "атакуєш ти." : `атакує ${nickOf(game, w)}.`}`);
  } else {
    pushState(game, (x) =>
      `${revealTxt}. ще раз${s.nyavSet.includes(x) ? ": обери знак." : ` між: ${s.nyavSet.map((y) => nickOf(game, y)).join(", ")}.`}`);
  }
  maybeBotMove(game);
}

/* ── артефакт пам'ятає — рівень II.
   дуже рідко (5% на партію) він не просто згадує статистику, а втручається:
   збиває стрілки, кепкує з магазину, вгадує кількість повідомлень у порожній чат. */
function artifactHaunt(game, seat) {
  if (!game.isPve || game.hauntDone || Math.random() > 0.05) return;
  const tok = game.players[seat]?.token;
  const p = tok && store.get(tok);
  const q = p && p.quirks;
  if (!q) return;
  const picks = [];
  if ((q.clock || 0) >= 25) picks.push({
    text: `ти натиснув на годинник ${q.clock} разів. я рахував.`,
    effect: "clockLie",
  });
  if ((q.voidChat || 0) >= 8) picks.push({
    text: `у порожній чат ти написав ${q.voidChat} разів. деякі люди друзям пишуть менше.`,
  });
  if ((q.shopNoBuy || 0) >= 10) picks.push({
    text: `${q.shopNoBuy} разів заходив у крамницю й нічого не купив. я теж так дивлюся на вітрини.`,
  });
  if (!picks.length) return;
  const pick = picks[(Math.random() * picks.length) | 0];
  game.hauntDone = true;
  const who = game.amb === "zhreg" ? "zhreg" : "greg";
  const entry = { nick: AMB[who].name, text: pick.text, ts: Date.now() };
  game.chat.push(entry);
  for (const s2 of Object.keys(game.players)) {
    const pp = game.players[s2];
    if (pp?.socketId) io.to(pp.socketId).emit("chat", entry);
  }
  if (pick.effect) {
    game.hauntEffect = pick.effect;   /* клієнт побачить це у стані й підіграє */
    pushState(game);
    setTimeout(() => { game.hauntEffect = null; if (!game.finished) pushState(game); }, 12_000);
  }
}

/* амбасадор кидає репліку в чат ПвЄ-матчу (не частіше, ніж раз на 6с) */
function ambSay(game, key, force, who) {
  if (!game.isPve || game.finished) return;
  const speaker = who || game.amb;
  if (!speaker || !AMB[speaker]) return;
  const now = Date.now();
  /* кожна репліка — маленька подія, тож рідко й ніколи двічі поспіль.
     кулдаун 40с (у режимі на двох амбасадорів 22с), максимум 4 репліки за партію,
     і одна тема не повторюється, доки не мине окремий кулдаун теми. */
  if (!game.ambSaid) game.ambSaid = {};
  if (!force) {
    const gap = game.ambBoth ? 22_000 : 40_000;
    if (game.ambLast && now - game.ambLast < gap) return;
    if ((game.ambCount || 0) >= (game.ambBoth ? 7 : 4)) return;
    if (game.ambSaid[key] && now - game.ambSaid[key] < 90_000) return;   /* кулдаун теми */
    if (game.ambLastKey === key) return;                                  /* не два рази поспіль про те саме */
    if (game.ambBoth && game.ambLastWho === speaker && Math.random() < 0.7) return; /* хай говорять по черзі */
  }
  /* унікальність: кожна репліка звучить за партію лише раз */
  if (!game.ambUsed) game.ambUsed = new Set();
  const pool = ((AMB[speaker] && AMB[speaker][key]) || []).filter((x) => !game.ambUsed.has(speaker + "|" + x) && x !== game.ambLastText);
  if (!pool.length) return;
  const text = pool[(Math.random() * pool.length) | 0];
  game.ambUsed.add(speaker + "|" + text);
  if (!force) game.ambCount = (game.ambCount || 0) + 1;
  game.ambLast = now;
  game.ambLastKey = key;
  game.ambLastWho = speaker;
  game.ambLastText = text;
  game.ambSaid[key] = now;
  const entry = { nick: AMB[speaker].name, text, ts: now };
  game.chat.push(entry);
  if (game.chat.length > 40) game.chat.shift();
  for (const s2 of Object.keys(game.players)) {
    const pp = game.players[s2];
    if (pp?.socketId) io.to(pp.socketId).emit("chat", entry);
  }
}

/* репліка від конкретного амбасадора у будь-якій кімнаті (працює і в лобі) */
function ambSayAny(game, who, key) {
  if (!game || rooms.get(game.code) !== game || game.finished) return;
  if (!game.ambUsedAny) game.ambUsedAny = new Set();
  const pool = ((AMB[who] && AMB[who][key]) || []).filter((x) => !game.ambUsedAny.has(x));
  const list = pool.length ? pool : ((AMB[who] && AMB[who][key]) || []);
  if (!list.length) return;
  const text = list[(Math.random() * list.length) | 0];
  game.ambUsedAny.add(text);
  const entry = { nick: AMB[who].name, text, ts: Date.now() };
  game.chat.push(entry);
  if (game.chat.length > 40) game.chat.shift();
  for (const s2 of Object.keys(game.players)) {
    const pp = game.players[s2];
    if (pp?.socketId) io.to(pp.socketId).emit("chat", entry);
  }
}

/* обмін репліками між ґреґом і жреґом — по одній фразі з паузами */
function banterStep(game) {
  if (!game || rooms.get(game.code) !== game || game.finished || !game.ambBoth) return;
  if (!game.banterBag || !game.banterBag.length)
    game.banterBag = [...(AMB.banter || [])].sort(() => Math.random() - 0.5);
  const dlg = game.banterBag.pop();
  if (!dlg) return;
  dlg.forEach(([who, text], i) => {
    setTimeout(() => {
      if (rooms.get(game.code) !== game || game.finished) return;
      const entry = { nick: AMB[who].name, text, ts: Date.now() };
      game.chat.push(entry);
      if (game.chat.length > 40) game.chat.shift();
      for (const s2 of Object.keys(game.players)) {
        const pp = game.players[s2];
        if (pp?.socketId) io.to(pp.socketId).emit("chat", entry);
      }
    }, i * 1900);
  });
  game.banterTimer = setTimeout(() => banterStep(game), 45_000 + Math.random() * 35_000);
}

/* чи хтось із ботів має ходити — і якщо так, з невеликою людською затримкою */
/* кого з ботів зараз черга — рахуємо ЗАВЖДИ від актуального стану */
function pendingBot(game) {
  const st = game.state;
  if (!st || game.finished || st.result) return null;
  if (st.phase === "nyav") {
    const seat = (st.nyavSet || []).find((x) => game.players[x]?.bot && !game.nyavPicks[x]);
    return seat ? { seat, nyav: true } : null;
  }
  if (st.phase === "attack") return game.players[st.attacker]?.bot ? { seat: st.attacker } : null;
  if (st.phase === "defend") return game.players[st.defender]?.bot ? { seat: st.defender } : null;
  if (st.phase === "throw" || st.phase === "pileOn") {
    const seat = core.throwers(st).find((x) => game.players[x]?.bot && !st.passes.includes(x));
    return seat ? { seat } : null;
  }
  return null;
}

function maybeBotMove(game) {
  if (game.botTimer) return;
  if (!pendingBot(game)) return;
  game.botTimer = setTimeout(() => {
    game.botTimer = null;
    if (rooms.get(game.code) !== game || game.finished) return;
    /* стан міг змінитися, поки цокав таймер (людина встигла походити) —
       тому черговість перевіряємо ще раз, а не покладаємось на «заморожене» сидіння */
    const turn = pendingBot(game);
    if (!turn) return;
    let acted = false;
    if (turn.nyav) { applyNyavPick(game, turn.seat, bot.decideNyav()); acted = true; }
    else {
      const d = bot.botDecide(game.state, turn.seat);
      if (d) acted = performMove(game, turn.seat, d.type, d.uid);
    }
    /* страховка від застрягання: якщо хід не пройшов — пробуємо ще раз наступним тіком */
    if (!acted && pendingBot(game)) setTimeout(() => maybeBotMove(game), 250);
  }, botDelay());
}
/* людський темп у проді; прискорено лише для автотестів (BOT_FAST=1) */
function botDelay() {
  /* пауза на обдумування — бот не сипле ходами швидше, ніж людина встигає
     їх прочитати. у тестах прискорено через BOT_FAST. */
  return process.env.BOT_FAST ? 60 + Math.random() * 90 : 1900 + Math.random() * 700;
}

/* ── обмеження частоти подій на сокет ──
   загальний ліміт ~20 подій/с; для «дорогих» подій, що пишуть на диск, — суворіший */
const RL_WINDOW = 1000, RL_MAX = 60;
/* ходи навмисно щедрі: вони й так перевіряються ядром і нічого не пишуть на диск.
   суворо обмежені лише події, що торкаються диска, чату чи економіки. */
const RL_STRICT = { bannerBuy: 3, shopBuy: 3, shopBuyCard: 3, tradeCreate: 3, tradeAccept: 3,
                    lobbyChat: 4, chat: 4, quirk: 6, setProfile: 4, bannerSet: 5,
                    playAmbassadors: 6, playGreg: 6, playDaily: 4, coopQueue: 4,
                    quickMatch: 6, createRoom: 5, joinRoom: 6 };

/* ігрові події не рахуємо в загальний ліміт: вони дешеві, перевіряються ядром
   і йдуть лавиною самі по собі (один хід → оновлення стану всім за столом → відповіді).
   різати їх означало б ламати гру, а не захищати сервер. */
const RL_FREE = new Set(["move", "nyav", "rematch", "leaveRoom", "leaveQueue", "queueInfo", "onlineInfo", "state"]);

function rateGuard(socket) {
  const hits = new Map();
  socket.use(([ev], next) => {
    if (RL_FREE.has(ev)) return next();
    const now = Date.now();
    const rec = hits.get("*") || { t: now, n: 0 };
    if (now - rec.t > RL_WINDOW) { rec.t = now; rec.n = 0; }
    rec.n++; hits.set("*", rec);
    if (rec.n > RL_MAX) return next(new Error("занадто швидко"));
    const lim = RL_STRICT[ev];
    if (lim) {
      const r2 = hits.get(ev) || { t: now, n: 0 };
      if (now - r2.t > RL_WINDOW) { r2.t = now; r2.n = 0; }
      r2.n++; hits.set(ev, r2);
      if (r2.n > lim) return next(new Error("занадто швидко"));
    }
    next();
  });
  socket.on("error", () => {});
}

io.on("connection", (socket) => {
  rateGuard(socket);
  let token = null;

  socket.on("hello", ({ token: t, nick }, cb) => {
    if (typeof t !== "string" || t.length < 8 || t.length > 64) return cb?.({ error: "поганий жетон." });
    nick = String(nick || "").trim().slice(0, 12);
    if (nick.length < 2) return cb?.({ error: "нік закороткий." });
    token = t;
    const p = store.getOrCreate(token, nick);
    const roll = store.rolloverSeason(token);   /* новий місяць — новий сезон */
    socket.data.token = token;
    const code = byToken.get(token);
    const game = code ? rooms.get(code) : null;
    const profile = {
      nick: p.nick, sp: p.sp, rank: core.rankOf(p.sp), games: p.games,
      achIds: p.ach || [], avatar: p.avatar, title: p.title, streak: p.streak,
      tk: p.tk || { k: 100, a: 100 },
      frontier: p.frontier ?? 0, frontierWins: p.frontierWins || { kyts: 0, anti: 0 },
      side: p.side || "kyts",
      cards: Array.isArray(p.cards) ? p.cards : [],
      season: p.season, seasonBanners: p.seasonBanners || [], seasonRoll: roll,
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

  socket.on("startGame", (opts) => {
    const c = ctx();
    if (!c) return;
    const { game, seat } = c;
    if (game.state || game.order[0] !== seat || game.order.length < 2) return;
    game.glitchWanted = !!(opts && opts.glitch);
    if (opts && opts.bet) {
      game.bet = { phase: "pick", original: [...game.order], set: [...game.order], picks: {}, sides: {}, amount: 2, resultText: null };
      pushState(game, () => "ставка няву: обери знак і валюту.");
      return;
    }
    startDeal(game);
  });

  socket.on("betPick", ({ sign, side }) => {
    const c = ctx();
    if (!c || !c.game.bet || c.game.bet.phase !== "pick") return;
    const { game, seat } = c;
    if (!core.NYAV.includes(sign) || !game.bet.set.includes(seat) || game.bet.picks[seat]) return;
    game.bet.picks[seat] = sign;
    if (side === "k" || side === "a") game.bet.sides[seat] = side;
    game.players[seat].lastAct = Date.now();
    const setNow = game.bet.set;
    if (!setNow.every((x) => game.bet.picks[x])) {
      pushState(game, (x) => (x === seat ? "ставку прийнято. чекаємо решту." : `${nickOf(game, seat)} зробив ставку.`));
      return;
    }
    const picks = {};
    for (const x of setNow) picks[x] = game.bet.picks[x];
    const { winners } = core.resolveNyavGroup(picks);
    if (winners.length > 1) {
      game.bet.set = winners;
      game.bet.picks = {};
      pushState(game, () => "нічия у ставці — ще раз, тільки тепер між " + winners.map((x) => nickOf(game, x)).join(", ") + ".");
      return;
    }
    const winner = winners[0];
    const wp = store.get(game.players[winner].token);
    const AMOUNT = game.bet.amount;
    let gk = 0, ga = 0;
    for (const seat2 of game.bet.original) {
      if (seat2 === winner) continue;
      const lp = store.get(game.players[seat2].token);
      const side2 = game.bet.sides[seat2];
      if (!side2 || !lp?.tk || lp.tk[side2] < AMOUNT) continue;
      lp.tk[side2] -= AMOUNT;
      wp.tk[side2] = (wp.tk[side2] || 0) + AMOUNT;
      if (side2 === "k") gk += AMOUNT; else ga += AMOUNT;
    }
    store.dirty();
    game.bet.phase = "done";
    game.bet.resultText = TXT.bet.resolved(nickOf(game, winner), `${gk} ж.к / ${ga} ж.а`);
    pushState(game, () => game.bet.resultText);
    setTimeout(() => { game.bet = null; startDeal(game); }, 1800);
  });

  socket.on("quickMatch", ({ glitch } = {}, cb) => {
    if (typeof glitch === "function") { cb = glitch; glitch = false; }
    if (!token) return cb?.({ error: "спершу hello." });
    if (banGuard(cb)) return;
    if (byToken.has(token)) return cb?.({ error: "ти вже в кімнаті." });
    const want = !!glitch;
    queue = queue.filter((q) => q.token !== token && io.sockets.sockets.has(q.socketId));
    const oppo = queue.find((q) => q.token !== token && banLeft(q.token) === 0 && !!q.glitch === want);
    if (!oppo) {
      queue.push({ token, socketId: socket.id, glitch: want, since: Date.now() });
      /* поки шукається суперник — ґреґ і жреґ розважають розмовою */
      const sid = socket.id;
      const chatter = (i) => setTimeout(() => {
        if (!queue.some((q) => q.socketId === sid)) return;
        const bag = AMB.banter || [];
        const dlg = bag[(Math.random() * bag.length) | 0] || [];
        dlg.forEach(([who, txt], k) => setTimeout(() => {
          if (!queue.some((q) => q.socketId === sid)) return;
          io.to(sid).emit("chat", { nick: AMB[who].name, text: txt, ts: Date.now() });
        }, k * 1900));
        chatter(i + 1);
      }, i === 0 ? 4000 : 22_000 + Math.random() * 14_000);
      chatter(0);
      /* є хтось з іншим налаштуванням — за 5с запропонуємо перемкнутись */
      const other = queue.some((q) => q.token !== token && !!q.glitch !== want);
      return cb?.({ queued: true, otherModeWaiting: other });
    }
    queue = queue.filter((q) => q !== oppo);
    const code = newCode();
    const game = newGame(code);
    game.glitchWanted = want;
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

  /* ── чат «у нікуди» під час пошуку: амбасадори складають компанію ── */
  const lobbyEcho = (nick, text) => socket.emit("chat", { nick, text, ts: Date.now() });
  let lobbyTimer = null, lobbyBag = [], lobbyIdle = null;

  const lobbySay = (who, key) => {
    const pool = (AMB[who] && AMB[who][key]) || [];
    if (pool.length) lobbyEcho(AMB[who].name, pool[(Math.random() * pool.length) | 0]);
  };
  const lobbyBanter = () => {
    if (!lobbyBag.length) lobbyBag = [...(AMB.banter || [])].sort(() => Math.random() - 0.5);
    const dlg = lobbyBag.pop();
    if (!dlg) return;
    dlg.forEach(([who, text], i) => setTimeout(() => {
      if (socket.connected) lobbyEcho(AMB[who].name, text);
    }, i * 1900));
  };
  const startLobbyChat = () => {
    clearInterval(lobbyTimer);
    setTimeout(() => { if (socket.connected) lobbySay(Math.random() < 0.5 ? "greg" : "zhreg", "lobby"); }, 2500);
    lobbyTimer = setInterval(() => {
      if (!socket.connected) return clearInterval(lobbyTimer);
      if (Math.random() < 0.55) lobbyBanter();
      else lobbySay(Math.random() < 0.5 ? "greg" : "zhreg", "lobby");
    }, 17_000);
  };
  const stopLobbyChat = () => { clearInterval(lobbyTimer); lobbyTimer = null; clearTimeout(lobbyIdle); };
  socket.on("disconnect", stopLobbyChat);

  socket.on("lobbyChat", ({ text }) => {
    text = String(text || "").trim().slice(0, 120);
    if (!text) return;
    const p = token && store.get(token);
    lobbyEcho(p?.nick || "ти", text);
    /* згадав на ім'я — відповідає саме той */
    const low = text.toLowerCase();
    const gregHit = /ґ?реґ|грег|greg/.test(low) && !/жреґ|жрег|zhreg/.test(low);
    const zhregHit = /жреґ|жрег|zhreg/.test(low);
    if (gregHit || zhregHit) {
      const who = zhregHit ? "zhreg" : "greg";
      setTimeout(() => { if (socket.connected) lobbySay(who, "mention"); }, 900);
      if (token) store.award(token, "sec_poklykach");
      return;
    }
    clearTimeout(lobbyIdle);
    lobbyIdle = setTimeout(() => {
      if (socket.connected) lobbySay(Math.random() < 0.5 ? "greg" : "zhreg", "lobby");
    }, 3000 + Math.random() * 2500);
  });

  socket.on("lobbyChatOn", () => startLobbyChat());
  socket.on("lobbyChatOff", () => stopLobbyChat());

  socket.on("queueInfo", (cb) => {
    const me = queue.find((q) => q.token === token);
    if (!me) return cb?.({ inQueue: false });
    cb?.({
      inQueue: true,
      waitedMs: Date.now() - (me.since || Date.now()),
      otherModeWaiting: queue.some((q) => q.token !== token && !!q.glitch !== !!me.glitch),
      sameModeWaiting: queue.filter((q) => q.token !== token && !!q.glitch === !!me.glitch).length,
    });
  });

  /* ── ПвЄ: ґреґ сідає за стіл, коли людей бракує ── */
  /* стіл з амбасадорами: both — троє за столом; solo — 1 на 1 проти ПРОТИЛЕЖНОЇ фракції */
  socket.on("playAmbassadors", ({ glitch, both } = {}, cb) => {
    if (!token) return cb?.({ error: "спершу hello." });
    if (banGuard(cb)) return;
    if (byToken.has(token)) return cb?.({ error: "ти вже в кімнаті." });
    const p = store.get(token);
    const code = newCode();
    const game = newGame(code);
    game.isPve = true;
    game.glitchWanted = !!glitch;
    game.players.A = { token, nick: p.nick, socketId: socket.id, connected: true, lastAct: Date.now() };
    if (both) {
      game.amb = "greg"; game.ambBoth = true;
      game.players.B = { bot: true, amb: "greg", nick: AMB.greg.name, connected: true, lastAct: Date.now() };
      game.players.C = { bot: true, amb: "zhreg", nick: AMB.zhreg.name, connected: true, lastAct: Date.now() };
      game.order = ["A", "B", "C"];
    } else {
      /* амбасадор ніколи не тієї ж фракції, що гравець */
      game.amb = (p.side === "anti") ? "greg" : "zhreg";
      game.players.B = { bot: true, amb: game.amb, nick: AMB[game.amb].name, connected: true, lastAct: Date.now() };
      game.order = ["A", "B"];
    }
    rooms.set(code, game);
    byToken.set(token, code);
    cb?.({ code, amb: game.amb, both: !!both });
    startDeal(game);
    /* за столом на трьох вітаються обидва — кожен своїм голосом */
    if (both) {
      setTimeout(() => ambSayAny(game, "greg", "greeting"), 800);
      setTimeout(() => ambSayAny(game, "zhreg", "greeting"), 2200);
      game.banterTimer = setTimeout(() => banterStep(game), 14_000);
    } else {
      setTimeout(() => ambSay(game, "greeting", true), 800);
    }
  });

  /* ── кооператив. черга на двох, потім стіл на чотирьох:
     двоє людей + обидва амбасадори (боти сидять через одного, щоб не ходити поспіль) ── */
  socket.on("coopQueue", (cb) => {
    if (!token) return cb?.({ error: "спершу hello." });
    if (banGuard(cb)) return;
    if (byToken.has(token)) return cb?.({ error: "ти вже в кімнаті." });
    /* чистимо чергу від мертвих сокетів і від тих, хто вже встиг сісти за інший стіл */
    coopQueue = coopQueue.filter((q) =>
      q.token !== token && io.sockets.sockets.has(q.socketId) && !byToken.has(q.token));
    const mate = coopQueue.find((q) => q.token !== token && banLeft(q.token) === 0);
    if (!mate) { coopQueue.push({ token, socketId: socket.id, since: Date.now() }); return cb?.({ queued: true }); }
    coopQueue = coopQueue.filter((q) => q !== mate);
    const code = newCode();
    const game = newGame(code);
    game.isPve = true; game.isCoop = true; game.ambBoth = true; game.amb = "greg";
    game.players.A = { token: mate.token, nick: store.get(mate.token).nick, socketId: mate.socketId, connected: true, lastAct: Date.now() };
    game.players.B = { bot: true, amb: "greg", nick: AMB.greg.name, connected: true, lastAct: Date.now() };
    game.players.C = { token, nick: store.get(token).nick, socketId: socket.id, connected: true, lastAct: Date.now() };
    game.players.D = { bot: true, amb: "zhreg", nick: AMB.zhreg.name, connected: true, lastAct: Date.now() };
    game.order = ["A", "B", "C", "D"];
    rooms.set(code, game);
    byToken.set(mate.token, code); byToken.set(token, code);
    cb?.({ code, coop: true });
    /* напарник міг ще стояти в лобі — надсилаємо йому стан першим, до роздачі */
    const mateSock = io.sockets.sockets.get(mate.socketId);
    if (mateSock) mateSock.emit("state", viewFor(game, "A", "напарника знайдено. сідаємо."));
    startDeal(game);
    setTimeout(() => {
      ambSayAny(game, "greg", "greeting");
      setTimeout(() => ambSayAny(game, "zhreg", "greeting"), 1600);
      game.banterTimer = setTimeout(() => banterStep(game), 14_000);
    }, 900);
  });

  socket.on("coopLeave", () => { coopQueue = coopQueue.filter((q) => q.token !== token); });

  /* ── аварійний вихід — прибирає гравця з усіх столів і черг ── */
  socket.on("panicLeave", (cb) => {
    if (!token) return cb?.({ ok: true });
    queue = queue.filter((q) => q.token !== token);
    coopQueue = coopQueue.filter((q) => q.token !== token);
    for (const [code, g] of [...rooms]) {
      const seat = Object.keys(g.players).find((x) => g.players[x]?.token === token);
      if (!seat) continue;
      if (g.state && !g.finished) {
        const humans = g.order.filter((x) => !g.players[x]?.bot && x !== seat && g.players[x]?.connected);
        if (g.isPve || !humans.length) {
          clearTimeout(g.botTimer); clearTimeout(g.banterTimer);
          g.finished = true; g.settled = true;
          for (const s2 of Object.keys(g.players)) {
            const t2 = g.players[s2]?.token;
            if (t2 && byToken.get(t2) === code) byToken.delete(t2);
          }
          rooms.delete(code);
          continue;
        }
        dropFromGame(g, seat, "drop");
      } else if (!g.state) {
        delete g.players[seat];
        g.order = g.order.filter((x) => x !== seat);
        if (!g.order.length) rooms.delete(code);
        else pushState(g, () => "хтось передумав. чекаємо далі.");
      }
      if (byToken.get(token) === code) byToken.delete(token);
    }
    byToken.delete(token);
    cb?.({ ok: true });
  });

  socket.on("playGreg", ({ glitch } = {}, cb) => {
    if (!token) return cb?.({ error: "спершу hello." });
    if (banGuard(cb)) return;
    if (byToken.has(token)) return cb?.({ error: "ти вже в кімнаті." });
    const code = newCode();
    const game = newGame(code);
    game.isPve = true;
    game.glitchWanted = !!glitch;
    /* амбасадор ніколи не своєї фракції — і тут теж, не лише в «столі з амбасадорами» */
    game.amb = (store.get(token)?.side === "anti") ? "greg" : "zhreg";
    game.players.A = { token, nick: store.get(token).nick, socketId: socket.id, connected: true, lastAct: Date.now() };
    game.players.B = { bot: true, nick: AMB[game.amb].name, connected: true, lastAct: Date.now() };
    game.order = ["A", "B"];
    rooms.set(code, game);
    byToken.set(token, code);
    cb?.({ code, amb: game.amb });
    startDeal(game);
    setTimeout(() => ambSay(game, "greeting", true), 900);
  });

  /* ── стіл дня: та сама роздача всім, одна спроба на добу ── */
  socket.on("playDaily", ({ glitch } = {}, cb) => {
    if (!token) return cb?.({ error: "спершу hello." });
    if (banGuard(cb)) return;
    if (store.dailyPlayedToday(token)) return cb?.({ error: "already" });
    if (byToken.has(token)) return cb?.({ error: "ти вже в кімнаті." });
    const code = newCode();
    const game = newGame(code);
    game.isPve = true; game.isDaily = true;
    game.glitchWanted = false; /* стіл дня — чистий виклик, без збоїв */
    game.amb = "greg";
    game.players.A = { token, nick: store.get(token).nick, socketId: socket.id, connected: true, lastAct: Date.now() };
    game.players.B = { bot: true, nick: AMB.greg.name, connected: true, lastAct: Date.now() };
    game.order = ["A", "B"];
    rooms.set(code, game);
    byToken.set(token, code);
    cb?.({ code });
    startDeal(game, store.todayKey());
  });

  socket.on("dailyInfo", (cb) => {
    cb?.({
      played: token ? store.dailyPlayedToday(token) : false,
      board: store.dailyBoard().entries.slice(0, 50).map((e) => ({ nick: e.nick, won: e.won, durMs: e.durMs, place: e.place })),
    });
  });

  /* чат кімнати — і в лобі, і під час партії */
  socket.on("chat", ({ text }) => {
    const c = ctx();
    /* у черзі кімнати нема — але писати можна: відповідають амбасадори */
    if (!c) {
      const inQ = queue.some((q) => q.token === token);
      if (!inQ || !token) return;
      const t = String(text || "").trim().slice(0, 120);
      if (!t) return;
      const me = store.get(token);
      socket.emit("chat", { nick: me?.nick || "ти", text: t, ts: Date.now(), self: true });
      const low = t.toLowerCase();
      const g = /(ґреґ|греґ|ґрег|грег|greg)/i.test(low), z = /(жреґ|жрег|zhreg)/i.test(low);
      const say = (who, key, delay) => setTimeout(() => {
        if (!queue.some((q) => q.token === token)) return;
        const arr = (AMB[who] && AMB[who][key]) || [];
        if (!arr.length) return;
        socket.emit("chat", { nick: AMB[who].name, text: arr[(Math.random() * arr.length) | 0], ts: Date.now() });
      }, delay);
      if (g) say("greg", "mention", 800);
      if (z) say("zhreg", "mention", g ? 2200 : 800);
      if (!g && !z && Math.random() < 0.55) say(Math.random() < 0.5 ? "greg" : "zhreg", "lobby", 1200);
      return;
    }
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
    /* амбасадор відгукується на своє імʼя (усі варіанти написання) */
    const low = text.toLowerCase();
    const hitG = /(ґреґ|греґ|ґрег|грег|greg)/i.test(low);
    const hitZ = /(жреґ|жрег|жрeґ|zhreg)/i.test(low);
    const hereG = game.isPve && (game.amb === "greg" || game.ambBoth) || !game.isPve;
    const hereZ = game.isPve && (game.amb === "zhreg" || game.ambBoth) || !game.isPve;
    if (hitG && hereG) setTimeout(() => ambSayAny(game, "greg", "mention"), 700);
    if (hitZ && hereZ) setTimeout(() => ambSayAny(game, "zhreg", "mention"), hitG ? 2100 : 700);

    const othersOnline = Object.keys(game.players)
      .filter((x) => x !== seat && game.players[x].connected);
    if (!othersOnline.length) {
      setTimeout(() => {
        if (rooms.get(game.code) !== game) return;
        const who = game.amb || "greg";
        const g = { nick: AMB[who].name, text: ambLine(who, "idle") || "квак.", ts: Date.now() };
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
      tk: p.tk, side: p.side,
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
      frontier: p.frontier ?? 0, frontierWins: p.frontierWins || { kyts: 0, anti: 0 },
      side: p.side || "kyts",
      hist: p.hist || [],
      pos: store.position(token),
    });
  });

  socket.on("nyav", ({ sign }) => {
    const c = ctx();
    if (!c || c.game.state?.phase !== "nyav" || !core.NYAV.includes(sign)) return;
    applyNyavPick(c.game, c.seat, sign);
  });

  socket.on("move", ({ type, uid }) => {
    const c = ctx();
    if (!c || !c.game.state || c.game.finished) return;
    performMove(c.game, c.seat, type, uid);
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
    for (const x of game.order) if (game.players[x]?.bot) game.rematch[x] = true; // амбасадор завжди готовий
    /* реванш більше не перекидає монетку й не перейменовує обох ботів в одне імʼя.
       за столом з обома амбасадорами склад лишається; у дуелі суперник — за фракційним правилом. */
    if (game.isPve && !game.isDaily) {
      game.ambSaid = {};
      if (!game.ambBoth) {
        game.amb = (store.get(token)?.side === "anti") ? "greg" : "zhreg";
        for (const x of game.order) {
          if (!game.players[x]?.bot) continue;
          game.players[x].amb = game.amb;
          game.players[x].nick = AMB[game.amb].name;
        }
      }
    }
    const everyone = game.order.filter((x) => game.players[x]?.connected);
    if (everyone.length >= 2 && everyone.every((x) => game.rematch[x])) {
      game.order = everyone;
      game.rematched = true;
      clearTimeout(game.botTimer); game.botTimer = null;
      clearTimeout(game.banterTimer);
      game.rematch = {};
      game.hauntDone = false; game.hauntEffect = null;
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
    /* за столом з амбасадорами людина одна проти ботів —
       її вихід не має лишати кімнату «догравати» саму із собою */
    if (game.isPve && game.state && !game.finished) {
      const humans = game.order.filter((x) => !game.players[x]?.bot && x !== seat && game.players[x]?.connected);
      if (!humans.length) {
        clearTimeout(game.botTimer); game.botTimer = null;
        clearTimeout(game.banterTimer);
        game.finished = true; game.settled = true;
        for (const s2 of Object.keys(game.players)) {
          const t2 = game.players[s2]?.token;
          if (t2 && byToken.get(t2) === game.code) byToken.delete(t2);
        }
        rooms.delete(game.code);
        return;
      }
    }
    /* ПвЄ: за столом лишаються самі боти — партію просто закриваємо */
    if (game.isPve && game.state && !game.finished) {
      const humans = game.order.filter((x) => !game.players[x].bot && x !== seat && game.players[x].connected);
      if (!humans.length) {
        clearTimeout(game.botTimer); game.botTimer = null;
        clearTimeout(game.banterTimer);
        game.finished = true;
        byToken.delete(token);
        rooms.delete(game.code);
        return;
      }
    }
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

  socket.on("titryBonus", (cb) => {
    const p = token && store.get(token);
    if (!p) return cb?.({ error: "нема профілю." });
    if (p.seenTitry) return cb?.({ already: true, tk: p.tk });
    p.seenTitry = true;
    if (!p.tk) p.tk = { k: 0, a: 0 };
    p.tk.k += 2; p.tk.a += 2;
    store.dirty();
    cb?.({ ok: true, tk: p.tk });
  });

  socket.on("setBanner", ({ id }, cb) => {
    const p = token && store.get(token);
    if (!p) return cb?.({ error: "нема профілю." });
    if (id && !(p.cards || []).includes(id)) return cb?.({ error: "цього банера ще нема в колекції." });
    p.banner = id || "";
    store.dirty();
    cb?.({ ok: true, banner: p.banner });
  });

  socket.on("collection", (cb) => {
    const p = token && store.get(token);
    cb?.({ cards: (p && p.cards) || [], dupes: (p && p.dupes) || {}, banner: (p && p.banner) || "" });
  });

  socket.on("tradeCreate", ({ giveId }, cb) => {
    if (!token) return cb?.({ error: "спершу hello." });
    cb?.(store.tradeCreate(token, giveId));
  });

  socket.on("tradeAccept", ({ code, giveId }, cb) => {
    if (!token) return cb?.({ error: "спершу hello." });
    const r = store.tradeAccept(token, code, giveId);
    if (r.ok && store.award(token, "sec_obminyaka")) r.newAch = [ACH.sec_obminyaka.name];
    cb?.(r);
  });

  socket.on("wantedToday", (cb) => cb?.(store.wantedToday()));

  socket.on("factionStats", (cb) => {
    const m = store.factionMissionStats();
    cb?.({ today: { kyts: m.kyts, anti: m.anti }, total: { kyts: m.allKyts, anti: m.allAnti }, wins: store.factionWins() });
  });

  socket.on("missionToday", (cb) => {
    if (!token) return cb?.(null);
    const m = store.missionToday(token);
    if (!m) return cb?.(null);
    cb?.({ id: m.id, text: m.text, who: m.who, goal: m.goal, prog: m.prog || 0, done: !!m.done, name: AMB[m.who]?.name || m.who });
  });

  socket.on("missionClaim", (cb) => {
    if (!token) return cb?.({ error: "спершу hello." });
    const r = store.missionClaim(token);
    if (r.error) return cb?.(r);
    cb?.({
      ok: true, tk: r.tk,
      claimed: { ...r.claimed, name: AMB[r.claimed.who]?.name || r.claimed.who },
      next: { id: r.next.id, text: r.next.text, who: r.next.who, goal: r.next.goal, prog: r.next.prog || 0, done: !!r.next.done, name: AMB[r.next.who]?.name || r.next.who },
    });
  });

  socket.on("quirk", ({ key, by }) => {
    if (!token) return;
    const OK = ["clock", "voidChat", "shopNoBuy", "stare", "rematch", "menu"];
    if (!OK.includes(key)) return;
    store.bumpQuirk(token, key, Math.max(1, Math.min(30, parseInt(by, 10) || 1)));
  });

  /* ── банери-ніпи: єдине сховище з колекцією (p.cards + p.dupes) ── */
  const BANNERS = {
    nip_rudy:   { side: "k", name: "рудик" },
    nip_white:  { side: "k", name: "біляш" },
    nip_black:  { side: "k", name: "вуглик" },
    nip_green:  { side: "a", name: "зеленка" },
    nip_violet: { side: "a", name: "філя" },
    nip_blue:   { side: "a", name: "синька" },
  };
  const BANNER_PRICE = 40;
  const cardsOf = (p) => { if (!Array.isArray(p.cards)) p.cards = []; return p.cards; };
  const dupesOf = (p) => { if (!p.dupes || typeof p.dupes !== "object") p.dupes = {}; return p.dupes; };

  socket.on("bannerInfo", (cb) => {
    const p = token && store.get(token);
    if (!p) return cb?.({ error: "нема профілю." });
    cb?.({
      catalog: Object.entries(BANNERS).map(([id, b]) => ({ id, ...b, price: BANNER_PRICE })),
      owned: cardsOf(p).filter((x) => BANNERS[x]),
      dupes: dupesOf(p), active: p.banner || "", tk: p.tk,
    });
  });

  socket.on("bannerBuy", ({ id }, cb) => {
    const p = token && store.get(token);
    if (!p || !BANNERS[id]) return cb?.({ error: "невідомий банер." });
    const k = BANNERS[id].side;
    if (!p.tk || p.tk[k] < BANNER_PRICE)
      return cb?.({ error: `треба ${BANNER_PRICE} ${k === "k" ? "ж.к" : "ж.а"}.` });
    p.tk[k] -= BANNER_PRICE;
    const owned = cardsOf(p), dupes = dupesOf(p);
    let dup = false;
    if (owned.includes(id)) { dupes[id] = (dupes[id] || 0) + 1; dup = true; }
    else owned.push(id);
    const mine = owned.filter((x) => BANNERS[x]);
    const got = [];
    if (mine.length >= 3 && store.award(token, "sec_kolekcioner_pc")) got.push(ACH.sec_kolekcioner_pc.name);
    if (mine.length >= 6 && store.award(token, "amb_albom")) got.push(ACH.amb_albom.name);
    store.dirty();
    cb?.({ ok: true, tk: p.tk, owned: mine, dupes, dup, newAch: got });
  });

  socket.on("bannerSet", ({ id }, cb) => {
    const p = token && store.get(token);
    if (!p) return cb?.({ error: "нема профілю." });
    if (id && !cardsOf(p).includes(id)) return cb?.({ error: "цього банера ще нема." });
    p.banner = id || "";
    store.dirty();
    cb?.({ ok: true, active: p.banner });
  });

  socket.on("shopBuyCard", ({ id, side, price }, cb) => {
    const p = token && store.get(token);
    if (!p) return cb?.({ error: "нема профілю." });
    const k = side === "a" ? "a" : "k";
    const NIP_IDS = ["nip_green","nip_violet","nip_blue","nip_black","nip_white","nip_rudy"];
    if (!NIP_IDS.includes(id)) return cb?.({ error: "у крамниці лишились самі ніпи." });
    const cost = 40;
    p.cards = Array.isArray(p.cards) ? p.cards : [];
    if (!p.dupes) p.dupes = {};
    if (!p.tk || p.tk[k] < cost) return cb?.({ error: `треба ${cost} жетонів цієї фракції.` });
    p.tk[k] -= cost;
    let dupe = false;
    if (p.cards.includes(id)) { p.dupes[id] = (p.dupes[id] || 0) + 1; dupe = true; }
    else p.cards.push(id);
    const got = [];
    if (p.cards.length >= 3 && store.award(token, "sec_kolekcioner_pc")) got.push(ACH.sec_kolekcioner_pc.name);
    if (p.cards.length >= 6 && store.award(token, "sec_povna_kolekciya")) got.push(ACH.sec_povna_kolekciya.name);
    store.dirty();
    cb?.({ ok: true, tk: p.tk, cards: p.cards, dupes: p.dupes, dupe, newAch: got });
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
  socket.on("topPve", (cb) => {
    cb?.({ list: store.topPve(100), mePos: token ? store.positionPve(token) : null });
  });

  socket.on("clockClick", () => {
    const c = ctx();
    if (!c) return;
    const { game, seat } = c;
    game.clockClicks = game.clockClicks || {};
    game.clockClicks[seat] = (game.clockClicks[seat] || 0) + 1;
  });

  socket.on("secretAch", ({ id }) => {
    if (!token) return;
    if (!["sec_poklykach", "sec_balakun"].includes(id)) return;
    if (store.award(token, id)) {
      const p = store.get(token);
      if (p?.tk) { p.tk.k += 3; p.tk.a += 3; store.dirty(); }
      socket.emit("secretUnlocked", { id, name: ACH[id].name });
    }
  });

  socket.on("onlineInfo", (cb) => {
    cb?.({ online: io.engine.clientsCount, inGame: [...rooms.values()].filter((g) => g.state && !g.finished).length, queue: queue.length });
  });

  /* рідкість і бали досягнень: чим важче — тим дорожча рамка */
  const ACH_RARITY = {
    pve_znaiomstvo: "common", nipdyp: "common", seriya: "common", amb_stil: "common",
    blyskavka: "uncommon", sukha: "uncommon", movchvoda: "uncommon", pve_greg: "uncommon",
    pve_zhreg: "uncommon", pve_sukho: "uncommon", pve_shvydko: "uncommon", zhabhor: "uncommon",
    maraton: "rare", kolektsioner: "rare", nyavmaster: "rare", feniks: "rare", pyatykut: "rare",
    pyatipyat: "rare", glitchsurf: "rare", zhetonoyid: "rare", pve_obydva: "rare",
    amb_obydva: "rare", sec_kolekcioner_pc: "rare", sec_kupets: "rare",
    nyavkosmos: "epic", tyzhnevyk: "epic", pve_desyat: "epic", amb_ostanni: "epic",
    amb_albom: "epic", sec_lovets: "epic", sec_obminyaka: "epic",
    sec_povna_kolekciya: "legendary", sec_poklykach: "legendary", sec_balakun: "legendary",
    sec_nichnyi: "legendary", sec_hodynnyk: "legendary", sec_odna: "legendary",
  };
  const ACH_POINTS = { common: 5, uncommon: 10, rare: 15, epic: 25, legendary: 50 };

  socket.on("achList", (cb) => cb?.(Object.entries(ACH).map(([id, a]) => {
    const rar = ACH_RARITY[id] || (a.secret ? "legendary" : "common");
    return { id, name: a.name, desc: a.desc, pve: !!a.pve, secret: !!a.secret, rarity: rar, points: ACH_POINTS[rar] };
  })));

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
    /* сторож проти «нявкають ґреґ і жреґ… і нічого не відбувається».
       якщо ботам є чий хід, а таймер загубився — штовхаємо партію далі. */
    if (!game.botTimer && !st.result) maybeBotMove(game);
    /* сторож: черга бота могла загубитись (гонка станів) — штовхаємо його ще раз */
    if (!game.botTimer && pendingBot(game)) maybeBotMove(game);

    if (st.phase === "nyav") {
      for (const seat of st.nyavSet || []) {
        if (game.players[seat]?.bot) continue;
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
      if (!game.players[st.attacker]?.bot && now - game.players[st.attacker].lastAct > IDLE_ATTACK_MS)
        dropFromGame(game, st.attacker, "idle");
    } else if (st.phase === "defend") {
      if (!game.players[st.defender]?.bot && now - game.players[st.defender].lastAct > IDLE_SOFT_MS * 2) {
        const r = core.moveTake(st, st.defender);
        game.players[st.defender].lastAct = now;
        if (r.ok) {
          consumeGlitch(game, st.defender);
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
        if (game.players[seat]?.bot) continue;
        if (!st.passes.includes(seat) && now - game.players[seat].lastAct > IDLE_SOFT_MS) {
          const r = core.movePass(st, seat);
          game.players[seat].lastAct = now;
          if (r.ok) consumeGlitch(game, seat);
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
