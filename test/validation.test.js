import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesSchema } from '../validation.js';

test('integer schemas accept whole refresh intervals', () => {
  const schema = {type: 'integer', minimum: 0, maximum: 720};
  for (const value of [0, 6, 12, 24, 72, 720]) assert.equal(matchesSchema(value, schema), true);
});

test('integer schemas reject fractions, strings, and non-finite values', () => {
  const schema = {type: 'integer', minimum: 0, maximum: 720};
  for (const value of [1.5, '24', NaN, Infinity, -Infinity]) assert.equal(matchesSchema(value, schema), false);
});

test('numeric bounds are enforced', () => {
  const schema = {type: 'integer', minimum: 0, maximum: 720};
  assert.equal(matchesSchema(-1, schema), false);
  assert.equal(matchesSchema(721, schema), false);
});

test('primitive schema types retain their normal JavaScript checks', () => {
  assert.equal(matchesSchema(true, {type: 'boolean'}), true);
  assert.equal(matchesSchema('Asia/Tokyo', {type: 'string'}), true);
  assert.equal(matchesSchema('true', {type: 'boolean'}), false);
  assert.equal(matchesSchema(undefined, undefined), false);
});
