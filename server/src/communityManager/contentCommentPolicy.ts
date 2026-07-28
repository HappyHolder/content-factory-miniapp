import type { CommunityAgentDecision } from './agentRuntime';

const genericOpeners=[
  /^(эта|данная) новость (показывает|говорит|демонстрирует)/iu,
  /^(интересная|важная|громкая) новость/iu,
  /^(как вы (думаете|считаете)|что думаете|ваше мнение)/iu,
  /^(this|that) news (shows|proves|demonstrates)/iu,
];
const commonSubjectWords=new Set(['этот','эта','это','эти','новость','пост','сообщение','сегодня','the','this','that','news','post','message']);
const words=(value:string)=>value.toLocaleLowerCase('ru-RU').match(/[\p{L}\p{N}]{2,}/gu)??[];
const unique=(items:string[])=>[...new Set(items)];
const termPresent=(term:string,candidates:Set<string>)=>candidates.has(term)||(term.length>=5&&[...candidates].some(candidate=>candidate.length>=5&&candidate.slice(0,5)===term.slice(0,5)));

export type ContentCommentReview={approved:boolean;issues:string[]};

export function reviewContentComment(input:{decision:CommunityAgentDecision;postText:string;replyTargetMessageId?:number;sources:number}):ContentCommentReview{
  const {decision}=input;
  if(decision.action==='no_action')return{approved:true,issues:[]};
  const issues:string[]=[];
  const plan=decision.editorialPlan;
  const message=(decision.message??'').trim();
  if(!input.replyTargetMessageId)issues.push('missing_discussion_root');
  if(decision.action!=='comment')issues.push('content_post_must_be_comment_or_skip');
  if(!plan||plan.disposition!=='comment')issues.push('missing_editorial_comment_decision');
  const subject=plan?.subject.trim()??'';
  const addedValue=plan?.addedValue.trim()??'';
  if(subject.length<2)issues.push('missing_concrete_subject');
  if(addedValue.length<20)issues.push('missing_added_value');
  if(!plan?.evidence.includes('post'))issues.push('source_post_not_used');
  if(plan?.evidence.includes('web')&&input.sources===0)issues.push('web_claims_without_research');
  if(message.length<30)issues.push('comment_too_short');
  if(message.length>1000)issues.push('comment_too_long');
  if(message.includes('\u2014'))issues.push('em_dash');
  if(genericOpeners.some(pattern=>pattern.test(message)))issues.push('generic_opener');
  const subjectTerms=unique(words(subject).filter(word=>!commonSubjectWords.has(word)));
  const messageTerms=new Set(words(message)),postTerms=unique(words(input.postText)),postTermSet=new Set(postTerms);
  if(subjectTerms.length&&!subjectTerms.some(word=>termPresent(word,messageTerms)))issues.push('subject_not_named');
  if(subjectTerms.length&&!subjectTerms.some(word=>termPresent(word,postTermSet)))issues.push('subject_not_in_post');
  const commentTerms=unique(words(message));
  const overlap=commentTerms.filter(word=>postTerms.includes(word)).length/Math.max(1,commentTerms.length);
  if(commentTerms.length>8&&overlap>.9)issues.push('post_rephrased_without_addition');
  if(message.endsWith('?')&&!/[.!]\s/u.test(message))issues.push('question_only');
  return{approved:issues.length===0,issues};
}
