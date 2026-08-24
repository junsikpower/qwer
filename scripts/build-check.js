const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const htmlPath = path.join(root, "index.html");
const html = fs.readFileSync(htmlPath, "utf8");
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map((match) => match[1]);

if (!html.includes("<!doctype html>")) throw new Error("index.html must use the HTML doctype");
if (scripts.length !== 1) throw new Error("index.html must contain exactly one inline application script");
if (/<script\s[^>]*\bsrc\s*=|<(?:img|audio|video|iframe|link)\s[^>]*\b(?:src|href)\s*=\s*[\"'](?:https?:|\/\/)/i.test(html)) {
  throw new Error("index.html must not depend on external resources");
}

new vm.Script(scripts[0], { filename: "index.html:inline-script" });

const requiredMarkers = [
  "localStorage",
  "Date.now()",
  "performance.now()",
  "visibilitychange",
  "AudioContext",
  "Notification",
  "Memo-Input-Pending"
];
for (const marker of requiredMarkers) {
  if (!html.includes(marker)) throw new Error(`required implementation marker missing: ${marker}`);
}

console.log("Build check passed: index.html is self-contained and syntactically valid.");
