import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { buildRuntimePaths, shouldMigrateLegacyProfile } from '../src/runtime-paths.js';

test('buildRuntimePaths keeps mutable data under the per-user app data directory', () => {
  const paths = buildRuntimePaths({
    userDataPath: 'C:/Users/Alice/AppData/Roaming/Baidu Video Uploader',
    legacyRoot: 'D:/legacy-project'
  });

  assert.equal(paths.profileRoot, path.join('C:/Users/Alice/AppData/Roaming/Baidu Video Uploader', 'profiles'));
  assert.equal(paths.primaryProfile, path.join(paths.profileRoot, '.chrome-profile'));
  assert.equal(paths.accountProfile('83515948'), path.join(paths.profileRoot, '.chrome-profile-account-83515948'));
  assert.equal(paths.debugRoot, path.join('C:/Users/Alice/AppData/Roaming/Baidu Video Uploader', 'debug'));
  assert.equal(paths.legacyRoot, path.resolve('D:/legacy-project'));
});

test('legacy profile migration only applies when the new destination is absent', () => {
  assert.equal(shouldMigrateLegacyProfile({ legacyExists: true, targetExists: false }), true);
  assert.equal(shouldMigrateLegacyProfile({ legacyExists: false, targetExists: false }), false);
  assert.equal(shouldMigrateLegacyProfile({ legacyExists: true, targetExists: true }), false);
});
