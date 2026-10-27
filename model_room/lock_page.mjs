#!/usr/bin/env node
// lock_page.mjs - wraps the Model Room page in a password screen.
//
// Usage:  MODEL_ROOM_PASSWORD=... node model_room/lock_page.mjs <in.html> <out_dir>
//
// The page is encrypted here (PBKDF2-SHA256 -> AES-256-GCM) and only the
// encrypted copy is published, so the site and the public repo never hold the
// readable page. The browser decrypts it with the password (Web Crypto) and
// shows it in the same tab. With no password set, a "not set up yet" page is
// written instead, so the gear menu link never 404s.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { pbkdf2Sync, createCipheriv, randomBytes } from "node:crypto";

// The salt stays the same from build to build so "Remember on this device"
// keeps working after each refresh; a new IV is drawn every build.
const SALT = "ant56-arch.github.io/model-room/v1";
const ITERATIONS = 600000;

const [inPath, outDir] = process.argv.slice(2);
if (!inPath || !outDir) {
  console.error("usage: node lock_page.mjs <in.html> <out_dir>");
  process.exit(2);
}
const password = process.env.MODEL_ROOM_PASSWORD || "";
mkdirSync(outDir, { recursive: true });

let payload = "null";
if (password) {
  const page = readFileSync(inPath, "utf8");
  const key = pbkdf2Sync(password, SALT, ITERATIONS, 32, "sha256");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(page, "utf8"), cipher.final(), cipher.getAuthTag()]);
  payload = JSON.stringify({ salt: SALT, iter: ITERATIONS, iv: iv.toString("base64"), data: body.toString("base64") });
}

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Model Room</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,300..800&family=DM+Mono:wght@400;500&family=Instrument+Serif:ital@0;1&display=swap">
<style>
:root{--bg:#f2eee6;--surface:#f8f5ef;--rule:#d3ccbe;--text:#1b1b19;--muted:#5e5a51;--ours:#a4532b;--miss:#9a3b2c;--forest:#1e3a2c;--forest-ink:#f2eee6;
  --font:'Archivo','Helvetica Neue',Arial,sans-serif;--serif:'Instrument Serif',Georgia,serif;--mono:'DM Mono',ui-monospace,Menlo,monospace}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){color-scheme:dark;--bg:#141815;--surface:#1a1f1b;--rule:#2e342f;--text:#ece7dc;--muted:#ada79a;--ours:#d98b5f;--miss:#e58c78;--forest:#22402f;--forest-ink:#ece7dc}}
:root[data-theme="dark"]{color-scheme:dark;--bg:#141815;--surface:#1a1f1b;--rule:#2e342f;--text:#ece7dc;--muted:#ada79a;--ours:#d98b5f;--miss:#e58c78;--forest:#22402f;--forest-ink:#ece7dc}
*{box-sizing:border-box}
body{background:var(--bg);color:var(--text);font-family:var(--font);margin:0;min-height:100vh}
.top{background:var(--forest);color:var(--forest-ink);padding:10px 16px;display:flex;align-items:center;justify-content:space-between;gap:12px}
.top .brand{font-family:var(--mono);font-size:11px;letter-spacing:.14em;text-transform:uppercase;opacity:.85;white-space:nowrap}
.top .brand b{font-family:var(--font);font-stretch:125%;font-weight:800;letter-spacing:.06em}
.top a.home{display:inline-flex;align-items:center;gap:6px;color:var(--forest);background:var(--forest-ink);text-decoration:none;font-family:var(--font);font-weight:700;font-size:14px;border-radius:999px;padding:7px 14px 7px 10px;min-height:36px;box-sizing:border-box}
.top a.home svg{width:16px;height:16px}
main{max-width:380px;margin:12vh auto 0;padding:0 16px}
h1{font-family:var(--serif);font-weight:400;font-size:2.6rem;line-height:1;margin:0 0 8px}
h1 i{color:var(--ours)}
p{color:var(--muted);margin:0 0 20px;line-height:1.5}
form{display:grid;gap:12px}
input[type=password]{font:inherit;font-size:16px;padding:10px 12px;border:1px solid var(--rule);border-radius:6px;background:var(--surface);color:var(--text);width:100%}
input[type=password]:focus{outline:2px solid var(--ours);outline-offset:1px}
label.rem{display:flex;gap:8px;align-items:center;color:var(--muted);font-size:14px}
button{font:inherit;font-weight:700;font-stretch:112%;padding:10px 14px;border:0;border-radius:999px;background:var(--text);color:var(--bg);cursor:pointer}
button[disabled]{opacity:.6;cursor:default}
.err{color:var(--miss);font-size:14px;min-height:1.2em;margin:0}
html.opening main{visibility:hidden}
</style>
<script>try{var t=(JSON.parse(localStorage.getItem("edge-settings")||"null")||{}).theme;if(t==="light"||t==="dark")document.documentElement.dataset.theme=t;}catch(e){}</script>
</head>
<body>
<div class="top"><a class="home" href="/"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>Home</a><span class="brand"><b>EDGE</b> &nbsp;·&nbsp; Model Room</span></div>
<main>
<h1>Model <i>room</i></h1>
<p id="lede">Owner only. Enter the password to see inside every model.</p>
<form id="f" autocomplete="on">
<input type="text" name="username" value="owner" autocomplete="username" hidden>
<input type="password" id="pw" name="password" autocomplete="current-password" placeholder="Password" aria-label="Password" required autofocus>
<label class="rem"><input type="checkbox" id="rem" checked> Remember on this device</label>
<button id="go" type="submit">Open</button>
<p class="err" id="err" role="alert"></p>
</form>
</main>
<script>
const LOCKED = ${payload.replace(/</g, "\\u003c")};
const KEY_STORE = "model-room-key";
const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const store = (v) => { try { v === undefined ? localStorage.removeItem(KEY_STORE) : localStorage.setItem(KEY_STORE, v); } catch (e) {} };
const stored = () => { try { return localStorage.getItem(KEY_STORE); } catch (e) { return null; } };

async function keyFromPassword(pw) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(LOCKED.salt), iterations: LOCKED.iter }, base, 256);
  return new Uint8Array(bits);
}

async function open(raw) {
  const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["decrypt"]);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64(LOCKED.iv) }, key, b64(LOCKED.data));
  return new TextDecoder().decode(plain);
}

// On a refresh with a saved key the page can decrypt before this document
// has finished loading; writing it then would add the Model Room under the
// password screen instead of replacing it. So wait until loading is done.
function show(page) {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => show(page), { once: true });
    return;
  }
  const lock = '<button onclick="localStorage.removeItem(\\'' + KEY_STORE + '\\');location.reload()" style="position:fixed;right:12px;bottom:12px;z-index:9;font:600 13px/1 Archivo,Arial,sans-serif;padding:8px 12px;border-radius:999px;border:1px solid var(--rule);background:var(--surface);color:var(--text);cursor:pointer">Lock</button>';
  const theme = document.documentElement.dataset.theme;
  document.open();
  document.write('<!doctype html><html lang="en"' + (theme ? ' data-theme="' + theme + '"' : '') + '><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"></head><body>' + page + lock + '</body></html>');
  document.close();
}

const toB64 = a => btoa(String.fromCharCode(...a));
const form = document.getElementById("f"), err = document.getElementById("err"), go = document.getElementById("go");

if (!LOCKED) {
  document.getElementById("lede").textContent = "The Model Room isn't set up yet. It appears here once its password is saved in the repository settings.";
  form.hidden = true;
} else {
  const saved = stored();
  if (saved) {
    // Opening with the remembered key: keep the password box out of sight
    // so it doesn't flash before the page appears.
    document.documentElement.classList.add("opening");
    open(b64(saved)).then(show).catch(() => { store(); document.documentElement.classList.remove("opening"); });
  }
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    err.textContent = "";
    go.disabled = true;
    go.textContent = "Opening…";
    try {
      const raw = await keyFromPassword(document.getElementById("pw").value);
      const page = await open(raw);
      if (document.getElementById("rem").checked) store(toB64(raw)); else store();
      show(page);
    } catch (x) {
      err.textContent = "That password didn't work.";
      go.disabled = false;
      go.textContent = "Open";
    }
  });
}
</script>
</body>
</html>
`;
writeFileSync(join(outDir, "index.html"), html);
console.log(password ? `locked ${inPath} -> ${outDir}/index.html` : `no MODEL_ROOM_PASSWORD: wrote the not-set-up page to ${outDir}/index.html`);
