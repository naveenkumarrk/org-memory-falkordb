import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const moduleUrl = process.env.ORG_MEMORY_DEMO_MODULE
  ? pathToFileURL(process.env.ORG_MEMORY_DEMO_MODULE).href : new URL('./auth.ts', import.meta.url).href;
const { authenticate } = await import(moduleUrl);
test('mobile checkout can still authenticate using its legacy token', () => {
  assert.equal(authenticate('v1:valid'), true, 'Removing legacy parsing breaks the unmigrated mobile checkout client');
});
test('modern tokens continue to authenticate', () => {
  assert.equal(authenticate('v2:valid'), true);
});
test('invalid tokens remain rejected', () => {
  assert.equal(authenticate('not-valid'), false);
});
test('callers can explicitly disable legacy compatibility', () => {
  assert.equal(authenticate('v1:valid', false), false);
  assert.equal(authenticate('v2:valid', false), true);
});
