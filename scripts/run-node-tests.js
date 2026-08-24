const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const target = process.argv[2];
const destination = process.argv[3];
if (!target || !destination) throw new Error("usage: node scripts/run-node-tests.js <test-path> <junit-output>");

const root = path.resolve(__dirname, "..");
const absoluteTarget = path.join(root, target);
const absoluteDestination = path.join(root, destination);
fs.mkdirSync(path.dirname(absoluteDestination), { recursive: true });

function collectTestFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectTestFiles(entryPath);
    return /\.(?:test|spec)\.js$/i.test(entry.name) ? [entryPath] : [];
  });
}

let testFiles = [];
if (fs.existsSync(absoluteTarget)) {
  testFiles = fs.statSync(absoluteTarget).isDirectory()
    ? collectTestFiles(absoluteTarget)
    : [absoluteTarget];
}

if (!testFiles.length) {
  fs.writeFileSync(absoluteDestination, '<?xml version="1.0" encoding="utf-8"?>\n<testsuites>\n</testsuites>\n', "utf8");
  console.log(`No test files found in ${target}; wrote an empty JUnit suite for the reserved test area.`);
  process.exit(0);
}

const args = ["--test", "--test-reporter=junit", `--test-reporter-destination=${absoluteDestination}`];
args.push(...testFiles.map((filePath) => path.relative(root, filePath)));

const result = spawnSync(process.execPath, args, {
  cwd: root,
  stdio: "inherit",
  env: process.env
});
if (result.error) throw result.error;
process.exit(result.status == null ? 1 : result.status);
