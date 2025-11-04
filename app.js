// Annotation Constants
const ANNOTATION_CONFIG = {
    strokeStyle: '#ef4444',
    lineWidth: 3,
    lineCap: 'round',
    lineJoin: 'round'
};

// Utility function to escape HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
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
    canvas: null,
    context: null,
    annotationCanvas: null,
    annotationContext: null,
    isDrawing: false,
    lastX: 0,
    lastY: 0
};

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
    const thumbsContainer = document.getElementById('live-thumbs');
    if (!pagesContainer || !thumbsContainer) return;
    pagesContainer.innerHTML = '';
    thumbsContainer.innerHTML = '';

    if (!window['pdfjsLib']) return;
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';

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

        // generate or reuse a cached thumbnail for this chart (use helper)
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

                            // thumbnails are generated separately (one-per-chart) via generateThumbnail helper

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
    // initialize splitter/resizer between pages and thumbs (responsive & draggable)
    setTimeout(() => { initLiveResizer(); }, 320);
}

// Live layout resizer: draggable splitter between .live-pages and .live-thumbs
function initLiveResizer() {
    try {
        const container = document.querySelector('.live-container');
        const pages = document.querySelector('.live-pages');
        const thumbs = document.querySelector('.live-thumbs');
        if (!container || !pages || !thumbs) return;

        // create splitter if missing
        let splitter = container.querySelector('.live-splitter');
        if (!splitter) {
            splitter = document.createElement('div');
            splitter.className = 'live-splitter';
            splitter.tabIndex = 0;
            splitter.setAttribute('role', 'separator');
            splitter.setAttribute('aria-orientation', 'vertical');
            splitter.setAttribute('aria-label', 'Resize thumbnails');
            // insert splitter before thumbs
            container.insertBefore(splitter, thumbs);
        }

        // apply saved width if present
        const saved = parseInt(localStorage.getItem('liveThumbWidth') || '0', 10);
        if (saved && saved > 80) {
            thumbs.style.flex = `0 0 ${saved}px`;
            thumbs.style.maxWidth = `${Math.max(saved, 220)}px`;
            thumbs.setAttribute('aria-resizable', 'true');
        } else {
            thumbs.style.flex = thumbs.style.flex || '0 0 180px';
        }

        let dragging = false;
        let startX = 0; let startY = 0; let startWidth = 0;

        function onPointerDown(e) {
            e.preventDefault();
            dragging = true;
            startX = (e.clientX || (e.touches && e.touches[0].clientX)) || 0;
            startY = (e.clientY || (e.touches && e.touches[0].clientY)) || 0;
            startWidth = thumbs.getBoundingClientRect().width;
            document.body.style.userSelect = 'none';
            window.addEventListener('pointermove', onPointerMove);
            window.addEventListener('pointerup', onPointerUp);
            window.addEventListener('touchmove', onPointerMove, { passive: false });
            window.addEventListener('touchend', onPointerUp);
        }

        function onPointerMove(e) {
            if (!dragging) return;
            e.preventDefault();
            const clientX = (e.clientX || (e.touches && e.touches[0].clientX)) || 0;
            const clientY = (e.clientY || (e.touches && e.touches[0].clientY)) || 0;
            const containerRect = container.getBoundingClientRect();
            if (containerRect.width === 0) return;

            // If container is vertical (mobile), resize height instead of width
            if (window.getComputedStyle(container).flexDirection === 'column') {
                const delta = clientY - startY;
                const pagesHeight = pages.getBoundingClientRect().height - delta;
                // clamp
                const min = 120; const max = containerRect.height - 80;
                const newPagesH = Math.max(min, Math.min(max, pagesHeight));
                pages.style.flex = `0 0 ${newPagesH}px`;
                // persist
                localStorage.setItem('liveThumbHeight', String(newPagesH));
            } else {
                const delta = startX - clientX; // dragging left increases thumb width
                let newWidth = startWidth + delta;
                // clamp between 100 and 480
                newWidth = Math.max(100, Math.min(480, newWidth));
                thumbs.style.flex = `0 0 ${Math.round(newWidth)}px`;
                thumbs.style.maxWidth = `${Math.round(Math.max(newWidth, 220))}px`;
                thumbs.setAttribute('aria-resizable', 'true');
                localStorage.setItem('liveThumbWidth', String(Math.round(newWidth)));
            }
        }

        function onPointerUp() {
            dragging = false;
            document.body.style.userSelect = '';
            window.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('pointerup', onPointerUp);
            window.removeEventListener('touchmove', onPointerMove);
            window.removeEventListener('touchend', onPointerUp);
        }

        // pointer events if supported, otherwise fallback to mouse
        splitter.addEventListener('pointerdown', onPointerDown);
        splitter.addEventListener('touchstart', onPointerDown, { passive: false });

        // ensure thumbs sizing adapts on window resize
        window.addEventListener('resize', () => {
            const savedW = parseInt(localStorage.getItem('liveThumbWidth') || '0', 10);
            const contW = container.getBoundingClientRect().width;
            if (savedW && savedW > contW * 0.8) {
                // reduce to 40% if it's too large
                const adj = Math.max(120, Math.round(contW * 0.35));
                thumbs.style.flex = `0 0 ${adj}px`;
                localStorage.setItem('liveThumbWidth', String(adj));
            }
        });
    } catch (e) { console.warn('initLiveResizer failed', e); }
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
                handleServerChartsUpdate(j.charts || []);
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
    // Preserve visible position: find first visible page wrapper
    const pagesContainer = document.getElementById('live-pages');
    if (!pagesContainer) return;

    const containerRect = pagesContainer.getBoundingClientRect();
    const wrappers = Array.from(pagesContainer.querySelectorAll('.live-page-wrapper'));
    let visible = null;
    for (const w of wrappers) {
        const r = w.getBoundingClientRect();
        if (r.top < containerRect.bottom && r.bottom > containerRect.top) {
            visible = { chartId: w.dataset.chartId, page: w.dataset.page, offset: r.top - containerRect.top };
            break;
        }
    }

    const local = JSON.stringify(AppState.charts || []);
    const remote = JSON.stringify(serverCharts || []);
    if (local === remote) return; // nothing changed

    // update state
    AppState.charts = serverCharts;
    try { localStorage.setItem(`session_${AppState.sessionCode}`, JSON.stringify({ code: AppState.sessionCode, charts: AppState.charts })); } catch (e) {}

    // show toast to indicate update
    showToast('Session updated by Music Director');

    // show a small live-update badge near thumbnails
    try {
        const thumbsContainer = document.getElementById('live-thumbs');
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

    // Re-render live view and attempt to preserve scroll position
    if (AppState.viewMode === 'live') {
        renderLiveMode();
        // animate each chart block briefly to draw attention to the reorder
        setTimeout(() => {
            try {
                const pagesContainer2 = document.getElementById('live-pages');
                const chartBlocks = pagesContainer2 ? Array.from(pagesContainer2.querySelectorAll('.live-chart-block')) : [];
                chartBlocks.forEach(cb => {
                    cb.classList.add('reorder-anim');
                    setTimeout(() => cb.classList.remove('reorder-anim'), 800);
                });
            } catch (e) {}
        }, 120);
        // after a short delay to allow DOM to populate, scroll to preserved position
        setTimeout(() => {
            if (!visible) return;
            const pagesContainer2 = document.getElementById('live-pages');
            const target = pagesContainer2.querySelector(`.live-page-wrapper[data-chart-id="${visible.chartId}"][data-page="${visible.page}"]`);
            if (target) {
                const rect = target.getBoundingClientRect();
                // scroll so that target is at approximately the same offset from top
                const desiredTop = pagesContainer2.scrollTop + (rect.top - pagesContainer2.getBoundingClientRect().top) - visible.offset;
                pagesContainer2.scrollTop = Math.max(0, Math.round(desiredTop));
            }
        }, 220);
    }
}

// IntersectionObserver to highlight current page/thumbnail
function initLiveHighlighting() {
    const pagesContainer = document.getElementById('live-pages');
    const thumbsContainer = document.getElementById('live-thumbs');
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
                const res = await fetch(`${SERVER_BASE}/api/sessions/${AppState.sessionCode}/charts`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'x-director-token': directorToken },
                    body: JSON.stringify({ charts: AppState.charts })
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
}

function saveAnnotations() {
    const key = `${AppState.sessionCode}_${AppState.currentChartIndex}_${AppState.currentPageNumber}`;
    AppState.annotations[key] = AppState.annotationCanvas.toDataURL();
}

function restoreAnnotations() {
    const key = `${AppState.sessionCode}_${AppState.currentChartIndex}_${AppState.currentPageNumber}`;
    const savedAnnotation = AppState.annotations[key];
    
    if (savedAnnotation) {
        const img = new Image();
        img.onload = () => {
            AppState.annotationContext.clearRect(0, 0, AppState.annotationCanvas.width, AppState.annotationCanvas.height);
            AppState.annotationContext.drawImage(img, 0, 0);
        };
        img.src = savedAnnotation;
    } else {
        AppState.annotationContext.clearRect(0, 0, AppState.annotationCanvas.width, AppState.annotationCanvas.height);
    }
}

// Drawing
function startDrawing(e) {
    if (!AppState.annotationMode) return;
    
    AppState.isDrawing = true;
    const rect = AppState.annotationCanvas.getBoundingClientRect();
    AppState.lastX = e.clientX - rect.left;
    AppState.lastY = e.clientY - rect.top;
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
    
    AppState.lastX = x;
    AppState.lastY = y;
}

function stopDrawing() {
    if (AppState.isDrawing) {
        AppState.isDrawing = false;
        saveAnnotations();
    }
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
            if (theme === 'dark') {
                // Sun icon for light (to indicate switching back)
                btn.innerHTML = `\n                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">\n                        <circle cx="12" cy="12" r="4"></circle>\n                        <path d="M12 2v2"></path>\n                        <path d="M12 20v2"></path>\n                        <path d="M4.93 4.93l1.41 1.41"></path>\n                        <path d="M17.66 17.66l1.41 1.41"></path>\n                        <path d="M2 12h2"></path>\n                        <path d="M20 12h2"></path>\n                        <path d="M4.93 19.07l1.41-1.41"></path>\n                        <path d="M17.66 6.34l1.41-1.41"></path>\n                    </svg>`;
            } else {
                // Moon icon for dark (to indicate switching to dark)
                btn.innerHTML = `\n                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">\n                        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>\n                    </svg>`;
            }
        });
    }

    // Initialize theme from localStorage (per-client)
    const savedTheme = localStorage.getItem('theme') || 'light';
    applyTheme(savedTheme);

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
    
    // Annotation drawing
    const annotationCanvas = document.getElementById('annotation-canvas');
    if (annotationCanvas) {
        annotationCanvas.addEventListener('mousedown', startDrawing);
        annotationCanvas.addEventListener('mousemove', draw);
        annotationCanvas.addEventListener('mouseup', stopDrawing);
        annotationCanvas.addEventListener('mouseout', stopDrawing);
    }
    
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
