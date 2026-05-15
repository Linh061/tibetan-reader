/**
 * Tibetan Reader - Frontend Application (Home Page)
 * Handles dictionary lookup and collection selection.
 */

(function() {
    'use strict';

    // ===== State =====
    const state = {
        dictLoaded: false,
        collections: [],
    };

    // ===== DOM References =====
    const $ = (id) => document.getElementById(id);
    const statusMsg = $('statusMsg');
    const dictStats = $('dictStats');
    const dictSearchInput = $('dictSearchInput');
    const dictSearchResult = $('dictSearchResult');
    const collectionCards = $('collectionCards');

    // ===== Utility Functions =====
    function setStatus(msg, type) {
        statusMsg.innerHTML = msg;
        statusMsg.className = 'status' + (type ? ' ' + type : '');
    }

    function showError(msg) {
        setStatus(`<span class="error-msg">⚠ ${msg}</span>`);
    }

    function showSuccess(msg) {
        setStatus(`<span class="success-msg">✓ ${msg}</span>`);
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // ===== Dictionary Loading =====
    async function loadDictionary() {
        try {
            const resp = await fetch('/api/dict/stats');
            if (!resp.ok) throw new Error('Dictionary not available');
            const stats = await resp.json();
            state.dictLoaded = true;
            showSuccess(`词典已加载（${stats.total_entries} 词条）`);
            
            // Load collections
            await loadCollections();
        } catch (e) {
            showError('词典加载失败: ' + e.message);
        }
    }

    // ===== Collections =====
    async function loadCollections() {
        try {
            const resp = await fetch('/api/collections');
            if (!resp.ok) return;
            state.collections = await resp.json();
            renderCollections();
        } catch (e) {
            console.error('Failed to load collections:', e);
        }
    }

    function renderCollections() {
        collectionCards.innerHTML = '';
        if (state.collections.length === 0) {
            collectionCards.innerHTML = '<span style="color:var(--text-muted);font-size:0.82rem;">暂无典籍数据</span>';
            return;
        }

        state.collections.forEach(coll => {
            const card = document.createElement('div');
            card.className = 'collection-card';
            card.innerHTML = `
                <div class="card-title-cn">${escapeHtml(coll.title_cn)}</div>
                <div class="card-title-bo">${escapeHtml(coll.title_bo)}</div>
                <div class="card-desc">${escapeHtml(coll.description)}</div>
                <div class="card-badge">${coll.total_pages} 页</div>
                <div class="card-open-hint">点击进入阅读 →</div>
            `;
            card.addEventListener('click', () => {
                window.location.href = `/reader?collection=${coll.id}`;
            });
            collectionCards.appendChild(card);
        });
    }

    // ===== Dictionary Search =====
    async function dictSearch() {
        const word = dictSearchInput.value.trim();
        if (!word) return;
        
        try {
            const resp = await fetch(`/api/dict/lookup?word=${encodeURIComponent(word)}`);
            if (resp.ok) {
                const data = await resp.json();
                dictSearchResult.innerHTML = `<span class="found">${escapeHtml(data.tibetan)}: ${escapeHtml(data.chinese)}</span>`;
            } else if (resp.status === 404) {
                const data = await resp.json();
                if (data.fuzzy_results && data.fuzzy_results.length > 0) {
                    let html = '<span class="not-found">未找到，相近词:</span> ';
                    html += data.fuzzy_results.slice(0, 5).map(r => 
                        `<span style="cursor:pointer;color:var(--accent);text-decoration:underline;" onclick="document.getElementById('dictSearchInput').value='${escapeHtml(r.tibetan)}';dictSearch()">${escapeHtml(r.tibetan)} (${escapeHtml(r.chinese)})</span>`
                    ).join(', ');
                    dictSearchResult.innerHTML = html;
                } else {
                    dictSearchResult.innerHTML = `<span class="not-found">未找到: ${escapeHtml(word)}</span>`;
                }
            } else {
                dictSearchResult.innerHTML = `<span class="not-found">查询失败</span>`;
            }
        } catch (e) {
            dictSearchResult.innerHTML = `<span class="not-found">查询出错</span>`;
        }
    }

    // ===== Event Listeners =====
    $('btnDictSearch').addEventListener('click', dictSearch);
    dictSearchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') dictSearch();
    });

    // ===== Init =====
    loadDictionary();

})();
