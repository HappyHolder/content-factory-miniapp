export function interventionCooldownSeconds(configured:number){return Math.max(60,Math.min(3600,Math.round(configured)||600))}

export function selectRepeatedParticipant(currentUserId:string,decisionParticipantIds:string[],previousParticipantIds:string[],conversationAuthorIds:string[]){
  const previous=new Set(previousParticipantIds),authors=new Set(conversationAuthorIds);
  const eligible=[...new Set(decisionParticipantIds.filter(id=>authors.has(id)&&previous.has(id)))];
  if(eligible.includes(currentUserId))return currentUserId;
  return eligible.length===1?eligible[0]!:null;
}