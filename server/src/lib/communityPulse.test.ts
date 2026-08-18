import assert from 'node:assert/strict';
import test from 'node:test';
import { pulseClimateScore, pulseToxicityWeight } from './communityPulse.js';

test('deleted toxic messages lower climate without an intervention event', () => {
  const event = { eventType:'AI_MODERATION_TRIGGERED', action:'DELETE_REWRITE_NONE', decision:'insult', tgUserId:'1', metadata:{ category:'insult', severity:'medium', directed:true } };
  const weight = Array.from({length:8},()=>pulseToxicityWeight(event)).reduce((a,b)=>a+b,0);
  assert.ok(pulseClimateScore(16,weight) < 100);
});

test('harassment weighs more than ordinary spam', () => {
  const harassment = pulseToxicityWeight({ eventType:'AI_MODERATION_TRIGGERED', action:'DELETE', decision:'harassment', tgUserId:'1', metadata:{severity:'high'} });
  const spam = pulseToxicityWeight({ eventType:'AI_MODERATION_TRIGGERED', action:'DELETE', decision:'spam', tgUserId:'1', metadata:{severity:'medium'} });
  assert.ok(harassment > spam);
});
