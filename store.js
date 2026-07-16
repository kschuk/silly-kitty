/* ════════════════════════════════════════════════
   сховище гравців: token → {nick, rating, games, w, l, d}
   простий JSON-файл. на Railway примонтуй volume у /app/data,
   інакше рекорди зникнуть при редеплої (аркадний автомат
   після вимкнення з розетки).
   ════════════════════════════════════════════════ */

const fs = require("fs");
const path = require("path");

const DIR = path.join(__dirname, "data");
const FILE = path.join(DIR, "players.json");

let players = {};
let saveTimer = null;

function load() {
  try {
    if (fs.existsSync(FILE)) players = JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch (e) {
    console.error("сховище не прочиталось, починаємо з нуля:", e.message);
    players = {};
  }
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

function getOrCreate(token, nick) {
  if (!players[token]) {
    players[token] = { nick, rating: 1000, games: 0, w: 0, l: 0, d: 0, seen: Date.now() };
  } else {
    players[token].nick = nick || players[token].nick;
    players[token].seen = Date.now();
  }
  save();
  return players[token];
}

function get(token) {
  return players[token] || null;
}

function applyResult(tokenA, tokenB, scoreA, eloDelta) {
  const a = players[tokenA], b = players[tokenB];
  if (!a || !b) return { dA: 0, dB: 0 };
  const dA = eloDelta(a.rating, b.rating, scoreA);
  const dB = eloDelta(b.rating, a.rating, 1 - scoreA);
  a.rating += dA; b.rating += dB;
  a.games++; b.games++;
  if (scoreA === 1) { a.w++; b.l++; }
  else if (scoreA === 0) { a.l++; b.w++; }
  else { a.d++; b.d++; }
  save();
  return { dA, dB };
}

/* всесвітня таблиця. аркадний стиль: нік + очки, топ-50 */
function top(n = 50) {
  return Object.values(players)
    .filter((p) => p.games >= 1)
    .sort((x, y) => y.rating - x.rating)
    .slice(0, n)
    .map((p) => ({ nick: p.nick, rating: p.rating, games: p.games }));
}

load();

module.exports = { getOrCreate, get, applyResult, top };
