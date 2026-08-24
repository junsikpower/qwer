const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const match = html.match(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/i);
if (!match) throw new Error("application script not found");

new vm.Script(match[1], { filename: "index.html:inline-script" });

const forbiddenPatterns = [
  { pattern: /document\.write\s*\(/, message: "document.write is not allowed" },
  { pattern: /\beval\s*\(/, message: "eval is not allowed" },
  { pattern: /setInterval\s*\(\s*[^,]+\s*,\s*0\s*\)/, message: "zero-delay interval is not allowed" }
];
for (const item of forbiddenPatterns) {
  if (item.pattern.test(match[1])) throw new Error(item.message);
}

console.log("Lint check passed: inline JavaScript parses and contains no prohibited constructs.");
