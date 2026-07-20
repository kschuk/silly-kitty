/* ════════════════════════════════════════════════
   сховище гравців: token → {nick, sp, games, w, l, d, streak}
   json-файл. на railway примонтуй volume у /app/data.
   ════════════════════════════════════════════════ */

const fs = require("fs");
const path = require("path");

const DIR = path.join(__dirname, "data");
const FILE = path.join(DIR, "players.json");
const DAILY_FILE = path.join(DIR, "daily.json");

let players = {};
let daily = { date: null, entries: [] };
let saveTimer = null;
let saveTimerD = null;

function load() {
  try {
    if (fs.existsSync(FILE)) players = JSON.parse(fs.readFileSync(FILE, "utf8"));
    // міграція зі старого поля rating → sp
    for (const t of Object.keys(players)) {
      const p = players[t];
      if (p.sp == null && p.rating != null) p.sp = p.rating;
      if (p.sp == null) p.sp = 0;
      if (!p.migr2) { p.sp = Math.max(0, (p.sp | 0) - 1000); p.migr2 = true; }
      if (p.streak == null) p.streak = 0;
      if (!Array.isArray(p.ach)) p.ach = [];
      if (!Array.isArray(p.hist)) p.hist = [];
      if (!p.avatar) p.avatar = "cat_black";
      if (p.title == null) p.title = "";
      if (!p.fastWins) p.fastWins = 0;
      if (!p.banUntil) p.banUntil = 0;
      if (!p.tk) p.tk = { k: 100, a: 100 };
      if (p.seenTitry == null) p.seenTitry = false;
      if (p.frontier == null) p.frontier = 0;                 // мапа завойовувань: -4..4
      if (!p.frontierWins) p.frontierWins = { kyts: 0, anti: 0 };
      if (p.dailyDate == null) p.dailyDate = null;
      if (p.side !== "kyts" && p.side !== "anti") p.side = "kyts";
      if (!p.dailyStreak) p.dailyStreak = 0;
      if (!p.pveWins) p.pveWins = 0;
      if (!Array.isArray(p.cards)) p.cards = [];
      if (!p.dupes || typeof p.dupes !== "object") p.dupes = {};   // id → скільки зайвих
      if (typeof p.banner !== "string") p.banner = "";              // активний банер профілю
      if (!p.quirks || typeof p.quirks !== "object") p.quirks = {}; // «артефакт памʼятає»
      if (typeof p.quirkSeen !== "number") p.quirkSeen = 0;
      if (p.beatGreg == null) p.beatGreg = false;
      if (p.beatZhreg == null) p.beatZhreg = false;  // сторона мапи             // «стіл дня»: дата останньої спроби
    }
  } catch (e) {
    console.error("сховище не прочиталось, з нуля:", e.message);
    players = {};
  }
  try {
    if (fs.existsSync(DAILY_FILE)) daily = JSON.parse(fs.readFileSync(DAILY_FILE, "utf8"));
  } catch (e) { daily = { date: null, entries: [] }; }
}

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });
      const tmp = FILE + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(players));
      fs.renameSync(tmp, FILE);
    } catch (e) {
      console.error("сховище не записалось:", e.message);
    }
  }, 1500);
}

function saveDaily() {
  clearTimeout(saveTimerD);
  saveTimerD = setTimeout(() => {
    try {
      if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });
      const tmp = DAILY_FILE + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(daily));
      fs.renameSync(tmp, DAILY_FILE);
    } catch (e) { console.error("щоденник не записався:", e.message); }
  }, 1200);
}

/* «стіл дня»: сьогоднішня дата UTC як ключ дня */
function todayKey() { return new Date().toISOString().slice(0, 10); }

/* «розшукується»: детермінований вибір по даті — однаковий для всіх гравців світу */
const KYTS_SUITS = ["avan", "char", "vata"];
const ANTI_SUITS = ["krad", "mani", "shef"];
function wantedToday() {
  const key = todayKey();
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
  h = h >>> 0;
  const pick = (arr, salt) => {
    const x = (h ^ Math.imul(salt, 2654435761)) >>> 0;
    return { suit: arr[x % arr.length], value: ((x >>> 4) % 5) + 1 };
  };
  const k = pick(KYTS_SUITS, 1), a = pick(ANTI_SUITS, 2);
  return {
    date: key,
    kyts: { id: `${k.suit}_${k.value}`, suit: k.suit, value: k.value },
    anti: { id: `${a.suit}_${a.value}`, suit: a.suit, value: a.value },
  };
}
function yesterdayKey() { return new Date(Date.now() - 86_400_000).toISOString().slice(0, 10); }

/* чи вже грав сьогодні (одна спроба на добу — вордл-стиль) */
function dailyPlayedToday(token) {
  const p = players[token];
  return !!p && p.dailyDate === todayKey();
}

/* записати результат столу дня. once-per-day гейт перевіряє викликач */
function recordDaily(token, nick, entry) {
  const p = players[token];
  let streak = 0;
  if (p) {
    p.dailyStreak = p.dailyDate === yesterdayKey() ? (p.dailyStreak || 0) + 1 : 1;
    streak = p.dailyStreak;
    p.dailyDate = todayKey();
    save();
  }
  if (daily.date !== todayKey()) daily = { date: todayKey(), entries: [] };
  daily.entries = daily.entries.filter((e) => e.token !== token);
  daily.entries.push({ token, nick, ...entry, ts: Date.now() });
  daily.entries.sort((a, b) => {
    if (a.won !== b.won) return a.won ? -1 : 1;
    return a.durMs - b.durMs;
  });
  saveDaily();
  return streak;
}

function dailyBoard() {
  if (daily.date !== todayKey()) return { date: todayKey(), entries: [] };
  return daily;
}

function getOrCreate(token, nick) {
  if (!players[token]) {
    players[token] = { nick, sp: 0, games: 0, w: 0, l: 0, d: 0, streak: 0, ach: [], hist: [], avatar: "cat_black", title: "", fastWins: 0, banUntil: 0, tk: { k: 100, a: 100 }, seenTitry: false, frontier: 0, frontierWins: { kyts: 0, anti: 0 }, dailyDate: null, dailyStreak: 0, cards: [], dupes: {}, banner: "", quirks: {}, quirkSeen: 0, pveWins: 0, beatGreg: false, beatZhreg: false, side: "kyts", migr2: true, seen: Date.now() };
  } else {
    players[token].nick = nick || players[token].nick;
    players[token].seen = Date.now();
  }
  save();
  return players[token];
}

const get = (token) => players[token] || null;

/* застосувати результат матчу (2–5 гравців) */
function applyMatch(results) {
  for (const r of results) {
    const p = players[r.token];
    if (!p) continue;
    p.sp = Math.max(0, Math.round((p.sp + r.delta) * 10) / 10);
    p.games++;
    if (r.won) { p.w++; p.streak = (p.streak || 0) + 1; }
    else if (r.drew) { p.d++; }
    else { p.l++; p.streak = 0; }
  }
  save();
}

/* всесвітня таблиця: нік + очки, топ-N */
function setProfile(token, { nick, avatar, title }, validAvatars, validTitles) {
  const p = players[token];
  if (!p) return null;
  if (nick != null) {
    nick = String(nick).trim().slice(0, 12);
    if (nick.length >= 2) p.nick = nick;
  }
  if (avatar != null && validAvatars.includes(avatar)) p.avatar = avatar;
  if (arguments[1] && (arguments[1].side === "kyts" || arguments[1].side === "anti")) p.side = arguments[1].side;
  if (title != null && (title === "" || validTitles.includes(title))) p.title = title;
  save();
  return p;
}

function pushHist(token, entry) {
  const p = players[token];
  if (!p) return;
  p.hist.unshift(entry);
  if (p.hist.length > 20) p.hist.length = 20;
  save();
}

/* окрема ліга ПвЕ: рахуємо перемоги над амбасадорами */
function topPve(n = 50) {
  return Object.values(players)
    .filter((p) => (p.pveWins || 0) > 0)
    .sort((a, b) => (b.pveWins || 0) - (a.pveWins || 0))
    .slice(0, n)
    .map((p) => ({
      nick: p.nick, pveWins: p.pveWins || 0, avatar: p.avatar || "cat_black",
      side: p.side || "kyts", beatGreg: !!p.beatGreg, beatZhreg: !!p.beatZhreg,
    }));
}

function positionPve(token) {
  const me = players[token];
  if (!me || !(me.pveWins > 0)) return null;
  const all = Object.values(players).filter((p) => (p.pveWins || 0) > 0).sort((a, b) => (b.pveWins || 0) - (a.pveWins || 0));
  return all.findIndex((p) => p === me) + 1;
}

/* ── обмін дублікатами: код живе 10 хвилин ── */
const trades = new Map();
const TRADE_ABC = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function tradeCreate(token, giveId) {
  const p = players[token];
  if (!p) return { error: "нема профілю." };
  if (!p.dupes || !(p.dupes[giveId] > 0)) return { error: "такого дубліката нема." };
  for (const [c, t] of trades) if (t.token === token) trades.delete(c);
  let code;
  do { code = Array.from({ length: 5 }, () => TRADE_ABC[(Math.random() * TRADE_ABC.length) | 0]).join(""); }
  while (trades.has(code));
  trades.set(code, { token, giveId, at: Date.now() });
  return { code, giveId };
}

function tradeAccept(token, code, giveId) {
  code = String(code || "").toUpperCase().trim();
  const t = trades.get(code);
  if (!t) return { error: "код не знайдено або він застарів." };
  if (Date.now() - t.at > 10 * 60_000) { trades.delete(code); return { error: "код застарів." }; }
  if (t.token === token) return { error: "сам із собою мінятись не вийде." };
  const a = players[t.token], b = players[token];
  if (!a || !b) return { error: "гравця не знайдено." };
  if (!(a.dupes[t.giveId] > 0)) { trades.delete(code); return { error: "у власника коду вже нема цього дубліката." };}
  if (!giveId || !(b.dupes[giveId] > 0)) return { error: "у тебе нема такого дубліката для обміну." };
  /* міняємось: кожен віддає один дублікат і отримує предмет (у колекцію або в дублікати) */
  a.dupes[t.giveId]--; if (!a.dupes[t.giveId]) delete a.dupes[t.giveId];
  b.dupes[giveId]--;   if (!b.dupes[giveId]) delete b.dupes[giveId];
  const grant = (pl, id) => {
    if (!pl.cards.includes(id)) pl.cards.push(id);
    else pl.dupes[id] = (pl.dupes[id] || 0) + 1;
  };
  grant(a, giveId);
  grant(b, t.giveId);
  trades.delete(code);
  save();
  return { ok: true, got: t.giveId, gave: giveId, cards: b.cards, dupes: b.dupes };
}

/* приховані звички: тихо рахуємо, зрідка згадуємо */
function bumpQuirk(token, key, by = 1) {
  const p = players[token];
  if (!p) return;
  if (!p.quirks) p.quirks = {};
  p.quirks[key] = (p.quirks[key] || 0) + by;
  save();
}

function position(token) {
  const me = players[token];
  if (!me || !me.games) return null;
  const all = Object.values(players).filter((p) => p.games >= 1).sort((a, b) => b.sp - a.sp);
  return all.findIndex((p) => p === me) + 1;
}

/* мапа завойовувань: перемога певною стороною наближає завоювання одного всесвіту */
const FRONTIER_N = 5;   // перемог однією стороною для завоювання кроку
const FRONTIER_MAX = 4; // -4..4

function bumpFrontier(token, side) {
  const p = players[token];
  if (!p) return null;
  if (!p.frontierWins) p.frontierWins = { kyts: 0, anti: 0 };
  p.frontierWins[side] = (p.frontierWins[side] || 0) + 1;
  let conquered = null;
  if (p.frontierWins[side] >= FRONTIER_N) {
    p.frontierWins[side] = 0;
    const dir = side === "kyts" ? 1 : -1;
    const next = Math.max(-FRONTIER_MAX, Math.min(FRONTIER_MAX, (p.frontier || 0) + dir));
    if (next !== p.frontier) { p.frontier = next; conquered = next; }
  }
  save();
  return { frontier: p.frontier, wins: p.frontierWins, conquered };
}

function award(token, achId) {
  const p = players[token];
  if (!p) return false;
  if (!Array.isArray(p.ach)) p.ach = [];
  if (p.ach.includes(achId)) return false;
  p.ach.push(achId);
  save();
  return true;
}

function top(n = 50) {
  return Object.values(players)
    .filter((p) => p.games >= 1)
    .sort((x, y) => y.sp - x.sp)
    .slice(0, n)
    .map((p) => ({ nick: p.nick, sp: p.sp, games: p.games, streak: p.streak, avatar: p.avatar || "cat_black", side: p.side || "kyts" }));
}

load();

module.exports = {
  getOrCreate, get, applyMatch, award, top, topPve, positionPve, setProfile, pushHist, position, dirty: save,
  wantedToday, tradeCreate, tradeAccept, bumpQuirk,
  todayKey, dailyPlayedToday, recordDaily, dailyBoard,
  bumpFrontier, FRONTIER_N, FRONTIER_MAX,
};
