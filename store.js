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
      if (!p.dailyStreak) p.dailyStreak = 0;  // сторона мапи             // «стіл дня»: дата останньої спроби
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
    players[token] = { nick, sp: 0, games: 0, w: 0, l: 0, d: 0, streak: 0, ach: [], hist: [], avatar: "cat_black", title: "", fastWins: 0, banUntil: 0, tk: { k: 100, a: 100 }, seenTitry: false, frontier: 0, frontierWins: { kyts: 0, anti: 0 }, dailyDate: null, dailyStreak: 0, side: "kyts", migr2: true, seen: Date.now() };
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
  getOrCreate, get, applyMatch, award, top, setProfile, pushHist, position, dirty: save,
  todayKey, dailyPlayedToday, recordDaily, dailyBoard,
  bumpFrontier, FRONTIER_N, FRONTIER_MAX,
};
