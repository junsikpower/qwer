const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const ROOT = path.resolve(__dirname, "../..");
const HTML = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const SCRIPT = HTML.match(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/i)[1];
const START_TIME = 1_700_000_000_000;
const MINUTE = 60 * 1000;

class ClassList {
  constructor() { this.values = new Set(); }
  toggle(name, force) {
    const enabled = force === undefined ? !this.values.has(name) : Boolean(force);
    if (enabled) this.values.add(name); else this.values.delete(name);
    return enabled;
  }
  contains(name) { return this.values.has(name); }
}

class Element {
  constructor(tagName = "div") {
    this.tagName = tagName.toUpperCase();
    this.hidden = false;
    this.value = "";
    this._textContent = "";
    this.innerHTML = "";
    this.className = "";
    this.classList = new ClassList();
    this.attributes = new Map();
    this.children = [];
    this.listeners = new Map();
    this.focused = false;
  }
  get textContent() { return this._textContent; }
  set textContent(value) {
    this._textContent = String(value ?? "");
    if (!this._textContent) this.children = [];
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  addEventListener(name, handler) {
    if (!this.listeners.has(name)) this.listeners.set(name, []);
    this.listeners.get(name).push(handler);
  }
  dispatchEvent(event) {
    for (const handler of this.listeners.get(event.type) || []) handler(event);
  }
  appendChild(child) { this.children.push(child); return child; }
  querySelector(selector) {
    if (selector === "span") return this.span || (this.span = new Element("span"));
    if (selector === "svg") return this.svg || (this.svg = new Element("svg"));
    return null;
  }
  focus() { this.focused = true; }
}

class StorageDouble {
  constructor(seed = {}) {
    this.values = new Map(Object.entries(seed));
    this.failWrites = false;
  }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) {
    if (this.failWrites) throw new Error("simulated localStorage write failure");
    this.values.set(key, String(value));
  }
  snapshot() { return Object.fromEntries(this.values.entries()); }
}

function createDocument() {
  const ids = [
    "storage-warning", "timer-view", "log-view", "settings-view", "timer-card", "phase-kicker",
    "phase-title", "phase-subtitle", "time-display", "status-line", "status-label", "timer-controls",
    "start-button", "reset-button", "skip-button", "cycle-count", "focus-duration-label",
    "short-duration-label", "long-duration-label", "memo-panel", "memo-form", "memo-input",
    "memo-skip-button", "log-date", "log-count", "log-list", "settings-form", "focus-minutes",
    "short-break-minutes", "long-break-minutes", "focus-error", "short-break-error", "long-error",
    "settings-feedback", "clock-modal", "clock-resume-button"
  ];
  const elements = new Map();
  ids.forEach((id) => {
    const tag = id.endsWith("-button") ? "button" : id.endsWith("-form") ? "form" : "div";
    elements.set(id, new Element(tag));
  });
  elements.set("long-break-error", elements.get("long-error"));
  const progressDots = Array.from({ length: 4 }, () => new Element("span"));
  const sessionInfo = ["Focus", "ShortBreak", "LongBreak"].map((type) => {
    const item = new Element("div");
    item.setAttribute("data-session-info", type);
    return item;
  });
  const nav = ["timer", "log", "settings"].map((view) => {
    const item = new Element("button");
    item.setAttribute("data-view", view);
    return item;
  });
  const brand = new Element("a");
  brand.setAttribute("data-view", "timer");
  nav.push(brand);
  const document = {
    readyState: "complete",
    hidden: false,
    title: "Pomodoro Timer",
    listeners: new Map(),
    getElementById(id) { return elements.get(id) || null; },
    querySelectorAll(selector) {
      if (selector === ".progress-dot") return progressDots;
      if (selector === "[data-session-info]") return sessionInfo;
      if (selector === "[data-view]") return nav;
      return [];
    },
    createElement(tagName) { return new Element(tagName); },
    addEventListener(name, handler) {
      if (!this.listeners.has(name)) this.listeners.set(name, []);
      this.listeners.get(name).push(handler);
    },
    dispatchEvent(event) {
      for (const handler of this.listeners.get(event.type) || []) handler(event);
    }
  };
  return { document, elements, progressDots, sessionInfo, nav };
}

function makeClockDate(getNow) {
  const RealDate = Date;
  return class ReviewClockDate extends RealDate {
    constructor(...args) { super(...(args.length ? args : [getNow()])); }
    static now() { return getNow(); }
  };
}

function boot({ seed = {}, now = START_TIME, notification, audioContext } = {}) {
  let wallClock = now;
  let monotonicClock = 0;
  const dom = createDocument();
  const storage = new StorageDouble(seed);
  const intervals = [];
  const window = {
    document: dom.document,
    localStorage: storage,
    performance: { now: () => monotonicClock },
    Date: makeClockDate(() => wallClock),
    setTimeout(callback) { callback(); return 0; },
    clearTimeout() {},
    setInterval(callback) { intervals.push(callback); return intervals.length; },
    clearInterval() {},
    addEventListener() {},
    AudioContext: audioContext,
    webkitAudioContext: undefined,
    Notification: notification,
    window: null
  };
  window.window = window;
  const context = vm.createContext(window);
  vm.runInContext(SCRIPT, context, { filename: "index.html:inline-script" });

  return {
    window: context,
    document: dom.document,
    elements: dom.elements,
    storage,
    advance(milliseconds) { wallClock += milliseconds; monotonicClock += milliseconds; },
    advanceWallOnly(milliseconds) { wallClock += milliseconds; },
    tick() { intervals.forEach((callback) => callback()); },
    setHidden(value) { dom.document.hidden = value; },
    returnToTab() { dom.document.hidden = false; dom.document.dispatchEvent({ type: "visibilitychange" }); },
    snapshot() { return storage.snapshot(); }
  };
}

function click(app, id) {
  app.elements.get(id).dispatchEvent({ type: "click", preventDefault() {} });
}

function submit(app, id) {
  app.elements.get(id).dispatchEvent({ type: "submit", preventDefault() {} });
}

function navigate(app, view) {
  const button = app.document.querySelectorAll("[data-view]").find((item) => item.getAttribute("data-view") === view);
  button.dispatchEvent({ type: "click", preventDefault() {} });
}

function jsonEntries(app) {
  return Object.entries(app.snapshot()).map(([key, value]) => {
    try { return { key, value: JSON.parse(value) }; } catch { return { key, value: null }; }
  });
}

function storedTimer(app) {
  const found = jsonEntries(app).find(({ value }) => value && ["Idle", "Running", "Paused"].includes(value.status) && value.sessionType);
  assert.ok(found, "TimerState must be persisted as a separate JSON record");
  return found;
}

function storedLogs(app) {
  const found = jsonEntries(app).find(({ value }) => value && typeof value === "object" && !Array.isArray(value)
    && !Object.prototype.hasOwnProperty.call(value, "status")
    && !Object.prototype.hasOwnProperty.call(value, "sessionType")
    && !Object.prototype.hasOwnProperty.call(value, "focusMinutes"));
  assert.ok(found, "DailyLog must be persisted separately");
  return found;
}

function replaceStored(app, predicate, nextValue) {
  const found = jsonEntries(app).find(predicate);
  assert.ok(found, "expected persisted record was not found");
  const seed = app.snapshot();
  seed[found.key] = JSON.stringify(nextValue);
  return seed;
}

function textTree(element) {
  return element._textContent + element.children.map(textTree).join("");
}

function listTexts(app) {
  return app.elements.get("log-list").children.map((item) => item.children[1]?._textContent || "");
}

function timerStatus(app) { return storedTimer(app).value; }

test("REV-STRUCT-01 [3.2, 12.1, NFR-02, NFR-03] single-file offline constraints are observable", () => {
  assert.equal((HTML.match(/<html\b/gi) || []).length, 1);
  assert.equal((HTML.match(/<script(?:\s[^>]*)?>/gi) || []).length, 1);
  assert.equal(/<script\s[^>]*src\s*=|\b(?:src|href)\s*=\s*[\"'](?:https?:|\/\/)/i.test(HTML), false);
  assert.equal(/\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(/.test(SCRIPT), false);
  assert.equal(/react|vue|angular/i.test(SCRIPT), false);
  assert.ok((HTML.match(/<svg\b/gi) || []).length >= 4, "icons must be inline SVG");
});

test("REV-FR01-01 [FR-01] user controls follow Idle → Running → Paused → Idle and absolute time advances", () => {
  const app = boot();
  assert.equal(app.elements.get("time-display").textContent, "25:00");
  assert.equal(timerStatus(app).status, "Idle");
  click(app, "start-button");
  const started = timerStatus(app);
  assert.equal(started.status, "Running");
  assert.equal(started.endTimestamp - START_TIME, 25 * MINUTE);
  app.advance(7000);
  app.tick();
  assert.equal(app.elements.get("time-display").textContent, "24:53");
  click(app, "start-button");
  const paused = timerStatus(app);
  assert.equal(paused.status, "Paused");
  const frozen = app.elements.get("time-display").textContent;
  app.advance(12000);
  app.tick();
  assert.equal(app.elements.get("time-display").textContent, frozen);
  click(app, "reset-button");
  assert.equal(timerStatus(app).status, "Idle");
  assert.equal(app.elements.get("time-display").textContent, "25:00");
});

test("REV-FR01-02 [FR-01, BR-03] reset does not consume an already completed Focus slot", () => {
  const initial = boot();
  const seeded = replaceStored(initial, ({ value }) => value && value.sessionType === "Focus", {
    ...storedTimer(initial).value,
    status: "Idle",
    endTimestamp: null,
    focusSlotsCompleted: 3,
    remainingMs: 25 * MINUTE
  });
  const app = boot({ seed: seeded });
  click(app, "reset-button");
  const state = timerStatus(app);
  assert.equal(state.status, "Idle");
  assert.equal(state.focusSlotsCompleted, 3);
  assert.equal(state.remainingMs, 25 * MINUTE);
});

class CountingAudioContext {
  static starts = 0;
  constructor() { this.currentTime = 0; this.destination = {}; this.state = "running"; }
  createOscillator() {
    return {
      frequency: { setValueAtTime() {} },
      connect() {},
      start() { CountingAudioContext.starts += 1; },
      stop() {}
    };
  }
  createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }
}

class CountingNotification {
  static permission = "granted";
  static count = 0;
  constructor() { CountingNotification.count += 1; }
}

test("REV-FR02-01 [FR-02, EC-01] granted notification permission triggers sound and browser notification together", () => {
  CountingAudioContext.starts = 0;
  CountingNotification.count = 0;
  const app = boot({ audioContext: CountingAudioContext, notification: CountingNotification });
  click(app, "start-button");
  app.advance(25 * MINUTE + 1);
  app.tick();
  assert.equal(CountingAudioContext.starts, 1);
  assert.equal(CountingNotification.count, 1);
});

test("REV-FR02-02 [FR-02, EC-01] unsupported notification and failed audio use the title fallback", () => {
  class BrokenAudioContext extends CountingAudioContext {
    createOscillator() { throw new Error("audio playback rejected"); }
  }
  const app = boot({ audioContext: BrokenAudioContext });
  click(app, "start-button");
  app.advance(25 * MINUTE + 1);
  app.tick();
  assert.match(app.document.title, /세션 종료/);
});

test("REV-FR03-01 [FR-03, FR-05, BR-04] Focus completion records before memo resolution and starts Short Break after submission", () => {
  const app = boot();
  click(app, "start-button");
  app.advance(25 * MINUTE + 1);
  app.tick();
  const pending = timerStatus(app);
  assert.equal(pending.status, "Idle");
  assert.ok(pending.memoPending);
  assert.equal(app.elements.get("timer-controls").hidden, true);
  assert.equal(app.elements.get("memo-panel").hidden, false);
  const logsBeforeMemo = storedLogs(app).value;
  const dateBeforeMemo = Object.values(logsBeforeMemo)[0];
  assert.equal(dateBeforeMemo.completedCount, 1);
  app.elements.get("memo-input").value = "리뷰할 문서 정리";
  submit(app, "memo-form");
  const afterMemo = timerStatus(app);
  assert.equal(afterMemo.sessionType, "ShortBreak");
  assert.equal(afterMemo.status, "Running");
  assert.equal(afterMemo.memoPending, null);
  assert.deepEqual(Object.values(storedLogs(app).value)[0].entries.map((entry) => entry.text), ["리뷰할 문서 정리"]);
});

test("REV-FR03-02 [FR-03, BR-01] Break expiry starts Focus without showing memo UI", () => {
  const app = boot();
  click(app, "start-button");
  app.advance(25 * MINUTE + 1);
  app.tick();
  click(app, "memo-skip-button");
  app.advance(5 * MINUTE + 1);
  app.tick();
  const state = timerStatus(app);
  assert.equal(state.sessionType, "Focus");
  assert.equal(state.status, "Running");
  assert.equal(state.memoPending, null);
  assert.equal(app.elements.get("memo-panel").hidden, true);
});

test("REV-FR03-03 [FR-03, BR-01] consuming the fourth Focus slot selects Long Break", () => {
  const initial = boot();
  const seeded = replaceStored(initial, ({ value }) => value && value.sessionType === "Focus", {
    ...storedTimer(initial).value,
    status: "Idle",
    endTimestamp: null,
    focusSlotsCompleted: 3,
    remainingMs: 25 * MINUTE
  });
  const app = boot({ seed: seeded });
  click(app, "start-button");
  app.advance(25 * MINUTE + 1);
  app.tick();
  assert.equal(timerStatus(app).focusSlotsCompleted, 4);
  click(app, "memo-skip-button");
  const next = timerStatus(app);
  assert.equal(next.sessionType, "LongBreak");
  assert.equal(next.status, "Running");
});

test("REV-FR04-01 [FR-04, BR-01] skipping Focus advances the slot without changing completion count or requesting memo", () => {
  const app = boot();
  click(app, "skip-button");
  const state = timerStatus(app);
  assert.equal(state.sessionType, "ShortBreak");
  assert.equal(state.status, "Running");
  assert.equal(state.focusSlotsCompleted, 1);
  assert.equal(state.memoPending, null);
  const logs = storedLogs(app).value;
  assert.equal(Object.values(logs).reduce((sum, record) => sum + record.completedCount, 0), 0);
  assert.equal(app.elements.get("memo-panel").hidden, true);
});

test("REV-FR04-02 [FR-04, BR-01] two skipped Focus slots plus two timed completions reach Long Break with count two", () => {
  const app = boot();
  click(app, "skip-button");
  click(app, "skip-button");
  click(app, "skip-button");
  click(app, "skip-button");
  app.advance(25 * MINUTE + 1);
  app.tick();
  click(app, "memo-skip-button");
  click(app, "skip-button");
  app.advance(25 * MINUTE + 1);
  app.tick();
  click(app, "memo-skip-button");
  const state = timerStatus(app);
  assert.equal(state.sessionType, "LongBreak");
  assert.equal(state.focusSlotsCompleted, 4);
  const logs = storedLogs(app).value;
  assert.equal(Object.values(logs).reduce((sum, record) => sum + record.completedCount, 0), 2);
});

test("REV-FR05-01 [FR-05] blank submission is accepted and displayed as no memo", () => {
  const app = boot();
  click(app, "start-button");
  app.advance(25 * MINUTE + 1);
  app.tick();
  app.elements.get("memo-input").value = "   ";
  submit(app, "memo-form");
  const log = Object.values(storedLogs(app).value)[0];
  assert.equal(log.completedCount, 1);
  assert.equal(log.entries[0].text, "");
  navigate(app, "log");
  assert.match(textTree(app.elements.get("log-list")), /메모 없음/);
});

test("REV-FR06-01 [FR-06] selected day shows the saved count and chronological memo order", () => {
  const first = boot();
  const timerRecord = storedTimer(first).value;
  const logRecord = storedLogs(first);
  const dateKey = first.elements.get("log-date").value;
  const seeded = first.snapshot();
  seeded[logRecord.key] = JSON.stringify({
    [dateKey]: {
      date: dateKey,
      completedCount: 2,
      entries: [
        { completedAt: START_TIME + 9000, text: "두 번째 기록" },
        { completedAt: START_TIME + 1000, text: "첫 번째 기록" }
      ]
    }
  });
  seeded[storedTimer(first).key] = JSON.stringify(timerRecord);
  const app = boot({ seed: seeded });
  navigate(app, "log");
  assert.equal(app.elements.get("log-count").textContent, "2");
  assert.deepEqual(listTexts(app), ["첫 번째 기록", "두 번째 기록"]);
});

test("REV-FR07-01 [FR-07] invalid duration inputs are rejected and Idle settings update immediately", () => {
  const app = boot();
  navigate(app, "settings");
  app.elements.get("focus-minutes").value = "30";
  app.elements.get("short-break-minutes").value = "0";
  app.elements.get("long-break-minutes").value = "1.5";
  submit(app, "settings-form");
  assert.match(app.elements.get("short-break-error").textContent, /1~180/);
  assert.match(app.elements.get("long-break-error").textContent, /1~180/);
  assert.equal(timerStatus(app).remainingMs, 25 * MINUTE);
  app.elements.get("short-break-minutes").value = "7";
  app.elements.get("long-break-minutes").value = "20";
  submit(app, "settings-form");
  assert.equal(timerStatus(app).remainingMs, 30 * MINUTE);
  assert.equal(app.elements.get("focus-duration-label").textContent, "30분");
});

test("REV-FR07-02 [FR-07] Running and Paused sessions retain their current timing while settings change", () => {
  const app = boot();
  click(app, "start-button");
  const runningBefore = timerStatus(app);
  navigate(app, "settings");
  app.elements.get("focus-minutes").value = "45";
  app.elements.get("short-break-minutes").value = "8";
  app.elements.get("long-break-minutes").value = "22";
  submit(app, "settings-form");
  const runningAfter = timerStatus(app);
  assert.equal(runningAfter.status, "Running");
  assert.equal(runningAfter.endTimestamp, runningBefore.endTimestamp);
  navigate(app, "timer");
  click(app, "start-button");
  const pausedBefore = timerStatus(app);
  navigate(app, "settings");
  app.elements.get("focus-minutes").value = "60";
  submit(app, "settings-form");
  const pausedAfter = timerStatus(app);
  assert.equal(pausedAfter.status, "Paused");
  assert.equal(pausedAfter.remainingMs, pausedBefore.remainingMs);
});

test("REV-FR08-01 [FR-08, EC-03, 13.2] Running state restores with its absolute end time after reload", () => {
  const first = boot();
  click(first, "start-button");
  const beforeReload = timerStatus(first);
  const second = boot({ seed: first.snapshot(), now: START_TIME + 10000 });
  const afterReload = timerStatus(second);
  assert.equal(afterReload.status, "Running");
  assert.equal(afterReload.endTimestamp, beforeReload.endTimestamp);
  assert.equal(second.elements.get("time-display").textContent, "24:50");
});

test("REV-FR08-02 [FR-08, EC-03, 13.2] Paused state restores the same positive snapshot after offline time", () => {
  const first = boot();
  click(first, "start-button");
  first.advance(11000);
  first.tick();
  click(first, "start-button");
  const beforeReload = timerStatus(first);
  const second = boot({ seed: first.snapshot(), now: START_TIME + 60 * MINUTE });
  const afterReload = timerStatus(second);
  assert.equal(afterReload.status, "Paused");
  assert.equal(afterReload.endTimestamp, null);
  assert.equal(afterReload.remainingMs, beforeReload.remainingMs);
  assert.ok(afterReload.remainingMs > 0);
});

test("REV-EC03-01 [EC-03, BR-02] an expired restored Focus is completed once and waits for memo interaction", () => {
  const first = boot();
  click(first, "start-button");
  const expiredAt = START_TIME + 25 * MINUTE + 1;
  const second = boot({ seed: first.snapshot(), now: expiredAt + 4 * 60 * MINUTE });
  const state = timerStatus(second);
  assert.equal(state.status, "Idle");
  assert.ok(state.memoPending);
  assert.equal(second.elements.get("timer-controls").hidden, true);
  const logs = Object.values(storedLogs(second).value);
  assert.equal(logs.reduce((sum, record) => sum + record.completedCount, 0), 1);
  assert.notEqual(state.sessionType, "ShortBreak");
});

test("REV-EC02-01 [EC-02] a hidden tab defers expiry until visibilitychange and then reconciles by target time", () => {
  const app = boot();
  click(app, "start-button");
  app.setHidden(true);
  app.advance(26 * MINUTE);
  app.tick();
  assert.equal(timerStatus(app).status, "Running");
  app.returnToTab();
  assert.ok(timerStatus(app).memoPending);
  assert.equal(app.elements.get("timer-controls").hidden, true);
});

test("REV-EC04-01 [EC-04, NFR-01, 13.3-U4] a five-second-or-greater wall/performance delta pauses at the last valid display and offers resume", () => {
  const app = boot();
  click(app, "start-button");
  app.advance(3000);
  app.tick();
  const lastValidDisplay = app.elements.get("time-display").textContent;
  app.advanceWallOnly(10000);
  app.tick();
  const state = timerStatus(app);
  assert.equal(state.status, "Paused");
  assert.equal(app.elements.get("time-display").textContent, lastValidDisplay);
  assert.equal(app.elements.get("clock-modal").hidden, false);
  assert.match(HTML, /시스템 시간 변경이 감지되어 타이머가 일시정지되었습니다/);
  click(app, "clock-resume-button");
  assert.equal(timerStatus(app).status, "Running");
});

test("REV-EC05-01 [EC-05, 13.3-U5] write failure keeps timer usable and a later successful write clears the warning", () => {
  const app = boot();
  app.storage.failWrites = true;
  click(app, "start-button");
  assert.equal(app.elements.get("status-label").textContent, "진행 중");
  assert.equal(app.elements.get("storage-warning").hidden, false);
  app.storage.failWrites = false;
  click(app, "start-button");
  assert.equal(timerStatus(app).status, "Paused");
  assert.equal(app.elements.get("storage-warning").hidden, true);
});

test("REV-NFR01-01 [NFR-01, 13.3-U3] a long elapsed interval is derived from wall time without countdown drift", () => {
  const app = boot();
  navigate(app, "settings");
  app.elements.get("focus-minutes").value = "180";
  app.elements.get("short-break-minutes").value = "5";
  app.elements.get("long-break-minutes").value = "15";
  submit(app, "settings-form");
  navigate(app, "timer");
  click(app, "start-button");
  app.advance(90 * MINUTE);
  app.tick();
  assert.equal(app.elements.get("time-display").textContent, "90:00");
});

test("REV-13.2-01 [13.2 System Acceptance] one foreground flow connects start, expiry, memo, break, next Focus, and log", () => {
  const app = boot();
  click(app, "start-button");
  app.advance(25 * MINUTE + 1);
  app.tick();
  app.elements.get("memo-input").value = "통합 흐름 기록";
  submit(app, "memo-form");
  app.advance(5 * MINUTE + 1);
  app.tick();
  navigate(app, "log");
  assert.equal(app.elements.get("log-count").textContent, "1");
  assert.deepEqual(listTexts(app), ["통합 흐름 기록"]);
  assert.equal(timerStatus(app).sessionType, "Focus");
  assert.equal(timerStatus(app).status, "Running");
});

test("REV-13.3-U1 [13.3 User Acceptance] a timed user session produces the matching daily log including a blank memo", () => {
  const app = boot();
  click(app, "start-button");
  app.advance(25 * MINUTE + 1);
  app.tick();
  click(app, "memo-skip-button");
  navigate(app, "log");
  assert.equal(app.elements.get("log-count").textContent, "1");
  assert.match(textTree(app.elements.get("log-list")), /메모 없음/);
});

test("REV-13.3-U2 [13.3 User Acceptance] settings, running timer, and log data survive a reload boundary", () => {
  const first = boot();
  navigate(first, "settings");
  first.elements.get("focus-minutes").value = "30";
  first.elements.get("short-break-minutes").value = "6";
  first.elements.get("long-break-minutes").value = "18";
  submit(first, "settings-form");
  navigate(first, "timer");
  click(first, "start-button");
  const second = boot({ seed: first.snapshot(), now: START_TIME + 4000 });
  assert.equal(timerStatus(second).status, "Running");
  assert.equal(timerStatus(second).endTimestamp - (START_TIME + 4000), 30 * MINUTE - 4000);
  assert.equal(second.elements.get("focus-duration-label").textContent, "30분");
});
