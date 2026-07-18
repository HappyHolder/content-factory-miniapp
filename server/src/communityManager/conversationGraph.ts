export type GraphHuman={telegramMessageId:number;replyToMessageId:number|null;text:string|null;tgUserId:string|null;createdAt:Date};
export type GraphAction={telegramMessageId:number|null;sourceTelegramMessageId?:number|null;response:string|null;createdAt:Date};

export function buildConversationGraph(input:{humans:GraphHuman[];actions:GraphAction[];identities:Map<string,string>;cmName:string}){
  const ordered=[...input.humans].sort((a,b)=>a.createdAt.getTime()-b.createdAt.getTime());
  const humanByMessage=new Map(ordered.map(row=>[row.telegramMessageId,input.identities.get(row.tgUserId??'')??'Unknown participant']));
  const cmMessageIds=new Set(input.actions.map(row=>row.telegramMessageId).filter((x):x is number=>Number.isInteger(x)));
  const roots=new Map<number,number>();
  const rootOf=(id:number):number=>{
    if(roots.has(id))return roots.get(id)!;
    const row=ordered.find(item=>item.telegramMessageId===id),parent=row?.replyToMessageId;
    const root=parent&&humanByMessage.has(parent)?rootOf(parent):id;roots.set(id,root);return root;
  };
  const timeline=[
    ...ordered.filter(row=>Boolean(row.text)).map(row=>{
      const author=input.identities.get(row.tgUserId??'')??'Unknown participant';
      const target=row.replyToMessageId?(humanByMessage.get(row.replyToMessageId)??(cmMessageIds.has(row.replyToMessageId)?input.cmName:null)):null;
      return{at:row.createdAt,threadId:rootOf(row.telegramMessageId),line:author+(target?' [reply to '+target+']':'')+': '+row.text};
    }),
    ...input.actions.filter(row=>Boolean(row.response)).map(row=>({at:row.createdAt,threadId:row.sourceTelegramMessageId?rootOf(row.sourceTelegramMessageId):(row.telegramMessageId??-1),line:input.cmName+': '+row.response})),
  ].sort((a,b)=>a.at.getTime()-b.at.getTime());
  const threads=new Map<number,string[]>();
  for(const item of timeline){const list=threads.get(item.threadId)??[];list.push(item.line);threads.set(item.threadId,list)}
  return{history:timeline.map(item=>item.line).join('\n').slice(-12000),threads:[...threads.entries()].map(([id,lines])=>({id,history:lines.join('\n')})),threadCount:threads.size};
}
