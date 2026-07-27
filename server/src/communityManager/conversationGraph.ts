export type GraphHuman={telegramMessageId:number;replyToMessageId:number|null;messageThreadId?:number|null;text:string|null;tgUserId:string|null;createdAt:Date};
export type GraphAction={telegramMessageId:number|null;sourceTelegramMessageId?:number|null;response:string|null;createdAt:Date};

export function buildConversationGraph(input:{humans:GraphHuman[];actions:GraphAction[];identities:Map<string,string>;cmName:string}){
  const ordered=[...input.humans].sort((a,b)=>a.createdAt.getTime()-b.createdAt.getTime()),byId=new Map(ordered.map(row=>[row.telegramMessageId,row]));
  const humanByMessage=new Map(ordered.map(row=>[row.telegramMessageId,input.identities.get(row.tgUserId??'')??'Unknown participant']));
  const cmSourceByMessage=new Map(input.actions.flatMap(row=>row.telegramMessageId&&row.sourceTelegramMessageId?[[row.telegramMessageId,row.sourceTelegramMessageId] as const]:[]));
  const cmMessageIds=new Set(cmSourceByMessage.keys()),roots=new Map<number,number>(),visiting=new Set<number>();
  const rootOf=(id:number):number=>{
    if(roots.has(id))return roots.get(id)!;if(visiting.has(id))return id;visiting.add(id);
    const row=byId.get(id),discussionRoot=row?.messageThreadId;
    let root=discussionRoot??id;
    if(!discussionRoot&&row?.replyToMessageId){const parent=row.replyToMessageId,source=cmSourceByMessage.get(parent);root=byId.has(parent)?rootOf(parent):source?rootOf(source):id}
    visiting.delete(id);roots.set(id,root);return root;
  };
  const timeline=[
    ...ordered.filter(row=>Boolean(row.text)).map(row=>{const author=input.identities.get(row.tgUserId??'')??'Unknown participant';const target=row.replyToMessageId?(humanByMessage.get(row.replyToMessageId)??(cmMessageIds.has(row.replyToMessageId)?input.cmName:null)):null;return{at:row.createdAt,threadId:rootOf(row.telegramMessageId),line:author+(target?' [reply to '+target+']':'')+': '+row.text}}),
    ...input.actions.filter(row=>Boolean(row.response)).map(row=>({at:row.createdAt,threadId:row.sourceTelegramMessageId?rootOf(row.sourceTelegramMessageId):(row.telegramMessageId??-1),line:input.cmName+': '+row.response})),
  ].sort((a,b)=>a.at.getTime()-b.at.getTime());
  const threads=new Map<number,string[]>();for(const item of timeline){const list=threads.get(item.threadId)??[];list.push(item.line);threads.set(item.threadId,list)}
  return{history:timeline.map(item=>item.line).join('\n').slice(-12000),threads:[...threads.entries()].map(([id,lines])=>({id,history:lines.join('\n')})),threadCount:threads.size};
}
