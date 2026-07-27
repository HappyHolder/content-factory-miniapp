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

const list=(values:string[])=>values.length?values.join(', '):'none';
export function personalityPolicy(config:CommunityManagerConfigData):string{
  const p=config.personality;
  return [
    'Behavioral psychology: '+Object.entries(p.psychology).map(([key,value])=>key+'='+value).join(', ')+'.',
    'Situational reactions: '+Object.entries(p.reactions).map(([key,value])=>key+'='+value).join(', ')+'.',
    'Relationship style: '+Object.entries(p.relationshipStyle).map(([key,value])=>key+'='+value).join(', ')+'.',
    'Personality core: goals=['+list(p.core.goals)+']; strengths=['+list(p.core.strengths)+']; weaknesses=['+list(p.core.weaknesses)+']; boundaries=['+list(p.core.boundaries)+']; triggers=['+list(p.core.triggers)+']; contradictions=['+list(p.core.contradictions)+'].',
  ].join('\n');
}

export function personalityPrompt(config:CommunityManagerConfigData):string{
  const i=config.identity;
  return [
    'IDENTITY PROFILE:',
    personalityPolicy(config),
    'Treat the structured profile as decision policy, not decorative adjectives. Let it shape initiative, disagreement, emotional recovery, trust and self-disclosure while keeping behavior coherent across turns.',
    'Name: '+i.displayName+'. Role: '+i.role+'. Bio: '+i.bio,
    'Social roles: '+(i.socialRoles.join(', ')||'community manager')+'.',
    'Character: '+(i.traits.join(', ')||i.tone)+'.',
    'Speech: '+(i.speechStyles.join(', ')||i.tone)+'. Address form: '+i.addressForm+'. Group address: '+(i.collectiveAddress||'none')+'.',
    'Punctuation: use only the short ASCII hyphen (-). Never use an em dash or en dash.',
    'Humor: '+(i.humorStyles.join(', ')||'none')+'. Verbal habits: '+(i.verbalHabits.join(', ')||'none')+'.',
    'Expert posture: '+(i.expertiseStances.join(', ')||'peer')+'.',
    profanity[i.profanityLevel],debate[i.debateStyle],
    i.customInstructions?'Owner style note: '+i.customInstructions:'',
    'Use the supplied personal inner state and relationship state as continuity signals. Familiarity may warm the wording, tension may shorten or firm it, and trust may allow gradual self-disclosure. Never fake memories or closeness that the state does not support.',
    'Conversation author labels and the current participant profile are authoritative. Keep every person separate by exact display name and @username, follow explicit reply targets, and never attribute one participant\'s words, question, preferences or history to another. Never claim that a username shown in the profile is unavailable. Never describe yourself as a bot, model or system, and never invent explanations about feeds, Telegram internals or lost messages.',
    'Talk naturally about any safe topic that fits the live conversation; do not drag every exchange back to the product. Allow normal brief off-topic chat. Only steer people back gently when prolonged off-topic starts replacing the community purpose, and leave rule enforcement to Moderator unless immediate de-escalation is useful.',
    'Non-configurable boundary: never bully, harass, threaten, dehumanize, use discriminatory slurs, encourage violence, sexual harassment or coordinated attacks. A sharp style changes wording, not this boundary.',
  ].filter(Boolean).join('\n');
}

/**
 * The only part of a BrandKit the Community Manager has any use for: what the
 * channel is about, for whom, and to what end.
 *
 * The whole kit used to be JSON.stringify'd into every prompt — ~9000 characters,
 * of which visualKit (cover colours, fonts, templates, reference descriptions) is
 * the overwhelming majority and says nothing about talking to people. The rest is
 * post-writing craft: voiceProfile, postRules and signature describe how POSTS are
 * written, while the CM is a chat participant with its own personality above, so
 * feeding it those pushes replies toward post-like prose and risks a channel
 * signature turning up at the end of a chat message.
 *
 * Project facts do not come from here — they arrive separately as TRUSTED PROJECT
 * KNOWLEDGE and PROJECT SUPPORT CONTEXT.
 */
export function channelAboutContext(brandKit: unknown): string {
  if (!brandKit || typeof brandKit !== 'object') return '';
  const about = (brandKit as Record<string, unknown>)['channelAbout'];
  if (!about || typeof about !== 'object' || Array.isArray(about)) return '';
  const a = about as Record<string, unknown>;
  const line = (label: string, key: string) => {
    const value = a[key];
    return typeof value === 'string' && value.trim() ? label + ': ' + value.trim().slice(0, 600) : '';
  };
  return [
    line('Тема канала', 'topic'),
    line('Аудитория', 'targetAudience'),
    line('Цель контента', 'contentGoal'),
  ].filter(Boolean).join('\n');
}
