#!/usr/bin/env node
// Smoke test for Quick Jump: verifies the SidebarManager quick-jump module
// updates when AppState.charts changes (add/reorder/remove) via 'charts:changed'.

const fs = require('fs');
(async function main(){
  let jsdom;
  try { jsdom = require('jsdom'); } catch (e) {
    console.error('jsdom not installed. Install it with: npm install jsdom');
    process.exit(2);
  }
  const { JSDOM } = jsdom;
  const html = `<!doctype html><html><body><div id="sidebar"><div id="sidebar-quick-jump"></div></div></body></html>`;
  const dom = new JSDOM(html, { runScripts: 'outside-only', resources: 'usable' });
  const { window } = dom;
  // make console available inside the jsdom window
  window.console = console;

  // minimal global state expected by app.js
  window.AppState = { charts: [], viewMode: 'organize', currentChartIndex: 0 };
  window._pageManager = {
    serialize() { return { charts: [], pages: {} }; },
    getPage() { return { thumb: null }; }
  };

  // Evaluate app.js in the JSDOM window context
  const vm = require('vm');
  const context = vm.createContext(window);
  const appSrc = fs.readFileSync('./app.js', 'utf8');
  try {
    // Provide minimal browser-like globals that app.js expects
    try { window.localStorage = window.localStorage || { getItem: () => null, setItem: () => {}, removeItem: () => {} }; } catch (e) {}
    try { window.pdfjsLib = window.pdfjsLib || { getDocument: (src) => ({ promise: Promise.resolve({ numPages: 1, getPage: async (n) => ({ getViewport: ({ scale }) => ({ width: 100, height: 100 }), render: ({ canvasContext, viewport }) => ({ promise: Promise.resolve() }) }) }) }) }; } catch (e) {}
    try { window.Sortable = window.Sortable || null; } catch (e) {}
    // Evaluate the app code and catch any thrown errors so we can debug
    try {
      vm.runInContext(appSrc, context, { filename: 'app.js' });
    } catch (innerErr) {
      console.error('Error while evaluating app.js in VM:');
      console.error(innerErr && innerErr.stack ? innerErr.stack : innerErr);
      // dump a short snippet of the file for context
      console.error('\n--- app.js snippet (first 400 chars) ---\n' + appSrc.slice(0, 400));
      process.exit(3);
    }
  } catch (e) {
    console.error('Unexpected error preparing VM context:', e && e.stack ? e.stack : e);
    process.exit(4);
  }

  // Try to locate SidebarManager in the evaluated context. Some top-level
  // declarations (class/function) may not be attached as properties on the
  // global object. Attempt several probes and then bind it to window if found.
  try {
    let found = null;
    try { found = vm.runInContext('typeof SidebarManager !== "undefined" ? SidebarManager : null', context); } catch (e) { found = null; }
    if (!found) {
      try { found = vm.runInContext('typeof globalThis !== "undefined" && typeof globalThis.SidebarManager !== "undefined" ? globalThis.SidebarManager : null', context); } catch (e) { found = null; }
    }
    if (!found) {
      try { found = vm.runInContext('typeof this !== "undefined" && typeof this.SidebarManager !== "undefined" ? this.SidebarManager : null', context); } catch (e) { found = null; }
    }
    if (!found) {
      // as a last resort, scan global property names for likely candidates
      const keys = Object.getOwnPropertyNames(window).filter(Boolean);
      console.warn('SidebarManager not found on window; available top-level keys:', keys.slice(0,200));
      console.error('SidebarManager not found');
      process.exit(4);
    }
    // bind to window for test convenience
    window.SidebarManager = found;
    window._sidebarManager = new window.SidebarManager();
  } catch (e) {
    console.error('Failed to instantiate SidebarManager:', e && e.stack ? e.stack : e);
    process.exit(5);
  }

  function thumbCount() { return window.document.querySelectorAll('#sidebar-quick-jump .sidebar-thumb').length; }

  // Populate AppState and mock pageManager.serialize to include pageMap/thumbs
  window.AppState.charts = [
    { id: 'c1', name: 'One' },
    { id: 'c2', name: 'Two' },
    { id: 'c3', name: 'Three' }
  ];
  window._pageManager = {
    serialize() {
      const charts = window.AppState.charts.map(c => ({ id: c.id, name: c.name, pageMap: [c.id+'_p1'] }));
      const pages = {};
      window.AppState.charts.forEach(c => { pages[c.id+'_p1'] = { id: c.id+'_p1', thumb: 'data:' }; });
      return { charts, pages };
    },
    getPage(id) { return { thumb: 'data:' }; }
  };

  // Dispatch change and allow the render to run
  window.dispatchEvent(new window.CustomEvent('charts:changed'));
  await new Promise(r => setTimeout(r, 50));

  let count = thumbCount();
  console.log('Initial thumbs count:', count);
  if (count !== 3) { console.error('FAIL: expected 3 thumbs'); process.exit(10); }

  // Reorder
  window.AppState.charts = [window.AppState.charts[2], window.AppState.charts[0], window.AppState.charts[1]];
  window.dispatchEvent(new window.CustomEvent('charts:changed'));
  await new Promise(r => setTimeout(r, 50));
  // After reorder, Quick Jump no longer displays chart names; verify the
  // first thumbnail corresponds to the first chart by inspecting the
  // data-page-id / data-chart-id attribute produced by the renderer.
  const firstThumb = window.document.querySelector('#sidebar-quick-jump .sidebar-thumb');
  const firstPageId = firstThumb && (firstThumb.dataset.pageId || firstThumb.dataset.chartId || '');
  console.log('First thumb page/chart id after reorder:', firstPageId);
  if (!firstPageId.startsWith('c3')) { console.error('FAIL: reorder did not update quickjump (first thumb not c3)'); process.exit(11); }

  // Remove
  window.AppState.charts = window.AppState.charts.slice(0,2);
  window.dispatchEvent(new window.CustomEvent('charts:changed'));
  await new Promise(r => setTimeout(r, 50));
  count = thumbCount();
  console.log('After remove thumbs count:', count);
  if (count !== 2) { console.error('FAIL: expected 2 thumbs after remove'); process.exit(12); }

  console.log('PASS: Quick Jump updated on add/reorder/remove');
  process.exit(0);
})();
