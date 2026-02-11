// Seeded PRNG (Mulberry32)
function mulberry32(seed) {
    return function() {
        let t = seed += 0x6D2B79F5;
        t = Math.imul(t ^ t >>> 15, t | 1);
        t ^= t + Math.imul(t ^ t >>> 7, t | 61);
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

// Convert string seed to integer
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

// Box-Muller transform for normal distribution
function boxMuller(rng) {
    const u1 = rng();
    const u2 = rng();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

// Distribution samplers — integer variants (>= 1)
function sampleUniformInt(rng, min, max) {
    return Math.floor(rng() * (max - min + 1)) + min;
}

function sampleNormalInt(rng, mean, sd) {
    let val;
    do {
        val = Math.round(mean + sd * boxMuller(rng));
    } while (val <= 0);
    return val;
}

function sampleLognormalInt(rng, mu, sigma) {
    let val;
    do {
        const normal = boxMuller(rng);
        val = Math.round(Math.exp(mu + sigma * normal));
    } while (val <= 0);
    return val;
}

// Distribution samplers — continuous variants (> 0, rounded to 2 dp)
function sampleUniformCont(rng, min, max) {
    const val = min + rng() * (max - min);
    return Math.max(0.01, parseFloat(val.toFixed(2)));
}

function sampleNormalCont(rng, mean, sd) {
    let val;
    do {
        val = mean + sd * boxMuller(rng);
    } while (val <= 0);
    return parseFloat(val.toFixed(2));
}

function sampleLognormalCont(rng, mu, sigma) {
    const normal = boxMuller(rng);
    const val = Math.exp(mu + sigma * normal);
    return parseFloat(Math.max(0.01, val).toFixed(2));
}

// Get sampler function based on distribution type and integer flag
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
    throw new Error(`Unknown distribution: ${distType}`);
}

// Distribution name mapping
function distName(type, isInt) {
    const base = { 'uniform': 'Uniform', 'normal': 'Normal', 'lognormal': 'Lognormal' };
    return base[type] + (isInt ? 'Int' : '');
}

const CORRELATION_NAMES = {
    'independent': 'Independent',
    'positive': 'PositiveLinear',
    'negative': 'NegativeLinear'
};

// Generate raw items (no capacity logic)
function generateItems(config, seedStr) {
    const rng = mulberry32(hashSeed(seedStr));
    
    const weightSampler = getSampler(config.weightDist, config.weightParams, config.weightInt);
    const valueSampler = getSampler(config.valueDist, config.valueParams, config.valueInt);
    
    const items = [];
    let maxWeight = 0;
    
    // First pass: generate weights
    for (let i = 0; i < config.nItems; i++) {
        const weight = weightSampler(rng);
        items.push({ id: i + 1, weight, value: 0 });
        maxWeight = Math.max(maxWeight, weight);
    }
    
    // Second pass: generate values based on correlation
    for (let i = 0; i < config.nItems; i++) {
        let value;
        
        if (config.correlation === 'independent') {
            value = valueSampler(rng);
        } else if (config.correlation === 'positive') {
            const noise = config.noiseSd * boxMuller(rng);
            value = config.alpha * items[i].weight + noise;
            value = config.valueInt ? Math.round(value) : parseFloat(value.toFixed(2));
        } else if (config.correlation === 'negative') {
            const noise = config.noiseSd * boxMuller(rng);
            value = config.alpha * (maxWeight - items[i].weight) + noise;
            value = config.valueInt ? Math.round(value) : parseFloat(value.toFixed(2));
        }
        
        items[i].value = Math.max(config.valueInt ? 1 : 0.01, value);
    }
    
    // Apply ratio spread (compress/stretch V/P ratios around their mean)
    if (config.ratioSpread !== 'medium') {
        const lambda = config.ratioSpread === 'low' ? 0.3 : 2.0;
        const ratios = items.map(it => it.value / it.weight);
        const meanRatio = ratios.reduce((a, b) => a + b, 0) / ratios.length;
        
        for (let i = 0; i < items.length; i++) {
            const newRatio = meanRatio + lambda * (ratios[i] - meanRatio);
            const clampedRatio = Math.max(0.01, newRatio);
            let newValue = clampedRatio * items[i].weight;
            newValue = config.valueInt ? Math.max(1, Math.round(newValue)) : Math.max(0.01, parseFloat(newValue.toFixed(2)));
            items[i].value = newValue;
        }
    }
    
    // Apply integer ratios: round each value to nearest multiple of its price
    if (config.integerRatios) {
        for (let i = 0; i < items.length; i++) {
            const ratio = Math.max(1, Math.round(items[i].value / items[i].weight));
            items[i].value = ratio * items[i].weight;
        }
    }
    
    return items;
}

// Find a valid capacity within [budgetMin, budgetMax] for items,
// optionally targeting a specific optimal solution size and Sahni-k.
// Returns { capacity, sahniK, found } or null.
function findCapacityInRange(items, budgetMin, budgetMax, targetOptSize, targetSahniK) {
    const sumWeights = items.reduce((s, it) => s + it.weight, 0);
    const lo = Math.max(1, budgetMin);
    const hi = Math.min(budgetMax, sumWeights - 1);
    
    if (lo > hi) return null;
    
    // Collect candidate capacities
    let candidates = [];
    
    if (targetOptSize === 'no_filter') {
        // Try midpoint first, then scan if Sahni-k is targeted
        if (targetSahniK === 'no_filter') {
            const cap = Math.round((lo + hi) / 2);
            return { capacity: cap, found: true };
        }
        // Need to scan for Sahni-k match at any capacity
        for (let c = lo; c <= hi; c++) candidates.push(c);
    } else {
        // Scan for capacities that give the target optimal count
        for (let c = lo; c <= hi; c++) {
            const sol = solveKnapsack(items, c);
            if (sol.count === parseInt(targetOptSize)) candidates.push(c);
        }
    }
    
    if (candidates.length === 0) return null;
    
    // If no Sahni-k target, take the first (or middle) candidate
    if (targetSahniK === 'no_filter') {
        const cap = candidates[Math.floor(candidates.length / 2)];
        return { capacity: cap, found: true };
    }
    
    // Check Sahni-k for each candidate capacity
    const targetK = parseInt(targetSahniK);
    for (const c of candidates) {
        const sol = solveKnapsack(items, c);
        const k = computeSahniK(items, c, sol.value);
        if (k === targetK) {
            return { capacity: c, sahniK: k, found: true };
        }
    }
    
    return null;
}

// Main generation: iterate seeds until all constraints are satisfied
function generateInstance(config) {
    const baseSeed = config.seed;
    const MAX_ATTEMPTS = 10000;
    let usedSeed = baseSeed;
    let items, capacity;
    let foundGreedyRatio = null, foundN90 = null, foundFeasible = null;
    let warning = null;
    let found = false;
    
    // Parse greedy constraint
    const greedyActive = config.greedyCap !== 'no_filter';
    const greedyThreshold = greedyActive ? parseFloat(config.greedyCap) : null;
    
    // Parse forgiveness constraint (N90 share)
    const forgivenessActive = config.forgivenessCap !== 'no_filter';
    const forgivenessShare = forgivenessActive ? parseFloat(config.forgivenessCap) : null;
    
    // N90 brute-force is only feasible for small n (2^n subsets)
    const canBruteForceN90 = config.nItems <= 20;
    
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        usedSeed = attempt === 0 ? baseSeed : baseSeed + '_' + attempt;
        items = generateItems(config, usedSeed);
        
        // Find capacity satisfying optimal-size + Sahni-k constraints
        const capacityResult = findCapacityInRange(
            items, config.budgetMin, config.budgetMax,
            config.optimalSize, config.targetSahniK
        );
        if (!capacityResult || !capacityResult.found) continue;
        capacity = capacityResult.capacity;
        
        // Compute OPT
        const sol = solveKnapsack(items, capacity);
        const optVal = sol.value;
        
        // Greedy constraint
        if (greedyActive && optVal > 0) {
            const g = greedyValue(items, capacity) / optVal;
            if (g >= greedyThreshold) continue; // reject: greedy too close
            foundGreedyRatio = g;
        } else if (optVal > 0) {
            foundGreedyRatio = greedyValue(items, capacity) / optVal;
        } else {
            foundGreedyRatio = 0;
        }
        
        // Forgiveness constraint (N90 share) + feasible count + min feasible
        if (canBruteForceN90) {
            const bs = countBundleStats(items, capacity, optVal, 90);
            if (forgivenessActive && bs.feasible > 0 && (bs.n90 / bs.feasible) > forgivenessShare) continue;
            if (config.minFeasible !== null && bs.feasible < config.minFeasible) continue;
            foundN90 = bs.n90;
            foundFeasible = bs.feasible;
        }
        
        found = true;
        break;
    }
    
    if (!found) {
        // Fallback: use base seed, pick a capacity in range
        usedSeed = baseSeed;
        items = generateItems(config, usedSeed);
        const sumWeights = items.reduce((s, it) => s + it.weight, 0);
        capacity = Math.min(config.budgetMax, sumWeights - 1);
        capacity = Math.max(config.budgetMin, capacity);
        if (capacity < 1) capacity = 1;
        
        const sol = solveKnapsack(items, capacity);
        foundGreedyRatio = sol.value > 0 ? greedyValue(items, capacity) / sol.value : 0;
        if (canBruteForceN90) {
            const bs = countBundleStats(items, capacity, sol.value, 90);
            foundN90 = bs.n90;
            foundFeasible = bs.feasible;
        }
        
        const constraints = [];
        if (config.optimalSize !== 'no_filter') constraints.push(`${config.optimalSize} items in optimal`);
        if (config.targetSahniK !== 'no_filter') constraints.push(`Sahni-k = ${config.targetSahniK}`);
        if (greedyActive) constraints.push(`greedy < ${(greedyThreshold * 100).toFixed(0)}% of OPT`);
        if (forgivenessActive) constraints.push(`N90 share ≤ ${(forgivenessShare * 100).toFixed(1)}%`);
        if (config.minFeasible !== null) constraints.push(`feasible ≥ ${config.minFeasible}`);
        warning = `Could not satisfy constraints (${constraints.join(', ')}) after ${MAX_ATTEMPTS} attempts. Showing result for base seed. Try loosening Greedy proximity, increasing N90 share cap, widening budget range, or changing seed.`;
    }
    
    // Build output object with full metadata
    const result = {
        problem: '0/1 knapsack',
        n_items: config.nItems,
        budget: capacity,
        budget_range: [config.budgetMin, config.budgetMax],
        seed: usedSeed,
        seed_requested: baseSeed,
        price_dist: {
            name: distName(config.weightDist, config.weightInt),
            params: config.weightParams
        },
        value_dist: config.correlation === 'independent' ? {
            name: distName(config.valueDist, config.valueInt),
            params: config.valueParams
        } : null,
        correlation: {
            mode: CORRELATION_NAMES[config.correlation],
            alpha: config.correlation !== 'independent' ? config.alpha : null,
            noise_sd: config.correlation !== 'independent' ? config.noiseSd : null
        },
        ratio_spread: config.ratioSpread,
        integer_ratios: config.integerRatios,
        target_sahni_k: config.targetSahniK,
        greedy_ratio: foundGreedyRatio,
        n90: foundN90,
        feasible_count: foundFeasible,
        items
    };
    
    if (warning) result.warning = warning;
    
    return result;
}

// Calculate statistics
function calculateStats(instance) {
    const weights = instance.items.map(i => i.weight);
    const sumWeights = weights.reduce((a, b) => a + b, 0);
    
    return {
        sumWeights,
        capacity: instance.budget,
        budgetRange: instance.budget_range,
        capacityRatio: (instance.budget / sumWeights * 100).toFixed(1),
        seedUsed: instance.seed,
        seedRequested: instance.seed_requested,
        greedyRatio: instance.greedy_ratio,
        n90: instance.n90,
        feasibleCount: instance.feasible_count
    };
}

// DOM Elements
const elements = {
    nItems: document.getElementById('n_items'),
    budgetMin: document.getElementById('budget_min'),
    budgetMax: document.getElementById('budget_max'),
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
    optimalSize: document.getElementById('optimal_size'),
    targetSahniK: document.getElementById('target_sahni_k'),
    greedyCapSelect: document.getElementById('greedyCapSelect'),
    forgivenessCapSelect: document.getElementById('forgivenessCapSelect'),
    minFeasibleInput: document.getElementById('minFeasibleInput'),
    ratioSpread: document.getElementById('ratio_spread'),
    integerRatios: document.getElementById('integer_ratios'),
    generateBtn: document.getElementById('generate_btn'),
    downloadCsvBtn: document.getElementById('download_csv_btn'),
    downloadJsonBtn: document.getElementById('download_json_btn'),
    copyJsonBtn: document.getElementById('copy_json_btn'),
    outputSection: document.getElementById('output_section'),
    statsGrid: document.getElementById('stats_grid'),
    optimalGrid: document.getElementById('optimal_grid'),
    previewBody: document.getElementById('preview_body'),
    weightParams: document.getElementById('weight_params'),
    valueParams: document.getElementById('value_params'),
    correlationParams: document.getElementById('correlation_params')
};

let currentInstance = null;

// Update visible parameters based on distribution selection
function updateDistParams(selectId, paramsContainerId) {
    const select = document.getElementById(selectId);
    const container = document.getElementById(paramsContainerId);
    const dist = select.value;
    
    container.querySelectorAll('.param-group').forEach(group => {
        group.classList.add('hidden');
    });
    
    container.querySelector(`.${dist}-params`).classList.remove('hidden');
}

function updateCorrelationParams() {
    const correlation = elements.correlation.value;
    const correlationParamsDiv = elements.correlationParams.querySelector('.correlation-params');
    const valueDistGroup = elements.valueDist.closest('.form-group');
    const valueParamsGroup = elements.valueParams;
    
    if (correlation === 'independent') {
        correlationParamsDiv.classList.add('hidden');
        valueDistGroup.classList.remove('hidden');
        valueParamsGroup.classList.remove('hidden');
    } else {
        correlationParamsDiv.classList.remove('hidden');
        valueDistGroup.classList.add('hidden');
        valueParamsGroup.classList.add('hidden');
    }
}

// Get current configuration from form
function getConfig() {
    const weightDist = elements.weightDist.value;
    const valueDist = elements.valueDist.value;
    
    let weightParams, valueParams;
    
    switch (weightDist) {
        case 'uniform':
            weightParams = { min: parseInt(elements.weightMin.value), max: parseInt(elements.weightMax.value) };
            break;
        case 'normal':
            weightParams = { mean: parseFloat(elements.weightMean.value), sd: parseFloat(elements.weightSd.value) };
            break;
        case 'lognormal':
            weightParams = { mu: parseFloat(elements.weightMu.value), sigma: parseFloat(elements.weightSigma.value) };
            break;
    }
    
    switch (valueDist) {
        case 'uniform':
            valueParams = { min: parseInt(elements.valueMin.value), max: parseInt(elements.valueMax.value) };
            break;
        case 'normal':
            valueParams = { mean: parseFloat(elements.valueMean.value), sd: parseFloat(elements.valueSd.value) };
            break;
        case 'lognormal':
            valueParams = { mu: parseFloat(elements.valueMu.value), sigma: parseFloat(elements.valueSigma.value) };
            break;
    }
    
    return {
        nItems: parseInt(elements.nItems.value),
        budgetMin: parseInt(elements.budgetMin.value),
        budgetMax: parseInt(elements.budgetMax.value),
        seed: elements.seed.value,
        weightDist,
        weightParams,
        weightInt: elements.weightInt.checked,
        valueDist,
        valueParams,
        valueInt: elements.valueInt.checked,
        correlation: elements.correlation.value,
        alpha: parseFloat(elements.alpha.value),
        noiseSd: parseFloat(elements.noiseSd.value),
        optimalSize: elements.optimalSize.value,
        ratioSpread: elements.ratioSpread.value,
        integerRatios: elements.integerRatios.checked,
        targetSahniK: elements.targetSahniK.value,
        greedyCap: elements.greedyCapSelect.value,
        forgivenessCap: elements.forgivenessCapSelect.value,
        minFeasible: elements.minFeasibleInput.value ? parseInt(elements.minFeasibleInput.value) : null
    };
}

// Populate the optimal-size dropdown based on current n_items
function updateOptimalSizeOptions() {
    const n = parseInt(elements.nItems.value) || 1;
    const current = elements.optimalSize.value;
    elements.optimalSize.innerHTML = '<option value="no_filter">No filter</option>';
    for (let i = 1; i < n; i++) {
        elements.optimalSize.innerHTML += `<option value="${i}"${current === String(i) ? ' selected' : ''}>${i}</option>`;
    }
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
// Returns { feasible, n90 } where feasible = all subsets fitting in capacity,
// n90 = subsets with value >= alphaPercent% of optimal.
function countBundleStats(items, capacity, optValue, alphaPercent) {
    if (alphaPercent === undefined) alphaPercent = 90;
    const n = items.length;
    const threshold = alphaPercent * optValue; // compare against value*100
    let feasible = 0, n90 = 0;
    const total = 1 << n; // 2^n subsets
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

// Solve 0/1 knapsack with DP, return { value, items[] }
function solveKnapsack(items, capacity) {
    const n = items.length;
    // dp[i][w] = best value using items 0..i-1 with capacity w
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
    
    // Backtrack to find selected items
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

// Compute Sahni-k: minimum k such that enumerating all subsets of size ≤ k
// and greedily filling the rest achieves the optimal value.
function computeSahniK(items, capacity, optimalValue) {
    const n = items.length;
    // Precompute items sorted by value/price ratio (descending) for greedy
    const sortedIndices = items.map((_, i) => i).sort((a, b) =>
        (items[b].value / items[b].weight) - (items[a].value / items[a].weight)
    );
    
    // Greedy fill: given a set of forced-in indices and remaining capacity,
    // greedily add items by V/P ratio
    function greedyFill(forced, remCap) {
        let val = 0;
        for (const idx of sortedIndices) {
            if (forced.has(idx)) continue;
            if (items[idx].weight <= remCap) {
                val += items[idx].value;
                remCap -= items[idx].weight;
            }
        }
        return val;
    }
    
    // k=0: pure greedy
    const greedyVal = greedyFill(new Set(), capacity);
    if (greedyVal >= optimalValue) return 0;
    
    // For k=1,2,...  enumerate subsets of size k
    // Use iterative deepening to keep it manageable
    for (let k = 1; k <= Math.min(n, 6); k++) {
        // Enumerate all subsets of size k
        const subset = new Array(k);
        let found = false;
        
        function enumerate(depth, start) {
            if (found) return;
            if (depth === k) {
                // Check this subset
                const forced = new Set(subset);
                let forcedWeight = 0, forcedValue = 0;
                for (const idx of subset) {
                    forcedWeight += items[idx].weight;
                    forcedValue += items[idx].value;
                }
                if (forcedWeight > capacity) return;
                const totalVal = forcedValue + greedyFill(forced, capacity - forcedWeight);
                if (totalVal >= optimalValue) {
                    found = true;
                }
                return;
            }
            for (let i = start; i < n; i++) {
                subset[depth] = i;
                enumerate(depth + 1, i + 1);
                if (found) return;
            }
        }
        
        enumerate(0, 0);
        if (found) return k;
    }
    
    return '> 6'; // Safety cap for large instances
}

// Render statistics
function renderStats(stats) {
    const statItems = [
        { label: 'Budget', value: stats.capacity },
        { label: 'Sum of Prices', value: stats.sumWeights },
        { label: 'Budget Ratio', value: `${stats.capacityRatio}%`, title: 'Budget as a percentage of total price. Always below 100% — not all items can be bought.' }
    ];
    
    if (stats.seedUsed !== stats.seedRequested) {
        statItems.push({ label: 'Seed Used', value: stats.seedUsed, title: 'Seed was adjusted to satisfy budget range + optimal size constraints.' });
    }
    
    // Greedy ratio
    if (stats.greedyRatio !== null && stats.greedyRatio !== undefined) {
        statItems.push({
            label: 'Greedy Performance',
            value: `${(stats.greedyRatio * 100).toFixed(1)}%`,
            title: 'Greedy solution value as a percentage of optimal. Lower = greedy is further from optimal = harder instance.'
        });
    }
    
    // Feasible combinations
    if (stats.feasibleCount !== null && stats.feasibleCount !== undefined) {
        statItems.push({
            label: 'Feasible Combinations',
            value: stats.feasibleCount.toLocaleString(),
            title: 'Total number of item subsets that fit within the budget.'
        });
    }
    
    // N90 (forgiveness) + share
    if (stats.n90 !== null && stats.n90 !== undefined) {
        const shareStr = stats.feasibleCount > 0 ? ` (${(stats.n90 / stats.feasibleCount * 100).toFixed(1)}%)` : '';
        statItems.push({
            label: 'N90 (Forgiveness)',
            value: `${stats.n90}${shareStr}`,
            title: 'Number of feasible subsets achieving ≥ 90% of optimal value, and their share of all feasible combinations. Fewer = less forgiving instance.'
        });
    }
    
    elements.statsGrid.innerHTML = statItems.map(stat => `
        <div class="stat-card" ${stat.title ? `title="${stat.title}"` : ''}>
            <div class="label">${stat.label}</div>
            <div class="value">${stat.value}</div>
        </div>
    `).join('');
}

// Render optimal solution stats
function renderOptimal(optimal, sahniK) {
    const statItems = [
        { label: 'Items Selected', value: `${optimal.count}` },
        { label: 'Total Price', value: optimal.weight },
        { label: 'Total Value', value: optimal.value },
        { label: 'Sahni-k', value: sahniK, title: 'Minimum k for Sahni\'s algorithm: enumerate all subsets of size ≤ k, greedily fill the rest. k=0 means pure greedy is optimal. Higher k = harder instance.' }
    ];
    
    // Build item list text
    const INLINE_LIMIT = 8;
    const itemChips = optimal.items.map(it =>
        `<span class="item-chip">${it.id} <small>(${it.weight},${it.value})</small></span>`
    ).join(' ');
    
    const isLong = optimal.items.length > INLINE_LIMIT;
    
    let html = statItems.map(stat => `
        <div class="stat-card optimal">
            <div class="label">${stat.label}</div>
            <div class="value">${stat.value}</div>
        </div>
    `).join('');
    
    // Add the items list card (collapsible if many items)
    if (isLong) {
        html += `
            <div class="stat-card optimal items-card" style="grid-column: 1 / -1;">
                <div class="label">Selected Items</div>
                <button class="expand-btn" onclick="this.parentElement.classList.toggle('expanded'); this.textContent = this.parentElement.classList.contains('expanded') ? 'Collapse' : 'Show ${optimal.count} items';">Show ${optimal.count} items</button>
                <div class="items-list collapsed">${itemChips}</div>
            </div>
        `;
    } else {
        html += `
            <div class="stat-card optimal items-card" style="grid-column: 1 / -1;">
                <div class="label">Selected Items</div>
                <div class="items-list">${itemChips}</div>
            </div>
        `;
    }
    
    elements.optimalGrid.innerHTML = html;
}

// Render preview table
function renderPreview(items, optimalIds) {
    const previewItems = items.slice(0, 25);
    elements.previewBody.innerHTML = previewItems.map(item => `
        <tr${optimalIds.has(item.id) ? ' class="optimal-row"' : ''}>
            <td>${item.id}</td>
            <td>${item.weight}</td>
            <td>${item.value}</td>
            <td>${(item.value / item.weight).toFixed(2)}</td>
        </tr>
    `).join('');
}

// Generate instance and update UI
function generate() {
    const config = getConfig();
    // Validate budget range
    if (config.budgetMin > config.budgetMax) {
        alert('Min Budget must be ≤ Max Budget.');
        return;
    }
    
    elements.generateBtn.textContent = 'Generating…';
    elements.generateBtn.disabled = true;
    
    // Use setTimeout to let UI update before heavy computation
    setTimeout(() => {
        currentInstance = generateInstance(config);
        const stats = calculateStats(currentInstance);
        const optimal = solveKnapsack(currentInstance.items, currentInstance.budget);
        const sahniK = computeSahniK(currentInstance.items, currentInstance.budget, optimal.value);
        
        renderStats(stats);
        if (currentInstance.warning) {
            elements.statsGrid.innerHTML += `
                <div class="stat-card warning" style="grid-column: 1 / -1;">
                    <div class="warning-text">⚠️ ${currentInstance.warning}</div>
                </div>
            `;
        }
        renderOptimal(optimal, sahniK);
        const optimalIds = new Set(optimal.items.map(it => it.id));
        renderPreview(currentInstance.items, optimalIds);
        
        elements.outputSection.classList.remove('hidden');
        elements.downloadCsvBtn.disabled = false;
        elements.downloadJsonBtn.disabled = false;
        elements.copyJsonBtn.disabled = false;
        elements.generateBtn.textContent = 'Generate';
        elements.generateBtn.disabled = false;
    }, 10);
}

// Download helpers
function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function downloadCSV() {
    if (!currentInstance) return;
    
    let csv = 'id,price,value\n';
    currentInstance.items.forEach(item => {
        csv += `${item.id},${item.weight},${item.value}\n`;
    });
    
    // Add metadata as comments at the end
    csv += `# budget,${currentInstance.budget}\n`;
    csv += `# n_items,${currentInstance.n_items}\n`;
    csv += `# seed,${currentInstance.seed}\n`;
    
    downloadFile(csv, `knapsack_${currentInstance.seed}.csv`, 'text/csv');
}

function downloadJSON() {
    if (!currentInstance) return;
    
    const json = JSON.stringify(currentInstance, null, 2);
    downloadFile(json, `knapsack_${currentInstance.seed}.json`, 'application/json');
}

function copyJSON() {
    if (!currentInstance) return;
    
    const json = JSON.stringify(currentInstance, null, 2);
    const btn = elements.copyJsonBtn;
    const originalText = btn.textContent;
    
    // Try modern Clipboard API first, fall back to execCommand
    function onSuccess() {
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = originalText; }, 1500);
    }
    function onFail() {
        btn.textContent = 'Failed';
        setTimeout(() => { btn.textContent = originalText; }, 1500);
    }
    
    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(json).then(onSuccess).catch(() => {
            fallbackCopy(json) ? onSuccess() : onFail();
        });
    } else {
        fallbackCopy(json) ? onSuccess() : onFail();
    }
}

function fallbackCopy(text) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(textarea);
    return ok;
}

// Event listeners
elements.weightDist.addEventListener('change', () => updateDistParams('weight_dist', 'weight_params'));
elements.valueDist.addEventListener('change', () => updateDistParams('value_dist', 'value_params'));
elements.correlation.addEventListener('change', updateCorrelationParams);
elements.nItems.addEventListener('input', updateOptimalSizeOptions);
elements.generateBtn.addEventListener('click', generate);
elements.downloadCsvBtn.addEventListener('click', downloadCSV);
elements.downloadJsonBtn.addEventListener('click', downloadJSON);
elements.copyJsonBtn.addEventListener('click', copyJSON);

// Initialize
elements.downloadCsvBtn.disabled = true;
elements.downloadJsonBtn.disabled = true;
elements.copyJsonBtn.disabled = true;
updateDistParams('weight_dist', 'weight_params');
updateDistParams('value_dist', 'value_params');
updateCorrelationParams();
updateOptimalSizeOptions();
