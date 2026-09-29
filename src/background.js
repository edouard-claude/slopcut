// Slopcut service worker: owns the Gemini Nano session, the prompt queue and the summary cache.
import { buildSystemPrompt, buildUserPrompt, postProcess, MAX_INPUT_CHARS, QUOTA_FALLBACK_CHARS } from './prompt.js';
import { getSettings, modelOptions, summarizerOptions, chromeVersion, MIN_CHROME } from './settings.js';

const TAG = '[slopcut]';
const BOOT_ID = crypto.randomUUID();
const QUEUE_MAX = 40;
const PROMPT_TIMEOUT_MS = 15000;
const CACHE_MAX = 500;
const CACHE_FLUSH_MS = 5000;

// Verbose-level logs: visible in the SW console with the "Verbose" level enabled.
const log = (...args) => console.debug(TAG, ...args);

// ---------------------------------------------------------------- model

async function checkAvailability(outputLang) {
  if (typeof LanguageModel !== 'undefined') {
    try {
      return { api: 'prompt', availability: await LanguageModel.availability(modelOptions(outputLang)) };
    } catch (e) {
      log('LanguageModel.availability failed', e);
    }
  }
  // Fallback: same on-device model behind the Summarizer API.
  if (typeof Summarizer !== 'undefined') {
    try {
      return { api: 'summarizer', availability: await Summarizer.availability(summarizerOptions(outputLang)) };
    } catch (e) {
      log('Summarizer.availability failed', e);
    }
  }
  return { api: null, availability: 'unavailable' };
}

let base = null; // { session, api, key, outputLang }

function destroyBase() {
  try { base?.session.destroy(); } catch { /* already gone */ }
  base = null;
}

// Only called from the queue worker, so creation is never concurrent.
async function getBase() {
  const { outputLang, tone } = await getSettings();
  const key = `${outputLang}|${tone}`;
  if (base?.key === key) return base;
  destroyBase();
  const { api, availability } = await checkAvailability(outputLang);
  // Never trigger a download from here: that needs a user gesture in the popup.
  if (availability !== 'available') throw new Error(`model-${availability}`);
  let session;
  if (api === 'prompt') {
    const params = await LanguageModel.params();
    session = await LanguageModel.create({
      ...modelOptions(outputLang),
      initialPrompts: [{ role: 'system', content: buildSystemPrompt(outputLang, tone) }],
      temperature: 0.3,
      topK: params.defaultTopK,
    });
  } else {
    session = await Summarizer.create(summarizerOptions(outputLang));
  }
  base = { session, api, key, outputLang };
  log('base session ready', key, api);
  return base;
}

async function runOnce(b, entry, maxChars) {
  const ctrl = new AbortController();
  entry.ctrl = ctrl;
  const timer = setTimeout(() => ctrl.abort(new DOMException('prompt timeout', 'TimeoutError')), PROMPT_TIMEOUT_MS);
  try {
    if (b.api === 'summarizer') return await b.session.summarize(entry.text.slice(0, maxChars), { signal: ctrl.signal });
    // Fresh clone per post: the base session context never accumulates.
    const s = await b.session.clone({ signal: ctrl.signal });
    try {
      return await s.prompt(buildUserPrompt(b.outputLang, entry.author, entry.text, maxChars), { signal: ctrl.signal });
    } finally {
      s.destroy();
    }
  } finally {
    clearTimeout(timer);
    entry.ctrl = null;
  }
}

// One retry on failure; QuotaExceededError retries with a shorter input.
async function summarize(entry) {
  const b = await getBase();
  let maxChars = MAX_INPUT_CHARS;
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (entry.cancelled) throw new Error('cancelled');
    try {
      log('prompt start', entry.key, `attempt ${attempt + 1}`);
      return postProcess(await runOnce(b, entry, maxChars));
    } catch (e) {
      lastErr = e;
      log('prompt failed', entry.key, e?.name, e?.message);
      if (e?.name === 'QuotaExceededError') maxChars = QUOTA_FALLBACK_CHARS;
    }
  }
  throw lastErr;
}

// ---------------------------------------------------------------- cache (LRU, Map insertion order)

const cache = new Map(); // cacheKey -> { hook, ts }
let flushTimer = null;

const cacheReady = chrome.storage.local.get('cache').then(({ cache: stored }) => {
  const entries = Object.entries(stored || {}).sort((a, b) => a[1].ts - b[1].ts);
  for (const [k, v] of entries) cache.set(k, v);
  log('cache loaded', cache.size);
});

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    chrome.storage.local.set({ cache: Object.fromEntries(cache) }).catch((e) => log('cache flush failed', e));
  }, CACHE_FLUSH_MS);
}

function cacheGet(k) {
  const v = cache.get(k);
  if (!v) return null;
  cache.delete(k);
  cache.set(k, { hook: v.hook, ts: Date.now() });
  scheduleFlush();
  return v.hook;
}

function cacheSet(k, hook) {
  cache.delete(k);
  cache.set(k, { hook, ts: Date.now() });
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  scheduleFlush();
}

async function clearCache() {
  clearTimeout(flushTimer);
  flushTimer = null;
  cache.clear();
  await chrome.storage.local.remove('cache');
  log('cache cleared');
}

// ---------------------------------------------------------------- stats

const countWords = (text) => text.split(/\s+/).filter(Boolean).length;

async function bumpStats(text) {
  const cur = await chrome.storage.local.get(['stats.posts', 'stats.words']);
  await chrome.storage.local.set({
    'stats.posts': (cur['stats.posts'] || 0) + 1,
    'stats.words': (cur['stats.words'] || 0) + countWords(text),
  });
}

// ---------------------------------------------------------------- queue

// Two FIFO levels, index = priority (1 = near viewport). One prompt in flight at a time.
const queues = [[], []];
const pending = new Map(); // cacheKey -> entry (queued or in flight)
let current = null;
let pumping = false;

const queueSize = () => queues[0].length + queues[1].length;

function notify(entry, payload) {
  for (const w of entry.waiters) {
    chrome.tabs.sendMessage(w.tabId, { type: 'SUMMARY', key: w.key, ...payload }, { frameId: w.frameId }).catch(() => {});
  }
}

function removeFromQueue(entry) {
  for (const q of queues) {
    const i = q.indexOf(entry);
    if (i !== -1) q.splice(i, 1);
  }
}

function enforceLimit() {
  while (queueSize() > QUEUE_MAX) {
    const victim = queues[0].shift() ?? queues[1].shift();
    pending.delete(victim.cacheKey);
    log('dropped', victim.key);
    notify(victim, { error: 'dropped' });
  }
}

async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    for (;;) {
      const entry = queues[1].shift() ?? queues[0].shift();
      if (!entry) break;
      current = entry;
      let payload;
      try {
        const hook = await summarize(entry);
        cacheSet(entry.cacheKey, hook);
        await bumpStats(entry.text);
        payload = { hook };
        log('summary', entry.key, hook);
      } catch (e) {
        payload = { error: e?.message === 'empty' ? 'empty' : 'failed' };
      } finally {
        current = null;
        pending.delete(entry.cacheKey);
      }
      if (!entry.cancelled) notify(entry, payload);
    }
  } finally {
    pumping = false;
  }
}

function cancelAll() {
  for (const q of queues) q.length = 0;
  if (current) {
    current.cancelled = true;
    current.ctrl?.abort(new DOMException('cancelled', 'AbortError'));
  }
  pending.clear();
  log('queue cleared');
}

async function cacheKeyFor(key) {
  const { outputLang, tone } = await getSettings();
  return `${key}|${outputLang}|${tone}`;
}

// ---------------------------------------------------------------- handlers

const handlers = {
  async SUMMARIZE(msg, sender) {
    if (!sender.tab || typeof msg.key !== 'string' || typeof msg.text !== 'string') return { error: 'bad-request' };
    const settings = await getSettings();
    if (!settings.enabled) return { error: 'disabled' };
    await cacheReady;
    const cacheKey = await cacheKeyFor(msg.key);
    const hit = cacheGet(cacheKey);
    if (hit) {
      log('cache hit', msg.key);
      return { hook: hit, cached: true };
    }
    const waiter = { tabId: sender.tab.id, frameId: sender.frameId ?? 0, key: msg.key };
    const priority = msg.priority === 1 ? 1 : 0;
    let entry = pending.get(cacheKey);
    if (entry) {
      if (!entry.waiters.some((w) => w.tabId === waiter.tabId && w.key === waiter.key)) entry.waiters.push(waiter);
      if (priority === 1) handlers.PRIORITIZE(msg, sender);
      return { queued: true };
    }
    entry = { cacheKey, key: msg.key, author: String(msg.author || ''), text: msg.text, priority, waiters: [waiter] };
    pending.set(cacheKey, entry);
    queues[priority].push(entry);
    log('enqueue', msg.key, `p${priority}`, `size ${queueSize()}`);
    enforceLimit();
    pump();
    return { queued: true };
  },

  async PRIORITIZE(msg) {
    const entry = pending.get(await cacheKeyFor(msg.key));
    const i = entry ? queues[0].indexOf(entry) : -1;
    if (i !== -1) {
      queues[0].splice(i, 1);
      entry.priority = 1;
      queues[1].push(entry);
      log('prioritize', msg.key);
    }
    return { ok: true };
  },

  // Keepalive from content scripts; also tells which requests this SW instance still knows about.
  async PING(msg, sender) {
    const keys = new Set(Array.isArray(msg.keys) ? msg.keys : []);
    const known = [];
    for (const entry of pending.values()) {
      for (const w of entry.waiters) if (w.tabId === sender.tab?.id && keys.has(w.key)) known.push(w.key);
    }
    return { bootId: BOOT_ID, known };
  },

  // A tab no longer needs these keys (restored, navigated, disabled).
  async CANCEL(msg, sender) {
    const keys = new Set(Array.isArray(msg.keys) ? msg.keys : []);
    for (const entry of [...pending.values()]) {
      entry.waiters = entry.waiters.filter((w) => !(w.tabId === sender.tab?.id && keys.has(w.key)));
      if (!entry.waiters.length && entry !== current) {
        removeFromQueue(entry);
        pending.delete(entry.cacheKey);
      }
    }
    return { ok: true };
  },

  async STATUS() {
    const { outputLang } = await getSettings();
    const { api, availability } = await checkAvailability(outputLang);
    const version = chromeVersion();
    return {
      availability,
      api,
      modelReady: availability === 'available',
      queueSize: queueSize(),
      chromeVersion: version,
      chromeTooOld: version > 0 && version < MIN_CHROME,
      bootId: BOOT_ID,
    };
  },

  async CLEAR_CACHE() {
    await clearCache();
    return { ok: true };
  },
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const handler = handlers[msg?.type];
  if (!handler) return false;
  Promise.resolve()
    .then(() => handler(msg, sender))
    .then(sendResponse, (e) => sendResponse({ error: String(e?.message || e) }));
  return true;
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.enabled && changes.enabled.newValue === false) cancelAll();
  if (changes.settings) {
    const o = changes.settings.oldValue || {};
    const n = changes.settings.newValue || {};
    if (o.outputLang !== n.outputLang || o.tone !== n.tone) destroyBase();
  }
});
