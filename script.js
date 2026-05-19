// Cross-session cache for currency rates to make conversions instant on reload
let ratesCache = JSON.parse(localStorage.getItem('ratesCache')) || {};
const CACHE_DURATION_MS = 60 * 60 * 1000; // 1 hour

// Initializing currency dropdowns and form events once the DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    const fromSelect = document.getElementById('from');
    const toSelect = document.getElementById('to');
    const form = document.getElementById('currency-conversion');
    const resultElement = document.getElementById('result');
    const status = document.getElementById('status');
    const amountHint = document.getElementById('amount-hint');
    const swapBtn = document.getElementById('swap');
    const quickBtns = document.querySelectorAll('.quick-btn');
    const copyBtn = document.getElementById('copy-btn');
    const amountInput = document.getElementById('amount');
    const themeToggle = document.getElementById('theme-toggle');
    const iconSun = document.getElementById('icon-sun');
    const iconMoon = document.getElementById('icon-moon');

    // Theme initialization
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark' || (!savedTheme && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
        document.documentElement.setAttribute('data-theme', 'dark');
        if (iconSun && iconMoon) {
            iconSun.classList.remove('hidden');
            iconMoon.classList.add('hidden');
        }
    }

    if (themeToggle) {
        themeToggle.addEventListener('click', () => {
            const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
            if (!isDark) document.documentElement.setAttribute('data-theme', 'dark');
            else document.documentElement.removeAttribute('data-theme');
            localStorage.setItem('theme', isDark ? 'light' : 'dark');
            if (isDark) {
                iconSun.classList.add('hidden');
                iconMoon.classList.remove('hidden');
            } else {
                iconSun.classList.remove('hidden');
                iconMoon.classList.add('hidden');
            }
        });
    }

    // Tabs & live elements
    const tabConverter = document.getElementById('tab-converter');
    const tabLive = document.getElementById('tab-live');
    const converterSection = document.getElementById('converter-section');
    const liveSection = document.getElementById('live-section');
    const liveBase = document.getElementById('live-base');
    const liveTableBody = document.querySelector('#rates-table tbody');
    const liveStatus = document.getElementById('live-status');
    const liveUpdated = document.getElementById('live-updated');
    const liveSearch = document.getElementById('live-search');
    let liveIntervalId = null;
    let lastRates = null; // remember last fetched rates to detect changes
    const CHANGE_EPSILON = 0.00001; // higher sensitivity for tiny moves
    const FETCH_INTERVAL_MS = 10000; // Speed increased to 10s to avoid rate limiting

    // Fetch available currencies and populate dropdowns (defaults from USD)
    status.textContent = 'Loading currencies…';
    async function loadCurrencies() {
        try {
            const resp = await fetch('https://api.exchangerate-api.com/v4/latest/USD');
            if (!resp.ok) throw new Error(`HTTP error! status: ${resp.status}`);
            const data = await resp.json();
            const currencies = Object.keys(data.rates);
            
            // Cache the initial USD fetch for instant first conversions
            ratesCache['USD'] = { timestamp: Date.now(), data: data };
            localStorage.setItem('ratesCache', JSON.stringify(ratesCache));
            
            // Helper to get beautiful currency labels (e.g. "🇺🇸 USD - US Dollar")
            function getCurrencyLabel(code) {
                try {
                    let countryCode = code.slice(0, 2);
                    if (code === 'EUR') countryCode = 'EU'; // Euro special case
                    
                    const flag = countryCode.toUpperCase().replace(/./g, char => 
                        String.fromCodePoint(char.charCodeAt(0) + 127397)
                    );
                    
                    const nameFormatter = new Intl.DisplayNames([navigator.language], { type: 'currency' });
                    const fullName = nameFormatter.of(code);
                    
                    return `${flag} ${code} - ${fullName}`;
                } catch (e) {
                    return code; // Fallback
                }
            }

            const fromFragment = document.createDocumentFragment();
            const toFragment = document.createDocumentFragment();
            const baseFragment = document.createDocumentFragment();

            currencies.forEach(curr => {
                const label = getCurrencyLabel(curr);
                fromFragment.appendChild(new Option(label, curr));
                toFragment.appendChild(new Option(label, curr));
                if (liveBase) baseFragment.appendChild(new Option(label, curr));
            });

            fromSelect.innerHTML = '';
            toSelect.innerHTML = '';
            fromSelect.appendChild(fromFragment);
            toSelect.appendChild(toFragment);

            if (liveBase) {
                liveBase.innerHTML = '';
                liveBase.appendChild(baseFragment);
            }

            fromSelect.value = localStorage.getItem('fromCurrency') || 'USD';
            toSelect.value = localStorage.getItem('toCurrency') || 'INR';
            if (liveBase) liveBase.value = localStorage.getItem('liveBase') || 'USD';
            status.textContent = '';
        } catch (err) {
            fromSelect.innerHTML = '<option value="USD">USD</option><option value="INR">INR</option>';
            toSelect.innerHTML = '<option value="USD">USD</option><option value="INR">INR</option>';
            if (liveBase) liveBase.innerHTML = '<option value="USD">USD</option>';
            status.textContent = 'Could not load currencies – defaults shown';
            console.error('Failed to load', err);
        }
    }
    loadCurrencies();

    // Debounce function to prevent API spam while typing
    function debounce(func, delay) {
        let timeoutId;
        return function(...args) {
            clearTimeout(timeoutId);
            timeoutId = setTimeout(() => func.apply(this, args), delay);
        };
    }
    const debouncedConvert = debounce(convert, 500);

    // Auto-convert on input
    amountInput.addEventListener('input', debouncedConvert);

    // Save preferences and auto-convert on select change
    fromSelect.addEventListener('change', () => {
        localStorage.setItem('fromCurrency', fromSelect.value);
        convert();
    });
    toSelect.addEventListener('change', () => {
        localStorage.setItem('toCurrency', toSelect.value);
        convert();
    });

    form.addEventListener('submit', function(e) {
        e.preventDefault();
        convert();
    });

    // Swap the selected currencies and save preference
    if (swapBtn) {
        swapBtn.addEventListener('click', () => {
            swapBtn.classList.toggle('swapped'); // Trigger rotation animation
            [fromSelect.value, toSelect.value] = [toSelect.value, fromSelect.value];
            localStorage.setItem('fromCurrency', fromSelect.value);
            localStorage.setItem('toCurrency', toSelect.value);
            convert();
        });
    }

    // Quick amount buttons logic
    quickBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const currentVal = parseFloat(amountInput.value) || 0;
            const addVal = parseFloat(btn.getAttribute('data-val'));
            amountInput.value = currentVal + addVal;
            // Auto-trigger conversion
            if (fromSelect.value && toSelect.value) convert();
        });
    });

    // Power-user Keyboard Shortcuts
    document.addEventListener('keydown', (e) => {
        // Ignore shortcuts if the user is typing in an input field
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
        
        const key = e.key.toLowerCase();
        if (key === 'a') {
            e.preventDefault();
            if (amountInput) amountInput.focus();
        } else if (key === 's') {
            e.preventDefault();
            if (swapBtn) swapBtn.click();
        } else if (key === '/') {
            e.preventDefault();
            showLive();
            if (liveSearch) setTimeout(() => liveSearch.focus(), 50);
        }
    });

    // Copy to clipboard logic
    const iconCopy = document.getElementById('icon-copy');
    const iconCheck = document.getElementById('icon-check');
    const toast = document.getElementById('toast');
    
    function showToast(message) {
        if (!toast) return;
        toast.textContent = message;
        toast.classList.remove('hidden');
        // Small delay to allow display:block to apply before animating opacity
        requestAnimationFrame(() => {
            toast.classList.add('show');
        });
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.classList.add('hidden'), 400); // Wait for transition
        }, 2000);
    }

    if (copyBtn) {
        copyBtn.addEventListener('click', () => {
            const text = resultElement.textContent;
            if (text && text !== '—' && text !== 'Currency not supported' && text !== 'Conversion failed') {
                navigator.clipboard.writeText(text).then(() => {
                    iconCopy.classList.add('hidden');
                    iconCheck.classList.remove('hidden');
                    showToast('Copied to clipboard');
                    setTimeout(() => {
                        iconCopy.classList.remove('hidden');
                        iconCheck.classList.add('hidden');
                    }, 2000);
                });
            }
        });
    }

    // Tabs wiring
    function showConverter() {
        tabConverter.classList.add('active');
        tabLive.classList.remove('active');
        tabConverter.setAttribute('aria-selected', 'true');
        tabLive.setAttribute('aria-selected', 'false');
        converterSection.classList.remove('hidden');
        liveSection.classList.add('hidden');
        // Keep live updates running in the background
    }

    function showLive() {
        tabLive.classList.add('active');
        tabConverter.classList.remove('active');
        tabLive.setAttribute('aria-selected', 'true');
        tabConverter.setAttribute('aria-selected', 'false');
        liveSection.classList.remove('hidden');
        converterSection.classList.add('hidden');
        startLive();
    }

    if (tabConverter && tabLive) {
        tabConverter.addEventListener('click', showConverter);
        tabLive.addEventListener('click', showLive);
    }

    // Live rates logic
    function renderRatesTable(rates) {
        if (!liveTableBody) return;
        
        const fragment = document.createDocumentFragment();
        const query = liveSearch ? liveSearch.value.toUpperCase() : '';
        let hasVisibleRows = false;
        
        // Show a subset of popular currencies at the top
        const popular = ['USD','EUR','GBP','INR','JPY','AUD','CAD','CHF','CNY','SGD'];
        const ordered = [...new Set([...popular, ...Object.keys(rates)])];
        ordered.forEach(code => {
            if (!rates[code]) return;
            
            // Filter out non-matching rows if a search query exists
            if (query && !code.includes(query)) return;
            
            hasVisibleRows = true;
            const tr = document.createElement('tr');
            const tdCode = document.createElement('td');
            const tdRate = document.createElement('td');
            tdCode.textContent = code;
            const value = rates[code];
            tdRate.textContent = value.toFixed(5);
            if (lastRates && lastRates[code] !== undefined) {
                const prev = lastRates[code];
                const diff = value - prev;
                if (Math.abs(diff) >= CHANGE_EPSILON) {
                    let indicator = null;
                    // Clear previous persistent state before applying new
                    tdRate.classList.remove('rate-up-persist','rate-down-persist','flash-up','flash-down');
                    if (diff > 0) {
                        tdRate.classList.add('rate-up-persist','flash-up');
                        indicator = document.createElement('span');
                        indicator.className = 'change-indicator';
                        indicator.textContent = '▲';
                    } else if (diff < 0) {
                        tdRate.classList.add('rate-down-persist','flash-down');
                        indicator = document.createElement('span');
                        indicator.className = 'change-indicator';
                        indicator.textContent = '▼';
                    }
                    if (indicator) {
                        tdRate.appendChild(indicator);
                        // keep arrow and persistent color; only clear flash background after a moment
                        setTimeout(() => {
                            tdRate.classList.remove('flash-up', 'flash-down');
                        }, 900);
                    }
                }
            }
            tr.appendChild(tdCode);
            tr.appendChild(tdRate);
            fragment.appendChild(tr);
        });

        // Show an empty state if nothing matches the search
        if (!hasVisibleRows && query) {
            const tr = document.createElement('tr');
            const td = document.createElement('td');
            td.colSpan = 2;
            td.textContent = `No currencies found matching "${query}"`;
            td.style.textAlign = 'center';
            td.style.color = 'var(--text-secondary)';
            tr.appendChild(td);
            fragment.appendChild(tr);
        }
        
        liveTableBody.innerHTML = '';
        liveTableBody.appendChild(fragment);
        // snapshot for next comparison
        lastRates = { ...rates };
    }

    // Instantly filter the table as the user types
    if (liveSearch) {
        liveSearch.addEventListener('input', () => {
            if (lastRates) renderRatesTable(lastRates);
        });
    }

    async function fetchLive() {
        if (!liveBase) return;
        const base = liveBase.value || 'USD';
        liveStatus.textContent = 'Refreshing…';
        try {
            const resp = await fetch(`https://api.exchangerate-api.com/v4/latest/${base}`);
            if (!resp.ok) throw new Error(`HTTP error! status: ${resp.status}`);
            const data = await resp.json();
            ratesCache[base] = { timestamp: Date.now(), data: data };
            localStorage.setItem('ratesCache', JSON.stringify(ratesCache));
            renderRatesTable(data.rates || {});
            const dt = new Date();
            liveUpdated.textContent = `Updated ${dt.toLocaleTimeString()}`;
            liveStatus.textContent = '';
        } catch (err) {
            liveStatus.textContent = 'Failed to load live rates';
            console.error(err);
        }
    }

    function startLive() {
        if (liveIntervalId) return;
        fetchLive();
        // Adjusted cadence to prevent rate limiting, while keeping a "live" feel
        liveIntervalId = setInterval(fetchLive, FETCH_INTERVAL_MS);
        if (liveBase) liveBase.addEventListener('change', () => {
            localStorage.setItem('liveBase', liveBase.value);
            fetchLive();
        });
    }

    function stopLive() {
        if (liveIntervalId) {
            clearInterval(liveIntervalId);
            liveIntervalId = null;
        }
        if (liveBase) liveBase.removeEventListener('change', fetchLive);
    }

    // Default to Converter tab visible, but keep live running continuously
    showConverter();
    startLive();

    // Network Status & Offline Support
    function updateNetworkStatus() {
        const isOnline = navigator.onLine;
        const convertBtn = document.getElementById('convert-btn');
        
        if (isOnline) {
            showToast('Back online! Live rates restored.');
            if (convertBtn) convertBtn.disabled = false;
            startLive();
        } else {
            showToast('Offline Mode. Using cached rates.');
            if (convertBtn) convertBtn.disabled = false; // Works offline thanks to SW!
            stopLive();
        }
    }
    window.addEventListener('online', updateNetworkStatus);
    window.addEventListener('offline', updateNetworkStatus);

    // PWA Service Worker Registration
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('sw.js')
                .catch(err => console.error('Service Worker registration failed:', err));
        });
    }
});

// Convert the entered amount using the selected currency pair
async function convert() {
    const amount = parseFloat(document.getElementById('amount').value);
    const from = document.getElementById('from').value;
    const to = document.getElementById('to').value;
    const resultElement = document.getElementById('result');
    const status = document.getElementById('status');
    const amountHint = document.getElementById('amount-hint');
    const inverseRateElement = document.getElementById('inverse-rate');
    const resultContainer = document.getElementById('result-container');

    if (isNaN(amount) || amount <= 0) {
        amountHint.textContent = 'Enter a positive number';
        resultElement.textContent = '';
        if (inverseRateElement) inverseRateElement.textContent = '';
        return;
    }
    amountHint.textContent = '';
    status.textContent = 'Converting…';

    try {
        let data;
        const now = Date.now();
        
        if (ratesCache[from] && (now - ratesCache[from].timestamp < CACHE_DURATION_MS)) {
            data = ratesCache[from].data;
        } else {
            const resp = await fetch(`https://api.exchangerate-api.com/v4/latest/${from}`);
            if (!resp.ok) throw new Error(`HTTP error! status: ${resp.status}`);
            data = await resp.json();
            ratesCache[from] = { timestamp: now, data };
            localStorage.setItem('ratesCache', JSON.stringify(ratesCache));
        }
        
        const conversionRate = data.rates[to];
        if (!conversionRate) {
            resultElement.textContent = 'Currency not supported';
            return;
        }
        
        // Use browser's Intl API for correct global currency formatting (e.g. €100.00 vs $100.00)
        const convertedAmount = amount * conversionRate;
        const formatter = new Intl.NumberFormat(navigator.language, {
            style: 'currency',
            currency: to
        });
        resultElement.textContent = formatter.format(convertedAmount);
        
        // Calculate and display inverse rate
        if (inverseRateElement) {
            const inverse = 1 / conversionRate;
            const inverseFormatter = new Intl.NumberFormat(navigator.language, {
                style: 'currency',
                currency: from,
                maximumFractionDigits: 4
            });
            inverseRateElement.textContent = `1 ${to} = ${inverseFormatter.format(inverse)}`;
        }
        
        // Trigger pulse animation for visual feedback
        resultContainer.classList.remove('pulse-anim');
        void resultContainer.offsetWidth; // Trigger reflow to restart animation
        resultContainer.classList.add('pulse-anim');
        
        status.textContent = '';
    } catch (err) {
        resultElement.textContent = 'Conversion failed';
        if (inverseRateElement) inverseRateElement.textContent = '';
        status.textContent = '';
        console.error(err);
    }
}