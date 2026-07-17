import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CM_CONFIG, parseCommunityManagerConfig } from './config';
import { evolvePersonalState, evolveRelationshipState, personalityEngagementAdjustment } from './personalityState';

test('legacy configs receive a complete personality profile',()=>{
  const parsed=parseCommunityManagerConfig({...DEFAULT_CM_CONFIG,personality:undefined});
  assert.equal(parsed.personality.psychology.directness,'direct');
  assert.equal(parsed.personality.reactions.mistakes,'admits');
  assert.equal(parsed.personality.relationshipStyle.bonding,'normal');
});

test('conflict changes state and later repair lowers tension',()=>{
  const conflict=evolvePersonalState(undefined,DEFAULT_CM_CONFIG,{conflict:true});
  assert.ok(conflict.irritation>0.05);assert.ok(conflict.stress>0.15);
  const tense=evolveRelationshipState(undefined,DEFAULT_CM_CONFIG.personality.relationshipStyle,{exchange:true,conflict:true});
  const repaired=evolveRelationshipState(tense,DEFAULT_CM_CONFIG.personality.relationshipStyle,{repair:true});
  assert.ok(repaired.tension<tense.tension);assert.ok(repaired.emotionalSafety>tense.emotionalSafety);
});

test('outgoing personality is more willing to join without forcing direct replies',()=>{
  const outgoing={...DEFAULT_CM_CONFIG,personality:{...DEFAULT_CM_CONFIG.personality,psychology:{...DEFAULT_CM_CONFIG.personality.psychology,extraversion:'outgoing' as const}}};
  const reserved={...DEFAULT_CM_CONFIG,personality:{...DEFAULT_CM_CONFIG.personality,psychology:{...DEFAULT_CM_CONFIG.personality.psychology,extraversion:'reserved' as const}}};
  const state=evolvePersonalState(undefined,DEFAULT_CM_CONFIG,{});
  assert.ok(personalityEngagementAdjustment(outgoing,state)<personalityEngagementAdjustment(reserved,state));
});
