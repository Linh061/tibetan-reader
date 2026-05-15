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

    function debounce(fn, delay) {
        let timer;
        return function(...args) {
            clearTimeout(timer);
            timer = setTimeout(() => fn.apply(this, args), delay);
        };
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
    function formatPosTag(r) {
        let pos = r.pos || r.pos_cn || '';
        if (!pos) return '';
        return `<span class="dict-pos-tag">${escapeHtml(pos)}</span>`;
    }

    function formatSourceTag(source) {
        if (source === 'en') return '<span class="dict-source-tag dict-source-en">EN</span>';
        if (source === 'zh') return '<span class="dict-source-tag dict-source-zh">汉</span>';
        if (source === 'zh+en') return '<span class="dict-source-tag dict-source-both">汉+EN</span>';
        return '';
    }

    function formatMeaning(r) {
        let parts = [];
        if (r.chinese) {
            parts.push(`<span class="dict-meaning-zh">${escapeHtml(r.chinese)}</span>`);
        }
        if (r.english) {
            parts.push(`<span class="dict-meaning-en">${escapeHtml(r.english)}</span>`);
        }
        return parts.join(' ');
    }

    function renderDictResults(results, exactMatch) {
        if (!results || results.length === 0) {
            return '<div class="dict-no-results">未找到匹配词条</div>';
        }
        
        let html = `<div class="dict-results-count">共 ${results.length} 个匹配结果</div>`;
        html += '<div class="dict-results-list">';
        
        results.forEach((r, i) => {
            const isExact = exactMatch && r.tibetan === exactMatch.tibetan;
            const cls = isExact ? 'dict-result-item dict-result-exact' : 'dict-result-item';
            html += `<div class="${cls}" data-index="${i}">
                <div class="dict-result-tibetan">${escapeHtml(r.tibetan)}</div>
                <div class="dict-result-meanings">
                    ${formatPosTag(r)}
                    ${formatSourceTag(r.source)}
                    ${formatMeaning(r)}
                </div>
            </div>`;
        });
        
        html += '</div>';
        return html;
    }

    async function dictSearch() {
        const word = dictSearchInput.value.trim();
        if (!word) {
            dictSearchResult.innerHTML = '';
            return;
        }
        
        try {
            const resp = await fetch(`/api/dict/lookup?word=${encodeURIComponent(word)}`);
            const data = await resp.json();
            
            if (data.fuzzy_results && data.fuzzy_results.length > 0) {
                dictSearchResult.innerHTML = renderDictResults(data.fuzzy_results, data.exact_match);
            } else {
                dictSearchResult.innerHTML = `<div class="dict-no-results">未找到: ${escapeHtml(word)}</div>`;
            }
        } catch (e) {
            dictSearchResult.innerHTML = `<div class="dict-no-results">查询出错</div>`;
        }
    }

    // Debounced search as user types
    const debouncedDictSearch = debounce(dictSearch, 200);

    // ===== Event Listeners =====
    $('btnDictSearch').addEventListener('click', dictSearch);
    dictSearchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') dictSearch();
    });
    dictSearchInput.addEventListener('input', debouncedDictSearch);


    // ===== Init =====
    loadDictionary();

})();
