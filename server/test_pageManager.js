// Simple Node smoke test for PageManager (runs without browser by setting global.window)
try {
  global.window = global;
  global.document = undefined;
  // Load the pageManager script which attaches PageManager to window/global
  require('../pageManager.js');
  const assert = require('assert');

  if (!global.PageManager) throw new Error('PageManager not found on global after require');
  const pm = new global.PageManager();

  // Seed a chart and a page
  const chart = { id: 42, name: 'test.pdf', data: 'data:,x' };
  pm.store.charts.push(chart);
  const pageId = 'p_test_1';
  pm.store.pages[pageId] = { id: pageId, chartId: 42, pageIndex: 1, thumb: null, annotation: [], createdAt: Date.now(), updatedAt: Date.now() };

  // Add an annotation stroke
  const stroke = { points: [{ x: 0, y: 0 }, { x: 10, y: 10 }], color: '#000', width: 2 };
  const ok = pm.updatePageAnnotation(pageId, [stroke]);
  assert.strictEqual(ok, true, 'updatePageAnnotation should return true');

  const ser = pm.serialize();
  assert.ok(ser.pages && ser.pages[pageId], 'serialized pages should include the test page');
  assert.ok(Array.isArray(ser.pages[pageId].annotation), 'serialized page.annotation must be array');
  assert.strictEqual(ser.pages[pageId].annotation.length, 1, 'annotation length should be 1');

  // Deserialize into a fresh manager
  const pm2 = new global.PageManager();
  pm2.deserialize(ser);
  const ann = pm2.getAnnotation(pageId);
  assert.ok(Array.isArray(ann), 'deserialized annotation should be array');
  assert.strictEqual(ann.length, 1, 'deserialized annotation length should be 1');
  assert.deepStrictEqual(ann[0].points, stroke.points, 'stroke points should match after deserialize');

  console.log('PageManager smoke test: PASS');
  process.exit(0);
} catch (e) {
  console.error('PageManager smoke test: FAIL');
  console.error(e && (e.stack || e));
  process.exit(1);
}
