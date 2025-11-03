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
    displayUploadedFile(chart);
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

function renderOrganizeMode() {
    const grid = document.getElementById('charts-grid');
    grid.innerHTML = '';
    
    AppState.charts.forEach((chart, index) => {
        const card = document.createElement('div');
        card.className = 'chart-card';
        card.onclick = () => {
            AppState.currentChartIndex = index;
            AppState.currentPageNumber = 1;
            switchToMode('concert');
        };
        
        card.innerHTML = `
            <div class="chart-thumbnail">
                <svg width="100" height="100" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                    <polyline points="14 2 14 8 20 8"></polyline>
                    <line x1="16" y1="13" x2="8" y2="13"></line>
                    <line x1="16" y1="17" x2="8" y2="17"></line>
                    <polyline points="10 9 9 9 8 9"></polyline>
                </svg>
            </div>
            <div class="chart-info">
                <h3>${escapeHtml(chart.name)}</h3>
                <p>PDF Chart</p>
            </div>
        `;
        
        grid.appendChild(card);
    });
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
        renderCurrentChart();
    } else {
        concertView.classList.remove('active');
        organizeView.classList.add('active');
        concertBtn.classList.remove('active');
        organizeBtn.classList.add('active');
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
