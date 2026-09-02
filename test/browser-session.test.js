import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowserContextIfEmpty, releaseBrowserContext } from '../src/browser-session.js';

test('releaseBrowserContext keeps Chrome open while uploads await manual confirmation', async () => {
  let closed = false;
  const context = { close: async () => { closed = true; } };

  const retained = await releaseBrowserContext(context, { keepOpen: true });
  assert.equal(retained, context);
  assert.equal(closed, false);
});

test('releaseBrowserContext closes Chrome when the task is not awaiting confirmation', async () => {
  let closed = false;
  const context = { close: async () => { closed = true; } };

  const retained = await releaseBrowserContext(context, { keepOpen: false });
  assert.equal(retained, null);
  assert.equal(closed, true);
});

test('closeBrowserContextIfEmpty closes a context only after its last page is gone', async () => {
  let closed = false;
  const context = { pages: async () => [], close: async () => { closed = true; } };
  assert.equal(await closeBrowserContextIfEmpty(context), true);
  assert.equal(closed, true);

  closed = false;
  const contextWithPage = { pages: async () => [{}], close: async () => { closed = true; } };
  assert.equal(await closeBrowserContextIfEmpty(contextWithPage), false);
  assert.equal(closed, false);
});
