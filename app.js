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
    const container = document.getElementById('sidebar-quick-jump');
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
    if (AppState.creatingSession) {
        console.log('createSession: already in progress, ignoring duplicate call');
        // return the existing creating promise if present
        return AppState._creatingPromise || Promise.resolve();
    }
    AppState.creatingSession = true;

    // Try to create session server-side; fallback to client-only session if unavailable
    const p = (async () => {
            try {
                const res = await fetch(`${SERVER_BASE}/api/sessions`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
                let bodyText = '';
                try { bodyText = await res.text(); } catch (e) { bodyText = ''; }
                try { console.log('createSession: POST /api/sessions -> status=%s body=%s', res.status, bodyText); } catch (e) {}
                if (res.ok) {
                    // rewind the body we already consumed as text by parsing JSON from it
                    let j = null;
                    try { j = JSON.parse(bodyText); } catch (e) { j = null; }
                    if (!j) {
                        // if parsing failed, try to call res.json() as a fallback
                        try { j = await res.json(); } catch (e) { j = null; }
                    }
                    if (j) {
                        AppState.sessionCode = j.code;
                        AppState.isDirector = true;
                        AppState.directorToken = j.directorToken;
                        try {
                            localStorage.setItem(`session_${j.code}_directorToken`, j.directorToken);
                            // default the creator's chat role to MD for this session
                            try { localStorage.setItem(`chat_role_${j.code}`, 'MD'); } catch (e) {}
                            localStorage.setItem('session_current_code', j.code);
                            localStorage.setItem('session_current_directorToken', j.directorToken);
                            console.info('Persisted director token for session', j.code, j);
                        } catch (e) {}

                        // Ensure the live websocket is started so the director can subscribe
                        // immediately. This prevents a race where the server believes there
                        // are no connected clients and deletes the newly-created session.
                        try { startLiveSocket(); } catch (e) {}

                        // Immediately verify the session exists on the server
                        try {
                            const verify = await fetch(`${SERVER_BASE}/api/sessions/${j.code}`);
                            let verifyBody = '';
                            try { verifyBody = await verify.text(); } catch (e) { verifyBody = ''; }
                            console.log('createSession: verify GET /api/sessions/%s -> status=%s body=%s', j.code, verify.status, verifyBody);
                        } catch (e) { console.warn('createSession: failed to verify session existence', e); }
                    } else {
                        // parsing failed - fallback to client-only
                        AppState.sessionCode = generateSessionCode();
                        AppState.isDirector = true;
                    }
                } else {
                    // fallback to client-only session
                    AppState.sessionCode = generateSessionCode();
                    AppState.isDirector = true;
                }
            } catch (e) {
                // network/server unavailable - fallback to client-only session
                AppState.sessionCode = generateSessionCode();
                AppState.isDirector = true;
            }

        showPage('upload');
        const uploadCodeEl = document.getElementById('session-code-display');
        if (uploadCodeEl) uploadCodeEl.textContent = AppState.sessionCode;
        const viewerCodeTextEl = document.getElementById('viewer-session-code-text');
        if (viewerCodeTextEl) viewerCodeTextEl.textContent = `Session: ${AppState.sessionCode}`;
        // Update UI to reflect director privileges
        updateRoleUI();
        // If a live websocket exists, ensure subscription (no-op if already subscribed)
        try { sendSubscribeIfNeeded(); } catch (e) {}
    })().finally(() => { try { AppState.creatingSession = false; } catch (e) {} });
    AppState._creatingPromise = p;
    // clear stored promise when done
    p.finally(() => { try { delete AppState._creatingPromise; } catch (e) {} });
    return p;
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
    // If this client has the saved director token for this session (or an in-memory token), treat as director locally
    const localToken = AppState.directorToken || localStorage.getItem(`session_${code}_directorToken`);
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
            // ensure websocket subscription for live updates (no-op if already subscribed)
            try { sendSubscribeIfNeeded(); } catch (e) {}
                try { refreshQuickJump(); } catch (e) {}
                try { window.dispatchEvent(new CustomEvent('charts:changed')); } catch (e) {}
        } else {
            alert('This session has no charts yet. Please wait for the Music Director to upload charts.');
        }
    })();
}

function startSession() {
    console.log('startSession() called', { sessionCode: AppState.sessionCode, chartsCount: AppState.charts.length });

    // If we restored a session automatically from localStorage earlier in
    // this page load, the user's intent when clicking "Start Session" may be
    // to create a fresh session. Offer a small confirmation so they can
    // choose to clear the restored charts and start new.
    try {
        if (window._restoredCurrentSession) {
            const keep = confirm('A saved session was detected from a previous visit.\n\nPress OK to continue with the saved charts, or Cancel to clear them and start a fresh session.');
            if (!keep) {
                AppState.charts = [];
                try { localStorage.removeItem('currentSession'); } catch (e) {}
                try { window._restoredCurrentSession = false; } catch (e) {}
            }
        }
    } catch (e) {}

    if (AppState.charts.length === 0) {
        alert('Please upload at least one PDF before starting the session');
        return;
    }

    // Ensure there's a session code (allow starting without explicitly clicking "Create Session")
    if (!AppState.sessionCode) {
        AppState.sessionCode = generateSessionCode();
        AppState.isDirector = true;
        try { localStorage.setItem(`chat_role_${AppState.sessionCode}`, 'MD'); } catch (e) {}
        const codeEl = document.getElementById('session-code-display');
        if (codeEl) codeEl.textContent = AppState.sessionCode;
    const viewerCodeTextEl = document.getElementById('viewer-session-code-text');
    if (viewerCodeTextEl) viewerCodeTextEl.textContent = `Session: ${AppState.sessionCode}`;
        console.info('Generated session code for startSession:', AppState.sessionCode);
    }

    // Save session data: attempt server-side save only when a director token is present.
    // Do NOT persist sessions into localStorage by default.
    (async () => {
        const directorToken = AppState.directorToken || localStorage.getItem(`session_${AppState.sessionCode}_directorToken`);
        if (directorToken) {
            try {
                const res = await fetch(`${SERVER_BASE}/api/sessions/${AppState.sessionCode}/charts`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'x-director-token': directorToken },
                    body: JSON.stringify({ charts: AppState.charts })
                });
                if (!res.ok) throw new Error('server save failed');
            } catch (e) {
                console.warn('Failed to save charts to server', e);
            }
        } else {
            // No director token: do not write session to localStorage. The app will only
            // persist sessions when server-side presence is confirmed.
        }

        // Navigate to viewer and render the first chart, but guard rendering errors
        try {
            // Ensure this user is marked as the director when starting
            AppState.isDirector = true;
            // Update role-based UI (show edit/organize for directors)
            updateRoleUI();
            // Show viewer but default to Organize so director can clean charts first
            showPage('viewer');
            try {
                switchToMode('organize');
                renderOrganizeMode();
            } catch (e) {
                // fallback: if organize fails, default to Live view as a last resort
                try { switchToMode('live'); renderLiveMode(); } catch (err) {}
            }
            console.log('startSession completed: viewer shown in Organize mode');
        } catch (err) {
            console.error('Error while rendering viewer after startSession:', err);
            alert('An error occurred while starting the session. Check the console for details.');
        }
    })();
}

async function leaveSession() {
    if (!confirm('Are you sure you want to leave this session?')) return;

    // Capture values for a possible server-side delete before we clear state
    const serverCode = AppState.sessionCode;
    const serverToken = AppState.directorToken;

    // Stop live socket immediately
    stopLiveSocket();

    // If this client was the director and a server-side token exists, ask server to delete the session immediately
    if (serverCode && serverToken) {
        try {
            const res = await fetch(`${SERVER_BASE}/api/sessions/${serverCode}`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json', 'x-director-token': serverToken }
            });
            let bodyText = '';
            try { bodyText = await res.text(); } catch (e) { bodyText = ''; }
            try { console.log('DELETE /api/sessions/%s -> status=%s body=%s', serverCode, res.status, bodyText); } catch (e) {}
            if (res.ok) {
                showToast('Session deleted from server', 1600);
            } else if (res.status === 403) {
                showToast('Session delete forbidden (invalid director token)', 3000);
            } else if (res.status === 404) {
                showToast('Session not found on server (already deleted)', 2600);
            } else {
                showToast(`Failed to delete session on server (status ${res.status})`, 3000);
            }
        } catch (err) {
            console.error('Failed to DELETE session:', err);
            showToast('Failed to contact server to delete session', 2500);
        }
    }

    // Reset state and clear persisted session data
    AppState.charts = [];
    AppState.currentChartIndex = 0;
    AppState.currentPageNumber = 1;
    try {
        if (serverCode) {
            try { localStorage.removeItem(`session_${serverCode}`); } catch (e) {}
            try { localStorage.removeItem(`session_${serverCode}_directorToken`); } catch (e) {}
        }
        try { localStorage.removeItem('currentSession'); } catch (e) {}
    } catch (e) {}
    AppState.sessionCode = null;
    AppState.isDirector = false;

    const viewerCodeTextEl = document.getElementById('viewer-session-code-text');
    if (viewerCodeTextEl) viewerCodeTextEl.textContent = '';
    const uploadCodeEl = document.getElementById('session-code-display');
    if (uploadCodeEl) uploadCodeEl.textContent = '';
    // Update UI to a neutral state (no director controls visible)
    updateRoleUI();
    showPage('landing');

    // ensure Quick Jump is cleared
    try { refreshQuickJump(); } catch (e) {}

    // Close and remove any floating windows or session-specific modals that
    // were created for this session (chat, thumbnails, editors, etc.). When
    // returning to the landing page we want a clean slate.
    try {
        // Remove floating windows (chat, thumbs, any other floating panels)
        const floats = Array.from(document.querySelectorAll('.floating-window'));
        floats.forEach(f => {
            try {
                // call hide if available to run any hide logic, then remove DOM node
                if (typeof f.hide === 'function') try { f.hide(); } catch (e) {}
                if (f.parentNode) f.parentNode.removeChild(f);
            } catch (e) {}
        });

        // Close any session modals (pages editor) and remove their content
        const pagesModal = document.getElementById('pages-editor-modal');
        if (pagesModal) {
            try { pagesModal.setAttribute('aria-hidden', 'true'); pagesModal.classList.remove('visible'); } catch (e) {}
            try { const grid = document.getElementById('pages-editor-grid'); if (grid) grid.innerHTML = ''; } catch (e) {}
            try {
                // replace backdrop/close/done nodes to remove leftover handlers
                const backdrop = document.getElementById('pages-editor-backdrop'); if (backdrop && backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
                const closeBtn = document.getElementById('pages-editor-close'); if (closeBtn && closeBtn.parentNode) closeBtn.parentNode.removeChild(closeBtn);
                const doneBtn = document.getElementById('pages-editor-done'); if (doneBtn && doneBtn.parentNode) doneBtn.parentNode.removeChild(doneBtn);
            } catch (e) {}
        }
    } catch (e) {}
}

// Page Navigation
function showPage(pageName) {
    const pages = document.querySelectorAll('.page');
    pages.forEach(page => page.classList.remove('active'));
    
    const targetPage = document.getElementById(`${pageName}-page`);
    if (targetPage) {
        targetPage.classList.add('active');
        AppState.currentPage = pageName;
                try { refreshQuickJump(); } catch (e) {}
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
    // After adding a chart, switch the director to Organize mode so they can clean up pages
    try { if (AppState.isDirector) switchToMode('organize'); } catch (e) {}
    renderOrganizeMode();
    saveSessionCharts();
    // ensure Quick Jump reflects new chart
    try { refreshQuickJump(); } catch (e) {}
    try { window.dispatchEvent(new CustomEvent('charts:changed')); } catch (e) {}
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
    // Always signal that charts changed so Quick Jump and other UI react
    try { window.dispatchEvent(new CustomEvent('charts:changed')); } catch (e) {}
    if (AppState.viewMode === 'organize') {
        // adjust current chart index if needed
        if (AppState.currentChartIndex >= AppState.charts.length) {
            AppState.currentChartIndex = Math.max(0, AppState.charts.length - 1);
        }
        renderOrganizeMode();
        try { refreshQuickJump(); } catch (e) {}
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
    
    const pdfViewer = document.getElementById('pdf-viewer');
    const pdfCanvas = document.getElementById('pdf-canvas');
    const annotationCanvas = document.getElementById('annotation-canvas');
    if (!annotationCanvas) return;
    const annotationContext = annotationCanvas.getContext('2d');
    if (!annotationContext) { console.error('Could not get 2d context for annotation canvas'); return; }
    AppState.annotationCanvas = annotationCanvas;
    AppState.annotationContext = annotationContext;

    // If PageManager + pageMap exists for this chart, render the selected page to canvas
    try {
        if (window.pdfjsLib && window._pageManager && Array.isArray(chart.pageMap) && chart.pageMap.length > 0) {
            // hide iframe fallback
            if (pdfViewer) pdfViewer.style.display = 'none';
            if (pdfCanvas) pdfCanvas.style.display = 'block';
            const pageId = chart.pageMap[Math.max(0, AppState.currentPageNumber - 1)];
            const pObj = window._pageManager.getPage(pageId) || {};
            const originalPage = pObj.pageIndex || AppState.currentPageNumber;
            pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
            pdfjsLib.getDocument(chart.data).promise.then(pdf => {
                return pdf.getPage(originalPage).then(page => {
                    const container = pdfCanvas.parentElement || document.querySelector('.pdf-display');
                    const containerWidth = container ? Math.max(320, container.clientWidth - 20) : 900;
                    const viewport = page.getViewport({ scale: 1 });
                    const scale = Math.min(containerWidth / viewport.width, 1);
                    const scaled = page.getViewport({ scale });
                    // size pdf canvas
                    pdfCanvas.width = scaled.width; pdfCanvas.height = scaled.height;
                    pdfCanvas.style.width = '100%';
                    pdfCanvas.style.height = 'auto';
                    const ctx = pdfCanvas.getContext('2d');
                    page.render({ canvasContext: ctx, viewport: scaled }).promise.then(() => {
                        // size annotation canvas to match pdf canvas pixels
                        annotationCanvas.width = pdfCanvas.width; annotationCanvas.height = pdfCanvas.height;
                        annotationCanvas.style.width = '100%'; annotationCanvas.style.height = 'auto';
                        // render vector annotations via PageManager if available
                        try {
                            if (pageId && window._pageManager) {
                                try { window._pageManager.renderAnnotationToCanvas(pageId, annotationCanvas); } catch (e) {}
                            } else {
                                // fallback to legacy PNG annotations
                                restoreAnnotations();
                            }
                        } catch (e) { restoreAnnotations(); }
                    }).catch(err => { console.warn('PDF render error', err); if (pdfViewer) { pdfViewer.style.display='block'; pdfViewer.src = `${chart.data}#page=${AppState.currentPageNumber}`; } });
                });
            }).catch(err => { console.warn('Failed to load PDF in canvas mode', err); if (pdfViewer) { pdfViewer.style.display='block'; pdfViewer.src = `${chart.data}#page=${AppState.currentPageNumber}`; } });
            // update page indicator
            document.getElementById('page-indicator').textContent = `Chart ${AppState.currentChartIndex + 1} of ${AppState.charts.length}`;
            return;
        }
    } catch (e) { console.warn('Canvas render path failed', e); }

    // fallback: use iframe PDF viewer
    try { if (pdfCanvas) pdfCanvas.style.display = 'none'; } catch (e) {}
    if (pdfViewer) pdfViewer.style.display = 'block'; if (pdfViewer) pdfViewer.src = `${chart.data}#page=${AppState.currentPageNumber}`;
    // Restore annotations (legacy path) — if PageManager is present but pageMap missing, restoreAnnotations will try PageManager where possible
    restoreAnnotations();
    
    // Update page indicator
    document.getElementById('page-indicator').textContent = `Chart ${AppState.currentChartIndex + 1} of ${AppState.charts.length}`;
}

// Render Live mode: continuous vertical pages with annotations and thumbnails
function renderLiveMode() {
    // Render all charts in order as a continuous scroll; thumbnails represent each page across charts.
    const pagesContainer = document.getElementById('live-pages');
    const thumbsContainer = document.querySelector('#live-quick-jump-module .module-content') || document.querySelector('.live-quick-jump') || null;
    if (!pagesContainer) return;
    pagesContainer.innerHTML = '';
    if (thumbsContainer) thumbsContainer.innerHTML = '';

    // Clear any organize-help text left in the header and show Live summary
    try {
        const pageIndicatorEl = document.getElementById('page-indicator');
        if (pageIndicatorEl) pageIndicatorEl.textContent = (AppState.charts && AppState.charts.length) ? `Live • ${AppState.charts.length} chart${AppState.charts.length > 1 ? 's' : ''}` : 'Live';
    } catch (e) {}

    // Live mode now uses a single-column layout; any previous splitter-based
    // sizing is intentionally not applied here.

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
    if (thumbsContainer) thumbsContainer.appendChild(thumbPlaceholder);

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
            // Determine pages to render: prefer chart.pageMap (PageManager) when present
            let pagesSpec = [];
            if (Array.isArray(chart.pageMap) && chart.pageMap.length > 0 && window._pageManager) {
                pagesSpec = chart.pageMap.map((pid, idx) => {
                    const pObj = window._pageManager.getPage(pid) || {};
                    return { pageIndex: pObj.pageIndex || (idx + 1), pageId: pid, logicalPage: idx + 1 };
                });
            } else {
                for (let p = 1; p <= pdf.numPages; p++) pagesSpec.push({ pageIndex: p, pageId: null, logicalPage: p });
            }

            pagesSpec.forEach(spec => {
                const wrapper = document.createElement('div');
                wrapper.className = 'live-page-wrapper';
                // stable chart id and page mapping
                wrapper.dataset.chartId = chart.id;
                wrapper.dataset.chartIndex = chartIdx;
                wrapper.dataset.page = spec.logicalPage;
                if (spec.pageIndex) wrapper.dataset.pageIndex = spec.pageIndex;
                if (spec.pageId) wrapper.dataset.pageId = spec.pageId;
                wrapper.dataset.rendered = '0';
                wrapper.style.minHeight = '200px';
                chartBlock.appendChild(wrapper);
            });

            const observer = new IntersectionObserver((entries, obs) => {
                entries.forEach(entry => {
                    if (!entry.isIntersecting) return;
                    const w = entry.target;
                    const logicalP = parseInt(w.dataset.page, 10);
                    const cIdx = parseInt(w.dataset.chartIndex, 10);
                    const originalPage = w.dataset.pageIndex ? parseInt(w.dataset.pageIndex, 10) : logicalP;
                    if (w.dataset.rendered === '1') { obs.unobserve(w); return; }

                    pdf.getPage(originalPage).then(page => {
                        const viewport = page.getViewport({ scale: 1 });
                        const scale = Math.min(900 / viewport.width, 1);
                        const scaled = page.getViewport({ scale });
                        const canvas = document.createElement('canvas');
                        canvas.width = scaled.width;
                        canvas.height = scaled.height;
                        const ctx = canvas.getContext('2d');
                        page.render({ canvasContext: ctx, viewport: scaled }).promise.then(() => {
                            // annotations will be rendered into the overlay canvas (created below) when PageManager is available

                            // legacy bitmap annotations (logical page index)
                            const key = `${AppState.sessionCode}_${cIdx}_${logicalP}`;
                            const ann = AppState.annotations[key];
                            if (ann) {
                                const img = new Image();
                                img.onload = () => {
                                    try { ctx.drawImage(img, 0, 0, canvas.width, canvas.height); } catch (e) {}
                                };
                                img.src = ann;
                            }

                            // append the rendered page canvas
                            w.appendChild(canvas);

                            // create an overlay canvas for live vector annotations
                            try {
                                const overlay = document.createElement('canvas');
                                overlay.className = 'live-annotation-canvas';
                                overlay.width = canvas.width; overlay.height = canvas.height;
                                overlay.style.position = 'absolute'; overlay.style.top = '0'; overlay.style.left = '0';
                                overlay.style.width = '100%'; overlay.style.height = '100%';
                                overlay.dataset.pageId = w.dataset.pageId || (Array.isArray(chart.pageMap) ? chart.pageMap[logicalP - 1] : '');
                                // ensure wrapper is positioned for absolute overlay
                                try { w.style.position = w.style.position || 'relative'; } catch (e) {}
                                // default interactivity depends on director + annotationMode
                                overlay.style.pointerEvents = (AppState.annotationMode && AppState.isDirector) ? 'auto' : 'none';
                                // attach drawing handlers which will set AppState.annotationCanvas/context dynamically
                                overlay.addEventListener('mousedown', startDrawing);
                                overlay.addEventListener('mousemove', draw);
                                overlay.addEventListener('mouseup', stopDrawing);
                                overlay.addEventListener('mouseout', stopDrawing);
                                // touch support
                                overlay.addEventListener('touchstart', function(e){ e.preventDefault(); const t = e.touches[0]; overlay.dispatchEvent(new MouseEvent('mousedown', { clientX: t.clientX, clientY: t.clientY })); });
                                overlay.addEventListener('touchmove', function(e){ e.preventDefault(); const t = e.touches[0]; overlay.dispatchEvent(new MouseEvent('mousemove', { clientX: t.clientX, clientY: t.clientY })); });
                                overlay.addEventListener('touchend', function(e){ e.preventDefault(); overlay.dispatchEvent(new MouseEvent('mouseup', {})); });
                                w.appendChild(overlay);
                                // render any existing vector annotations into the overlay
                                try {
                                    const pid = overlay.dataset.pageId;
                                    if (pid && window._pageManager) window._pageManager.renderAnnotationToCanvas(pid, overlay);
                                } catch (e) {}
                            } catch (e) {}

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
    // Modules are rendered as floating windows now; right-dock sortable
    // initialization is no longer required in Live mode.
}

// Live layout resizer removed: Live Mode is single-column and does not use
// a splitter between pages and a right dock. The previous resizer logic
// was removed to simplify the codebase.

// Adjust the right dock's grid columns responsively so modules can sit
// side-by-side based on available width. This helps when CSS minmax
// behavior alone doesn't produce the desired number of columns.
// adjustRightDockColumns removed: the right dock has been removed from the
// Live layout and floating panels handle module placement. This helper is
// no longer needed.

// Enable/disable pointer interactivity for live per-page annotation overlays.
function updateLiveOverlayInteractivity() {
    try {
        const overlays = Array.from(document.querySelectorAll('.live-annotation-canvas'));
        overlays.forEach(o => {
            if (AppState.annotationMode && AppState.isDirector) {
                o.style.pointerEvents = 'auto';
                o.classList.add('active');
            } else {
                o.style.pointerEvents = 'none';
                o.classList.remove('active');
            }
        });
    } catch (e) {}
}

// Debug helper: log boundingClientRect for key layout elements and briefly outline them.
// Temporary: used to diagnose layout changes.
function debugLogLayout(tag) {
    try {
        const elems = {
            wrapper: document.querySelector('.live-pages-wrapper'),
            pages: document.getElementById('live-pages'),
            right: document.querySelector('.live-right'),
            firstPage: document.querySelector('.live-page-wrapper')
        };
        const info = {};
        Object.keys(elems).forEach(k => {
            const el = elems[k];
            if (!el) { info[k] = null; return; }
            const r = el.getBoundingClientRect();
            info[k] = { left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
            // briefly outline the element so it's visible in the page
            try {
                const prev = el.style.outline || '';
                el.style.outline = '2px solid rgba(255,0,0,0.6)';
                setTimeout(() => { try { el.style.outline = prev; } catch (e) {} }, 900);
            } catch (e) {}
        });
        console.groupCollapsed(`LAYOUT DEBUG: ${tag}`);
        console.table(info);
        console.groupEnd();
    } catch (e) { console.warn('debugLogLayout failed', e); }
}

// Render the chat UI into the Live view chat module (#live-chat-module .module-content)
function renderLiveChatModule(container) {
    try {
        // allow injection into a custom container (floating window) or the legacy
        // live-chat-module location when present
        if (!container) container = document.querySelector('#live-chat-module .module-content');
        if (!container) return;
    // clear existing and build chat UI similar to sidebar module
    container.innerHTML = '';
    // start with a compact empty state; expand when the first message arrives
    const msgs = document.createElement('div'); msgs.className = 'chat-messages chat-empty'; container.appendChild(msgs);
    // fade overlay to visually fade older messages when overflow occurs
    const fadeTop = document.createElement('div'); fadeTop.className = 'chat-fade-top'; container.appendChild(fadeTop);

        container._chatIds = new Set();
        container._pendingMap = {};

        // load recent chat history
        try {
            const sessionCode = AppState.sessionCode;
                if (sessionCode) {
                fetch(`${SERVER_BASE}/api/sessions/${sessionCode}/chat`).then(r => { if (!r.ok) throw new Error('chat fetch failed'); return r.json(); }).then(data => {
                    const list = Array.isArray(data.chat) ? data.chat : [];
                    list.forEach(m => {
                        try {
                            if (m && m.id) container._chatIds.add(m.id);
                            // Do not mark historical messages as "own" based on Director/Viewer labels.
                            // The app no longer exposes a 'Director' identity in the chat; role is used instead.
                            appendToLive(msgs, m, { container });
                        } catch (e) {}
                    });
                }).catch(err => console.warn('Failed to load chat history', err));
            }
        } catch (e) {}

    // role selector + input should be pinned to bottom inside a chat-footer
    const roleRow = document.createElement('div'); roleRow.style.display = 'flex'; roleRow.style.gap = '8px'; roleRow.style.alignItems = 'center';
    const roleLabel = document.createElement('div'); roleLabel.textContent = 'Role:'; roleLabel.style.fontSize = '0.85rem'; roleLabel.style.color = 'var(--text-secondary)'; roleRow.appendChild(roleLabel);
    const roleSelect = document.createElement('select'); roleSelect.className = 'chat-role-select'; ['Pastor','Worship Leader','Production','Musician','MD'].forEach(r => { const o = document.createElement('option'); o.value = r; o.textContent = r; roleSelect.appendChild(o); }); roleRow.appendChild(roleSelect);
        try { const roleKey = `chat_role_${AppState.sessionCode || 'global'}`; const saved = localStorage.getItem(roleKey); roleSelect.value = saved || (AppState.isDirector ? 'MD' : 'Musician'); } catch (e) {}
    roleSelect.addEventListener('change', () => { try { localStorage.setItem(`chat_role_${AppState.sessionCode || 'global'}`, roleSelect.value); } catch (e) {} });

    const form = document.createElement('div'); form.className = 'chat-input'; form.style.display = 'flex'; form.style.gap = '6px';
    const input = document.createElement('input'); input.type = 'text'; input.placeholder = 'Send a message to session'; input.className = 'chat-input-field'; input.style.flex = '1 1 auto';
    const sendBtn = document.createElement('button'); sendBtn.className = 'btn btn-primary'; sendBtn.textContent = 'Send';
    form.appendChild(input); form.appendChild(sendBtn);

    const footer = document.createElement('div'); footer.className = 'chat-footer';
    footer.style.flex = '0 0 auto'; footer.style.marginTop = '8px'; footer.appendChild(roleRow); footer.appendChild(form);
    container.appendChild(footer);

        function appendToLive(msgsEl, m, opts = {}) {
            try {
                if (!m) return;
                const msg = m;
                // reconcile pending
                if (msg.clientTempId && container._pendingMap && container._pendingMap[msg.clientTempId]) {
                    const pendingEl = container._pendingMap[msg.clientTempId]; pendingEl.classList.remove('pending'); try { pendingEl.dataset.msgId = msg.id; } catch (e) {}
                        try {
                            // rebuild the chat-body so it follows the new inline format: ROLE : MESSAGE
                            const body = pendingEl.querySelector('.chat-body');
                            if (body) {
                                try { body.innerHTML = ''; } catch (e) { body.textContent = ''; }
                                const displayRole = msg.role || (msg.from === 'Director' ? 'MD' : (msg.from || 'User'));
                                const roleSpan = document.createElement('span'); roleSpan.className = 'chat-role-inline'; roleSpan.textContent = displayRole;
                                const sep = document.createElement('span'); sep.className = 'chat-role-sep'; sep.textContent = ' : ';
                                const textSpan = document.createElement('span'); textSpan.className = 'chat-text'; textSpan.textContent = msg.text || '';
                                try { body.appendChild(roleSpan); body.appendChild(sep); body.appendChild(textSpan); } catch (e) { body.textContent = `${displayRole} : ${msg.text || ''}`; }
                            }
                        } catch (e) {}
                    if (msg.id) container._chatIds.add(msg.id); delete container._pendingMap[msg.clientTempId]; return;
                }
                if (msg.id && container._chatIds.has(msg.id)) return;
                const el = document.createElement('div'); el.className = 'chat-msg'; const roleClass = msg.role ? `role-${msg.role.toLowerCase().replace(/\s+/g,'-')}` : ''; if (roleClass) el.classList.add(roleClass); if (opts.own) el.classList.add('own');
                // Build inline body: <span.role>ROLE</span><span.sep> : </span><span.text>message</span>
                const body = document.createElement('div'); body.className = 'chat-body';
                try {
                    const displayRole = msg.role || (msg.from === 'Director' ? 'MD' : (msg.from || 'User'));
                    const roleSpan = document.createElement('span'); roleSpan.className = 'chat-role-inline'; roleSpan.textContent = displayRole;
                    const sep = document.createElement('span'); sep.className = 'chat-role-sep'; sep.textContent = ' : ';
                    const textSpan = document.createElement('span'); textSpan.className = 'chat-text'; textSpan.textContent = msg.text || '';
                    body.appendChild(roleSpan); body.appendChild(sep); body.appendChild(textSpan);
                } catch (e) {
                    body.textContent = `${msg.role || msg.from || 'User'} : ${msg.text || ''}`;
                }
                el.appendChild(body);
                if (msg.id) { try { el.dataset.msgId = msg.id; } catch (e) {} container._chatIds.add(msg.id); }
                if (msg.clientTempId && !msg.id) { try { el.dataset.tempId = msg.clientTempId; } catch (e) {} el.classList.add('pending'); container._pendingMap[msg.clientTempId] = el; }
                msgsEl.appendChild(el);
                // when the first message is added, expand from empty state
                try {
                    if (msgsEl.classList.contains('chat-empty')) {
                        msgsEl.classList.remove('chat-empty');
                        msgsEl.classList.add('chat-expanded');
                    }
                } catch (e) {}
                // scroll to bottom so newest message is visible
                try { msgsEl.scrollTop = msgsEl.scrollHeight; } catch (e) {}
                // toggle fade overlay visibility when overflow exists
                try {
                    const fade = container.querySelector('.chat-fade-top');
                    if (fade) {
                        if (msgsEl.scrollHeight > msgsEl.clientHeight + 4) fade.classList.add('visible'); else fade.classList.remove('visible');
                    }
                } catch (e) {}
            } catch (e) {}
        }

        // expose
        container._appendChatMessage = (m) => appendToLive(msgs, m);

        sendBtn.addEventListener('click', () => {
            try {
                const text = (input.value || '').trim(); if (!text) return; const role = roleSelect.value || 'Musician'; const clientTempId = `tmp_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
                // Do not expose Director identity in messages. Use the selected role as the sender label.
                const payload = { type: 'chat:message', session: AppState.sessionCode, from: role, role, text, clientTempId };
                appendToLive(msgs, payload, { own: true });
                if (_ws && _ws.readyState === WebSocket.OPEN) _ws.send(JSON.stringify(payload)); else showToast('Not connected to server', 900);
                input.value = '';
            } catch (e) {}
        });
        input.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendBtn.click(); });
    } catch (e) {}
}

// Floating window helpers (chat and thumbnails). Creates a draggable floating
// panel with a header and content area. The returned element has id
// 'floating-<name>-window' and contains a '.floating-content' where module
// renderers can write.
function createFloatingWindow(name, title, extraClass) {
    const id = `floating-${name}-window`;
    let win = document.getElementById(id);
    if (win) return win;

    win = document.createElement('div');
    win.id = id;
    win.className = `floating-window ${extraClass || ''}`;
    win.style.position = 'fixed';
    win.style.right = '20px';
    // place the Quick Jump/Thumbs window slightly lower by default
    win.style.top = (name === 'thumbs' || name === 'quick-jump') ? '120px' : '80px';
    win.style.zIndex = 1200;

    const header = document.createElement('div');
    header.className = 'floating-header';
    header.innerHTML = `<div class="floating-title">${escapeHtml(title || name)}</div>`;
    // For chat and thumbnails (Quick Jump) we don't show the small close 'x'
    // because the modules are toggled via their header buttons. Other
    // floating windows still get a close button.
    let closeBtn = null;
    if (name !== 'chat' && name !== 'thumbs' && name !== 'quick-jump') {
        closeBtn = document.createElement('button');
        closeBtn.className = 'floating-close';
        closeBtn.title = 'Close';
        closeBtn.innerHTML = '&#10005;';
        header.appendChild(closeBtn);
    }
    win.appendChild(header);

    const content = document.createElement('div');
    content.className = 'floating-content';
    win.appendChild(content);

    // helper to map floating window name to its header toggle button id
    function _toggleButtonIdForWindow(n) {
        if (!n) return null;
        if (n === 'chat') return 'chat-toggle-btn';
        if (n === 'thumbs' || n === 'quick-jump') return 'quickjump-toggle-btn';
        return null;
    }

    // show/hide helpers (also sync the header toggle button's active state and aria-pressed)
    win.show = function() {
        win.classList.add('visible');
        win.style.display = '';
        try {
            const btnId = _toggleButtonIdForWindow(name);
            if (btnId) {
                const b = document.getElementById(btnId);
                if (b) { b.classList.add('active'); b.setAttribute('aria-pressed', 'true'); }
            }
        } catch (e) {}
    };
    win.hide = function() {
        win.classList.remove('visible');
        win.style.display = 'none';
        try {
            const btnId = _toggleButtonIdForWindow(name);
            if (btnId) {
                const b = document.getElementById(btnId);
                if (b) { b.classList.remove('active'); b.setAttribute('aria-pressed', 'false'); }
            }
        } catch (e) {}
    };
    win.toggle = function() { if (win.classList.contains('visible')) win.hide(); else win.show(); };

    // close button (if present)
    try {
        if (closeBtn) closeBtn.addEventListener('click', () => { win.hide(); });
    } catch (e) {}

    // simple drag: pointer based
    let dragging = false;
    let startX = 0, startY = 0, origLeft = 0, origTop = 0;
    header.style.cursor = 'move';
    header.addEventListener('pointerdown', (ev) => {
        dragging = true; header.setPointerCapture(ev.pointerId); header.classList.add('dragging');
        const rect = win.getBoundingClientRect();
        startX = ev.clientX; startY = ev.clientY; origLeft = rect.left; origTop = rect.top;
        ev.preventDefault();
    });
    document.addEventListener('pointermove', (ev) => {
        if (!dragging) return;
        const dx = ev.clientX - startX; const dy = ev.clientY - startY;
        win.style.left = Math.max(8, origLeft + dx) + 'px';
        win.style.top = Math.max(8, origTop + dy) + 'px';
        // unset right to allow absolute left positioning
        win.style.right = 'auto';
    });
    document.addEventListener('pointerup', (ev) => { if (dragging) { dragging = false; header.classList.remove('dragging'); } });

    document.body.appendChild(win);
    // start hidden
    win.hide();
    return win;
}

// Refresh Quick Jump UI (sidebar module and any open floating Quick Jump)
function refreshQuickJump() {
    try {
        // Re-render sidebar module if present
        if (window._sidebarManager) {
            try { window._sidebarManager.renderModules(); } catch (e) {}
            try {
                const rec = window._sidebarManager.moduleMap && window._sidebarManager.moduleMap['quick-jump'];
                if (rec && rec.el && rec.module && typeof rec.module.render === 'function') {
                    const content = rec.el.querySelector('.module-content');
                    if (content) rec.module.render(content);
                }
            } catch (e) {}
        }

        // Update floating quick-jump if open
        try {
            const floatWin = document.getElementById('floating-quick-jump-window');
            if (floatWin) {
                const content = floatWin.querySelector('.floating-content');
                if (content) {
                    content.innerHTML = '';
                    if (window._sidebarManager && window._sidebarManager.moduleMap && window._sidebarManager.moduleMap['quick-jump']) {
                        const mod = window._sidebarManager.moduleMap['quick-jump'].module;
                        if (mod && typeof mod.render === 'function') {
                            try { mod.render(content); } catch (e) {}
                        }
                    } else {
                        // fallback rendering: first page per chart in AppState order
                        try {
                            const serialized = window._pageManager ? window._pageManager.serialize() : { charts: [], pages: {} };
                            const pagesMap = serialized.pages || {};
                            const pmCharts = serialized.charts || [];
                            const orderedCharts = (window.AppState && Array.isArray(AppState.charts) && AppState.charts.length) ? AppState.charts : pmCharts;
                            if (!orderedCharts.length) content.innerHTML = '<div class="sidebar-empty">No pages yet</div>';
                            else orderedCharts.forEach((appCh, idx) => {
                                try {
                                    const pmch = pmCharts.find(x => x.id === (appCh && appCh.id)) || appCh || {};
                                    const firstPageId = (pmch.pageMap && pmch.pageMap.length) ? pmch.pageMap[0] : null;
                                    if (!firstPageId) return;
                                    const p = pagesMap[firstPageId] || (window._pageManager ? window._pageManager.getPage(firstPageId) : {}) || {};
                                    const pid = firstPageId;
                                    const item = document.createElement('div'); item.className = 'sidebar-thumb'; item.dataset.pageId = pid;
                                    const imgWrap = document.createElement('div'); imgWrap.className = 'sidebar-thumb-img';
                                    if (p.thumb) { const img = new Image(); img.src = p.thumb; img.alt = pid; imgWrap.appendChild(img); }
                                    else imgWrap.innerHTML = `<div class="thumb-placeholder">${escapeHtml(((appCh && appCh.name)||'').toString().slice(0,12))}</div>`;
                                    item.appendChild(imgWrap);
                                    const label = document.createElement('div'); label.className = 'sidebar-thumb-label'; label.textContent = (appCh && appCh.name) || pid; item.appendChild(label);
                                    try { const order = (typeof idx === 'number') ? (idx + 1) : ''; const orderBadge = document.createElement('div'); orderBadge.className = 'quickjump-order-badge'; orderBadge.textContent = String(order); item.appendChild(orderBadge); } catch (e) {}
                                    item.addEventListener('click', () => { if (window._sidebarManager) window._sidebarManager.onThumbClick(pid); });
                                    content.appendChild(item);
                                } catch (e) {}
                            });
                        } catch (e) {}
                    }
                }
            }
        } catch (e) {}
    } catch (e) {}
}

// note: Quick Jump now subscribes to 'charts:changed' internally inside SidebarManager

function toggleFloatingChat() {
    try {
        const btn = document.getElementById('chat-toggle-btn');
        const win = createFloatingWindow('chat', 'Chat', 'chat');
        win.toggle();
        if (win.classList.contains('visible')) {
            // render chat into floating content only when needed. Preserve
            // existing DOM so closing/opening the panel does not destroy
            // in-memory/pending messages. Re-render when session changes.
            try {
                const content = win.querySelector('.floating-content');
                const currentSession = AppState.sessionCode || null;
                if (!content._chatInitialized || content._chatSession !== currentSession) {
                    // (re)build chat UI for this session
                    renderLiveChatModule(content);
                    content._chatInitialized = true;
                    content._chatSession = currentSession;
                }
            } catch (e) {}
            // clear unread badge
            if (btn) btn.classList.remove('chat-unread');
        }
    } catch (e) {}
}

function toggleFloatingThumbs() {
    try {
        // button id updated to quickjump-toggle-btn
        const btn = document.getElementById('quickjump-toggle-btn');
    // module id renamed to 'quick-jump' and floating
    // window 'quick-jump' labeled 'Quick Jump'
        const win = createFloatingWindow('quick-jump', 'Quick Jump', 'quick-jump');
        win.toggle();
        if (win.classList.contains('visible')) {
            // render thumbnails module into floating content using SidebarManager's thumbnails renderer when available
            const content = win.querySelector('.floating-content');
            if (content) {
                try {
                    content.innerHTML = '';
                    if (window._sidebarManager && window._sidebarManager.moduleMap && window._sidebarManager.moduleMap['quick-jump']) {
                        const mod = window._sidebarManager.moduleMap['quick-jump'].module;
                        if (mod && typeof mod.render === 'function') mod.render(content);
                    } else {
                        // fallback: mirror sidebar thumbnails
                        // Show only the first page of each chart for Quick Jump to keep navigation compact
                        const serialized = window._pageManager ? window._pageManager.serialize() : { charts: [], pages: {} };
                        const pagesMap = serialized.pages || {};
                        const pmCharts = serialized.charts || [];
                        // Use AppState.charts order (organize mode order) when available; fall back to PageManager order
                        const orderedCharts = (window.AppState && Array.isArray(AppState.charts) && AppState.charts.length) ? AppState.charts : pmCharts;
                        if (!orderedCharts.length) content.innerHTML = '<div class="sidebar-empty">No pages yet</div>';
                        else orderedCharts.forEach((appCh, idx) => {
                            try {
                                // find matching chart metadata from PageManager serialize (contains pageMap)
                                const pmch = pmCharts.find(x => x.id === (appCh && appCh.id)) || appCh || {};
                                const firstPageId = (pmch.pageMap && pmch.pageMap.length) ? pmch.pageMap[0] : null;
                                if (!firstPageId) return;
                                const p = pagesMap[firstPageId] || (window._pageManager ? window._pageManager.getPage(firstPageId) : {}) || {};
                                const pid = firstPageId;
                                const item = document.createElement('div'); item.className = 'sidebar-thumb'; item.dataset.pageId = pid;
                                const imgWrap = document.createElement('div'); imgWrap.className = 'sidebar-thumb-img';
                                if (p.thumb) { const img = new Image(); img.src = p.thumb; img.alt = pid; imgWrap.appendChild(img); }
                                else imgWrap.innerHTML = `<div class="thumb-placeholder">${escapeHtml(((appCh && appCh.name)||'').toString().slice(0,12))}</div>`;
                                item.appendChild(imgWrap);
                                const label = document.createElement('div'); label.className = 'sidebar-thumb-label'; label.textContent = (appCh && appCh.name) || pid; item.appendChild(label);
                                // chart order badge (1-based index) - Quick Jump specific
                                try {
                                    const order = (typeof idx === 'number') ? (idx + 1) : '';
                                    const orderBadge = document.createElement('div');
                                    orderBadge.className = 'quickjump-order-badge';
                                    orderBadge.textContent = String(order);
                                    item.appendChild(orderBadge);
                                } catch (e) {}
                                item.addEventListener('click', () => { if (window._sidebarManager) window._sidebarManager.onThumbClick(pid); });
                                content.appendChild(item);
                            } catch (e) {}
                        });
                    }
                } catch (e) {}
            }
            if (btn) btn.classList.remove('chat-unread');
        }
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
    this.container = document.getElementById('sidebar-quick-jump');
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
                div.id = 'sidebar-quick-jump';
                div.className = 'sidebar-quick-jump';
                aside.appendChild(div);
                this.container = div;
            }
        }

        // Register a default Quick Jump module (previously called 'thumbnails')
        const quickJumpModule = {
            id: 'quick-jump',
            title: 'Quick Jump',
            render: (contentEl) => {
                try {
                    console.debug && console.debug('QuickJump.render called');
                    contentEl.innerHTML = '';
                    if (!window._pageManager) {
                        contentEl.innerHTML = '<div class="sidebar-empty">No pages yet</div>';
                        return;
                    }
                    // Only show the first page of each uploaded chart to keep Quick Jump concise.
                    const serialized = window._pageManager.serialize() || {};
                    const pmCharts = serialized.charts || [];
                    const pagesMap = serialized.pages || {};
                    // Use AppState.charts order (organize mode order) when available; fall back to PageManager order
                    const orderedCharts = (window.AppState && Array.isArray(AppState.charts) && AppState.charts.length) ? AppState.charts : pmCharts;
                    if (!orderedCharts.length) { contentEl.innerHTML = '<div class="sidebar-empty">No pages yet</div>'; return; }
                    orderedCharts.forEach((appCh, idx) => {
                        try {
                            const pmch = pmCharts.find(x => x.id === (appCh && appCh.id)) || appCh || {};
                            const firstPageId = (pmch.pageMap && pmch.pageMap.length) ? pmch.pageMap[0] : null;
                            if (!firstPageId) return;
                            const p = pagesMap[firstPageId] || window._pageManager.getPage(firstPageId) || {};
                            const pid = firstPageId;
                            // debug hint
                            try { console.debug && console.debug('QuickJump: rendering chart', (appCh && appCh.id), 'as index', idx); } catch (e) {}
                            const item = document.createElement('div');
                            item.className = 'sidebar-thumb';
                            item.dataset.pageId = pid;
                            item.style.position = item.style.position || 'relative';
                            const imgWrap = document.createElement('div'); imgWrap.className = 'sidebar-thumb-img';
                            if (p.thumb) { const img = new Image(); img.src = p.thumb; img.alt = `page ${pid}`; imgWrap.appendChild(img); }
                            else { imgWrap.innerHTML = `<div class="thumb-placeholder">${escapeHtml(((appCh && appCh.name)||'').toString().slice(0,12))}</div>`; }
                            item.appendChild(imgWrap);
                                const badge = document.createElement('div'); badge.className = 'thumb-changed-badge'; badge.textContent = 'Updated'; item.appendChild(badge);
                                // chart order badge (1-based index) - Quick Jump specific
                            try {
                                const order = (typeof idx === 'number') ? (idx + 1) : '';
                                const orderBadge = document.createElement('div');
                                orderBadge.className = 'quickjump-order-badge';
                                orderBadge.textContent = String(order);
                                item.appendChild(orderBadge);
                            } catch (e) { /* non-fatal */ }
                            const label = document.createElement('div'); label.className = 'sidebar-thumb-label'; label.textContent = (appCh && appCh.name) || pid; item.appendChild(label);
                            item.addEventListener('click', () => { this.onThumbClick(pid); });
                            contentEl.appendChild(item);
                        } catch (e) { /* non-fatal per-chart */ }
                    });
                } catch (e) { /* non-fatal */ }
            }
        };

        // register default module and render
        this.registerModule(quickJumpModule, { atEnd: true });
        this.restoreLayout();
        this.renderModules();

        // Subscribe to charts changes so Quick Jump updates itself when charts are added/removed/reordered.
        try {
            if (window && window.addEventListener) {
                window.addEventListener('charts:changed', () => {
                    try { console.debug && console.debug('QuickJump received charts:changed event'); } catch (e) {}
                    try {
                        const rec = this.moduleMap && this.moduleMap['quick-jump'];
                        if (rec && rec.module && typeof rec.module.render === 'function') {
                            const content = rec.el && rec.el.querySelector('.module-content');
                            if (content) {
                                try { rec.module.render(content); } catch (err) { console.error('QuickJump render failed on charts:changed', err); }
                            }
                        }
                        // also refresh any open floating Quick Jump
                        try {
                            const floatWin = document.getElementById('floating-quick-jump-window');
                            if (floatWin) {
                                const fContent = floatWin.querySelector('.floating-content');
                                if (fContent) {
                                    // prefer module render
                                    if (rec && rec.module && typeof rec.module.render === 'function') {
                                        try { rec.module.render(fContent); } catch (err) { console.error('QuickJump floating render failed', err); }
                                    } else {
                                        // minimal fallback rendering
                                        try {
                                            const serialized = window._pageManager ? window._pageManager.serialize() : { charts: [], pages: {} };
                                            const pagesMap = serialized.pages || {};
                                            const pmCharts = serialized.charts || [];
                                            const orderedCharts = (window.AppState && Array.isArray(AppState.charts) && AppState.charts.length) ? AppState.charts : pmCharts;
                                            fContent.innerHTML = '';
                                            if (!orderedCharts.length) fContent.innerHTML = '<div class="sidebar-empty">No pages yet</div>';
                                            else orderedCharts.forEach((appCh, idx) => {
                                                try {
                                                    const pmch = pmCharts.find(x => x.id === (appCh && appCh.id)) || appCh || {};
                                                    const firstPageId = (pmch.pageMap && pmch.pageMap.length) ? pmch.pageMap[0] : null;
                                                    if (!firstPageId) return;
                                                    const p = pagesMap[firstPageId] || (window._pageManager ? window._pageManager.getPage(firstPageId) : {}) || {};
                                                    const pid = firstPageId;
                                                    const item = document.createElement('div'); item.className = 'sidebar-thumb'; item.dataset.pageId = pid;
                                                    const imgWrap = document.createElement('div'); imgWrap.className = 'sidebar-thumb-img';
                                                    if (p.thumb) { const img = new Image(); img.src = p.thumb; img.alt = pid; imgWrap.appendChild(img); }
                                                    else imgWrap.innerHTML = `<div class="thumb-placeholder">${escapeHtml(((appCh && appCh.name)||'').toString().slice(0,12))}</div>`;
                                                    item.appendChild(imgWrap);
                                                    const label = document.createElement('div'); label.className = 'sidebar-thumb-label'; label.textContent = (appCh && appCh.name) || pid; item.appendChild(label);
                                                    try { const order = (typeof idx === 'number') ? (idx + 1) : ''; const orderBadge = document.createElement('div'); orderBadge.className = 'quickjump-order-badge'; orderBadge.textContent = String(order); item.appendChild(orderBadge); } catch (e) {}
                                                    item.addEventListener('click', () => { if (window._sidebarManager) window._sidebarManager.onThumbClick(pid); });
                                                    fContent.appendChild(item);
                                                } catch (e) {}
                                            });
                                        } catch (e) {}
                                    }
                                }
                            }
                        } catch (e) {}
                    } catch (e) {}
                });
            }
        } catch (e) {}
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
                    try {
                        AppState.currentChartIndex = c; AppState.currentPageNumber = idx + 1;
                        // switch to live and render; then scroll to the specific page if present
                        switchToMode('live');
                        renderLiveMode();
                        setTimeout(() => {
                            try {
                                const pagesContainer = document.getElementById('live-pages');
                                if (!pagesContainer) return;
                                const selector = `.live-page-wrapper[data-chart-id="${AppState.charts[c] ? AppState.charts[c].id : ''}"][data-page="${idx+1}"]`;
                                const target = pagesContainer.querySelector(selector);
                                if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                            } catch (err) {}
                        }, 250);
                    } catch (e) {}
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
                // Map legacy module ids to new ids (non-destructive migration).
                // Previously the thumbnails module used id 'thumbnails'. If a
                // stored layout references 'thumbnails', map it to 'quick-jump'
                // so existing user layouts continue to work.
                const storedOrder = p.order.map(id => (id === 'thumbnails' ? 'quick-jump' : id));
                // ensure modules referenced exist; otherwise append missing
                const order = storedOrder.filter(id => !!this.moduleMap[id]);
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
                        // Map legacy collapsed keys as well so previously-collapsed
                        // modules remain collapsed after the rename.
                        const collapsedMap = {};
                        Object.keys(p2.collapsed).forEach(k => {
                            const mapped = (k === 'thumbnails') ? 'quick-jump' : k;
                            collapsedMap[mapped] = p2.collapsed[k];
                        });
                        Object.keys(collapsedMap).forEach(id => {
                            const rec = this.moduleMap[id];
                            if (rec && rec.el && collapsedMap[id]) rec.el.classList.add('collapsed');
                        });
                    }
                } catch (e) {}
            }, 40);
        } catch (e) {}
    }
}

function startLiveSocket() {
    const wsUrl = getWebSocketUrl();
    try {
        // If we already have an open websocket, reuse it and ensure subscription
        if (_ws && _ws.readyState === WebSocket.OPEN) {
            sendSubscribeIfNeeded();
            return;
        }
        _ws = new WebSocket(wsUrl);
    } catch (e) { _ws = null; return; }

    _ws.addEventListener('open', () => {
        // ensure we're subscribed on open
        try { sendSubscribeIfNeeded(); } catch (e) {}
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
                                // also update any live overlay canvases showing this page
                                try {
                                    const overlays = Array.from(document.querySelectorAll(`.live-annotation-canvas[data-page-id="${pageId}"]`));
                                    overlays.forEach(o => {
                                        try { window._pageManager.renderAnnotationToCanvas(pageId, o); } catch (e) {}
                                    });
                                } catch (e) {}
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
                // If the floating chat window is not visible, indicate unread on header button
                try {
                    const floatWin = document.getElementById('floating-chat-window');
                    const btn = document.getElementById('chat-toggle-btn');
                    const visible = floatWin && floatWin.classList.contains('visible');
                    if (!visible && btn) btn.classList.add('chat-unread');
                } catch (e) {}
            }
        } catch (e) {}
    });

    _ws.addEventListener('close', () => { _ws = null; });
    _ws.addEventListener('error', () => { /* ignore */ });
}

// Send a subscribe message only when necessary. This avoids repeated
// re-subscriptions when switching view modes. The function records the
// last subscribed session/token on the websocket so subsequent calls are
// no-ops unless the session or token changed or the socket was recreated.
function sendSubscribeIfNeeded() {
    try {
        if (!_ws || _ws.readyState !== WebSocket.OPEN) return;
        const code = AppState.sessionCode;
        if (!code) return;
        const token = AppState.directorToken || localStorage.getItem(`session_${code}_directorToken`) || null;
        // If we already subscribed with the same session/token, skip
        if (_ws._subscribedSession === code && _ws._subscribedToken === token) return;
        const sub = { type: 'subscribe', session: code };
        if (token) sub.token = token;
        try { _ws.send(JSON.stringify(sub)); } catch (e) {}
        _ws._subscribedSession = code;
        _ws._subscribedToken = token;
    } catch (e) {}
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

    // update state (do not persist to localStorage here)
    AppState.charts = serverChartsArr;

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

    // Ensure Quick Jump reflects server-side changes
    try { refreshQuickJump(); } catch (e) {}

    // show a small live-update badge near thumbnails
    try {
    const thumbsContainer = document.querySelector('#live-quick-jump-module .module-content') || document.querySelector('.live-quick-jump');
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
    const thumbsContainer = document.querySelector('#live-quick-jump-module .module-content') || document.querySelector('.live-quick-jump');
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
                // prefer chart.pageMap when available
                let pagesSpec = [];
                if (Array.isArray(chart.pageMap) && chart.pageMap.length > 0 && window._pageManager) {
                    pagesSpec = chart.pageMap.map((pid, idx) => {
                        const pObj = window._pageManager.getPage(pid) || {};
                        return { pageIndex: pObj.pageIndex || (idx + 1), pageId: pid, logicalPage: idx + 1 };
                    });
                } else {
                    for (let p = 1; p <= pdf.numPages; p++) pagesSpec.push({ pageIndex: p, pageId: null, logicalPage: p });
                }

                pagesSpec.forEach(spec => {
                    const wrapper = document.createElement('div');
                    wrapper.className = 'live-page-wrapper';
                    wrapper.dataset.chartId = chart.id;
                    wrapper.dataset.chartIndex = chartIdx;
                    wrapper.dataset.page = spec.logicalPage;
                    if (spec.pageIndex) wrapper.dataset.pageIndex = spec.pageIndex;
                    if (spec.pageId) wrapper.dataset.pageId = spec.pageId;
                    wrapper.dataset.rendered = '0';
                    wrapper.style.minHeight = '200px';
                    chartBlock.appendChild(wrapper);
                });

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
                                // annotations will be rendered into the overlay canvas (created below) when PageManager is available
                                // legacy bitmap annotations
                                const key = `${AppState.sessionCode}_${chartIdx}_${p}`;
                                const ann = AppState.annotations[key];
                                if (ann) {
                                    const img = new Image(); img.onload = () => { try { ctx.drawImage(img,0,0,canvas.width,canvas.height); } catch(e){} }; img.src = ann;
                                }
                                w.appendChild(canvas);
                                try {
                                    const overlay = document.createElement('canvas');
                                    overlay.className = 'live-annotation-canvas';
                                    overlay.width = canvas.width; overlay.height = canvas.height;
                                    overlay.style.position = 'absolute'; overlay.style.top = '0'; overlay.style.left = '0';
                                    overlay.style.width = '100%'; overlay.style.height = '100%';
                                    overlay.dataset.pageId = w.dataset.pageId || (chart && Array.isArray(chart.pageMap) && chart.pageMap.length >= p ? chart.pageMap[p-1] : '');
                                    try { w.style.position = w.style.position || 'relative'; } catch (e) {}
                                    overlay.style.pointerEvents = (AppState.annotationMode && AppState.isDirector) ? 'auto' : 'none';
                                    overlay.addEventListener('mousedown', startDrawing);
                                    overlay.addEventListener('mousemove', draw);
                                    overlay.addEventListener('mouseup', stopDrawing);
                                    overlay.addEventListener('mouseout', stopDrawing);
                                    overlay.addEventListener('touchstart', function(e){ e.preventDefault(); const t = e.touches[0]; overlay.dispatchEvent(new MouseEvent('mousedown', { clientX: t.clientX, clientY: t.clientY })); });
                                    overlay.addEventListener('touchmove', function(e){ e.preventDefault(); const t = e.touches[0]; overlay.dispatchEvent(new MouseEvent('mousemove', { clientX: t.clientX, clientY: t.clientY })); });
                                    overlay.addEventListener('touchend', function(e){ e.preventDefault(); overlay.dispatchEvent(new MouseEvent('mouseup', {})); });
                                    w.appendChild(overlay);
                                    // render any existing vector annotations into the overlay
                                    try {
                                        const pid = overlay.dataset.pageId;
                                        if (pid && window._pageManager) window._pageManager.renderAnnotationToCanvas(pid, overlay);
                                    } catch (e) {}
                                } catch (e) {}
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
            // Do not persist session snapshots to localStorage automatically.
            // refresh views depending on mode
            if (AppState.viewMode === 'live') {
                renderLiveMode();
            }
            if (AppState.viewMode === 'organize') {
                renderOrganizeMode();
            }
            try { refreshQuickJump(); } catch (e) {}
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

// Generate thumbnail for a specific page number (1-based) in a chart PDF
function generatePageThumbnail(chart, pageNumber = 1, maxWidth = 300) {
    if (!window['pdfjsLib'] || !chart || !chart.data) return Promise.resolve(null);
    try {
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
        return pdfjsLib.getDocument(chart.data).promise.then(pdf => {
            return pdf.getPage(pageNumber).then(page => {
                const viewport = page.getViewport({ scale: 1 });
                const scale = Math.min(maxWidth / viewport.width, 1);
                const scaled = page.getViewport({ scale });
                const canvas = document.createElement('canvas');
                canvas.width = scaled.width;
                canvas.height = scaled.height;
                const ctx = canvas.getContext('2d');
                const renderContext = { canvasContext: ctx, viewport: scaled };
                return page.render(renderContext).promise.then(() => {
                    try { return canvas.toDataURL('image/png'); } catch (e) { return null; }
                }).catch(() => null);
            }).catch(() => null);
        }).catch(() => null);
    } catch (e) { return Promise.resolve(null); }
}

// Initialize SortableJS on the charts grid for touch-friendly drag/reorder
let _sortableInstance = null;
// When true, avoid running the expensive/DOM-mutation right-dock column
// recalculation. This is a test hook to diagnose layout shifts caused by adjustRightDockColumns().
let _suppressRightDockAdjust = false;
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

        // Double click opens in Live mode and focuses this chart
        card.addEventListener('dblclick', () => {
            AppState.currentChartIndex = index;
            AppState.currentPageNumber = 1;
            try { switchToMode('live'); renderLiveMode(); } catch (e) {}
            // scroll to chart block once live is rendered
            setTimeout(() => {
                try {
                    const pagesContainer = document.getElementById('live-pages');
                    if (!pagesContainer) return;
                    const target = pagesContainer.querySelector(`.live-chart-block[data-chart-index="${index}"]`);
                    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                } catch (err) {}
            }, 250);
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
            <div class="chart-actions">
                <button class="btn btn-secondary edit-pages-btn" data-chart-index="${index}" title="Edit pages" aria-label="Edit pages">Edit Pages</button>
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

    // Hook up Edit Pages buttons
    grid.querySelectorAll('.edit-pages-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const ci = parseInt(btn.dataset.chartIndex, 10);
            openChartPagesEditor(ci);
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
    // Update Quick Jump to reflect the new organize order
    try { refreshQuickJump(); } catch (e) {}
    try { window.dispatchEvent(new CustomEvent('charts:changed')); } catch (e) {}
}

function saveSessionCharts() {
    // Persist charts: try server if director token exists. Do NOT persist to localStorage
    // by default — sessions should only be saved when there's a server-side
    // session and an associated director token (i.e., active participants).
    return (async () => {
        if (!AppState.sessionCode) return false;
        let directorToken = AppState.directorToken || localStorage.getItem(`session_${AppState.sessionCode}_directorToken`);
        if (directorToken) {
            try {
                let pagesPayload = undefined;
                try { if (window._pageManager) { pagesPayload = window._pageManager.serialize().pages; } } catch (e) { pagesPayload = undefined; }
                const body = pagesPayload ? { charts: AppState.charts, pages: pagesPayload } : { charts: AppState.charts };
                let res = await fetch(`${SERVER_BASE}/api/sessions/${AppState.sessionCode}/charts`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'x-director-token': directorToken },
                    body: JSON.stringify(body)
                });

                // If server responds with 404 (session not found), try to recover by
                // creating a fresh server session and retrying once.
                if (res && res.status === 404) {
                    try { console.warn('saveSessionCharts: server returned 404; attempting to recover by creating a new session'); } catch (e) {}
                    // attempt to create a new server-backed session
                    try {
                        await createSession();
                        // update director token and session code from newly created session
                        directorToken = AppState.directorToken || localStorage.getItem(`session_${AppState.sessionCode}_directorToken`);
                        if (AppState.sessionCode && directorToken) {
                            // retry save once
                            res = await fetch(`${SERVER_BASE}/api/sessions/${AppState.sessionCode}/charts`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json', 'x-director-token': directorToken },
                                body: JSON.stringify(body)
                            });
                            return res && res.ok;
                        }
                    } catch (e) { /* fall through to return false */ }
                    return false;
                }

                return res.ok;
            } catch (e) {
                console.warn('Failed to save charts to server:', e);
                return false;
            }
        }
        // No director token available — do not write session to localStorage automatically.
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
    // Normalize legacy 'edit' mode to live since Edit mode is removed.
    if (mode === 'edit') mode = 'live';
    const prevMode = AppState.viewMode; // remember previous mode so we can make sensible defaults
    AppState.viewMode = mode;
    
    const editView = document.getElementById('edit-view');
    const liveView = document.getElementById('live-view');
    const organizeView = document.getElementById('organize-view');
    const liveBtn = document.getElementById('live-mode-btn');
    const organizeBtn = document.getElementById('organize-mode-btn');

    // Clear active states
    [editView, liveView, organizeView].forEach(v => { if (v) v.classList.remove('active'); });
    [liveBtn, organizeBtn].forEach(b => { if (b) b.classList.remove('active'); });

    if (mode === 'live') {
        if (liveView) liveView.classList.add('active');
        if (liveBtn) liveBtn.classList.add('active');
        stopOrganizeTicker();
    // If we're switching from Organize to Live (e.g. double-click open),
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
        // Keep websocket open when organizing so the director remains a connected
        // websocket client. Switching view modes is an in-page activity and should
        // not be treated as a director disconnect by the server. Previously we
        // closed the socket here which caused the server to schedule a director
        // disconnect cleanup. Instead, leave the socket open and send an optional
        // mode-change message to record activity on the server.
        try {
            if (_ws && _ws.readyState === WebSocket.OPEN) {
                const m = { type: 'mode:change', session: AppState.sessionCode, mode: 'organize' };
                try { _ws.send(JSON.stringify(m)); } catch (e) {}
            }
        } catch (e) {}
        showOrganizeHeaderHelp();
        renderOrganizeMode();
    }
}

// Live view uses the default vertical layout.

// Role-based UI: show/hide director-only controls and enforce default mode for attendees
function updateRoleUI() {
    // Director-only control IDs (hidden for non-directors)
    const directorOnlyIds = ['organize-mode-btn', 'add-charts-btn', 'annotation-btn'];
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
        // Director gets Edit/Organize available. Do not force-switch modes here.
        // Let flows (upload/start) decide whether to show Organize or Edit.
    }
    try { updateLiveOverlayInteractivity(); } catch (e) {}
}

// Pages editor: open a modal to display per-page thumbnails and allow removal
function openChartPagesEditor(chartIndex) {
    try {
        const chart = AppState.charts[chartIndex];
        if (!chart) return;
        // Ensure PageManager pageMap exists for this chart
        (async () => {
            if (window._pageManager && (!Array.isArray(chart.pageMap) || chart.pageMap.length === 0)) {
                try { await window._pageManager.createPagesFromPdf(chart); } catch (e) { /* ignore */ }
            }
            renderPagesEditor(chartIndex);
            const modal = document.getElementById('pages-editor-modal');
            if (!modal) return;
            modal.setAttribute('aria-hidden', 'false'); modal.classList.add('visible');
            // Attach backdrop and close handlers
            const backdrop = document.getElementById('pages-editor-backdrop');
            const closeBtn = document.getElementById('pages-editor-close');
            const doneBtn = document.getElementById('pages-editor-done');
            function closeHandler() { closePagesEditor(); }
            if (backdrop) backdrop.addEventListener('click', closeHandler);
            if (closeBtn) closeBtn.addEventListener('click', closeHandler);
            if (doneBtn) doneBtn.addEventListener('click', closeHandler);
        })();
    } catch (e) { console.warn('openChartPagesEditor failed', e); }
}

function closePagesEditor() {
    try {
        const modal = document.getElementById('pages-editor-modal');
        if (!modal) return;
        modal.setAttribute('aria-hidden', 'true'); modal.classList.remove('visible');
        // cleanup grid contents but keep modal structure intact so it can be re-used
        const grid = document.getElementById('pages-editor-grid'); if (grid) grid.innerHTML = '';
        // also remove any transient event listeners on backdrop/close/done to avoid duplicates
        try {
            const backdrop = document.getElementById('pages-editor-backdrop');
            const closeBtn = document.getElementById('pages-editor-close');
            const doneBtn = document.getElementById('pages-editor-done');
            if (backdrop) {
                const newBackdrop = backdrop.cloneNode(true);
                backdrop.parentNode.replaceChild(newBackdrop, backdrop);
            }
            if (closeBtn) {
                const nc = closeBtn.cloneNode(true);
                closeBtn.parentNode.replaceChild(nc, closeBtn);
            }
            if (doneBtn) {
                const nd = doneBtn.cloneNode(true);
                doneBtn.parentNode.replaceChild(nd, doneBtn);
            }
        } catch (e) {}
    } catch (e) {}
}

function renderPagesEditor(chartIndex) {
    try {
        const chart = AppState.charts[chartIndex];
        if (!chart) return;
        const grid = document.getElementById('pages-editor-grid');
        if (!grid) return;
        grid.innerHTML = '';
        const pageMap = Array.isArray(chart.pageMap) ? chart.pageMap.slice() : [];
        // If no pageMap, try to create pages (synchronous guard)
        if (pageMap.length === 0 && window._pageManager && chart.data) {
            try { pageMap.push(...(window._pageManager.getChartPageMap ? window._pageManager.getChartPageMap(chart.id) : [])); } catch (e) {}
        }
        if (pageMap.length === 0) {
            grid.innerHTML = '<div class="sidebar-empty">No pages available for this chart yet.</div>';
            return;
        }
        pageMap.forEach((pageId, idx) => {
            const pageObj = window._pageManager ? window._pageManager.getPage(pageId) : null;
            const card = document.createElement('div'); card.className = 'page-card';
            const img = document.createElement('img'); img.className = 'page-thumb'; img.alt = `Page ${idx+1}`;
            // Use per-page thumb when available. If missing, generate a page-specific thumbnail
            if (pageObj && pageObj.thumb) {
                img.src = pageObj.thumb;
            } else if (chart && chart.data) {
                // placeholder while generating
                img.src = '';
                img.dataset.loading = '1';
                const originalPageIndex = (pageObj && pageObj.pageIndex) ? pageObj.pageIndex : (idx + 1);
                generatePageThumbnail(chart, originalPageIndex, 220).then(dataUrl => {
                    try {
                        if (dataUrl) {
                            img.src = dataUrl;
                            delete img.dataset.loading;
                            // cache back into PageManager if available
                            if (pageObj && window._pageManager && window._pageManager.store && window._pageManager.store.pages) {
                                try { window._pageManager.store.pages[pageId].thumb = dataUrl; } catch (e) {}
                            }
                        } else {
                            // fallback to chart-level thumb if available
                            img.src = chart.thumb || '';
                            delete img.dataset.loading;
                        }
                    } catch (e) { img.src = chart.thumb || ''; delete img.dataset.loading; }
                }).catch(() => { img.src = chart.thumb || ''; delete img.dataset.loading; });
            } else {
                img.src = chart.thumb || '';
            }
            const label = document.createElement('div'); label.className = 'page-label'; label.textContent = `Page ${idx + 1}`;
            const actions = document.createElement('div'); actions.className = 'page-actions';
            const removeBtn = document.createElement('button'); removeBtn.className = 'page-remove-btn'; removeBtn.textContent = 'Remove';
            removeBtn.title = 'Remove this page from chart';
            removeBtn.addEventListener('click', () => {
                if (!confirm(`Remove page ${idx + 1} from chart "${chart.name}"? This cannot be undone.`)) return;
                removePageFromChart(chartIndex, idx);
                // re-render editor after removal
                renderPagesEditor(chartIndex);
            });
            actions.appendChild(removeBtn);
            card.appendChild(img); card.appendChild(label); card.appendChild(actions);
            grid.appendChild(card);
        });
    } catch (e) { console.warn('renderPagesEditor failed', e); }
}

function removePageFromChart(chartIndex, pageIndex) {
    try {
        const chart = AppState.charts[chartIndex];
        if (!chart || !Array.isArray(chart.pageMap)) return false;
        if (pageIndex < 0 || pageIndex >= chart.pageMap.length) return false;
        const pageId = chart.pageMap[pageIndex];
        // Remove from chart.pageMap
        chart.pageMap.splice(pageIndex, 1);
        // Remove page record from PageManager store
        try {
            if (window._pageManager && window._pageManager.store && window._pageManager.store.pages) {
                delete window._pageManager.store.pages[pageId];
                // reindex remaining pages' pageIndex
                const remaining = chart.pageMap || [];
                remaining.forEach((pid, i) => {
                    if (window._pageManager.store.pages[pid]) window._pageManager.store.pages[pid].pageIndex = i + 1;
                });
                try { window._pageManager.persistToLocalStorage(AppState.sessionCode); } catch (e) {}
            }
        } catch (e) {}
        // save chart state and persist to server/local
        try { saveSessionCharts(); } catch (e) {}
        // clamp current page number if we're editing this chart
        try {
            if (AppState.currentChartIndex === chartIndex) {
                const max = Array.isArray(chart.pageMap) ? chart.pageMap.length : 0;
                if (max === 0) AppState.currentPageNumber = 1; else if (AppState.currentPageNumber > max) AppState.currentPageNumber = max;
            }
        } catch (e) {}
        // re-render organize and live views if active
        try { if (AppState.viewMode === 'organize') renderOrganizeMode(); if (AppState.viewMode === 'live') renderLiveMode(); } catch (e) {}
        return true;
    } catch (e) { console.warn('removePageFromChart failed', e); return false; }
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
            // Only show toolbar to Music Director when PageManager is available
            if (AppState.annotationMode && AppState.isDirector && FEATURE_PAGE_MANAGER && window._pageManager) {
                toolbar.hidden = false;
            } else {
                toolbar.hidden = true;
            }
        }
    } catch (e) {}
    try { updateLiveOverlayInteractivity(); } catch (e) {}
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
    // Only allow drawing when annotation mode is active
    if (!AppState.annotationMode) return;
    // If in Live view, only directors may draw
    if (AppState.viewMode === 'live' && !AppState.isDirector) return;

    // Determine which canvas the event targets. Prefer per-page overlay canvases.
    let canvasEl = null;
    if (e.target && e.target.classList && e.target.classList.contains('live-annotation-canvas')) {
        canvasEl = e.target;
    } else {
        // fallback to the global annotation canvas used in Edit mode
        canvasEl = document.getElementById('annotation-canvas') || AppState.annotationCanvas;
    }
    if (!canvasEl) return;

    try { AppState.annotationCanvas = canvasEl; AppState.annotationContext = canvasEl.getContext('2d'); } catch (err) {}

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
        // prefer overlay canvas pageId if available
        let pageId = null;
        try { if (AppState.annotationCanvas && AppState.annotationCanvas.dataset && AppState.annotationCanvas.dataset.pageId) pageId = AppState.annotationCanvas.dataset.pageId; } catch (e) {}
        if (!pageId) pageId = getCurrentPageId();
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
        // prefer overlay canvas pageId if available
        let pageId = null;
        try { if (AppState.annotationCanvas && AppState.annotationCanvas.dataset && AppState.annotationCanvas.dataset.pageId) pageId = AppState.annotationCanvas.dataset.pageId; } catch (e) {}
        if (!pageId) pageId = getCurrentPageId();
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
            // determine pageId: prefer the active overlay's pageId if present
            let pageId = null;
            try {
                if (AppState.annotationCanvas && AppState.annotationCanvas.dataset && AppState.annotationCanvas.dataset.pageId) {
                    pageId = AppState.annotationCanvas.dataset.pageId;
                }
            } catch (e) {}
            // fallback to chart/pageMap mapping
            const chart = (AppState.charts || [])[AppState.currentChartIndex];
            if (!pageId && chart && Array.isArray(chart.pageMap) && chart.pageMap.length >= AppState.currentPageNumber) {
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
            // Show an icon that REPRESENTS the ACTION the toggle will perform.
            // When currently in light mode, show the moon (click => switch to dark).
            // When currently in dark mode, show the sun (click => switch to light).
            if (theme === 'dark') {
                // Show sun icon to indicate clicking will switch to light mode
                btn.innerHTML = `\n                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">\n                        <circle cx="12" cy="12" r="4"></circle>\n                        <path d="M12 2v2"></path>\n                        <path d="M12 20v2"></path>\n                        <path d="M4.93 4.93l1.41 1.41"></path>\n                        <path d="M17.66 17.66l1.41 1.41"></path>\n                        <path d="M2 12h2"></path>\n                        <path d="M20 12h2"></path>\n                        <path d="M4.93 19.07l1.41-1.41"></path>\n                        <path d="M17.66 6.34l1.41-1.41"></path>\n                    </svg>`;
            } else {
                // Show moon icon to indicate clicking will switch to dark mode
                btn.innerHTML = `\n                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">\n                        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>\n                    </svg>`;
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
                                // start compact when empty and expand when messages arrive
                                const msgs = document.createElement('div');
                                msgs.className = 'chat-messages chat-empty';
                                contentEl.appendChild(msgs);
                                const fadeTop = document.createElement('div'); fadeTop.className = 'chat-fade-top'; contentEl.appendChild(fadeTop);

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
                                ['Pastor','Worship Leader','Production','Musician','MD'].forEach(r => {
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
                                        try {
                                            if (msgs.classList.contains('chat-empty')) { msgs.classList.remove('chat-empty'); msgs.classList.add('chat-expanded'); }
                                        } catch (e) {}
                                        try { msgs.scrollTop = msgs.scrollHeight; } catch (e) {}
                                        try {
                                            const fade = contentEl.querySelector('.chat-fade-top');
                                            if (fade) {
                                                if (msgs.scrollHeight > msgs.clientHeight + 4) fade.classList.add('visible'); else fade.classList.remove('visible');
                                            }
                                        } catch (e) {}
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

    // Automatic restoration of saved sessions from localStorage is disabled.
    // Sessions should not persist unless the server indicates active participants.

    // Update UI based on role (director vs attendee)
    try { updateRoleUI(); } catch (e) { /* non-fatal */ }

    // Live layout defaults to vertical.

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

    const liveBtn = document.getElementById('live-mode-btn');
    if (liveBtn) liveBtn.addEventListener('click', () => switchToMode('live'));

    const organizeBtn = document.getElementById('organize-mode-btn');
    if (organizeBtn) organizeBtn.addEventListener('click', () => switchToMode('organize'));

    // Header toggles for floating chat and thumbnails
    const chatToggle = document.getElementById('chat-toggle-btn');
    if (chatToggle) {
        chatToggle.setAttribute('aria-pressed', 'false');
        chatToggle.addEventListener('click', toggleFloatingChat);
    }
    // Quick Jump toggle button (renamed from thumbs-toggle-btn)
    const quickjumpToggle = document.getElementById('quickjump-toggle-btn');
    if (quickjumpToggle) {
        quickjumpToggle.setAttribute('aria-pressed', 'false');
        quickjumpToggle.addEventListener('click', toggleFloatingThumbs);
    }

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

// Right-dock responsive adjustments removed (dock removed from Live view).
