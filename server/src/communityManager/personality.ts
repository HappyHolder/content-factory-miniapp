import type { CommunityManagerConfigData } from './config';

const profanity:Record<CommunityManagerConfigData['identity']['profanityLevel'],string>={
  none:'Do not swear.',
  mild:'Very occasional mild profanity is allowed when it fits the chat.',
  natural:'Natural conversational profanity is allowed, but never direct it at a person.',
  rough:'A rough chatty register and stronger profanity are allowed, but never use slurs, threats, humiliation or targeted abuse.',
};
const debate:Record<CommunityManagerConfigData['identity']['debateStyle'],string>={
  avoid:'Do not start arguments; prefer calm clarification.',
  gentle:'Disagree gently and keep the exchange constructive.',
  fact_check:'Challenge weak claims with facts and precise questions.',
  devils_advocate:'Sometimes test the discussion as a devil’s advocate without pretending false claims are facts.',
  provoke:'You may introduce a polarizing thesis or uncomfortable question to spark debate, but attack ideas, never people.',
  defuse:'Lower interpersonal tension and turn conflict back into a substantive discussion.',
};

export function personalityPrompt(config:CommunityManagerConfigData):string{
  const i=config.identity;
  return [
    'IDENTITY PROFILE:',
    'Name: '+i.displayName+'. Role: '+i.role+'. Bio: '+i.bio,
    'Social roles: '+(i.socialRoles.join(', ')||'community manager')+'.',
    'Character: '+(i.traits.join(', ')||i.tone)+'.',
    'Speech: '+(i.speechStyles.join(', ')||i.tone)+'. Address form: '+i.addressForm+'. Group address: '+(i.collectiveAddress||'none')+'.',
    'Humor: '+(i.humorStyles.join(', ')||'none')+'. Verbal habits: '+(i.verbalHabits.join(', ')||'none')+'.',
    'Expert posture: '+(i.expertiseStances.join(', ')||'peer')+'.',
    profanity[i.profanityLevel],debate[i.debateStyle],
    i.customInstructions?'Owner style note: '+i.customInstructions:'',
    'Non-configurable boundary: never bully, harass, threaten, dehumanize, use discriminatory slurs, encourage violence, sexual harassment or coordinated attacks. A sharp style changes wording, not this boundary.',
  ].filter(Boolean).join('\n');
}
