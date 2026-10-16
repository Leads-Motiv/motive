"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

for (const [file, steps] of [['index.html', 2], ['Partner.html', 4]]) {
  test(`${file}: preserve step count, query-only test routing and attribution fields`, () => {
    const html = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    assert.match(html, new RegExp(`totalSteps:\\s*${steps}\\b`));
    assert.match(html, /name="utm_id"/);
    const parameterMap = html.match(/const parameterMap = (\{[\s\S]*?\});/)[1];
    // Evaluating this catches an accidental raw payload reference in the URL map.
    const map = vm.runInNewContext(`(${parameterMap})`);
    assert.match(map.utm_id, /utm-id$/);
    assert.match(html, /utm_id:\s*sanitize\(raw\.utm_id,\s*180\)/);
    assert.match(html, /name="hp_token"/);
    assert.doesNotMatch(html, /name="company_website"/);
    const expression = html.match(/SECURE_ROUTER_URL:\s*([^,]+),/)[1];
    for (const search of ['?test=1', '?utm_id=wm_champ_01_fmg&test=1', '?test=0', '']) {
      assert.equal(vm.runInNewContext(expression, {URLSearchParams, window: {location: {search}}}),
        '/api/lead' + (new URLSearchParams(search).get('test') === '1' ? '?test=1' : ''));
    }
  });
}
