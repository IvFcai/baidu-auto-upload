import test from 'node:test';
import assert from 'node:assert/strict';
import { chunk, isVideoFile, buildBatches, selectBatchFiles, uploadBatches, removeFailedUploadItems } from '../src/uploader.js';
import { parseArgs } from '../bin/baidu-auto-upload.js';
import { DEFAULT_ACCOUNT_ID, DEFAULT_ACCOUNT_NAME } from '../src/navigation.js';

test('chunk splits files into batches of 12 and preserves order', () => {
  const files = Array.from({ length: 25 }, (_, index) => `video-${index}.mp4`);
  assert.deepEqual(chunk(files, 12), [
    files.slice(0, 12),
    files.slice(12, 24),
    files.slice(24)
  ]);
});

test('chunk rejects invalid batch sizes', () => {
  assert.throws(() => chunk(['a'], 0), /batchSize/);
  assert.throws(() => chunk(['a'], 1.5), /batchSize/);
});

test('isVideoFile accepts common video extensions case-insensitively', () => {
  assert.equal(isVideoFile('clip.MP4'), true);
  assert.equal(isVideoFile('clip.webm'), true);
  assert.equal(isVideoFile('clip.mov'), true);
  assert.equal(isVideoFile('clip.txt'), false);
  assert.equal(isVideoFile('no-extension'), false);
});

test('buildBatches filters non-video files and sorts names deterministically', () => {
  const result = buildBatches([
    { name: 'b.mp4', path: 'b.mp4' },
    { name: 'notes.txt', path: 'notes.txt' },
    { name: 'A.MOV', path: 'A.MOV' }
  ], 12);
  assert.deepEqual(result, [[
    { name: 'A.MOV', path: 'A.MOV' },
    { name: 'b.mp4', path: 'b.mp4' }
  ]]);
});

test('uploadBatches submits each batch in order', async () => {
  const submitted = [];
  const events = [];
  const fileInput = {
    async count() { return 1; },
    async waitFor() {},
    async setInputFiles(files) { submitted.push(['overwritten', files]); }
  };
  fileInput.first = () => fileInput;
  const plus = {
    async count() { return 1; },
    async isVisible() { return true; },
    async scrollIntoViewIfNeeded() {},
    async click() { events.push('click-plus'); }
  };
  plus.first = () => plus;
  const dialog = {
    async waitFor() {},
    locator(selector) { return selector.includes('.video-box') ? plus : fileInput; }
  };
  const chooser = {
    async setFiles(files) { submitted.push(files); events.push(`select:${files.length}`); }
  };
  const page = {
    locator(selector) {
      if (selector.includes('[role="dialog"]')) {
        return { filter: () => ({ first: () => dialog }) };
      }
      return { innerText: async () => { events.push('settle'); return ''; } };
    },
    getByText(text) {
      return { click: async () => events.push(text) };
    },
    async waitForEvent() { return chooser; },
    async waitForTimeout() {}
  };
  const files = Array.from({ length: 25 }, (_, index) => ({ path: `video-${index}.mp4` }));
  const result = await uploadBatches(page, chunk(files, 12), { minWaitMs: 0, stableMs: 0, logger: () => {} });
  assert.deepEqual(submitted.map((batch) => batch.length), [12, 12, 1]);
  assert.equal(new Set(submitted.flat()).size, 25);
  assert.deepEqual(submitted[0][0], 'video-0.mp4');
  assert.deepEqual(submitted[2][0], 'video-24.mp4');
  assert.deepEqual(events, ['click-plus', 'select:12', 'click-plus', 'select:12', 'click-plus', 'select:1', 'settle']);
  assert.deepEqual(result, { batchCount: 3, fileCount: 25, awaitingConfirmation: true });
});

test('removeFailedUploadItems deletes only the failed video row close button', async () => {
  const actions = [];
  let rows = [
    { failed: true, text: '视频-重复.mp4\n重复上传视频' },
    { failed: false, text: '视频-成功.mp4' }
  ];
  const makeButton = (label, row) => ({
    isVisible: async () => true,
    innerText: async () => label,
    getAttribute: async (name) => name === 'aria-label' ? label : null,
    boundingBox: async () => label === '×' ? { x: 100, y: 1, width: 10, height: 10 } : { x: 50, y: 1, width: 10, height: 10 },
    click: async () => {
      actions.push(label);
      if (label === '×') rows = rows.filter((item) => item !== row);
    }
  });
  const dialog = {
    locator: (selector) => {
      if (selector.includes('video-box') && !selector.includes('video-box-panel')) {
        return {
          count: async () => rows.length,
          nth: (index) => {
            const row = rows[index];
            return {
              innerText: async () => row.text,
              getAttribute: async (name) => name === 'class' ? (row.failed ? 'video-box upload-error' : 'video-box') : null,
              locator: (selector) => selector.includes('video-box-panel')
                ? { count: async () => 0 }
                : {
                    count: async () => 2,
                    nth: (buttonIndex) => buttonIndex === 0 ? makeButton('重试', row) : makeButton('×', row)
                  }
            };
          }
        };
      }
      return { count: async () => 0 };
    }
  };

  const removed = await removeFailedUploadItems(dialog, { timeoutMs: 1000, logger: () => {} });
  assert.equal(removed, 1);
  assert.deepEqual(actions, ['×']);
  assert.equal(rows.length, 1);
});

test('removeFailedUploadItems scrolls an offscreen failed row before resolving its close control', async () => {
  let scrolled = false;
  let removed = false;
  const closeButton = {
    isVisible: async () => true,
    innerText: async () => '×',
    getAttribute: async (name) => name === 'aria-label' ? '×' : null,
    click: async () => { removed = true; }
  };
  const row = {
    isVisible: async () => true,
    scrollIntoViewIfNeeded: async () => { scrolled = true; },
    innerText: async () => '视频.mp4\n重复上传视频',
    getAttribute: async (name) => name === 'class' ? 'cc-creative-video-upload-item upload-error' : null,
    locator: () => ({
      count: async () => scrolled ? 1 : 0,
      nth: () => closeButton
    })
  };
  const dialog = {
    locator: (selector) => selector.includes('video-box')
      ? { count: async () => removed ? 0 : 1, nth: () => row }
      : { count: async () => 0 }
  };

  assert.equal(await removeFailedUploadItems(dialog, { timeoutMs: 1000, logger: () => {} }), 1);
  assert.equal(scrolled, true);
  assert.equal(removed, true);
});

test('removeFailedUploadItems finds the close control on the failed row parent container', async () => {
  let removed = false;
  const closeButton = {
    isVisible: async () => true,
    innerText: async () => '×',
    getAttribute: async (name) => name === 'aria-label' ? '×' : null,
    click: async () => { removed = true; }
  };
  const parent = {
    locator: (selector) => selector.includes('button')
      ? { count: async () => 1, nth: () => closeButton }
      : { count: async () => 0 },
    locatorParent: null
  };
  const row = {
    isVisible: async () => true,
    innerText: async () => '视频.mp4\n重复上传视频',
    getAttribute: async (name) => name === 'class' ? 'video-box upload-error' : null,
    locator: (selector) => selector.startsWith('xpath=ancestor')
      ? { first: () => parent }
      : { count: async () => 0 }
  };
  const dialog = {
    locator: (selector) => selector.includes('video-box')
      ? { count: async () => removed ? 0 : 1, nth: () => row }
      : { count: async () => 0 }
  };

  assert.equal(await removeFailedUploadItems(dialog, { timeoutMs: 1000, logger: () => {} }), 1);
  assert.equal(removed, true);
});

test('removeFailedUploadItems finds the direct delete button after stopping and reopening the browser page', async () => {
  let removed = false;
  const retryButton = {
    isVisible: async () => true,
    innerText: async () => '',
    getAttribute: async (name) => name === 'class' ? 'refresh-button cc-creative-sdk-veui-button' : null,
    click: async () => { throw new Error('retry must not be clicked'); }
  };
  const deleteButton = {
    isVisible: async () => true,
    innerText: async () => '',
    getAttribute: async () => 'cc-creative-sdk-veui-button',
    click: async () => { removed = true; }
  };
  const panel = {
    locator: (selector) => selector.includes('cc-creative-sdk-veui-button:not(.refresh-button)')
      ? { count: async () => 1, nth: () => deleteButton }
      : { count: async () => 0 }
  };
  const row = {
    isVisible: async () => true,
    scrollIntoViewIfNeeded: async () => {},
    innerText: async () => '视频.mp4\n重复上传视频',
    getAttribute: async (name) => name === 'class' ? 'video-box' : null,
    locator: (selector) => selector.startsWith('xpath=ancestor')
      ? { first: () => panel }
      : { count: async () => 0 }
  };
  const dialog = {
    locator: (selector) => selector.startsWith('.video-box,')
      ? { count: async () => removed ? 0 : 1, nth: () => row }
      : { count: async () => 0 }
  };

  assert.equal(await removeFailedUploadItems(dialog, { timeoutMs: 1000, logger: () => {} }), 1);
  assert.equal(removed, true);
});

/* REMOVED_BY_ROLLBACK
test('removeFailedUploadItems finds an unlabelled delete control on the video-box-panel itself', async () => {
  let removed = false;
  const retryButton = {
    isVisible: async () => true,
    innerText: async () => '',
    getAttribute: async (name) => name === 'class' ? 'refresh-button cc-creative-sdk-veui-button' : null,
    click: async () => { throw new Error('retry must not be clicked'); }
  };
  const deleteButton = {
    isVisible: async () => true,
    innerText: async () => '',
    getAttribute: async (name) => name === 'class' ? 'cc-creative-sdk-veui-button' : null,
    click: async () => { removed = true; }
  };
  const panel = {
    locator: (selector) => {
      // The real failed row is .video-box; its parent is .video-box-panel.
      // The panel itself must be queried for its direct role buttons.
      if (!selector.includes(':scope >')) return { count: async () => 0 };
      if (selector.includes('[role="button"].cc-creative-sdk-veui-button:not(.refresh-button)')) {
        return { count: async () => 1, nth: () => deleteButton };
      }
      return { count: async () => 0 };
    }
  };
  const row = {
    isVisible: async () => true,
    scrollIntoViewIfNeeded: async () => {},
    innerText: async () => '视频.mp4\n重复上传视频',
    getAttribute: async (name) => name === 'class' ? 'video-box' : null,
    locator: (selector) => selector.startsWith('xpath=ancestor')
      ? { first: () => panel }
      : { count: async () => 0 }
  };
  const dialog = {
    locator: (selector) => selector.includes('video-box')
      ? { count: async () => removed ? 0 : 1, nth: () => row }
      : { count: async () => 0 }
  };

  assert.equal(await removeFailedUploadItems(dialog, { timeoutMs: 1000, logger: () => {} }), 1);
  assert.equal(removed, true);
});
*/

/* REMOVED_BY_ROLLBACK
test('uploadBatches confirms when failed items are removed but a successful item remains', async () => {
  const actions = [];
  let failedPresent = true;
  const input = {
    count: async () => 1,
    waitFor: async () => {},
    setInputFiles: async (files) => actions.push(['files', files])
  };
  input.first = () => input;
  const plus = {
    count: async () => 1,
    isVisible: async () => true,
    innerText: async () => '+',
    getAttribute: async () => null,
    scrollIntoViewIfNeeded: async () => {},
    click: async () => actions.push('plus')
  };
  plus.first = () => plus;
  const confirm = {
    count: async () => 1,
    isVisible: async () => true,
    isEnabled: async () => true,
    innerText: async () => '确定',
    click: async () => actions.push('confirm')
  };
  confirm.first = () => confirm;
  const deleteButton = {
    isVisible: async () => true,
    innerText: async () => '',
    getAttribute: async (name) => name === 'class' ? 'cc-creative-sdk-veui-button' : null,
    click: async () => { failedPresent = false; actions.push('delete'); }
  };
  const failedRow = {
    isVisible: async () => true,
    scrollIntoViewIfNeeded: async () => {},
    innerText: async () => '失败.mp4\n重复上传视频',
    getAttribute: async (name) => name === 'class' ? 'video-box upload-error' : null,
    locator: (selector) => selector.includes(':scope >')
      ? { count: async () => 1, nth: () => deleteButton }
      : { count: async () => 0 }
  };
  const successRow = {
    isVisible: async () => true,
    innerText: async () => '成功.mp4',
    getAttribute: async (name) => name === 'class' ? 'cc-creative-video-upload-item' : null,
    locator: (selector) => selector === '.video-box-panel'
      ? { count: async () => 1 }
      : { count: async () => 0 }
  };
  const dialog = {
    locator(selector) {
      if (selector.startsWith('.video-box,')) {
        return { count: async () => failedPresent ? 1 : 0, nth: () => failedRow };
      }
      if (selector.includes('cc-creative-video-upload-item')) {
        return {
          count: async () => 2,
          nth: (index) => index === 0 && failedPresent ? failedRow : successRow
        };
      }
      if (selector.includes('.video-box')) return plus;
      if (selector === 'input[type="file"]') return input;
      return { count: async () => 0, first() { return this; } };
    },
    getByRole(role, options) {
      return role === 'button' && /确定/.test(options.name) ? confirm : { count: async () => 0 };
    }
  };
  const page = {
    locator(selector) {
      if (selector.includes('[role="dialog"]')) return { filter: () => ({ first: () => dialog }) };
      return { innerText: async () => '' };
    },
    waitForEvent: async () => ({ setFiles: async () => {} }),
    waitForTimeout: async () => {}
  };

  const result = await uploadBatches(page, [[{ path: 'video.mp4' }]], {
    minWaitMs: 0,
    stableMs: 0,
    autoConfirm: true,
    removeFailedItems: true,
    logger: () => {}
  });
  assert.deepEqual(actions, ['plus', 'delete', 'confirm']);
  assert.equal(result.removedFailedItems, 1);
  assert.equal(result.confirmed, true);
});

*/

/* REMOVED_BY_ROLLBACK
test('removeFailedUploadItems processes one outer upload item instead of nested video-box duplicates', async () => {
  let deleteClicks = 0;
  let failedPresent = true;
  const deleteButton = {
    isVisible: async () => true,
    innerText: async () => '',
    getAttribute: async (name) => name === 'class' ? 'cc-creative-sdk-veui-button' : null,
    click: async () => { deleteClicks += 1; failedPresent = false; }
  };
  const panel = {
    locator: (selector) => selector.includes(':scope >')
      ? { count: async () => 1, nth: () => deleteButton }
      : { count: async () => 0 }
  };
  const outerItem = {
    isVisible: async () => true,
    scrollIntoViewIfNeeded: async () => {},
    innerText: async () => '失败.mp4\n重复上传视频',
    getAttribute: async (name) => name === 'class' ? 'cc-creative-video-upload-item' : null,
    locator: (selector) => selector.startsWith('xpath=ancestor')
      ? { first: () => panel }
      : { count: async () => 0 }
  };
  const nestedVideoBox = {
    isVisible: async () => true,
    innerText: async () => '重复上传视频',
    getAttribute: async (name) => name === 'class' ? 'video-box' : null,
    locator: () => ({ count: async () => 0 })
  };
  const dialog = {
    locator: (selector) => {
      if (selector.startsWith('.cc-creative-video-upload-item')) {
        return { count: async () => failedPresent ? 1 : 0, nth: () => outerItem };
      }
      if (selector.startsWith('.video-box,')) {
        return { count: async () => failedPresent ? 2 : 0, nth: (index) => index === 0 ? outerItem : nestedVideoBox };
      }
      if (selector.includes('.video-box')) {
        return { count: async () => failedPresent ? 1 : 0, nth: () => nestedVideoBox };
      }
      return { count: async () => 0 };
    }
  };

  assert.equal(await removeFailedUploadItems(dialog, { timeoutMs: 1000, logger: () => {} }), 1);
  assert.equal(deleteClicks, 1);
});

*/

/* REMOVED_BY_ROLLBACK
test('removeFailedUploadItems accepts a direct unlabelled role button without SDK class', async () => {
  let removed = false;
  const deleteButton = {
    isVisible: async () => true,
    innerText: async () => '',
    getAttribute: async (name) => name === 'class' ? '' : null,
    click: async () => { removed = true; }
  };
  const panel = {
    locator: (selector) => selector.includes('cc-creative-sdk-veui-button')
      ? { count: async () => 0 }
      : selector.includes(':not(.refresh-button)')
      ? { count: async () => 1, nth: () => deleteButton }
      : { count: async () => 0 }
  };
  const row = {
    isVisible: async () => true,
    scrollIntoViewIfNeeded: async () => {},
    innerText: async () => '失败.mp4\n重复上传视频',
    getAttribute: async (name) => name === 'class' ? 'cc-creative-video-upload-item' : null,
    locator: (selector) => selector.startsWith('xpath=ancestor')
      ? { first: () => panel }
      : { count: async () => 0 }
  };
  const dialog = {
    locator: (selector) => selector.includes('cc-creative-video-upload-item')
      ? { count: async () => removed ? 0 : 1, nth: () => row }
      : { count: async () => 0 }
  };

  assert.equal(await removeFailedUploadItems(dialog, { timeoutMs: 1000, logger: () => {} }), 1);
  assert.equal(removed, true);
});
*/

test('uploadBatches clicks a visible enabled confirm button after batches settle when requested', async () => {
  const actions = [];
  const input = { count: async () => 1, waitFor: async () => {}, setInputFiles: async (files) => actions.push(['files', files]) };
  input.first = () => input;
  const plus = {
    count: async () => 1,
    isVisible: async () => true,
    innerText: async () => '+',
    getAttribute: async () => null,
    scrollIntoViewIfNeeded: async () => {},
    click: async () => actions.push('plus')
  };
  plus.first = () => plus;
  const confirm = {
    count: async () => 1,
    isVisible: async () => true,
    isEnabled: async () => true,
    innerText: async () => '确定',
    click: async () => actions.push('confirm')
  };
  confirm.first = () => confirm;
  const dialog = {
    locator(selector) {
      if (selector.includes('.video-box')) return plus;
      if (selector === 'input[type="file"]') return input;
      return { count: async () => 0, first() { return this; } };
    },
    getByRole(role, options) {
      return role === 'button' && /确定/.test(options.name) ? confirm : { count: async () => 0 };
    }
  };
  const chooser = { setFiles: async (files) => actions.push(['chooser', files]) };
  const page = {
    locator(selector) {
      if (selector.includes('[role="dialog"]')) return { filter: () => ({ first: () => dialog }) };
      return { innerText: async () => '' };
    },
    waitForEvent: async () => chooser,
    waitForTimeout: async () => {}
  };

  const result = await uploadBatches(page, [[{ path: 'video.mp4' }]], {
    minWaitMs: 0,
    stableMs: 0,
    autoConfirm: true,
    logger: () => {}
  });
  assert.deepEqual(actions, ['plus', ['chooser', ['video.mp4']], 'confirm']);
  assert.equal(result.confirmed, true);
  assert.equal(result.awaitingConfirmation, false);
});

test('uploadBatches confirms after removing the failed items when auto confirmation is enabled', async () => {
  const actions = [];
  let failedPresent = true;
  const input = {
    count: async () => 1,
    waitFor: async () => {},
    click: async () => actions.push('input-click'),
    setInputFiles: async () => {}
  };
  input.first = () => input;
  const plus = {
    count: async () => 1,
    isVisible: async () => true,
    innerText: async () => '+',
    getAttribute: async () => null,
    scrollIntoViewIfNeeded: async () => {},
    click: async () => actions.push('plus')
  };
  plus.first = () => plus;
  const confirm = {
    count: async () => 1,
    isVisible: async () => true,
    isEnabled: async () => true,
    innerText: async () => '确定',
    click: async () => actions.push('confirm')
  };
  confirm.first = () => confirm;
  const deleteButton = {
    isVisible: async () => true,
    innerText: async () => '',
    getAttribute: async (name) => name === 'class' ? 'cc-creative-sdk-veui-button' : null,
    click: async () => { failedPresent = false; actions.push('delete'); }
  };
  const failedRow = {
    isVisible: async () => true,
    scrollIntoViewIfNeeded: async () => {},
    innerText: async () => '失败.mp4\n重复上传视频',
    getAttribute: async (name) => name === 'class' ? 'video-box upload-error' : null,
    locator: () => ({ count: async () => 1, nth: () => deleteButton })
  };
  const dialog = {
    locator(selector) {
      if (selector.startsWith('.video-box,')) return { count: async () => failedPresent ? 1 : 0, nth: () => failedRow };
      if (selector.includes('.video-box')) return plus;
      if (selector === 'input[type="file"]') return input;
      return { count: async () => 0, first() { return this; } };
    },
    getByRole(role, options) {
      return role === 'button' && /确定/.test(options.name) ? confirm : { count: async () => 0 };
    }
  };
  const page = {
    locator(selector) {
      if (selector.includes('[role="dialog"]')) return { filter: () => ({ first: () => dialog }) };
      return { innerText: async () => '' };
    },
    waitForEvent: async () => ({ setFiles: async () => {} }),
    waitForTimeout: async () => {}
  };

  const result = await uploadBatches(page, [[{ path: 'failed.mp4' }]], {
    minWaitMs: 0,
    stableMs: 0,
    autoConfirm: true,
    removeFailedItems: true,
    logger: () => {}
  });
  assert.deepEqual(actions, ['plus', 'delete', 'confirm']);
  assert.equal(result.removedFailedItems, 1);
  assert.equal(result.confirmed, true);
});

test('uploadBatches waits for the confirm button to become enabled after loading settles', async () => {
  const actions = [];
  let enabledChecks = 0;
  const input = { count: async () => 1, waitFor: async () => {}, setInputFiles: async () => {} };
  input.first = () => input;
  const plus = {
    count: async () => 1,
    isVisible: async () => true,
    innerText: async () => '+',
    getAttribute: async () => null,
    scrollIntoViewIfNeeded: async () => {},
    click: async () => {}
  };
  plus.first = () => plus;
  const confirm = {
    count: async () => 1,
    isVisible: async () => true,
    isEnabled: async () => ++enabledChecks >= 2,
    innerText: async () => '确定',
    click: async () => actions.push('confirm')
  };
  confirm.first = () => confirm;
  const dialog = {
    locator(selector) {
      if (selector.includes('.video-box')) return plus;
      if (selector === 'input[type="file"]') return input;
      return { count: async () => 0, first() { return this; } };
    },
    getByRole(role, options) {
      return role === 'button' && /确定/.test(options.name) ? confirm : { count: async () => 0 };
    }
  };
  const page = {
    locator(selector) {
      if (selector.includes('[role="dialog"]')) return { filter: () => ({ first: () => dialog }) };
      return { innerText: async () => '' };
    },
    waitForEvent: async () => ({ setFiles: async () => {} }),
    waitForTimeout: async () => {}
  };

  const result = await uploadBatches(page, [[{ path: 'video.mp4' }]], {
    minWaitMs: 0,
    stableMs: 0,
    confirmTimeoutMs: 100,
    confirmPollMs: 0,
    autoConfirm: true,
    logger: () => {}
  });
  assert.deepEqual(actions, ['confirm']);
  assert.equal(result.confirmed, true);
  assert.equal(enabledChecks, 2);
});

test('uploadBatches fails instead of clicking a disabled confirm button', async () => {
  let clicked = false;
  const input = { count: async () => 1, waitFor: async () => {}, setInputFiles: async () => {} };
  input.first = () => input;
  const plus = {
    count: async () => 1,
    isVisible: async () => true,
    innerText: async () => '+',
    getAttribute: async () => null,
    scrollIntoViewIfNeeded: async () => {},
    click: async () => {}
  };
  plus.first = () => plus;
  const confirm = {
    count: async () => 1,
    isVisible: async () => true,
    isEnabled: async () => false,
    innerText: async () => '确定',
    click: async () => { clicked = true; }
  };
  confirm.first = () => confirm;
  const dialog = {
    locator(selector) {
      if (selector.includes('.video-box')) return plus;
      if (selector === 'input[type="file"]') return input;
      return { count: async () => 0, first() { return this; } };
    },
    getByRole(role, options) {
      return role === 'button' && /确定/.test(options.name) ? confirm : { count: async () => 0 };
    }
  };
  const page = {
    locator(selector) {
      if (selector.includes('[role="dialog"]')) return { filter: () => ({ first: () => dialog }) };
      return { innerText: async () => '' };
    },
    waitForEvent: async () => ({ setFiles: async () => {} }),
    waitForTimeout: async () => {}
  };

  await assert.rejects(
    () => uploadBatches(page, [[{ path: 'video.mp4' }]], {
      minWaitMs: 0,
      stableMs: 0,
      confirmTimeoutMs: 10,
      autoConfirm: true,
      logger: () => {}
    }),
    /等待“确定”按钮可用/
  );
  assert.equal(clicked, false);
});

test('uploadBatches does not confirm when the upload page reports a failure', async () => {
  let confirmed = false;
  const input = { count: async () => 1, waitFor: async () => {}, setInputFiles: async () => {} };
  input.first = () => input;
  const plus = {
    count: async () => 1,
    isVisible: async () => true,
    innerText: async () => '+',
    getAttribute: async () => null,
    scrollIntoViewIfNeeded: async () => {},
    click: async () => {}
  };
  plus.first = () => plus;
  const confirm = {
    count: async () => 1,
    isVisible: async () => true,
    isEnabled: async () => true,
    innerText: async () => '确定',
    click: async () => { confirmed = true; }
  };
  confirm.first = () => confirm;
  const dialog = {
    locator(selector) {
      if (selector.includes('.video-box')) return plus;
      if (selector === 'input[type="file"]') return input;
      return { count: async () => 0, first() { return this; } };
    },
    getByRole: () => confirm
  };
  const page = {
    locator(selector) {
      if (selector.includes('[role="dialog"]')) return { filter: () => ({ first: () => dialog }) };
      return { innerText: async () => '上传失败' };
    },
    waitForEvent: async () => ({ setFiles: async () => {} }),
    waitForTimeout: async () => {}
  };

  await assert.rejects(
    () => uploadBatches(page, [[{ path: 'video.mp4' }]], {
      minWaitMs: 0,
      stableMs: 0,
      autoConfirm: true,
      logger: () => {}
    }),
    /页面报告本批次上传失败/
  );
  assert.equal(confirmed, false);
});

test('uploadBatches re-resolves the file control when the upload panel is re-rendered', async () => {
  const submitted = [];
  let lookupCount = 0;
  const staleInput = {
    async count() { return 1; },
    async waitFor() { throw new Error('detached during re-render'); },
    async setInputFiles() { throw new Error('stale input must not be used'); }
  };
  staleInput.first = () => staleInput;
  const currentInput = {
    async count() { return 1; },
    async waitFor() {},
    async setInputFiles(files) { submitted.push(files); }
  };
  currentInput.first = () => currentInput;
  const staleDialog = { async waitFor() {}, locator: () => staleInput };
  const currentDialog = { async waitFor() {}, locator: () => currentInput };
  const page = {
    locator(selector) {
      if (selector.includes('[role="dialog"]')) {
        return { filter: () => ({ first: () => lookupCount++ === 0 ? staleDialog : currentDialog }) };
      }
      return { innerText: async () => '' };
    },
    getByText() { return { click: async () => {} }; },
    async waitForTimeout() {}
  };

  const result = await uploadBatches(page, [[{ path: 'video.mp4' }]], {
    minWaitMs: 0,
    stableMs: 0,
    logger: () => {}
  });
  assert.deepEqual(submitted, [['video.mp4']]);
  assert.equal(result.fileCount, 1);
});

test('uploadBatches uses a page-level file input when the upload modal does not contain it', async () => {
  const submitted = [];
  const pageInput = {
    async count() { return 1; },
    async waitFor() {},
    async setInputFiles(files) { submitted.push(files); }
  };
  pageInput.first = () => pageInput;
  const dialog = {
    async waitFor() {},
    locator: () => ({ count: async () => 0, first() { return this; } })
  };
  const page = {
    locator(selector) {
      if (selector.includes('[role="dialog"]')) return { filter: () => ({ first: () => dialog }) };
      if (selector === 'input[type="file"]') return pageInput;
      return { innerText: async () => '' };
    },
    getByText() { return { count: async () => 0 }; },
    async waitForTimeout() {}
  };

  await uploadBatches(page, [[{ path: 'video.mp4' }]], { minWaitMs: 0, stableMs: 0, logger: () => {} });
  assert.deepEqual(submitted, [['video.mp4']]);
});

test('selectBatchFiles activates the plus file control and supplies the batch paths', async () => {
  const actions = [];
  const chooser = { setFiles: async (files) => actions.push(['files', files]) };
  const input = {
    count: async () => 1,
    click: async ({ force }) => actions.push(['plus', force])
  };
  const dialog = { locator: () => ({ first: () => input }) };
  const page = { waitForEvent: async (event) => { actions.push(['wait', event]); return chooser; } };

  await selectBatchFiles(page, dialog, ['a.mp4', 'b.mp4']);
  assert.deepEqual(actions, [
    ['wait', 'filechooser'],
    ['plus', true],
    ['files', ['a.mp4', 'b.mp4']]
  ]);
});

test('selectBatchFiles clicks the upload plus before waiting for a dynamically created file chooser', async () => {
  const actions = [];
  const chooser = { setFiles: async (files) => actions.push(['files', files]) };
  const plus = {
    count: async () => 1,
    scrollIntoViewIfNeeded: async () => actions.push(['scroll-plus']),
    click: async ({ force }) => actions.push(['plus', force])
  };
  const dialog = {
    locator: (selector) => selector.includes('.video-box')
      ? { first: () => plus }
      : { count: async () => 0, first() { return this; } }
  };
  const page = {
    waitForEvent: async (event) => { actions.push(['wait', event]); return chooser; },
    waitForTimeout: async () => new Promise((resolve) => setTimeout(resolve, 1))
  };

  await selectBatchFiles(page, dialog, ['a.mp4']);
  assert.deepEqual(actions, [['scroll-plus'], ['wait', 'filechooser'], ['plus', true], ['files', ['a.mp4']]]);
});

test('selectBatchFiles falls back to the visible plus text in the batch upload panel', async () => {
  const actions = [];
  const chooser = { setFiles: async (files) => actions.push(['files', files]) };
  const plus = {
    count: async () => 1,
    isVisible: async () => true,
    innerText: async () => '+',
    getAttribute: async () => null,
    scrollIntoViewIfNeeded: async () => {},
    click: async ({ force }) => actions.push(['plus', force])
  };
  const dialog = {
    locator: () => ({ count: async () => 0, first() { return this; } }),
    getByText: (text) => text === '+' ? { count: async () => 1, nth: () => plus } : { count: async () => 0 }
  };
  const page = {
    waitForEvent: async () => chooser,
    waitForTimeout: async () => {}
  };

  await selectBatchFiles(page, dialog, ['a.mp4']);
  assert.deepEqual(actions, [['plus', true], ['files', ['a.mp4']]]);
});

test('selectBatchFiles uses a locator click so Playwright can capture the file chooser', async () => {
  const actions = [];
  const chooser = { setFiles: async (files) => actions.push(['files', files]) };
  const plus = {
    count: async () => 1,
    isVisible: async () => true,
    scrollIntoViewIfNeeded: async () => {},
    evaluate: async () => ({ x: 18, y: 22 }),
    click: async () => actions.push(['locator-click'])
  };
  const dialog = {
    locator: (selector) => selector.includes('.video-box')
      ? { count: async () => 1, nth: () => plus }
      : { count: async () => 0, first() { return this; } }
  };
  const page = {
    mouse: { click: async (x, y) => actions.push(['mouse-click', x, y]) },
    waitForEvent: async () => chooser
  };

  await selectBatchFiles(page, dialog, ['a.mp4']);
  assert.deepEqual(actions, [['locator-click'], ['files', ['a.mp4']]]);
});

test('selectBatchFiles re-finds the upload panel and scrolls to its new plus after a batch re-render', async () => {
  const actions = [];
  const empty = { count: async () => 0, first() { return this; } };
  const staleDialog = { locator: () => empty };
  const chooser = { setFiles: async (files) => actions.push(['files', files]) };
  const nextPlus = {
    count: async () => 1,
    isVisible: async () => true,
    scrollIntoViewIfNeeded: async () => actions.push('scroll-next-plus'),
    click: async ({ force }) => actions.push(['next-plus', force])
  };
  const nextDialog = {
    count: async () => 1,
    isVisible: async () => true,
    locator: (selector) => selector.includes('.video-box')
      ? { count: async () => 1, nth: () => nextPlus, first: () => nextPlus }
      : empty
  };
  const page = {
    locator: (selector) => selector.includes('[role="dialog"]')
      ? { filter: () => ({ first: () => nextDialog }) }
      : empty,
    getByText: () => ({ count: async () => 0 }),
    waitForEvent: async () => chooser,
    waitForTimeout: async () => new Promise((resolve) => setTimeout(resolve, 1))
  };

  await selectBatchFiles(page, staleDialog, ['remaining.mp4'], { timeoutMs: 20 });
  assert.deepEqual(actions, [
    'scroll-next-plus',
    ['next-plus', true],
    ['files', ['remaining.mp4']]
  ]);
});

test('selectBatchFiles ignores existing video controls and clicks the append plus', async () => {
  const actions = [];
  const chooser = { setFiles: async (files) => actions.push(['files', files]) };
  const existingVideo = {
    isVisible: async () => true,
    innerText: async () => '已选视频',
    getAttribute: async () => null,
    scrollIntoViewIfNeeded: async () => actions.push('scroll-existing'),
    click: async () => actions.push('click-existing')
  };
  const appendPlus = {
    isVisible: async () => true,
    innerText: async () => '+',
    getAttribute: async () => null,
    scrollIntoViewIfNeeded: async () => actions.push('scroll-append-plus'),
    click: async ({ force }) => actions.push(['click-append-plus', force])
  };
  const candidates = {
    count: async () => 2,
    nth: (index) => [existingVideo, appendPlus][index]
  };
  const empty = { count: async () => 0, first() { return this; } };
  const dialog = {
    locator: (selector) => selector.includes('.video-box') ? candidates : empty
  };
  const page = {
    waitForEvent: async () => chooser,
    waitForTimeout: async () => {}
  };

  await selectBatchFiles(page, dialog, ['next.mp4']);
  assert.deepEqual(actions, [
    'scroll-append-plus',
    ['click-append-plus', true],
    ['files', ['next.mp4']]
  ]);
});

test('selectBatchFiles uses the first plus associated file input without opening a native picker', async () => {
  const actions = [];
  const appendInput = {
    count: async () => 1,
    setInputFiles: async (files) => actions.push(['append-files', files])
  };
  const plus = {
    count: async () => 1,
    isVisible: async () => true,
    innerText: async () => '+',
    getAttribute: async () => null,
    scrollIntoViewIfNeeded: async () => actions.push('scroll-plus'),
    click: async () => actions.push('click-plus'),
    locator: (selector) => selector.includes('input[type="file"]') ? appendInput : { count: async () => 0 }
  };
  const candidates = { count: async () => 1, nth: () => plus };
  const dialog = {
    locator: (selector) => selector.includes('.video-box') ? candidates : { count: async () => 0, first() { return this; } }
  };
  const page = {
    waitForEvent: async () => { throw new Error('native picker should not be opened'); },
    waitForTimeout: async () => {}
  };

  await selectBatchFiles(page, dialog, ['third.mp4']);
  assert.deepEqual(actions, ['scroll-plus', ['append-files', ['third.mp4']]]);
});

test('selectBatchFiles does not overwrite an existing batch through an associated input when appending', async () => {
  const actions = [];
  const chooser = { setFiles: async (files) => actions.push(['chooser-files', files]) };
  const appendInput = {
    count: async () => 1,
    setInputFiles: async (files) => actions.push(['append-files', files])
  };
  const plus = {
    count: async () => 1,
    isVisible: async () => true,
    innerText: async () => '+',
    getAttribute: async () => null,
    scrollIntoViewIfNeeded: async () => actions.push('scroll-plus'),
    click: async ({ force }) => actions.push(['click-plus', force]),
    locator: (selector) => selector.includes('input[type="file"]') ? appendInput : { count: async () => 0 }
  };
  const candidates = { count: async () => 1, nth: () => plus };
  const dialog = {
    locator: (selector) => selector.includes('.video-box') ? candidates : { count: async () => 0, first() { return this; } }
  };
  const page = { waitForEvent: async () => chooser, waitForTimeout: async () => {} };

  await selectBatchFiles(page, dialog, ['fourth.mp4'], { requirePlus: true });
  assert.deepEqual(actions, ['scroll-plus', ['click-plus', true], ['chooser-files', ['fourth.mp4']]]);
});

test('selectBatchFiles never overwrites an existing batch through a file input when a plus is required', async () => {
  const selected = [];
  const empty = { count: async () => 0, first() { return this; } };
  const input = {
    count: async () => 1,
    click: async () => selected.push('input-click'),
    setInputFiles: async (files) => selected.push(files)
  };
  const dialog = {
    locator: (selector) => selector === 'input[type="file"]' ? input : empty
  };
  const page = {
    locator: (selector) => selector === 'input[type="file"]'
      ? input
      : { filter: () => ({ first: () => empty }) },
    getByText: () => ({ count: async () => 0 }),
    waitForTimeout: async () => new Promise((resolve) => setTimeout(resolve, 1))
  };

  await assert.rejects(
    () => selectBatchFiles(page, dialog, ['second-batch.mp4'], { timeoutMs: 20, requirePlus: true }),
    /必须通过上传面板加号追加/
  );
  assert.deepEqual(selected, []);
});

test('selectBatchFiles stops after one append-plus click when no file chooser is emitted', async () => {
  const actions = [];
  const plus = {
    count: async () => 1,
    isVisible: async () => true,
    scrollIntoViewIfNeeded: async () => {},
    click: async () => actions.push('click-plus')
  };
  const dialog = {
    locator: (selector) => selector.includes('.video-box')
      ? { count: async () => 1, nth: () => plus }
      : { count: async () => 0, first() { return this; } }
  };
  const page = {
    waitForEvent: async () => { throw new Error('file chooser did not open'); },
    waitForTimeout: async () => new Promise((resolve) => setTimeout(resolve, 1))
  };

  await assert.rejects(
    () => selectBatchFiles(page, dialog, ['next.mp4'], { timeoutMs: 20, requirePlus: true }),
    /点击上传面板加号后未收到文件选择事件/
  );
  assert.deepEqual(actions, ['click-plus']);
});

test('selectBatchFiles clicks the upload card when the inner plus node is not file-chooser clickable', async () => {
  const actions = [];
  const chooser = { setFiles: async (files) => actions.push(['files', files]) };
  const uploadCard = {
    count: async () => 1,
    isVisible: async () => true,
    scrollIntoViewIfNeeded: async () => {},
    click: async ({ force }) => actions.push(['click-card', force])
  };
  const plusIcon = {
    count: async () => 1,
    isVisible: async () => true,
    innerText: async () => '',
    getAttribute: async () => null,
    scrollIntoViewIfNeeded: async () => {},
    click: async () => { throw new Error('inner SVG is not file-chooser clickable'); },
    locator: (selector) => selector.includes('input[type="file"]')
      ? { count: async () => 0 }
      : selector.includes('ancestor::*') ? uploadCard : { count: async () => 0 }
  };
  const candidates = { count: async () => 1, nth: () => plusIcon };
  const empty = { count: async () => 0, first() { return this; } };
  const dialog = {
    locator: (selector) => selector.includes('.video-box') ? candidates : empty
  };
  const page = {
    waitForEvent: async () => chooser,
    waitForTimeout: async () => {}
  };

  await selectBatchFiles(page, dialog, ['next.mp4'], { requirePlus: true, timeoutMs: 20 });
  assert.deepEqual(actions, [['click-card', true], ['files', ['next.mp4']]]);
});

test('selectBatchFiles uses a newly mounted input when append plus opens it asynchronously', async () => {
  const actions = [];
  let inputMounted = false;
  const appendInput = {
    count: async () => inputMounted ? 1 : 0,
    setInputFiles: async (files) => actions.push(['append-files', files])
  };
  const plus = {
    count: async () => 1,
    isVisible: async () => true,
    innerText: async () => '+',
    getAttribute: async () => null,
    scrollIntoViewIfNeeded: async () => {},
    click: async () => { inputMounted = true; actions.push('click-plus'); },
    locator: (selector) => selector.includes('input[type="file"]') ? appendInput : { count: async () => 0 }
  };
  const candidates = { count: async () => 1, nth: () => plus };
  const empty = { count: async () => 0, first() { return this; } };
  const dialog = {
    locator: (selector) => selector.includes('.video-box') ? candidates : empty
  };
  const page = {
    locator: (selector) => selector === 'input[type="file"]' ? appendInput : empty,
    waitForEvent: async () => { throw new Error('chooser is mounted asynchronously'); },
    waitForTimeout: async () => {}
  };

  await selectBatchFiles(page, dialog, ['next.mp4'], { requirePlus: true, timeoutMs: 20 });
  assert.deepEqual(actions, ['click-plus', ['append-files', ['next.mp4']]]);
});

test('selectBatchFiles accepts a newly mounted page-level input for append plus', async () => {
  const actions = [];
  let inputMounted = false;
  const pageInput = {
    count: async () => inputMounted ? 1 : 0,
    setInputFiles: async (files) => actions.push(['page-files', files])
  };
  const plus = {
    count: async () => 1,
    isVisible: async () => true,
    innerText: async () => '+',
    getAttribute: async () => null,
    scrollIntoViewIfNeeded: async () => {},
    click: async () => { inputMounted = true; actions.push('click-plus'); },
    locator: () => ({ count: async () => 0 })
  };
  const candidates = { count: async () => 1, nth: () => plus };
  const empty = { count: async () => 0, first() { return this; } };
  const dialog = { locator: (selector) => selector.includes('.video-box') ? candidates : empty };
  const page = {
    locator: (selector) => selector === 'input[type="file"]' ? pageInput : empty,
    waitForEvent: async () => { throw new Error('chooser is mounted asynchronously'); },
    waitForTimeout: async () => {}
  };

  await selectBatchFiles(page, dialog, ['next.mp4'], { requirePlus: true, timeoutMs: 20 });
  assert.deepEqual(actions, ['click-plus', ['page-files', ['next.mp4']]]);
});

test('parseArgs selects Google Chrome by default and accepts an explicit path', () => {
  assert.equal(parseArgs(['--folder', 'D:/videos']).chromeChannel, 'chrome');
  assert.equal(parseArgs(['--chrome-path', 'C:/Chrome/chrome.exe']).chromePath, 'C:/Chrome/chrome.exe');
  assert.equal(parseArgs(['--folder', 'D:/videos']).accountId, DEFAULT_ACCOUNT_ID);
  assert.equal(DEFAULT_ACCOUNT_NAME, 'baidu-nt-恰青春普化21');
  assert.equal(parseArgs(['--account-id', '123']).accountId, '123');
  assert.equal(parseArgs(['--direct']).homepage, false);
});
