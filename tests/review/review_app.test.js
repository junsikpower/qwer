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
  constructor() {
    this.values = new Set();
  }
  toggle(name, force) {
    const enabled = force === undefined ? !this.values.has(name) : Boolean(force);
    if (enabled) this.values.add(name);
    else this.values.delete(name);
    return enabled;
  }
  contains(name) {
    return this.values.has(name);
  }
  add(name) {
    this.values.add(name);
  }
  remove(name) {
    this.values.delete(name);
  }
}

class Element {
  constructor(tagName = "div") {
    this.tagName = tagName.toUpperCase();
    this.hidden = false;
    this._value = "";
    this._textContent = "";
    this.innerHTML = "";
    this.className = "";
    this.classList = new ClassList();
    this.attributes = new Map();
    this.children = [];
    this.listeners = new Map();
    this.focused = false;
    this.parentElement = null;
  }

  get value() {
    return this._value;
  }

  set value(val) {
    const str = String(val ?? "");
    const max = this.getAttribute("maxlength");
    if (max && /^\d+$/.test(max) && str.length > Number(max)) {
      this._value = str.slice(0, Number(max));
    } else {
      this._value = str;
    }
  }

  get textContent() {
    return this._textContent;
  }

  set textContent(value) {
    this._textContent = String(value ?? "");
    if (!this._textContent) this.children = [];
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  addEventListener(name, handler) {
    if (!this.listeners.has(name)) this.listeners.set(name, []);
    this.listeners.get(name).push(handler);
  }

  dispatchEvent(event) {
    event.target = event.target || this;
    let cur = this;
    while (cur) {
      for (const handler of cur.listeners.get(event.type) || []) {
        handler(event);
      }
      cur = cur.parentElement;
    }
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  querySelector(selector) {
    if (selector === "span") {
      return this.children.find((c) => c.tagName === "SPAN") || (this.span || (this.span = new Element("span")));
    }
    if (selector === "svg") {
      return this.children.find((c) => c.tagName === "SVG") || (this.svg || (this.svg = new Element("svg")));
    }
    return null;
  }

  closest(selector) {
    let cur = this;
    while (cur) {
      if (selector.startsWith("[") && selector.endsWith("]")) {
        const attr = selector.slice(1, -1);
        if (cur.attributes.has(attr)) return cur;
      } else if (selector.startsWith(".")) {
        const cls = selector.slice(1);
        if (cur.classList.contains(cls)) return cur;
      } else if (cur.tagName && cur.tagName.toLowerCase() === selector.toLowerCase()) {
        return cur;
      }
      cur = cur.parentElement;
    }
    return null;
  }

  focus() {
    this.focused = true;
  }
}

class StorageDouble {
  constructor(seed = {}) {
    this.values = new Map(Object.entries(seed));
    this.failWrites = false;
  }
  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }
  setItem(key, value) {
    if (this.failWrites) throw new Error("simulated localStorage write failure");
    this.values.set(key, String(value));
  }
  removeItem(key) {
    this.values.delete(key);
  }
  snapshot() {
    return Object.fromEntries(this.values.entries());
  }
}

function createDocument() {
  const ids = [
    "storage-warning", "timer-view", "log-view", "settings-view", "diary-view",
    "timer-card", "phase-kicker", "phase-title", "phase-subtitle", "time-display",
    "status-line", "status-label", "timer-controls", "start-button", "reset-button", "skip-button",
    "cycle-count", "focus-duration-label", "short-duration-label", "long-duration-label",
    "memo-panel", "memo-form", "memo-input", "memo-skip-button",
    "log-date", "log-count", "log-list",
    "settings-form", "focus-minutes", "short-break-minutes", "long-break-minutes",
    "focus-error", "short-break-error", "long-break-error", "settings-feedback",
    "clock-modal", "clock-resume-button",
    "timer-nav-badge", "diary-new-button", "diary-entry-list", "diary-editor-date",
    "diary-unsaved-badge", "diary-empty-state", "diary-form", "diary-body",
    "diary-char-count", "diary-error"
  ];
  const elements = new Map();
  ids.forEach((id) => {
    const tag = id.endsWith("-button") ? "button"
      : id.endsWith("-form") ? "form"
      : id === "diary-body" ? "textarea"
      : id.endsWith("-list") ? "ul"
      : "div";
    const el = new Element(tag);
    if (id === "diary-body") {
      el.setAttribute("maxlength", "5000");
    }
    if (id === "start-button") {
      const span = new Element("span");
      span.textContent = "시작";
      const svg = new Element("svg");
      el.appendChild(svg);
      el.appendChild(span);
    }
    elements.set(id, el);
  });

  const progressDots = Array.from({ length: 4 }, () => new Element("span"));
  const sessionInfo = ["Focus", "ShortBreak", "LongBreak"].map((type) => {
    const item = new Element("div");
    item.setAttribute("data-session-info", type);
    return item;
  });
  const nav = ["timer", "log", "diary", "settings"].map((view) => {
    const item = new Element("button");
    item.setAttribute("data-view", view);
    return item;
  });
  const brand = new Element("a");
  brand.setAttribute("data-view", "timer");
  nav.push(brand);

  const listeners = new Map();
  const document = {
    readyState: "complete",
    hidden: false,
    title: "Pomodoro Timer",
    listeners,
    getElementById(id) {
      return elements.get(id) || null;
    },
    querySelectorAll(selector) {
      if (selector === ".progress-dot") return progressDots;
      if (selector === "[data-session-info]") return sessionInfo;
      if (selector === "[data-view]") return nav;
      return [];
    },
    createElement(tagName) {
      return new Element(tagName);
    },
    addEventListener(name, handler) {
      if (!listeners.has(name)) listeners.set(name, []);
      listeners.get(name).push(handler);
    },
    dispatchEvent(event) {
      for (const handler of listeners.get(event.type) || []) handler(event);
    }
  };
  return { document, elements, progressDots, sessionInfo, nav };
}

function makeClockDate(getNow) {
  const RealDate = Date;
  return class ReviewClockDate extends RealDate {
    constructor(...args) {
      super(...(args.length ? args : [getNow()]));
    }
    static now() {
      return getNow();
    }
  };
}

function boot({ seed = {}, now = START_TIME, notification, audioContext } = {}) {
  let wallClock = now;
  let monotonicClock = 0;
  const dom = createDocument();
  const storage = new StorageDouble(seed);
  const intervals = [];
  const timeoutHandlers = new Map();
  let nextTimeoutId = 1;
  const windowListeners = new Map();

  const window = {
    document: dom.document,
    localStorage: storage,
    performance: { now: () => monotonicClock },
    Date: makeClockDate(() => wallClock),
    setTimeout(callback, delay = 0) {
      const id = nextTimeoutId++;
      timeoutHandlers.set(id, { callback, triggerAt: monotonicClock + delay });
      return id;
    },
    clearTimeout(id) {
      timeoutHandlers.delete(id);
    },
    setInterval(callback) {
      intervals.push(callback);
      return intervals.length;
    },
    clearInterval() {},
    addEventListener(name, handler) {
      if (!windowListeners.has(name)) windowListeners.set(name, []);
      windowListeners.get(name).push(handler);
    },
    dispatchEvent(event) {
      for (const handler of windowListeners.get(event.type) || []) handler(event);
    },
    AudioContext: audioContext,
    webkitAudioContext: undefined,
    Notification: notification,
    window: null
  };
  window.window = window;
  const context = vm.createContext(window);
  vm.runInContext(SCRIPT, context, { filename: "index.html:inline-script" });

  function flushTimeouts() {
    const ready = [];
    for (const [id, item] of timeoutHandlers.entries()) {
      if (item.triggerAt <= monotonicClock) {
        ready.push({ id, callback: item.callback });
      }
    }
    ready.forEach(({ id, callback }) => {
      timeoutHandlers.delete(id);
      callback();
    });
  }

  return {
    window: context,
    document: dom.document,
    elements: dom.elements,
    storage,
    advance(milliseconds) {
      wallClock += milliseconds;
      monotonicClock += milliseconds;
      flushTimeouts();
    },
    advanceWallOnly(milliseconds) {
      wallClock += milliseconds;
    },
    tick() {
      intervals.forEach((callback) => callback());
      flushTimeouts();
    },
    setHidden(value) {
      dom.document.hidden = value;
    },
    returnToTab() {
      dom.document.hidden = false;
      dom.document.dispatchEvent({ type: "visibilitychange" });
    },
    unload() {
      window.dispatchEvent({ type: "beforeunload" });
    },
    snapshot() {
      return storage.snapshot();
    }
  };
}

function click(app, id) {
  const el = app.elements.get(id);
  assert.ok(el, `Element #${id} must exist`);
  el.dispatchEvent({ type: "click", preventDefault() {} });
}

function submit(app, id) {
  const el = app.elements.get(id);
  assert.ok(el, `Form #${id} must exist`);
  el.dispatchEvent({ type: "submit", preventDefault() {} });
}

function navigate(app, view) {
  const button = app.document.querySelectorAll("[data-view]").find((item) => item.getAttribute("data-view") === view);
  assert.ok(button, `Nav button for view '${view}' must exist`);
  button.dispatchEvent({ type: "click", preventDefault() {} });
}

function typeDiary(app, text) {
  const textarea = app.elements.get("diary-body");
  textarea.value = text;
  textarea.dispatchEvent({ type: "input", preventDefault() {} });
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

function storedDiary(app) {
  const found = jsonEntries(app).find(({ key, value }) => key.includes("diary") && !key.includes("Draft") && Array.isArray(value));
  assert.ok(found, "Diary entries must be persisted separately as an array");
  return found;
}

function storedDiaryDraft(app) {
  const found = jsonEntries(app).find(({ key }) => key.includes("diaryDraft") || key.includes("Draft"));
  return found ? found.value : null;
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

function timerStatus(app) {
  return storedTimer(app).value;
}

class CountingAudioContext {
  static starts = 0;
  constructor() {
    this.currentTime = 0;
    this.destination = {};
    this.state = "running";
  }
  createOscillator() {
    return {
      frequency: { setValueAtTime() {} },
      connect() {},
      start() { CountingAudioContext.starts += 1; },
      stop() {}
    };
  }
  createGain() {
    return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} };
  }
}

class CountingNotification {
  static permission = "granted";
  static count = 0;
  constructor() {
    CountingNotification.count += 1;
  }
}

// ==============================================================================
// 1. Structural & Technical Constraints (Scope, Single-File, Random API restriction)
// ==============================================================================

test("REV-STRUCT-01 [3.2, 12.1, NFR-02, NFR-03] single-file offline constraints are observable", () => {
  assert.equal((HTML.match(/<html\b/gi) || []).length, 1);
  assert.equal((HTML.match(/<script(?:\s[^>]*)?>/gi) || []).length, 1);
  assert.equal(/<script\s[^>]*src\s*=|\b(?:src|href)\s*=\s*[\"'](?:https?:|\/\/)/i.test(HTML), false);
  assert.equal(/\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(/.test(SCRIPT), false);
  assert.equal(/react|vue|angular/i.test(SCRIPT), false);
  assert.ok((HTML.match(/<svg\b/gi) || []).length >= 4, "icons must be inline SVG");
});

test("REV-STRUCT-02 [3.2, 7.5, 12.2] out of scope exclusions (no diary deletion, no title, no manual date edit) are respected", () => {
  assert.equal(/deleteDiary|removeDiary|diary-delete/i.test(SCRIPT), false, "App must not provide in-app diary deletion");
  assert.equal(/id=["']diary-title["']/i.test(HTML), false, "Diary must not have a title field");
  assert.equal(/id=["']diary-date-input["']/i.test(HTML), false, "Diary must not allow manual date modification");
});

test("REV-STRUCT-03 [BR-05, 12.2, 12.3] diary ID generator is deterministic without crypto.randomUUID", () => {
  assert.equal(/crypto\.randomUUID/i.test(SCRIPT), false, "crypto.randomUUID must not be used");
  const app = boot();
  const core = app.window.PomodoroTimerCore;
  const generate = core.createDiaryIdGenerator();
  const id1 = generate();
  const id2 = generate();
  assert.ok(typeof id1 === "string" && id1.includes("-"), "ID format must combine timestamp and sequence counter");
  assert.notEqual(id1, id2);
});

// ==============================================================================
// 2. Functional Requirements (FR-01 ~ FR-13 & Acceptance Criteria 13.1)
// ==============================================================================

test("REV-FR01-01 [FR-01, 13.1] user controls follow Idle → Running → Paused → Idle and absolute time advances", () => {
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

test("REV-FR01-02 [FR-01, BR-03, 13.1] reset does not consume an already completed Focus slot", () => {
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

test("REV-FR01-03 [FR-01, BR-04, 13.1] timer controls are hidden during Memo-Input-Pending", () => {
  const app = boot();
  click(app, "start-button");
  app.advance(25 * MINUTE + 1);
  app.tick();
  assert.equal(app.elements.get("timer-controls").hidden, true);
  assert.equal(app.elements.get("memo-panel").hidden, false);
});

test("REV-FR02-01 [FR-02, EC-01, 13.1] granted notification permission triggers sound and browser notification together", () => {
  CountingAudioContext.starts = 0;
  CountingNotification.count = 0;
  const app = boot({ audioContext: CountingAudioContext, notification: CountingNotification });
  click(app, "start-button");
  app.advance(25 * MINUTE + 1);
  app.tick();
  assert.equal(CountingAudioContext.starts, 1);
  assert.equal(CountingNotification.count, 1);
});

test("REV-FR02-02 [FR-02, EC-01, 13.1] unsupported notification and failed audio use the title fallback", () => {
  class BrokenAudioContext extends CountingAudioContext {
    createOscillator() { throw new Error("audio playback rejected"); }
  }
  const app = boot({ audioContext: BrokenAudioContext });
  click(app, "start-button");
  app.advance(25 * MINUTE + 1);
  app.tick();
  assert.match(app.document.title, /세션 종료/);
});

test("REV-FR03-01 [FR-03, FR-05, BR-01, 13.1] Focus completion records before memo resolution and starts Short Break after submission", () => {
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

test("REV-FR03-02 [FR-03, BR-01, 13.1] Break expiry starts Focus without showing memo UI", () => {
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

test("REV-FR03-03 [FR-03, BR-01, 13.1] consuming the fourth Focus slot selects Long Break", () => {
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

test("REV-FR04-01 [FR-04, BR-01, 13.1] skipping Focus advances the slot without changing completion count or requesting memo", () => {
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

test("REV-FR04-02 [FR-04, BR-01, 13.1] two skipped Focus slots plus two timed completions reach Long Break with count two", () => {
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

test("REV-FR05-01 [FR-05, 13.1] blank submission is accepted and displayed as no memo", () => {
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

test("REV-FR06-01 [FR-06, 13.1] selected day shows the saved count and chronological memo order", () => {
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

test("REV-FR07-01 [FR-07, 13.1] invalid duration inputs are rejected and Idle settings update immediately", () => {
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

test("REV-FR07-02 [FR-07, 13.1] Running and Paused sessions retain their current timing while settings change", () => {
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

test("REV-FR08-01 [FR-08, EC-03, 13.1] Running state restores with its absolute end time after reload", () => {
  const first = boot();
  click(first, "start-button");
  const beforeReload = timerStatus(first);
  const second = boot({ seed: first.snapshot(), now: START_TIME + 10000 });
  const afterReload = timerStatus(second);
  assert.equal(afterReload.status, "Running");
  assert.equal(afterReload.endTimestamp, beforeReload.endTimestamp);
  assert.equal(second.elements.get("time-display").textContent, "24:50");
});

test("REV-FR08-02 [FR-08, EC-03, 13.1] Paused state restores the same positive snapshot after offline time", () => {
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

test("REV-FR09-01 [FR-09, BR-05, 13.1] diary view provides two-pane layout, new button, and empty state", () => {
  const app = boot();
  navigate(app, "diary");
  assert.equal(app.elements.get("diary-view").hidden, false);
  assert.equal(app.elements.get("diary-new-button") != null, true);
  assert.equal(app.elements.get("diary-empty-state").hidden, false);
  assert.equal(app.elements.get("diary-form").hidden, true);
  assert.match(textTree(app.elements.get("diary-entry-list")), /작성된 일기가 없습니다/);
});

test("REV-FR09-02 [FR-09, BR-05, 13.1] diary list displays all entries sorted descending by date then creation time", () => {
  const seeded = {
    "pomodoro-timer.diary.v1": JSON.stringify([
      { id: "1", date: "2026-08-20", body: "오래된 날짜 일기", createdAt: START_TIME, updatedAt: START_TIME },
      { id: "2", date: "2026-08-25", body: "오늘 첫 번째 일기", createdAt: START_TIME + 1000, updatedAt: START_TIME + 1000 },
      { id: "3", date: "2026-08-25", body: "오늘 두 번째 일기", createdAt: START_TIME + 5000, updatedAt: START_TIME + 5000 }
    ])
  };
  const app = boot({ seed: seeded });
  navigate(app, "diary");
  const listItems = app.elements.get("diary-entry-list").children;
  assert.equal(listItems.length, 3);
  assert.match(textTree(listItems[0]), /오늘 두 번째 일기/);
  assert.match(textTree(listItems[1]), /오늘 첫 번째 일기/);
  assert.match(textTree(listItems[2]), /오래된 날짜 일기/);
});

test("REV-FR09-03 [FR-09, 13.1] selecting an entry opens its body in the editor", () => {
  const seeded = {
    "pomodoro-timer.diary.v1": JSON.stringify([
      { id: "item-101", date: "2026-08-25", body: "선택 테스트 본문입니다.", createdAt: START_TIME, updatedAt: START_TIME }
    ])
  };
  const app = boot({ seed: seeded });
  navigate(app, "diary");
  const itemButton = app.elements.get("diary-entry-list").children[0].children[0];
  itemButton.dispatchEvent({ type: "click", preventDefault() {} });
  assert.equal(app.elements.get("diary-empty-state").hidden, true);
  assert.equal(app.elements.get("diary-form").hidden, false);
  assert.equal(app.elements.get("diary-body").value, "선택 테스트 본문입니다.");
  assert.equal(app.elements.get("diary-editor-date").textContent, "2026-08-25");
});

test("REV-FR09-04 [FR-09, BR-05, 13.1] invalid or corrupted diary records in localStorage are excluded without crashing", () => {
  const seeded = {
    "pomodoro-timer.diary.v1": JSON.stringify([
      { id: "valid-1", date: "2026-08-25", body: "정상 일기", createdAt: START_TIME, updatedAt: START_TIME },
      { id: null, date: "invalid", body: "깨진 데이터" },
      { id: "corrupt-2", date: "2026-08-25", body: "   " },
      null,
      42
    ])
  };
  const app = boot({ seed: seeded });
  navigate(app, "diary");
  const entries = storedDiary(app).value;
  assert.equal(entries.length, 1);
  assert.equal(entries[0].id, "valid-1");
});

test("REV-FR10-01 [FR-10, 13.1] '새 일기' clears editor and enters empty new draft state", () => {
  const seeded = {
    "pomodoro-timer.diary.v1": JSON.stringify([
      { id: "entry-1", date: "2026-08-25", body: "기존 일기", createdAt: START_TIME, updatedAt: START_TIME }
    ])
  };
  const app = boot({ seed: seeded });
  navigate(app, "diary");
  // Select existing
  app.elements.get("diary-entry-list").children[0].children[0].dispatchEvent({ type: "click", preventDefault() {} });
  assert.equal(app.elements.get("diary-body").value, "기존 일기");
  // Click 새 일기
  click(app, "diary-new-button");
  assert.equal(app.elements.get("diary-empty-state").hidden, true);
  assert.equal(app.elements.get("diary-form").hidden, false);
  assert.equal(app.elements.get("diary-body").value, "");
  assert.match(app.elements.get("diary-editor-date").textContent, /오늘 날짜로 기록/);
});

test("REV-FR10-02 [FR-10, BR-05, 13.1] saving new diary entry assigns local date, unique ID, prepends to list, and transitions to editing", () => {
  const app = boot();
  navigate(app, "diary");
  click(app, "diary-new-button");
  typeDiary(app, "오늘 처음 작성한 일기입니다.");
  submit(app, "diary-form");
  const entries = storedDiary(app).value;
  assert.equal(entries.length, 1);
  assert.equal(entries[0].body, "오늘 처음 작성한 일기입니다.");
  assert.ok(entries[0].id);
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(entries[0].date));
  assert.equal(entries[0].createdAt, entries[0].updatedAt);
  assert.equal(app.elements.get("diary-unsaved-badge").hidden, true);
});

test("REV-FR10-03 [FR-10, BR-05, 13.1] multiple diary entries on the same date are kept as distinct items", () => {
  const app = boot();
  navigate(app, "diary");
  click(app, "diary-new-button");
  typeDiary(app, "첫 번째 일기");
  submit(app, "diary-form");
  app.advance(100); // Advance time so creation times are distinct
  click(app, "diary-new-button");
  typeDiary(app, "두 번째 일기");
  submit(app, "diary-form");
  const entries = storedDiary(app).value;
  assert.equal(entries.length, 2);
  assert.equal(entries[0].body, "두 번째 일기");
  assert.equal(entries[1].body, "첫 번째 일기");
  assert.notEqual(entries[0].id, entries[1].id);
  assert.equal(entries[0].date, entries[1].date);
});

test("REV-FR10-04 [FR-10, 13.1] empty or whitespace-only diary submission is rejected with error", () => {
  const app = boot();
  navigate(app, "diary");
  click(app, "diary-new-button");
  typeDiary(app, "   \n  \t  ");
  submit(app, "diary-form");
  assert.match(app.elements.get("diary-error").textContent, /본문을 입력/);
  const entries = storedDiary(app).value;
  assert.equal(entries.length, 0);
});

test("REV-FR10-05 [FR-10, 13.1] unsaved diary input does not appear in list before explicit save", () => {
  const app = boot();
  navigate(app, "diary");
  click(app, "diary-new-button");
  typeDiary(app, "아직 저장 안 한 내용");
  navigate(app, "timer");
  navigate(app, "diary");
  const entries = storedDiary(app).value;
  assert.equal(entries.length, 0);
  assert.match(textTree(app.elements.get("diary-entry-list")), /작성된 일기가 없습니다/);
});

test("REV-FR11-01 [FR-11, 13.1] modifying existing diary updates body and updatedAt while keeping id, date, createdAt intact", () => {
  const initialCreated = START_TIME - 3600 * 1000;
  const seeded = {
    "pomodoro-timer.diary.v1": JSON.stringify([
      { id: "entry-fix", date: "2026-08-24", body: "수정 전 본문", createdAt: initialCreated, updatedAt: initialCreated }
    ])
  };
  const app = boot({ seed: seeded, now: START_TIME });
  navigate(app, "diary");
  app.elements.get("diary-entry-list").children[0].children[0].dispatchEvent({ type: "click", preventDefault() {} });
  typeDiary(app, "수정 완료된 새 본문");
  submit(app, "diary-form");
  const entries = storedDiary(app).value;
  assert.equal(entries.length, 1);
  assert.equal(entries[0].id, "entry-fix");
  assert.equal(entries[0].date, "2026-08-24");
  assert.equal(entries[0].createdAt, initialCreated);
  assert.equal(entries[0].body, "수정 완료된 새 본문");
  assert.equal(entries[0].updatedAt, START_TIME);
});

test("REV-FR11-02 [FR-11, 13.1] editing diary updates list preview without increasing entry count", () => {
  const seeded = {
    "pomodoro-timer.diary.v1": JSON.stringify([
      { id: "e1", date: "2026-08-25", body: "원래 본문", createdAt: START_TIME, updatedAt: START_TIME }
    ])
  };
  const app = boot({ seed: seeded });
  navigate(app, "diary");
  app.elements.get("diary-entry-list").children[0].children[0].dispatchEvent({ type: "click", preventDefault() {} });
  typeDiary(app, "변경된 미리보기 확인용 본문");
  submit(app, "diary-form");
  const preview = app.elements.get("diary-entry-list").children[0].children[0].children[1].textContent;
  assert.match(preview, /변경된 미리보기/);
  assert.equal(storedDiary(app).value.length, 1);
});

test("REV-FR12-01 [FR-12, NFR-04, 13.1] typing debounces draft to storage and reload restores draft with unsaved badge", () => {
  const first = boot();
  navigate(first, "diary");
  click(first, "diary-new-button");
  typeDiary(first, "작성 중인 임시 일기 초안");
  first.advance(900); // Exceed debounce (800ms)
  const draftInStorage = storedDiaryDraft(first);
  assert.ok(draftInStorage);
  assert.equal(draftInStorage.body, "작성 중인 임시 일기 초안");
  assert.equal(draftInStorage.targetType, "new");

  // Reload
  const second = boot({ seed: first.snapshot(), now: START_TIME + 2000 });
  navigate(second, "diary");
  assert.equal(second.elements.get("diary-body").value, "작성 중인 임시 일기 초안");
  assert.equal(second.elements.get("diary-unsaved-badge").hidden, false);
});

test("REV-FR12-02 [FR-12, 13.1] editing existing diary saves draft and reload restores edit target and body", () => {
  const seeded = {
    "pomodoro-timer.diary.v1": JSON.stringify([
      { id: "edit-draft-target", date: "2026-08-25", body: "기존 내용", createdAt: START_TIME, updatedAt: START_TIME }
    ])
  };
  const first = boot({ seed: seeded });
  navigate(first, "diary");
  first.elements.get("diary-entry-list").children[0].children[0].dispatchEvent({ type: "click", preventDefault() {} });
  typeDiary(first, "수정 중이던 미저장 본문");
  first.advance(900);
  const draft = storedDiaryDraft(first);
  assert.ok(draft);
  assert.equal(draft.targetType, "existing");
  assert.equal(draft.targetId, "edit-draft-target");

  const second = boot({ seed: first.snapshot(), now: START_TIME + 3000 });
  navigate(second, "diary");
  assert.equal(second.elements.get("diary-body").value, "수정 중이던 미저장 본문");
  assert.equal(second.elements.get("diary-editor-date").textContent, "2026-08-25");
  assert.equal(second.elements.get("diary-unsaved-badge").hidden, false);
});

test("REV-FR12-03 [FR-12, 13.1] successful save clears draft so subsequent reload shows saved state", () => {
  const first = boot();
  navigate(first, "diary");
  click(first, "diary-new-button");
  typeDiary(first, "저장 완료할 글");
  first.advance(900);
  submit(first, "diary-form");
  assert.equal(storedDiaryDraft(first), null);

  const second = boot({ seed: first.snapshot(), now: START_TIME + 4000 });
  navigate(second, "diary");
  assert.equal(second.elements.get("diary-unsaved-badge").hidden, true);
});

test("REV-FR12-04 [FR-12, 13.1] switching editor target clears the previous draft", () => {
  const seeded = {
    "pomodoro-timer.diary.v1": JSON.stringify([
      { id: "e1", date: "2026-08-25", body: "첫 번째", createdAt: START_TIME, updatedAt: START_TIME },
      { id: "e2", date: "2026-08-25", body: "두 번째", createdAt: START_TIME + 1000, updatedAt: START_TIME + 1000 }
    ])
  };
  const app = boot({ seed: seeded });
  navigate(app, "diary");
  // Select e1 and type
  app.elements.get("diary-entry-list").children[1].children[0].dispatchEvent({ type: "click", preventDefault() {} });
  typeDiary(app, "e1 임시 수정");
  app.advance(900);
  assert.ok(storedDiaryDraft(app));
  // Switch to e2
  app.elements.get("diary-entry-list").children[0].children[0].dispatchEvent({ type: "click", preventDefault() {} });
  assert.equal(storedDiaryDraft(app), null);
  assert.equal(app.elements.get("diary-body").value, "두 번째");
  assert.equal(app.elements.get("diary-unsaved-badge").hidden, true);
});

test("REV-FR12-05 [FR-12, 13.1] missing target entry for draft on reload falls back to new diary mode preserving body", () => {
  const seeded = {
    "pomodoro-timer.diary.v1": JSON.stringify([]),
    "pomodoro-timer.diaryDraft.v1": JSON.stringify({
      body: "고아 초안 본문",
      targetType: "existing",
      targetId: "deleted-id"
    })
  };
  const app = boot({ seed: seeded });
  navigate(app, "diary");
  assert.equal(app.elements.get("diary-body").value, "고아 초안 본문");
  assert.match(app.elements.get("diary-editor-date").textContent, /오늘 날짜로 기록/);
});

test("REV-FR13-01 [FR-13, 13.1] Memo-Input-Pending state displays visual badge on Timer nav across all views", () => {
  const app = boot();
  click(app, "start-button");
  navigate(app, "diary");
  assert.equal(app.elements.get("timer-nav-badge").hidden, true);
  app.advance(25 * MINUTE + 1);
  app.tick();
  assert.equal(app.elements.get("timer-nav-badge").hidden, false);
});

test("REV-FR13-02 [FR-13, 13.1] resolving memo clears the timer nav badge", () => {
  const app = boot();
  click(app, "start-button");
  app.advance(25 * MINUTE + 1);
  app.tick();
  assert.equal(app.elements.get("timer-nav-badge").hidden, false);
  click(app, "memo-skip-button");
  assert.equal(app.elements.get("timer-nav-badge").hidden, true);
});

test("REV-FR13-03 [FR-13, 13.1] break session expiry does not show timer nav badge", () => {
  const app = boot();
  click(app, "start-button");
  app.advance(25 * MINUTE + 1);
  app.tick();
  click(app, "memo-skip-button"); // Enters Short Break
  app.advance(5 * MINUTE + 1);
  app.tick(); // Breaks finishes -> starts Focus directly
  assert.equal(app.elements.get("timer-nav-badge").hidden, true);
});

// ==============================================================================
// 3. Error & Edge Cases (EC-01 ~ EC-06)
// ==============================================================================

test("REV-EC01-01 [EC-01, FR-02] Notification denied or missing AudioContext uses document title fallback", () => {
  class BlockedNotification {
    static permission = "denied";
  }
  const app = boot({ notification: BlockedNotification, audioContext: undefined });
  click(app, "start-button");
  app.advance(25 * MINUTE + 1);
  app.tick();
  assert.match(app.document.title, /세션 종료/);
});

test("REV-EC02-01 [EC-02, BR-06] hidden tab defers expiry until visibilitychange and reconciles target time without corrupting diary editor", () => {
  const app = boot();
  click(app, "start-button");
  navigate(app, "diary");
  click(app, "diary-new-button");
  typeDiary(app, "백그라운드에서 작성 중이던 일기");
  app.setHidden(true);
  app.advance(26 * MINUTE);
  app.tick();
  assert.equal(timerStatus(app).status, "Running");
  app.returnToTab();
  assert.ok(timerStatus(app).memoPending);
  assert.equal(app.elements.get("diary-body").value, "백그라운드에서 작성 중이던 일기");
  assert.equal(app.elements.get("timer-nav-badge").hidden, false);
});

test("REV-EC03-01 [EC-03, BR-02] multi-session offline expiry completes only once and leaves next session Idle", () => {
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

test("REV-EC03-02 [EC-03, FR-08] offline expired session log is attributed to original endTimestamp date", () => {
  const first = boot();
  click(first, "start-button");
  const expectedDate = first.window.PomodoroTimerCore.localDateKey(START_TIME + 25 * MINUTE);
  const second = boot({ seed: first.snapshot(), now: START_TIME + 48 * 3600 * 1000 });
  const logKey = timerStatus(second).memoPending?.logDate;
  assert.equal(logKey, expectedDate);
});

test("REV-EC04-01 [EC-04, NFR-01, 12.2] wall/performance delta of 5s or more pauses timer at last valid state with resume dialog", () => {
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
  assert.equal(app.elements.get("clock-modal").hidden, true);
});

test("REV-EC04-02 [EC-04, BR-06] clock drift pause does not overwrite in-progress diary editor text", () => {
  const app = boot();
  click(app, "start-button");
  navigate(app, "diary");
  click(app, "diary-new-button");
  typeDiary(app, "시계 변경 중 작성된 글");
  app.advanceWallOnly(10000);
  app.tick();
  assert.equal(app.elements.get("diary-body").value, "시계 변경 중 작성된 글");
});

test("REV-EC05-01 [EC-05, 6.2] storage write failure keeps timer and diary usable in memory with warning banner", () => {
  const app = boot();
  app.storage.failWrites = true;
  click(app, "start-button");
  assert.equal(app.elements.get("status-label").textContent, "진행 중");
  assert.equal(app.elements.get("storage-warning").hidden, false);
  navigate(app, "diary");
  click(app, "diary-new-button");
  typeDiary(app, "저장 실패 상태에서 작성");
  submit(app, "diary-form");
  assert.equal(app.elements.get("diary-entry-list").children.length, 1);
});

test("REV-EC05-02 [EC-05] subsequent successful write clears warning banner and syncs data", () => {
  const app = boot();
  app.storage.failWrites = true;
  click(app, "start-button");
  assert.equal(app.elements.get("storage-warning").hidden, false);
  app.storage.failWrites = false;
  click(app, "start-button"); // Pauses
  assert.equal(timerStatus(app).status, "Paused");
  assert.equal(app.elements.get("storage-warning").hidden, true);
});

test("REV-EC06-01 [EC-06, 12.2] diary body input enforces 5000 character upper bound without data loss", () => {
  const app = boot();
  navigate(app, "diary");
  click(app, "diary-new-button");
  const long5005 = "A".repeat(5005);
  typeDiary(app, long5005);
  assert.equal(app.elements.get("diary-body").value.length, 5000);
  assert.equal(app.elements.get("diary-char-count").textContent, "5000 / 5000");
});

// ==============================================================================
// 4. Non-Functional Requirements (NFR-01 ~ NFR-04)
// ==============================================================================

test("REV-NFR01-01 [NFR-01, 13.3-U3] elapsed interval is computed from wall time without cumulative drift", () => {
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

test("REV-NFR02-01 [NFR-02, 12.1] zero external HTTP/HTTPS requests and completely self-contained", () => {
  assert.equal(/https?:\/\//i.test(SCRIPT), false);
});

test("REV-NFR03-01 [NFR-03, 12.1] standalone single HTML file runs cleanly", () => {
  assert.ok(HTML.startsWith("<!doctype html>"));
  assert.equal((HTML.match(/<html/gi) || []).length, 1);
});

test("REV-NFR04-01 [NFR-04, BR-06] diary input is never overwritten by background timer ticks, session end, or settings updates", () => {
  const app = boot();
  click(app, "start-button");
  navigate(app, "diary");
  click(app, "diary-new-button");
  typeDiary(app, "절대 지워지면 안 되는 소중한 일기 본문");
  app.advance(1000);
  app.tick();
  assert.equal(app.elements.get("diary-body").value, "절대 지워지면 안 되는 소중한 일기 본문");
  navigate(app, "settings");
  app.elements.get("focus-minutes").value = "30";
  submit(app, "settings-form");
  navigate(app, "diary");
  assert.equal(app.elements.get("diary-body").value, "절대 지워지면 안 되는 소중한 일기 본문");
});

// ==============================================================================
// 5. System Acceptance Scenarios (13.2)
// ==============================================================================

test("REV-13.2-01 [13.2 System Acceptance Scenario 1] foreground flow connects start, expiry, memo, break, next Focus, and daily log", () => {
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

test("REV-13.2-02 [13.2 System Acceptance Scenario 2] reconnection recovery processes single expired session and waits for user", () => {
  const first = boot();
  click(first, "start-button");
  const second = boot({ seed: first.snapshot(), now: START_TIME + 2 * 3600 * 1000 });
  assert.equal(timerStatus(second).status, "Idle");
  assert.ok(timerStatus(second).memoPending);
  assert.equal(second.elements.get("timer-controls").hidden, true);
});

test("REV-13.2-03 [13.2 System Acceptance Scenario 3] full diary workflow from creation, save, list lookup, select, edit, to re-save", () => {
  const app = boot();
  navigate(app, "diary");
  click(app, "diary-new-button");
  typeDiary(app, "첫 번째 생각입니다.");
  submit(app, "diary-form");
  assert.equal(storedDiary(app).value.length, 1);
  assert.equal(storedDiary(app).value[0].body, "첫 번째 생각입니다.");

  // Re-select from list
  const itemBtn = app.elements.get("diary-entry-list").children[0].children[0];
  itemBtn.dispatchEvent({ type: "click", preventDefault() {} });
  assert.equal(app.elements.get("diary-body").value, "첫 번째 생각입니다.");

  // Modify and re-save
  typeDiary(app, "첫 번째 생각입니다. 덧붙인 수정 내용입니다.");
  submit(app, "diary-form");
  assert.equal(storedDiary(app).value.length, 1);
  assert.equal(storedDiary(app).value[0].body, "첫 번째 생각입니다. 덧붙인 수정 내용입니다.");
  assert.match(textTree(app.elements.get("diary-entry-list")), /덧붙인 수정 내용/);
});

test("REV-13.2-04 [13.2 System Acceptance Scenario 4] timer running and Focus completion do not interfere with diary typing and badge alerts user", () => {
  const app = boot();
  click(app, "start-button");
  navigate(app, "diary");
  click(app, "diary-new-button");
  typeDiary(app, "타이머 진행 중에 일기를 쓰는 중입니다.");
  app.advance(25 * MINUTE + 1);
  app.tick();
  assert.equal(app.elements.get("diary-body").value, "타이머 진행 중에 일기를 쓰는 중입니다.");
  assert.equal(app.elements.get("timer-nav-badge").hidden, false);
  navigate(app, "timer");
  assert.equal(app.elements.get("memo-panel").hidden, false);
});

// ==============================================================================
// 6. User Acceptance Scenarios (13.3-U1 ~ 13.3-U8)
// ==============================================================================

test("REV-13.3-U1 [13.3 User Acceptance 1] timed daily usage with elapsed times matches log counts and empty memos", () => {
  const app = boot();
  // Session 1: Focus 25 min -> Finish -> Memo save
  click(app, "start-button");
  app.advance(25 * MINUTE + 1);
  app.tick();
  app.elements.get("memo-input").value = "오전 기획서 검토";
  submit(app, "memo-form");

  // Session 2: Short Break 5 min -> auto starts Focus -> Focus 25 min -> Finish -> Skip memo
  app.advance(5 * MINUTE + 1);
  app.tick();
  app.advance(25 * MINUTE + 1);
  app.tick();
  click(app, "memo-skip-button");

  navigate(app, "log");
  assert.equal(app.elements.get("log-count").textContent, "2");
  const entries = listTexts(app);
  assert.equal(entries[0], "오전 기획서 검토");
  assert.equal(entries[1], "메모 없음");
});

test("REV-13.3-U2 [13.3 User Acceptance 2] reload boundary preserves active timer, custom settings, daily logs, and diary entries", () => {
  const first = boot();
  navigate(first, "settings");
  first.elements.get("focus-minutes").value = "50";
  first.elements.get("short-break-minutes").value = "10";
  first.elements.get("long-break-minutes").value = "30";
  submit(first, "settings-form");
  navigate(first, "diary");
  click(first, "diary-new-button");
  typeDiary(first, "보존되어야 할 일기");
  submit(first, "diary-form");
  navigate(first, "timer");
  click(first, "start-button");
  first.advance(10 * MINUTE);
  first.tick();
  first.unload();

  const second = boot({ seed: first.snapshot(), now: START_TIME + 10 * MINUTE + 1000 });
  assert.equal(timerStatus(second).status, "Running");
  assert.equal(second.elements.get("focus-duration-label").textContent, "50분");
  navigate(second, "diary");
  assert.equal(storedDiary(second).value[0].body, "보존되어야 할 일기");
});

test("REV-13.3-U3 [13.3 User Acceptance 3] long timer execution over hours retains exact remaining time matching elapsed wall time", () => {
  const app = boot();
  navigate(app, "settings");
  app.elements.get("focus-minutes").value = "120";
  submit(app, "settings-form");
  navigate(app, "timer");
  click(app, "start-button");
  app.advance(50 * MINUTE);
  app.tick();
  assert.equal(app.elements.get("time-display").textContent, "70:00");
  app.advance(35 * MINUTE);
  app.tick();
  assert.equal(app.elements.get("time-display").textContent, "35:00");
});

test("REV-13.3-U4 [13.3 User Acceptance 4] arbitrary system clock shift pauses timer and requests user confirmation without time jump", () => {
  const app = boot();
  click(app, "start-button");
  app.advance(10 * MINUTE);
  app.tick();
  assert.equal(app.elements.get("time-display").textContent, "15:00");
  // Clock moves forward 30 minutes abruptly
  app.advanceWallOnly(30 * MINUTE);
  app.tick();
  assert.equal(timerStatus(app).status, "Paused");
  assert.equal(app.elements.get("time-display").textContent, "15:00");
  assert.equal(app.elements.get("clock-modal").hidden, false);
  click(app, "clock-resume-button");
  assert.equal(timerStatus(app).status, "Running");
});

test("REV-13.3-U5 [13.3 User Acceptance 5] storage quota error notifies user via banner while app remains fully operational", () => {
  const app = boot();
  app.storage.failWrites = true;
  click(app, "start-button");
  assert.equal(app.elements.get("storage-warning").hidden, false);
  app.advance(5 * MINUTE);
  app.tick();
  assert.equal(app.elements.get("time-display").textContent, "20:00");
  navigate(app, "diary");
  click(app, "diary-new-button");
  typeDiary(app, "쓰기 실패 상태에서도 입력 가능");
  submit(app, "diary-form");
  assert.equal(app.elements.get("diary-entry-list").children.length, 1);
});

test("REV-13.3-U6 [13.3 User Acceptance 6] multi-day multi-entry diary workflow allows browsing and viewing in descending order", () => {
  const seeded = {
    "pomodoro-timer.diary.v1": JSON.stringify([
      { id: "d1", date: "2026-08-23", body: "3일 전 기록", createdAt: START_TIME - 2 * 86400 * 1000, updatedAt: START_TIME - 2 * 86400 * 1000 },
      { id: "d2", date: "2026-08-24", body: "어제 기록", createdAt: START_TIME - 86400 * 1000, updatedAt: START_TIME - 86400 * 1000 },
      { id: "d3", date: "2026-08-25", body: "오늘 아침 기록", createdAt: START_TIME + 1000, updatedAt: START_TIME + 1000 },
      { id: "d4", date: "2026-08-25", body: "오늘 저녁 기록", createdAt: START_TIME + 3600 * 1000, updatedAt: START_TIME + 3600 * 1000 }
    ])
  };
  const app = boot({ seed: seeded });
  navigate(app, "diary");
  const list = app.elements.get("diary-entry-list").children;
  assert.equal(list.length, 4);
  assert.match(textTree(list[0]), /오늘 저녁 기록/);
  assert.match(textTree(list[1]), /오늘 아침 기록/);
  assert.match(textTree(list[2]), /어제 기록/);
  assert.match(textTree(list[3]), /3일 전 기록/);
});

test("REV-13.3-U7 [13.3 User Acceptance 7] closing/reloading app while writing diary recovers draft and indicates unsaved state", () => {
  const first = boot();
  navigate(first, "diary");
  click(first, "diary-new-button");
  typeDiary(first, "퇴근 전 급하게 적다 만 일기 내용");
  first.advance(900);
  first.unload();

  const second = boot({ seed: first.snapshot(), now: START_TIME + 86400 * 1000 });
  navigate(second, "diary");
  assert.equal(second.elements.get("diary-body").value, "퇴근 전 급하게 적다 만 일기 내용");
  assert.equal(second.elements.get("diary-unsaved-badge").hidden, false);
});

test("REV-13.3-U8 [13.3 User Acceptance 8] running timer alongside diary writing preserves text and alerts session completion", () => {
  const app = boot();
  click(app, "start-button");
  navigate(app, "diary");
  click(app, "diary-new-button");
  typeDiary(app, "집중 세션 동안 일기를 쓰고 있습니다.");
  app.advance(10 * MINUTE);
  app.tick();
  assert.equal(app.elements.get("diary-body").value, "집중 세션 동안 일기를 쓰고 있습니다.");
  app.advance(15 * MINUTE + 1);
  app.tick();
  assert.equal(app.elements.get("diary-body").value, "집중 세션 동안 일기를 쓰고 있습니다.");
  assert.equal(app.elements.get("timer-nav-badge").hidden, false);
  submit(app, "diary-form");
  navigate(app, "timer");
  assert.equal(app.elements.get("memo-panel").hidden, false);
  app.elements.get("memo-input").value = "일기 작성 세션 완료";
  submit(app, "memo-form");
  assert.equal(app.elements.get("timer-nav-badge").hidden, true);
});
