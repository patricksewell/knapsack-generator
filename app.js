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

// Distribution samplers (return integers >= 1)
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

// Get sampler function based on distribution type
function getSampler(distType, params) {
    switch (distType) {
        case 'uniform':
            return (rng) => sampleUniformInt(rng, params.min, params.max);
        case 'normal':
            return (rng) => sampleNormalInt(rng, params.mean, params.sd);
        case 'lognormal':
            return (rng) => sampleLognormalInt(rng, params.mu, params.sigma);
        default:
            throw new Error(`Unknown distribution: ${distType}`);
    }
}

// Distribution name mapping
const DIST_NAMES = {
    'uniform': 'UniformInt',
    'normal': 'NormalInt',
    'lognormal': 'LognormalInt'
};

const CORRELATION_NAMES = {
    'independent': 'Independent',
    'positive': 'PositiveLinear',
    'negative': 'NegativeLinear'
};

// Generate knapsack instance
function generateInstance(config) {
    const rng = mulberry32(hashSeed(config.seed));
    
    const weightSampler = getSampler(config.weightDist, config.weightParams);
    const valueSampler = getSampler(config.valueDist, config.valueParams);
    
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
            value = Math.round(config.alpha * items[i].weight + noise);
        } else if (config.correlation === 'negative') {
            const noise = config.noiseSd * boxMuller(rng);
            value = Math.round(config.alpha * (maxWeight - items[i].weight) + noise);
        }
        
        items[i].value = Math.max(1, value);
    }
    
    // Build output object with full metadata
    const result = {
        problem: '0/1 knapsack',
        n_items: config.nItems,
        capacity: config.capacity,
        seed: config.seed,
        weight_dist: {
            name: DIST_NAMES[config.weightDist],
            params: config.weightParams
        },
        value_dist: config.correlation === 'independent' ? {
            name: DIST_NAMES[config.valueDist],
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

// Calculate statistics
function calculateStats(instance) {
    const weights = instance.items.map(i => i.weight);
    const values = instance.items.map(i => i.value);
    const sumWeights = weights.reduce((a, b) => a + b, 0);
    const sumValues = values.reduce((a, b) => a + b, 0);
    
    // Check for warnings
    const warnings = [];
    if (instance.capacity <= 0) {
        warnings.push('Capacity is ≤ 0 (trivial/invalid problem)');
    }
    if (instance.capacity >= sumWeights) {
        warnings.push('Capacity ≥ sum of weights (trivial problem: take all items)');
    }
    
    return {
        sumWeights,
        sumValues,
        capacityRatio: (instance.capacity / sumWeights * 100).toFixed(1),
        minWeight: Math.min(...weights),
        maxWeight: Math.max(...weights),
        avgWeight: (sumWeights / weights.length).toFixed(1),
        minValue: Math.min(...values),
        maxValue: Math.max(...values),
        avgValue: (sumValues / values.length).toFixed(1),
        warnings
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
    generateBtn: document.getElementById('generate_btn'),
    downloadCsvBtn: document.getElementById('download_csv_btn'),
    downloadJsonBtn: document.getElementById('download_json_btn'),
    copyJsonBtn: document.getElementById('copy_json_btn'),
    outputSection: document.getElementById('output_section'),
    statsGrid: document.getElementById('stats_grid'),
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
        valueDist,
        valueParams,
        correlation: elements.correlation.value,
        alpha: parseFloat(elements.alpha.value),
        noiseSd: parseFloat(elements.noiseSd.value)
    };
}

// Render statistics
function renderStats(stats) {
    const statItems = [
        { label: 'Sum of Weights', value: stats.sumWeights },
        { label: 'Sum of Values', value: stats.sumValues },
        { label: 'Capacity Ratio', value: `${stats.capacityRatio}%` },
        { label: 'Weight Range', value: `${stats.minWeight} - ${stats.maxWeight}` },
        { label: 'Avg Weight', value: stats.avgWeight },
        { label: 'Value Range', value: `${stats.minValue} - ${stats.maxValue}` },
        { label: 'Avg Value', value: stats.avgValue }
    ];
    
    let html = statItems.map(stat => `
        <div class="stat-card">
            <div class="label">${stat.label}</div>
            <div class="value">${stat.value}</div>
        </div>
    `).join('');
    
    // Add warnings if any
    if (stats.warnings && stats.warnings.length > 0) {
        html += `
            <div class="stat-card warning">
                <div class="label">⚠️ Warnings</div>
                <div class="value warning-text">${stats.warnings.join('<br>')}</div>
            </div>
        `;
    }
    
    elements.statsGrid.innerHTML = html;
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
    
    renderStats(stats);
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
