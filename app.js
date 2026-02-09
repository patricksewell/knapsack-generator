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

// Generate knapsack instance
function generateInstance(config) {
    const rng = mulberry32(hashSeed(config.seed));
    
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
    
    // Enforce non-trivial: capacity must be < sum of weights
    const sumWeights = items.reduce((s, it) => s + it.weight, 0);
    let capacity = config.capacity;
    if (capacity >= sumWeights) {
        capacity = sumWeights - 1;
    }
    if (capacity < 1) capacity = 1;
    
    // If a target optimal size is requested, binary-search the capacity
    if (config.optimalSize !== 'random') {
        const target = parseInt(config.optimalSize);
        capacity = findCapacityForOptimalSize(items, target, sumWeights);
    }
    
    // Build output object with full metadata
    const result = {
        problem: '0/1 knapsack',
        n_items: config.nItems,
        capacity: capacity,
        seed: config.seed,
        weight_dist: {
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
        items
    };
    
    return result;
}

// Binary-search capacity so the optimal solution has exactly 'target' items
function findCapacityForOptimalSize(items, target, sumWeights) {
    // Sort items by weight to get a reasonable starting range
    const sorted = [...items].sort((a, b) => a.weight - b.weight);
    
    // Lower bound: sum of 'target' lightest items (minimum capacity that could fit target items)
    let lo = 0;
    for (let i = 0; i < Math.min(target, sorted.length); i++) lo += sorted[i].weight;
    
    let hi = sumWeights - 1;
    let bestCap = lo;
    
    // Binary search: find the smallest capacity where optimal count >= target
    while (lo <= hi) {
        const mid = Math.floor((lo + hi) / 2);
        const sol = solveKnapsack(items, mid);
        
        if (sol.count >= target) {
            bestCap = mid;
            hi = mid - 1;
        } else {
            lo = mid + 1;
        }
    }
    
    // Verify and fine-tune: walk down from bestCap to find exact boundary
    // where count == target (not more, not fewer)
    // First try bestCap
    let sol = solveKnapsack(items, bestCap);
    if (sol.count === target) return bestCap;
    
    // If count > target at bestCap, decrease until count == target
    if (sol.count > target) {
        for (let c = bestCap - 1; c >= 1; c--) {
            sol = solveKnapsack(items, c);
            if (sol.count === target) return c;
            if (sol.count < target) break;
        }
    }
    
    // If we still haven't found exact match, search upward
    for (let c = bestCap; c < sumWeights; c++) {
        sol = solveKnapsack(items, c);
        if (sol.count === target) return c;
    }
    
    // Fallback: return bestCap (closest we could get)
    return bestCap;
}

// Calculate statistics
function calculateStats(instance) {
    const weights = instance.items.map(i => i.weight);
    const values = instance.items.map(i => i.value);
    const sumWeights = weights.reduce((a, b) => a + b, 0);
    const sumValues = values.reduce((a, b) => a + b, 0);
    
    return {
        sumWeights,
        sumValues,
        capacity: instance.capacity,
        capacityRatio: (instance.capacity / sumWeights * 100).toFixed(1)
    };
}

// DOM Elements
const elements = {
    nItems: document.getElementById('n_items'),
    capacity: document.getElementById('capacity'),
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
        capacity: parseInt(elements.capacity.value),
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
        optimalSize: elements.optimalSize.value
    };
}

// Populate the optimal-size dropdown based on current n_items
function updateOptimalSizeOptions() {
    const n = parseInt(elements.nItems.value) || 1;
    const current = elements.optimalSize.value;
    elements.optimalSize.innerHTML = '<option value="random">Random</option>';
    for (let i = 1; i < n; i++) {
        elements.optimalSize.innerHTML += `<option value="${i}"${current === String(i) ? ' selected' : ''}>${i}</option>`;
    }
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

// Render statistics
function renderStats(stats) {
    const statItems = [
        { label: 'Capacity', value: stats.capacity },
        { label: 'Sum of Weights', value: stats.sumWeights },
        { label: 'Sum of Values', value: stats.sumValues },
        { label: 'Capacity Ratio', value: `${stats.capacityRatio}%`, title: 'Capacity as a percentage of total weight. Always below 100% — not all items can fit.' }
    ];
    
    elements.statsGrid.innerHTML = statItems.map(stat => `
        <div class="stat-card" ${stat.title ? `title="${stat.title}"` : ''}>
            <div class="label">${stat.label}</div>
            <div class="value">${stat.value}</div>
        </div>
    `).join('');
}

// Render optimal solution stats
function renderOptimal(optimal) {
    const statItems = [
        { label: 'Items Selected', value: `${optimal.count}` },
        { label: 'Total Weight', value: optimal.weight },
        { label: 'Total Value', value: optimal.value }
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
function renderPreview(items) {
    const previewItems = items.slice(0, 25);
    elements.previewBody.innerHTML = previewItems.map(item => `
        <tr>
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
    currentInstance = generateInstance(config);
    const stats = calculateStats(currentInstance);
    const optimal = solveKnapsack(currentInstance.items, currentInstance.capacity);
    
    renderStats(stats);
    renderOptimal(optimal);
    renderPreview(currentInstance.items);
    
    elements.outputSection.classList.remove('hidden');
    elements.downloadCsvBtn.disabled = false;
    elements.downloadJsonBtn.disabled = false;
    elements.copyJsonBtn.disabled = false;
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
    
    let csv = 'id,weight,value\n';
    currentInstance.items.forEach(item => {
        csv += `${item.id},${item.weight},${item.value}\n`;
    });
    
    // Add metadata as comments at the end
    csv += `# capacity,${currentInstance.capacity}\n`;
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
    navigator.clipboard.writeText(json).then(() => {
        const btn = elements.copyJsonBtn;
        const originalText = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => {
            btn.textContent = originalText;
        }, 1500);
    });
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
