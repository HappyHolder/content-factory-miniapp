import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseActivity, intensityWindow } from './activityDirector';

const base={energy:'silent' as const,tension:false,openQuestions:false,participants:0,messages:0};
test('content release has priority over generic activity',()=>assert.equal(chooseActivity({enabled:['POLL','CONTENT_RELEASE'],history:[],pulse:{...base,publishedPost:true}}),'CONTENT_RELEASE'));
test('director does nothing while chat is active',()=>assert.equal(chooseActivity({enabled:['DISCUSSION','POLL'],history:[],pulse:{...base,energy:'active'}}),null));
test('director rotates away from recent polls',()=>assert.equal(chooseActivity({enabled:['POLL','QUIZ','LIGHT'],history:[{type:'POLL'}],pulse:base}),'QUIZ'));
test('reward activities are never selected automatically',()=>assert.equal(chooseActivity({enabled:['CONTEST','CHALLENGE'],history:[],pulse:base}),null));
test('balanced defaults need no minute-by-minute setup',()=>assert.deepEqual(intensityWindow('balanced'),{min:75,max:180,maxWeek:5}));
