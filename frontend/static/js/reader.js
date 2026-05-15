/**
 * Tibetan Reader - Reading Page
 * TXT | PDF 1:1 layout + bottom AI section + floating dict/search overlays.
 * Features: editable text, selection-based translation, PDF sync,
 * AI chat with persistent history per page.
 */
(function() {
    'use strict';

    // ===== State =====
    const state = {
        currentPage: 1,
        totalPages: 1,
        pageSize: 30,
        currentCollection: null,
        currentPdfGroup: null,
        currentPdfPage: 1,
        pdfOpen: false,
        dictLoaded: false,
        searchResults: [],
        currentSearchIndex: -1,
        pdfGroups: [],
        pdfLoading: false,
        editMode: false,
        originalContent: '',
        // AI chat
        aiChatHistory: [],
        aiSelectedText: '',
        aiOpen: false,
    };

    // ===== DOM References =====
    const $ = (id) => document.getElementById(id);
    const mainContent = $('mainContent');
    const pageInput = $('pageInput');
    const pageInput2 = $('pageInput2');
    const totalPagesEl = $('totalPages');
    const totalPagesEl2 = $('totalPages2');
    const statusMsg = $('statusMsg');
    const readerTitle = $('readerTitle');
    const pageProgress = $('pageProgress');
    const pageProgress2 = $('pageProgress2');
    const readingArea = $('readingArea');
    const mainLayout = $('mainLayout');

    // PDF
    const pdfArea = $('pdfArea');
    const pdfViewer = $('pdfViewer');
    const pdfPageInfo = $('pdfPageInfo');

    // Dict overlay
    const dictOverlay = $('dictOverlay');
    const dictSearchInput = $('dictSearchInput');
    const dictSearchResult = $('dictSearchResult');

    // Search overlay
    const searchOverlay = $('searchOverlay');
    const searchInput = $('searchInput');
    const searchCount = $('searchCount');
    const searchResults = $('searchResults');

    // AI section
    const aiSection = $('aiSection');
    const aiContextText = $('aiContextText');
    const aiContext = $('aiContext');
    const aiMessages = $('aiMessages');
    const aiChatInput = $('aiChatInput');
    const aiStatus = $('aiStatus');

    // Buttons
    const btnEdit = $('btnEdit');
    const btnSave = $('btnSave');
    const btnCancelEdit = $('btnCancelEdit');

    // ===== Utility =====
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

    // ===== Get collection from URL =====
    function getCollectionFromUrl() {
        const params = new URLSearchParams(window.location.search);
        return params.get('collection') || 'sibu_yidian';
    }

    // ===== Load Collection Info =====
    async function loadCollectionInfo() {
        try {
            const resp = await fetch('/api/collections');
            if (!resp.ok) return;
            const collections = await resp.json();
            const collId = getCollectionFromUrl();
            const coll = collections.find(c => c.id === collId);
            if (coll) {
                readerTitle.textContent = coll.title_cn;
                state.currentCollection = collId;
                state.pdfGroups = coll.pdf_groups || [];
                return coll;
            }
        } catch (e) {
            console.error('Failed to load collection info:', e);
        }
        return null;
    }

    // ===== Load Page =====
    async function loadPage(page) {
        if (!state.currentCollection) return;
        
        try {
            const resp = await fetch(`/api/collections/${state.currentCollection}/page?page=${page}&size=${state.pageSize}`);
            if (!resp.ok) throw new Error('Failed to load page');
            const data = await resp.json();
            
            state.currentPage = data.page;
            state.totalPages = data.total_pages;
            
            renderContent(data.content);
            updatePagination();
            
            // Update progress
            const pct = Math.round((data.page / data.total_pages) * 100);
            pageProgress.textContent = `${pct}%`;
            pageProgress2.textContent = `${pct}%`;
            
            // Sync PDF immediately if open
            if (state.pdfOpen) {
                syncPdfWithPage(data.page, data.page_mapping);
            }
        } catch (e) {
            showError('加载页面失败: ' + e.message);
        }
    }

    // ===== Render Content =====
    function renderContent(text) {
        state.originalContent = text;
        
        if (!text || text.trim() === '') {
            mainContent.innerHTML = '<span class="placeholder">（空内容）</span>';
            return;
        }
        
        if (state.editMode) {
            mainContent.innerHTML = `<div class="editable-content" contenteditable="true">${escapeHtml(text)}</div>`;
            mainContent.querySelector('.editable-content').focus();
        } else {
            const lines = text.split('\n');
            let html = '';
            lines.forEach((line, i) => {
                if (line.trim() === '') {
                    html += '<br>';
                } else {
                    const lineNum = (state.currentPage - 1) * state.pageSize + i + 1;
                    html += `<div class="text-line" data-line="${lineNum}">${escapeHtml(line)}</div>`;
                }
            });
            
            mainContent.innerHTML = html;
            
            mainContent.querySelectorAll('.text-line').forEach(el => {
                el.addEventListener('mouseup', handleTextSelection);
                el.addEventListener('dblclick', handleTextSelection);
            });
        }
    }

    // ===== Pagination =====
    function updatePagination() {
        pageInput.value = state.currentPage;
        pageInput2.value = state.currentPage;
        totalPagesEl.textContent = state.totalPages;
        totalPagesEl2.textContent = state.totalPages;
    }

    async function goToPage(page) {
        page = Math.max(1, Math.min(page, state.totalPages));
        if (page === state.currentPage) return;
        
        // Save AI chat history before navigating
        await saveAiChatHistory();
        
        // Exit edit mode when navigating
        if (state.editMode) {
            exitEditMode();
        }
        await loadPage(page);
        
        // Load AI chat history for new page
        await loadAiChatHistory();
    }

    // ===== Text Selection Handler =====
    let selectionTimeout = null;

    function handleTextSelection(e) {
        clearTimeout(selectionTimeout);
        selectionTimeout = setTimeout(() => {
            const selection = window.getSelection();
            const selectedText = selection.toString().trim();
            if (selectedText) {
                lookupSelectedWord(selectedText);
            }
        }, 300);
    }

    document.addEventListener('selectionchange', debounce(() => {
        if (state.editMode) return;
        
        const selection = window.getSelection();
        const selectedText = selection.toString().trim();
        
        if (selectedText && selectedText.length > 0) {
            clearTimeout(selectionTimeout);
            selectionTimeout = setTimeout(() => {
                lookupSelectedWord(selectedText);
            }, 400);
        }
    }, 200));

    async function lookupSelectedWord(word) {
        // Detect if selected text is Chinese or English
        const lang = isChineseOrEnglish(word);
        
        if (lang === 'zh' || lang === 'en') {
            // Chinese/English selection → reverse search
            try {
                const resp = await fetch(`/api/dict/reverse-search?q=${encodeURIComponent(word)}`);
                const data = await resp.json();
                
                if (data.results && data.results.length > 0) {
                    // Show first result as popup
                    showDictPopup(data.results[0]);
                    return;
                }
            } catch (e) {
                // Fall through
            }
        } else {
            // Tibetan selection → normal lookup
            try {
                const resp = await fetch(`/api/dict/lookup?word=${encodeURIComponent(word)}`);
                const data = await resp.json();
                
                if (data.exact_match) {
                    showDictPopup(data.exact_match);
                    return;
                }
                
                if (data.fuzzy_results && data.fuzzy_results.length > 0) {
                    showDictPopup(data.fuzzy_results[0]);
                    return;
                }
            } catch (e) {
                // Fall through
            }
        }

        // Fallback: try Google Translate
        try {
            const resp = await fetch('/api/translate', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({text: word}),
            });
            if (resp.ok) {
                const data = await resp.json();
                if (data.translated) {
                    showTranslatePopup(word, data.translated);
                    return;
                }
            }
        } catch (e) {
            // Ignore
        }
    }

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

    function showDictPopup(entry) {
        const popup = document.createElement('div');
        popup.className = 'dict-popup';
        // Add a label for reverse search results
        const reverseLabel = entry.match_type === 'reverse' ? '<div class="dict-popup-label">🔁 反查结果</div>' : '';
        popup.innerHTML = `
            ${reverseLabel}
            <div class="dict-popup-tibetan">${escapeHtml(entry.tibetan)}</div>
            <div class="dict-popup-meanings">
                ${formatPosTag(entry)}
                ${formatSourceTag(entry.source)}
                ${formatMeaning(entry)}
            </div>
        `;
        
        const selection = window.getSelection();
        if (selection.rangeCount > 0) {
            const rect = selection.getRangeAt(0).getBoundingClientRect();
            popup.style.left = Math.min(rect.left, window.innerWidth - 370) + 'px';
            popup.style.top = (rect.bottom + 8) + 'px';
        } else {
            popup.style.left = '50%';
            popup.style.top = '50%';
            popup.style.transform = 'translate(-50%, -50%)';
        }
        
        document.body.appendChild(popup);
        
        setTimeout(() => {
            document.addEventListener('click', function removePopup(e) {
                if (!popup.contains(e.target)) {
                    popup.remove();
                    document.removeEventListener('click', removePopup);
                }
            });
        }, 100);
    }

    function showTranslatePopup(original, translated) {
        const popup = document.createElement('div');
        popup.className = 'dict-popup';
        popup.innerHTML = `
            <div class="dict-popup-tibetan">${escapeHtml(original)}</div>
            <div class="dict-popup-meanings">
                <span class="dict-source-tag dict-source-zh">🌐</span>
                <span class="dict-meaning-zh">${escapeHtml(translated)}</span>
            </div>
        `;
        
        const selection = window.getSelection();
        if (selection.rangeCount > 0) {
            const rect = selection.getRangeAt(0).getBoundingClientRect();
            popup.style.left = Math.min(rect.left, window.innerWidth - 370) + 'px';
            popup.style.top = (rect.bottom + 8) + 'px';
        }
        
        document.body.appendChild(popup);
        
        setTimeout(() => {
            document.addEventListener('click', function removePopup(e) {
                if (!popup.contains(e.target)) {
                    popup.remove();
                    document.removeEventListener('click', removePopup);
                }
            });
        }, 100);
    }

    // ===== Edit Mode =====
    function enterEditMode() {
        state.editMode = true;
        btnEdit.style.display = 'none';
        btnSave.style.display = 'inline-block';
        btnCancelEdit.style.display = 'inline-block';
        renderContent(state.originalContent);
        showSuccess('编辑模式 - 可直接修改文本内容');
    }

    function exitEditMode() {
        state.editMode = false;
        btnEdit.style.display = 'inline-block';
        btnSave.style.display = 'none';
        btnCancelEdit.style.display = 'none';
        loadPage(state.currentPage);
    }

    async function saveEdits() {
        const editableDiv = mainContent.querySelector('.editable-content');
        if (!editableDiv) return;
        
        const content = editableDiv.innerText;
        
        try {
            const resp = await fetch('/api/texts/save', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    collection_id: state.currentCollection,
                    page_num: state.currentPage,
                    content: content,
                }),
            });
            
            if (resp.ok) {
                const data = await resp.json();
                showSuccess(data.message || '保存成功');
                exitEditMode();
            } else {
                const err = await resp.json();
                showError(err.error || '保存失败');
            }
        } catch (e) {
            showError('保存失败: ' + e.message);
        }
    }

    // ===== PDF Toggle (1:1 layout) =====
    function togglePdf() {
        state.pdfOpen = !state.pdfOpen;
        const btn = $('btnTogglePdf');
        
        if (state.pdfOpen) {
            pdfArea.classList.add('visible');
            mainLayout.classList.add('pdf-open');
            btn.title = '关闭PDF对照';
            btn.textContent = '📄 PDF';
            loadPage(state.currentPage);
        } else {
            pdfArea.classList.remove('visible');
            mainLayout.classList.remove('pdf-open');
            btn.title = '打开PDF对照 (Ctrl+P)';
            btn.textContent = '📄 PDF';
            pdfViewer.innerHTML = '';
        }
    }

    // ===== PDF Sync =====
    function syncPdfWithPage(pageNum, pageMapping) {
        if (!pageMapping || pageMapping.length === 0) return;
        
        const mapping = pageMapping[pageNum - 1];
        if (!mapping) return;
        
        const pdfGroup = mapping.pdf_group;
        const pdfPage = mapping.pdf_page;
        const pdfFile = mapping.pdf_file;
        
        if (!pdfGroup || !pdfPage) return;
        
        state.currentPdfGroup = pdfGroup;
        state.currentPdfPage = pdfPage;
        loadPdfPage(pdfGroup, pdfPage, pdfFile);
    }

    async function loadPdfPage(groupName, pageNum, pdfFile) {
        if (!groupName || !pageNum) return;
        
        if (!pdfFile) {
            pdfFile = groupName + '.pdf';
        }
        pdfPageInfo.textContent = `${groupName} · 第 ${pageNum} 页`;
        
        try {
            pdfViewer.innerHTML = '<div class="placeholder">加载PDF中…</div>';
            const imgUrl = `/api/pdf/page?file=${encodeURIComponent(pdfFile)}&page=${pageNum}`;
            
            const testResp = await fetch(imgUrl);
            if (!testResp.ok) {
                pdfViewer.innerHTML = `<div class="placeholder">⚠ 无法加载PDF页面 (${groupName} 第${pageNum}页)</div>`;
                return;
            }
            
            pdfViewer.innerHTML = `<img src="${imgUrl}" alt="${groupName} page ${pageNum}" loading="lazy">`;
        } catch (e) {
            pdfViewer.innerHTML = `<div class="placeholder">⚠ PDF加载失败: ${e.message}</div>`;
        }
    }

    // ===== Floating Dict Overlay =====
    function showDictOverlay() {
        dictOverlay.style.display = 'flex';
        setTimeout(() => dictSearchInput.focus(), 100);
    }

    function hideDictOverlay() {
        dictOverlay.style.display = 'none';
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

    // ===== Helper: detect if input is Chinese or English =====
    function isChineseOrEnglish(text) {
        const chineseRegex = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/;
        if (chineseRegex.test(text)) return 'zh';
        const asciiRegex = /^[a-zA-Z\s]+$/;
        if (asciiRegex.test(text)) return 'en';
        return 'tibetan';
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

    const debouncedDictSearch = debounce(dictSearch, 200);

    // ===== Floating Search Overlay =====
    function showSearchOverlay() {
        searchOverlay.style.display = 'flex';
        setTimeout(() => searchInput.focus(), 100);
    }

    function hideSearchOverlay() {
        searchOverlay.style.display = 'none';
        searchInput.value = '';
        searchResults.innerHTML = '';
        searchCount.textContent = '';
    }

    async function performSearch() {
        const query = searchInput.value.trim();
        if (!query) return;
        
        try {
            const resp = await fetch(`/api/text/search?q=${encodeURIComponent(query)}&collection=${encodeURIComponent(state.currentCollection)}`);
            if (!resp.ok) throw new Error('Search failed');
            const data = await resp.json();
            
            state.searchResults = data.results;
            state.currentSearchIndex = -1;
            
            if (data.total === 0) {
                searchResults.innerHTML = '<div class="search-no-results">未找到匹配结果</div>';
                searchCount.textContent = '0 结果';
                return;
            }
            
            searchCount.textContent = `${data.total} 结果`;
            
            let html = '';
            data.results.slice(0, 50).forEach((r, i) => {
                const before = escapeHtml(r.context_before.slice(-40));
                const after = escapeHtml(r.context_after.slice(0, 40));
                html += `<div class="search-result-item" data-index="${i}">
                    <div class="result-context">${before}<span class="match-highlight">${escapeHtml(query)}</span>${after}</div>
                    <div class="result-line">第 ${r.page} 页 · 第 ${r.line} 行</div>
                </div>`;
            });
            
            if (data.results.length > 50) {
                html += `<div class="search-no-results">… 还有 ${data.results.length - 50} 个结果</div>`;
            }
            
            searchResults.innerHTML = html;
            
            searchResults.querySelectorAll('.search-result-item').forEach(el => {
                el.addEventListener('click', () => {
                    const idx = parseInt(el.dataset.index);
                    const result = data.results[idx];
                    if (result) {
                        goToPage(result.page);
                        hideSearchOverlay();
                    }
                });
            });
        } catch (e) {
            searchResults.innerHTML = '<div class="search-no-results">搜索出错</div>';
        }
    }

    // ===== AI Chat (bottom section) =====
    function getSelectedText() {
        const selection = window.getSelection();
        return selection.toString().trim();
    }

    function updateAiContext(text) {
        state.aiSelectedText = text;
        if (text) {
            aiContextText.textContent = text;
            aiContext.style.display = 'flex';
        } else {
            aiContextText.textContent = '';
            aiContext.style.display = 'none';
        }
    }

    function addAiMessage(role, content) {
        const msgDiv = document.createElement('div');
        msgDiv.className = `ai-message ai-message-${role}`;
        msgDiv.innerHTML = `<div class="ai-msg-content">${escapeHtml(content)}</div>`;
        aiMessages.appendChild(msgDiv);
        aiMessages.scrollTop = aiMessages.scrollHeight;
    }

    function addAiLoadingMessage() {
        const msgDiv = document.createElement('div');
        msgDiv.className = 'ai-message ai-message-assistant ai-msg-loading';
        msgDiv.id = 'aiLoadingMsg';
        msgDiv.innerHTML = '<div class="ai-msg-content">思考中…</div>';
        aiMessages.appendChild(msgDiv);
        aiMessages.scrollTop = aiMessages.scrollHeight;
    }

    function removeAiLoadingMessage() {
        const loading = document.getElementById('aiLoadingMsg');
        if (loading) loading.remove();
    }

    function updateAiStatus(msg, isError) {
        aiStatus.textContent = msg;
        aiStatus.style.color = isError ? 'var(--danger)' : 'var(--text-muted)';
        if (msg) {
            setTimeout(() => { aiStatus.textContent = ''; }, 5000);
        }
    }

    function toggleAiSection() {
        state.aiOpen = !state.aiOpen;
        if (state.aiOpen) {
            aiSection.classList.add('visible');
            const text = getSelectedText();
            if (text) {
                updateAiContext(text);
            }
            setTimeout(() => aiChatInput.focus(), 100);
        } else {
            aiSection.classList.remove('visible');
        }
    }

    async function loadAiChatHistory() {
        if (!state.currentCollection) return;
        
        try {
            const resp = await fetch(`/api/ai/history?collection=${encodeURIComponent(state.currentCollection)}&page=${state.currentPage}`);
            if (!resp.ok) return;
            const data = await resp.json();
            
            // Clear current messages
            aiMessages.innerHTML = '';
            state.aiChatHistory = data.history || [];
            
            // Re-render messages
            if (state.aiChatHistory.length === 0) {
                addAiMessage('system', '选择文本后点击「解释」或「翻译」，或在下方输入问题。');
            } else {
                state.aiChatHistory.forEach(msg => {
                    addAiMessage(msg.role, msg.content);
                });
            }
        } catch (e) {
            console.error('Failed to load AI chat history:', e);
        }
    }

    async function saveAiChatHistory() {
        if (!state.currentCollection || state.aiChatHistory.length === 0) return;
        
        try {
            await fetch('/api/ai/history/save', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    collection: state.currentCollection,
                    page: state.currentPage,
                    messages: state.aiChatHistory,
                }),
            });
        } catch (e) {
            console.error('Failed to save AI chat history:', e);
        }
    }

    async function clearAiChatHistory() {
        if (!state.currentCollection) return;
        
        try {
            await fetch('/api/ai/history/clear', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    collection: state.currentCollection,
                    page: state.currentPage,
                }),
            });
        } catch (e) {
            console.error('Failed to clear AI chat history:', e);
        }
        
        state.aiChatHistory = [];
        aiMessages.innerHTML = '';
        addAiMessage('system', '对话已清除。选择文本后点击「解释」或「翻译」，或在下方输入问题。');
        updateAiStatus('对话已清除', false);
    }

    async function sendAiMessage(message, showLoading = true) {
        if (!message.trim()) return;
        
        addAiMessage('user', message);
        state.aiChatHistory.push({role: 'user', content: message});
        
        if (showLoading) {
            addAiLoadingMessage();
        }
        
        try {
            const resp = await fetch('/api/ai/chat', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    message: message,
                    history: state.aiChatHistory.slice(-10),
                    stream: false,
                }),
            });
            
            removeAiLoadingMessage();
            
            if (!resp.ok) {
                const err = await resp.json();
                addAiMessage('error', err.error || '请求失败');
                return;
            }
            
            const data = await resp.json();
            if (data.error) {
                addAiMessage('error', data.error);
                return;
            }
            
            addAiMessage('assistant', data.content);
            state.aiChatHistory.push({role: 'assistant', content: data.content});
            
            // Auto-save after each exchange
            await saveAiChatHistory();
            
        } catch (e) {
            removeAiLoadingMessage();
            addAiMessage('error', '网络错误: ' + e.message);
        }
    }

    async function handleAiExplain() {
        const text = state.aiSelectedText || getSelectedText();
        if (!text) {
            updateAiStatus('请先选择文本', true);
            return;
        }
        updateAiContext(text);
        await sendAiMessage(`请解释以下藏文文本的含义：\n\n${text}\n\n请给出：1) 字面翻译 2) 关键术语解释 3) 医学/文化背景（如适用）`);
    }

    async function handleAiTranslate() {
        const text = state.aiSelectedText || getSelectedText();
        if (!text) {
            updateAiStatus('请先选择文本', true);
            return;
        }
        updateAiContext(text);
        await sendAiMessage(`请将以下藏文翻译为中文：\n\n${text}\n\n直接给出翻译结果。`);
    }

    async function handleAiSummarize() {
        const content = state.originalContent;
        if (!content || content.trim() === '') {
            updateAiStatus('当前页面无内容', true);
            return;
        }
        await sendAiMessage(`请总结以下藏文典籍页面的主要内容（用中文）：\n\n${content.slice(0, 2000)}`);
    }

    async function handleAiSend() {
        const message = aiChatInput.value.trim();
        if (!message) return;
        aiChatInput.value = '';
        await sendAiMessage(message);
    }

    // ===== Event Listeners =====

    // Pagination (top)
    $('btnFirstPage').addEventListener('click', () => goToPage(1));
    $('btnPrevPage').addEventListener('click', () => goToPage(state.currentPage - 1));
    $('btnNextPage').addEventListener('click', () => goToPage(state.currentPage + 1));
    $('btnLastPage').addEventListener('click', () => goToPage(state.totalPages));
    
    pageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const page = parseInt(pageInput.value);
            if (!isNaN(page)) goToPage(page);
        }
    });

    // Pagination (bottom)
    $('btnFirstPage2').addEventListener('click', () => goToPage(1));
    $('btnPrevPage2').addEventListener('click', () => goToPage(state.currentPage - 1));
    $('btnNextPage2').addEventListener('click', () => goToPage(state.currentPage + 1));
    $('btnLastPage2').addEventListener('click', () => goToPage(state.totalPages));
    
    pageInput2.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const page = parseInt(pageInput2.value);
            if (!isNaN(page)) goToPage(page);
        }
    });

    // PDF toggle (1:1 layout)
    $('btnTogglePdf').addEventListener('click', togglePdf);
    $('btnClosePdf').addEventListener('click', togglePdf);

    // Edit / Save / Cancel
    btnEdit.addEventListener('click', enterEditMode);
    btnSave.addEventListener('click', saveEdits);
    btnCancelEdit.addEventListener('click', exitEditMode);

    // Dictionary (floating overlay)
    $('btnDict').addEventListener('click', () => {
        if (dictOverlay.style.display === 'flex') {
            hideDictOverlay();
        } else {
            showDictOverlay();
        }
    });
    $('btnDictClose').addEventListener('click', hideDictOverlay);
    $('btnDictSearch').addEventListener('click', dictSearch);
    dictSearchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') dictSearch();
    });
    dictSearchInput.addEventListener('input', debouncedDictSearch);
    // Close overlay on backdrop click
    dictOverlay.addEventListener('click', (e) => {
        if (e.target === dictOverlay) hideDictOverlay();
    });

    // Search (floating overlay)
    $('btnSearch').addEventListener('click', () => {
        if (searchOverlay.style.display === 'flex') {
            hideSearchOverlay();
        } else {
            showSearchOverlay();
        }
    });
    $('btnSearchClose').addEventListener('click', hideSearchOverlay);
    searchInput.addEventListener('input', debounce(performSearch, 300));
    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') performSearch();
    });
    // Close overlay on backdrop click
    searchOverlay.addEventListener('click', (e) => {
        if (e.target === searchOverlay) hideSearchOverlay();
    });

    // AI Section (bottom)
    $('btnAi').addEventListener('click', toggleAiSection);
    $('btnAiClose').addEventListener('click', toggleAiSection);
    $('btnAiClear').addEventListener('click', clearAiChatHistory);

    $('btnAiSettings').addEventListener('click', () => {
        window.open('/', '_blank');
        updateAiStatus('请在首页设置 AI 配置', false);
    });

    $('btnAiExplain').addEventListener('click', handleAiExplain);
    $('btnAiTranslate').addEventListener('click', handleAiTranslate);
    $('btnAiSummarize').addEventListener('click', handleAiSummarize);
    $('btnAiSend').addEventListener('click', handleAiSend);

    aiChatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleAiSend();
        }
    });

    // Listen for text selection to update AI context
    document.addEventListener('selectionchange', debounce(() => {
        if (state.editMode) return;
        if (!state.aiOpen) return;
        
        const text = getSelectedText();
        if (text) {
            updateAiContext(text);
        }
    }, 300));

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.key === 'f') {
            e.preventDefault();
            if (searchOverlay.style.display === 'flex') {
                hideSearchOverlay();
            } else {
                showSearchOverlay();
            }
        }
        if (e.ctrlKey && e.key === 'd') {
            e.preventDefault();
            if (dictOverlay.style.display === 'flex') {
                hideDictOverlay();
            } else {
                showDictOverlay();
            }
        }
        if (e.ctrlKey && e.key === 'i') {
            e.preventDefault();
            toggleAiSection();
        }
        if (e.ctrlKey && e.key === 'p') {
            e.preventDefault();
            togglePdf();
        }
        if (e.key === 'ArrowLeft' && !e.ctrlKey && !e.metaKey) {
            goToPage(state.currentPage - 1);
        }
        if (e.key === 'ArrowRight' && !e.ctrlKey && !e.metaKey) {
            goToPage(state.currentPage + 1);
        }
        if (e.ctrlKey && e.key === 'e') {
            e.preventDefault();
            if (state.editMode) {
                exitEditMode();
            } else {
                enterEditMode();
            }
        }
        if (e.ctrlKey && e.key === 's' && state.editMode) {
            e.preventDefault();
            saveEdits();
        }
    });

    // ===== Init =====
    async function init() {
        setStatus('加载典籍信息…');
        const coll = await loadCollectionInfo();
        if (coll) {
            showSuccess(`已加载「${coll.title_cn}」`);
            await loadPage(1);
            // Load AI chat history for page 1
            await loadAiChatHistory();
        } else {
            showError('无法加载典籍信息');
        }
    }

    init();

})();
