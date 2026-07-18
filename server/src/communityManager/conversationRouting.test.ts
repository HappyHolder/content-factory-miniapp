import test from 'node:test';
import assert from 'node:assert/strict';
import { communityManagerUpdateKey, isProductContinuation, sameReplyBranch } from './conversationRouting';


test('namespaces Telegram update IDs by executor bot', () => {
    assert.equal(communityManagerUpdateKey(10, 77),'10:77');
    assert.notEqual(communityManagerUpdateKey(11,77),communityManagerUpdateKey(10,77));
  });

test('merges bursts only inside the same reply branch', () => {
    assert.equal(sameReplyBranch(null,undefined),true);
    assert.equal(sameReplyBranch(100,100),true);
    assert.equal(sameReplyBranch(100,101),false);
    assert.equal(sameReplyBranch(null,101),false);
  });

test('does not leak product context from another participant', () => {
    assert.equal(isProductContinuation({classifiedIntent:'conversation',classifiedRespond:true,sameParticipantRecentProduct:false,directlyAddressed:true}),false);
    assert.equal(isProductContinuation({classifiedIntent:'conversation',classifiedRespond:true,sameParticipantRecentProduct:true,directlyAddressed:true}),true);
    assert.equal(isProductContinuation({classifiedIntent:'conversation',classifiedRespond:true,repliedToIntent:'product_support',sameParticipantRecentProduct:false,directlyAddressed:false}),true);
  });
