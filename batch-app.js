// ============================================================
// Batch Dual-Budget Knapsack Generator
// Generates multiple instances with compact price,value output.
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

// Generate items
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
// Find a valid capacity within [budgetMin, budgetMax] that satisfies
// optimal-size RANGE [optMin, optMax] + Sahni-k target + optional
// optimal value range [minOptVal, maxOptVal].
// Returns { capacity, sol, sahniK } or null.
// ============================================================
function findCapacityInRange(items, budgetMin, budgetMax, optMin, optMax, targetSahniK, minOptVal, maxOptVal) {
    const sumWeights = items.reduce((s, it) => s + it.weight, 0);
    const lo = Math.max(1, budgetMin);
    const hi = Math.min(budgetMax, sumWeights - 1);
    if (lo > hi) return null;

    const anyOptTarget = (optMin !== null && optMax !== null);
    const hasMinVal = minOptVal !== null && minOptVal !== undefined;
    const hasMaxVal = maxOptVal !== null && maxOptVal !== undefined;

    function valueInRange(v) {
        if (hasMinVal && v < minOptVal) return false;
        if (hasMaxVal && v > maxOptVal) return false;
        return true;
    }

    // Collect candidate capacities whose optimal value falls in range
    let candidates = [];

    for (let c = lo; c <= hi; c++) {
        const sol = solveKnapsack(items, c);
        // Enforce optimal item count range (if set)
        if (anyOptTarget && (sol.count < optMin || sol.count > optMax)) continue;
        // Enforce optimal value range (if set)
        if (!valueInRange(sol.value)) continue;
        candidates.push(c);
    }

    if (candidates.length === 0) return null;

    if (targetSahniK === 'no_filter') {
        const cap = candidates[Math.floor(candidates.length / 2)];
        const sol = solveKnapsack(items, cap);
        return { capacity: cap, sol, sahniK: null };
    }

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

// ============================================================
// Greedy value helper
// ============================================================
function greedyValue(items, capacity) {
    const sorted = [...items].sort((a, b) => (b.value / b.weight) - (a.value / a.weight));
    let remaining = capacity, total = 0;
    for (const it of sorted) {
        if (it.weight <= remaining) { total += it.value; remaining -= it.weight; }
    }
    return total;
}

// Count feasible subsets and near-optimal subsets (brute-force bitmask, n<=20)
function countBundleStats(items, capacity, optValue, alphaPercent) {
    const n = items.length;
    let feasible = 0, n90 = 0;
    const limit = 1 << n;
    for (let mask = 1; mask < limit; mask++) {
        let w = 0, v = 0;
        for (let j = 0; j < n; j++) {
            if (mask & (1 << j)) { w += items[j].weight; v += items[j].value; }
        }
        if (w <= capacity) {
            feasible++;
            if (v * 100 >= alphaPercent * optValue) n90++;
        }
    }
    return { feasible, n90 };
}

// ============================================================
// DOM & UI
// ============================================================

const el = {
    nInstances: document.getElementById('n_instances'),
    nItems: document.getElementById('n_items'),
    budgetLowMin: document.getElementById('budget_low_min'),
    budgetLowMax: document.getElementById('budget_low_max'),
    budgetHighMin: document.getElementById('budget_high_min'),
    budgetHighMax: document.getElementById('budget_high_max'),
    optLowMin: document.getElementById('opt_low_min'),
    optLowMax: document.getElementById('opt_low_max'),
    optHighMin: document.getElementById('opt_high_min'),
    optHighMax: document.getElementById('opt_high_max'),
    sahniKLow: document.getElementById('sahni_k_low'),
    sahniKHigh: document.getElementById('sahni_k_high'),
    minOptValLow: document.getElementById('min_opt_val_low'),
    maxOptValLow: document.getElementById('max_opt_val_low'),
    minOptValHigh: document.getElementById('min_opt_val_high'),
    maxOptValHigh: document.getElementById('max_opt_val_high'),
    greedyCapSelect: document.getElementById('greedyCapSelect'),
    forgivenessCapSelect: document.getElementById('forgivenessCapSelect'),
    minFeasibleInput: document.getElementById('minFeasibleInput'),
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
    generateBtn: document.getElementById('generate_btn'),
    copyAllBtn: document.getElementById('copy_all_btn'),
    downloadJsonBtn: document.getElementById('download_json_btn'),
    outputSection: document.getElementById('output_section'),
    resultsContainer: document.getElementById('results_container'),
    progressFill: document.getElementById('progress_fill'),
    progressBar: document.getElementById('progress_bar'),
    weightParams: document.getElementById('weight_params'),
    valueParams: document.getElementById('value_params'),
    correlationParams: document.getElementById('correlation_params')
};

let allResults = [];

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
        nInstances: parseInt(el.nInstances.value),
        nItems: parseInt(el.nItems.value),
        budgetLowMin: parseInt(el.budgetLowMin.value),
        budgetLowMax: parseInt(el.budgetLowMax.value),
        budgetHighMin: parseInt(el.budgetHighMin.value),
        budgetHighMax: parseInt(el.budgetHighMax.value),
        optLowMin: parseInt(el.optLowMin.value),
        optLowMax: parseInt(el.optLowMax.value),
        optHighMin: parseInt(el.optHighMin.value),
        optHighMax: parseInt(el.optHighMax.value),
        sahniKLow: el.sahniKLow.value,
        sahniKHigh: el.sahniKHigh.value,
        minOptValLow: el.minOptValLow.value ? parseInt(el.minOptValLow.value) : null,
        maxOptValLow: el.maxOptValLow.value ? parseInt(el.maxOptValLow.value) : null,
        minOptValHigh: el.minOptValHigh.value ? parseInt(el.minOptValHigh.value) : null,
        maxOptValHigh: el.maxOptValHigh.value ? parseInt(el.maxOptValHigh.value) : null,
        greedyCap: el.greedyCapSelect.value,
        forgivenessCap: el.forgivenessCapSelect.value,
        minFeasible: el.minFeasibleInput.value ? parseInt(el.minFeasibleInput.value) : null,
        seed: el.seed.value,
        weightDist, weightParams, weightInt: el.weightInt.checked,
        valueDist, valueParams, valueInt: el.valueInt.checked,
        correlation: el.correlation.value,
        alpha: parseFloat(el.alpha.value),
        noiseSd: parseFloat(el.noiseSd.value),
        ratioSpread: el.ratioSpread.value,
        integerRatios: el.integerRatios.checked
    };
}

// Generate a single instance with given base seed. Returns result object or null.
function generateSingleInstance(config, instanceSeed) {
    const MAX_ATTEMPTS = 10000;

    const greedyActive = config.greedyCap !== 'no_filter';
    const greedyThreshold = greedyActive ? parseFloat(config.greedyCap) : 1;
    const forgivenessActive = config.forgivenessCap !== 'no_filter';
    const forgivenessShare = forgivenessActive ? parseFloat(config.forgivenessCap) : Infinity;
    const canBruteForceN90 = config.nItems <= 20;

    // Track best near-miss: passed structural + value-cap but failed greedy/N90
    let bestFallback = null;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const usedSeed = attempt === 0 ? instanceSeed : instanceSeed + '_' + attempt;
        const items = generateItems(config, usedSeed);

        const lowResult = findCapacityInRange(
            items, config.budgetLowMin, config.budgetLowMax,
            config.optLowMin, config.optLowMax, config.sahniKLow, config.minOptValLow, config.maxOptValLow
        );
        if (!lowResult) continue;

        const highResult = findCapacityInRange(
            items, config.budgetHighMin, config.budgetHighMax,
            config.optHighMin, config.optHighMax, config.sahniKHigh, config.minOptValHigh, config.maxOptValHigh
        );
        if (!highResult) continue;

        const capLow = lowResult.capacity;
        const capHigh = highResult.capacity;
        const solLow = lowResult.sol || solveKnapsack(items, capLow);
        const solHigh = highResult.sol || solveKnapsack(items, capHigh);

        // This attempt passed structural + value constraints — remember it
        // as a potential fallback even if greedy/N90 fail below.
        if (!bestFallback) {
            bestFallback = { usedSeed, items, lowResult, highResult, capLow, capHigh, solLow, solHigh };
        }

        // Greedy constraint — check BOTH budgets
        if (greedyActive) {
            const gLow = solLow.value > 0 ? greedyValue(items, capLow) / solLow.value : 0;
            const gHigh = solHigh.value > 0 ? greedyValue(items, capHigh) / solHigh.value : 0;
            if (gLow >= greedyThreshold || gHigh >= greedyThreshold) continue;
        }

        // Forgiveness constraint (N90 share) + min feasible — check BOTH budgets
        if (canBruteForceN90) {
            const bsL = countBundleStats(items, capLow, solLow.value, 90);
            const bsH = countBundleStats(items, capHigh, solHigh.value, 90);
            if (forgivenessActive) {
                const shareLow = bsL.feasible > 0 ? bsL.n90 / bsL.feasible : 0;
                const shareHigh = bsH.feasible > 0 ? bsH.n90 / bsH.feasible : 0;
                if (shareLow > forgivenessShare || shareHigh > forgivenessShare) continue;
            }
            if (config.minFeasible !== null && (bsL.feasible < config.minFeasible || bsH.feasible < config.minFeasible)) continue;
        }

        // Compute Sahni-k if not done yet
        const sahniLow = lowResult.sahniK !== null ? lowResult.sahniK : computeSahniK(items, capLow, solLow.value);
        const sahniHigh = highResult.sahniK !== null ? highResult.sahniK : computeSahniK(items, capHigh, solHigh.value);

        // Compute greedy ratio and N90 for display
        const greedyRatioLow = solLow.value > 0 ? greedyValue(items, capLow) / solLow.value : 0;
        const greedyRatioHigh = solHigh.value > 0 ? greedyValue(items, capHigh) / solHigh.value : 0;
        let n90Low = null, n90High = null, feasibleLow = null, feasibleHigh = null;
        if (canBruteForceN90) {
            const bsLow = countBundleStats(items, capLow, solLow.value, 90);
            const bsHigh = countBundleStats(items, capHigh, solHigh.value, 90);
            n90Low = bsLow.n90;
            n90High = bsHigh.n90;
            feasibleLow = bsLow.feasible;
            feasibleHigh = bsHigh.feasible;
        }

        return {
            seed: usedSeed,
            items,
            budgetLow: capLow,
            budgetHigh: capHigh,
            optLow: solLow,
            optHigh: solHigh,
            sahniLow,
            sahniHigh,
            greedyRatioLow,
            greedyRatioHigh,
            n90Low,
            n90High,
            feasibleLow,
            feasibleHigh
        };
    }

    // Fallback — prefer a near-miss that at least satisfies the value cap
    const fb = bestFallback || null;
    const fbItems = fb ? fb.items : generateItems(config, instanceSeed);
    const fbSumW = fbItems.reduce((s, it) => s + it.weight, 0);
    const fbCapLow = fb ? fb.capLow : Math.max(1, Math.min(Math.round((config.budgetLowMin + config.budgetLowMax) / 2), fbSumW - 1));
    const fbCapHigh = fb ? fb.capHigh : Math.max(1, Math.min(Math.round((config.budgetHighMin + config.budgetHighMax) / 2), fbSumW - 1));
    const fbSolLow = fb ? fb.solLow : solveKnapsack(fbItems, fbCapLow);
    const fbSolHigh = fb ? fb.solHigh : solveKnapsack(fbItems, fbCapHigh);
    const fbSeed = fb ? fb.usedSeed : instanceSeed;

    const greedyRatioLow = fbSolLow.value > 0 ? greedyValue(fbItems, fbCapLow) / fbSolLow.value : 0;
    const greedyRatioHigh = fbSolHigh.value > 0 ? greedyValue(fbItems, fbCapHigh) / fbSolHigh.value : 0;
    let n90Low = null, n90High = null, feasibleLow = null, feasibleHigh = null;
    if (canBruteForceN90) {
        const bsLow = countBundleStats(fbItems, fbCapLow, fbSolLow.value, 90);
        const bsHigh = countBundleStats(fbItems, fbCapHigh, fbSolHigh.value, 90);
        n90Low = bsLow.n90;
        n90High = bsHigh.n90;
        feasibleLow = bsLow.feasible;
        feasibleHigh = bsHigh.feasible;
    }

    const fbSahniLow = fb && fb.lowResult.sahniK !== null ? fb.lowResult.sahniK : computeSahniK(fbItems, fbCapLow, fbSolLow.value);
    const fbSahniHigh = fb && fb.highResult.sahniK !== null ? fb.highResult.sahniK : computeSahniK(fbItems, fbCapHigh, fbSolHigh.value);

    return {
        seed: fbSeed,
        items: fbItems,
        budgetLow: fbCapLow,
        budgetHigh: fbCapHigh,
        optLow: fbSolLow,
        optHigh: fbSolHigh,
        sahniLow: fbSahniLow,
        sahniHigh: fbSahniHigh,
        greedyRatioLow,
        greedyRatioHigh,
        n90Low,
        n90High,
        feasibleLow,
        feasibleHigh,
        warning: 'Could not satisfy all constraints after 10,000 attempts.' + (fb ? ' (value cap respected, greedy/N90 relaxed)' : '')
    };
}

// Format compact price,value text for an instance
function formatCompact(result) {
    return result.items.map(it => `${it.weight},${it.value}`).join('\n');
}

// Build full text block for one instance (header + price,value)
function formatInstanceBlock(result, index) {
    const lines = [];
    lines.push(`# Instance ${index + 1}  |  seed: ${result.seed}`);
    let lowLine = `# Low budget: ${result.budgetLow}  |  optimal: ${result.optLow.count} items (value ${result.optLow.value})  |  Sahni-k: ${result.sahniLow}  |  Greedy: ${(result.greedyRatioLow * 100).toFixed(1)}%`;
    if (result.feasibleLow !== null) lowLine += `  |  Feasible: ${result.feasibleLow}`;
    if (result.n90Low !== null) {
        const shareLow = result.feasibleLow > 0 ? ` (${(result.n90Low / result.feasibleLow * 100).toFixed(1)}%)` : '';
        lowLine += `  |  N90: ${result.n90Low}${shareLow}`;
    }
    lines.push(lowLine);
    let highLine = `# High budget: ${result.budgetHigh}  |  optimal: ${result.optHigh.count} items (value ${result.optHigh.value})  |  Sahni-k: ${result.sahniHigh}  |  Greedy: ${(result.greedyRatioHigh * 100).toFixed(1)}%`;
    if (result.feasibleHigh !== null) highLine += `  |  Feasible: ${result.feasibleHigh}`;
    if (result.n90High !== null) {
        const shareHigh = result.feasibleHigh > 0 ? ` (${(result.n90High / result.feasibleHigh * 100).toFixed(1)}%)` : '';
        highLine += `  |  N90: ${result.n90High}${shareHigh}`;
    }
    lines.push(highLine);
    lines.push('# price,value');
    result.items.forEach(it => lines.push(`${it.weight},${it.value}`));
    return lines.join('\n');
}

function renderResults() {
    el.resultsContainer.innerHTML = '';

    allResults.forEach((result, i) => {
        const card = document.createElement('div');
        card.className = 'instance-card';

        // Header
        const header = document.createElement('div');
        header.className = 'instance-header';
        header.innerHTML = `
            <h3>Instance ${i + 1}</h3>
            <div class="meta">
                <span>seed: ${result.seed}</span>
                <span class="low-tag">low ${result.budgetLow}: ${result.optLow.count} items, k=${result.sahniLow}, G=${(result.greedyRatioLow * 100).toFixed(0)}%</span>
                <span class="high-tag">high ${result.budgetHigh}: ${result.optHigh.count} items, k=${result.sahniHigh}, G=${(result.greedyRatioHigh * 100).toFixed(0)}%</span>
                <button class="copy-instance-btn" data-index="${i}">Copy</button>
            </div>
        `;

        // Body
        const body = document.createElement('div');
        body.className = 'instance-body';

        // Dual meta panels
        const dualMeta = document.createElement('div');
        dualMeta.className = 'dual-meta';

        const lowIds = result.optLow.items.map(it => it.id);
        const highIds = result.optHigh.items.map(it => it.id);

        const feasibleLowStr = result.feasibleLow !== null ? `, Feasible=${result.feasibleLow.toLocaleString()}` : '';
        const feasibleHighStr = result.feasibleHigh !== null ? `, Feasible=${result.feasibleHigh.toLocaleString()}` : '';
        const n90LowShare = (result.n90Low !== null && result.feasibleLow > 0) ? ` (${(result.n90Low / result.feasibleLow * 100).toFixed(1)}%)` : '';
        const n90HighShare = (result.n90High !== null && result.feasibleHigh > 0) ? ` (${(result.n90High / result.feasibleHigh * 100).toFixed(1)}%)` : '';
        const n90LowStr = result.n90Low !== null ? `, N90=${result.n90Low}${n90LowShare}` : '';
        const n90HighStr = result.n90High !== null ? `, N90=${result.n90High}${n90HighShare}` : '';

        dualMeta.innerHTML = `
            <div class="panel low">
                <strong>Low Budget: ${result.budgetLow}</strong>
                Optimal: ${result.optLow.count} items, value ${result.optLow.value}, price ${result.optLow.weight}, Sahni-k=${result.sahniLow}<br>
                Greedy Performance: ${(result.greedyRatioLow * 100).toFixed(1)}%${feasibleLowStr}${n90LowStr}<br>
                Items: ${lowIds.join(', ')}
            </div>
            <div class="panel high">
                <strong>High Budget: ${result.budgetHigh}</strong>
                Optimal: ${result.optHigh.count} items, value ${result.optHigh.value}, price ${result.optHigh.weight}, Sahni-k=${result.sahniHigh}<br>
                Greedy Performance: ${(result.greedyRatioHigh * 100).toFixed(1)}%${feasibleHighStr}${n90HighStr}<br>
                Items: ${highIds.join(', ')}
            </div>
        `;
        body.appendChild(dualMeta);

        // Compact data
        const pre = document.createElement('pre');
        pre.textContent = formatCompact(result);
        body.appendChild(pre);

        if (result.warning) {
            const warn = document.createElement('div');
            warn.style.cssText = 'color: #e67e22; font-size: 0.78rem; margin-top: 4px;';
            warn.textContent = '⚠️ ' + result.warning;
            body.appendChild(warn);
        }

        card.appendChild(header);
        card.appendChild(body);
        el.resultsContainer.appendChild(card);
    });

    // Copy per-instance buttons
    document.querySelectorAll('.copy-instance-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const idx = parseInt(btn.dataset.index);
            const text = formatInstanceBlock(allResults[idx], idx);
            copyToClipboard(text, btn);
        });
    });
}

function copyToClipboard(text, btn) {
    const orig = btn.textContent;
    function ok() { btn.textContent = 'Copied!'; setTimeout(() => { btn.textContent = orig; }, 1500); }
    function fail() { btn.textContent = 'Failed'; setTimeout(() => { btn.textContent = orig; }, 1500); }

    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(ok).catch(() => { fallbackCopy(text) ? ok() : fail(); });
    } else {
        fallbackCopy(text) ? ok() : fail();
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

// Generate all instances one-by-one with progress
function generateBatch() {
    const config = getConfig();

    // Validations
    if (config.budgetLowMin > config.budgetLowMax) { alert('Low Budget Min must be ≤ Max.'); return; }
    if (config.budgetHighMin > config.budgetHighMax) { alert('High Budget Min must be ≤ Max.'); return; }
    if (config.optLowMin > config.optLowMax) { alert('Low Optimal Items Min must be ≤ Max.'); return; }
    if (config.optHighMin > config.optHighMax) { alert('High Optimal Items Min must be ≤ Max.'); return; }

    el.generateBtn.textContent = 'Generating…';
    el.generateBtn.disabled = true;
    el.outputSection.classList.remove('hidden');
    el.resultsContainer.innerHTML = '';
    el.progressFill.style.width = '0%';
    el.progressBar.style.display = '';
    allResults = [];

    const total = config.nInstances;
    let idx = 0;

    function nextInstance() {
        if (idx >= total) {
            // Done
            el.progressFill.style.width = '100%';
            setTimeout(() => { el.progressBar.style.display = 'none'; }, 400);
            el.generateBtn.textContent = 'Generate Batch';
            el.generateBtn.disabled = false;
            renderResults();
            return;
        }

        el.progressFill.style.width = ((idx / total) * 100) + '%';

        // Each instance gets a different base seed
        const baseSeed = config.seed;
        const instanceSeed = idx === 0 ? baseSeed : baseSeed + '_inst' + idx;

        const result = generateSingleInstance(config, instanceSeed);
        allResults.push(result);
        idx++;

        // Use setTimeout to allow UI to update between instances
        setTimeout(nextInstance, 5);
    }

    setTimeout(nextInstance, 10);
}

function copyAll() {
    if (allResults.length === 0) return;
    const text = allResults.map((r, i) => formatInstanceBlock(r, i)).join('\n\n');
    copyToClipboard(text, el.copyAllBtn);
}

function downloadJSON() {
    if (allResults.length === 0) return;
    const config = getConfig();
    const exportData = {
        problem: '0/1 knapsack (batch dual budget)',
        n_instances: allResults.length,
        n_items: config.nItems,
        starting_seed: config.seed,
        budget_low_range: [config.budgetLowMin, config.budgetLowMax],
        budget_high_range: [config.budgetHighMin, config.budgetHighMax],
        target_optimal_low: [config.optLowMin, config.optLowMax],
        target_optimal_high: [config.optHighMin, config.optHighMax],
        target_sahni_k_low: config.sahniKLow,
        target_sahni_k_high: config.sahniKHigh,
        optimal_value_range_low: [config.minOptValLow, config.maxOptValLow],
        optimal_value_range_high: [config.minOptValHigh, config.maxOptValHigh],
        price_dist: { name: distName(config.weightDist, config.weightInt), params: config.weightParams },
        value_dist: config.correlation === 'independent' ? { name: distName(config.valueDist, config.valueInt), params: config.valueParams } : null,
        correlation: { mode: CORRELATION_NAMES[config.correlation] },
        ratio_spread: config.ratioSpread,
        integer_ratios: config.integerRatios,
        instances: allResults.map((r, i) => ({
            instance: i + 1,
            seed: r.seed,
            budget_low: r.budgetLow,
            budget_high: r.budgetHigh,
            optimal_low: { count: r.optLow.count, value: r.optLow.value, weight: r.optLow.weight, sahni_k: r.sahniLow, greedy_ratio: parseFloat((r.greedyRatioLow * 100).toFixed(1)), feasible: r.feasibleLow, n90: r.n90Low, item_ids: r.optLow.items.map(it => it.id) },
            optimal_high: { count: r.optHigh.count, value: r.optHigh.value, weight: r.optHigh.weight, sahni_k: r.sahniHigh, greedy_ratio: parseFloat((r.greedyRatioHigh * 100).toFixed(1)), feasible: r.feasibleHigh, n90: r.n90High, item_ids: r.optHigh.items.map(it => it.id) },
            items: r.items.map(it => ({ id: it.id, price: it.weight, value: it.value })),
            ...(r.warning ? { warning: r.warning } : {})
        }))
    };

    const json = JSON.stringify(exportData, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `knapsack_batch_${config.seed}_x${allResults.length}.json`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// Event listeners
el.weightDist.addEventListener('change', () => updateDistParams('weight_dist', 'weight_params'));
el.valueDist.addEventListener('change', () => updateDistParams('value_dist', 'value_params'));
el.correlation.addEventListener('change', updateCorrelationParams);
el.generateBtn.addEventListener('click', generateBatch);
el.copyAllBtn.addEventListener('click', copyAll);
el.downloadJsonBtn.addEventListener('click', downloadJSON);

// Init
updateDistParams('weight_dist', 'weight_params');
updateDistParams('value_dist', 'value_params');
updateCorrelationParams();
