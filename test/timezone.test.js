import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTimeZone, zonedTimestamp, timeZoneHook } from '../timezone.js';

test('IANA time zones are normalized and fixed offsets are rejected', () => {
  assert.equal(normalizeTimeZone(' UTC '), 'UTC');
  assert.equal(normalizeTimeZone('Asia/Tokyo'), 'Asia/Tokyo');
  assert.equal(normalizeTimeZone(''), null);
  assert.throws(() => normalizeTimeZone('+08:00'), /Invalid IANA/);
  assert.throws(() => normalizeTimeZone('Not/A_Zone'), /Invalid IANA/);
});

test('the selected zone formats the same real instant with its actual offset', () => {
  const instant = new Date('2026-01-15T00:00:00Z');
  assert.equal(zonedTimestamp(instant, 'Asia/Tokyo'), '2026-01-15T09:00:00+09:00[Asia/Tokyo]');
  assert.equal(zonedTimestamp(instant, 'America/New_York'), '2026-01-14T19:00:00-05:00[America/New_York]');
});

test('the pre-step hook appends an override after existing context without dropping decision fields', async () => {
  const created = [];
  const createMessage = value => { created.push(value); return { role: 'user', ...value }; };
  const handler = timeZoneHook(() => 'Asia/Tokyo', createMessage, () => new Date('2026-01-15T00:00:00Z'));
  const builtIn = { role: 'user', content: [{ type: 'text', text: 'browser time zone: Asia/Shanghai' }] };
  const decision = await handler({ turn: 3, step: 2 }, async () => ({ kind: 'enter', startsRequestSeries: true, messages: [builtIn] }));
  assert.equal(decision.startsRequestSeries, true);
  assert.equal(decision.messages[0], builtIn);
  assert.equal(decision.messages.length, 2);
  const text = created[0].content[0].text;
  assert.match(text, /Asia\/Tokyo/);
  assert.match(text, /2026-01-15T09:00:00\+09:00/);
  assert.match(text, /model interpretation only/);
});

test('disabling the preference emits a reset snapshot and non-enter decisions are unchanged', async () => {
  const createMessage = value => ({ role: 'user', ...value });
  const handler = timeZoneHook(() => null, createMessage);
  const reset = await handler({ turn: 1, step: 1 }, async () => ({ kind: 'enter', messages: [] }));
  assert.match(reset.messages[0].content[0].text, /no plugin override is active/);
  const rejected = { kind: 'reject', reason: 'done' };
  assert.equal(await handler({ turn: 1, step: 2 }, async () => rejected), rejected);
});
