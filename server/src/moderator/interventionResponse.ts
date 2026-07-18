const genericRedirect=/(?:если есть вопрос|вопросы по|верн[её]мся к|давайте обсуждать|обсудим лучше).{0,80}(?:btc|биткоин|крипт|блокчейн|тем[ае] канал)/iu;
const normalize=(value:string)=>value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const words=(value:string)=>new Set(normalize(value).split(' ').filter(word=>word.length>3));

export function responseSimilarity(a:string,b:string){
  const left=words(a),right=words(b);if(!left.size||!right.size)return 0;
  const common=[...left].filter(word=>right.has(word)).length;
  return common/Math.max(left.size,right.size);
}

export function acceptableInterventionResponse(response:string,previous:string[]){
  const value=response.replace(/https?:\/\/\S+/g,'').trim();
  return value.length>=8&&!genericRedirect.test(value)&&!previous.some(old=>responseSimilarity(value,old)>=.68);
}

const variants:Record<string,string[]>={
  conflict:['Стоп. Без переходов на личности — спорьте с аргументами, не друг с другом.','Сбавьте градус. Продолжайте по существу и без личных выпадов.','На этом личную перепалку заканчиваем. Оставьте только аргументы.'],
  harassment:['Личные оскорбления прекращаем. Следующее нарушение приведёт к санкции.','Без оскорблений. Это предупреждение, дальше будет санкция.','Границу перешли. Остановите личные нападки.'],
  promotion:['Самореклама без согласования здесь не размещается.','Промо и ссылки сначала согласуйте с администрацией.','Несогласованную рекламу убираем — продолжать не нужно.'],
  off_topic:['Эта ветка слишком далеко ушла от исходной темы. Завершайте её здесь.','Оффтоп сворачиваем, чтобы не забивать обсуждение.','Эту ветку заканчиваем — она уже мешает основному разговору.'],
  other:['Остановитесь и вернитесь к нормальному тону общения.','Так продолжать не нужно. Сформулируйте мысль спокойно и по существу.','Пауза: дальше только без нарушений и личных выпадов.'],
};

export function moderatorFallback(category:string,previous:string[],seed:number){
  const list=variants[category]??variants.other;
  return list.find((value,index)=>index===Math.abs(seed)%list.length&&!previous.some(old=>responseSimilarity(value,old)>=.68))??list.find(value=>!previous.some(old=>responseSimilarity(value,old)>=.68))??list[0];
}

export function moderatorParticipantLabel(username?:string|null,displayName?:string|null){
  const cleanUsername=(username??'').trim().replace(/^@+/,'');
  if(/^[A-Za-z0-9_]{5,32}$/.test(cleanUsername))return '@'+cleanUsername;
  const cleanName=(displayName??'').replace(/[\r\n\t<>]/g,' ').replace(/\s+/g,' ').trim().slice(0,80);
  return cleanName||'Участник';
}

export function targetedModeratorSanctionNotice(notice:string,username?:string|null,displayName?:string|null){
  return `${moderatorParticipantLabel(username,displayName)}: ${notice.trim()}`;
}

export function moderatorSanctionNotice(action:string,count:number,threshold:string,seed:number){
  const warning=[
    `Предупреждение ${count}${threshold}. Не продолжайте нарушение после замечания.`,
    `Фиксирую предупреждение ${count}${threshold}: граница уже была обозначена.`,
    `Это предупреждение ${count}${threshold}. Дальше без повторения нарушения.`,
    `Замечание проигнорировано — предупреждение ${count}${threshold}.`,
  ];
  const mute=[
    `Предупреждение ${count}${threshold}; участник временно ограничен.`,
    `После повторного нарушения включено временное ограничение. Счёт: ${count}${threshold}.`,
    `Участник получает паузу за повтор. Предупреждений: ${count}${threshold}.`,
    `Повтор зафиксирован: предупреждение ${count}${threshold} и временное ограничение.`,
  ];
  const ban=[
    'Участник заблокирован за повторные нарушения.',
    'Лимит нарушений исчерпан — участник заблокирован.',
    'Повторные нарушения привели к блокировке участника.',
    'Участник заблокирован: предыдущие предупреждения не помогли.',
  ];
  const values=action==='BAN'?ban:action==='MUTE'?mute:warning;
  return values[Math.abs(seed)%values.length]!;
}
