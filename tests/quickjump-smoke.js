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
    vm.runInContext(appSrc, context, { filename: 'app.js' });
  } catch (e) {
    console.error('Error evaluating app.js:', e);
    process.exit(3);
  }

  // Instantiate SidebarManager
  if (!window.SidebarManager) { console.error('SidebarManager not found'); process.exit(4); }
  window._sidebarManager = new window.SidebarManager();

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
  const firstLabel = window.document.querySelector('#sidebar-quick-jump .sidebar-thumb .sidebar-thumb-label')?.textContent || '';
  console.log('First label after reorder:', firstLabel);
  if (firstLabel !== 'Three') { console.error('FAIL: reorder did not update quickjump (firstLabel != Three)'); process.exit(11); }

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
