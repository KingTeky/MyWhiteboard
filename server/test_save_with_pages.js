(async () => {
  const base = 'http://127.0.0.1:3000';
  try {
    // create session
    const sRes = await (await fetch(base + '/api/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json();
    console.log('CREATED:' + sRes.code + '|' + sRes.directorToken);
    const code = sRes.code; const token = sRes.directorToken;

    // prepare a small pages payload (simulating a PageManager.serialize().pages)
    const pages = {
      p1: { id: 'p1', chartId: 1, pageIndex: 1, thumb: null, annotation: [{ points: [{x:0,y:0},{x:1,y:1}], color: '#000', width: 2 }], createdAt: Date.now(), updatedAt: Date.now() }
    };
    const charts = [{ id: 1, name: 'fake.pdf', data: 'data:,fake', pageMap: ['p1'] }];

    const body = { charts, pages };
    const res = await fetch(`${base}/api/sessions/${code}/charts`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-director-token': token }, body: JSON.stringify(body) });
    console.log('POST_STATUS:' + res.status);
    console.log('POST_BODY:' + await res.text());

    // fetch back
    const fetchRes = await (await fetch(`${base}/api/sessions/${code}/charts`)).json();
    console.log('FETCHED_CHARTS:', JSON.stringify(fetchRes, null, 2));

    if (fetchRes.pages && fetchRes.pages.p1 && Array.isArray(fetchRes.pages.p1.annotation)) {
      console.log('Integration test: PASS');
      process.exit(0);
    } else {
      console.error('Integration test: FAIL - pages missing or malformed');
      process.exit(2);
    }
  } catch (e) {
    console.error('Integration test: ERROR', e && (e.stack || e));
    process.exit(1);
  }
})();
