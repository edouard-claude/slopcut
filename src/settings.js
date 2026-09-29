// Shared settings helpers (service worker, content script, popup).
export const SUPPORTED_LANGS = ['fr', 'en', 'es', 'de', 'ja'];
export const TONES = ['sec', 'cynique'];
export const THRESHOLD_MIN = 80;
export const THRESHOLD_MAX = 1000;
export const MIN_CHROME = 138;

export function defaultLang() {
  const l = (navigator.language || 'fr').slice(0, 2).toLowerCase();
  return SUPPORTED_LANGS.includes(l) ? l : 'fr';
}

export function defaults() {
  return { enabled: true, outputLang: defaultLang(), threshold: 220, tone: 'sec' };
}

export async function getSettings() {
  const { enabled, settings } = await chrome.storage.local.get(['enabled', 'settings']);
  const d = defaults();
  const s = { ...d, ...(settings || {}), enabled: enabled ?? d.enabled };
  if (!SUPPORTED_LANGS.includes(s.outputLang)) s.outputLang = d.outputLang;
  if (!TONES.includes(s.tone)) s.tone = d.tone;
  s.threshold = clampThreshold(s.threshold);
  return s;
}

export async function saveSettings(patch) {
  const { settings } = await chrome.storage.local.get('settings');
  await chrome.storage.local.set({ settings: { ...(settings || {}), ...patch } });
}

export function clampThreshold(v) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return 220;
  return Math.min(THRESHOLD_MAX, Math.max(THRESHOLD_MIN, n));
}

export function modelOptions(outputLang) {
  return {
    expectedInputs: [{ type: 'text', languages: SUPPORTED_LANGS }],
    expectedOutputs: [{ type: 'text', languages: [outputLang] }],
  };
}

export function summarizerOptions(outputLang) {
  return {
    type: 'headline',
    format: 'plain-text',
    length: 'short',
    expectedInputLanguages: SUPPORTED_LANGS,
    outputLanguage: outputLang,
  };
}

export function chromeVersion() {
  const m = navigator.userAgent.match(/Chrome\/(\d+)/);
  return m ? Number(m[1]) : 0;
}
