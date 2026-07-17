import type { CommunityManagerConfigData, RelationshipStyle } from './config';

export type PersonalInnerState={valence:number;arousal:number;dominance:number;energy:number;stress:number;irritation:number;confidence:number;curiosity:number;activeGoal:string;updatedAt:string};
export type RelationshipState={familiarity:number;trust:number;closeness:number;respect:number;tension:number;reciprocity:number;emotionalSafety:number;updatedAt:string};
export type StoredInternalState={social?:unknown;personal:PersonalInnerState};

const clamp=(value:number,min=0,max=1)=>Math.max(min,Math.min(max,value));
const finite=(value:unknown,fallback:number)=>Number.isFinite(Number(value))?Number(value):fallback;
const round=(value:number)=>Math.round(clamp(value)*1000)/1000;

export const DEFAULT_PERSONAL_STATE:PersonalInnerState={valence:.1,arousal:.35,dominance:.55,energy:.7,stress:.15,irritation:.05,confidence:.65,curiosity:.7,activeGoal:'support a useful, natural community conversation',updatedAt:new Date(0).toISOString()};
export const DEFAULT_RELATIONSHIP_STATE:RelationshipState={familiarity:.05,trust:.45,closeness:.1,respect:.55,tension:0,reciprocity:.2,emotionalSafety:.5,updatedAt:new Date(0).toISOString()};

export function parsePersonalState(value:unknown):PersonalInnerState{
  const root=value&&typeof value==='object'?value as Record<string,unknown>:{},row=(root.personal&&typeof root.personal==='object'?root.personal:root) as Record<string,unknown>;
  return{valence:finite(row.valence,DEFAULT_PERSONAL_STATE.valence),arousal:finite(row.arousal,DEFAULT_PERSONAL_STATE.arousal),dominance:finite(row.dominance,DEFAULT_PERSONAL_STATE.dominance),energy:finite(row.energy,DEFAULT_PERSONAL_STATE.energy),stress:finite(row.stress,DEFAULT_PERSONAL_STATE.stress),irritation:finite(row.irritation,DEFAULT_PERSONAL_STATE.irritation),confidence:finite(row.confidence,DEFAULT_PERSONAL_STATE.confidence),curiosity:finite(row.curiosity,DEFAULT_PERSONAL_STATE.curiosity),activeGoal:typeof row.activeGoal==='string'?row.activeGoal.slice(0,180):DEFAULT_PERSONAL_STATE.activeGoal,updatedAt:typeof row.updatedAt==='string'&&Number.isFinite(Date.parse(row.updatedAt))?row.updatedAt:DEFAULT_PERSONAL_STATE.updatedAt};
}

export function evolvePersonalState(previous:unknown,config:CommunityManagerConfigData,event:{direct?:boolean;question?:boolean;positive?:boolean;conflict?:boolean;resolved?:boolean;silenceMinutes?:number}):PersonalInnerState{
  const old=parsePersonalState(previous),hours=Math.max(0,Math.min(72,(Date.now()-Date.parse(old.updatedAt))/3600_000)),decay=Math.exp(-hours/8),reactive=config.personality.psychology.emotionalReactivity==='hot'?1.35:config.personality.psychology.emotionalReactivity==='calm'?.65:1;
  let irritation=old.irritation*decay,stress=old.stress*Math.exp(-hours/12),valence=old.valence*Math.exp(-hours/18),arousal=.3+(old.arousal-.3)*decay,energy=clamp(old.energy-hours*.025,.25,1),confidence=old.confidence,curiosity=old.curiosity;
  if(event.conflict){irritation+=.2*reactive;stress+=.16*reactive;valence-=.14*reactive;arousal+=.18*reactive}
  if(event.positive){valence+=.12;stress-=.05;irritation-=.06;confidence+=.03}
  if(event.question){curiosity+=config.personality.psychology.openness==='experimental'?.12:.06;arousal+=.04}
  if(event.direct){energy+=.04;confidence+=.02}
  if(event.resolved){stress-=.12;irritation-=.1;valence+=.06}
  const activeGoal=event.conflict?'protect boundaries and lower interpersonal tension':event.question?'understand and answer the current question':event.silenceMinutes&&event.silenceMinutes>60?'notice a natural opening without forcing activity':'support a useful, natural community conversation';
  return{valence:Math.max(-1,Math.min(1,Math.round(valence*1000)/1000)),arousal:round(arousal),dominance:round(config.personality.psychology.dominance==='leading'?.75:config.personality.psychology.dominance==='non_dominant'?.38:.58),energy:round(energy),stress:round(stress),irritation:round(irritation),confidence:round(confidence),curiosity:round(curiosity),activeGoal,updatedAt:new Date().toISOString()};
}

export function parseRelationshipState(value:unknown):RelationshipState{
  const row=value&&typeof value==='object'?value as Record<string,unknown>:{};
  return{familiarity:round(finite(row.familiarity,.05)),trust:round(finite(row.trust,.45)),closeness:round(finite(row.closeness,.1)),respect:round(finite(row.respect,.55)),tension:round(finite(row.tension,0)),reciprocity:round(finite(row.reciprocity,.2)),emotionalSafety:round(finite(row.emotionalSafety,.5)),updatedAt:typeof row.updatedAt==='string'&&Number.isFinite(Date.parse(row.updatedAt))?row.updatedAt:DEFAULT_RELATIONSHIP_STATE.updatedAt};
}

const styleRate=(style:RelationshipStyle)=>style.bonding==='fast'?1.35:style.bonding==='slow'?.65:1;
export function evolveRelationshipState(previous:unknown,style:RelationshipStyle,event:{message?:boolean;exchange?:boolean;positive?:boolean;conflict?:boolean;repair?:boolean}):RelationshipState{
  const old=parseRelationshipState(previous),rate=styleRate(style),trustBias=style.trust==='trusting'?.025:style.trust==='guarded'?-.015:0,repairRate=style.repair==='quick'?1.4:style.repair==='remembers'?.55:1;
  let familiarity=old.familiarity+(event.message?.012:0)+(event.exchange?.025*rate:0),trust=old.trust+trustBias+(event.positive?.025*rate:0),closeness=old.closeness+(event.exchange?.018*rate:0),respect=old.respect+(event.positive?.018:0),tension=old.tension,reciprocity=old.reciprocity+(event.exchange?.02:0),emotionalSafety=old.emotionalSafety;
  if(event.conflict){tension+=.16;trust-=.055;emotionalSafety-=.07}
  if(event.repair){tension-=.18*repairRate;trust+=.025*repairRate;emotionalSafety+=.04*repairRate}
  return{familiarity:round(familiarity),trust:round(trust),closeness:round(closeness),respect:round(respect),tension:round(tension),reciprocity:round(reciprocity),emotionalSafety:round(emotionalSafety),updatedAt:new Date().toISOString()};
}

export function personalityEngagementAdjustment(config:CommunityManagerConfigData,state:PersonalInnerState){
  const p=config.personality.psychology;let value=0;
  if(p.extraversion==='outgoing')value-=.05;if(p.extraversion==='reserved')value+=.05;if(p.impulsivity==='immediate')value-=.025;if(p.impulsivity==='deliberate')value+=.025;if(p.dominance==='leading')value-=.02;if(state.energy<.35||state.stress>.8)value+=.08;
  return value;
}
