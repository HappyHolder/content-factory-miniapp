const greeting=/^(?:привет(?:ствую)?|здравствуй(?:те)?|доброе\s+утро|добрый\s+(?:день|вечер)|hello|hi)(?:[!,.?:;\s—-]+|$)/iu;
const cannedOpeners=[
  /^(?:конечно|без проблем|с удовольствием)(?:[!,.?:;\s—-]+|$)/iu,
  /^давай(?:те)?\s+(?:разбираться|разбер[её]мся|посмотрим)(?:[!,.?:;\s—-]+|$)/iu,
];
const supportCliches=[
  /что именно (?:тебя |вас )?интересует/iu,
  /если есть конкретн(?:ый|ые) вопрос/iu,
  /(?:пиши|пишите|спрашивай|спрашивайте)[,!]?\s*(?:—|-)?\s*(?:посмотрим|разбер[её]мся|помогу)?/iu,
  /посмотрим вместе/iu,
  /чем (?:я )?могу помочь/iu,
  /рад(?:а)? помочь/iu,
];

export function messageStartsWithGreeting(text:string){return greeting.test(text.trim())}

export function allowConversationGreeting(currentMessage:string,hasRecentChat:boolean){
  return !hasRecentChat&&messageStartsWithGreeting(currentMessage);
}

/** Keep CM chat punctuation plain and human-looking regardless of model output. */
export function normalizeCommunityManagerPunctuation(text:string){
  return text.replace(/\\n/g,'\n').replace(/[\u2013\u2014]/g,'-');
}

export function sanitizeConversationReply(text:string,allowGreeting:boolean){
  let result=text.replace(/\\n/g,'\n').trim();
  if(!allowGreeting)result=result.replace(greeting,'');
  for(let previous='';result&&previous!==result;){
    previous=result;
    for(const pattern of cannedOpeners)result=result.replace(pattern,'').trimStart();
  }
  return normalizeCommunityManagerPunctuation(result.split(/(?<=[.!?])\s+/u).filter(sentence=>!supportCliches.some(pattern=>pattern.test(sentence))).join(' ').trim());
}

export function needsNaturalConversationRewrite(text:string){
  const value=text.trim();
  return !value||supportCliches.some(pattern=>pattern.test(value));
}
