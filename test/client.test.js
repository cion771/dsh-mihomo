// Renders the plugin's Client half in jsdom and drives it like a user, so a node can actually be
// picked and a control's colour pairing can be checked. This exists because the UI cannot be
// inspected any other way in this environment, and three display defects shipped without it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import React from 'react';
import { createRoot } from 'react-dom/client';

const clientSource = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
const act = React.act ?? (await import('react-dom/test-utils')).act;

const STATUS = {
  phase: 'running', running: true, proxyActive: true, coreInstalled: true, coreVersion: 'v1.19.32',
  autoStart: false, timeZone: null, subscriptionConfigured: true, nodeCount: 3,
  nodes: [{ name: 'HK香港 01', type: 'anytls' }, { name: 'JP日本 01', type: 'anytls' }, { name: 'US美国 01', type: 'anytls' }],
  selected: 'HK香港 01', updatedAt: '2026-10-11T13:48:11.612Z', error: null,
  tlsVerificationDisabled: 3, proxyServerDns: 'subscription',
  usage: { upload: 1000000000, download: 4000000000, used: 5000000000, total: 10000000000, remaining: 5000000000, percentUsed: 50, expire: 1793000000, expiresAt: new Date(1793000000 * 1000).toISOString(), daysLeft: 12, expired: false, readAt: '2026-10-13T00:00:00.000Z' },
  autoRefreshHours: 24, lastRefreshAt: '2026-10-13T00:00:00.000Z', nextRefreshAt: '2026-10-14T00:00:00.000Z', lastRefreshError: null,
};

async function mount(overrides = {}) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://127.0.0.1:5336/', pretendToBeVisual: true });
  const saved = { window: globalThis.window, document: globalThis.document, IS_REACT_ACT_ENVIRONMENT: globalThis.IS_REACT_ACT_ENVIRONMENT };
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;

  const requests = [];
  let currentStatus = { ...STATUS, ...overrides };
  const fetchImpl = async (_url, init) => {
    const body = JSON.parse(init.body);
    requests.push(body);
    if (body.action === 'select') currentStatus = { ...currentStatus, selected: body.node };
    if (body.action === 'configure' && Object.hasOwn(body, 'timeZone')) currentStatus = { ...currentStatus, timeZone: body.timeZone || null };
    if (body.action === 'configure' && Object.hasOwn(body, 'autoRefreshHours')) currentStatus = { ...currentStatus, autoRefreshHours: body.autoRefreshHours, nextRefreshAt: body.autoRefreshHours ? currentStatus.nextRefreshAt : null };
    const result = body.action === 'latency'
      ? { results: currentStatus.nodes.map((n, i) => ({ name: n.name, delayMs: 100 * (i + 1) })), testedAt: 'now', state: currentStatus }
      : currentStatus;
    return { json: async () => ({ ok: true, result }) };
  };
  dom.window.fetch = fetchImpl;
  globalThis.fetch = fetchImpl;

  let registered = null;
  dom.window.__ModuleLoader__ = { load: definition => { registered = definition.factory; } };
  new Function('window', clientSource)(dom.window);
  assert.ok(registered, 'the client module must register a factory with the module loader');
  const client = registered(() => React);

  let Component = null;
  const localeSnapshot = { active: 'zh', locales: [], revision: 0 };
  client.apply({
    locale: { register() {}, bind: () => key => key, subscribe: () => () => {}, getSnapshot: () => localeSnapshot },
    slots: { inject: (_key, callback) => callback(), register: (_options, component) => { Component = component; } },
    effect: () => () => {}, on: () => {},
  });
  assert.ok(Component, 'the plugin must register a settings section component');

  const root = createRoot(dom.window.document.getElementById('root'));
  await act(async () => { root.render(React.createElement(Component)); });
  return {
    dom, root, requests,
    click(element) { return act(async () => { element.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); }); },
    press(element, key) { return act(async () => { element.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, bubbles: true })); }); },
    async close() { await act(async () => { root.unmount(); }); dom.window.close(); Object.assign(globalThis, saved); },
  };
}

const byText = (nodes, text) => [...nodes].find(node => node.textContent.trim() === text);

test('picking a node in the drawn list sticks and can be applied', async () => {
  const app = await mount();
  try {
    const { document } = app.dom.window;
    const trigger = document.querySelector('.dsh-mh-trigger');
    assert.ok(trigger, 'the node picker trigger renders');
    assert.ok(trigger.textContent.includes('HK香港 01'), 'the trigger shows the applied node');
    assert.equal(document.querySelector('.dsh-mh-list'), null, 'the list starts closed');

    await app.click(trigger);
    assert.ok(document.querySelector('.dsh-mh-list'), 'clicking the trigger opens the list');
    const options = document.querySelectorAll('.dsh-mh-option');
    assert.equal(options.length, 3);
    assert.equal(options[0].getAttribute('aria-selected'), 'true');
    assert.equal(options[0].getAttribute('role'), 'option');

    // The regression this test exists for: an option click used to look like an outside click,
    // so the list closed on mousedown and the choice was silently dropped. The two events are
    // flushed separately on purpose — a browser delivers discrete events in separate tasks, and
    // batching them into one act() would hide exactly the bug under test.
    const target = options[1];
    await act(async () => { target.dispatchEvent(new app.dom.window.MouseEvent('mousedown', { bubbles: true })); });
    assert.ok(document.querySelector('.dsh-mh-list'), 'mousedown on an option must not close the list');
    await act(async () => { target.dispatchEvent(new app.dom.window.MouseEvent('click', { bubbles: true })); });
    assert.equal(document.querySelector('.dsh-mh-list'), null, 'picking a node closes the list');
    assert.ok(document.querySelector('.dsh-mh-trigger').textContent.includes('JP日本 01'), 'the picked node becomes the pending choice');

    const apply = byText(document.querySelectorAll('.dsh-mh-actions button'), 'switch');
    assert.ok(apply, 'the apply control renders');
    assert.equal(apply.disabled, false, 'applying a new choice is enabled');
    await app.click(apply);
    assert.ok(app.requests.some(r => r.action === 'select' && r.node === 'JP日本 01'), 'the choice reaches the Host');
  } finally { await app.close(); }
});

test('the list closes on Escape and on a real outside click', async () => {
  const app = await mount();
  try {
    const { document, window } = app.dom.window;
    const trigger = document.querySelector('.dsh-mh-trigger');
    await app.click(trigger);
    await app.press(document.querySelector('.dsh-mh-list'), 'Escape');
    assert.equal(document.querySelector('.dsh-mh-list'), null, 'Escape closes the list');

    await app.click(trigger);
    await act(async () => { document.body.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true })); });
    assert.equal(document.querySelector('.dsh-mh-list'), null, 'an outside click closes the list');
  } finally { await app.close(); }
});

test('latency results render per node after measuring', async () => {
  const app = await mount();
  try {
    const { document } = app.dom.window;
    const measure = byText(document.querySelectorAll('.dsh-mh-actions button'), 'latencyTest');
    assert.ok(measure, 'the latency control renders');
    assert.equal(measure.disabled, false, 'latency can be measured while the proxy runs');
    await app.click(measure);
    assert.ok(app.requests.some(r => r.action === 'latency'), 'measuring asks the Host');
    const badges = [...document.querySelectorAll('.dsh-mh-lat')].map(node => node.textContent);
    assert.ok(badges.some(text => text.includes('100 ms')), `expected a rendered latency value, saw ${JSON.stringify(badges)}`);
  } finally { await app.close(); }
});

test('a human-readable region applies immediately and automatic mode can be restored', async () => {
  const app = await mount();
  try {
    const { document } = app.dom.window;
    const automatic = document.querySelector('[data-zone=""]');
    const japan = document.querySelector('[data-zone="Asia/Tokyo"]');
    assert.ok(automatic, 'the automatic browser-zone choice renders');
    assert.ok(japan, 'the Japan region choice renders');
    assert.equal(automatic.getAttribute('aria-pressed'), 'true');
    assert.ok(japan.textContent.includes('zoneJapan'), 'the human label is the primary text');

    await app.click(japan);
    assert.ok(app.requests.some(r => r.action === 'configure' && r.timeZone === 'Asia/Tokyo'));
    assert.equal(japan.getAttribute('aria-pressed'), 'true', 'the selected region becomes visibly active');
    assert.equal(document.querySelector('#dsh-mh-timezone').value, 'Asia/Tokyo', 'advanced input tracks the applied choice');

    await app.click(automatic);
    assert.ok(app.requests.some(r => r.action === 'configure' && r.timeZone === ''));
    assert.equal(automatic.getAttribute('aria-pressed'), 'true');
  } finally { await app.close(); }
});

test('subscription usage is shown in readable units and the refresh interval applies on click', async () => {
  const app = await mount();
  try {
    const { document } = app.dom.window;
    const bar = document.querySelector('.dsh-mh-usage-bar');
    assert.ok(bar, 'the usage bar renders when the provider reports a quota');
    assert.equal(bar.getAttribute('aria-valuenow'), '50');
    assert.ok(document.body.textContent.includes('4.7 GiB'), `expected a human-readable amount, saw ${document.body.textContent.slice(0, 200)}`);
    assert.ok(document.body.textContent.includes('4.7 GiB / 9.3 GiB'), 'used and total are shown together');

    const day = document.querySelector('[data-hours="24"]');
    const six = document.querySelector('[data-hours="6"]');
    const off = document.querySelector('[data-hours="0"]');
    assert.ok(day && six && off, 'the interval choices render');
    assert.equal(day.getAttribute('aria-pressed'), 'true', 'the saved interval is the active choice');
    assert.equal(six.getAttribute('aria-pressed'), 'false');

    await app.click(six);
    assert.ok(app.requests.some(r => r.action === 'configure' && r.autoRefreshHours === 6), 'the choice reaches the Host');
    assert.equal(six.getAttribute('aria-pressed'), 'true', 'the chosen interval becomes visibly active');
    assert.equal(day.getAttribute('aria-pressed'), 'false');

    await app.click(off);
    assert.ok(app.requests.some(r => r.action === 'configure' && r.autoRefreshHours === 0), 'automatic refresh can be switched off');
    assert.equal(off.getAttribute('aria-pressed'), 'true');
  } finally { await app.close(); }
});

test('a provider that reports no usage is explained instead of showing an empty quota', async () => {
  const app = await mount({ usage: null });
  try {
    const { document } = app.dom.window;
    assert.equal(document.querySelector('.dsh-mh-usage-bar'), null, 'no bar is drawn without a reported quota');
    assert.ok(document.body.textContent.includes('usageUnknown'), 'the panel says the provider publishes nothing');
    // A failed background refresh is surfaced where it belongs rather than as a silent no-op.
    assert.equal(document.querySelector('[role="alert"]'), null);
  } finally { await app.close(); }
});

test('a provider that states no total quota is never drawn as a completed bar', async () => {
  // `total=0` means "not stated", so it must not render as 0 used of 0, or as a full red bar.
  const app = await mount({ usage: { upload: 10, download: 20, used: 30, total: null, remaining: null, percentUsed: null, expire: null, expiresAt: null, daysLeft: null, expired: false, readAt: '2026-10-13T00:00:00.000Z' } });
  try {
    const { document } = app.dom.window;
    const bar = document.querySelector('.dsh-mh-usage-bar');
    assert.ok(bar, 'the bar still renders because usage itself was reported');
    assert.equal(bar.getAttribute('aria-valuenow'), null, 'an unknown percentage is not announced as a number');
    assert.equal(document.querySelector('.dsh-mh-usage-high'), null, 'an unknown percentage is not painted as critical');
    const text = document.body.textContent;
    assert.ok(text.includes('usageUnlimited'), 'the missing quota is stated');
    assert.ok(text.includes('usageNoExpire'), 'the missing expiry is stated');
    assert.equal(text.includes('usageRemaining'), false, 'no remaining line is invented without a total');
  } finally { await app.close(); }
});

test('a saved subscription can be refreshed while the proxy runs', async () => {
  const app = await mount();
  try {
    const { document } = app.dom.window;
    assert.equal(STATUS.running, true, 'the fixture is a running proxy');
    const refresh = byText(document.querySelectorAll('.dsh-mh-actions button'), 'refresh');
    assert.ok(refresh, 'the refresh control renders');
    assert.equal(refresh.disabled, false, 'a running proxy no longer blocks a subscription refresh');

    await app.click(refresh);
    assert.ok(app.requests.some(r => r.action === 'refresh'), 'refreshing asks the Host');
  } finally { await app.close(); }
});

test('a failed automatic refresh is reported as an alert', async () => {
  const app = await mount({ lastRefreshError: 'Download failed. Check bootstrap network connectivity.' });
  try {
    const { document } = app.dom.window;
    const alert = document.querySelector('[role="alert"]');
    assert.ok(alert, 'the failure is announced');
    assert.ok(alert.textContent.includes('Download failed'), 'the provider-visible reason is kept');
  } finally { await app.close(); }
});

test('no control paints its text with a background token', () => {
  // Twice a control used --dsw-alias-bg-base as its foreground on a coloured fill and became
  // unreadable, so the pairing is now forbidden in source rather than judged by eye.
  assert.equal(/color:\s*var\(--dsw-alias-bg-[a-z0-9-]+\)/.test(clientSource), false, 'a foreground must never reuse a background token');
});
