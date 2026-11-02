/* ══════════════════════════════════════════════
   ТЕСТ КЛІЄНТА · вантажить index.html у справжній DOM
   і перевіряє, що скрипт не падає, а кнопки живі.
   саме такий баг («нічого не натискається») ловиться тут.
   ══════════════════════════════════════════════ */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const DIR = __dirname;
let html = fs.readFileSync(path.join(DIR, "public/index.html"), "utf8");
const texts = fs.readFileSync(path.join(DIR, "public/texts.js"), "utf8");
html = html.replace('<script src="/texts.js"></script>', `<script>${texts}</script>`);
html = html.replace('<script src="/socket.io/socket.io.js"></script>',
  `<script>window.io=function(){return{on:()=>{},emit:(e,a,cb)=>{const f=typeof a==="function"?a:cb;if(typeof f==="function")f({});},close(){},connected:true};};</script>`);

const errs = [];
const dom = new JSDOM(html, {
  runScripts: "dangerously", pretendToBeVisual: true, url: "http://localhost/",
  beforeParse(w) {
    const gain = () => ({ gain: { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, cancelScheduledValues() {}, setTargetAtTime() {} }, connect() {} });
    w.AudioContext = function () {
      return { state: "running", currentTime: 0, destination: {}, createGain: gain,
        createOscillator: () => ({ type: "", frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, start() {}, stop() {} }),
        createBuffer: () => ({ getChannelData: () => new Float32Array(8) }),
        createBufferSource: () => ({ buffer: null, connect() {}, start() {} }),
        createBiquadFilter: () => ({ type: "", frequency: { value: 0 }, connect() {} }),
        resume: () => Promise.resolve(), suspend() {} };
    };
    w.onerror = (msg, src, line, col) => errs.push(`${msg} @${line}:${col}`);
    w.addEventListener("error", (e) => errs.push("ERR: " + e.message));
  },
});

/* кнопки, без яких у гру не зайти */
const MUST = ["btnHello", "btnQuick", "btnCreate", "btnJoin", "btnAmbBoth", "btnCoop",
  "btnStart", "btnCancelWait", "btnMenu", "mPanic", "mClose", "mRules", "mLore",
  "achBack", "profBack", "wantedBack", "invBack", "facBack", "topBack", "shopBack",
  "plPlay", "plToggle", "plPrev", "plNext", "plMute"];

setTimeout(() => {
  const d = dom.window.document;
  const fatal = errs.filter((e) => !/HTMLMediaElement|Not implemented/.test(e));
  if (fatal.length) {
    console.error("КЛІЄНТ ВПАВ ПІД ЧАС ЗАВАНТАЖЕННЯ:");
    fatal.slice(0, 5).forEach((e) => console.error("  " + e));
    process.exit(1);
  }
  const missing = MUST.filter((id) => !d.getElementById(id));
  if (missing.length) { console.error("нема елементів: " + missing.join(", ")); process.exit(1); }
  const dead = MUST.filter((id) => !d.getElementById(id).onclick);
  if (dead.length) { console.error("кнопки без обробників: " + dead.join(", ")); process.exit(1); }

  /* нікуди не веде: звернення до неіснуючих id у коді */
  const ids = new Set([...html.matchAll(/id="([\w-]+)"/g)].map((m) => m[1]));
  const bad = [...new Set([...html.matchAll(/\$\("([\w-]+)"\)\.(onclick|oninput|onchange|textContent|innerHTML|value|checked)/g)]
    .map((m) => m[1]).filter((x) => !ids.has(x)))];
  if (bad.length) { console.error("код чіпає неіснуючі елементи: " + bad.join(", ")); process.exit(1); }

  /* жоден оверлей не має бути відкритий на старті */
  const stuck = [...d.querySelectorAll(".overlay.on")].map((x) => x.id);
  if (stuck.length) { console.error("оверлей залип відкритим: " + stuck.join(", ")); process.exit(1); }

  console.log(`клієнт вантажиться без помилок · ${MUST.length} ключових кнопок живі · тест КЛІЄНТ OK\n`);
  process.exit(0);
}, 900);
