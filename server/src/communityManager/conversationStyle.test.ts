import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeCommunityManagerPunctuation, sanitizeConversationReply } from './conversationStyle';

test('community manager uses short hyphens instead of typographic dashes',()=>{
  assert.equal(normalizeCommunityManagerPunctuation('Mat \u2014 ne tragediya. Na 1\u20133 minuty.'),'Mat - ne tragediya. Na 1-3 minuty.');
  assert.equal(sanitizeConversationReply('Eto mysl \u2014 no ne vyvod.',true),'Eto mysl - no ne vyvod.');
});

test('escaped model newlines become Telegram line breaks',()=>{
  assert.equal(normalizeCommunityManagerPunctuation('one\\ntwo'),'one\ntwo');
});
