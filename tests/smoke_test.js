(async function(){
  const base = 'http://127.0.0.1:3000';
  try {
    // create session 1 and post small pages
    let r = await (await fetch(base + '/api/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json();
    console.log('CREATED:' + r.code + '|' + r.directorToken);
    let body = { charts: [{ id: 1, name: 'small.pdf', data: 'data:,x' }], pages: { p1: { strokes: [] } } };
    let res = await fetch(`${base}/api/sessions/${r.code}/charts`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-director-token': r.directorToken }, body: JSON.stringify(body) });
    console.log('SMALL_POST_STATUS:' + res.status);
    console.log(await res.text());

    // create session 2 and post oversized page
    let r2 = await (await fetch(base + '/api/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json();
    console.log('CREATED2:' + r2.code + '|' + r2.directorToken);
    const big = 'A'.repeat(600000);
    let body2 = { charts: [{ id: 2, name: 'big.pdf', data: 'data:,big' }], pages: { p1: { data: big } } };
    let res2 = await fetch(`${base}/api/sessions/${r2.code}/charts`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-director-token': r2.directorToken }, body: JSON.stringify(body2) });
    console.log('BIG_POST_STATUS:' + res2.status);
    console.log(await res2.text());
  } catch (e) {
    console.error('ERROR', e);
    process.exit(1);
  }
})();
