import test from 'node:test';
import assert from 'node:assert/strict';
import { chromeLaunchOptions } from '../src/browser-config.js';

test('chromeLaunchOptions uses the maximized native Chrome viewport', () => {
  assert.deepEqual(chromeLaunchOptions(), {
    headless: false,
    channel: 'chrome',
    viewport: null,
    args: ['--start-maximized']
  });
});
