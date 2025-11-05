// Annotation Constants
const ANNOTATION_CONFIG = {
    strokeStyle: '#ef4444',
    lineWidth: 3,
    lineCap: 'round',
    lineJoin: 'round'
};

// Do not register chat in the sidebar here; chat will be rendered into Live mode's chat module
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// small visual flash on a sidebar thumb when its content changes
function flashThumb(pageId) {
    try {
        const container = document.getElementById('sidebar-thumbs');
        if (!container) return;
        const el = container.querySelector(`.sidebar-thumb[data-page-id="${pageId}"]`);
        if (!el) return;
        // restart animation
        el.classList.remove('flash');
        // force reflow to restart CSS animation
        // eslint-disable-next-line no-unused-expressions
        void el.offsetWidth;
        el.classList.add('flash');
        setTimeout(() => { try { el.classList.remove('flash'); } catch (e) {} }, 900);
        // also try to flash any live-mode thumbnail that corresponds to the same chart
        try {
            if (window._pageManager) {
                const p = window._pageManager.getPage(pageId);
                if (p && p.chartId) {
                    const liveEl = document.querySelector(`.live-thumb[data-chart-id="${p.chartId}"]`);
                    if (liveEl) {
                        liveEl.style.position = liveEl.style.position || 'relative';
                        let lb = liveEl.querySelector('.thumb-changed-badge');
                        if (!lb) { lb = document.createElement('div'); lb.className = 'thumb-changed-badge'; lb.textContent = 'Updated'; liveEl.appendChild(lb); }
                        liveEl.classList.remove('flash'); void liveEl.offsetWidth; liveEl.classList.add('flash');
                        setTimeout(() => { try { liveEl.classList.remove('flash'); } catch (e) {} }, 900);
                    }
                }
            }
        } catch (e) {}
    } catch (e) {}
}

// Application State
const AppState = {
    currentPage: 'landing',
    sessionCode: null,
    isDirector: false,
    charts: [],
    currentChartIndex: 0,
    currentPageNumber: 1,
    // viewMode: 'edit' | 'live' | 'organize'
    viewMode: 'edit',
    annotationMode: false,
    annotations: {},
    currentStroke: null,
    canvas: null,
    context: null,
    annotationCanvas: null,
    annotationContext: null,
    isDrawing: false,
    lastX: 0,
    lastY: 0
};
// per-page undo stacks for PageManager-based annotations
AppState.pageUndoStacks = {};

// Live mode polling config
const LIVE_POLL_INTERVAL_MS = 3000; // 3s poll interval for chart updates
let _livePollTimer = null;
let _ws = null;
let _highlightObserver = null;

// Server base URL for API calls. Can be overridden by setting window.SERVER_BASE
const SERVER_BASE = (function(){
    if (typeof window !== 'undefined' && window.SERVER_BASE) return window.SERVER_BASE;
    try {
        const saved = localStorage.getItem('serverBase');
        if (saved) return saved;
    } catch(e) {}
    return 'http://localhost:3000';
})();

// Feature flags (can be set on window before scripts load)
// Set window.FEATURE_PAGE_MANAGER = false to disable PageManager usage.
const FEATURE_PAGE_MANAGER = (typeof window !== 'undefined' && typeof window.FEATURE_PAGE_MANAGER !== 'undefined') ? Boolean(window.FEATURE_PAGE_MANAGER) : true;

// Session Management
function generateSessionCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    const randomValues = new Uint8Array(6);
    crypto.getRandomValues(randomValues);
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(randomValues[i] % chars.length);
    }
    return code;
}

function createSession() {
    console.log('createSession() called');
    // Try to create session server-side; fallback to client-only session if unavailable
    (async () => {
        try {
            const res = await fetch(`${SERVER_BASE}/api/sessions`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
            if (res.ok) {
                const j = await res.json();
                AppState.sessionCode = j.code;
                AppState.isDirector = true;
                // Save director token locally to authenticate director actions later
                localStorage.setItem(`session_${j.code}_directorToken`, j.directorToken);
                // Save currentSession for demo persistence
                localStorage.setItem('currentSession', JSON.stringify({ code: j.code, isDirector: true, charts: [] }));
            } else {
                // fallback
                AppState.sessionCode = generateSessionCode();
                AppState.isDirector = true;
                localStorage.setItem('currentSession', JSON.stringify({ code: AppState.sessionCode, isDirector: true, charts: [] }));
            }
        } catch (e) {
            // network/server unavailable - fallback to client-only session
            AppState.sessionCode = generateSessionCode();
            AppState.isDirector = true;
            localStorage.setItem('currentSession', JSON.stringify({ code: AppState.sessionCode, isDirector: true, charts: [] }));
        }

    showPage('upload');
        const uploadCodeEl = document.getElementById('session-code-display');
        if (uploadCodeEl) uploadCodeEl.textContent = AppState.sessionCode;
        const viewerCodeTextEl = document.getElementById('viewer-session-code-text');
        if (viewerCodeTextEl) viewerCodeTextEl.textContent = `Session: ${AppState.sessionCode}`;
        // Update UI to reflect director privileges
        updateRoleUI();
        // If a live websocket exists, subscribe to this session so viewers receive updates
        try { if (_ws && _ws.readyState === WebSocket.OPEN) _ws.send(JSON.stringify({ type: 'subscribe', session: AppState.sessionCode })); } catch (e) {}
    })();
}

function joinSession() {
    const input = document.getElementById('session-code-input');
    const code = input.value.trim().toUpperCase();
    
    if (code.length !== 6) {
        alert('Please enter a valid 6-character session code');
        return;
    }
    
    // Load any locally cached session data (server lookup will be attempted below)
    const sessionData = localStorage.getItem(`session_${code}`);
    
    AppState.sessionCode = code;
    // If this client has the saved director token for this session, treat as director locally
    const localToken = localStorage.getItem(`session_${code}_directorToken`);
    AppState.isDirector = !!localToken;

    const viewerCodeTextEl = document.getElementById('viewer-session-code-text');
    if (viewerCodeTextEl) viewerCodeTextEl.textContent = `Session: ${AppState.sessionCode}`;

    // Try to fetch session from server; fall back to localStorage
    (async () => {
        try {
            const res = await fetch(`${SERVER_BASE}/api/sessions/${code}`);
            if (res.ok) {
                const j = await res.json();
                AppState.charts = j.charts || [];
            } else if (sessionData) {
                const session = JSON.parse(sessionData);
                AppState.charts = session.charts || [];
            }
        } catch (e) {
            if (sessionData) {
                const session = JSON.parse(sessionData);
                AppState.charts = session.charts || [];
            }
        }

        // Update UI for attendee (hide director-only controls)
        updateRoleUI();

        if (AppState.charts.length > 0) {
            showPage('viewer');
            // Attendees should see Live mode by default
            switchToMode('live');
            renderCurrentChart();
            // ensure websocket subscription for live updates
            try { if (_ws && _ws.readyState === WebSocket.OPEN) _ws.send(JSON.stringify({ type: 'subscribe', session: AppState.sessionCode })); } catch (e) {}
        } else {
            alert('This session has no charts yet. Please wait for the Music Director to upload charts.');
        }
    })();
}

function startSession() {
    console.log('startSession() called', { sessionCode: AppState.sessionCode, chartsCount: AppState.charts.length });

    if (AppState.charts.length === 0) {
        alert('Please upload at least one PDF before starting the session');
        return;
    }

    // Ensure there's a session code (allow starting without explicitly clicking "Create Session")
    if (!AppState.sessionCode) {
        AppState.sessionCode = generateSessionCode();
        AppState.isDirector = true;
        const codeEl = document.getElementById('session-code-display');
        if (codeEl) codeEl.textContent = AppState.sessionCode;
    const viewerCodeTextEl = document.getElementById('viewer-session-code-text');
    if (viewerCodeTextEl) viewerCodeTextEl.textContent = `Session: ${AppState.sessionCode}`;
        console.info('Generated session code for startSession:', AppState.sessionCode);
    }

    // Save session data: try server first (requires director token), fallback to localStorage
    (async () => {
        const directorToken = localStorage.getItem(`session_${AppState.sessionCode}_directorToken`);
        if (directorToken) {
            try {
                const res = await fetch(`${SERVER_BASE}/api/sessions/${AppState.sessionCode}/charts`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'x-director-token': directorToken },
                    body: JSON.stringify({ charts: AppState.charts })
                });
                if (!res.ok) throw new Error('server save failed');
                localStorage.setItem('currentSession', JSON.stringify({ code: AppState.sessionCode, isDirector: true, charts: AppState.charts }));
            } catch (e) {
                console.warn('Failed to save charts to server, falling back to localStorage', e);
                try { localStorage.setItem(`session_${AppState.sessionCode}`, JSON.stringify({ code: AppState.sessionCode, charts: AppState.charts })); } catch (err) {}
            }
        } else {
            try { localStorage.setItem(`session_${AppState.sessionCode}`, JSON.stringify({ code: AppState.sessionCode, charts: AppState.charts })); } catch (err) {}
        }

        // Navigate to viewer and render the first chart, but guard rendering errors
        try {
            // Ensure this user is marked as the director when starting
            AppState.isDirector = true;
            // Update role-based UI (show edit/organize for directors)
            updateRoleUI();
            showPage('viewer');
            // Ensure viewer shows edit mode for directors
            switchToMode('edit');
            renderCurrentChart();
            console.log('startSession completed: viewer shown');
        } catch (err) {
            console.error('Error while rendering viewer after startSession:', err);
            alert('An error occurred while starting the session. Check the console for details.');
        }
    })();
}

function leaveSession() {
    if (confirm('Are you sure you want to leave this session?')) {
        // Reset state
        // stop live socket if active
        stopLiveSocket();
        AppState.charts = [];
        AppState.currentChartIndex = 0;
        AppState.currentPageNumber = 1;
        AppState.sessionCode = null;
        AppState.isDirector = false;
    const viewerCodeTextEl = document.getElementById('viewer-session-code-text');
    if (viewerCodeTextEl) viewerCodeTextEl.textContent = '';
        const uploadCodeEl = document.getElementById('session-code-display');
        if (uploadCodeEl) uploadCodeEl.textContent = '';
        // Update UI to a neutral state (no director controls visible)
        updateRoleUI();
        showPage('landing');
    }
}

// Page Navigation
function showPage(pageName) {
    const pages = document.querySelectorAll('.page');
    pages.forEach(page => page.classList.remove('active'));
    
    const targetPage = document.getElementById(`${pageName}-page`);
    if (targetPage) {
        targetPage.classList.add('active');
        AppState.currentPage = pageName;
    }
}

// PDF Upload and Processing
function handleFileSelect(files) {
    Array.from(files).forEach(file => {
        if (file.type === 'application/pdf') {
            const reader = new FileReader();
            reader.onload = function(e) {
                addChartToSession(file.name, e.target.result);
            };
            reader.readAsDataURL(file);
        }
    });
}

function addChartToSession(name, dataUrl) {
    const chart = {
        id: Date.now() + Math.random(),
        name: name,
        data: dataUrl,
        pages: 1, // Default to 1 page (browser PDF viewer will handle pagination)
        file: null
    };
    
    AppState.charts.push(chart);
    // Update upload list (if visible) and organize grid (if active)
    displayUploadedFile(chart);
    if (AppState.viewMode === 'organize') renderOrganizeMode();
    saveSessionCharts();
}

function displayUploadedFile(chart) {
    const container = document.getElementById('uploaded-files');
    const fileItem = document.createElement('div');
    fileItem.className = 'file-item';
    fileItem.innerHTML = `
        <div class="file-info">
            <div class="file-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                    <polyline points="14 2 14 8 20 8"></polyline>
                    <line x1="16" y1="13" x2="8" y2="13"></line>
                    <line x1="16" y1="17" x2="8" y2="17"></line>
                    <polyline points="10 9 9 9 8 9"></polyline>
                </svg>
            </div>
            <div class="file-details">
                <h3>${escapeHtml(chart.name)}</h3>
                <p>${chart.pages} page${chart.pages !== 1 ? 's' : ''}</p>
            </div>
        </div>
        <div class="file-actions">
            <button data-chart-id="${chart.id}">Remove</button>
        </div>
    `;
    
    // Add event listener to remove button
    const removeBtn = fileItem.querySelector('button[data-chart-id]');
    removeBtn.addEventListener('click', function() {
        removeChart(this.dataset.chartId);
    });
    
    container.appendChild(fileItem);
}

function removeChart(chartId) {
    // Convert to number since data attributes are strings
    const id = typeof chartId === 'string' ? parseFloat(chartId) : chartId;
    AppState.charts = AppState.charts.filter(chart => chart.id !== id);
    refreshUploadedFilesList();
    // Persist and update organize view if active
    try {
        saveSessionCharts();
    } catch (err) {
        console.error('Error saving session after removeChart:', err);
    }
    if (AppState.viewMode === 'organize') {
        // adjust current chart index if needed
        if (AppState.currentChartIndex >= AppState.charts.length) {
            AppState.currentChartIndex = Math.max(0, AppState.charts.length - 1);
        }
        renderOrganizeMode();
    }
}

function refreshUploadedFilesList() {
    const container = document.getElementById('uploaded-files');
    container.innerHTML = '';
    AppState.charts.forEach(chart => displayUploadedFile(chart));
}

// PDF Rendering
function renderCurrentChart() {
    if (AppState.charts.length === 0) return;
    
    const chart = AppState.charts[AppState.currentChartIndex];
    document.getElementById('current-chart-name').textContent = chart.name;
    
    // Use iframe to display PDF with native browser viewer (Edit mode)
    const pdfViewer = document.getElementById('pdf-viewer');
    if (pdfViewer) pdfViewer.src = `${chart.data}#page=${AppState.currentPageNumber}`;
    
    // Setup annotation canvas
    const annotationCanvas = document.getElementById('annotation-canvas');
    const annotationContext = annotationCanvas.getContext('2d');
    if (!annotationContext) {
        console.error('Could not get 2d context for annotation canvas');
        return;
    }
    AppState.annotationCanvas = annotationCanvas;
    AppState.annotationContext = annotationContext;
    
    // Restore annotations if any
    restoreAnnotations();
    
    // Update page indicator
    document.getElementById('page-indicator').textContent = 
        `Chart ${AppState.currentChartIndex + 1} of ${AppState.charts.length}`;
}

// Render Live mode: continuous vertical pages with annotations and thumbnails
function renderLiveMode() {
    // Render all charts in order as a continuous scroll; thumbnails represent each page across charts.
    const pagesContainer = document.getElementById('live-pages');
    const thumbsContainer = document.querySelector('#live-thumbs-module .module-content') || document.querySelector('.live-thumbs');
    if (!pagesContainer || !thumbsContainer) return;
    pagesContainer.innerHTML = '';
    thumbsContainer.innerHTML = '';

    if (!window['pdfjsLib']) return;
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';

    // If PageManager is available, ensure charts have pageMap (split PDFs) created asynchronously
    try {
        if (window._pageManager) {
            AppState.charts.forEach(chart => {
                if (chart && !Array.isArray(chart.pageMap) && chart.data) {
                    // create pages in background; when done PageManager will emit pages:created
                    window._pageManager.createPagesFromPdf(chart).catch(() => {});
                }
            });
            // re-render when pages are created so we can pick up thumbnails/annotations
            window._pageManager.on('pages:created', function () {
                // small delay to allow per-page thumbs to populate
                setTimeout(() => { try { renderLiveMode(); } catch (e) {} }, 120);
            });
        }
    } catch (e) {}

    // Create placeholders for all charts to keep ordering stable
    AppState.charts.forEach((chart, chartIdx) => {
        const chartHeader = document.createElement('div');
        chartHeader.className = 'live-chart-header';
        chartHeader.textContent = `${chartIdx + 1}. ${chart.name}`;
        pagesContainer.appendChild(chartHeader);

        const chartBlock = document.createElement('div');
        chartBlock.className = 'live-chart-block';
        chartBlock.dataset.chartIndex = chartIdx;
        pagesContainer.appendChild(chartBlock);

        // create a thumbnail placeholder for this chart (one-per-chart, first-page)
        const thumbPlaceholder = document.createElement('div');
        thumbPlaceholder.className = 'live-thumb';
        thumbPlaceholder.dataset.chartId = chart.id;
        thumbPlaceholder.dataset.chartIndex = chartIdx;
        // add numeric badge for chart order
        const num = document.createElement('div');
        num.className = 'thumb-number';
        num.textContent = String(chartIdx + 1);
        thumbPlaceholder.appendChild(num);
        // clicking the thumb should scroll to the chart block
        thumbPlaceholder.addEventListener('click', () => {
            const target = pagesContainer.querySelector(`.live-page-wrapper[data-chart-index="${chartIdx}"]`);
            if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
        thumbsContainer.appendChild(thumbPlaceholder);

        // Prefer per-page thumbnail if PageManager has it (first page)
        if (window._pageManager && Array.isArray(chart.pageMap) && chart.pageMap.length > 0) {
            const firstPage = window._pageManager.getPage(chart.pageMap[0]);
            if (firstPage && firstPage.thumb) {
                try { const img = new Image(); img.src = firstPage.thumb; img.alt = `${chart.name} thumbnail`; thumbPlaceholder.appendChild(img); } catch (e) {}
            }
        }
        // Otherwise fall back to chart.thumb or generate via PDF.js
        if (thumbPlaceholder.querySelectorAll('img').length === 0) {
            if (chart.thumb) {
                try { const img = new Image(); img.src = chart.thumb; img.alt = `${chart.name} thumbnail`; thumbPlaceholder.appendChild(img); } catch (e) {}
            } else if (chart.data) {
                generateThumbnail(chart, 140).then(dataUrl => {
                    if (dataUrl) {
                        chart.thumb = dataUrl; // cache on chart
                        try { const img = new Image(); img.src = dataUrl; img.alt = `${chart.name} thumbnail`; thumbPlaceholder.appendChild(img); } catch (e) {}
                    }
                });
            }
        }
    });

    // For each chart, lazy-render pages and generate thumbnails for each page
    AppState.charts.forEach((chart, chartIdx) => {
        const chartBlock = pagesContainer.querySelector(`.live-chart-block[data-chart-index="${chartIdx}"]`);
        if (!chart || !chart.data || !chartBlock) return;
        chartBlock.innerHTML = '<div class="chart-loading">Loading...</div>';

        pdfjsLib.getDocument(chart.data).promise.then(pdf => {
            chartBlock.innerHTML = '';
            for (let p = 1; p <= pdf.numPages; p++) {
                const wrapper = document.createElement('div');
                wrapper.className = 'live-page-wrapper';
                // include stable chart id so we can map across reorderings
                wrapper.dataset.chartId = chart.id;
                wrapper.dataset.chartIndex = chartIdx;
                wrapper.dataset.page = p;
                wrapper.dataset.rendered = '0';
                wrapper.style.minHeight = '200px';
                chartBlock.appendChild(wrapper);
            }

            const observer = new IntersectionObserver((entries, obs) => {
                entries.forEach(entry => {
                    if (!entry.isIntersecting) return;
                    const w = entry.target;
                    const p = parseInt(w.dataset.page, 10);
                    const cIdx = parseInt(w.dataset.chartIndex, 10);
                    if (w.dataset.rendered === '1') { obs.unobserve(w); return; }

                    pdf.getPage(p).then(page => {
                        const viewport = page.getViewport({ scale: 1 });
                        const scale = Math.min(900 / viewport.width, 1);
                        const scaled = page.getViewport({ scale });
                        const canvas = document.createElement('canvas');
                        canvas.width = scaled.width;
                        canvas.height = scaled.height;
                        const ctx = canvas.getContext('2d');
                        page.render({ canvasContext: ctx, viewport: scaled }).promise.then(() => {
                            // overlay vector annotations from PageManager when available
                            try {
                                let pageId = null;
                                const chartObj = AppState.charts[cIdx];
                                if (chartObj && Array.isArray(chartObj.pageMap) && chartObj.pageMap.length >= p) {
                                    pageId = chartObj.pageMap[p - 1];
                                }
                                if (pageId && window._pageManager) {
                                    const strokes = window._pageManager.getAnnotation(pageId) || [];
                                    if (strokes && strokes.length) {
                                        try { window.PageManager_renderStrokes(ctx, strokes, 1); } catch (e) {}
                                    }
                                }
                            } catch (e) {}

                            // legacy bitmap annotations
                            const key = `${AppState.sessionCode}_${cIdx}_${p}`;
                            const ann = AppState.annotations[key];
                            if (ann) {
                                const img = new Image();
                                img.onload = () => {
                                    try { ctx.drawImage(img, 0, 0, canvas.width, canvas.height); } catch (e) {}
                                };
                                img.src = ann;
                            }

                            w.appendChild(canvas);

                            w.dataset.rendered = '1';
                            obs.unobserve(w);
                        }).catch(() => { w.dataset.rendered = '1'; obs.unobserve(w); });
                    }).catch(() => { w.dataset.rendered = '1'; obs.unobserve(w); });
                });
            }, { root: pagesContainer, rootMargin: '400px 0px', threshold: 0.01 });

            const wrappers = chartBlock.querySelectorAll('.live-page-wrapper');
            wrappers.forEach(w => observer.observe(w));
        }).catch(() => {
            chartBlock.innerHTML = '<div class="chart-error">Failed to load chart</div>';
        });
    });
    // initialize highlighting after rendering placeholders (small delay to allow DOM updates)
    setTimeout(() => { initLiveHighlighting(); }, 300);
    // Initialize layout helpers: highlighting is needed. Make the right
    // column modular and reorderable via Sortable (chat/thumbs). The
    // draggable splitter was removed because it trapped the right column
    // inside the page scroll.
    try {
        // Enable dragging modules between left and right docks
        const rightCol = document.querySelector('.live-right');
        const leftDock = document.querySelector('.live-dock-left');
        if (window.Sortable) {
            try { if (rightCol && rightCol._sortable) rightCol._sortable.destroy(); } catch (e) {}
            try { if (leftDock && leftDock._sortable) leftDock._sortable.destroy(); } catch (e) {}

            const groupOpts = { name: 'live-modules', pull: true, put: true };

            if (rightCol) {
                rightCol._sortable = Sortable.create(rightCol, {
                    group: groupOpts,
                    animation: 150,
                    swapThreshold: 0.65,
                    fallbackOnBody: true,
                    forceFallback: false,
                    ghostClass: 'sortable-ghost',
                    chosenClass: 'sortable-chosen',
                    handle: '.module-header',
                    draggable: '.live-module'
                });
            }

            if (leftDock) {
                leftDock._sortable = Sortable.create(leftDock, {
                    group: groupOpts,
                    animation: 150,
                    swapThreshold: 0.65,
                    fallbackOnBody: true,
                    forceFallback: false,
                    ghostClass: 'sortable-ghost',
                    chosenClass: 'sortable-chosen',
                    handle: '.module-header',
                    draggable: '.live-module'
                });
            }
        }
    } catch (e) {}
}

// Live layout resizer: draggable splitter between .live-pages and .live-thumbs
function initLiveResizer() {
    try {
        const splitter = document.getElementById('live-splitter');
        const pagesWrapper = document.querySelector('.live-pages-wrapper');
        const rightDock = document.querySelector('.live-right');
        if (!splitter || !pagesWrapper || !rightDock) return;

        let dragging = false;
        let startX = 0;
        let startRightWidth = rightDock.getBoundingClientRect().width;

        const minRight = 200; const maxRight = Math.max(360, window.innerWidth - 400);

        function onPointerDown(e) {
            dragging = true;
            startX = e.clientX;
            startRightWidth = rightDock.getBoundingClientRect().width;
            document.body.style.userSelect = 'none';
            document.addEventListener('pointermove', onPointerMove);
            document.addEventListener('pointerup', onPointerUp);
        }

        function onPointerMove(e) {
            if (!dragging) return;
            const dx = startX - e.clientX;
            let newRight = Math.round(startRightWidth + dx);
            if (newRight < minRight) newRight = minRight;
            if (newRight > maxRight) newRight = maxRight;
            // set the right dock flex-basis so layout updates smoothly
            rightDock.style.flex = `0 0 ${newRight}px`;
            rightDock.style.maxWidth = `${Math.max(newRight, 220)}px`;
        }

        function onPointerUp() {
            dragging = false;
            document.body.style.userSelect = '';
            document.removeEventListener('pointermove', onPointerMove);
            document.removeEventListener('pointerup', onPointerUp);
        }

        // attach once
        splitter.removeEventListener('pointerdown', onPointerDown);
        splitter.addEventListener('pointerdown', onPointerDown);
    } catch (e) {
        // non-fatal
    }
}

// Adjust the right dock's grid columns responsively so modules can sit
// side-by-side based on available width. This helps when CSS minmax
// behavior alone doesn't produce the desired number of columns.
function adjustRightDockColumns(minColWidth = 140) {
    try {
        const rightDock = document.querySelector('.live-right');
        if (!rightDock) return;
        // ensure element is using grid so grid-template-columns will apply
        try { rightDock.style.display = 'grid'; } catch (e) {}
        const rect = rightDock.getBoundingClientRect();
        const available = Math.max(0, rect.width - 12); // account for padding/gap
        const cols = Math.max(1, Math.floor(available / minColWidth));
        rightDock.style.gridTemplateColumns = `repeat(${cols}, minmax(${Math.max(96, Math.floor(minColWidth*0.8))}px, 1fr))`;
    } catch (e) {}
}

// Render the chat UI into the Live view chat module (#live-chat-module .module-content)
function renderLiveChatModule() {
    try {
        const container = document.querySelector('#live-chat-module .module-content');
        if (!container) return;
        // clear existing and build chat UI similar to sidebar module
        container.innerHTML = '';
        const msgs = document.createElement('div'); msgs.className = 'chat-messages'; container.appendChild(msgs);

        container._chatIds = new Set();
        container._pendingMap = {};

        // load recent chat history
        try {
            const sessionCode = AppState.sessionCode;
            if (sessionCode) {
                fetch(`${SERVER_BASE}/api/sessions/${sessionCode}/chat`).then(r => { if (!r.ok) throw new Error('chat fetch failed'); return r.json(); }).then(data => {
                    const list = Array.isArray(data.chat) ? data.chat : [];
                    list.forEach(m => {
                        try { if (m && m.id) container._chatIds.add(m.id); const own = (m.from === (AppState.isDirector ? 'Director' : 'Viewer')); appendToLive(msgs, m, { own, container }); } catch (e) {}
                    });
                }).catch(err => console.warn('Failed to load chat history', err));
            }
        } catch (e) {}

        // role selector
        const roleRow = document.createElement('div'); roleRow.style.display = 'flex'; roleRow.style.gap = '8px'; roleRow.style.alignItems = 'center'; roleRow.style.marginBottom = '8px';
        const roleLabel = document.createElement('div'); roleLabel.textContent = 'Role:'; roleLabel.style.fontSize = '0.85rem'; roleLabel.style.color = 'var(--text-secondary)'; roleRow.appendChild(roleLabel);
        const roleSelect = document.createElement('select'); roleSelect.className = 'chat-role-select'; ['Pastor','Worship Leader','Production','Musician'].forEach(r => { const o = document.createElement('option'); o.value = r; o.textContent = r; roleSelect.appendChild(o); }); roleRow.appendChild(roleSelect);
        container.appendChild(roleRow);
        try { const roleKey = `chat_role_${AppState.sessionCode || 'global'}`; const saved = localStorage.getItem(roleKey); if (saved) roleSelect.value = saved; } catch (e) {}
        roleSelect.addEventListener('change', () => { try { localStorage.setItem(`chat_role_${AppState.sessionCode || 'global'}`, roleSelect.value); } catch (e) {} });

        const form = document.createElement('div'); form.className = 'chat-input'; form.style.display = 'flex'; form.style.gap = '6px';
        const input = document.createElement('input'); input.type = 'text'; input.placeholder = 'Send a message to session'; input.className = 'chat-input-field'; input.style.flex = '1 1 auto';
        const sendBtn = document.createElement('button'); sendBtn.className = 'btn btn-primary'; sendBtn.textContent = 'Send';
        form.appendChild(input); form.appendChild(sendBtn); container.appendChild(form);

        function appendToLive(msgsEl, m, opts = {}) {
            try {
                if (!m) return;
                const msg = m;
                // reconcile pending
                if (msg.clientTempId && container._pendingMap && container._pendingMap[msg.clientTempId]) {
                    const pendingEl = container._pendingMap[msg.clientTempId]; pendingEl.classList.remove('pending'); try { pendingEl.dataset.msgId = msg.id; } catch (e) {}
                    try { const meta = pendingEl.querySelector('.chat-meta'); if (meta) meta.textContent = `${msg.from || msg.role || 'User'}` + (msg.role ? ` • ${msg.role}` : ''); const body = pendingEl.querySelector('.chat-body'); if (body) body.textContent = msg.text || ''; } catch (e) {}
                    if (msg.id) container._chatIds.add(msg.id); delete container._pendingMap[msg.clientTempId]; return;
                }
                if (msg.id && container._chatIds.has(msg.id)) return;
                const el = document.createElement('div'); el.className = 'chat-msg'; const roleClass = msg.role ? `role-${msg.role.toLowerCase().replace(/\s+/g,'-')}` : ''; if (roleClass) el.classList.add(roleClass); if (opts.own) el.classList.add('own');
                const meta = document.createElement('div'); meta.className = 'chat-meta'; meta.style.fontSize = '0.75rem'; meta.style.color = 'var(--text-secondary)'; meta.style.marginBottom = '4px'; meta.textContent = `${msg.from || msg.role || 'User'}` + (msg.role ? ` • ${msg.role}` : ''); el.appendChild(meta);
                const body = document.createElement('div'); body.className = 'chat-body'; body.textContent = msg.text || ''; el.appendChild(body);
                if (msg.id) { try { el.dataset.msgId = msg.id; } catch (e) {} container._chatIds.add(msg.id); }
                if (msg.clientTempId && !msg.id) { try { el.dataset.tempId = msg.clientTempId; } catch (e) {} el.classList.add('pending'); container._pendingMap[msg.clientTempId] = el; }
                msgsEl.appendChild(el); msgsEl.scrollTop = msgsEl.scrollHeight;
            } catch (e) {}
        }

        // expose
        container._appendChatMessage = (m) => appendToLive(msgs, m);

        sendBtn.addEventListener('click', () => {
            try {
                const text = (input.value || '').trim(); if (!text) return; const role = roleSelect.value || 'Musician'; const clientTempId = `tmp_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
                const payload = { type: 'chat:message', session: AppState.sessionCode, from: AppState.isDirector ? 'Director' : 'Viewer', role, text, clientTempId };
                appendToLive(msgs, payload, { own: true });
                if (_ws && _ws.readyState === WebSocket.OPEN) _ws.send(JSON.stringify(payload)); else showToast('Not connected to server', 900);
                input.value = '';
            } catch (e) {}
        });
        input.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendBtn.click(); });
    } catch (e) {}
}

// --- WebSocket based live updates (preferred over polling) ---
function getWebSocketUrl() {
    try {
        const url = new URL(SERVER_BASE);
        const protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
        return `${protocol}//${url.host}`;
    } catch (e) {
        return `ws://localhost:3000`;
    }
}

// Send a single-page update over the live websocket
function sendPageUpdate(pageId) {
    try {
        if (!_ws || _ws.readyState !== WebSocket.OPEN) return;
        if (!AppState.sessionCode) return;
        if (!window._pageManager) return;
        const page = window._pageManager.getPage(pageId) || { id: pageId, annotation: window._pageManager.getAnnotation(pageId) || [] };
        const msg = { type: 'page:update', session: AppState.sessionCode, pageId: pageId, page: page };
        try { _ws.send(JSON.stringify(msg)); } catch (e) {}
    } catch (e) {}
}

// SidebarManager: renders thumbnails for pages (one-per-page) and provides click-to-jump
class SidebarManager {
    constructor(opts = {}) {
        this.container = document.getElementById('sidebar-thumbs');
        // modules: ordered list of module ids
        this.modules = [];
        // mapping id -> module object and DOM references
        this.moduleMap = {};
        // storage key for layout (per-session when available)
        this.baseKey = 'sidebar_layout';

        // ensure container exists
        if (!this.container) {
            const aside = document.getElementById('sidebar');
            if (aside) {
                const div = document.createElement('div');
                div.id = 'sidebar-thumbs';
                div.className = 'sidebar-thumbs';
                aside.appendChild(div);
                this.container = div;
            }
        }

        // Register a default thumbnails module that mirrors previous behavior
        const thumbnailsModule = {
            id: 'thumbnails',
            title: 'Thumbnails',
            render: (contentEl) => {
                try {
                    contentEl.innerHTML = '';
                    if (!window._pageManager) {
                        contentEl.innerHTML = '<div class="sidebar-empty">No pages yet</div>';
                        return;
                    }
                    const pages = window._pageManager.serialize().pages || {};
                    const ids = Object.keys(pages || {});
                    if (!ids.length) { contentEl.innerHTML = '<div class="sidebar-empty">No pages yet</div>'; return; }
                    ids.forEach(pid => {
                        const p = pages[pid] || {};
                        const item = document.createElement('div');
                        item.className = 'sidebar-thumb';
                        item.dataset.pageId = pid;
                        item.style.position = item.style.position || 'relative';
                        const imgWrap = document.createElement('div'); imgWrap.className = 'sidebar-thumb-img';
                        if (p.thumb) { const img = new Image(); img.src = p.thumb; img.alt = `page ${pid}`; imgWrap.appendChild(img); }
                        else { imgWrap.innerHTML = `<div class="thumb-placeholder">${escapeHtml((p.name||'').toString().slice(0,12))}</div>`; }
                        item.appendChild(imgWrap);
                        const badge = document.createElement('div'); badge.className = 'thumb-changed-badge'; badge.textContent = 'Updated'; item.appendChild(badge);
                        const label = document.createElement('div'); label.className = 'sidebar-thumb-label'; label.textContent = p.name || pid; item.appendChild(label);
                        item.addEventListener('click', () => { this.onThumbClick(pid); });
                        contentEl.appendChild(item);
                    });
                } catch (e) { /* non-fatal */ }
            }
        };

        // register default module and render
        this.registerModule(thumbnailsModule, { atEnd: true });
        this.restoreLayout();
        this.renderModules();
    }

    // Register a module object that implements { id, title, render(container), optional: collapse, expand, resize, destroy }
    registerModule(module, opts = {}) {
        if (!module || !module.id) return false;
        // avoid duplicates
        if (this.moduleMap[module.id]) {
            // replace implementation
            this.moduleMap[module.id].module = module;
            return true;
        }
        this.moduleMap[module.id] = { module: module, el: null };
        if (opts.atStart) this.modules.unshift(module.id);
        else this.modules.push(module.id);
        this.persistLayout();
        return true;
    }

    removeModule(moduleId) {
        if (!this.moduleMap[moduleId]) return false;
        const idx = this.modules.indexOf(moduleId);
        if (idx !== -1) this.modules.splice(idx, 1);
        const rec = this.moduleMap[moduleId];
        if (rec && rec.el && rec.el.parentNode) rec.el.parentNode.removeChild(rec.el);
        delete this.moduleMap[moduleId];
        this.persistLayout();
        return true;
    }

    // Render all modules in order into the sidebar container
    renderModules() {
        try {
            if (!this.container) return;
            this.container.innerHTML = '';

            // create a drag handle area (Sortable will use .module-header as handle)
            this.modules.forEach(id => {
                const rec = this.moduleMap[id];
                if (!rec || !rec.module) return;
                const mod = rec.module;
                const panel = document.createElement('div');
                panel.className = 'sidebar-module';
                panel.dataset.moduleId = id;

                const header = document.createElement('div');
                header.className = 'module-header';
                header.textContent = mod.title || id;
                header.tabIndex = 0;

                // collapse button
                const collapseBtn = document.createElement('button');
                collapseBtn.className = 'module-collapse-btn';
                collapseBtn.title = 'Collapse';
                collapseBtn.innerHTML = '&#9660;';
                collapseBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    panel.classList.toggle('collapsed');
                    const collapsed = panel.classList.contains('collapsed');
                    try { if (collapsed && typeof mod.collapse === 'function') mod.collapse(); else if (!collapsed && typeof mod.expand === 'function') mod.expand(); } catch (err) {}
                    this.persistLayout();
                });
                header.appendChild(collapseBtn);

                panel.appendChild(header);

                const content = document.createElement('div');
                content.className = 'module-content';
                panel.appendChild(content);

                // render module into content area
                try { if (typeof mod.render === 'function') mod.render(content); } catch (e) {}

                this.container.appendChild(panel);
                rec.el = panel;
            });

            // make modules reorderable
            if (window.Sortable && this.container) {
                if (this._sortable) try { this._sortable.destroy(); } catch (e) {}
                this._sortable = Sortable.create(this.container, {
                    animation: 150,
                    handle: '.module-header',
                    onEnd: (evt) => {
                        // update modules array
                        const ids = Array.from(this.container.querySelectorAll('.sidebar-module')).map(n => n.dataset.moduleId).filter(Boolean);
                        this.modules = ids;
                        this.persistLayout();
                    }
                });
            }
        } catch (e) { /* ignore render errors */ }
    }

    // update thumbnail graphic for a page; targets thumbnails module content
    updateThumb(pageId, thumbDataUrl) {
        try {
            if (!this.container) return;
            const item = this.container.querySelector(`.sidebar-thumb[data-page-id="${pageId}"]`);
            if (!item) return;
            const imgWrap = item.querySelector('.sidebar-thumb-img');
            if (!imgWrap) return;
            imgWrap.innerHTML = '';
            if (thumbDataUrl) {
                const img = new Image(); img.src = thumbDataUrl; img.alt = pageId; imgWrap.appendChild(img);
            } else {
                imgWrap.innerHTML = `<div class="thumb-placeholder">${escapeHtml(pageId.slice(0,8))}</div>`;
            }
            // flash visual cue
            try { flashThumb(pageId); } catch (e) {}
        } catch (e) {}
    }

    onThumbClick(pageId) {
        try {
            // Find chart & page index for this pageId
            for (let c = 0; c < (AppState.charts || []).length; c++) {
                const chart = AppState.charts[c];
                if (!chart || !Array.isArray(chart.pageMap)) continue;
                const idx = chart.pageMap.indexOf(pageId);
                if (idx !== -1) {
                    // Scroll to corresponding live-page-wrapper
                    const pagesContainer = document.getElementById('live-pages');
                    if (pagesContainer) {
                        const selector = `.live-page-wrapper[data-chart-id="${chart.id}"][data-page="${idx+1}"]`;
                        const target = pagesContainer.querySelector(selector);
                        if (target) { target.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
                    }
                    // fallback: switch to edit and open this chart/page
                    try { AppState.currentChartIndex = c; AppState.currentPageNumber = idx + 1; switchToMode('edit'); renderCurrentChart(); } catch (e) {}
                    return;
                }
            }
        } catch (e) {}
    }

    // Persist layout (order + collapsed state) to localStorage per-session
    persistLayout() {
        try {
            const key = `${this.baseKey}_${AppState.sessionCode || 'global'}`;
            const order = this.modules.slice();
            const collapsed = {};
            (this.modules || []).forEach(id => {
                const rec = this.moduleMap[id];
                if (rec && rec.el) collapsed[id] = rec.el.classList.contains('collapsed');
            });
            const payload = { order, collapsed };
            localStorage.setItem(key, JSON.stringify(payload));
        } catch (e) {}
    }

    restoreLayout() {
        try {
            const key = `${this.baseKey}_${AppState.sessionCode || 'global'}`;
            const raw = localStorage.getItem(key);
            if (!raw) return;
            const p = JSON.parse(raw);
            if (p && Array.isArray(p.order)) {
                // ensure modules referenced exist; otherwise append missing
                const order = p.order.filter(id => !!this.moduleMap[id]);
                // append any registered modules not in order
                Object.keys(this.moduleMap).forEach(id => { if (order.indexOf(id) === -1) order.push(id); });
                this.modules = order;
            }
            // apply collapsed state after renderModules
            setTimeout(() => {
                try {
                    const raw2 = localStorage.getItem(key);
                    if (!raw2) return;
                    const p2 = JSON.parse(raw2);
                    if (p2 && p2.collapsed) {
                        Object.keys(p2.collapsed).forEach(id => {
                            const rec = this.moduleMap[id];
                            if (rec && rec.el && p2.collapsed[id]) rec.el.classList.add('collapsed');
                        });
                    }
                } catch (e) {}
            }, 40);
        } catch (e) {}
    }
}

function startLiveSocket() {
    stopLiveSocket();
    const wsUrl = getWebSocketUrl();
    try {
        _ws = new WebSocket(wsUrl);
    } catch (e) { _ws = null; return; }

    _ws.addEventListener('open', () => {
        // subscribe to the session if we have a code
        if (AppState.sessionCode) {
            _ws.send(JSON.stringify({ type: 'subscribe', session: AppState.sessionCode }));
        }
    });

    _ws.addEventListener('message', (ev) => {
        try {
            const j = JSON.parse(ev.data);
            if (j && j.type === 'charts:update') {
                handleServerChartsUpdate(j);
            } else if (j && j.type === 'page:update') {
                // single-page update from server: apply to PageManager and UI
                try {
                    const pageId = j.pageId;
                    const page = j.page || {};
                    if (pageId && window._pageManager) {
                        try { window._pageManager.updatePageAnnotation(pageId, page.annotation || []); } catch (e) {}
                        // if current viewer is on this page, re-render annotation canvas
                        try {
                            const current = getCurrentPageId();
                            if (current === pageId && AppState.annotationCanvas && window._pageManager) {
                                window._pageManager.renderAnnotationToCanvas(pageId, AppState.annotationCanvas);
                            }
                        } catch (e) {}
                        // update sidebar thumbnail if present
                        try { if (window._sidebarManager && page.thumb) window._sidebarManager.updateThumb(pageId, page.thumb); } catch (e) {}
                        // persist to local storage copy of pages
                        try { window._pageManager.persistToLocalStorage(AppState.sessionCode); } catch (e) {}
                    }
                } catch (e) {}
            } else if (j && j.type === 'chat:message') {
                // incoming chat message for session (server broadcasts { type:'chat:message', message: {...} })
                try {
                    const incoming = j.message || j;
                    if (window._sidebarManager && window._sidebarManager.moduleMap && window._sidebarManager.moduleMap['chat']) {
                        const rec = window._sidebarManager.moduleMap['chat'];
                        if (rec && rec.el) {
                            const content = rec.el.querySelector('.module-content');
                            if (content && typeof content._appendChatMessage === 'function') {
                                content._appendChatMessage(incoming);
                            } else {
                                // fallback: try to append to a .chat-messages area
                                const msgs = content ? content.querySelector('.chat-messages') : null;
                                if (msgs) {
                                    const el = document.createElement('div'); el.className = 'chat-msg'; el.textContent = `${incoming.from || 'User'}: ${incoming.text || ''}`; msgs.appendChild(el); msgs.scrollTop = msgs.scrollHeight;
                                }
                            }
                        }
                    } else {
                        // fallback: try to find the Live view chat module content
                        try {
                            const liveContent = document.querySelector('#live-chat-module .module-content');
                            if (liveContent && typeof liveContent._appendChatMessage === 'function') {
                                liveContent._appendChatMessage(incoming);
                            } else {
                                const msgs = document.querySelector('#live-chat-module .module-content .chat-messages') || document.querySelector('#live-chat-module .chat-messages');
                                if (msgs) {
                                    const el = document.createElement('div'); el.className = 'chat-msg'; el.textContent = `${incoming.from || 'User'}: ${incoming.text || ''}`; msgs.appendChild(el); msgs.scrollTop = msgs.scrollHeight;
                                }
                            }
                        } catch (e) {}
                    }
                } catch (e) {}
            }
        } catch (e) {}
    });

    _ws.addEventListener('close', () => { _ws = null; });
    _ws.addEventListener('error', () => { /* ignore */ });
}

function stopLiveSocket() {
    if (_ws) {
        try { _ws.close(); } catch (e) {}
        _ws = null;
    }
}

function handleServerChartsUpdate(serverCharts) {
    // serverPayload may include charts and pages
    const payload = serverCharts || {};
    const serverChartsArr = Array.isArray(payload.charts) ? payload.charts : [];
    const serverPages = payload.pages || {};

    // Preserve visible position: find first visible page wrapper
    const pagesContainer = document.getElementById('live-pages');
    let visible = null;
    if (pagesContainer) {
        const containerRect = pagesContainer.getBoundingClientRect();
        const wrappers = Array.from(pagesContainer.querySelectorAll('.live-page-wrapper'));
        for (const w of wrappers) {
            const r = w.getBoundingClientRect();
            if (r.top < containerRect.bottom && r.bottom > containerRect.top) {
                visible = { chartId: w.dataset.chartId, page: w.dataset.page, offset: r.top - containerRect.top };
                break;
            }
        }
    }

    const local = JSON.stringify(AppState.charts || []);
    const remote = JSON.stringify(serverChartsArr || []);
    if (local === remote && (!window._pageManager || JSON.stringify(window._pageManager.serialize().pages || {}) === JSON.stringify(serverPages || {}))) return; // nothing changed

    // update state
    AppState.charts = serverChartsArr;
    try { localStorage.setItem(`session_${AppState.sessionCode}`, JSON.stringify({ code: AppState.sessionCode, charts: AppState.charts })); } catch (e) {}

    // update PageManager with server pages if available
    try {
        if (window._pageManager) {
            window._pageManager.deserialize({ charts: serverChartsArr, pages: serverPages });
            // persist locally
            try { window._pageManager.persistToLocalStorage(AppState.sessionCode); } catch (e) {}
        }
    } catch (e) {}

    // show toast to indicate update
    showToast('Session updated by Music Director');

    // show a small live-update badge near thumbnails
    try {
    const thumbsContainer = document.querySelector('#live-thumbs-module .module-content') || document.querySelector('.live-thumbs');
        if (thumbsContainer) {
            let badge = thumbsContainer.querySelector('.live-update-badge');
            if (!badge) {
                badge = document.createElement('div');
                badge.className = 'live-update-badge';
                badge.textContent = 'Updated';
                // place absolute inside the thumbs container
                thumbsContainer.style.position = thumbsContainer.style.position || 'relative';
                thumbsContainer.appendChild(badge);
            }
            badge.classList.add('visible');
            setTimeout(() => { badge.classList.remove('visible'); }, 2000);
        }
    } catch (e) {}

    // Partial update: if Live mode, update only changed chart blocks where possible
    if (AppState.viewMode === 'live') {
        try {
            // Update thumbnails for charts that changed
            AppState.charts.forEach((chart, idx) => {
                try {
                    const thumbEl = document.querySelector(`.live-thumb[data-chart-id="${chart.id}"]`);
                    if (thumbEl && window._pageManager && Array.isArray(chart.pageMap) && chart.pageMap.length > 0) {
                        const firstPage = window._pageManager.getPage(chart.pageMap[0]);
                        if (firstPage && firstPage.thumb && (!thumbEl.querySelector('img') || thumbEl.querySelector('img').src !== firstPage.thumb)) {
                            thumbEl.innerHTML = '';
                            const img = new Image(); img.src = firstPage.thumb; img.alt = `${chart.name} thumbnail`; thumbEl.appendChild(img);
                        }
                    }
                } catch (e) {}
            });

            // For chart blocks that are present, re-render only those blocks which now have pageMaps
            AppState.charts.forEach((chart, chartIdx) => {
                if (chart && Array.isArray(chart.pageMap) && chart.pageMap.length > 0) {
                    const block = document.querySelector(`.live-chart-block[data-chart-index="${chartIdx}"]`);
                    if (block) {
                        // re-render this chart block
                        renderChartBlock(chartIdx);
                    }
                }
            });
        } catch (e) {
            // fallback to full re-render
            try { renderLiveMode(); } catch (err) {}
        }

        // animate reorder and preserve scroll position
        setTimeout(() => {
            try {
                const pagesContainer2 = document.getElementById('live-pages');
                const chartBlocks = pagesContainer2 ? Array.from(pagesContainer2.querySelectorAll('.live-chart-block')) : [];
                chartBlocks.forEach(cb => { cb.classList.add('reorder-anim'); setTimeout(() => cb.classList.remove('reorder-anim'), 800); });
            } catch (e) {}
        }, 120);

        setTimeout(() => {
            if (!visible) return;
            const pagesContainer2 = document.getElementById('live-pages');
            const target = pagesContainer2.querySelector(`.live-page-wrapper[data-chart-id="${visible.chartId}"][data-page="${visible.page}"]`);
            if (target) {
                const rect = target.getBoundingClientRect();
                const desiredTop = pagesContainer2.scrollTop + (rect.top - pagesContainer2.getBoundingClientRect().top) - visible.offset;
                pagesContainer2.scrollTop = Math.max(0, Math.round(desiredTop));
            }
        }, 220);
    }
}

// IntersectionObserver to highlight current page/thumbnail
function initLiveHighlighting() {
    const pagesContainer = document.getElementById('live-pages');
    const thumbsContainer = document.querySelector('#live-thumbs-module .module-content') || document.querySelector('.live-thumbs');
    if (!pagesContainer || !thumbsContainer) return;

    if (_highlightObserver) {
        _highlightObserver.disconnect();
        _highlightObserver = null;
    }

    _highlightObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (!entry.target.dataset) return;
            const chartId = entry.target.dataset.chartId;
            // find thumbnail by chartId only (thumbnails are one-per-chart)
            const selector = `.live-thumb[data-chart-id="${chartId}"]`;
            const thumb = thumbsContainer.querySelector(selector);
            if (entry.isIntersecting && entry.intersectionRatio > 0.45) {
                // mark active (one thumb active at a time)
                thumbsContainer.querySelectorAll('.live-thumb.active').forEach(t => t.classList.remove('active'));
                if (thumb) thumb.classList.add('active');
            } else {
                // when leaving, only remove if this thumb is active
                if (thumb && thumb.classList.contains('active')) thumb.classList.remove('active');
            }
        });
    }, { root: pagesContainer, threshold: [0.45] });

    // observe current wrappers
    Array.from(pagesContainer.querySelectorAll('.live-page-wrapper')).forEach(w => _highlightObserver.observe(w));

    // helper to render a single chart block (used for partial updates)
    window.renderChartBlock = function(chartIdx) {
        try {
            const chart = AppState.charts[chartIdx];
            const pagesContainerLocal = document.getElementById('live-pages');
            if (!chart || !chart.data || !pagesContainerLocal) return;
            const chartBlock = pagesContainerLocal.querySelector(`.live-chart-block[data-chart-index="${chartIdx}"]`);
            if (!chartBlock) return;
            chartBlock.innerHTML = '<div class="chart-loading">Loading...</div>';
            // same lazy render as in renderLiveMode for this chart
            pdfjsLib.getDocument(chart.data).promise.then(pdf => {
                chartBlock.innerHTML = '';
                for (let p = 1; p <= pdf.numPages; p++) {
                    const wrapper = document.createElement('div');
                    wrapper.className = 'live-page-wrapper';
                    wrapper.dataset.chartId = chart.id;
                    wrapper.dataset.chartIndex = chartIdx;
                    wrapper.dataset.page = p;
                    wrapper.dataset.rendered = '0';
                    wrapper.style.minHeight = '200px';
                    chartBlock.appendChild(wrapper);
                }

                const observer = new IntersectionObserver((entries, obs) => {
                    entries.forEach(entry => {
                        if (!entry.isIntersecting) return;
                        const w = entry.target;
                        const p = parseInt(w.dataset.page, 10);
                        if (w.dataset.rendered === '1') { obs.unobserve(w); return; }

                        pdf.getPage(p).then(page => {
                            const viewport = page.getViewport({ scale: 1 });
                            const scale = Math.min(900 / viewport.width, 1);
                            const scaled = page.getViewport({ scale });
                            const canvas = document.createElement('canvas');
                            canvas.width = scaled.width; canvas.height = scaled.height;
                            const ctx = canvas.getContext('2d');
                            page.render({ canvasContext: ctx, viewport: scaled }).promise.then(() => {
                                // overlay annotations
                                try {
                                    let pageId = null;
                                    if (chart && Array.isArray(chart.pageMap) && chart.pageMap.length >= p) pageId = chart.pageMap[p-1];
                                    if (pageId && window._pageManager) {
                                        const strokes = window._pageManager.getAnnotation(pageId) || [];
                                        if (strokes && strokes.length) window.PageManager_renderStrokes(ctx, strokes, 1);
                                    }
                                } catch (e) {}
                                // legacy bitmap annotations
                                const key = `${AppState.sessionCode}_${chartIdx}_${p}`;
                                const ann = AppState.annotations[key];
                                if (ann) {
                                    const img = new Image(); img.onload = () => { try { ctx.drawImage(img,0,0,canvas.width,canvas.height); } catch(e){} }; img.src = ann;
                                }
                                w.appendChild(canvas);
                                w.dataset.rendered = '1'; obs.unobserve(w);
                            }).catch(() => { w.dataset.rendered = '1'; obs.unobserve(w); });
                        }).catch(() => { w.dataset.rendered = '1'; obs.unobserve(w); });
                    });
                }, { root: chartBlock, rootMargin: '400px 0px', threshold: 0.01 });

                const wrappers = chartBlock.querySelectorAll('.live-page-wrapper');
                wrappers.forEach(w => observer.observe(w));
            }).catch(() => { chartBlock.innerHTML = '<div class="chart-error">Failed to load chart</div>'; });
        } catch (e) {}
    };
}

// Simple toast
function showToast(msg, timeout = 2200) {
    try {
        const t = document.createElement('div');
        t.className = 'mw-toast';
        t.textContent = msg;
        document.body.appendChild(t);
        // fade in
        requestAnimationFrame(() => { t.classList.add('visible'); });
        setTimeout(() => { t.classList.remove('visible'); setTimeout(() => t.remove(), 300); }, timeout);
    } catch (e) {}
}

// Fetch charts from server and update AppState when changes are detected
async function fetchAndUpdateCharts() {
    if (!AppState.sessionCode) return;
    try {
        const res = await fetch(`${SERVER_BASE}/api/sessions/${AppState.sessionCode}/charts`);
        if (!res.ok) return;
        const j = await res.json();
        const serverCharts = Array.isArray(j.charts) ? j.charts : [];
        // If charts differ (order/content), update and re-render appropriate views
        const local = JSON.stringify(AppState.charts || []);
        const remote = JSON.stringify(serverCharts || []);
        if (local !== remote) {
            AppState.charts = serverCharts;
            // persist a local snapshot
            try { localStorage.setItem(`session_${AppState.sessionCode}`, JSON.stringify({ code: AppState.sessionCode, charts: AppState.charts })); } catch (e) {}
            // refresh views depending on mode
            if (AppState.viewMode === 'live') {
                renderLiveMode();
            }
            if (AppState.viewMode === 'organize') {
                renderOrganizeMode();
            }
        }
    } catch (e) {
        // ignore transient network errors during polling
    }
}

function startLivePolling() {
    stopLivePolling();
    // fetch immediately then schedule
    fetchAndUpdateCharts();
    _livePollTimer = setInterval(fetchAndUpdateCharts, LIVE_POLL_INTERVAL_MS);
}

function stopLivePolling() {
    if (_livePollTimer) {
        clearInterval(_livePollTimer);
        _livePollTimer = null;
    }
}

// Generate a thumbnail for a PDF data URL using PDF.js (returns Promise<string dataURL>)
function generateThumbnail(chart, maxWidth = 300) {
    if (!window['pdfjsLib']) return Promise.resolve(null);
    try {
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
        return pdfjsLib.getDocument(chart.data).promise.then(pdf => {
            return pdf.getPage(1).then(page => {
                const viewport = page.getViewport({ scale: 1 });
                const scale = Math.min(maxWidth / viewport.width, 1);
                const scaledViewport = page.getViewport({ scale });
                const canvas = document.createElement('canvas');
                canvas.width = scaledViewport.width;
                canvas.height = scaledViewport.height;
                const ctx = canvas.getContext('2d');
                const renderContext = { canvasContext: ctx, viewport: scaledViewport };
                return page.render(renderContext).promise.then(() => {
                    try {
                        return canvas.toDataURL('image/png');
                    } catch (e) {
                        return null;
                    }
                }).catch(() => null);
            }).catch(() => null);
        }).catch(() => null);
    } catch (e) {
        return Promise.resolve(null);
    }
}

// Initialize SortableJS on the charts grid for touch-friendly drag/reorder
let _sortableInstance = null;
function initSortable() {
    const grid = document.getElementById('charts-grid');
    if (!grid) return;
    if (window.Sortable) {
        if (_sortableInstance) _sortableInstance.destroy();
        _sortableInstance = Sortable.create(grid, {
            animation: 150,
            fallbackOnBody: true,
            swapThreshold: 0.65,
            onEnd: function(evt) {
                const from = evt.oldIndex;
                const to = evt.newIndex;
                if (typeof from === 'number' && typeof to === 'number' && from !== to) {
                    reorderCharts(from, to);
                }
            }
        });
    }
}

// Date/time ticker for organize mode header
let _organizeTicker = null;
function formatDateTime(d) {
    // e.g. "Mon Nov 3, 2025 14:23:05"
    return d.toLocaleString(undefined, {
        weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
}

function startOrganizeTicker() {
    stopOrganizeTicker();
    const el = document.getElementById('current-chart-name');
    if (!el) return;
    const tick = () => { el.textContent = formatDateTime(new Date()); };
    tick();
    _organizeTicker = setInterval(tick, 1000);
}

// When showing organize mode, also display the organize help under the clock
function showOrganizeHeaderHelp() {
    const pageIndicator = document.getElementById('page-indicator');
    if (pageIndicator) {
        pageIndicator.textContent = 'Drag and drop items to reorder. Click to select; double-click to open.';
    }
}

function stopOrganizeTicker() {
    if (_organizeTicker) {
        clearInterval(_organizeTicker);
        _organizeTicker = null;
    }
}

function renderOrganizeMode() {
    const grid = document.getElementById('charts-grid');
    grid.innerHTML = '';

    AppState.charts.forEach((chart, index) => {
        const card = document.createElement('div');
        card.className = 'chart-card';
        card.dataset.index = index;
        card.tabIndex = 0; // make focusable for keyboard actions

        // Click selects
        card.addEventListener('click', () => {
            document.querySelectorAll('.chart-card').forEach(c => c.classList.remove('selected'));
            card.classList.add('selected');
            AppState.currentChartIndex = index;
        });

        // Double click opens in edit mode
        card.addEventListener('dblclick', () => {
            AppState.currentPageNumber = 1;
            switchToMode('edit');
        });

        // Keyboard interactions
        card.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                card.click();
            } else if (e.key === 'ArrowUp') {
                // move up
                e.preventDefault();
                if (index > 0) reorderCharts(index, index - 1);
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (index < AppState.charts.length - 1) reorderCharts(index, index + 1);
            }
        });

        // Thumbnail or placeholder
        const thumbHtml = chart.thumb ? `<img src="${chart.thumb}" alt="${escapeHtml(chart.name)} thumbnail" style="max-width:100%;max-height:100%;object-fit:contain;">` : `
            <svg width="100" height="100" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
                <line x1="16" y1="13" x2="8" y2="13"></line>
                <line x1="16" y1="17" x2="8" y2="17"></line>
                <polyline points="10 9 9 9 8 9"></polyline>
            </svg>`;

        card.innerHTML = `
            <div class="chart-move-controls">
                <button class="move-btn" data-action="up" title="Move up" aria-label="Move up">▲</button>
                <button class="move-btn" data-action="down" title="Move down" aria-label="Move down">▼</button>
            </div>
            <div class="chart-order-badge" aria-hidden="true">${index + 1}</div>
            <div class="chart-remove-badge" role="button" tabindex="0" aria-label="Remove chart" data-chart-id="${chart.id}">−</div>
            <div class="chart-thumbnail">${thumbHtml}</div>
                <div class="chart-info">
                    <h3>${escapeHtml(chart.name)}</h3>
                </div>
        `;

        // Delegate move control clicks
        grid.appendChild(card);
    });

    // Hook up move buttons and make sure Sortable is initialized for touch
    grid.querySelectorAll('.move-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const action = btn.dataset.action;
            const card = btn.closest('.chart-card');
            const idx = parseInt(card.dataset.index, 10);
            if (action === 'up' && idx > 0) reorderCharts(idx, idx - 1);
            if (action === 'down' && idx < AppState.charts.length - 1) reorderCharts(idx, idx + 1);
        });
    });

    // Hook up remove badge buttons (only visible when card is selected)
    grid.querySelectorAll('.chart-remove-badge').forEach(b => {
        b.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = b.dataset.chartId;
            if (id) removeChart(id);
        });
        b.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                b.click();
            }
        });
    });

    // generate thumbnails asynchronously where missing
    AppState.charts.forEach((chart, i) => {
        if (!chart.thumb && chart.data) {
            generateThumbnail(chart, 240).then(dataUrl => {
                if (dataUrl) {
                    chart.thumb = dataUrl;
                    // If still on organize mode, re-render to show thumbnail
                    if (AppState.viewMode === 'organize') renderOrganizeMode();
                }
            });
        }
    });

    // Initialize Sortable for touch-friendly drag/drop
    initSortable();
}

function reorderCharts(fromIndex, toIndex) {
    if (fromIndex === toIndex) return;
    const [item] = AppState.charts.splice(fromIndex, 1);
    AppState.charts.splice(toIndex, 0, item);
    // after reordering, update any UI and persist
    renderOrganizeMode();
    saveSessionCharts();
}

function saveSessionCharts() {
    // Persist charts: try server if director token exists, otherwise use localStorage
    return (async () => {
        if (!AppState.sessionCode) {
            // store as currentSession for demo flows
            try { localStorage.setItem('currentSession', JSON.stringify({ code: AppState.sessionCode, isDirector: AppState.isDirector, charts: AppState.charts })); } catch (e) {}
            return false;
        }
        const directorToken = localStorage.getItem(`session_${AppState.sessionCode}_directorToken`);
        if (directorToken) {
            try {
                // include pages from PageManager when available
                let pagesPayload = undefined;
                try { if (window._pageManager) { pagesPayload = window._pageManager.serialize().pages; } } catch (e) { pagesPayload = undefined; }
                const body = pagesPayload ? { charts: AppState.charts, pages: pagesPayload } : { charts: AppState.charts };
                const res = await fetch(`${SERVER_BASE}/api/sessions/${AppState.sessionCode}/charts`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'x-director-token': directorToken },
                    body: JSON.stringify(body)
                });
                if (res.ok) {
                    try { localStorage.setItem('currentSession', JSON.stringify({ code: AppState.sessionCode, isDirector: AppState.isDirector, charts: AppState.charts })); } catch (e) {}
                    return true;
                }
            } catch (e) {
                console.warn('Failed to save charts to server:', e);
            }
        }
        // fallback to localStorage
        try { localStorage.setItem(`session_${AppState.sessionCode}`, JSON.stringify({ code: AppState.sessionCode, charts: AppState.charts })); } catch (e) {}
        return false;
    })();
}

// Navigation
function nextPage() {
    // Page navigation is handled by the browser's PDF viewer
    AppState.currentPageNumber++;
    renderCurrentChart();
}

function prevPage() {
    if (AppState.currentPageNumber > 1) {
        AppState.currentPageNumber--;
        renderCurrentChart();
    }
}

function nextChart() {
    if (AppState.currentChartIndex < AppState.charts.length - 1) {
        AppState.currentChartIndex++;
        AppState.currentPageNumber = 1;
        renderCurrentChart();
    }
}

function prevChart() {
    if (AppState.currentChartIndex > 0) {
        AppState.currentChartIndex--;
        AppState.currentPageNumber = 1;
        renderCurrentChart();
    }
}

// View Mode Switching
async function switchToMode(mode) {
    AppState.viewMode = mode;
    
    const editView = document.getElementById('edit-view');
    const liveView = document.getElementById('live-view');
    const organizeView = document.getElementById('organize-view');
    const editBtn = document.getElementById('edit-mode-btn');
    const liveBtn = document.getElementById('live-mode-btn');
    const organizeBtn = document.getElementById('organize-mode-btn');

    // Clear active states
    [editView, liveView, organizeView].forEach(v => { if (v) v.classList.remove('active'); });
    [editBtn, liveBtn, organizeBtn].forEach(b => { if (b) b.classList.remove('active'); });

    if (mode === 'edit') {
        if (editView) editView.classList.add('active');
        if (editBtn) editBtn.classList.add('active');
        // Stop the organize mode ticker and restore the current chart title
        stopOrganizeTicker();
        // stop live polling when in edit
        stopLivePolling();
        renderCurrentChart();
    } else if (mode === 'live') {
        if (liveView) liveView.classList.add('active');
        if (liveBtn) liveBtn.classList.add('active');
        stopOrganizeTicker();
        // If director, persist current organize ordering to server so viewers will be updated
        if (AppState.isDirector) {
            try {
                await saveSessionCharts();
            } catch (e) {}
        }
        renderLiveMode();
    // render the Live chat UI into the Live view's chat module (if present)
    try { renderLiveChatModule(); } catch (e) {}
        // start websocket for chart updates so viewers get reorders/changes
        startLiveSocket();
    } else if (mode === 'organize') {
        if (organizeView) organizeView.classList.add('active');
        if (organizeBtn) organizeBtn.classList.add('active');
        // Start date/time ticker in the header and render organize grid
        startOrganizeTicker();
        // stop websocket when organizing
        stopLiveSocket();
        showOrganizeHeaderHelp();
        renderOrganizeMode();
    }
}

// Role-based UI: show/hide director-only controls and enforce default mode for attendees
function updateRoleUI() {
    const directorOnlyIds = ['edit-mode-btn', 'organize-mode-btn', 'add-charts-btn', 'annotation-btn'];
    directorOnlyIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = AppState.isDirector ? '' : 'none';
    });

    // Ensure live button and leave are always visible
    const liveBtn = document.getElementById('live-mode-btn');
    if (liveBtn) liveBtn.style.display = '';

    // If the user is not a director, force Live mode and hide organize/edit
    if (!AppState.isDirector) {
        // If currently in edit/organize, switch to live
        if (AppState.viewMode !== 'live') switchToMode('live');
    } else {
        // Director gets Edit/Organize available. Default to edit if not already.
        if (AppState.viewMode !== 'edit') switchToMode('edit');
    }
}

// Annotations
function toggleAnnotationMode() {
    AppState.annotationMode = !AppState.annotationMode;
    const btn = document.getElementById('annotation-btn');
    const canvas = AppState.annotationCanvas;
    
    if (AppState.annotationMode) {
        btn.classList.add('active');
        canvas.classList.add('active');
    } else {
        btn.classList.remove('active');
        canvas.classList.remove('active');
    }

    // Show/hide annotation toolbar only when PageManager is enabled
    try {
        const toolbar = document.getElementById('annotation-toolbar');
        if (toolbar) {
            if (AppState.annotationMode && FEATURE_PAGE_MANAGER && window._pageManager) {
                toolbar.hidden = false;
            } else {
                toolbar.hidden = true;
            }
        }
    } catch (e) {}
}

function saveAnnotations() {
    const key = `${AppState.sessionCode}_${AppState.currentChartIndex}_${AppState.currentPageNumber}`;
    // prefer PageManager vector storage when available
    try {
        const chart = (AppState.charts || [])[AppState.currentChartIndex];
        let pageId = null;
        if (chart && Array.isArray(chart.pageMap) && chart.pageMap.length >= AppState.currentPageNumber) {
            pageId = chart.pageMap[AppState.currentPageNumber - 1];
        }
        if (window._pageManager && pageId) {
            // if PageManager has an annotation (vector), persist it
            const strokes = window._pageManager.getAnnotation(pageId) || [];
            window._pageManager.updatePageAnnotation(pageId, strokes);
            try { window._pageManager.persistToLocalStorage(AppState.sessionCode); } catch (e) {}
            return;
        }
    } catch (e) {
        // ignore and fallback to legacy
    }
    // legacy fallback: store PNG dataURL
    try { AppState.annotations[key] = AppState.annotationCanvas.toDataURL(); } catch (e) {}
}

function restoreAnnotations() {
    const key = `${AppState.sessionCode}_${AppState.currentChartIndex}_${AppState.currentPageNumber}`;
    // if PageManager is available, render vector strokes
    try {
        const chart = (AppState.charts || [])[AppState.currentChartIndex];
        let pageId = null;
        if (chart && Array.isArray(chart.pageMap) && chart.pageMap.length >= AppState.currentPageNumber) {
            pageId = chart.pageMap[AppState.currentPageNumber - 1];
        }
        if (window._pageManager && pageId) {
            // render strokes into annotation canvas
            try { AppState.annotationContext.clearRect(0, 0, AppState.annotationCanvas.width, AppState.annotationCanvas.height); } catch (e) {}
            window._pageManager.renderAnnotationToCanvas(pageId, AppState.annotationCanvas);
            return;
        }
    } catch (e) { /* continue to legacy */ }

    // legacy PNG fallback
    const savedAnnotation = AppState.annotations[key];
    if (savedAnnotation) {
        const img = new Image();
        img.onload = () => {
            AppState.annotationContext.clearRect(0, 0, AppState.annotationCanvas.width, AppState.annotationCanvas.height);
            AppState.annotationContext.drawImage(img, 0, 0);
        };
        img.src = savedAnnotation;
    } else {
        try { AppState.annotationContext.clearRect(0, 0, AppState.annotationCanvas.width, AppState.annotationCanvas.height); } catch (e) {}
    }
}

// Drawing
function startDrawing(e) {
    if (!AppState.annotationMode) return;
    AppState.isDrawing = true;
    const rect = AppState.annotationCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    AppState.lastX = x;
    AppState.lastY = y;
    // start a new vector stroke
    AppState.currentStroke = {
        type: 'pen',
        color: ANNOTATION_CONFIG.strokeStyle,
        width: ANNOTATION_CONFIG.lineWidth,
        points: [{ x, y }]
    };
}

// Helper: determine current pageId for vector annotations
function getCurrentPageId() {
    try {
        const chart = (AppState.charts || [])[AppState.currentChartIndex];
        if (chart && Array.isArray(chart.pageMap) && chart.pageMap.length >= AppState.currentPageNumber) {
            return chart.pageMap[AppState.currentPageNumber - 1];
        }
        return `legacy_${AppState.sessionCode}_${AppState.currentChartIndex}_${AppState.currentPageNumber}`;
    } catch (e) { return null; }
}

function undoLastStroke() {
    try {
        if (!window._pageManager) return false;
        const pageId = getCurrentPageId();
        if (!pageId) return false;
        const stack = AppState.pageUndoStacks[pageId] || [];
        if (stack.length === 0) return false;
        const prev = stack.pop();
        window._pageManager.updatePageAnnotation(pageId, prev || []);
        try { window._pageManager.persistToLocalStorage(AppState.sessionCode); } catch (e) {}
        // update canvas immediately
        try { window._pageManager.renderAnnotationToCanvas(pageId, AppState.annotationCanvas); } catch (e) {}
            // notify server and other clients about this single-page change
            try { sendPageUpdate(pageId); } catch (e) {}
        return true;
    } catch (e) { return false; }
}

function clearPageAnnotations() {
    try {
        if (!window._pageManager) return false;
        const pageId = getCurrentPageId();
        if (!pageId) return false;
        const existing = window._pageManager.getAnnotation(pageId) || [];
        // push snapshot for undo
        AppState.pageUndoStacks[pageId] = AppState.pageUndoStacks[pageId] || [];
        AppState.pageUndoStacks[pageId].push(existing.slice());
        window._pageManager.updatePageAnnotation(pageId, []);
        try { window._pageManager.persistToLocalStorage(AppState.sessionCode); } catch (e) {}
        try { window._pageManager.renderAnnotationToCanvas(pageId, AppState.annotationCanvas); } catch (e) {}
        // notify server and other clients about this single-page clear
        try { sendPageUpdate(pageId); } catch (e) {}
        return true;
    } catch (e) { return false; }
}

function draw(e) {
    if (!AppState.isDrawing || !AppState.annotationMode) return;
    const rect = AppState.annotationCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const ctx = AppState.annotationContext;
    ctx.strokeStyle = ANNOTATION_CONFIG.strokeStyle;
    ctx.lineWidth = ANNOTATION_CONFIG.lineWidth;
    ctx.lineCap = ANNOTATION_CONFIG.lineCap;
    ctx.lineJoin = ANNOTATION_CONFIG.lineJoin;

    ctx.beginPath();
    ctx.moveTo(AppState.lastX, AppState.lastY);
    ctx.lineTo(x, y);
    ctx.stroke();

    // record point in current stroke
    try {
        if (AppState.currentStroke && Array.isArray(AppState.currentStroke.points)) {
            AppState.currentStroke.points.push({ x, y });
        }
    } catch (e) {}

    AppState.lastX = x;
    AppState.lastY = y;
}

function stopDrawing() {
    if (!AppState.isDrawing) return;
    AppState.isDrawing = false;
    // finalize current stroke and persist vector annotation via PageManager if available
    try {
        const key = `${AppState.sessionCode}_${AppState.currentChartIndex}_${AppState.currentPageNumber}`;
        // use pageManager if available
        if (window._pageManager) {
            // determine pageId: if chart has pageMap, pick the matching page for currentPageNumber
            const chart = (AppState.charts || [])[AppState.currentChartIndex];
            let pageId = null;
            if (chart && Array.isArray(chart.pageMap) && chart.pageMap.length >= AppState.currentPageNumber) {
                pageId = chart.pageMap[AppState.currentPageNumber - 1];
            }
            // fallback to key-based synthetic id
            if (!pageId) pageId = `legacy_${key}`;

            // get existing strokes and push snapshot for undo
            const existing = window._pageManager.getAnnotation(pageId) || [];
            AppState.pageUndoStacks[pageId] = AppState.pageUndoStacks[pageId] || [];
            // store snapshot copy (limit history to 50)
            try { AppState.pageUndoStacks[pageId].push(existing.slice()); if (AppState.pageUndoStacks[pageId].length > 50) AppState.pageUndoStacks[pageId].shift(); } catch(e){}
            if (AppState.currentStroke) existing.push(AppState.currentStroke);
            window._pageManager.updatePageAnnotation(pageId, existing);
            // also persist to localStorage for session
            try { window._pageManager.persistToLocalStorage(AppState.sessionCode); } catch (e) {}
            // notify server/other clients about page-level update
            try { sendPageUpdate(pageId); } catch (e) {}
            // update sidebar thumbnail if a thumb was generated/changed
            try {
                if (window._sidebarManager && window._pageManager) {
                    const p = window._pageManager.getPage(pageId) || {};
                    if (p.thumb) window._sidebarManager.updateThumb(pageId, p.thumb);
                }
            } catch (e) {}
        } else {
            // fallback: rasterize canvas to dataURL (legacy behavior)
            saveAnnotations();
        }
    } catch (e) {
        // always fall back to legacy save on error
        try { saveAnnotations(); } catch (err) {}
    }

    AppState.currentStroke = null;
}

// Event Listeners
document.addEventListener('DOMContentLoaded', function() {
    try {
    // Apply theme preference for this client (independent per device/user)
    function applyTheme(theme) {
        if (theme === 'dark') {
            document.documentElement.setAttribute('data-theme', 'dark');
        } else {
            document.documentElement.removeAttribute('data-theme');
        }

        // Adjust annotation color for visibility in dark mode
        if (theme === 'dark') {
            ANNOTATION_CONFIG.strokeStyle = '#ffb86b'; // warm bright for dark bg
        } else {
            ANNOTATION_CONFIG.strokeStyle = '#ef4444'; // original red for light
        }

        // Invert PDF viewer when in dark theme to reduce brightness
        const pdfViewer = document.getElementById('pdf-viewer');
        if (pdfViewer) {
            if (theme === 'dark') {
                pdfViewer.style.filter = 'invert(1) hue-rotate(180deg)';
            } else {
                pdfViewer.style.filter = '';
            }
        }

        // Update theme toggle icons
        updateThemeToggleIcons(theme);
    }

    function updateThemeToggleIcons(theme) {
        const toggles = document.querySelectorAll('.theme-toggle');
        toggles.forEach(btn => {
            // Show an icon representing the CURRENT theme so the toggle visually
            // matches what the user sees: moon for dark, sun for light.
            if (theme === 'dark') {
                // Moon icon when in dark mode
                btn.innerHTML = `\n                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">\n                        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>\n                    </svg>`;
            } else {
                // Sun icon when in light mode
                btn.innerHTML = `\n                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">\n                        <circle cx="12" cy="12" r="4"></circle>\n                        <path d="M12 2v2"></path>\n                        <path d="M12 20v2"></path>\n                        <path d="M4.93 4.93l1.41 1.41"></path>\n                        <path d="M17.66 17.66l1.41 1.41"></path>\n                        <path d="M2 12h2"></path>\n                        <path d="M20 12h2"></path>\n                        <path d="M4.93 19.07l1.41-1.41"></path>\n                        <path d="M17.66 6.34l1.41-1.41"></path>\n                    </svg>`;
            }
        });
    }

    // Initialize theme from localStorage (per-client)
    const savedTheme = localStorage.getItem('theme') || 'light';
    applyTheme(savedTheme);

    // Initialize PageManager (vector annotation/page model) if available and enabled by feature flag
    try {
        if (FEATURE_PAGE_MANAGER && window.PageManager) {
            window._pageManager = new PageManager({ pdfjsLib: window.pdfjsLib });
            // attempt to restore any saved pages for this session
            try { window._pageManager.restoreFromLocalStorage(AppState.sessionCode); } catch (e) {}
            // create sidebar manager and render thumbnails if possible
            try {
                window._sidebarManager = new SidebarManager();
                // render initial sidebar from any restored pages
                try { window._sidebarManager.renderModules(); } catch (e) {}
                // Register a lightweight Chat module scaffold for demo and reordering
                try {
                    const chatModule = {
                        id: 'chat',
                        title: 'Chat',
                        render: (contentEl) => {
                            try {
                                contentEl.innerHTML = '';
                                const msgs = document.createElement('div');
                                msgs.className = 'chat-messages';
                                contentEl.appendChild(msgs);

                                // tiny in-memory dedupe and pending map per module instance
                                contentEl._chatIds = new Set(); // known server message ids
                                contentEl._pendingMap = {}; // tempId -> DOM element for pending local messages

                                // load recent chat history for this session (and populate seen ids)
                                try {
                                    const sessionCode = AppState.sessionCode;
                                    if (sessionCode) {
                                        fetch(`${SERVER_BASE}/api/sessions/${sessionCode}/chat`).then(r => {
                                            if (!r.ok) throw new Error('chat fetch failed');
                                            return r.json();
                                        }).then(data => {
                                            try {
                                                const list = Array.isArray(data.chat) ? data.chat : [];
                                                list.forEach(m => {
                                                    try {
                                                        // record id to prevent duplicates when live messages arrive
                                                        if (m && m.id) contentEl._chatIds.add(m.id);
                                                        const own = (m.from === (AppState.isDirector ? 'Director' : 'Viewer'));
                                                        appendChatMessage(m, { own });
                                                    } catch (e) {}
                                                });
                                            } catch (e) {}
                                        }).catch(err => {
                                            try { console.warn('Failed to load chat history', err); } catch (e) {}
                                        });
                                    }
                                } catch (e) {}

                                // role selector + stored preference
                                const roleRow = document.createElement('div');
                                roleRow.style.display = 'flex';
                                roleRow.style.gap = '8px';
                                roleRow.style.alignItems = 'center';
                                roleRow.style.marginBottom = '8px';

                                const roleLabel = document.createElement('div');
                                roleLabel.textContent = 'Role:';
                                roleLabel.style.fontSize = '0.85rem';
                                roleLabel.style.color = 'var(--text-secondary)';
                                roleRow.appendChild(roleLabel);

                                const roleSelect = document.createElement('select');
                                roleSelect.className = 'chat-role-select';
                                ['Pastor','Worship Leader','Production','Musician'].forEach(r => {
                                    const o = document.createElement('option'); o.value = r; o.textContent = r; roleSelect.appendChild(o);
                                });
                                roleRow.appendChild(roleSelect);
                                contentEl.appendChild(roleRow);

                                // load saved role preference
                                const roleKey = `chat_role_${AppState.sessionCode || 'global'}`;
                                try { const saved = localStorage.getItem(roleKey); if (saved) roleSelect.value = saved; } catch(e){}
                                roleSelect.addEventListener('change', () => { try { localStorage.setItem(roleKey, roleSelect.value); } catch(e){} });

                                const form = document.createElement('div');
                                form.className = 'chat-input';
                                form.style.display = 'flex';
                                form.style.gap = '6px';

                                const input = document.createElement('input');
                                input.type = 'text';
                                input.placeholder = 'Send a message to session';
                                input.className = 'chat-input-field';
                                input.style.flex = '1 1 auto';

                                const sendBtn = document.createElement('button');
                                sendBtn.className = 'btn btn-primary';
                                sendBtn.textContent = 'Send';

                                form.appendChild(input);
                                form.appendChild(sendBtn);
                                contentEl.appendChild(form);

                                function appendChatMessage(m, opts = {}) {
                                    try {
                                        if (!m) return;
                                        // normalize message object: ensure we use server message object shape
                                        const msg = m;

                                        // If server id present and already seen, skip (dedupe)
                                        if (msg.id && contentEl._chatIds.has(msg.id)) return;

                                        // If this message is a server echo for a pending local message, reconcile
                                        if (msg.clientTempId && contentEl._pendingMap && contentEl._pendingMap[msg.clientTempId]) {
                                            // replace pending element with the canonical server message
                                            const pendingEl = contentEl._pendingMap[msg.clientTempId];
                                            pendingEl.classList.remove('pending');
                                            try { pendingEl.dataset.msgId = msg.id; } catch (e) {}
                                            // update contents
                                            try {
                                                const meta = pendingEl.querySelector('.chat-meta');
                                                if (meta) meta.textContent = `${msg.from || msg.role || 'User'}` + (msg.role ? ` • ${msg.role}` : '');
                                                const body = pendingEl.querySelector('.chat-body'); if (body) body.textContent = msg.text || '';
                                            } catch (e) {}
                                            // mark id as seen and remove pending mapping
                                            if (msg.id) contentEl._chatIds.add(msg.id);
                                            delete contentEl._pendingMap[msg.clientTempId];
                                            return;
                                        }

                                        // Create element for new message
                                        const el = document.createElement('div');
                                        el.className = 'chat-msg';
                                        const roleClass = msg.role ? `role-${msg.role.toLowerCase().replace(/\s+/g,'-')}` : '';
                                        if (roleClass) el.classList.add(roleClass);
                                        if (opts.own) el.classList.add('own');

                                        // meta line
                                        const meta = document.createElement('div'); meta.className = 'chat-meta'; meta.style.fontSize = '0.75rem'; meta.style.color = 'var(--text-secondary)'; meta.style.marginBottom = '4px';
                                        meta.textContent = `${msg.from || msg.role || 'User'}` + (msg.role ? ` • ${msg.role}` : '');
                                        el.appendChild(meta);
                                        const body = document.createElement('div'); body.className = 'chat-body'; body.textContent = msg.text || '';
                                        el.appendChild(body);

                                        // attach identifiers when present
                                        if (msg.id) {
                                            try { el.dataset.msgId = msg.id; } catch (e) {}
                                            contentEl._chatIds.add(msg.id);
                                        }
                                        if (msg.clientTempId && !msg.id) {
                                            // pending local message (client-side temporary id)
                                            try { el.dataset.tempId = msg.clientTempId; } catch (e) {}
                                            el.classList.add('pending');
                                            contentEl._pendingMap[msg.clientTempId] = el;
                                        }

                                        msgs.appendChild(el);
                                        msgs.scrollTop = msgs.scrollHeight;
                                    } catch (e) {}
                                }

                                // expose helper for external message arrival
                                contentEl._appendChatMessage = appendChatMessage;

                                sendBtn.addEventListener('click', () => {
                                    try {
                                        const text = (input.value || '').trim();
                                        if (!text) return;
                                        const role = roleSelect.value || 'Musician';
                                        // create a client-side temp id so we can show the message immediately and reconcile
                                        const clientTempId = `tmp_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
                                        const payload = { type: 'chat:message', session: AppState.sessionCode, from: AppState.isDirector ? 'Director' : 'Viewer', role, text, clientTempId };
                                        try {
                                            // append pending message locally immediately
                                            appendChatMessage(payload, { own: true });
                                            if (_ws && _ws.readyState === WebSocket.OPEN) _ws.send(JSON.stringify(payload));
                                            else showToast('Not connected to server', 900);
                                        } catch (e) { showToast('Failed to send message', 900); }
                                        input.value = '';
                                    } catch (e) {}
                                });

                                input.addEventListener('keypress', (e) => {
                                    if (e.key === 'Enter') sendBtn.click();
                                });
                            } catch (e) {}
                        }
                    };
                    // chat module is rendered into Live view instead of the sidebar
                } catch (e) {}
                // subscribe to page creation events (if supported)
                if (typeof window._pageManager.on === 'function') {
                    try { window._pageManager.on('pages:created', () => { try { window._sidebarManager.renderModules(); } catch(e){} }); } catch(e){}
                    try { window._pageManager.on('deserialized', () => { try { window._sidebarManager.renderModules(); } catch(e){} }); } catch(e){}
                    // when a single page's thumbnail is ready, update just that thumb
                    try { window._pageManager.on('page:thumb', ({ pageId, thumb }) => { try { window._sidebarManager.updateThumb(pageId, thumb); flashThumb(pageId); } catch(e){} }); } catch(e){}
                    // when an annotation changes, notify the sidebar (visual cue)
                    try { window._pageManager.on('page:annotation', ({ pageId }) => { try { flashThumb(pageId); } catch(e){} }); } catch(e){}
                    // lightweight combined event emitted when either thumb or annotation updates
                    try { window._pageManager.on('page:updated', ({ pageId, page }) => { try { if (page && page.thumb) window._sidebarManager.updateThumb(pageId, page.thumb); flashThumb(pageId); } catch(e){} }); } catch(e){}
                }
            } catch (e) {}
        }
    } catch (e) { console.warn('PageManager init failed', e); }

    // Restore any saved currentSession (demo persistence). This helps preserve director/attendee state across reloads.
    try {
        const savedSessionRaw = localStorage.getItem('currentSession');
        if (savedSessionRaw) {
            const savedSession = JSON.parse(savedSessionRaw);
            if (savedSession && savedSession.code) {
                AppState.sessionCode = savedSession.code;
                AppState.isDirector = !!savedSession.isDirector;
                AppState.charts = savedSession.charts || [];
                const uploadCodeEl = document.getElementById('session-code-display');
                if (uploadCodeEl) uploadCodeEl.textContent = AppState.sessionCode;
                const viewerCodeTextEl = document.getElementById('viewer-session-code-text');
                if (viewerCodeTextEl) viewerCodeTextEl.textContent = `Session: ${AppState.sessionCode}`;
            }
        }
    } catch (e) {
        console.error('Failed to restore currentSession from localStorage:', e);
    }

    // Update UI based on role (director vs attendee)
    try { updateRoleUI(); } catch (e) { /* non-fatal */ }

    // Attach click listeners to any theme toggle buttons (present on multiple pages)
    document.querySelectorAll('.theme-toggle').forEach(btn => {
        btn.addEventListener('click', function() {
            const current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
            const next = current === 'dark' ? 'light' : 'dark';
            localStorage.setItem('theme', next);
            applyTheme(next);
        });
    });
    // Landing page
    const createBtn = document.getElementById('create-session-btn');
    if (createBtn) createBtn.addEventListener('click', createSession);

    const joinBtn = document.getElementById('join-session-btn');
    if (joinBtn) joinBtn.addEventListener('click', joinSession);

    // Ensure the create/join functions are available on window for inline onclicks
    try {
        window.createSession = createSession;
        window.joinSession = joinSession;
        // also set inline attributes as a last-resort fallback
        if (createBtn && !createBtn.getAttribute('onclick')) createBtn.setAttribute('onclick', 'createSession()');
        if (joinBtn && !joinBtn.getAttribute('onclick')) joinBtn.setAttribute('onclick', 'joinSession()');
    } catch (e) {}

    const sessionInput = document.getElementById('session-code-input');
    if (sessionInput) {
        sessionInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') joinSession();
        });
    }
    
    // Upload page
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('pdf-upload');

    const browseBtn = document.getElementById('browse-files-btn');
    if (browseBtn && fileInput) {
        browseBtn.addEventListener('click', () => {
            fileInput.click();
        });
    }

    if (fileInput) {
        fileInput.addEventListener('change', function(e) {
            handleFileSelect(e.target.files);
        });
    }

    // Organize view: allow adding charts from here as well
    const addChartsBtn = document.getElementById('add-charts-btn');
    if (addChartsBtn && fileInput) {
        addChartsBtn.addEventListener('click', () => {
            // reuse the hidden file input to add charts
            fileInput.click();
        });
    }

    if (dropZone) {
        dropZone.addEventListener('dragover', function(e) {
            e.preventDefault();
            dropZone.classList.add('drag-over');
        });
        
        dropZone.addEventListener('dragleave', function(e) {
            e.preventDefault();
            dropZone.classList.remove('drag-over');
        });
        
        dropZone.addEventListener('drop', function(e) {
            e.preventDefault();
            dropZone.classList.remove('drag-over');
            handleFileSelect(e.dataTransfer.files);
        });
    }

    const startBtn = document.getElementById('start-session-btn');
    if (startBtn) startBtn.addEventListener('click', startSession);
    
    // Viewer page
    const leaveBtn = document.getElementById('leave-session-btn');
    if (leaveBtn) leaveBtn.addEventListener('click', leaveSession);

    const prevPageBtn = document.getElementById('prev-page-btn');
    if (prevPageBtn) prevPageBtn.addEventListener('click', prevPage);

    const nextPageBtn = document.getElementById('next-page-btn');
    if (nextPageBtn) nextPageBtn.addEventListener('click', nextPage);

    const prevChartBtn = document.getElementById('prev-chart-btn');
    if (prevChartBtn) prevChartBtn.addEventListener('click', prevChart);

    const nextChartBtn = document.getElementById('next-chart-btn');
    if (nextChartBtn) nextChartBtn.addEventListener('click', nextChart);

    const editBtn = document.getElementById('edit-mode-btn');
    if (editBtn) editBtn.addEventListener('click', () => switchToMode('edit'));
    const liveBtn = document.getElementById('live-mode-btn');
    if (liveBtn) liveBtn.addEventListener('click', () => switchToMode('live'));

    const organizeBtn = document.getElementById('organize-mode-btn');
    if (organizeBtn) organizeBtn.addEventListener('click', () => switchToMode('organize'));

    const annotationBtn = document.getElementById('annotation-btn');
    if (annotationBtn) annotationBtn.addEventListener('click', toggleAnnotationMode);

    // Initialize the annotation toolbar (color, undo, clear)
    try { initAnnotationToolbar(); } catch (e) { console.warn('initAnnotationToolbar failed', e); }

    // initAnnotationToolbar implementation
    function initAnnotationToolbar() {
        const toolbar = document.getElementById('annotation-toolbar');
        if (!toolbar) return;
        const colorInput = document.getElementById('annotation-color');
        const undoBtn = document.getElementById('annotation-undo');
        const clearBtn = document.getElementById('annotation-clear');

        if (colorInput) {
            colorInput.addEventListener('input', (e) => {
                try { ANNOTATION_CONFIG.strokeStyle = e.target.value; } catch (err) {}
            });
        }
        if (undoBtn) {
            undoBtn.addEventListener('click', (e) => {
                try { const ok = undoLastStroke(); if (ok) showToast('Undid last stroke', 900); else showToast('Nothing to undo', 900); } catch (err) {}
            });
        }
        if (clearBtn) {
            clearBtn.addEventListener('click', (e) => {
                if (!confirm('Clear all annotations on this page?')) return;
                try { const ok = clearPageAnnotations(); if (ok) showToast('Cleared annotations', 900); } catch (err) {}
            });
        }
    }
    
    // Annotation drawing
    const annotationCanvas = document.getElementById('annotation-canvas');
    if (annotationCanvas) {
        annotationCanvas.addEventListener('mousedown', startDrawing);
        annotationCanvas.addEventListener('mousemove', draw);
        annotationCanvas.addEventListener('mouseup', stopDrawing);
        annotationCanvas.addEventListener('mouseout', stopDrawing);
    }

    // Ensure toolbar reflects PageManager availability on load
    try {
        const toolbar = document.getElementById('annotation-toolbar');
        if (toolbar) toolbar.hidden = true;
    } catch (e) {}
    
    // Touch support for annotations
    if (annotationCanvas) {
        annotationCanvas.addEventListener('touchstart', function(e) {
            e.preventDefault();
            const touch = e.touches[0];
            const mouseEvent = new MouseEvent('mousedown', {
                clientX: touch.clientX,
                clientY: touch.clientY
            });
            annotationCanvas.dispatchEvent(mouseEvent);
        });
        
        annotationCanvas.addEventListener('touchmove', function(e) {
            e.preventDefault();
            const touch = e.touches[0];
            const mouseEvent = new MouseEvent('mousemove', {
                clientX: touch.clientX,
                clientY: touch.clientY
            });
            annotationCanvas.dispatchEvent(mouseEvent);
        });
        
        annotationCanvas.addEventListener('touchend', function(e) {
            e.preventDefault();
            const mouseEvent = new MouseEvent('mouseup', {});
            annotationCanvas.dispatchEvent(mouseEvent);
        });
    }
    
    // Keyboard shortcuts
    document.addEventListener('keydown', function(e) {
        if (AppState.currentPage !== 'viewer') return;
        
        switch(e.key) {
            case 'ArrowLeft':
                prevPage();
                break;
            case 'ArrowRight':
                nextPage();
                break;
            case 'ArrowUp':
                prevChart();
                break;
            case 'ArrowDown':
                nextChart();
                break;
        }
    });

    // Copy session code button
    const copyBtn = document.getElementById('copy-session-code-btn');
    if (copyBtn) {
        copyBtn.addEventListener('click', async function() {
            const codeEl = document.getElementById('viewer-session-code-text');
            const raw = codeEl ? codeEl.textContent : '';
            const code = raw ? raw.replace(/^Session:\s*/i, '').trim() : (AppState.sessionCode || '').toString();
            if (!code) return;
            try {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    await navigator.clipboard.writeText(code);
                } else {
                    const ta = document.createElement('textarea');
                    ta.value = code;
                    document.body.appendChild(ta);
                    ta.select();
                    document.execCommand('copy');
                    document.body.removeChild(ta);
                }
                const orig = copyBtn.innerHTML;
                copyBtn.textContent = '✓';
                setTimeout(() => { copyBtn.innerHTML = orig; }, 1200);
            } catch (err) {
                console.error('Failed to copy session code:', err);
                alert('Could not copy session code. Please select and copy it manually.');
            }
        });
    }
    } catch (err) {
        // Log initialization errors without preventing UI interactions
        console.error('Initialization error in app.js DOMContentLoaded:', err);
    }
});

// Keep right dock columns responsive to window resizes
window.addEventListener('resize', () => { try { adjustRightDockColumns(); } catch (e) {} });
// Also call once at load to set initial layout
try { adjustRightDockColumns(); } catch (e) {}
