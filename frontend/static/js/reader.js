/**
 * Tibetan Reader - Reading Page
 * Full-width reading with optional PDF sidebar, dictionary lookup, search.
 * Features: editable text, selection-based translation, PDF sync.
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
    };

    // ===== DOM References =====
    const $ = (id) => document.getElementById(id);
    const mainContent = $('mainContent');
    const pageInput = $('pageInput');
    const totalPagesEl = $('totalPages');
    const statusMsg = $('statusMsg');
    const readerTitle = $('readerTitle');
    const pageProgress = $('pageProgress');
    const searchPanel = $('searchPanel');
    const searchInput = $('searchInput');
    const searchCount = $('searchCount');
    const searchResults = $('searchResults');
    const dictPanel = $('dictPanel');
    const dictSearchInput = $('dictSearchInput');
    const dictSearchResult = $('dictSearchResult');
    const readingArea = $('readingArea');
    const pdfPane = $('pdfPane');
    const pdfViewer = $('pdfViewer');
    const pdfPageInfo = $('pdfPageInfo');
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
            
            // Sync PDF immediately if open (no delay)
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
            // Editable mode: use contenteditable div
            mainContent.innerHTML = `<div class="editable-content" contenteditable="true">${escapeHtml(text)}</div>`;
            mainContent.querySelector('.editable-content').focus();
        } else {
            // Read mode: render as lines
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
            
            // Add handlers for word lookup
            mainContent.querySelectorAll('.text-line').forEach(el => {
                el.addEventListener('mouseup', handleTextSelection);
                el.addEventListener('dblclick', handleTextSelection);
            });
        }
    }

    // ===== Pagination =====
    function updatePagination() {
        pageInput.value = state.currentPage;
        totalPagesEl.textContent = state.totalPages;
    }

    async function goToPage(page) {
        page = Math.max(1, Math.min(page, state.totalPages));
        if (page === state.currentPage) return;
        // Exit edit mode when navigating
        if (state.editMode) {
            exitEditMode();
        }
        await loadPage(page);
    }

    // ===== Text Selection Handler (Translation Popup) =====
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

    // Listen for selection changes (for "勾选" / selection-based translation)
    document.addEventListener('selectionchange', debounce(() => {
        if (state.editMode) return; // Don't trigger in edit mode
        
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
        // Try dictionary first
        try {
            const resp = await fetch(`/api/dict/lookup?word=${encodeURIComponent(word)}`);
            if (resp.ok) {
                const data = await resp.json();
                if (data.tibetan && data.chinese) {
                    showDictPopup(word, data.chinese);
                    return;
                }
            }
        } catch (e) {
            // Fall through
        }
        
        // Try Google Translate
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

    function showDictPopup(word, meaning) {
        const popup = document.createElement('div');
        popup.className = 'dict-popup';
        popup.innerHTML = `
            <div style="font-family:'Noto Serif Tibetan',serif;color:#5a3a1a;margin-bottom:4px;">${escapeHtml(word)}</div>
            <div style="color:#3d7a3d;">${escapeHtml(meaning)}</div>
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
            <div style="font-family:'Noto Serif Tibetan',serif;color:#5a3a1a;margin-bottom:4px;font-size:0.85rem;">藏文: ${escapeHtml(original)}</div>
            <div style="color:#3d7a3d;">汉译: ${escapeHtml(translated)}</div>
            <div style="font-size:0.7rem;color:#9b7a5a;margin-top:4px;">🌐 Google 翻译</div>
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
        // Re-render in editable mode
        renderContent(state.originalContent);
        showSuccess('编辑模式 - 可直接修改文本内容');
    }

    function exitEditMode() {
        state.editMode = false;
        btnEdit.style.display = 'inline-block';
        btnSave.style.display = 'none';
        btnCancelEdit.style.display = 'none';
        // Re-render in read mode
        loadPage(state.currentPage);
    }

    async function saveEdits() {
        const editableDiv = mainContent.querySelector('.editable-content');
        if (!editableDiv) return;
        
        // Get text content (preserve line breaks)
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
                const errText = await testResp.text();
                pdfViewer.innerHTML = `<div class="placeholder">⚠ 无法加载PDF页面 (${groupName} 第${pageNum}页)</div>`;
                return;
            }
            
            pdfViewer.innerHTML = `<img src="${imgUrl}" alt="${groupName} page ${pageNum}" loading="lazy">`;
        } catch (e) {
            pdfViewer.innerHTML = `<div class="placeholder">⚠ PDF加载失败: ${e.message}</div>`;
        }
    }

    // ===== Toggle PDF =====
    function togglePdf() {
        state.pdfOpen = !state.pdfOpen;
        const btn = $('btnTogglePdf');
        
        if (state.pdfOpen) {
            readingArea.classList.add('pdf-open');
            btn.textContent = '📄 文本';
            btn.title = '切换到纯文本模式';
            // Load PDF immediately (no delay)
            syncPdfWithPage(state.currentPage, null);
            // Re-fetch page data to get page_mapping and sync PDF
            loadPage(state.currentPage);
        } else {
            readingArea.classList.remove('pdf-open');
            btn.textContent = '📄 对照';
            btn.title = '打开PDF对照面板';
            pdfViewer.innerHTML = '';
        }
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

    // ===== Search =====
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
                        searchPanel.classList.remove('visible');
                    }
                });
            });
        } catch (e) {
            searchResults.innerHTML = '<div class="search-no-results">搜索出错</div>';
        }
    }

    // ===== Event Listeners =====
    
    // Pagination
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

    // PDF toggle
    $('btnTogglePdf').addEventListener('click', togglePdf);
    $('btnClosePdf').addEventListener('click', togglePdf);

    // Edit / Save / Cancel
    btnEdit.addEventListener('click', enterEditMode);
    btnSave.addEventListener('click', saveEdits);
    btnCancelEdit.addEventListener('click', exitEditMode);

    // Dictionary
    $('btnDict').addEventListener('click', () => {
        dictPanel.classList.toggle('visible');
        if (dictPanel.classList.contains('visible')) {
            dictSearchInput.focus();
        }
    });
    $('btnDictSearch').addEventListener('click', dictSearch);
    dictSearchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') dictSearch();
    });

    // Search
    $('btnSearch').addEventListener('click', () => {
        searchPanel.classList.toggle('visible');
        if (searchPanel.classList.contains('visible')) {
            searchInput.focus();
        }
    });
    $('btnSearchClose').addEventListener('click', () => {
        searchPanel.classList.remove('visible');
        searchInput.value = '';
        searchResults.innerHTML = '';
        searchCount.textContent = '';
    });
    searchInput.addEventListener('input', debounce(performSearch, 300));
    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') performSearch();
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.key === 'f') {
            e.preventDefault();
            searchPanel.classList.toggle('visible');
            if (searchPanel.classList.contains('visible')) searchInput.focus();
        }
        if (e.key === 'ArrowLeft' && !e.ctrlKey && !e.metaKey) {
            if (searchPanel.classList.contains('visible')) return;
            goToPage(state.currentPage - 1);
        }
        if (e.key === 'ArrowRight' && !e.ctrlKey && !e.metaKey) {
            if (searchPanel.classList.contains('visible')) return;
            goToPage(state.currentPage + 1);
        }
        // Ctrl+E to toggle edit mode
        if (e.ctrlKey && e.key === 'e') {
            e.preventDefault();
            if (state.editMode) {
                exitEditMode();
            } else {
                enterEditMode();
            }
        }
        // Ctrl+S to save in edit mode
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
        } else {
            showError('无法加载典籍信息');
        }
    }

    init();

})();
