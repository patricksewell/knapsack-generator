// ============================================================
// Budget Pair Finder
// Given a fixed set of items, search for budget pairs (low/high)
// that satisfy filters (optimal size, Sahni-k, greedy, N90).
// ============================================================

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

// Greedy knapsack
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

const NUM_ITEMS = 12;

const el = {
    budgetLowMin: document.getElementById('budget_low_min'),
    budgetLowMax: document.getElementById('budget_low_max'),
    budgetHighMin: document.getElementById('budget_high_min'),
    budgetHighMax: document.getElementById('budget_high_max'),
    optimalSizeLow: document.getElementById('optimal_size_low'),
    optimalSizeHigh: document.getElementById('optimal_size_high'),
    sahniKLow: document.getElementById('sahni_k_low'),
    sahniKHigh: document.getElementById('sahni_k_high'),
    greedyCapSelect: document.getElementById('greedyCapSelect'),
    forgivenessCapSelect: document.getElementById('forgivenessCapSelect'),
    minFeasibleInput: document.getElementById('minFeasibleInput'),
    searchBtn: document.getElementById('search_btn'),
    stopBtn: document.getElementById('stop_btn'),
    progressBar: document.getElementById('progress_bar'),
    progressFill: document.getElementById('progress_fill'),
    searchStatus: document.getElementById('search_status'),
    pairsSection: document.getElementById('pairs_section'),
    pairsBody: document.getElementById('pairs_body'),
    pairCount: document.getElementById('pair_count'),
    outputSection: document.getElementById('output_section'),
    statsGrid: document.getElementById('stats_grid'),
    optimalLow: document.getElementById('optimal_low'),
    optimalHigh: document.getElementById('optimal_high'),
    previewBody: document.getElementById('preview_body'),
    downloadJsonBtn: document.getElementById('download_json_btn'),
    copyJsonBtn: document.getElementById('copy_json_btn'),
    pasteArea: document.getElementById('paste_area'),
    parseBtn: document.getElementById('parse_btn'),
    itemInputsLeft: document.getElementById('item_inputs_left'),
    itemInputsRight: document.getElementById('item_inputs_right')
};

let currentResult = null;
let foundPairs = [];
let stopRequested = false;

// ============================================================
// Item input: build table rows
// ============================================================

function buildItemInputs() {
    const half = Math.ceil(NUM_ITEMS / 2);
    el.itemInputsLeft.innerHTML = '';
    el.itemInputsRight.innerHTML = '';

    for (let i = 0; i < NUM_ITEMS; i++) {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${i + 1}</td>
            <td><input type="number" id="item_w_${i}" min="1" value="" placeholder="price"></td>
            <td><input type="number" id="item_v_${i}" min="1" value="" placeholder="value"></td>
        `;
        if (i < half) {
            el.itemInputsLeft.appendChild(row);
        } else {
            el.itemInputsRight.appendChild(row);
        }
    }
}

function getItems() {
    const items = [];
    for (let i = 0; i < NUM_ITEMS; i++) {
        const w = parseInt(document.getElementById(`item_w_${i}`).value);
        const v = parseInt(document.getElementById(`item_v_${i}`).value);
        if (isNaN(w) || isNaN(v) || w <= 0 || v <= 0) return null;
        items.push({ id: i + 1, weight: w, value: v });
    }
    return items;
}

function setItems(items) {
    for (let i = 0; i < Math.min(items.length, NUM_ITEMS); i++) {
        document.getElementById(`item_w_${i}`).value = items[i].weight;
        document.getElementById(`item_v_${i}`).value = items[i].value;
    }
}

// Parse pasted text
function parsePastedItems() {
    const text = el.pasteArea.value.trim();
    if (!text) { alert('Paste area is empty.'); return; }

    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const items = [];
    for (const line of lines) {
        const parts = line.split(/[,\t\s]+/);
        if (parts.length < 2) continue;
        const w = parseFloat(parts[0]);
        const v = parseFloat(parts[1]);
        if (!isNaN(w) && !isNaN(v) && w > 0 && v > 0) {
            items.push({ id: items.length + 1, weight: Math.round(w), value: Math.round(v) });
        }
    }

    if (items.length === 0) {
        alert('Could not parse any items. Use format: price,value (one per line).');
        return;
    }

    // Pad or truncate to NUM_ITEMS
    while (items.length < NUM_ITEMS) items.push({ id: items.length + 1, weight: 1, value: 1 });
    setItems(items.slice(0, NUM_ITEMS));

    // Switch to manual tab to show loaded items
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.querySelector('[data-tab="manual"]').classList.add('active');
    document.getElementById('tab-manual').classList.add('active');
}

// ============================================================
// Optimal size dropdown
// ============================================================

function updateOptimalSizeOptions() {
    [el.optimalSizeLow, el.optimalSizeHigh].forEach(select => {
        const current = select.value;
        select.innerHTML = '<option value="no_filter">No filter</option>';
        for (let i = 1; i < NUM_ITEMS; i++) {
            select.innerHTML += `<option value="${i}"${current === String(i) ? ' selected' : ''}>${i}</option>`;
        }
    });
}

// ============================================================
// Search logic
// ============================================================

function getSearchConfig() {
    return {
        budgetLowMin: parseInt(el.budgetLowMin.value),
        budgetLowMax: parseInt(el.budgetLowMax.value),
        budgetHighMin: parseInt(el.budgetHighMin.value),
        budgetHighMax: parseInt(el.budgetHighMax.value),
        optimalSizeLow: el.optimalSizeLow.value,
        optimalSizeHigh: el.optimalSizeHigh.value,
        sahniKLow: el.sahniKLow.value,
        sahniKHigh: el.sahniKHigh.value,
        greedyCap: el.greedyCapSelect.value,
        forgivenessCap: el.forgivenessCapSelect.value,
        minFeasible: el.minFeasibleInput.value ? parseInt(el.minFeasibleInput.value) : null
    };
}

// Check if a single budget passes the per-budget filters
function checkBudget(items, cap, targetOptSize, targetSahniK) {
    const sol = solveKnapsack(items, cap);

    if (targetOptSize !== 'no_filter' && sol.count !== parseInt(targetOptSize)) return null;

    let sahniK = null;
    if (targetSahniK !== 'no_filter') {
        sahniK = computeSahniK(items, cap, sol.value);
        if (sahniK !== parseInt(targetSahniK)) return null;
    }

    return { capacity: cap, sol, sahniK };
}

async function search() {
    const items = getItems();
    if (!items) {
        alert('Please fill in all 12 items with positive integer prices and values.');
        return;
    }

    const config = getSearchConfig();
    if (config.budgetLowMin > config.budgetLowMax) { alert('Low Budget Min must be ≤ Max.'); return; }
    if (config.budgetHighMin > config.budgetHighMax) { alert('High Budget Min must be ≤ Max.'); return; }

    const sumWeights = items.reduce((s, it) => s + it.weight, 0);
    const loLow = Math.max(1, config.budgetLowMin);
    const hiLow = Math.min(config.budgetLowMax, sumWeights - 1);
    const loHigh = Math.max(1, config.budgetHighMin);
    const hiHigh = Math.min(config.budgetHighMax, sumWeights - 1);

    if (loLow > hiLow) { alert(`Low budget range [${config.budgetLowMin}, ${config.budgetLowMax}] is outside feasible range. Sum of prices = ${sumWeights}.`); return; }
    if (loHigh > hiHigh) { alert(`High budget range [${config.budgetHighMin}, ${config.budgetHighMax}] is outside feasible range. Sum of prices = ${sumWeights}.`); return; }

    const greedyActive = config.greedyCap !== 'no_filter';
    const greedyThreshold = greedyActive ? parseFloat(config.greedyCap) : 1;
    const forgivenessActive = config.forgivenessCap !== 'no_filter';
    const forgivenessShare = forgivenessActive ? parseFloat(config.forgivenessCap) : Infinity;
    const canBruteForce = items.length <= 20;

    // Pre-compute valid low budgets
    const validLow = [];
    for (let c = loLow; c <= hiLow; c++) {
        const result = checkBudget(items, c, config.optimalSizeLow, config.sahniKLow);
        if (result) validLow.push(result);
    }

    // Pre-compute valid high budgets
    const validHigh = [];
    for (let c = loHigh; c <= hiHigh; c++) {
        const result = checkBudget(items, c, config.optimalSizeHigh, config.sahniKHigh);
        if (result) validHigh.push(result);
    }

    // Total pairs to check
    const totalPairs = validLow.length * validHigh.length;

    // Show progress
    foundPairs = [];
    stopRequested = false;
    el.pairsBody.innerHTML = '';
    el.pairsSection.classList.add('hidden');
    el.outputSection.classList.add('hidden');
    el.searchBtn.disabled = true;
    el.stopBtn.style.display = '';
    el.progressBar.style.display = '';
    el.progressFill.style.width = '0%';
    el.searchStatus.textContent = `Checking ${validLow.length} low × ${validHigh.length} high = ${totalPairs} candidate pairs…`;

    if (totalPairs === 0) {
        el.searchStatus.textContent = `No valid budgets found in the specified ranges. Low candidates: ${validLow.length}, High candidates: ${validHigh.length}.`;
        el.progressBar.style.display = 'none';
        el.searchBtn.disabled = false;
        el.stopBtn.style.display = 'none';
        return;
    }

    let checked = 0;

    // Use async batching so UI can update
    const BATCH_SIZE = 50;

    async function processBatch(startIdx) {
        const pairs = [];
        // Flatten the 2D iteration
        for (let idx = startIdx; idx < Math.min(startIdx + BATCH_SIZE, totalPairs); idx++) {
            if (stopRequested) return;

            const li = Math.floor(idx / validHigh.length);
            const hi = idx % validHigh.length;
            const low = validLow[li];
            const high = validHigh[hi];

            // Greedy constraint on both budgets
            if (greedyActive) {
                const gL = low.sol.value > 0 ? greedyValue(items, low.capacity) / low.sol.value : 0;
                const gH = high.sol.value > 0 ? greedyValue(items, high.capacity) / high.sol.value : 0;
                if (gL >= greedyThreshold || gH >= greedyThreshold) { checked++; continue; }
            }

            // Forgiveness + min feasible
            if (canBruteForce && (forgivenessActive || config.minFeasible !== null)) {
                const bsL = countBundleStats(items, low.capacity, low.sol.value, 90);
                const bsH = countBundleStats(items, high.capacity, high.sol.value, 90);

                if (forgivenessActive) {
                    const shareLow = bsL.feasible > 0 ? bsL.n90 / bsL.feasible : 0;
                    const shareHigh = bsH.feasible > 0 ? bsH.n90 / bsH.feasible : 0;
                    if (shareLow > forgivenessShare || shareHigh > forgivenessShare) { checked++; continue; }
                }

                if (config.minFeasible !== null && (bsL.feasible < config.minFeasible || bsH.feasible < config.minFeasible)) { checked++; continue; }
            }

            // Compute Sahni-k if not already done
            const sahniLow = low.sahniK !== null ? low.sahniK : computeSahniK(items, low.capacity, low.sol.value);
            const sahniHigh = high.sahniK !== null ? high.sahniK : computeSahniK(items, high.capacity, high.sol.value);

            foundPairs.push({
                low: { capacity: low.capacity, sol: low.sol, sahniK: sahniLow },
                high: { capacity: high.capacity, sol: high.sol, sahniK: sahniHigh }
            });

            checked++;
        }

        // Update UI
        const pct = Math.min(100, Math.round((checked / totalPairs) * 100));
        el.progressFill.style.width = pct + '%';
        el.searchStatus.textContent = `Checked ${checked}/${totalPairs} pairs — found ${foundPairs.length} matching pair(s)…`;

        if (checked < totalPairs && !stopRequested) {
            // Schedule next batch
            return new Promise(resolve => setTimeout(() => resolve(processBatch(startIdx + BATCH_SIZE)), 0));
        }
    }

    await processBatch(0);

    // Done
    el.progressBar.style.display = 'none';
    el.searchBtn.disabled = false;
    el.stopBtn.style.display = 'none';

    if (foundPairs.length === 0) {
        el.searchStatus.textContent = `No matching budget pairs found after checking ${checked} candidate pairs. Try loosening filters or widening budget ranges.`;
        el.pairsSection.classList.add('hidden');
    } else {
        el.searchStatus.textContent = `Done. Found ${foundPairs.length} matching budget pair(s).`;
        renderPairsTable();
    }
}

function renderPairsTable() {
    el.pairsSection.classList.remove('hidden');
    el.pairCount.textContent = `(${foundPairs.length})`;

    el.pairsBody.innerHTML = foundPairs.map((pair, idx) => `
        <tr data-idx="${idx}">
            <td>${pair.low.capacity}</td>
            <td>${pair.low.sol.value}</td>
            <td>${pair.low.sol.count}</td>
            <td>${pair.low.sahniK}</td>
            <td>${pair.high.capacity}</td>
            <td>${pair.high.sol.value}</td>
            <td>${pair.high.sol.count}</td>
            <td>${pair.high.sahniK}</td>
        </tr>
    `).join('');

    // Click handler for each row
    el.pairsBody.querySelectorAll('tr').forEach(row => {
        row.addEventListener('click', () => {
            el.pairsBody.querySelectorAll('tr').forEach(r => r.classList.remove('selected-pair'));
            row.classList.add('selected-pair');
            showPairDetails(parseInt(row.dataset.idx));
        });
    });

    // Auto-select first pair
    if (foundPairs.length > 0) {
        el.pairsBody.querySelector('tr').classList.add('selected-pair');
        showPairDetails(0);
    }
}

function showPairDetails(idx) {
    const items = getItems();
    const pair = foundPairs[idx];
    if (!pair || !items) return;

    const bLow = pair.low.capacity;
    const bHigh = pair.high.capacity;
    const optLow = pair.low.sol;
    const optHigh = pair.high.sol;
    const sahniLow = pair.low.sahniK;
    const sahniHigh = pair.high.sahniK;

    const sumWeights = items.reduce((s, it) => s + it.weight, 0);

    // Greedy + N90 for display
    const greedyRatioLow = optLow.value > 0 ? greedyValue(items, bLow) / optLow.value : 0;
    const greedyRatioHigh = optHigh.value > 0 ? greedyValue(items, bHigh) / optHigh.value : 0;
    let n90Low = null, n90High = null, feasibleLow = null, feasibleHigh = null;
    if (items.length <= 20) {
        const bsLow = countBundleStats(items, bLow, optLow.value, 90);
        const bsHigh = countBundleStats(items, bHigh, optHigh.value, 90);
        n90Low = bsLow.n90; feasibleLow = bsLow.feasible;
        n90High = bsHigh.n90; feasibleHigh = bsHigh.feasible;
    }

    // Summary
    el.statsGrid.innerHTML = `
        <div class="stat-card"><div class="label">Sum of Prices</div><div class="value">${sumWeights}</div></div>
    `;

    renderOptimalPanel(el.optimalLow, optLow, sahniLow, bLow, greedyRatioLow, n90Low, feasibleLow);
    renderOptimalPanel(el.optimalHigh, optHigh, sahniHigh, bHigh, greedyRatioHigh, n90High, feasibleHigh);

    // Item table
    const lowIds = new Set(optLow.items.map(it => it.id));
    const highIds = new Set(optHigh.items.map(it => it.id));

    el.previewBody.innerHTML = items.map(item => {
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
        problem: '0/1 knapsack (budget pair finder)',
        n_items: items.length,
        budget_low: bLow,
        budget_high: bHigh,
        optimal_low: { budget: bLow, value: optLow.value, weight: optLow.weight, count: optLow.count, sahni_k: sahniLow, item_ids: optLow.items.map(it => it.id) },
        optimal_high: { budget: bHigh, value: optHigh.value, weight: optHigh.weight, count: optHigh.count, sahni_k: sahniHigh, item_ids: optHigh.items.map(it => it.id) },
        greedy_ratio_low: parseFloat(greedyRatioLow.toFixed(4)),
        greedy_ratio_high: parseFloat(greedyRatioHigh.toFixed(4)),
        feasible_low: feasibleLow,
        feasible_high: feasibleHigh,
        n90_low: n90Low,
        n90_high: n90High,
        items
    };

    el.outputSection.classList.remove('hidden');
    el.downloadJsonBtn.disabled = false;
    el.copyJsonBtn.disabled = false;
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
        { label: 'Sahni-k', value: sahniK !== null ? sahniK : '—', title: 'Minimum k for Sahni\'s algorithm.' }
    ];

    if (greedyRatio !== null && greedyRatio !== undefined) {
        stats.push({ label: 'Greedy Performance', value: `${(greedyRatio * 100).toFixed(1)}%`, title: 'Greedy solution value as % of optimal.' });
    }
    if (feasibleCount !== null && feasibleCount !== undefined) {
        stats.push({ label: 'Feasible Combinations', value: feasibleCount.toLocaleString(), title: 'Total item subsets fitting within this budget.' });
    }
    if (n90 !== null && n90 !== undefined) {
        const shareStr = feasibleCount > 0 ? ` (${(n90 / feasibleCount * 100).toFixed(1)}%)` : '';
        stats.push({ label: 'N90 (Forgiveness)', value: `${n90}${shareStr}`, title: 'Feasible subsets achieving ≥ 90% of optimal.' });
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

// ============================================================
// Export
// ============================================================

function downloadJSON() {
    if (!currentResult) return;
    const json = JSON.stringify(currentResult, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `knapsack_budget_pair_${currentResult.budget_low}_${currentResult.budget_high}.json`;
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

// ============================================================
// Tab switching
// ============================================================

document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    });
});

// ============================================================
// Event listeners
// ============================================================

el.searchBtn.addEventListener('click', search);
el.stopBtn.addEventListener('click', () => { stopRequested = true; });
el.parseBtn.addEventListener('click', parsePastedItems);
el.downloadJsonBtn.addEventListener('click', downloadJSON);
el.copyJsonBtn.addEventListener('click', copyJSON);

// Init
el.downloadJsonBtn.disabled = true;
el.copyJsonBtn.disabled = true;
buildItemInputs();
updateOptimalSizeOptions();
