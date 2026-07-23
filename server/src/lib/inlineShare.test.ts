import assert from 'node:assert/strict';
import test from 'node:test';
import { createInlineShare, resolveInlineShare } from './inlineShare';

test('resolves an inline share only for its owner', () => {
  const result = { type: 'article', id: 'post' };
  const query = createInlineShare(42, result);

  assert.match(query, /^publium_[A-Za-z0-9_-]+$/);
  assert.equal(resolveInlineShare(query, 42), result);
  assert.equal(resolveInlineShare(query, 43), null);
  assert.equal(resolveInlineShare('publium_missing', 42), null);
});
