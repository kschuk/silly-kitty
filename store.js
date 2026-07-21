/* ════════════════════════════════════════════════
   сховище гравців: token → {nick, sp, games, w, l, d, streak}
   json-файл. на railway примонтуй volume у /app/data.
   ════════════════════════════════════════════════ */

const fs = require("fs");
const path = require("path");

const DIR = path.join(__dirname, "data");
const FILE = path.join(DIR, "players.json");
const DAILY_FILE = path.join(DIR, "daily.json");
const TRADES_FILE = path.join(DIR, "trades.json");

let players = {};
let daily = { date: null, entries: [] };
let saveTimer = null;
let saveTimerD = null;
let saveTimerT = null;
const TRADE_TTL = 10 * 60_000;

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
      if (typeof p.season !== "string") p.season = seasonKey();
      if (!Array.isArray(p.seasonBanners)) p.seasonBanners = [];
      if (!p.mission || typeof p.mission !== "object") p.mission = null;
      if (!p.missionCyc || typeof p.missionCyc !== "object") p.missionCyc = null;
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

function saveTrades() {
  clearTimeout(saveTimerT);
  saveTimerT = setTimeout(() => {
    try {
      if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });
      const tmp = TRADES_FILE + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify([...trades.entries()]));
      fs.renameSync(tmp, TRADES_FILE);
    } catch (e) { console.error("обміни не записались:", e.message); }
  }, 800);
}

/* підняти коди з диска й одразу викинути протухлі */
function loadTrades() {
  try {
    if (!fs.existsSync(TRADES_FILE)) return;
    const raw = JSON.parse(fs.readFileSync(TRADES_FILE, "utf8"));
    const now = Date.now();
    let dropped = 0;
    for (const [code, t] of raw) {
      if (t && t.token && now - (t.at || 0) < TRADE_TTL) trades.set(code, t);
      else dropped++;
    }
    if (dropped) saveTrades();
    console.log(`обміни: піднято ${trades.size}, прострочених викинуто ${dropped}`);
  } catch (e) { console.error("обміни не прочитались:", e.message); }
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

/* ── п.38: сезони артефакта. ключ сезону — рік-місяць UTC ── */
function seasonKey(d) { const x = d || new Date(); return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, "0")}`; }
const SEASON_SOFT = 0.75;   /* м'яке стискання: 75% рейтингу переходить у новий сезон */

/* якщо гравець заходить у новому сезоні — підбиваємо старий і видаємо банер */
function rolloverSeason(token) {
  const p = players[token];
  if (!p) return null;
  const now = seasonKey();
  if (!p.season) { p.season = now; save(); return null; }
  if (p.season === now) return null;
  const prev = p.season, prevSp = p.sp;
  p.sp = Math.round(p.sp * SEASON_SOFT * 10) / 10;
  p.season = now;
  if (!Array.isArray(p.seasonBanners)) p.seasonBanners = [];
  /* нагорода за участь у сезоні, що минув: банер, який не купиш */
  const reward = `season_${prev}`;
  let got = null;
  if ((p.games || 0) > 0 && !p.seasonBanners.includes(reward)) { p.seasonBanners.push(reward); got = reward; }
  save();
  return { prev, now, from: prevSp, to: p.sp, banner: got };
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

/* ── п.40+41: щоденні доручення амбасадорів. ── */
/* ── доручення. киці отримують від ґреґа, анти-киці — від жреґа.
   набори різні за характером: ґреґ просить майстерності, жреґ — жорстокості.
   ~30 доручень на фракцію: повний цикл триває приблизно місяць, доки
   не повторюється жодне (дивись rotation нижче — missionCycle). ── */
const MISSIONS_KYTS = [
  { id: "k_nip2",   who: "greg", text: "зіграй ніпом двічі за одну партію",              goal: 2, kind: "nips" },
  { id: "k_nip3",   who: "greg", text: "зіграй ніпом тричі за одну партію",              goal: 3, kind: "nips" },
  { id: "k_nip4",   who: "greg", text: "зіграй ніпом чотири рази за партію",             goal: 4, kind: "nips" },
  { id: "k_nip5",   who: "greg", text: "зіграй ніпом пʼять разів за одну партію",        goal: 5, kind: "nips" },
  { id: "k_nip2b",  who: "greg", text: "викинь двох ніпів за одну партію, не поспішаючи", goal: 2, kind: "nips" },
  { id: "k_nip3b",  who: "greg", text: "покажи трьох ніпів за партію — гарно й чесно",   goal: 3, kind: "nips" },
  { id: "k_nip4b",  who: "greg", text: "зіграй чотирма ніпами. я порахую особисто",      goal: 4, kind: "nips" },
  { id: "k_nip5b",  who: "greg", text: "пʼять ніпів за партію. амбітно, але я вірю",     goal: 5, kind: "nips" },
  { id: "k_five3",  who: "greg", text: "зіграй три пʼятірки за партію",                  goal: 3, kind: "fives" },
  { id: "k_five4",  who: "greg", text: "зіграй чотири пʼятірки за партію",               goal: 4, kind: "fives" },
  { id: "k_five5",  who: "greg", text: "зіграй пʼять пʼятірок за одну партію",           goal: 5, kind: "fives" },
  { id: "k_five6",  who: "greg", text: "зіграй шість пʼятірок за партію. руки вправні?", goal: 6, kind: "fives" },
  { id: "k_five3b", who: "greg", text: "три пʼятірки — і партія твоя історія",           goal: 3, kind: "fives" },
  { id: "k_five4b", who: "greg", text: "чотири пʼятірки, жодного зайвого слова",         goal: 4, kind: "fives" },
  { id: "k_dry1",   who: "greg", text: "виграй, не забравши зі столу жодної карти",      goal: 1, kind: "dryWin" },
  { id: "k_dry2",   who: "greg", text: "усуха перемога. навіть не торкнись відбою",      goal: 1, kind: "dryWin" },
  { id: "k_dry3",   who: "greg", text: "виграй з порожніми руками від чужих карт",       goal: 1, kind: "dryWin" },
  { id: "k_dry4",   who: "greg", text: "жодного забору, самі перемоги. спробуй",         goal: 1, kind: "dryWin" },
  { id: "k_fast1",  who: "greg", text: "виграй швидше ніж за 4 хвилини",                 goal: 1, kind: "fastWin" },
  { id: "k_fast2",  who: "greg", text: "спритна партія: менш ніж 4 хвилини на перемогу", goal: 1, kind: "fastWin" },
  { id: "k_fast3",  who: "greg", text: "чотири хвилини — і партія вже виграна",          goal: 1, kind: "fastWin" },
  { id: "k_fast4",  who: "greg", text: "не барись: перемога швидше за 4 хвилини",        goal: 1, kind: "fastWin" },
  { id: "k_amb1",   who: "greg", text: "здолай амбасадора протилежної фракції",          goal: 1, kind: "ambWin" },
  { id: "k_amb2",   who: "greg", text: "покажи жреґу, як грають киці",                   goal: 1, kind: "ambWin" },
  { id: "k_amb3",   who: "greg", text: "перемога над амбасадором з того боку. будь ласка", goal: 1, kind: "ambWin" },
  { id: "k_long1",  who: "greg", text: "дограй партію, довшу за 8 хвилин",               goal: 1, kind: "longGame" },
  { id: "k_long2",  who: "greg", text: "витримай довгу партію — понад 8 хвилин",         goal: 1, kind: "longGame" },
  { id: "k_long3",  who: "greg", text: "не поспішай: партія має тривати понад 8 хвилин", goal: 1, kind: "longGame" },
  { id: "k_wanted1",who: "greg", text: "заверши перемогу карткою з розшуку",             goal: 1, kind: "wantedWin" },
  { id: "k_wanted2",who: "greg", text: "спіймай розшукувану карту переможним ходом",     goal: 1, kind: "wantedWin" },
];
const MISSIONS_ANTI = [
  { id: "a_nip3",   who: "zhreg", text: "витрать три ніпи за одну партію",               goal: 3, kind: "nips" },
  { id: "a_nip4",   who: "zhreg", text: "витрать чотири ніпи за одну партію",            goal: 4, kind: "nips" },
  { id: "a_nip5",   who: "zhreg", text: "пʼять ніпів за партію. чи вистачить нахабства?", goal: 5, kind: "nips" },
  { id: "a_nip6",   who: "zhreg", text: "шість ніпів за партію. видовищно і жорстоко",   goal: 6, kind: "nips" },
  { id: "a_nip3b",  who: "zhreg", text: "три ніпи, без пояснень",                        goal: 3, kind: "nips" },
  { id: "a_nip4b",  who: "zhreg", text: "чотири ніпи. і жодного вибачення",              goal: 4, kind: "nips" },
  { id: "a_nip5b",  who: "zhreg", text: "пʼять ніпів. я записую кожен",                  goal: 5, kind: "nips" },
  { id: "a_five4",  who: "zhreg", text: "зіграй чотири пʼятірки за партію",              goal: 4, kind: "fives" },
  { id: "a_five5",  who: "zhreg", text: "зіграй пʼять пʼятірок за партію",               goal: 5, kind: "fives" },
  { id: "a_five6",  who: "zhreg", text: "шість пʼятірок за одну партію. без жалю",       goal: 6, kind: "fives" },
  { id: "a_five7",  who: "zhreg", text: "сім пʼятірок. це вже мистецтво жорстокості",    goal: 7, kind: "fives" },
  { id: "a_five4b", who: "zhreg", text: "чотири пʼятірки — і жодного вагання",           goal: 4, kind: "fives" },
  { id: "a_five5b", who: "zhreg", text: "пʼять пʼятірок, поки суперник не отямився",     goal: 5, kind: "fives" },
  { id: "a_dry1",   who: "zhreg", text: "виграй усухо — жодного забору зі столу",        goal: 1, kind: "dryWin" },
  { id: "a_dry2",   who: "zhreg", text: "перемога без жодної забраної карти. чисто",     goal: 1, kind: "dryWin" },
  { id: "a_dry3",   who: "zhreg", text: "не забери жодної карти й усе одно виграй",      goal: 1, kind: "dryWin" },
  { id: "a_dry4",   who: "zhreg", text: "усуха перемога. слабких це лякає",              goal: 1, kind: "dryWin" },
  { id: "a_fast1",  who: "zhreg", text: "закінчи все швидше ніж за 4 хвилини",           goal: 1, kind: "fastWin" },
  { id: "a_fast2",  who: "zhreg", text: "чотири хвилини на знищення суперника",          goal: 1, kind: "fastWin" },
  { id: "a_fast3",  who: "zhreg", text: "не дай супернику часу подумати: перемога <4хв", goal: 1, kind: "fastWin" },
  { id: "a_fast4",  who: "zhreg", text: "швидка розправа: менше 4 хвилин",               goal: 1, kind: "fastWin" },
  { id: "a_amb1",   who: "zhreg", text: "принизь амбасадора протилежної фракції",        goal: 1, kind: "ambWin" },
  { id: "a_amb2",   who: "zhreg", text: "покажи ґреґу, чого варта його доброта",         goal: 1, kind: "ambWin" },
  { id: "a_amb3",   who: "zhreg", text: "перемога над амбасадором киць. дрібниця",       goal: 1, kind: "ambWin" },
  { id: "a_long1",  who: "zhreg", text: "промуч суперника довше ніж 8 хвилин",           goal: 1, kind: "longGame" },
  { id: "a_long2",  who: "zhreg", text: "розтягни партію за 8 хвилин. насолодись",       goal: 1, kind: "longGame" },
  { id: "a_long3",  who: "zhreg", text: "довга партія, понад 8 хвилин страждань",        goal: 1, kind: "longGame" },
  { id: "a_wanted1",who: "zhreg", text: "впіймай розшукувану карту переможним ходом",    goal: 1, kind: "wantedWin" },
  { id: "a_wanted2",who: "zhreg", text: "заверши партію карткою з розшуку. трофей",      goal: 1, kind: "wantedWin" },
  { id: "a_wanted3",who: "zhreg", text: "розшукувана карта — і переможний хід нею",      goal: 1, kind: "wantedWin" },
];
const missionPool = (side) => (side === "anti" ? MISSIONS_ANTI : MISSIONS_KYTS);

/* детерміноване перемішування (Fisher–Yates із простим лінійним генератором,
   без залежності від Math.random — щоб порядок був відтворюваний за seed) */
function seededShuffle(arr, seed) {
  let s = seed >>> 0 || 1;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}


/* спільний лічильник виконаних доручень по фракціях (за добу і за весь час) */
let missionStats = { day: null, kyts: 0, anti: 0, allKyts: 0, allAnti: 0 };

/* сумарні перемоги фракцій по всіх гравцях */
function factionWins() {
  let kyts = 0, anti = 0;
  for (const p of Object.values(players)) {
    kyts += (p.frontierWins && p.frontierWins.kyts) || 0;
    anti += (p.frontierWins && p.frontierWins.anti) || 0;
  }
  return { kyts, anti };
}

function factionMissionStats() {
  if (missionStats.day !== todayKey()) missionStats = { day: todayKey(), kyts: 0, anti: 0, allKyts: missionStats.allKyts || 0, allAnti: missionStats.allAnti || 0 };
  return { ...missionStats };
}

/* цикл доручень: перемішаний порядок усього пулу на фракцію.
   pos рухається на 1 щодня — повний цикл (=довжина пулу, ~30) проходить
   без повторів, а по завершенні кола пул перемішується наново (інший порядок). */
function ensureMissionCycle(p, side, pool) {
  if (!p.missionCyc || p.missionCyc.side !== side || !Array.isArray(p.missionCyc.order) || p.missionCyc.order.length !== pool.length) {
    const seed = (Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0;
    p.missionCyc = { side, order: seededShuffle(pool.map((m) => m.id), seed), pos: 0, day: null };
  }
  return p.missionCyc;
}

function missionToday(token) {
  const p = players[token];
  if (!p) return null;
  const day = todayKey();
  const side = p.side === "anti" ? "anti" : "kyts";
  const pool = missionPool(side);
  const cyc = ensureMissionCycle(p, side, pool);
  /* нове доручення видається рівно раз на добу — один пункт циклу за день */
  if (cyc.day !== day) {
    if (cyc.day !== null) {
      cyc.pos++;
      if (cyc.pos >= cyc.order.length) {
        /* повне коло пройдено — наступне починається в іншому порядку */
        const seed = (Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0;
        cyc.order = seededShuffle(pool.map((m) => m.id), seed);
        cyc.pos = 0;
      }
    }
    cyc.day = day;
    p.mission = { day, side, id: cyc.order[cyc.pos], prog: 0, done: false };
    save();
  }
  const def = pool.find((m) => m.id === p.mission.id) || pool[0];
  return { ...p.mission, ...def };
}

/* повертає {justDone, reward} якщо доручення щойно виконано */
function missionProgress(token, kind, value) {
  const p = players[token];
  if (!p) return null;
  const cur = missionToday(token);
  if (!cur || cur.done || cur.kind !== kind) return null;
  p.mission.prog = Math.max(p.mission.prog || 0, value || 1);
  if (p.mission.prog >= cur.goal) {
    p.mission.done = true;
    /* внесок у спільну справу фракції */
    factionMissionStats();
    if ((p.side || "kyts") === "anti") { missionStats.anti++; missionStats.allAnti++; }
    else { missionStats.kyts++; missionStats.allKyts++; }
    if (!p.tk) p.tk = { k: 0, a: 0 };
    p.tk.k += 8; p.tk.a += 8;
    save();
    return { justDone: true, text: cur.text, who: cur.who, reward: "+8 ж.к і +8 ж.а" };
  }
  save();
  return null;
}

function dailyBoard() {
  if (daily.date !== todayKey()) return { date: todayKey(), entries: [] };
  return daily;
}

function getOrCreate(token, nick) {
  if (!players[token]) {
    players[token] = { nick, sp: 0, games: 0, w: 0, l: 0, d: 0, streak: 0, ach: [], hist: [], avatar: "cat_black", title: "", fastWins: 0, banUntil: 0, tk: { k: 100, a: 100 }, seenTitry: false, frontier: 0, frontierWins: { kyts: 0, anti: 0 }, dailyDate: null, dailyStreak: 0, season: seasonKey(), seasonBanners: [], mission: null, cards: [], dupes: {}, banner: "", quirks: {}, quirkSeen: 0, pveWins: 0, beatGreg: false, beatZhreg: false, side: "kyts", migr2: true, seen: Date.now() };
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
  saveTrades();
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
  saveTrades();
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

/* пошук за ніком для публічної візитівки (без урахування регістру) */
function byNick(nick) {
  const q = String(nick || "").trim().toLowerCase();
  if (!q) return null;
  return Object.values(players).find((p) => String(p.nick || "").toLowerCase() === q) || null;
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

loadTrades();

module.exports = {
  loadTrades,
  getOrCreate, get, byNick, applyMatch, award, top, topPve, positionPve, setProfile, pushHist, position, dirty: save,
  wantedToday, tradeCreate, tradeAccept, bumpQuirk,
  todayKey, dailyPlayedToday, recordDaily, dailyBoard,
  seasonKey, rolloverSeason, missionToday, missionProgress, factionMissionStats, factionWins,
  bumpFrontier, FRONTIER_N, FRONTIER_MAX,
};
