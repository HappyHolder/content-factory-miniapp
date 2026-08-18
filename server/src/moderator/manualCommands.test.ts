import assert from 'node:assert/strict';
import test from 'node:test';
import { canHandleManualCommand } from './manualCommands.js';

test('ordinary members cannot consume command-looking messages', () => {
  assert.equal(canHandleManualCommand('member'), false);
  assert.equal(canHandleManualCommand('restricted'), false);
  assert.equal(canHandleManualCommand(null), false);
});

test('administrators can use moderator commands', () => {
  assert.equal(canHandleManualCommand('administrator'), true);
  assert.equal(canHandleManualCommand('creator'), true);
});
