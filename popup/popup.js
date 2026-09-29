// Popup: model onboarding (availability + user-triggered download), ON/OFF toggle, stats, settings.
import {
  getSettings, saveSettings, clampThreshold, modelOptions, summarizerOptions, chromeVersion, MIN_CHROME,
} from '../src/settings.js';

const $ = (id) => document.getElementById(id);
const fmt = (n) => Number(n || 0).toLocaleString('fr-FR');

const HARDWARE_TEXT = 'Ton matériel ne passe pas. Il faut Windows 10/11, macOS 13+, Linux ou un Chromebook Plus, '
  + '22 Go libres, et un GPU avec plus de 4 Go de VRAM (ou 16 Go de RAM et 4 cœurs).';

let pollTimer = null;
let downloading = false;

// ------------------------------------------------------------ model status

const DOWNLOAD_LABEL = 'Télécharger Gemini Nano (~4 Go, une seule fois)';

function renderModel(state, text, { download = false, progress = null, label = DOWNLOAD_LABEL } = {}) {
  $('model').dataset.state = state;
  $('model-text').textContent = text;
  $('download').hidden = !download;
  $('download').textContent = label;
  $('download').disabled = false;
  $('progress').hidden = progress === null;
  if (progress !== null) $('progress').value = progress;
}

async function availability(lang) {
  if (typeof LanguageModel !== 'undefined') return { api: 'prompt', av: await LanguageModel.availability(modelOptions(lang)) };
  if (typeof Summarizer !== 'undefined') return { api: 'summarizer', av: await Summarizer.availability(summarizerOptions(lang)) };
  return { api: null, av: null };
}

async function refreshModel() {
  if (downloading) return;
  const version = chromeVersion();
  const { outputLang } = await getSettings();
  let res;
  try {
    res = await availability(outputLang);
  } catch (e) {
    return renderModel('error', `Impossible de vérifier le modèle : ${e?.message || e}`);
  }
  clearInterval(pollTimer);
  pollTimer = null;

  if (!res.api || (version && version < MIN_CHROME)) {
    return renderModel('old', `Chrome trop ancien (min ${MIN_CHROME}) ou IA intégrée indisponible sur ce navigateur.`);
  }
  switch (res.av) {
    case 'available':
      await chrome.storage.local.set({ modelReadyAt: Date.now() });
      return renderModel('ready', 'Gemini Nano prêt.');
    case 'downloadable':
      return renderModel('downloadable', 'Modèle à télécharger (~4 Go).', { download: true });
    case 'downloading':
      pollTimer = setInterval(refreshModel, 3000);
      return renderModel('downloading', 'Téléchargement en cours…', { download: true, label: 'Suivre la progression' });
    default:
      return renderModel('unavailable', HARDWARE_TEXT);
  }
}

// create() needs a user gesture when the model is not on disk yet: this runs from the button click.
async function download() {
  if (downloading) return;
  downloading = true;
  $('download').disabled = true;
  renderModel('downloading', 'Téléchargement 0 %', { progress: 0 });
  const { outputLang } = await getSettings();
  const monitor = (m) => m.addEventListener('downloadprogress', (e) => {
    const pct = Math.round((e.total ? e.loaded / e.total : e.loaded) * 100);
    renderModel('downloading', `Téléchargement ${pct} %`, { progress: pct });
  });
  try {
    const session = typeof LanguageModel !== 'undefined'
      ? await LanguageModel.create({ ...modelOptions(outputLang), monitor })
      : await Summarizer.create({ ...summarizerOptions(outputLang), monitor });
    session.destroy();
    downloading = false;
    await refreshModel();
  } catch (e) {
    downloading = false;
    renderModel('error', `Échec du téléchargement : ${e?.message || e}`, { download: true });
  }
}

// ------------------------------------------------------------ stats

async function refreshStats() {
  const s = await chrome.storage.local.get(['stats.posts', 'stats.words']);
  const words = s['stats.words'] || 0;
  $('stat-posts').textContent = fmt(s['stats.posts']);
  $('stat-words').textContent = fmt(words);
  $('stat-minutes').textContent = fmt(Math.round(words / 200));
}

// ------------------------------------------------------------ settings
// Changes are broadcast to LinkedIn tabs through chrome.storage.onChanged (no `tabs` permission needed).

async function initSettings() {
  const s = await getSettings();
  $('enabled').checked = s.enabled;
  $('lang').value = s.outputLang;
  $('threshold').value = s.threshold;
  document.querySelector(`input[name="tone"][value="${s.tone}"]`).checked = true;

  $('enabled').addEventListener('change', (e) => chrome.storage.local.set({ enabled: e.target.checked }));
  $('lang').addEventListener('change', async (e) => {
    await saveSettings({ outputLang: e.target.value });
    refreshModel();
  });
  $('threshold').addEventListener('change', (e) => {
    const v = clampThreshold(e.target.value);
    e.target.value = v;
    saveSettings({ threshold: v });
  });
  for (const r of document.querySelectorAll('input[name="tone"]')) {
    r.addEventListener('change', (e) => saveSettings({ tone: e.target.value }));
  }
  $('clear-cache').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      await chrome.runtime.sendMessage({ type: 'CLEAR_CACHE' });
      await chrome.storage.local.set({ cacheClearedAt: Date.now() });
      btn.textContent = 'Cache vidé';
    } catch {
      btn.textContent = 'Échec, réessaie';
    }
    setTimeout(() => {
      btn.textContent = 'Vider le cache';
      btn.disabled = false;
    }, 1500);
  });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes['stats.posts'] || changes['stats.words'])) refreshStats();
});

$('download').addEventListener('click', download);
initSettings();
refreshStats();
refreshModel();
