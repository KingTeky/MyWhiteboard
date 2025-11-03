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
    viewMode: 'concert', // 'concert' or 'organize'
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
    AppState.sessionCode = generateSessionCode();
    AppState.isDirector = true;
    showPage('upload');
    document.getElementById('session-code-display').textContent = AppState.sessionCode;
    
    // Store session in localStorage for demo purposes
    localStorage.setItem('currentSession', JSON.stringify({
        code: AppState.sessionCode,
        isDirector: true,
        charts: []
    }));
}

function joinSession() {
    const input = document.getElementById('session-code-input');
    const code = input.value.trim().toUpperCase();
    
    if (code.length !== 6) {
        alert('Please enter a valid 6-character session code');
        return;
    }
    
    // Check if session exists (in a real app, this would be a server call)
    const sessionData = localStorage.getItem(`session_${code}`);
    
    if (!sessionData && code !== AppState.sessionCode) {
        alert('Session not found. Please check the code and try again.');
        return;
    }
    
    AppState.sessionCode = code;
    AppState.isDirector = false;
    
    // Load session data
    if (sessionData) {
        const session = JSON.parse(sessionData);
        AppState.charts = session.charts || [];
    }
    
    if (AppState.charts.length > 0) {
        showPage('viewer');
        renderCurrentChart();
    } else {
        alert('This session has no charts yet. Please wait for the Music Director to upload charts.');
    }
}

function startSession() {
    if (AppState.charts.length === 0) {
        alert('Please upload at least one PDF before starting the session');
        return;
    }
    
    // Save session data
    localStorage.setItem(`session_${AppState.sessionCode}`, JSON.stringify({
        code: AppState.sessionCode,
        charts: AppState.charts
    }));
    
    showPage('viewer');
    renderCurrentChart();
}

function leaveSession() {
    if (confirm('Are you sure you want to leave this session?')) {
        // Reset state
        AppState.charts = [];
        AppState.currentChartIndex = 0;
        AppState.currentPageNumber = 1;
        AppState.sessionCode = null;
        AppState.isDirector = false;
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
    
    // Use iframe to display PDF with native browser viewer
    const pdfViewer = document.getElementById('pdf-viewer');
    pdfViewer.src = `${chart.data}#page=${AppState.currentPageNumber}`;
    
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

        // Double click opens in concert mode
        card.addEventListener('dblclick', () => {
            AppState.currentPageNumber = 1;
            switchToMode('concert');
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
    if (!AppState.sessionCode) {
        // store as currentSession for demo flows
        localStorage.setItem('currentSession', JSON.stringify({ code: AppState.sessionCode, isDirector: AppState.isDirector, charts: AppState.charts }));
    } else {
        localStorage.setItem(`session_${AppState.sessionCode}`, JSON.stringify({ code: AppState.sessionCode, charts: AppState.charts }));
    }
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
function switchToMode(mode) {
    AppState.viewMode = mode;
    
    const concertView = document.getElementById('concert-view');
    const organizeView = document.getElementById('organize-view');
    const concertBtn = document.getElementById('concert-mode-btn');
    const organizeBtn = document.getElementById('organize-mode-btn');
    
    if (mode === 'concert') {
        concertView.classList.add('active');
        organizeView.classList.remove('active');
        concertBtn.classList.add('active');
        organizeBtn.classList.remove('active');
        // Stop the organize mode ticker and restore the current chart title
        stopOrganizeTicker();
        renderCurrentChart();
    } else {
        concertView.classList.remove('active');
        organizeView.classList.add('active');
        concertBtn.classList.remove('active');
        organizeBtn.classList.add('active');
        // Start date/time ticker in the header and render organize grid
        startOrganizeTicker();
        showOrganizeHeaderHelp();
        renderOrganizeMode();
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
    document.getElementById('create-session-btn').addEventListener('click', createSession);
    document.getElementById('join-session-btn').addEventListener('click', joinSession);
    document.getElementById('session-code-input').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') joinSession();
    });
    
    // Upload page
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('pdf-upload');
    
    document.getElementById('browse-files-btn').addEventListener('click', () => {
        fileInput.click();
    });
    
    fileInput.addEventListener('change', function(e) {
        handleFileSelect(e.target.files);
    });

    // Organize view: allow adding charts from here as well
    const addChartsBtn = document.getElementById('add-charts-btn');
    if (addChartsBtn) {
        addChartsBtn.addEventListener('click', () => {
            // reuse the hidden file input to add charts
            fileInput.click();
        });
    }
    
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
    
    document.getElementById('start-session-btn').addEventListener('click', startSession);
    
    // Viewer page
    document.getElementById('leave-session-btn').addEventListener('click', leaveSession);
    document.getElementById('prev-page-btn').addEventListener('click', prevPage);
    document.getElementById('next-page-btn').addEventListener('click', nextPage);
    document.getElementById('prev-chart-btn').addEventListener('click', prevChart);
    document.getElementById('next-chart-btn').addEventListener('click', nextChart);
    document.getElementById('concert-mode-btn').addEventListener('click', () => switchToMode('concert'));
    document.getElementById('organize-mode-btn').addEventListener('click', () => switchToMode('organize'));
    document.getElementById('annotation-btn').addEventListener('click', toggleAnnotationMode);
    
    // Annotation drawing
    const annotationCanvas = document.getElementById('annotation-canvas');
    annotationCanvas.addEventListener('mousedown', startDrawing);
    annotationCanvas.addEventListener('mousemove', draw);
    annotationCanvas.addEventListener('mouseup', stopDrawing);
    annotationCanvas.addEventListener('mouseout', stopDrawing);
    
    // Touch support for annotations
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
});
