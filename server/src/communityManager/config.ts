export type CommunityManagerConfigData = {
  identity: { displayName: string; role: string; bio: string; tone: 'friendly'|'expert'|'energetic'|'neutral'; addressForm: 'ты'|'вы'; humorLevel: number; initiativeLevel: number; forbiddenClaims: string[] };
  support: { useBrandKit: boolean; useProjectDocs: boolean; useFaq: boolean; answerProductQuestions: boolean; escalateWhenUnknown: boolean; escalationText: string; supportContactUrl: string };
  research: { mode: 'off'|'when_needed'|'deep'; showSources: boolean; maxSearchesPerAnswer: number; dailyLimit: number };
  replies: { replyToDirectReply: boolean; replyToMention: boolean; replyToProductQuestion: boolean; replyToUnansweredQuestion: boolean; ambientConversation: boolean; unansweredAfterMinutes: number; maxThreadDepth: number; userCooldownSeconds: number };
  activities: { enabled: boolean; requireApproval: boolean; discussionEnabled: boolean; pollEnabled: boolean; digestEnabled: boolean; everyHours: number; topics: string[] };
  limits: { timezone: string; quietFrom: number; quietTo: number; maxRepliesPerHour: number; maxRepliesPerDay: number; maxInitiativesPerDay: number };
};

export const DEFAULT_CM_CONFIG: CommunityManagerConfigData = {
  identity: { displayName: 'Community Manager', role: 'Комьюнити-менеджер проекта', bio: 'Помогаю участникам, поддерживаю полезные обсуждения и знаю продукт.', tone: 'friendly', addressForm: 'ты', humorLevel: 1, initiativeLevel: 1, forbiddenClaims: ['не обещать сроки, цены и действия команды без источника'] },
  support: { useBrandKit: true, useProjectDocs: true, useFaq: true, answerProductQuestions: true, escalateWhenUnknown: true, escalationText: 'Я уточню это у команды проекта.', supportContactUrl: '' },
  research: { mode: 'when_needed', showSources: true, maxSearchesPerAnswer: 3, dailyLimit: 20 },
  replies: { replyToDirectReply: true, replyToMention: true, replyToProductQuestion: true, replyToUnansweredQuestion: false, ambientConversation: false, unansweredAfterMinutes: 15, maxThreadDepth: 4, userCooldownSeconds: 30 },
  activities: { enabled: false, requireApproval: true, discussionEnabled: true, pollEnabled: true, digestEnabled: true, everyHours: 24, topics: [] },
  limits: { timezone: 'Europe/Moscow', quietFrom: 23, quietTo: 9, maxRepliesPerHour: 20, maxRepliesPerDay: 100, maxInitiativesPerDay: 2 },
};

const str=(v:unknown,f:string,max:number)=>typeof v==='string'&&v.trim()?v.trim().slice(0,max):f;
const num=(v:unknown,f:number,min:number,max:number)=>Math.max(min,Math.min(max,Number.isFinite(Number(v))?Number(v):f));
const bool=(v:unknown,f:boolean)=>typeof v==='boolean'?v:f;
const list=(v:unknown,maxItems:number,maxLen:number)=>Array.isArray(v)?[...new Set(v.filter(x=>typeof x==='string').map(x=>String(x).trim().slice(0,maxLen)).filter(Boolean))].slice(0,maxItems):[];

export function parseCommunityManagerConfig(raw: unknown): CommunityManagerConfigData {
  const r=(raw&&typeof raw==='object'?raw:{}) as Record<string,any>, d=DEFAULT_CM_CONFIG;
  const identity=r.identity??{},support=r.support??{},research=r.research??{},replies=r.replies??{},activities=r.activities??{},limits=r.limits??{};
  const tone=['friendly','expert','energetic','neutral'].includes(identity.tone)?identity.tone:d.identity.tone;
  const addressForm=['ты','вы'].includes(identity.addressForm)?identity.addressForm:d.identity.addressForm;
  const researchMode=['off','when_needed','deep'].includes(research.mode)?research.mode:d.research.mode;
  return {
    identity:{displayName:str(identity.displayName,d.identity.displayName,80),role:str(identity.role,d.identity.role,160),bio:str(identity.bio,d.identity.bio,1200),tone,addressForm,humorLevel:num(identity.humorLevel,d.identity.humorLevel,0,3),initiativeLevel:num(identity.initiativeLevel,d.identity.initiativeLevel,0,3),forbiddenClaims:list(identity.forbiddenClaims,20,200)},
    support:{useBrandKit:bool(support.useBrandKit,d.support.useBrandKit),useProjectDocs:bool(support.useProjectDocs,d.support.useProjectDocs),useFaq:bool(support.useFaq,d.support.useFaq),answerProductQuestions:bool(support.answerProductQuestions,d.support.answerProductQuestions),escalateWhenUnknown:bool(support.escalateWhenUnknown,d.support.escalateWhenUnknown),escalationText:str(support.escalationText,d.support.escalationText,500),supportContactUrl:typeof support.supportContactUrl==='string'?support.supportContactUrl.trim().slice(0,500):''},
    research:{mode:researchMode,showSources:bool(research.showSources,d.research.showSources),maxSearchesPerAnswer:num(research.maxSearchesPerAnswer,d.research.maxSearchesPerAnswer,1,5),dailyLimit:num(research.dailyLimit,d.research.dailyLimit,0,200)},
    replies:{replyToDirectReply:bool(replies.replyToDirectReply,d.replies.replyToDirectReply),replyToMention:bool(replies.replyToMention,d.replies.replyToMention),replyToProductQuestion:bool(replies.replyToProductQuestion,d.replies.replyToProductQuestion),replyToUnansweredQuestion:bool(replies.replyToUnansweredQuestion,d.replies.replyToUnansweredQuestion),ambientConversation:bool(replies.ambientConversation,d.replies.ambientConversation),unansweredAfterMinutes:num(replies.unansweredAfterMinutes,d.replies.unansweredAfterMinutes,1,240),maxThreadDepth:num(replies.maxThreadDepth,d.replies.maxThreadDepth,1,10),userCooldownSeconds:num(replies.userCooldownSeconds,d.replies.userCooldownSeconds,0,3600)},
    activities:{enabled:bool(activities.enabled,d.activities.enabled),requireApproval:bool(activities.requireApproval,d.activities.requireApproval),discussionEnabled:bool(activities.discussionEnabled,d.activities.discussionEnabled),pollEnabled:bool(activities.pollEnabled,d.activities.pollEnabled),digestEnabled:bool(activities.digestEnabled,d.activities.digestEnabled),everyHours:num(activities.everyHours,d.activities.everyHours,1,168),topics:list(activities.topics,50,160)},
    limits:{timezone:str(limits.timezone,d.limits.timezone,80),quietFrom:num(limits.quietFrom,d.limits.quietFrom,0,23),quietTo:num(limits.quietTo,d.limits.quietTo,0,23),maxRepliesPerHour:num(limits.maxRepliesPerHour,d.limits.maxRepliesPerHour,1,100),maxRepliesPerDay:num(limits.maxRepliesPerDay,d.limits.maxRepliesPerDay,1,1000),maxInitiativesPerDay:num(limits.maxInitiativesPerDay,d.limits.maxInitiativesPerDay,0,20)},
  };
}

export function isQuietHour(config:CommunityManagerConfigData,date=new Date()):boolean{
  let hour=date.getUTCHours();
  try{hour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:config.limits.timezone,hour:'2-digit',hourCycle:'h23'}).format(date));}catch{}
  const {quietFrom:a,quietTo:b}=config.limits;
  return a===b?false:a>b?(hour>=a||hour<b):(hour>=a&&hour<b);
}