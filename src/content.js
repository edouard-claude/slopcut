// Slopcut content script (classic script): detects LinkedIn post cards and swaps long bodies
// for a one-sentence summary produced by the service worker. Never touches LanguageModel.
(async () => {
  'use strict';

  const TAG = '[slopcut]';
  const SCAN_DEBOUNCE_MS = 150;
  const SCAN_MAX_WAIT_MS = 1000;
  const ROOT_MARGIN = '600px';
  const PING_MS = 20000;
  const LOST_MS = 20000;
  const DIAG_MS = 6000;

  const log = (...args) => console.debug(TAG, ...args);
  const url = (p) => chrome.runtime.getURL(p);

  let SEL, postKey, getSettings, CSS;
  try {
    [SEL, { postKey }, { getSettings }, CSS] = await Promise.all([
      import(url('src/selectors.js')),
      import(url('src/hash.js')),
      import(url('src/settings.js')),
      fetch(url('src/ui.css')).then((r) => r.text()),
    ]);
  } catch (e) {
    console.debug(TAG, 'bootstrap failed', e);
    return;
  }

  let settings = await getSettings();
  let active = false;
  let io = null;
  let mo = null;
  let postSel = null;
  let lastUrl = null;
  let cardsSinceNav = 0;
  let diagTimer = null;
  let scanTimer = null;
  let scanFirstAt = 0;
  let pingTimer = null;

  const cards = new Map();   // card element -> state
  const byKey = new Map();   // key -> Set<state>
  const hooks = new Map();   // key -> hook, instant reuse when LinkedIn re-renders a card
  const pending = new Map(); // key -> { sentAt, resent, priority, author, text }

  const alive = () => Boolean(chrome.runtime?.id);

  async function send(msg) {
    try {
      return await chrome.runtime.sendMessage(msg);
    } catch (e) {
      log('sendMessage failed', msg.type, e?.message);
      return null;
    }
  }

  // ------------------------------------------------------------ DOM helpers

  function injectPageStyle() {
    if (document.getElementById('slopcut-page-style')) return;
    const style = document.createElement('style');
    style.id = 'slopcut-page-style';
    // LinkedIn CSS can override the UA [hidden] rule; this one cannot be overridden.
    style.textContent = '[data-slopcut-hidden]{display:none!important}';
    document.head.append(style);
  }

  function hide(el) {
    el.hidden = true;
    el.setAttribute('data-slopcut-hidden', '');
  }

  function show(el) {
    el.hidden = false;
    el.removeAttribute('data-slopcut-hidden');
  }

  function resolvePostSelector() {
    return SEL.POST_SELECTORS.find((s) => document.querySelector(s)) ?? null;
  }

  function isInComments(el, card) {
    return SEL.COMMENT_SELECTORS.some((s) => {
      const c = el.closest(s);
      return c && card.contains(c);
    });
  }

  function ownedBy(el, card) {
    return el.closest(postSel) === card && !el.closest('[data-slopcut-host]');
  }

  function findText(card) {
    for (const s of SEL.TEXT_SELECTORS) {
      for (const el of card.querySelectorAll(s)) {
        if (ownedBy(el, card) && !isInComments(el, card)) return el;
      }
    }
    return null;
  }

  function findAuthor(card) {
    for (const s of SEL.AUTHOR_SELECTORS) {
      for (const el of card.querySelectorAll(s)) {
        if (!ownedBy(el, card)) continue;
        const name = (el.innerText || el.textContent || '').split('\n')[0].trim();
        if (name) return name;
      }
    }
    return '';
  }

  // Looks for a marker in the card header, i.e. text nodes before the post body.
  function isSponsored(card, textEl) {
    const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
    let n;
    let count = 0;
    while ((n = walker.nextNode()) && count++ < 300) {
      if (textEl?.contains(n)) break;
      const t = n.nodeValue.trim();
      if (!t || t.length > 60) continue;
      for (const m of SEL.SPONSORED_MARKERS) {
        if (t.startsWith(m) && !/[\p{L}\p{N}]/u.test(t.charAt(m.length))) return true;
      }
    }
    return false;
  }

  function normalize(raw) {
    let t = raw
      .replace(/ /g, ' ')
      .replace(/\bhashtag\s*#/gi, '#')
      .replace(/[ \t]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    for (let changed = true; changed;) {
      changed = false;
      const lower = t.toLowerCase();
      for (const label of SEL.SEE_MORE_LABELS) {
        if (lower.endsWith(label)) {
          t = t.slice(0, -label.length).trim();
          changed = true;
          break;
        }
      }
    }
    return t.replace(/(?:\s*#[\p{L}\p{N}_]+)+\s*$/u, '').trim();
  }

  const countWords = (text) => text.split(/\s+/).filter(Boolean).length;

  // ------------------------------------------------------------ UI (Shadow DOM)

  function mountBar(st, where) {
    const host = document.createElement('div');
    host.setAttribute('data-slopcut-host', '');
    const root = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = CSS;
    const bar = document.createElement('div');
    bar.className = 'bar';
    const mark = document.createElement('span');
    mark.className = 'mark';
    mark.setAttribute('aria-hidden', 'true');
    mark.textContent = '✂';
    const label = document.createElement('span');
    label.className = 'label';
    const hook = document.createElement('span');
    hook.className = 'hook';
    const button = document.createElement('button');
    button.type = 'button';
    button.hidden = true;
    bar.append(mark, label, hook, button);
    root.append(style, bar);
    // Keep LinkedIn's card-level click handlers (open post, etc.) out of it.
    bar.addEventListener('click', (e) => e.stopPropagation());
    button.addEventListener('click', () => toggle(st));
    st.host = host;
    st.ui = { bar, label, hook, button };
    where(host);
  }

  function render(st) {
    const { bar, label, hook, button } = st.ui;
    bar.dataset.state = st.status;
    if (st.status === 'loading') {
      label.textContent = '';
      hook.textContent = 'Coupe en cours…';
      button.hidden = true;
      return;
    }
    if (st.status === 'sponsored') {
      label.textContent = '';
      hook.textContent = 'Pub. Coupée.';
      button.textContent = st.expanded ? 'Recouper' : 'Voir quand même';
    } else {
      label.textContent = 'TL;DR';
      hook.textContent = st.hook;
      button.textContent = st.expanded ? 'Recouper' : `Voir le slop (${st.words} mots)`;
    }
    button.hidden = false;
    button.setAttribute('aria-expanded', String(st.expanded));
  }

  function toggle(st) {
    st.expanded = !st.expanded;
    const targets = st.status === 'sponsored' ? st.hiddenChildren : [st.textEl];
    for (const el of targets) (st.expanded ? show : hide)(el);
    render(st);
  }

  // ------------------------------------------------------------ card state

  function index(st) {
    if (!byKey.has(st.key)) byKey.set(st.key, new Set());
    byKey.get(st.key).add(st);
  }

  // Restores the original DOM for one card and forgets it.
  function teardown(st) {
    st.host?.remove();
    if (st.textEl) show(st.textEl);
    for (const el of st.hiddenChildren ?? []) show(el);
    io?.unobserve(st.card);
    byKey.get(st.key)?.delete(st);
    if (byKey.get(st.key)?.size === 0) byKey.delete(st.key);
    st.card.removeAttribute('data-slopcut');
    cards.delete(st.card);
  }

  function setDone(st, hook) {
    st.status = 'done';
    st.hook = hook;
    st.expanded = false;
    hide(st.textEl);
    render(st);
  }

  // Errors never degrade reading: the original simply comes back, no message.
  function setRestored(st, status) {
    st.status = status;
    st.host?.remove();
    st.host = null;
    show(st.textEl);
  }

  function applySponsored(card) {
    const st = { card, key: '', status: 'sponsored', expanded: false, hiddenChildren: [] };
    cards.set(card, st);
    card.setAttribute('data-slopcut', '1');
    mountBar(st, (host) => card.prepend(host));
    hideSponsoredChildren(st);
    render(st);
    log('sponsored card cut');
  }

  function hideSponsoredChildren(st) {
    if (st.expanded) return;
    for (const el of st.card.children) {
      if (el === st.host || el.hidden) continue;
      hide(el);
      st.hiddenChildren.push(el);
    }
  }

  function processCard(card) {
    const prev = cards.get(card);
    if (prev) {
      if (prev.status === 'sponsored') {
        if (!prev.host.isConnected) card.prepend(prev.host);
        hideSponsoredChildren(prev); // React may have rendered fresh children
        return;
      }
      const stale = !prev.textEl.isConnected || (prev.host && !prev.host.isConnected);
      if (!stale) return;
      teardown(prev);
    }

    const textEl = findText(card);
    if (isSponsored(card, textEl)) return applySponsored(card);
    if (!textEl || textEl.textContent.length < settings.threshold) return;
    const text = normalize(textEl.innerText || textEl.textContent);
    if (text.length < settings.threshold) return;

    const author = findAuthor(card);
    const st = {
      card, textEl, author, text,
      key: postKey(author, text),
      words: countWords(text),
      status: 'loading',
      expanded: false,
      requested: false,
    };
    cards.set(card, st);
    card.setAttribute('data-slopcut', '1');
    index(st);
    mountBar(st, (host) => textEl.before(host));
    hide(textEl);

    const memo = hooks.get(st.key);
    if (memo) {
      st.requested = true;
      setDone(st, memo);
      return;
    }
    render(st);
    io.observe(card);
  }

  // ------------------------------------------------------------ requests

  function onIntersect(entries) {
    for (const e of entries) {
      const st = cards.get(e.target);
      if (!st || st.status === 'sponsored') {
        io.unobserve(e.target);
        continue;
      }
      const priority = e.isIntersecting ? 1 : 0;
      if (!st.requested) {
        st.requested = true;
        request(st, priority);
      } else if (priority === 1 && st.status === 'loading') {
        const p = pending.get(st.key);
        if (p && p.priority === 0) {
          p.priority = 1;
          send({ type: 'PRIORITIZE', key: st.key });
        }
      } else if (priority === 1 && st.status === 'dropped') {
        // Dropped while far away; retry now that it is close.
        st.status = 'loading';
        mountBar(st, (host) => st.textEl.before(host));
        hide(st.textEl);
        render(st);
        request(st, 1);
      }
    }
  }

  function request(st, priority) {
    if (pending.has(st.key)) return;
    pending.set(st.key, { sentAt: Date.now(), resent: false, priority, author: st.author, text: st.text });
    if (!pingTimer) pingTimer = setInterval(ping, PING_MS);
    dispatch(st.key);
  }

  async function dispatch(key) {
    const p = pending.get(key);
    if (!p) return;
    const res = await send({ type: 'SUMMARIZE', key, author: p.author, text: p.text, priority: p.priority });
    if (!res) onSummary({ key, error: 'unreachable' });
    else if (res.hook || res.error) onSummary({ key, ...res });
    // { queued: true } -> the answer comes later as a SUMMARY message.
  }

  function onSummary({ key, hook, error, cached }) {
    if (!pending.delete(key) && !hook) return;
    if (hook) {
      hooks.set(key, hook);
      if (cached) log('cache hit', key);
    }
    for (const st of byKey.get(key) ?? []) {
      if (cards.get(st.card) !== st || st.status !== 'loading') continue;
      if (hook) setDone(st, hook);
      else setRestored(st, error === 'dropped' ? 'dropped' : 'error');
    }
    if (!pending.size) stopPing();
  }

  function stopPing() {
    clearInterval(pingTimer);
    pingTimer = null;
  }

  // Keepalive for the SW (stops after 30 s idle) + detection of requests lost in a SW restart.
  async function ping() {
    if (!pending.size) return stopPing();
    const res = await send({ type: 'PING', keys: [...pending.keys()] });
    const known = new Set(res?.known ?? []);
    const now = Date.now();
    for (const [key, p] of [...pending]) {
      if (known.has(key) || now - p.sentAt < LOST_MS) continue;
      if (!p.resent) {
        p.resent = true;
        p.sentAt = now;
        log('request lost, resending', key);
        dispatch(key);
      } else {
        onSummary({ key, error: 'lost' });
      }
    }
  }

  // ------------------------------------------------------------ scanning

  function scheduleScan() {
    const now = Date.now();
    if (!scanTimer) scanFirstAt = now;
    clearTimeout(scanTimer);
    // Debounce, but never starve under continuous mutations.
    const delay = now - scanFirstAt >= SCAN_MAX_WAIT_MS ? 0 : SCAN_DEBOUNCE_MS;
    scanTimer = setTimeout(scan, delay);
  }

  function scan() {
    scanTimer = null;
    if (!active) return;
    if (!alive()) return stop(); // extension reloaded: leave the page as LinkedIn made it
    if (location.href !== lastUrl) onUrlChange();
    if (!postSel || !document.querySelector(postSel)) postSel = resolvePostSelector();
    if (postSel) {
      for (const card of document.querySelectorAll(postSel)) {
        // Top-level cards only: nested list items are comments or reshared posts.
        if (card.parentElement?.closest(postSel)) continue;
        cardsSinceNav++;
        try {
          processCard(card);
        } catch (e) {
          log('card failed', e);
        }
      }
    }
    for (const [card, st] of cards) if (!card.isConnected) teardown(st);
  }

  function onUrlChange() {
    lastUrl = location.href;
    postSel = null;
    cardsSinceNav = 0;
    clearTimeout(diagTimer);
    if (location.pathname.startsWith('/feed')) diagTimer = setTimeout(diagnostic, DIAG_MS);
  }

  // Attribute NAMES only, never content.
  function diagnostic() {
    if (!active || cardsSinceNav > 0) return;
    const root = document.querySelector('main') ?? document.body;
    const names = new Set();
    for (const el of root.querySelectorAll('*')) {
      for (const a of el.getAttributeNames()) if (a.startsWith('data-')) names.add(a);
    }
    console.info(`${TAG} DIAGNOSTIC`, {
      path: location.pathname,
      postSelectorsTried: SEL.POST_SELECTORS,
      dataAttributes: [...names].sort(),
    });
  }

  // ------------------------------------------------------------ lifecycle

  function restoreAll() {
    for (const st of [...cards.values()]) teardown(st);
    byKey.clear();
    if (pending.size && alive()) send({ type: 'CANCEL', keys: [...pending.keys()] });
    pending.clear();
    stopPing();
  }

  let starting = false;
  async function start() {
    if (active || starting || !alive()) return;
    starting = true;
    try {
      settings = await getSettings();
      if (!settings.enabled) return;
      const status = await send({ type: 'STATUS' });
      if (!status?.modelReady) {
        log('inactive, model not ready:', status?.availability);
        return;
      }
      active = true;
      injectPageStyle();
      io = new IntersectionObserver(onIntersect, { rootMargin: ROOT_MARGIN });
      mo = new MutationObserver(scheduleScan);
      mo.observe(document.body, { childList: true, subtree: true });
      lastUrl = null;
      scan();
      log('started');
    } finally {
      starting = false;
    }
  }

  function stop() {
    active = false;
    mo?.disconnect();
    io?.disconnect();
    clearTimeout(scanTimer);
    clearTimeout(diagTimer);
    scanTimer = null;
    restoreAll();
    log('stopped');
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'SUMMARY' && active) onSummary(msg);
  });

  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== 'local' || !alive()) return;
    if (changes.enabled || changes.settings) {
      const prev = settings;
      settings = await getSettings();
      if (!settings.enabled) {
        if (active) stop();
        return;
      }
      if (!active) return start();
      if (prev.outputLang !== settings.outputLang || prev.tone !== settings.tone) hooks.clear();
      if (prev.threshold !== settings.threshold) {
        restoreAll();
        scheduleScan();
      }
    }
    if (changes.cacheClearedAt) hooks.clear();
    if (changes.modelReadyAt && !active) start();
  });

  // SPA navigation: isolated worlds cannot patch the page's history.pushState,
  // so rely on the Navigation API + popstate; scan() also compares location.href.
  window.navigation?.addEventListener('navigatesuccess', scheduleScan);
  window.addEventListener('popstate', scheduleScan);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !active) start();
  });

  start();
})();
