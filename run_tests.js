const { spawn } = require("child_process");
const PORT = process.argv[2] || "3199";
const testFiles = process.argv.slice(3);

const env = { ...process.env, PORT, BOT_FAST: "1" };
const srv = spawn("node", ["server.js"], { env });
srv.stdout.on("data", (d) => process.stdout.write("[srv] " + d));
srv.stderr.on("data", (d) => process.stderr.write("[srv-err] " + d));

function runTest(file) {
  return new Promise((resolve) => {
    const t = spawn("node", [file], { env });
    t.stdout.on("data", (d) => process.stdout.write(d));
    t.stderr.on("data", (d) => process.stderr.write(d));
    t.on("exit", (code) => resolve(code));
  });
}

(async () => {
  await new Promise((r) => setTimeout(r, 1200));
  let allOk = true;
  for (const f of testFiles) {
    const code = await runTest(f);
    if (code !== 0) { allOk = false; console.error(`✗ ${f} завершився з кодом ${code}`); break; }
  }
  srv.kill();
  process.exit(allOk ? 0 : 1);
})();
