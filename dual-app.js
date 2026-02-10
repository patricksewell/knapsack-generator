// ============================================================
// Dual-Budget Knapsack Generator
// Reuses core logic from app.js but with two budget levels.
// ============================================================

// Seeded PRNG (Mulberry32)
function mulberry32(seed) {
    return function() {
        let t = seed += 0x6D2B79F5;
        t = Math.imul(t ^ t >>> 15, t | 1);
        t ^= t + Math.imul(t ^ t >>> 7, t | 61);
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

function hashSeed(seed) {
    if (typeof seed === 'number') return Math.floor(seed);
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
        const char = seed.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return Math.abs(hash);
}

function boxMuller(rng) {
    const u1 = rng();
    const u2 = rng();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

// Distribution samplers — integer
function sampleUniformInt(rng, min, max) { return Math.floor(rng() * (max - min + 1)) + min; }
function sampleNormalInt(rng, mean, sd) { let v; do { v = Math.round(mean + sd * boxMuller(rng)); } while (v <= 0); return v; }
function sampleLognormalInt(rng, mu, sigma) { let v; do { v = Math.round(Math.exp(mu + sigma * boxMuller(rng))); } while (v <= 0); return v; }

// Distribution samplers — continuous
function sampleUniformCont(rng, min, max) { return Math.max(0.01, parseFloat((min + rng() * (max - min)).toFixed(2))); }
function sampleNormalCont(rng, mean, sd) { let v; do { v = mean + sd * boxMuller(rng); } while (v <= 0); return parseFloat(v.toFixed(2)); }
function sampleLognormalCont(rng, mu, sigma) { return parseFloat(Math.max(0.01, Math.exp(mu + sigma * boxMuller(rng))).toFixed(2)); }

function getSampler(distType, params, isInt) {
    if (isInt) {
        switch (distType) {
            case 'uniform': return (rng) => sampleUniformInt(rng, params.min, params.max);
            case 'normal':  return (rng) => sampleNormalInt(rng, params.mean, params.sd);
            case 'lognormal': return (rng) => sampleLognormalInt(rng, params.mu, params.sigma);
        }
    } else {
        switch (distType) {
            case 'uniform': return (rng) => sampleUniformCont(rng, params.min, params.max);
            case 'normal':  return (rng) => sampleNormalCont(rng, params.mean, params.sd);
            case 'lognormal': return (rng) => sampleLognormalCont(rng, params.mu, params.sigma);
        }
    }
}

function distName(type, isInt) {
    const base = { 'uniform': 'Uniform', 'normal': 'Normal', 'lognormal': 'Lognormal' };
    return base[type] + (isInt ? 'Int' : '');
}

const CORRELATION_NAMES = { 'independent': 'Independent', 'positive': 'PositiveLinear', 'negative': 'NegativeLinear' };

// Generate items (identical to main generator)
function generateItems(config, seedStr) {
    const rng = mulberry32(hashSeed(seedStr));
    const weightSampler = getSampler(config.weightDist, config.weightParams, config.weightInt);
    const valueSampler = getSampler(config.valueDist, config.valueParams, config.valueInt);

    const items = [];
    let maxWeight = 0;

    for (let i = 0; i < config.nItems; i++) {
        const weight = weightSampler(rng);
        items.push({ id: i + 1, weight, value: 0 });
        maxWeight = Math.max(maxWeight, weight);
    }

    for (let i = 0; i < config.nItems; i++) {
        let value;
        if (config.correlation === 'independent') {
            value = valueSampler(rng);
        } else if (config.correlation === 'positive') {
            value = config.alpha * items[i].weight + config.noiseSd * boxMuller(rng);
            value = config.valueInt ? Math.round(value) : parseFloat(value.toFixed(2));
        } else if (config.correlation === 'negative') {
            value = config.alpha * (maxWeight - items[i].weight) + config.noiseSd * boxMuller(rng);
            value = config.valueInt ? Math.round(value) : parseFloat(value.toFixed(2));
        }
        items[i].value = Math.max(config.valueInt ? 1 : 0.01, value);
    }

    // Ratio spread
    if (config.ratioSpread !== 'medium') {
        const lambda = config.ratioSpread === 'low' ? 0.3 : 2.0;
        const ratios = items.map(it => it.value / it.weight);
        const meanR = ratios.reduce((a, b) => a + b, 0) / ratios.length;
        for (let i = 0; i < items.length; i++) {
            const nr = Math.max(0.01, meanR + lambda * (ratios[i] - meanR));
            let nv = nr * items[i].weight;
            items[i].value = config.valueInt ? Math.max(1, Math.round(nv)) : Math.max(0.01, parseFloat(nv.toFixed(2)));
        }
    }

    // Integer ratios
    if (config.integerRatios) {
        for (let i = 0; i < items.length; i++) {
            const ratio = Math.max(1, Math.round(items[i].value / items[i].weight));
            items[i].value = ratio * items[i].weight;
        }
    }

    return items;
}

// DP knapsack solver
function solveKnapsack(items, capacity) {
    const n = items.length;
    const dp = Array.from({ length: n + 1 }, () => new Int32Array(capacity + 1));

    for (let i = 1; i <= n; i++) {
        const w = items[i - 1].weight;
        const v = items[i - 1].value;
        for (let c = 0; c <= capacity; c++) {
            dp[i][c] = dp[i - 1][c];
            if (w <= c && dp[i - 1][c - w] + v > dp[i][c]) {
                dp[i][c] = dp[i - 1][c - w] + v;
            }
        }
    }

    const selected = [];
    let c = capacity;
    for (let i = n; i >= 1; i--) {
        if (dp[i][c] !== dp[i - 1][c]) {
            selected.push(items[i - 1]);
            c -= items[i - 1].weight;
        }
    }
    selected.reverse();

    return {
        value: dp[n][capacity],
        weight: selected.reduce((s, it) => s + it.weight, 0),
        count: selected.length,
        items: selected
    };
}

// Sahni-k
function computeSahniK(items, capacity, optimalValue) {
    const n = items.length;
    const sortedIndices = items.map((_, i) => i).sort((a, b) =>
        (items[b].value / items[b].weight) - (items[a].value / items[a].weight)
    );

    function greedyFill(forced, remCap) {
        let val = 0;
        for (const idx of sortedIndices) {
            if (forced.has(idx)) continue;
            if (items[idx].weight <= remCap) { val += items[idx].value; remCap -= items[idx].weight; }
        }
        return val;
    }

    if (greedyFill(new Set(), capacity) >= optimalValue) return 0;

    for (let k = 1; k <= Math.min(n, 6); k++) {
        const subset = new Array(k);
        let found = false;
        function enumerate(depth, start) {
            if (found) return;
            if (depth === k) {
                const forced = new Set(subset);
                let fw = 0, fv = 0;
                for (const idx of subset) { fw += items[idx].weight; fv += items[idx].value; }
                if (fw > capacity) return;
                if (fv + greedyFill(forced, capacity - fw) >= optimalValue) found = true;
                return;
            }
            for (let i = start; i < n; i++) { subset[depth] = i; enumerate(depth + 1, i + 1); if (found) return; }
        }
        enumerate(0, 0);
        if (found) return k;
    }
    return '> 6';
}

// ============================================================
// DOM & UI
// ============================================================

const el = {
    nItems: document.getElementById('n_items'),
    budgetLow: document.getElementById('budget_low'),
    budgetHigh: document.getElementById('budget_high'),
    seed: document.getElementById('seed'),
    weightDist: document.getElementById('weight_dist'),
    valueDist: document.getElementById('value_dist'),
    correlation: document.getElementById('correlation'),
    weightInt: document.getElementById('weight_int'),
    valueInt: document.getElementById('value_int'),
    weightMin: document.getElementById('weight_min'),
    weightMax: document.getElementById('weight_max'),
    weightMean: document.getElementById('weight_mean'),
    weightSd: document.getElementById('weight_sd'),
    weightMu: document.getElementById('weight_mu'),
    weightSigma: document.getElementById('weight_sigma'),
    valueMin: document.getElementById('value_min'),
    valueMax: document.getElementById('value_max'),
    valueMean: document.getElementById('value_mean'),
    valueSd: document.getElementById('value_sd'),
    valueMu: document.getElementById('value_mu'),
    valueSigma: document.getElementById('value_sigma'),
    alpha: document.getElementById('alpha'),
    noiseSd: document.getElementById('noise_sd'),
    ratioSpread: document.getElementById('ratio_spread'),
    integerRatios: document.getElementById('integer_ratios'),
    optimalSizeLow: document.getElementById('optimal_size_low'),
    optimalSizeHigh: document.getElementById('optimal_size_high'),
    sahniKLow: document.getElementById('sahni_k_low'),
    sahniKHigh: document.getElementById('sahni_k_high'),
    generateBtn: document.getElementById('generate_btn'),
    downloadJsonBtn: document.getElementById('download_json_btn'),
    copyJsonBtn: document.getElementById('copy_json_btn'),
    outputSection: document.getElementById('output_section'),
    statsGrid: document.getElementById('stats_grid'),
    optimalLow: document.getElementById('optimal_low'),
    optimalHigh: document.getElementById('optimal_high'),
    previewBody: document.getElementById('preview_body'),
    weightParams: document.getElementById('weight_params'),
    valueParams: document.getElementById('value_params'),
    correlationParams: document.getElementById('correlation_params')
};

let currentResult = null;

function updateDistParams(selectId, paramsContainerId) {
    const dist = document.getElementById(selectId).value;
    const container = document.getElementById(paramsContainerId);
    container.querySelectorAll('.param-group').forEach(g => g.classList.add('hidden'));
    container.querySelector(`.${dist}-params`).classList.remove('hidden');
}

function updateCorrelationParams() {
    const corr = el.correlation.value;
    const corrDiv = el.correlationParams.querySelector('.correlation-params');
    const vDistG = el.valueDist.closest('.form-group');
    const vParamsG = el.valueParams;
    if (corr === 'independent') { corrDiv.classList.add('hidden'); vDistG.classList.remove('hidden'); vParamsG.classList.remove('hidden'); }
    else { corrDiv.classList.remove('hidden'); vDistG.classList.add('hidden'); vParamsG.classList.add('hidden'); }
}

function getConfig() {
    const weightDist = el.weightDist.value;
    const valueDist = el.valueDist.value;
    let weightParams, valueParams;

    switch (weightDist) {
        case 'uniform': weightParams = { min: parseInt(el.weightMin.value), max: parseInt(el.weightMax.value) }; break;
        case 'normal': weightParams = { mean: parseFloat(el.weightMean.value), sd: parseFloat(el.weightSd.value) }; break;
        case 'lognormal': weightParams = { mu: parseFloat(el.weightMu.value), sigma: parseFloat(el.weightSigma.value) }; break;
    }
    switch (valueDist) {
        case 'uniform': valueParams = { min: parseInt(el.valueMin.value), max: parseInt(el.valueMax.value) }; break;
        case 'normal': valueParams = { mean: parseFloat(el.valueMean.value), sd: parseFloat(el.valueSd.value) }; break;
        case 'lognormal': valueParams = { mu: parseFloat(el.valueMu.value), sigma: parseFloat(el.valueSigma.value) }; break;
    }

    return {
        nItems: parseInt(el.nItems.value),
        budgetLow: parseInt(el.budgetLow.value),
        budgetHigh: parseInt(el.budgetHigh.value),
        seed: el.seed.value,
        weightDist, weightParams, weightInt: el.weightInt.checked,
        valueDist, valueParams, valueInt: el.valueInt.checked,
        correlation: el.correlation.value,
        alpha: parseFloat(el.alpha.value),
        noiseSd: parseFloat(el.noiseSd.value),
        ratioSpread: el.ratioSpread.value,
        integerRatios: el.integerRatios.checked,
        optimalSizeLow: el.optimalSizeLow.value,
        optimalSizeHigh: el.optimalSizeHigh.value,
        sahniKLow: el.sahniKLow.value,
        sahniKHigh: el.sahniKHigh.value
    };
}

function renderOptimalPanel(container, optimal, sahniK, budget) {
    const INLINE_LIMIT = 8;
    const itemChips = optimal.items.map(it =>
        `<span class="item-chip">${it.id} <small>(${it.weight},${it.value})</small></span>`
    ).join(' ');
    const isLong = optimal.items.length > INLINE_LIMIT;

    const stats = [
        { label: 'Budget', value: budget },
        { label: 'Items Selected', value: optimal.count },
        { label: 'Total Price', value: optimal.weight },
        { label: 'Total Value', value: optimal.value },
        { label: 'Sahni-k', value: sahniK, title: 'Minimum k for Sahni\'s algorithm.' }
    ];

    let html = stats.map(s => `
        <div class="stat-card optimal" ${s.title ? `title="${s.title}"` : ''}>
            <div class="label">${s.label}</div>
            <div class="value">${s.value}</div>
        </div>
    `).join('');

    if (isLong) {
        html += `
            <div class="stat-card optimal items-card" style="grid-column: 1 / -1;">
                <div class="label">Selected Items</div>
                <button class="expand-btn" onclick="this.parentElement.classList.toggle('expanded'); this.textContent = this.parentElement.classList.contains('expanded') ? 'Collapse' : 'Show ${optimal.count} items';">Show ${optimal.count} items</button>
                <div class="items-list collapsed">${itemChips}</div>
            </div>`;
    } else {
        html += `
            <div class="stat-card optimal items-card" style="grid-column: 1 / -1;">
                <div class="label">Selected Items</div>
                <div class="items-list">${itemChips}</div>
            </div>`;
    }

    container.innerHTML = html;
}

// Populate optimal-size dropdowns based on current n_items
function updateOptimalSizeOptions() {
    const n = parseInt(el.nItems.value) || 1;
    [el.optimalSizeLow, el.optimalSizeHigh].forEach(select => {
        const current = select.value;
        select.innerHTML = '<option value="random">Random</option>';
        for (let i = 1; i < n; i++) {
            select.innerHTML += `<option value="${i}"${current === String(i) ? ' selected' : ''}>${i}</option>`;
        }
    });
}

// Check whether a single budget's solution matches its constraints
function checkConstraints(items, budget, targetOptSize, targetSahniK) {
    const sol = solveKnapsack(items, budget);
    if (targetOptSize !== 'random' && sol.count !== parseInt(targetOptSize)) return null;
    let sahniK = null;
    if (targetSahniK !== 'random') {
        sahniK = computeSahniK(items, budget, sol.value);
        if (sahniK !== parseInt(targetSahniK)) return null;
    }
    return { sol, sahniK };
}

function generate() {
    const config = getConfig();
    if (config.budgetLow > config.budgetHigh) {
        alert('Low Budget must be ≤ High Budget.');
        return;
    }

    el.generateBtn.textContent = 'Generating…';
    el.generateBtn.disabled = true;

    const hasTargets = config.optimalSizeLow !== 'random' || config.sahniKLow !== 'random'
                    || config.optimalSizeHigh !== 'random' || config.sahniKHigh !== 'random';
    const MAX_ATTEMPTS = 10000;
    const baseSeed = config.seed;

    setTimeout(() => {
        let items, bLow, bHigh, optLow, optHigh, sahniLow, sahniHigh;
        let usedSeed = baseSeed;
        let warning = null;
        let found = false;

        for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
            usedSeed = attempt === 0 ? baseSeed : baseSeed + '_' + attempt;
            items = generateItems(config, usedSeed);
            const sumWeights = items.reduce((s, it) => s + it.weight, 0);

            bLow = Math.max(1, Math.min(config.budgetLow, sumWeights - 1));
            bHigh = Math.max(1, Math.min(config.budgetHigh, sumWeights - 1));

            // Check low-budget constraints
            const lowResult = checkConstraints(items, bLow, config.optimalSizeLow, config.sahniKLow);
            if (!lowResult) continue;

            // Check high-budget constraints
            const highResult = checkConstraints(items, bHigh, config.optimalSizeHigh, config.sahniKHigh);
            if (!highResult) continue;

            // All constraints satisfied
            optLow = lowResult.sol;
            optHigh = highResult.sol;
            sahniLow = lowResult.sahniK;
            sahniHigh = highResult.sahniK;
            found = true;
            break;
        }

        if (!found) {
            // Fallback: use base seed, solve without constraints
            usedSeed = baseSeed;
            items = generateItems(config, usedSeed);
            const sumWeights = items.reduce((s, it) => s + it.weight, 0);
            bLow = Math.max(1, Math.min(config.budgetLow, sumWeights - 1));
            bHigh = Math.max(1, Math.min(config.budgetHigh, sumWeights - 1));
            optLow = solveKnapsack(items, bLow);
            optHigh = solveKnapsack(items, bHigh);
            sahniLow = null; sahniHigh = null;

            const constraints = [];
            if (config.optimalSizeLow !== 'random') constraints.push(`low optimal = ${config.optimalSizeLow} items`);
            if (config.sahniKLow !== 'random') constraints.push(`low Sahni-k = ${config.sahniKLow}`);
            if (config.optimalSizeHigh !== 'random') constraints.push(`high optimal = ${config.optimalSizeHigh} items`);
            if (config.sahniKHigh !== 'random') constraints.push(`high Sahni-k = ${config.sahniKHigh}`);
            const suggestions = ['try a different seed', 'relax some constraints', 'change distribution parameters'];
            warning = `Could not satisfy constraints (${constraints.join(', ')}) after ${MAX_ATTEMPTS} attempts. Showing result for base seed. Try to: ${suggestions.join('; ')}.`;
        }

        // Compute Sahni-k if not already done
        if (sahniLow === null) sahniLow = computeSahniK(items, bLow, optLow.value);
        if (sahniHigh === null) sahniHigh = computeSahniK(items, bHigh, optHigh.value);
        if (!optLow) optLow = solveKnapsack(items, bLow);
        if (!optHigh) optHigh = solveKnapsack(items, bHigh);

        const sumWeights = items.reduce((s, it) => s + it.weight, 0);
        const sumValues = items.reduce((s, it) => s + it.value, 0);

        // Summary stats
        let statsHtml = [
            { label: 'Sum of Prices', value: sumWeights },
            { label: 'Sum of Values', value: sumValues }
        ].map(s => `<div class="stat-card"><div class="label">${s.label}</div><div class="value">${s.value}</div></div>`).join('');

        if (usedSeed !== baseSeed) {
            statsHtml += `<div class="stat-card" title="Seed was adjusted to satisfy constraints."><div class="label">Seed Used</div><div class="value">${usedSeed}</div></div>`;
        }

        if (warning) {
            statsHtml += `<div class="stat-card warning" style="grid-column: 1 / -1;"><div class="warning-text">⚠️ ${warning}</div></div>`;
        }

        el.statsGrid.innerHTML = statsHtml;

        renderOptimalPanel(el.optimalLow, optLow, sahniLow, bLow);
        renderOptimalPanel(el.optimalHigh, optHigh, sahniHigh, bHigh);

        // Preview table with dual highlighting
        const lowIds = new Set(optLow.items.map(it => it.id));
        const highIds = new Set(optHigh.items.map(it => it.id));

        const previewItems = items.slice(0, 25);
        el.previewBody.innerHTML = previewItems.map(item => {
            const inLow = lowIds.has(item.id);
            const inHigh = highIds.has(item.id);
            let cls = '';
            if (inLow && inHigh) cls = ' class="optimal-both"';
            else if (inLow) cls = ' class="optimal-low"';
            else if (inHigh) cls = ' class="optimal-high"';
            return `<tr${cls}><td>${item.id}</td><td>${item.weight}</td><td>${item.value}</td><td>${(item.value / item.weight).toFixed(2)}</td></tr>`;
        }).join('');

        // Store for export
        currentResult = {
            problem: '0/1 knapsack (dual budget)',
            n_items: config.nItems,
            seed: usedSeed,
            seed_requested: baseSeed,
            budget_low: bLow,
            budget_high: bHigh,
            target_optimal_size_low: config.optimalSizeLow,
            target_optimal_size_high: config.optimalSizeHigh,
            target_sahni_k_low: config.sahniKLow,
            target_sahni_k_high: config.sahniKHigh,
            price_dist: { name: distName(config.weightDist, config.weightInt), params: config.weightParams },
            value_dist: config.correlation === 'independent' ? { name: distName(config.valueDist, config.valueInt), params: config.valueParams } : null,
            correlation: { mode: CORRELATION_NAMES[config.correlation], alpha: config.correlation !== 'independent' ? config.alpha : null, noise_sd: config.correlation !== 'independent' ? config.noiseSd : null },
            ratio_spread: config.ratioSpread,
            integer_ratios: config.integerRatios,
            optimal_low: { budget: bLow, value: optLow.value, weight: optLow.weight, count: optLow.count, sahni_k: sahniLow, item_ids: optLow.items.map(it => it.id) },
            optimal_high: { budget: bHigh, value: optHigh.value, weight: optHigh.weight, count: optHigh.count, sahni_k: sahniHigh, item_ids: optHigh.items.map(it => it.id) },
            items
        };

        if (warning) currentResult.warning = warning;

        el.outputSection.classList.remove('hidden');
        el.downloadJsonBtn.disabled = false;
        el.copyJsonBtn.disabled = false;
        el.generateBtn.textContent = 'Generate';
        el.generateBtn.disabled = false;
    }, 10);
}

function downloadJSON() {
    if (!currentResult) return;
    const json = JSON.stringify(currentResult, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `knapsack_dual_${currentResult.seed}.json`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function copyJSON() {
    if (!currentResult) return;
    const json = JSON.stringify(currentResult, null, 2);
    const btn = el.copyJsonBtn;
    const orig = btn.textContent;
    function ok() { btn.textContent = 'Copied!'; setTimeout(() => { btn.textContent = orig; }, 1500); }
    function fail() { btn.textContent = 'Failed'; setTimeout(() => { btn.textContent = orig; }, 1500); }

    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(json).then(ok).catch(() => { fallbackCopy(json) ? ok() : fail(); });
    } else {
        fallbackCopy(json) ? ok() : fail();
    }
}

function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.left = '-9999px';
    document.body.appendChild(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(ta);
    return ok;
}

// Event listeners
el.weightDist.addEventListener('change', () => updateDistParams('weight_dist', 'weight_params'));
el.valueDist.addEventListener('change', () => updateDistParams('value_dist', 'value_params'));
el.correlation.addEventListener('change', updateCorrelationParams);
el.nItems.addEventListener('input', updateOptimalSizeOptions);
el.generateBtn.addEventListener('click', generate);
el.downloadJsonBtn.addEventListener('click', downloadJSON);
el.copyJsonBtn.addEventListener('click', copyJSON);

// Init
el.downloadJsonBtn.disabled = true;
el.copyJsonBtn.disabled = true;
updateDistParams('weight_dist', 'weight_params');
updateDistParams('value_dist', 'value_params');
updateCorrelationParams();
updateOptimalSizeOptions();
