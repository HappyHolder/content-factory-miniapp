export type SocialState={energy:'low'|'steady'|'high';tension:'calm'|'watch'|'heated';initiative:'wait'|'join'|'lead';attention:string[]};

export function deriveSocialState(input:{participantCount:number;messageCount:number;pendingModerator:boolean;openQuestions:string[];minutesSinceCm:number|null}):SocialState{
  const density=input.messageCount/Math.max(1,input.participantCount);
  const energy=input.messageCount>=12||density>=5?'high':input.messageCount>=4?'steady':'low';
  const tension=input.pendingModerator?'heated':'calm';
  const initiative=input.pendingModerator?'join':energy==='high'?'join':input.minutesSinceCm!==null&&input.minutesSinceCm>90?'lead':'wait';
  const attention=[...(input.pendingModerator?['lower_tension']:[]),...(input.openQuestions.length?['open_questions']:[]),...(initiative==='lead'?['revive_chat']:[])];
  return{energy,tension,initiative,attention};
}
