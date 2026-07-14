const decisionLabels:Record<string,string>={RESPOND:'Ответил',SILENT:'Промолчал',DRAFT:'Создал черновик',ACTIVITY:'Запустил активность',ERROR:'Ошибка'};
const intentLabels:Record<string,string>={product_support:'Вопрос о продукте',external_fresh:'Нужны свежие данные',conversation:'Разговор',feedback:'Обратная связь',request_human:'Нужен человек',unsafe:'Остановлено модерацией',no_response:'Ответ не нужен',limits:'Лимиты',moderation_timeout:'Ожидание Moderator',moderator_trigger:'Обработал Moderator',burst_superseded:'Объединено с сообщением'};
const reasonLabels:Record<string,string>={
  'Quiet hours or quota':'Тихие часы или достигнут лимит ответов',
  'Community conversation cooldown':'Действует пауза между репликами CM',
  'Handled by Moderator trigger':'Сообщение уже обработал Moderator',
  'Blocked by Moderator':'Сообщение остановлено Moderator',
  'Moderator timeout':'Moderator не успел подтвердить сообщение',
  'Trusted research unavailable':'Нет подтверждения из разрешённых источников',
  'Already delivered':'Ответ уже был доставлен — повтор предотвращён',
};

export function actionPresentation(action:{decision:string;intent?:string|null;reason?:string|null;sources?:unknown;inputTokens?:number;outputTokens?:number;latencyMs?:number|null}){
  const sources=Array.isArray(action.sources)?action.sources:[],domains=[...new Set(sources.flatMap(source=>{try{return typeof source==='object'&&source&&'url'in source?[new URL(String((source as {url:unknown}).url)).hostname.replace(/^www\./,'')]:[]}catch{return[]}}))];
  return{
    decisionLabel:decisionLabels[action.decision]??action.decision,
    intentLabel:action.intent?(intentLabels[action.intent]??action.intent):'Системное действие',
    reasonLabel:action.reason?(reasonLabels[action.reason]??action.reason):null,
    domains,
    usedResearch:domains.length>0,
    tokens:Number(action.inputTokens??0)+Number(action.outputTokens??0),
    latencyMs:Number(action.latencyMs??0),
  };
}
