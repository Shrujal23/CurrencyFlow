const CACHE_MS = 5 * 60 * 1000;
const CACHE_KEY = 'ratesCache_v3';
const LIVE_TAB_TICK_MS = 4 * 1000;
const LIVE_AUTO_FETCH_MS = 30 * 1000;
const PREV_RATES_KEY = 'prevRatesByBase';
const RATE_EPS = 1e-5;
const POPULAR = ['USD', 'EUR', 'GBP', 'INR', 'JPY', 'AUD', 'CAD', 'CHF', 'CNY', 'SGD'];
const FLAG_MAP = {
  EUR: 'EU', USD: 'US', JPY: 'JP', GBP: 'GB', AUD: 'AU',
  CAD: 'CA', CHF: 'CH', CNY: 'CN', INR: 'IN', SGD: 'SG',
};

let ratesCache = {};
try {
  ratesCache = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
} catch {
  ratesCache = {};
}

async function fetchRatesJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API ${res.status}`);
  const json = await res.json();
  const rates = json.conversion_rates || json.rates;
  if (!rates || json.result === 'error') {
    throw new Error(json['error-type'] || 'Bad response');
  }

  let updated = json.time_last_update_utc || null;
  if (!updated && json.timestamp != null) {
    updated = new Date(Number(json.timestamp) * 1000).toUTCString();
  }

  return {
    rates,
    base: json.base_code || json.base || '',
    updated,
  };
}

/** Primary: hourly snapshot (browser-friendly CORS). Fallbacks: keyed v6, then open daily API. */
async function ratesFromExchangerateFun(base) {
  const url = `https://api.exchangerate.fun/latest?base=${encodeURIComponent(base)}`;
  const data = await fetchRatesJson(url);
  if (!data.base) data.base = base;
  return data;
}

async function ratesFromKeyedV6(base) {
  const key = typeof API_KEYS !== 'undefined' && API_KEYS.EXCHANGERATE_API_COM;
  if (!key) throw new Error('No ExchangeRate-API key');
  const url = `https://v6.exchangerate-api.com/v6/${encodeURIComponent(key)}/latest/${encodeURIComponent(base)}`;
  const data = await fetchRatesJson(url);
  if (!data.base) data.base = base;
  return data;
}

async function ratesFromOpenEr(base) {
  const url = `https://open.er-api.com/v6/latest/${encodeURIComponent(base)}`;
  const data = await fetchRatesJson(url);
  if (!data.base) data.base = base;
  return data;
}

async function getRates(base, { force = false } = {}) {
  const now = Date.now();
  const hit = ratesCache[base];
  if (!force && hit && now - hit.timestamp < CACHE_MS) return hit.data;

  const sources = [ratesFromExchangerateFun, ratesFromKeyedV6, ratesFromOpenEr];
  let lastErr;
  for (const load of sources) {
    try {
      const data = await load(base);
      ratesCache[base] = { timestamp: now, data };
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(ratesCache));
      } catch {
        /* storage full / private mode */
      }
      return data;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('All rate sources failed');
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function lsGet(key, fallback = null) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function lsSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

function currencyLabel(code) {
  try {
    const cc = FLAG_MAP[code] || code.slice(0, 2);
    const flag = /^[A-Z]{2}$/.test(cc)
      ? [...cc].map((c) => String.fromCodePoint(c.charCodeAt(0) + 127397)).join('')
      : '🏳️';
    const name = new Intl.DisplayNames([navigator.language], { type: 'currency' }).of(code);
    return `${flag} ${code} - ${name}`;
  } catch {
    return code;
  }
}

function fillSelect(select, codes, selected) {
  const frag = document.createDocumentFragment();
  codes.forEach((c) => frag.appendChild(new Option(currencyLabel(c), c)));
  select.innerHTML = '';
  select.appendChild(frag);
  if (selected && codes.includes(selected)) select.value = selected;
  syncCustomSelect(select);
}

document.addEventListener('DOMContentLoaded', () => {
  const el = (id) => document.getElementById(id);

  const amountInput = el('amount');
  const fromSelect = el('from');
  const toSelect = el('to');
  const form = el('currency-conversion');
  const resultEl = el('result');
  const inverseEl = el('inverse-rate');
  const resultBox = el('result-container');
  const statusEl = el('status');
  const amountHint = el('amount-hint');
  const swapBtn = el('swap');
  const copyBtn = el('copy-btn');
  const iconCopy = el('icon-copy');
  const iconCheck = el('icon-check');
  const toast = el('toast');
  const themeToggle = el('theme-toggle');
  const iconSun = el('icon-sun');
  const iconMoon = el('icon-moon');
  const tabConverter = el('tab-converter');
  const tabLive = el('tab-live');
  const converterSection = el('converter-section');
  const liveSection = el('live-section');
  const liveBase = el('live-base');
  const liveSearch = el('live-search');
  const liveUpdated = el('live-updated');
  const liveStatus = el('live-status');
  const rateLegend = el('rate-legend');
  const liveBody = document.querySelector('#rates-table tbody');
  const freshnessText = document.querySelector('.freshness-text');
  const refreshLiveBtn = el('refresh-live');

  let liveRates = null;
  let livePrev = null;

  function readPrevSnapshot(base) {
    try {
      const all = JSON.parse(localStorage.getItem(PREV_RATES_KEY) || '{}');
      return all[base] || null;
    } catch {
      return null;
    }
  }

  function writePrevSnapshot(base, rates) {
    try {
      const all = JSON.parse(localStorage.getItem(PREV_RATES_KEY) || '{}');
      all[base] = JSON.parse(JSON.stringify(rates));
      localStorage.setItem(PREV_RATES_KEY, JSON.stringify(all));
    } catch {
      /* ignore */
    }
  }

  function setTheme(dark) {
    if (dark) document.documentElement.setAttribute('data-theme', 'dark');
    else document.documentElement.removeAttribute('data-theme');
    iconSun.classList.toggle('hidden', !dark);
    iconMoon.classList.toggle('hidden', dark);
    lsSet('theme', dark ? 'dark' : 'light');
  }

  const savedTheme = lsGet('theme');
  setTheme(
    savedTheme === 'dark' ||
      (!savedTheme && matchMedia('(prefers-color-scheme: dark)').matches)
  );
  themeToggle.addEventListener('click', () => {
    setTheme(document.documentElement.getAttribute('data-theme') !== 'dark');
  });

  let toastTimer;
  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.remove('hidden');
    requestAnimationFrame(() => toast.classList.add('show'));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.classList.add('hidden'), 300);
    }, 2000);
  }

  let liveTabTimer = null;
  let lastLiveAutoFetch = 0;
  let liveFetchInFlight = false;

  function stopLiveTabWatch() {
    if (liveTabTimer) {
      clearInterval(liveTabTimer);
      liveTabTimer = null;
    }
  }

  function pulseLiveUpdated() {
    liveUpdated.classList.remove('is-pulse');
    void liveUpdated.offsetWidth;
    liveUpdated.classList.add('is-pulse');
  }

  function startLiveTabWatch() {
    stopLiveTabWatch();
    lastLiveAutoFetch = Date.now();
    liveTabTimer = setInterval(() => {
      if (liveSection.hidden) return;
      pulseLiveUpdated();
      if (liveFetchInFlight) return;
      if (Date.now() - lastLiveAutoFetch < LIVE_AUTO_FETCH_MS) return;
      lastLiveAutoFetch = Date.now();
      fetchLive({ force: true, auto: true });
    }, LIVE_TAB_TICK_MS);
  }

  function showTab(name) {
    const live = name === 'live';

    tabConverter.classList.toggle('active', !live);
    tabLive.classList.toggle('active', live);
    tabConverter.setAttribute('aria-selected', String(!live));
    tabLive.setAttribute('aria-selected', String(live));

    converterSection.classList.toggle('hidden', live);
    liveSection.classList.toggle('hidden', !live);
    converterSection.toggleAttribute('hidden', live);
    liveSection.toggleAttribute('hidden', !live);

    if (live) {
      fetchLive(false);
      startLiveTabWatch();
    } else {
      stopLiveTabWatch();
    }
  }

  tabConverter.addEventListener('click', () => showTab('converter'));
  tabLive.addEventListener('click', () => showTab('live'));

  statusEl.textContent = 'Loading currencies…';

  async function loadCurrencies() {
    try {
      const { rates } = await getRates('USD');
      const codes = Object.keys(rates).sort();
      fillSelect(fromSelect, codes, lsGet('fromCurrency', 'USD'));
      fillSelect(toSelect, codes, lsGet('toCurrency', 'INR'));
      fillSelect(liveBase, codes, lsGet('liveBase', 'USD'));
      statusEl.textContent = '';
      if (amountInput.value) convert();
    } catch (err) {
      console.error(err);
      const fallback = ['USD', 'EUR', 'GBP', 'INR', 'JPY'];
      fillSelect(fromSelect, fallback, 'USD');
      fillSelect(toSelect, fallback, 'INR');
      fillSelect(liveBase, fallback, 'USD');
      statusEl.textContent = 'Could not load currencies — using defaults';
    }
  }

  async function convert() {
    const amount = parseFloat(amountInput.value);
    const from = fromSelect.value;
    const to = toSelect.value;

    if (!from || !to) return;

    if (isNaN(amount) || amount <= 0) {
      amountHint.textContent = amountInput.value ? 'Enter a positive number' : '';
      resultEl.textContent = '—';
      inverseEl.textContent = '';
      return;
    }

    amountHint.textContent = '';
    statusEl.textContent = 'Converting…';

    try {
      const { rates, updated } = await getRates(from);
      const rate = rates[to];
      if (!rate) {
        resultEl.textContent = 'Currency not supported';
        inverseEl.textContent = '';
        statusEl.textContent = '';
        return;
      }

      resultEl.textContent = new Intl.NumberFormat(navigator.language, {
        style: 'currency',
        currency: to,
      }).format(amount * rate);

      inverseEl.textContent = `1 ${to} = ${new Intl.NumberFormat(navigator.language, {
        style: 'currency',
        currency: from,
        maximumFractionDigits: 4,
      }).format(1 / rate)}`;

      resultBox.classList.remove('pulse-anim');
      void resultBox.offsetWidth; // re-trigger CSS animation
      resultBox.classList.add('pulse-anim');

      if (freshnessText && updated) {
        const d = new Date(updated);
        freshnessText.textContent = `Rates as of ${d.toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })}`;
      }

      statusEl.textContent = '';
    } catch (err) {
      console.error(err);
      resultEl.textContent = 'Conversion failed';
      inverseEl.textContent = '';
      statusEl.textContent = navigator.onLine ? 'API unavailable' : 'Offline — no cached rates';
    }
  }

  const debouncedConvert = debounce(convert, 400);
  amountInput.addEventListener('input', debouncedConvert);
  fromSelect.addEventListener('change', () => {
    lsSet('fromCurrency', fromSelect.value);
    convert();
  });
  toSelect.addEventListener('change', () => {
    lsSet('toCurrency', toSelect.value);
    convert();
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    convert();
  });

  swapBtn.addEventListener('click', () => {
    swapBtn.classList.toggle('swapped');
    [fromSelect.value, toSelect.value] = [toSelect.value, fromSelect.value];
    lsSet('fromCurrency', fromSelect.value);
    lsSet('toCurrency', toSelect.value);
    updateCustomSelectTrigger(fromSelect);
    updateCustomSelectTrigger(toSelect);
    convert();
  });

  document.querySelectorAll('.quick-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const cur = parseFloat(amountInput.value) || 0;
      amountInput.value = cur + parseFloat(btn.dataset.val);
      convert();
    });
  });

  copyBtn.addEventListener('click', async () => {
    const text = resultEl.textContent;
    if (!text || text === '—' || text.includes('failed') || text.includes('supported')) return;
    try {
      await navigator.clipboard.writeText(text);
      iconCopy.classList.add('hidden');
      iconCheck.classList.remove('hidden');
      showToast('Copied to clipboard');
      setTimeout(() => {
        iconCopy.classList.remove('hidden');
        iconCheck.classList.add('hidden');
      }, 1800);
    } catch {
      showToast('Copy failed');
    }
  });

  const svgNs = 'http://www.w3.org/2000/svg';

  function rateTriangle(up) {
    const svg = document.createElementNS(svgNs, 'svg');
    svg.setAttribute('viewBox', '0 0 12 12');
    svg.setAttribute('width', '11');
    svg.setAttribute('height', '11');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(svgNs, 'path');
    path.setAttribute('fill', 'currentColor');
    path.setAttribute(
      'd',
      up ? 'M6 1.5 10.25 9.25H1.75Z' : 'M6 10.5 1.75 2.75h8.5Z'
    );
    svg.appendChild(path);
    return svg;
  }

  function moved(code, value) {
    if (!livePrev || livePrev[code] == null) return null;
    const prev = Number(livePrev[code]);
    const curr = Number(value);
    if (!Number.isFinite(prev) || !Number.isFinite(curr)) return null;
    const diff = curr - prev;
    if (Math.abs(diff) < RATE_EPS) return null;
    return diff > 0 ? 'up' : 'down';
  }

  function addArrow(td, up, prevVal) {
    const prev = Number(prevVal);
    const wrap = document.createElement('span');
    wrap.className = `change-arrow ${up ? 'arrow-up' : 'arrow-down'}`;
    wrap.setAttribute('aria-label', up ? `Rate up from ${prev.toFixed(5)}` : `Rate down from ${prev.toFixed(5)}`);
    wrap.title = up ? `Up from ${prev.toFixed(5)}` : `Down from ${prev.toFixed(5)}`;
    wrap.appendChild(rateTriangle(up));
    td.appendChild(wrap);
  }

  function renderRatesTable() {
    if (!liveBody || !liveRates) return { changed: 0 };
    const q = (liveSearch.value || '').toUpperCase().trim();
    const base = liveBase.value || 'USD';
    const ordered = [...new Set([...POPULAR, ...Object.keys(liveRates)])];
    const frag = document.createDocumentFragment();
    let visible = 0;
    let changed = 0;

    for (const code of ordered) {
      if (code === base || liveRates[code] == null) continue;
      if (q && !code.includes(q)) continue;

      visible++;
      const value = liveRates[code];
      const tr = document.createElement('tr');

      const tdCode = document.createElement('td');
      tdCode.textContent = code;

      const tdRate = document.createElement('td');
      tdRate.className = 'align-end rate-value';
      const num = document.createElement('span');
      num.className = 'rate-num';
      num.textContent = Number(value).toFixed(5);
      tdRate.appendChild(num);

      const dir = moved(code, value);
      if (dir) {
        changed++;
        const up = dir === 'up';
        tdRate.classList.add(up ? 'rate-up' : 'rate-down', up ? 'flash-up' : 'flash-down');
        addArrow(tdRate, up, livePrev[code]);
        setTimeout(() => tdRate.classList.remove('flash-up', 'flash-down'), 900);
      }

      const tdUse = document.createElement('td');
      tdUse.className = 'align-end';
      const useBtn = document.createElement('button');
      useBtn.type = 'button';
      useBtn.className = 'use-btn';
      useBtn.textContent = 'Use';
      useBtn.title = `Convert ${base} → ${code}`;
      useBtn.addEventListener('click', () => {
        fromSelect.value = base;
        toSelect.value = code;
        lsSet('fromCurrency', base);
        lsSet('toCurrency', code);
        updateCustomSelectTrigger(fromSelect);
        updateCustomSelectTrigger(toSelect);
        showTab('converter');
        convert();
      });
      tdUse.appendChild(useBtn);

      tr.append(tdCode, tdRate, tdUse);
      frag.appendChild(tr);
    }

    if (!visible && q) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 3;
      td.className = 'empty-row';
      td.textContent = `No match for "${q}"`;
      tr.appendChild(td);
      frag.appendChild(tr);
    }

    liveBody.replaceChildren(frag);
    return { changed };
  }

  async function fetchLive(options = {}) {
    const force = options === true || options.force;
    const auto = Boolean(options.auto);
    const base = liveBase.value || 'USD';

    if (liveFetchInFlight) return;
    liveFetchInFlight = true;

    if (!auto) {
      liveStatus.textContent = force ? 'Refreshing…' : 'Loading…';
    } else if (force) {
      liveStatus.textContent = 'Checking for updates…';
    }

    try {
      const { rates, updated } = await getRates(base, { force });

      livePrev = readPrevSnapshot(base);
      const hadPrev = !!livePrev;
      liveRates = rates;
      const { changed } = renderRatesTable();

      writePrevSnapshot(base, rates);

      const when = updated ? new Date(updated) : new Date();
      const stamp = when.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
      liveUpdated.textContent = auto
        ? `Live · provider ${stamp} · checked just now`
        : `As of ${stamp}`;

      rateLegend.classList.toggle('hidden', !hadPrev);
      if (!hadPrev) {
        liveStatus.textContent =
          'Saved a snapshot for this base. Come back later or use Fetch latest to compare against it.';
      } else if (changed > 0) {
        liveStatus.textContent = `${changed} ${changed === 1 ? 'rate' : 'rates'} moved since your last visit.`;
      } else if (auto) {
        liveStatus.textContent = 'Watching live — no rate changes since your last snapshot.';
      } else {
        liveStatus.textContent =
          'No change since your last visit (numbers match the saved snapshot). Fetch latest after the API updates.';
      }
    } catch (err) {
      console.error(err);
      liveStatus.textContent = 'Live rates unavailable';
      rateLegend.classList.add('hidden');
    } finally {
      liveFetchInFlight = false;
    }
  }

  liveBase.addEventListener('change', () => {
    lsSet('liveBase', liveBase.value);
    liveRates = null;
    lastLiveAutoFetch = Date.now();
    fetchLive(false);
  });
  liveSearch.addEventListener('input', () => renderRatesTable());
  refreshLiveBtn.addEventListener('click', () => {
    lastLiveAutoFetch = Date.now();
    fetchLive({ force: true });
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopLiveTabWatch();
    else if (!liveSection.hidden) startLiveTabWatch();
  });

  document.addEventListener('keydown', (e) => {
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
    const k = e.key.toLowerCase();
    if (k === 'a') {
      e.preventDefault();
      amountInput.focus();
    } else if (k === 's') {
      e.preventDefault();
      swapBtn.click();
    } else if (k === '/') {
      e.preventDefault();
      showTab('live');
      setTimeout(() => liveSearch.focus(), 40);
    }
  });

  window.addEventListener('online', () => showToast('Back online'));
  window.addEventListener('offline', () => showToast('Offline — using cached rates'));

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('SW:', err));
    });
  }

  attachCustomSelect(fromSelect);
  attachCustomSelect(toSelect);
  attachCustomSelect(liveBase);

  showTab('converter');
  loadCurrencies();
});
