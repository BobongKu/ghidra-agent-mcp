// Capture README screenshots of the dev GUI via CDP.
// Usage:  node scripts/capture-screenshots.mjs
// Pre-req: Vite dev server running on http://127.0.0.1:1420
//          Chrome installed at the default Windows path
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const APP_URL = "http://localhost:1420/";
const OUT_DIR = "docs/images";
const PORT = 9223;
const VIEW = { width: 1400, height: 900 };

mkdirSync(OUT_DIR, { recursive: true });

// 1. Launch headless chrome with remote debugging
const userDataDir = `${process.env.TEMP}\\ghidra-agent-shots-${Date.now()}`;
const chrome = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${userDataDir}`,
  "--headless=new",
  "--disable-gpu",
  "--hide-scrollbars",
  `--window-size=${VIEW.width},${VIEW.height}`,
  APP_URL,
], { stdio: ["ignore", "ignore", "inherit"] });

// 2. Wait for CDP endpoint
let target;
for (let i = 0; i < 40; i++) {
  await sleep(250);
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/json`);
    const tabs = await r.json();
    target = tabs.find((t) => t.type === "page");
    if (target) break;
  } catch {}
}
if (!target) { chrome.kill(); throw new Error("Chrome CDP did not come up"); }

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));

let nextId = 1;
const pending = new Map();
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id);
    pending.delete(m.id);
    if (m.error) reject(new Error(m.error.message));
    else resolve(m.result);
  }
});
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", {
  width: VIEW.width, height: VIEW.height, deviceScaleFactor: 1, mobile: false,
});

async function waitForBody() {
  for (let i = 0; i < 60; i++) {
    const r = await send("Runtime.evaluate", {
      expression: "document.querySelector('aside, [class*=\"sidebar\"], nav') ? 1 : 0",
    });
    if (r.result.value === 1) return;
    await sleep(150);
  }
}
await waitForBody();
await sleep(1500); // settle

async function shot(name) {
  await sleep(700);
  const r = await send("Page.captureScreenshot", { format: "png" });
  const buf = Buffer.from(r.data, "base64");
  writeFileSync(`${OUT_DIR}/${name}.png`, buf);
  console.log(`  saved ${OUT_DIR}/${name}.png  (${buf.length} bytes)`);
}

async function clickNav(label) {
  // Sidebar items render the label as text inside <button>; click the button by its text.
  const expr = `
    (() => {
      const btns = [...document.querySelectorAll('button, a')];
      const want = '${label}'.toLowerCase();
      const t = btns.find(b => {
        const span = b.querySelector('span');
        const txt = (span ? span.textContent : b.textContent || '').trim().toLowerCase();
        return txt === want;
      });
      if (t) { t.click(); return true; }
      return false;
    })()
  `;
  const r = await send("Runtime.evaluate", { expression: expr });
  if (!r.result.value) console.warn(`  warn: nav click '${label}' not found`);
  await sleep(900);
}

console.log("Capturing screenshots ->", OUT_DIR);
await shot("dashboard");
await clickNav("Programs");   await shot("programs");
await clickNav("Search");     await shot("search");
await clickNav("Console");    await shot("console");
await clickNav("Settings");   await shot("settings");

ws.close();
chrome.kill();
console.log("done.");
