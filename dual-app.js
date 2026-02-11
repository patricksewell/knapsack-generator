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

// Greedy knapsack: sort by value/weight ratio descending, pack greedily
function greedyValue(items, capacity) {
    const sorted = items.slice().sort((a, b) => (b.value / b.weight) - (a.value / a.weight));
    let remCap = capacity;
    let totalValue = 0;
    for (const item of sorted) {
        if (item.weight <= remCap) {
            totalValue += item.value;
            remCap -= item.weight;
        }
    }
    return totalValue;
}

// Count feasible subsets and near-optimal subsets (brute-force bitmask, n<=20)
function countBundleStats(items, capacity, optValue, alphaPercent) {
    if (alphaPercent === undefined) alphaPercent = 90;
    const n = items.length;
    const threshold = alphaPercent * optValue;
    let feasible = 0, n90 = 0;
    const total = 1 << n;
    for (let mask = 1; mask < total; mask++) {
        let w = 0, v = 0;
        for (let i = 0; i < n; i++) {
            if (mask & (1 << i)) {
                w += items[i].weight;
                v += items[i].value;
            }
        }
        if (w <= capacity) {
            feasible++;
            if (v * 100 >= threshold) n90++;
        }
    }
    return { feasible, n90 };
}

// ============================================================
// DOM & UI
// ============================================================

const el = {
    nItems: document.getElementById('n_items'),
    budgetLowMin: document.getElementById('budget_low_min'),
    budgetLowMax: document.getElementById('budget_low_max'),
    budgetHighMin: document.getElementById('budget_high_min'),
    budgetHighMax: document.getElementById('budget_high_max'),
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
    greedyCapSelect: document.getElementById('greedyCapSelect'),
    forgivenessCapSelect: document.getElementById('forgivenessCapSelect'),
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
        budgetLowMin: parseInt(el.budgetLowMin.value),
        budgetLowMax: parseInt(el.budgetLowMax.value),
        budgetHighMin: parseInt(el.budgetHighMin.value),
        budgetHighMax: parseInt(el.budgetHighMax.value),
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
        sahniKHigh: el.sahniKHigh.value,
        greedyCap: el.greedyCapSelect.value,
        forgivenessCap: el.forgivenessCapSelect.value
    };
}

function renderOptimalPanel(container, optimal, sahniK, budget, greedyRatio, n90, feasibleCount) {
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

    if (greedyRatio !== null && greedyRatio !== undefined) {
        stats.push({ label: 'Greedy Performance', value: `${(greedyRatio * 100).toFixed(1)}%`, title: 'Greedy solution value as % of optimal.' });
    }
    if (feasibleCount !== null && feasibleCount !== undefined) {
        stats.push({ label: 'Feasible Combinations', value: feasibleCount.toLocaleString(), title: 'Total item subsets fitting within this budget.' });
    }
    if (n90 !== null && n90 !== undefined) {
        const shareStr = feasibleCount > 0 ? ` (${(n90 / feasibleCount * 100).toFixed(1)}%)` : '';
        stats.push({ label: 'N90 (Forgiveness)', value: `${n90}${shareStr}`, title: 'Feasible subsets achieving \u2265 90% of optimal, and their share of all feasible combinations.' });
    }

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
        select.innerHTML = '<option value="no_filter">No filter</option>';
        for (let i = 1; i < n; i++) {
            select.innerHTML += `<option value="${i}"${current === String(i) ? ' selected' : ''}>${i}</option>`;
        }
    });
}

// Find a valid capacity within [lo, hi] that satisfies optimal size + Sahni-k targets.
// Returns { capacity, sol, sahniK } or null.
function findCapacityInRange(items, budgetMin, budgetMax, targetOptSize, targetSahniK) {
    const sumWeights = items.reduce((s, it) => s + it.weight, 0);
    const lo = Math.max(1, budgetMin);
    const hi = Math.min(budgetMax, sumWeights - 1);
    if (lo > hi) return null;

    // Collect candidate capacities
    let candidates = [];

    if (targetOptSize === 'no_filter') {
        if (targetSahniK === 'no_filter') {
            // No constraints: pick midpoint
            const cap = Math.round((lo + hi) / 2);
            const sol = solveKnapsack(items, cap);
            return { capacity: cap, sol, sahniK: null };
        }
        // Only Sahni-k targeted: scan all capacities
        for (let c = lo; c <= hi; c++) candidates.push(c);
    } else {
        // Scan for capacities that give the target optimal count
        const target = parseInt(targetOptSize);
        for (let c = lo; c <= hi; c++) {
            const sol = solveKnapsack(items, c);
            if (sol.count === target) candidates.push(c);
        }
    }

    if (candidates.length === 0) return null;

    // If no Sahni-k target, take the middle candidate
    if (targetSahniK === 'no_filter') {
        const cap = candidates[Math.floor(candidates.length / 2)];
        const sol = solveKnapsack(items, cap);
        return { capacity: cap, sol, sahniK: null };
    }

    // Check Sahni-k for each candidate capacity
    const targetK = parseInt(targetSahniK);
    for (const c of candidates) {
        const sol = solveKnapsack(items, c);
        const k = computeSahniK(items, c, sol.value);
        if (k === targetK) {
            return { capacity: c, sol, sahniK: k };
        }
    }

    return null;
}

function generate() {
    const config = getConfig();
    if (config.budgetLowMin > config.budgetLowMax) {
        alert('Low Budget Min must be ≤ Low Budget Max.');
        return;
    }
    if (config.budgetHighMin > config.budgetHighMax) {
        alert('High Budget Min must be ≤ High Budget Max.');
        return;
    }

    el.generateBtn.textContent = 'Generating…';
    el.generateBtn.disabled = true;

    const MAX_ATTEMPTS = 10000;
    const baseSeed = config.seed;

    const greedyActive = config.greedyCap !== 'no_filter';
    const greedyThreshold = greedyActive ? parseFloat(config.greedyCap) : 1;
    const forgivenessActive = config.forgivenessCap !== 'no_filter';
    const forgivenessShare = forgivenessActive ? parseFloat(config.forgivenessCap) : Infinity;
    const canBruteForceN90 = config.nItems <= 20;

    setTimeout(() => {
        let items, bLow, bHigh, optLow, optHigh, sahniLow, sahniHigh;
        let greedyRatioLow = null, greedyRatioHigh = null, n90Low = null, n90High = null;
        let feasibleLow = null, feasibleHigh = null;
        let usedSeed = baseSeed;
        let warning = null;
        let found = false;

        for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
            usedSeed = attempt === 0 ? baseSeed : baseSeed + '_' + attempt;
            items = generateItems(config, usedSeed);

            // Find a valid capacity in the low budget range
            const lowResult = findCapacityInRange(
                items, config.budgetLowMin, config.budgetLowMax,
                config.optimalSizeLow, config.sahniKLow
            );
            if (!lowResult) continue;

            // Find a valid capacity in the high budget range
            const highResult = findCapacityInRange(
                items, config.budgetHighMin, config.budgetHighMax,
                config.optimalSizeHigh, config.sahniKHigh
            );
            if (!highResult) continue;

            const capLow = lowResult.capacity;
            const capHigh = highResult.capacity;
            const solLow = lowResult.sol || solveKnapsack(items, capLow);
            const solHigh = highResult.sol || solveKnapsack(items, capHigh);

            // Greedy constraint — check BOTH budgets
            if (greedyActive) {
                const gLow = solLow.value > 0 ? greedyValue(items, capLow) / solLow.value : 0;
                const gHigh = solHigh.value > 0 ? greedyValue(items, capHigh) / solHigh.value : 0;
                if (gLow >= greedyThreshold || gHigh >= greedyThreshold) continue;
            }

            // Forgiveness constraint (N90 share) — check BOTH budgets
            if (forgivenessActive && canBruteForceN90) {
                const bsL = countBundleStats(items, capLow, solLow.value, 90);
                const bsH = countBundleStats(items, capHigh, solHigh.value, 90);
                const shareLow = bsL.feasible > 0 ? bsL.n90 / bsL.feasible : 0;
                const shareHigh = bsH.feasible > 0 ? bsH.n90 / bsH.feasible : 0;
                if (shareLow > forgivenessShare || shareHigh > forgivenessShare) continue;
            }

            // Both satisfied
            bLow = capLow;
            bHigh = capHigh;
            optLow = solLow;
            optHigh = solHigh;
            sahniLow = lowResult.sahniK;
            sahniHigh = highResult.sahniK;
            found = true;
            break;
        }

        if (!found) {
            // Fallback: use base seed, pick midpoints
            usedSeed = baseSeed;
            items = generateItems(config, usedSeed);
            const sumWeights = items.reduce((s, it) => s + it.weight, 0);
            bLow = Math.max(1, Math.min(Math.round((config.budgetLowMin + config.budgetLowMax) / 2), sumWeights - 1));
            bHigh = Math.max(1, Math.min(Math.round((config.budgetHighMin + config.budgetHighMax) / 2), sumWeights - 1));
            optLow = solveKnapsack(items, bLow);
            optHigh = solveKnapsack(items, bHigh);
            sahniLow = null;
            sahniHigh = null;

            const constraints = [];
            if (config.optimalSizeLow !== 'no_filter') constraints.push(`low optimal = ${config.optimalSizeLow} items`);
            if (config.sahniKLow !== 'no_filter') constraints.push(`low Sahni-k = ${config.sahniKLow}`);
            if (config.optimalSizeHigh !== 'no_filter') constraints.push(`high optimal = ${config.optimalSizeHigh} items`);
            if (config.sahniKHigh !== 'no_filter') constraints.push(`high Sahni-k = ${config.sahniKHigh}`);
            if (greedyActive) constraints.push(`greedy < ${(greedyThreshold * 100).toFixed(0)}%`);
            if (forgivenessActive) constraints.push(`N90 share ≤ ${(forgivenessShare * 100).toFixed(1)}%`);
            warning = `Could not satisfy constraints (${constraints.join(', ')}) after ${MAX_ATTEMPTS} attempts. Showing result for base seed. Try loosening constraints, widening budget ranges, or changing seed.`;
        }

        // Compute Sahni-k if not already done
        if (sahniLow === null) sahniLow = computeSahniK(items, bLow, optLow.value);
        if (sahniHigh === null) sahniHigh = computeSahniK(items, bHigh, optHigh.value);

        // Compute greedy ratio and N90 for display
        greedyRatioLow = optLow.value > 0 ? greedyValue(items, bLow) / optLow.value : 0;
        greedyRatioHigh = optHigh.value > 0 ? greedyValue(items, bHigh) / optHigh.value : 0;
        if (canBruteForceN90) {
            const bsLow = countBundleStats(items, bLow, optLow.value, 90);
            const bsHigh = countBundleStats(items, bHigh, optHigh.value, 90);
            n90Low = bsLow.n90;
            n90High = bsHigh.n90;
            feasibleLow = bsLow.feasible;
            feasibleHigh = bsHigh.feasible;
        }

        const sumWeights = items.reduce((s, it) => s + it.weight, 0);

        // Summary stats
        let statsHtml = [
            { label: 'Sum of Prices', value: sumWeights }
        ].map(s => `<div class="stat-card"><div class="label">${s.label}</div><div class="value">${s.value}</div></div>`).join('');

        if (usedSeed !== baseSeed) {
            statsHtml += `<div class="stat-card" title="Seed was adjusted to satisfy constraints."><div class="label">Seed Used</div><div class="value">${usedSeed}</div></div>`;
        }

        if (warning) {
            statsHtml += `<div class="stat-card warning" style="grid-column: 1 / -1;"><div class="warning-text">⚠️ ${warning}</div></div>`;
        }

        el.statsGrid.innerHTML = statsHtml;

        renderOptimalPanel(el.optimalLow, optLow, sahniLow, bLow, greedyRatioLow, n90Low, feasibleLow);
        renderOptimalPanel(el.optimalHigh, optHigh, sahniHigh, bHigh, greedyRatioHigh, n90High, feasibleHigh);

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
            budget_low_range: [config.budgetLowMin, config.budgetLowMax],
            budget_high: bHigh,
            budget_high_range: [config.budgetHighMin, config.budgetHighMax],
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
