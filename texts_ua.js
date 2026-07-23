/* ════════════════════════════════════════════════
   ДУР-КИЦЬ · ІГРОВІ ФРАЗИ СЕРВЕРА · РЕДАГУЙ СМІЛИВО
   ────────────────────────────────────────────────
   тут — репліки, які сервер шле в чат подій під час гри.
   рядки в лапках "..." — просто заміни текст.
   рядки виду (nick) => `...${nick}...` — теж можна редагувати
   текст навколо ${nick}, саму вставку імені не чіпай.
   зберіг файл → перезапустив сервер → готово.
   ════════════════════════════════════════════════ */
module.exports = {
  nyavUa: { lapka: "лапка", kihot: "кіготь", khvist: "хвіст" },
  nyavVerb: { lapka: "притискає", kihot: "чіпляє", khvist: "вислизає з-під" },
  nyavGen: { lapka: "лапки", kihot: "кігтя", khvist: "хвоста" },

  exit: {
    shedMine: "ти скинув усі карти. вийшов!",
    shedOther: (nick) => `${nick} скинув усі карти.`,
    nipMine: "останній ніп у руці! ніп-вихід.",
    nipOther: (nick) => `${nick}: останній ніп. ніп-вихід.`,
    durkytsMine: "ти — дур-киць. буває.",
    durkytsOther: (nick) => `${nick} — дур-киць.`,
    dropMine: "тебе викинуло з гри.",
    dropOther: (nick) => `${nick} покинув гру.`,
  },

  bout: {
    nip: "після ніпа не підкидають. бито.",
    limit: "ліміт. бито.",
    dry: "підкинути нічого. бито.",
    plain: "бито.",
  },

  /* ── збій артефакта: репліки початку/кінця ── */
  glitch: {
    startPreySwap: "⚡ артефакт збоїть! наступний хід кожного: ніпи плутають здобич.",
    startThrowAny: "⚡ артефакт збоїть! наступний хід кожного: підкидати можна будь-що.",
    startValueFlip: "⚡ артефакт збоїть! наступний хід кожного: у своїй масті МЕНША б'є більшу.",
    end: "збій минув — усі відходили. артефакт знову цокає рівно.",
  },

  /* ── ставка няву: підсумок ── */
  bet: {
    resolved: (winner, amount) => `${winner} забирає ставку няву: +${amount}.`,
    skipped: "ставку няву не зроблено — граємо просто так.",
  },

  /* ── щоденні доручення амбасадорів (store.js) ──
     киці отримують доручення від ґреґа, анти-киці — від жреґа.
     ~30 доручень на фракцію: гравець тримає одне, доки сам не здасть
     його (кнопка «здати» на головному екрані), тоді видається наступне
     з циклу — повний цикл проходить без повторів, потім перемішується.
     кожен запис: id (унікальний, не міняй), who (greg|zhreg — хто видає),
     text (що показується гравцю), goal (скільки треба набрати),
     kind — тип умови, яку рахує сервер; можна редагувати лише для
     kind: "nips" і "fives" (там goal — реальна кількість за партію).
     для інших kind (dryWin/fastWin/ambWin/longGame/wantedWin) умова
     завжди бінарна (сталася/ні), тому goal має лишатись 1 — міняй
     тільки текст, не число. */
  MISSIONS: {
    kyts: [
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
    ],
    anti: [
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
    ],
  },

  /* ── досягнення (server.js) ✎ ──
   name/desc редагуються вільно. pve: true — здобувається лише проти
   амбасадорів (не міняй). secret: true — опис ховається до здобуття
   (не міняй). не міняй самі ключі (напр. "sec_lovets") — вони
   використовуються в коді для видачі конкретного досягнення. */
  ACHIEVEMENTS: {
    blyskavka:   { name: "блискавка",     desc: "перемога швидше 3 хвилин" },
    nipdyp:      { name: "ніп-дипломат",  desc: "вийти з партії ніп-виходом" },
    sukha:       { name: "суха лапка",    desc: "перемога, не взявши зі столу жодного разу" },
    pyatykut:    { name: "п'ятикутник",   desc: "перемога за столом на п'ятьох" },
    seriya:      { name: "хвиля няву",    desc: "три перемоги поспіль" },
    maraton:     { name: "марафонець",    desc: "дожити до кінця партії, довшої за 15 хвилин" },
    kolektsioner:{ name: "колекціонер",   desc: "забрати 20+ карт за партію і не стати дур-кицем" },
    nyavmaster:  { name: "нявмайстер",    desc: "виграти няв-няв-няв двічі за одну партію" },
    feniks:      { name: "фенікс",        desc: "перемога після трьох і більше заборів" },
    nyavkosmos:  { name: "нявкосмос",     desc: "виграти няв-няв-няв тричі за одну партію" },
    movchvoda:   { name: "мовчазна вода", desc: "перемога, не підкинувши жодної карти" },
    zhabhor:     { name: "хор анти-киць",  desc: "зіграти три ніпи за одну партію" },
    pyatipyat:   { name: "п'ять п'ятірок",desc: "зіграти п'ять п'ятірок за одну партію" },
    glitchsurf:  { name: "глітч-серфер",  desc: "перемога в партії, де ти ходив під збоєм артефакта" },
    zhetonoyid:  { name: "жетоноїд",      desc: "назбирати 150+ жетонів однієї валюти" },
    tyzhnevyk:   { name: "тижневик",      desc: "грати стіл дня сім днів поспіль" },
    /* ── ПвЄ-набір: здобувається лише проти амбасадорів ── */
    pve_znaiomstvo:{ name: "знайомство",   desc: "ПвЄ: зіграти партію проти амбасадора", pve: true },
    pve_greg:    { name: "друг ґрега",     desc: "ПвЄ: перемогти ґрега", pve: true },
    pve_zhreg:   { name: "гроза жрега",    desc: "ПвЄ: перемогти ґабку жрега", pve: true },
    pve_obydva:  { name: "дипломат",       desc: "ПвЄ: перемогти обох амбасадорів", pve: true },
    pve_sukho:   { name: "суха дипломатія",desc: "ПвЄ: перемога над амбасадором без жодного забору", pve: true },
    pve_shvydko: { name: "бліц-візит",     desc: "ПвЄ: перемога над амбасадором швидше 2 хвилин", pve: true },
    pve_desyat:  { name: "постійний гість",desc: "ПвЄ: десять перемог над амбасадорами", pve: true },
    amb_stil:    { name: "між двох вогнів", desc: "ПвЄ: зіграти за столом з обома амбасадорами", pve: true },
    amb_obydva:  { name: "розборка амбасадорів", desc: "ПвЄ: виграти стіл, де були обидва амбасадори", pve: true },
    amb_ostanni: { name: "миротворець",    desc: "ПвЄ: за столом на трьох вийти першим, лишивши амбасадорів самих", pve: true },
    /* ── секретні: опис зʼявляється лише після здобуття ── */
    sec_poklykach:{ name: "покликач",       desc: "покликати амбасадора на імʼя в чаті", secret: true },
    sec_balakun: { name: "балакун у пустці",desc: "написати п'ять повідомлень, чекаючи суперника", secret: true },
    sec_nichnyi: { name: "нічний киць",    desc: "зіграти партію між 3 і 5 ранку", secret: true },
    sec_hodynnyk:{ name: "не чіпай стрілки",desc: "клікнути по артефакту 15 разів за партію", secret: true },
    sec_lovets: { name: "ловець", desc: "секрет: завершити партію карткою, що була в розшуку", secret: true },
    sec_obminyaka: { name: "обміняка", desc: "секрет: обмінятись дублікатом з іншим гравцем", secret: true },
    sec_povna_kolekciya: { name: "повний набір", desc: "секрет: зібрати всі шість банерів-ніпів", secret: true },
    amb_albom:   { name: "повний альбом", desc: "зібрати всі шість банерів-ніпів" },
    sec_kupets:  { name: "купець",        desc: "секрет: обмінятися дублікатом з іншим гравцем", secret: true },
    sec_kolekcioner_pc: { name: "філателіст", desc: "секрет: зібрати три листівки в колекцію", secret: true },
    sec_odna:    { name: "одна-єдина",     desc: "перемогти, маючи в руці лише одну карту весь останній бій", secret: true },
  },
};
