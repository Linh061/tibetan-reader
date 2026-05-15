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

    // ===== Helper: detect if input is Chinese or English =====
    function isChineseOrEnglish(text) {
        // Check if text contains Chinese characters
        const chineseRegex = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/;
        if (chineseRegex.test(text)) return 'zh';
        // Check if text is ASCII (English)
        const asciiRegex = /^[a-zA-Z\s]+$/;
        if (asciiRegex.test(text)) return 'en';
        return 'tibetan';
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
        
        // Detect input language
        const lang = isChineseOrEnglish(word);
        
        if (lang === 'zh' || lang === 'en') {
            // Chinese or English input → reverse search
            try {
                const resp = await fetch(`/api/dict/reverse-search?q=${encodeURIComponent(word)}`);
                const data = await resp.json();
                
                if (data.results && data.results.length > 0) {
                    // Mark results as reverse-search results
                    const label = lang === 'zh' ? '🔁 中文反查' : '🔁 英文反查';
                    let html = `<div class="dict-results-count">${label} — 共 ${data.total} 个匹配结果</div>`;
                    html += '<div class="dict-results-list">';
                    data.results.forEach((r, i) => {
                        html += `<div class="dict-result-item" data-index="${i}">
                            <div class="dict-result-tibetan">${escapeHtml(r.tibetan)}</div>
                            <div class="dict-result-meanings">
                                ${formatPosTag(r)}
                                ${formatSourceTag(r.source)}
                                ${formatMeaning(r)}
                            </div>
                        </div>`;
                    });
                    html += '</div>';
                    dictSearchResult.innerHTML = html;
                } else {
                    dictSearchResult.innerHTML = `<div class="dict-no-results">未找到与「${escapeHtml(word)}」相关的藏文词条</div>`;
                }
            } catch (e) {
                dictSearchResult.innerHTML = `<div class="dict-no-results">反查出错</div>`;
            }
        } else {
            // Tibetan input → normal lookup
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
    }

    // Debounced search as user types
    const debouncedDictSearch = debounce(dictSearch, 200);

    // ===== Event Listeners =====
    $('btnDictSearch').addEventListener('click', dictSearch);
    dictSearchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') dictSearch();
    });
    dictSearchInput.addEventListener('input', debouncedDictSearch);


    // ===== AI Settings =====
    const aiSettingsModal = $('aiSettingsModal');
    const aiApiBase = $('aiApiBase');
    const aiApiKey = $('aiApiKey');
    const aiModel = $('aiModel');
    const aiSystemPrompt = $('aiSystemPrompt');
    const aiTestResult = $('aiTestResult');

    async function loadAiConfig() {
        try {
            const resp = await fetch('/api/ai/config');
            if (!resp.ok) return;
            const config = await resp.json();
            aiApiBase.value = config.api_base || '';
            aiApiKey.value = config.api_key || '';
            aiModel.value = config.model || '';
            aiSystemPrompt.value = config.system_prompt || '';
        } catch (e) {
            console.error('Failed to load AI config:', e);
        }
    }

    function getAiConfigFromForm() {
        return {
            api_base: aiApiBase.value.trim(),
            api_key: aiApiKey.value.trim(),
            model: aiModel.value.trim(),
            system_prompt: aiSystemPrompt.value.trim(),
        };
    }

    async function testAiConnection() {
        const config = getAiConfigFromForm();
        aiTestResult.textContent = '测试中…';
        aiTestResult.style.color = 'var(--text-muted)';
        
        try {
            const resp = await fetch('/api/ai/test', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(config),
            });
            const data = await resp.json();
            aiTestResult.textContent = data.message;
            aiTestResult.style.color = data.success ? 'var(--success)' : 'var(--danger)';
        } catch (e) {
            aiTestResult.textContent = '测试失败: ' + e.message;
            aiTestResult.style.color = 'var(--danger)';
        }
    }

    async function saveAiConfig() {
        const config = getAiConfigFromForm();
        
        try {
            const resp = await fetch('/api/ai/config', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(config),
            });
            const data = await resp.json();
            if (data.success) {
                aiTestResult.textContent = '✓ 配置已保存';
                aiTestResult.style.color = 'var(--success)';
            } else {
                aiTestResult.textContent = '保存失败';
                aiTestResult.style.color = 'var(--danger)';
            }
        } catch (e) {
            aiTestResult.textContent = '保存失败: ' + e.message;
            aiTestResult.style.color = 'var(--danger)';
        }
    }

    // AI Settings event listeners
    $('btnAiSettings').addEventListener('click', () => {
        aiSettingsModal.style.display = 'flex';
        loadAiConfig();
        aiTestResult.textContent = '';
    });

    $('btnCloseAiSettings').addEventListener('click', () => {
        aiSettingsModal.style.display = 'none';
    });

    aiSettingsModal.addEventListener('click', (e) => {
        if (e.target === aiSettingsModal) {
            aiSettingsModal.style.display = 'none';
        }
    });

    $('btnTestAi').addEventListener('click', testAiConnection);
    $('btnSaveAi').addEventListener('click', saveAiConfig);

    // ===== Init =====
    loadDictionary();

})();

