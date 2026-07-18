import { chooseActivity, type ActivityHistoryItem, type ActivityPulse, type CommunityActivityType } from './activityDirector';
export type { CommunityActivityType } from './activityDirector';
export type CommunityPulse=ActivityPulse;

export function communityPulse(input:{messages:number;participants:number;tension:boolean;openQuestions:number}):CommunityPulse{return{energy:input.messages===0?'silent':input.messages<6?'low':'active',tension:input.tension,openQuestions:input.openQuestions>0,participants:input.participants,messages:input.messages}}
export function chooseActivityForPulse(enabled:CommunityActivityType[],history:ActivityHistoryItem[],pulse:CommunityPulse){return chooseActivity({enabled,history,pulse})}
export function chooseActivityTopic(topics:string[],recentTopics:Array<string|null|undefined>){const clean=[...new Set(topics.map(topic=>topic.trim()).filter(Boolean))];if(!clean.length)return undefined;const blocked=new Set(recentTopics.slice(0,Math.max(1,clean.length-1)).filter(Boolean));return clean.find(topic=>!blocked.has(topic))??clean[0]}
export function chooseAdaptiveActivityType<T extends string>(enabled:T[],history:Array<{type:string;engaged?:boolean;evaluated?:boolean}>){if(!enabled.length)return null;const recent=history[0]?.type;return enabled.find(type=>type!==recent)??enabled[0]??null}