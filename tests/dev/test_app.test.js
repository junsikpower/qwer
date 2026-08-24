const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { mock, test } = require("node:test");

const ROOT = path.resolve(__dirname, "../..");
const HTML = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const INLINE_SCRIPT = HTML.match(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/i)[1];

class FakeClassList {
  constructor() { this.values = new Set(); }
  toggle(name, force) {
    const shouldHave = force === undefined ? !this.values.has(name) : Boolean(force);
    if (shouldHave) this.values.add(name); else this.values.delete(name);
    return shouldHave;
  }
  contains(name) { return this.values.has(name); }
}

class FakeElement {
  constructor(tagName = "div") {
    this.tagName = tagName.toUpperCase();
    this.hidden = false;
    this.value = "";
    this.textContent = "";
    this.innerHTML = "";
    this.className = "";
    this.classList = new FakeClassList();
    this.attributes = new Map();
    this.children = [];
    this.listeners = new Map();
    this.focused = false;
    this.dateTime = "";
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
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
    if (selector === "span") return this.span || (this.span = new FakeElement("span"));
    if (selector === "svg") return this.svg || (this.svg = new FakeElement("svg"));
    return null;
  }
  focus() { this.focused = true; }
}

class FakeStorage {
  constructor(seed = {}) {
    this.values = new Map(Object.entries(seed));
    this.failWrites = false;
  }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) {
    if (this.failWrites) throw new Error("storage write failed");
    this.values.set(key, String(value));
  }
  removeItem(key) { this.values.delete(key); }
}

function makeDocument() {
  const ids = [
    "storage-warning", "timer-view", "log-view", "settings-view", "timer-card", "phase-kicker",
    "phase-title", "phase-subtitle", "time-display", "status-line", "status-label", "timer-controls",
    "start-button", "reset-button", "skip-button", "cycle-count", "focus-duration-label",
    "short-duration-label", "long-duration-label", "memo-panel", "memo-form", "memo-input",
    "memo-skip-button", "log-date", "log-count", "log-list", "settings-form", "focus-minutes",
    "short-break-minutes", "long-break-minutes", "focus-error", "short-break-error", "long-break-error",
    "settings-feedback", "clock-modal", "clock-resume-button"
  ];
  const elements = new Map(ids.map((id) => [id, new FakeElement(id.endsWith("-button") ? "button" : "div")]));
  elements.get("memo-form").tagName = "FORM";
  elements.get("settings-form").tagName = "FORM";
  const progressDots = [1, 2, 3, 4].map(() => new FakeElement("span"));
  const sessionInfo = ["Focus", "ShortBreak", "LongBreak"].map((session) => {
    const element = new FakeElement("div");
    element.setAttribute("data-session-info", session);
    return element;
  });
  const navButtons = ["timer", "log", "settings"].map((view) => {
    const element = new FakeElement("button");
    element.setAttribute("data-view", view);
    return element;
  });
  const brand = new FakeElement("a");
  brand.setAttribute("data-view", "timer");
  navButtons.push(brand);
  const document = {
    readyState: "complete",
    hidden: false,
    title: "Pomodoro Timer",
    listeners: new Map(),
    getElementById(id) { return elements.get(id) || null; },
    querySelectorAll(selector) {
      if (selector === ".progress-dot") return progressDots;
      if (selector === "[data-session-info]") return sessionInfo;
      if (selector === "[data-view]") return navButtons;
      return [];
    },
    createElement(tagName) { return new FakeElement(tagName); },
    addEventListener(name, handler) {
      if (!this.listeners.has(name)) this.listeners.set(name, []);
      this.listeners.get(name).push(handler);
    },
    dispatchEvent(event) {
      for (const handler of this.listeners.get(event.type) || []) handler(event);
    }
  };
  return { document, elements, progressDots, sessionInfo };
}

function makeWindow(seed = {}) {
  const { document, elements, progressDots, sessionInfo } = makeDocument();
  let performanceNow = 1000;
  const storage = new FakeStorage(seed);
  const window = {
    document,
    localStorage: storage,
    performance: { now: () => performanceNow },
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    clearInterval: () => {},
    addEventListener: () => {},
    AudioContext: undefined,
    webkitAudioContext: undefined,
    Notification: undefined,
    window: null
  };
  window.window = window;
  const context = vm.createContext(window);
  vm.runInContext(INLINE_SCRIPT, context, { filename: "index.html:inline-script" });
  return {
    window: context,
    app: context.PomodoroTimerApp,
    core: context.PomodoroTimerCore,
    storage,
    elements,
    progressDots,
    sessionInfo,
    setPerformanceNow(value) { performanceNow = value; }
  };
}

function setRunning(app, milliseconds = 60000) {
  app.timer.status = "Running";
  app.timer.remainingMs = milliseconds;
  app.timer.endTimestamp = Date.now() + milliseconds;
  app.setAnchors();
}

test("core validates durations, formats time, and computes the approved clock-shift algorithm", () => {
  const { core } = makeWindow();
  assert.equal(core.isValidDurationInput("1"), true);
  assert.equal(core.isValidDurationInput("180"), true);
  assert.equal(core.isValidDurationInput("0"), false);
  assert.equal(core.isValidDurationInput("181"), false);
  assert.equal(core.isValidDurationInput("1.5"), false);
  assert.equal(core.isValidDurationInput("abc"), false);
  assert.equal(core.formatRemaining(2500), "00:03");
  assert.equal(core.formatRemaining(25 * 60 * 1000), "25:00");
  assert.equal(core.isClockShifted(1000, 2000, 6999, 7000), false);
  assert.equal(core.isClockShifted(1000, 2000, 7000, 2000), true);
});

test("start, pause, and reset preserve accurate state and cycle slots", () => {
  const { app, elements } = makeWindow();
  assert.equal(app.timer.status, "Idle");
  app.startTimer(false);
  assert.equal(app.timer.status, "Running");
  assert.ok(app.timer.endTimestamp > Date.now());
  app.pauseTimer();
  const pausedRemaining = app.timer.remainingMs;
  assert.equal(app.timer.status, "Paused");
  assert.ok(pausedRemaining > 0);
  app.timer.focusSlotsCompleted = 3;
  app.resetTimer();
  assert.equal(app.timer.status, "Idle");
  assert.equal(app.timer.focusSlotsCompleted, 3);
  assert.equal(app.timer.remainingMs, 25 * 60 * 1000);
  assert.equal(elements.get("timer-controls").hidden, false);
});

test("a completed Focus increments the count, enters memo pending, then auto-starts Short Break", () => {
  const { app, elements } = makeWindow();
  setRunning(app, 1);
  app.timer.endTimestamp = Date.now() - 1;
  app.tick();
  assert.equal(app.timer.status, "Idle");
  assert.equal(app.timer.memoPending != null, true);
  assert.equal(app.timer.focusSlotsCompleted, 1);
  const dateKey = app.timer.memoPending.logDate;
  assert.equal(app.logs[dateKey].completedCount, 1);
  assert.equal(elements.get("timer-controls").hidden, true);
  assert.equal(elements.get("memo-panel").hidden, false);

  elements.get("memo-input").value = "문서 초안 정리";
  elements.get("memo-form").dispatchEvent({ type: "submit", preventDefault() {} });
  assert.equal(app.timer.memoPending, null);
  assert.equal(app.timer.sessionType, "ShortBreak");
  assert.equal(app.timer.status, "Running");
  assert.deepEqual(Array.from(app.logs[dateKey].entries, (entry) => entry.text), ["문서 초안 정리"]);
});

test("memo skip stores an empty memo and the fourth Focus slot selects Long Break", () => {
  const { app, elements } = makeWindow();
  setRunning(app, 1);
  app.timer.endTimestamp = Date.now() - 1;
  app.tick();
  const dateKey = app.timer.memoPending.logDate;
  elements.get("memo-skip-button").dispatchEvent({ type: "click" });
  assert.equal(app.logs[dateKey].entries[0].text, "");
  assert.equal(app.timer.sessionType, "ShortBreak");

  app.timer.sessionType = "Focus";
  app.timer.status = "Idle";
  app.timer.focusSlotsCompleted = 3;
  app.timer.memoPending = null;
  app.skipTimer();
  assert.equal(app.timer.focusSlotsCompleted, 4);
  assert.equal(app.timer.sessionType, "LongBreak");
  assert.equal(app.timer.status, "Running");
  assert.equal(app.logs[dateKey].completedCount, 1);
});

test("skipping Long Break resets the cycle and starts Focus", () => {
  const { app } = makeWindow();
  app.timer.sessionType = "LongBreak";
  app.timer.status = "Idle";
  app.timer.focusSlotsCompleted = 4;
  app.timer.remainingMs = 15 * 60 * 1000;
  app.skipTimer();
  assert.equal(app.timer.sessionType, "Focus");
  assert.equal(app.timer.focusSlotsCompleted, 0);
  assert.equal(app.timer.status, "Running");
});

test("settings apply immediately to Idle sessions but preserve active-session timing", () => {
  const { app, elements } = makeWindow();
  elements.get("focus-minutes").value = "30";
  elements.get("short-break-minutes").value = "7";
  elements.get("long-break-minutes").value = "20";
  assert.equal(app.saveSettings(), true);
  assert.equal(app.settings.focusMinutes, 30);
  assert.equal(app.timer.remainingMs, 30 * 60 * 1000);

  setRunning(app, 120000);
  const endBefore = app.timer.endTimestamp;
  elements.get("focus-minutes").value = "45";
  assert.equal(app.saveSettings(), true);
  assert.equal(app.timer.status, "Running");
  assert.equal(app.timer.endTimestamp, endBefore);
  assert.equal(app.settings.focusMinutes, 45);

  elements.get("focus-minutes").value = "181";
  assert.equal(app.saveSettings(), false);
  assert.equal(app.settings.focusMinutes, 45);
  assert.match(elements.get("focus-error").textContent, /1~180/);
});

test("restoring an expired Running session processes exactly one session and waits Idle", () => {
  const now = Date.now();
  const seed = {
    "pomodoro-timer.settings.v1": JSON.stringify({ focusMinutes: 25, shortBreakMinutes: 5, longBreakMinutes: 15 }),
    "pomodoro-timer.logs.v1": JSON.stringify({}),
    "pomodoro-timer.timer.v1": JSON.stringify({
      sessionType: "Focus",
      status: "Running",
      endTimestamp: now - 60000,
      remainingMs: 1,
      focusSlotsCompleted: 2
    })
  };
  const { app } = makeWindow(seed);
  assert.equal(app.timer.status, "Idle");
  assert.equal(app.timer.memoPending != null, true);
  assert.equal(app.timer.focusSlotsCompleted, 3);
  assert.equal(Object.values(app.logs).reduce((sum, log) => sum + log.completedCount, 0), 1);
});

test("restoring a Paused session preserves its snapshot regardless of elapsed wall time", () => {
  const seed = {
    "pomodoro-timer.timer.v1": JSON.stringify({
      sessionType: "Focus",
      status: "Paused",
      endTimestamp: null,
      remainingMs: 4321,
      focusSlotsCompleted: 1
    })
  };
  const { app } = makeWindow(seed);
  assert.equal(app.timer.status, "Paused");
  assert.equal(app.timer.remainingMs, 4321);
  assert.equal(app.timer.endTimestamp, null);
});

test("clock-shift detection pauses without changing the last valid remaining snapshot", () => {
  const { app, elements, setPerformanceNow } = makeWindow();
  setRunning(app, 90000);
  app.timer.remainingMs = 90000;
  app.timer.dateAnchor = Date.now() - 10000;
  setPerformanceNow(app.timer.perfAnchor);
  app.tick();
  assert.equal(app.timer.status, "Paused");
  assert.equal(app.timer.remainingMs, 90000);
  assert.equal(app.clockAlert, true);
  assert.equal(elements.get("clock-modal").hidden, false);
  assert.match(HTML, /시스템 시간 변경이 감지되어 타이머가 일시정지되었습니다/);
  elements.get("clock-resume-button").dispatchEvent({ type: "click" });
  assert.equal(app.clockAlert, false);
  assert.equal(app.timer.status, "Running");
});

test("storage write failures show a warning while timer actions continue", () => {
  const { app, storage, elements } = makeWindow();
  storage.failWrites = true;
  app.startTimer(false);
  assert.equal(app.timer.status, "Running");
  assert.equal(app.storageWarning, true);
  assert.equal(elements.get("storage-warning").hidden, false);
  storage.failWrites = false;
  app.pauseTimer();
  assert.equal(app.storageWarning, false);
  assert.equal(elements.get("storage-warning").hidden, true);
});

test("allowed browser notification and synthesized sound are attempted together", () => {
  const { app, window } = makeWindow();
  let notificationCount = 0;
  class FakeNotification {
    static permission = "granted";
    constructor() { notificationCount += 1; }
  }
  let oscillatorStarted = false;
  window.Notification = FakeNotification;
  app.audioContext = {
    currentTime: 0,
    destination: {},
    createOscillator() {
      return {
        type: "",
        frequency: { setValueAtTime() {} },
        connect() {},
        start() { oscillatorStarted = true; },
        stop() {}
      };
    },
    createGain() {
      return {
        gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
        connect() {}
      };
    }
  };
  app.notifySessionEnd("Focus");
  assert.equal(notificationCount, 1);
  assert.equal(oscillatorStarted, true);
});

test("failed audio falls back to a changed tab title", () => {
  const { app, window } = makeWindow();
  app.audioContext = {
    currentTime: 0,
    createOscillator() { throw new Error("audio denied"); }
  };
  window.Notification = undefined;
  app.notifySessionEnd("ShortBreak");
  assert.match(window.document.title, /세션 종료/);
});

test("test doubles use the standard Node mock facility and leave no pending timer handles", () => {
  const tracker = mock.fn(() => "ok");
  assert.equal(tracker(), "ok");
  assert.equal(tracker.mock.callCount(), 1);
});
