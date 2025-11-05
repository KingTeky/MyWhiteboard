/*
 PageManager - client-side page and annotation manager
 Stores pages as normalized objects and annotations as vector stroke lists.
 Designed to be non-breaking: works alongside existing AppState annotations (PNG dataURLs)
 Usage: window.PageManager is available after including this script.
*/
(function (global) {
  'use strict';

  function now() { return Date.now(); }

  // Simple uid generator
  function uid(prefix) {
    return (prefix ? prefix + '_' : '') + Math.random().toString(36).slice(2, 9);
  }

  // Stroke renderer: draws an array of strokes onto a canvas context
  function renderStrokes(ctx, strokes, scale=1) {
    if (!strokes || !Array.isArray(strokes)) return;
    strokes.forEach(stroke => {
      try {
        const pts = stroke.points || [];
        if (pts.length === 0) return;
        ctx.save();
        ctx.strokeStyle = stroke.color || '#ef4444';
        ctx.lineWidth = (stroke.width || 3) * (scale || 1);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.stroke();
        ctx.restore();
      } catch (e) { /* ignore stroke render errors */ }
    });
  }

  function PageManager(opts) {
    opts = opts || {};
    this.pdfjsLib = opts.pdfjsLib || (global && global.pdfjsLib) || null;
    this.store = {
      charts: [], // array of chart objects (backwards compat)
      pages: {}   // map pageId -> page object
    };
    this._listeners = {};
  }

  PageManager.prototype._emit = function (ev, data) {
    const l = this._listeners[ev];
    if (!l) return;
    l.forEach(fn => { try { fn(data); } catch (e) {} });
  };

  PageManager.prototype.on = function (ev, fn) {
    this._listeners[ev] = this._listeners[ev] || [];
    this._listeners[ev].push(fn);
  };

  PageManager.prototype.off = function (ev, fn) {
    if (!this._listeners[ev]) return;
    this._listeners[ev] = this._listeners[ev].filter(f => f !== fn);
  };

  // Basic createPagesFromPdf: reads a chart (with data:dataURL) and creates page entries
  PageManager.prototype.createPagesFromPdf = async function (chart) {
    if (!chart || !chart.data) throw new Error('chart must include data URL');
    if (!this.pdfjsLib) {
      // cannot split without pdfjs
      return [];
    }
    try {
      const loadingTask = this.pdfjsLib.getDocument(chart.data);
      const pdf = await loadingTask.promise;
      const pageIds = [];
      for (let p = 1; p <= pdf.numPages; p++) {
        const pageId = uid(String(chart.id || chart.name || 'c'));
        const pageObj = {
          id: pageId,
          chartId: chart.id,
          pageIndex: p,
          thumb: null,
          annotation: [], // vector strokes
          createdAt: now(),
          updatedAt: now()
        };
        this.store.pages[pageId] = pageObj;
        pageIds.push(pageId);
        // generate small thumbnail asynchronously (don't await)
        (async (pageIndex, pid) => {
          try {
            const page = await pdf.getPage(pageIndex);
            const viewport = page.getViewport({ scale: 1 });
            const scale = Math.min(300 / viewport.width, 1);
            const scaled = page.getViewport({ scale });
            const canvas = global.document ? global.document.createElement('canvas') : null;
            if (canvas) {
              canvas.width = scaled.width; canvas.height = scaled.height;
              const ctx = canvas.getContext('2d');
              await page.render({ canvasContext: ctx, viewport: scaled }).promise;
              try { this.store.pages[pid].thumb = canvas.toDataURL('image/png'); } catch (e) {}
              this.store.pages[pid].width = canvas.width; this.store.pages[pid].height = canvas.height;
              this.store.pages[pid].updatedAt = now();
              this._emit('page:thumb', { pageId: pid, thumb: this.store.pages[pid].thumb });
              // Emit combined update so clients can react to thumb changes without full serialize
              try { this._emit('page:updated', { pageId: pid, page: this.store.pages[pid] }); } catch (e) {}
            }
          } catch (e) { /* ignore per-page render errors */ }
        })(p, pageId);
      }
      // update chart.pageMap to reference pageIds
      chart.pageMap = pageIds.slice();
      // keep charts backward compat
      const existing = this.store.charts.find(c => c.id === chart.id);
      if (!existing) this.store.charts.push(chart);
      this._emit('pages:created', { chartId: chart.id, pageIds });
      return pageIds;
    } catch (e) {
      throw e;
    }
  };

  PageManager.prototype.getPage = function (pageId) {
    return this.store.pages[pageId] || null;
  };

  PageManager.prototype.getChartPageMap = function (chartId) {
    const chart = (this.store.charts || []).find(c => c.id === chartId);
    return chart ? (chart.pageMap || []) : [];
  };

  PageManager.prototype.updatePageAnnotation = function (pageId, strokes) {
    if (!this.store.pages[pageId]) return false;
    this.store.pages[pageId].annotation = Array.isArray(strokes) ? strokes : [];
    this.store.pages[pageId].updatedAt = now();
    this._emit('page:annotation', { pageId, strokes: this.store.pages[pageId].annotation });
    // Emit a lightweight combined event so clients can react to any page-level change
    try { this._emit('page:updated', { pageId: pageId, page: this.store.pages[pageId] }); } catch (e) {}
    return true;
  };

  PageManager.prototype.getAnnotation = function (pageId) {
    const p = this.store.pages[pageId];
    return p ? (p.annotation || []) : [];
  };

  PageManager.prototype.renderAnnotationToCanvas = function (pageId, canvas) {
    if (!canvas) return;
    const strokes = this.getAnnotation(pageId) || [];
    const ctx = canvas.getContext('2d');
    try { ctx.clearRect(0,0,canvas.width, canvas.height); } catch(e){}
    renderStrokes(ctx, strokes);
  };

  PageManager.prototype.serialize = function () {
    // produce minimal serializable payload
    const charts = (this.store.charts || []).map(c => ({ id: c.id, name: c.name, data: c.data, pageMap: c.pageMap }));
    const pages = {};
    Object.keys(this.store.pages).forEach(pid => {
      const p = this.store.pages[pid];
      pages[pid] = { id: p.id, chartId: p.chartId, pageIndex: p.pageIndex, thumb: p.thumb, annotation: p.annotation, createdAt: p.createdAt, updatedAt: p.updatedAt };
    });
    return { charts, pages };
  };

  PageManager.prototype.deserialize = function (payload) {
    try {
      if (!payload) return;
      if (Array.isArray(payload.charts)) this.store.charts = payload.charts.slice();
      if (payload.pages && typeof payload.pages === 'object') {
        Object.keys(payload.pages).forEach(pid => { this.store.pages[pid] = payload.pages[pid]; });
      }
      this._emit('deserialized', {});
    } catch (e) { /* ignore */ }
  };

  // Simple localStorage persistence helpers
  PageManager.prototype.persistToLocalStorage = function (sessionCode) {
    try {
      const key = `session_pages_${sessionCode || 'local'}`;
      const payload = this.serialize();
      localStorage.setItem(key, JSON.stringify(payload));
      return true;
    } catch (e) { return false; }
  };

  PageManager.prototype.restoreFromLocalStorage = function (sessionCode) {
    try {
      const key = `session_pages_${sessionCode || 'local'}`;
      const raw = localStorage.getItem(key);
      if (!raw) return false;
      const payload = JSON.parse(raw);
      this.deserialize(payload);
      return true;
    } catch (e) { return false; }
  };

  // Export
  global.PageManager = PageManager;
  global.PageManager_renderStrokes = renderStrokes;
})(window);
