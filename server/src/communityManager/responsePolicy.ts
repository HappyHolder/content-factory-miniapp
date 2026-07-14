export type AmbientIntent='product_support'|'external_fresh'|'conversation'|'feedback'|'request_human'|'unsafe'|'no_response'|string;
export function shouldJoinAmbient(input:{enabled:boolean;intent:AmbientIntent;respond:boolean;confidence:number;hasQuestion:boolean;textLength:number}){
  if(!input.enabled||!input.respond||input.confidence<0.6)return false;
  if(input.intent==='unsafe'||input.intent==='no_response'||input.intent==='request_human'||input.intent==='product_support')return false;
  if(input.intent==='external_fresh')return input.hasQuestion;
  if(input.intent==='feedback')return input.textLength>=12;
  return input.intent==='conversation'&&(input.hasQuestion||input.textLength>=28);
}