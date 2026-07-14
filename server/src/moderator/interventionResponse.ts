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
