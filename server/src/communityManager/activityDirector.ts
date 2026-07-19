export type CommunityActivityType=
  |'DISCUSSION'|'POLL'|'QUIZ'|'LIGHT'|'HOT_NEWS'|'DIGEST'
  |'PREDICTION'|'CHALLENGE'|'CONTEST'
  |'CONTENT_TEASER'|'CONTENT_RELEASE'|'CONTENT_FOLLOWUP';

export type ActivityPulse={
  energy:'silent'|'low'|'active';
  tension:boolean;
  openQuestions:boolean;
  participants:number;
  messages:number;
  upcomingPost?:boolean;
  publishedPost?:boolean;
  publishedPostDiscussed?:boolean;
  researchAvailable?:boolean;
};

export type ActivityHistoryItem={type:string;engaged?:boolean;evaluated?:boolean};

const CONTENT_TYPES=new Set<CommunityActivityType>(['CONTENT_TEASER','CONTENT_RELEASE','CONTENT_FOLLOWUP']);

export function intensityWindow(intensity:'quiet'|'balanced'|'active'){
  if(intensity==='quiet')return{min:180,max:360};
  if(intensity==='active')return{min:35,max:90};
  return{min:75,max:180};
}

function score(type:CommunityActivityType,history:ActivityHistoryItem[]){
  let value=10;
  history.forEach((item,index)=>{
    if(item.type!==type)return;
    value-=Math.max(2,8-index);
    if(item.evaluated)value+=item.engaged?3:-4;
  });
  return value;
}

/** Pure policy: content lifecycle wins, active/tensed chats are left alone, and
 * formats rotate by response instead of defaulting to Telegram polls. */
export function chooseActivity(input:{enabled:CommunityActivityType[];history:ActivityHistoryItem[];pulse:ActivityPulse}){
  const {enabled,history,pulse}=input;
  if(pulse.tension)return null;
  if(pulse.upcomingPost&&enabled.includes('CONTENT_TEASER'))return'CONTENT_TEASER';
  if(pulse.publishedPost&&enabled.includes('CONTENT_RELEASE'))return'CONTENT_RELEASE';
  if(pulse.publishedPostDiscussed&&enabled.includes('CONTENT_FOLLOWUP'))return'CONTENT_FOLLOWUP';
  if(pulse.energy==='active')return null;
  const candidates=enabled.filter(type=>!CONTENT_TYPES.has(type)&&type!=='CONTEST'&&type!=='CHALLENGE');
  if(!candidates.length)return null;
  if(pulse.openQuestions&&candidates.includes('DISCUSSION'))return'DISCUSSION';
  const fresh=candidates.filter(type=>history.slice(0,Math.min(4,candidates.length-1)).every(item=>item.type!==type));
  const pool=fresh.length?fresh:candidates;
  return [...pool].sort((a,b)=>score(b,history)-score(a,history))[0]??null;
}

export function activityNeedsResearch(type:CommunityActivityType){return type==='HOT_NEWS'}
export function isContentActivity(type:CommunityActivityType){return CONTENT_TYPES.has(type)}
export function isRewardActivity(type:CommunityActivityType){return type==='CONTEST'||type==='CHALLENGE'}
