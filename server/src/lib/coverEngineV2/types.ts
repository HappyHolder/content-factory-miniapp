import type { GeneratedCover } from '../imageGenerator';
import type { TemplateClassification } from '../aiGenerator';

export type CoverEngineV2Mode = 'ai' | 'html' | 'ai_html';
export type CoverEngineV2AspectRatio = '1:1' | '16:9' | '4:5' | '9:16';
export type CoverEngineV2Scenario =
  | 'brand_ai_overlay'
  | 'ai_sharp_overlay'
  | 'html_template'
  | 'hybrid_template_background'
  | 'rubric_template_pack'
  | 'satori_fallback';

export type BackgroundKind = 'photo' | 'abstract';
export type TextZone = 'top' | 'bottom' | 'left' | 'right' | 'center' | 'full';

export interface HtmlTemplateRef {
  name: string;
  url: string;
}

export interface RubricRef {
  id: string;
  name: string;
  description?: string;
  mode: CoverEngineV2Mode;
  templateUrl?: string;
  hybridPrompt?: string;
}

export interface SlotBrandContextV2 {
  handle?: string | null;
  name?: string | null;
  about?: string;
  voice?: string;
}

export interface CoverEngineV2Input {
  coverMode: CoverEngineV2Mode;
  useBrandKit: boolean;
  visualKit: unknown;
  vkObj: Record<string, unknown> | null;
  title: string;
  sourceSummary: string;
  finalTitle: string;
  input: string;
  imagePrompt?: string;
  coverLanguage?: 'ru' | 'en';
  aspectRatio: CoverEngineV2AspectRatio;
  imageModel: string;
  slotBrandCtx: SlotBrandContextV2;
  rubricTemplate?: HtmlTemplateRef | null;
  rubricHybridPrompt?: string;
  rubricSelected?: boolean;
  dryRun?: boolean;
}

export interface VisualBriefV2 {
  coreEvent: string;
  actors: string[];
  conflict: string;
  consequence: string;
  visualMetaphor: string;
  avoid: string[];
  keywords: string[];
}

export interface TemplateContractV2 {
  templateName?: string | null;
  backgroundKind: BackgroundKind;
  textZone: TextZone;
  focalRule: string;
  density: 'low' | 'medium' | 'high';
  backgroundRole: string;
  hybridPrompt?: string;
}

export interface CoverContextV2 {
  mode: CoverEngineV2Mode;
  title: string;
  sourceSummary: string;
  finalTitle: string;
  postText: string;
  imagePrompt?: string;
  visualKit: unknown;
  vkObj: Record<string, unknown> | null;
  aspectRatio: CoverEngineV2AspectRatio;
  imageModel: string;
  coverLanguage?: 'ru' | 'en';
  slotBrandCtx: SlotBrandContextV2;
  htmlTemplates: HtmlTemplateRef[];
  rubrics: RubricRef[];
  explicitTemplate: HtmlTemplateRef | null;
  explicitHybridPrompt?: string;
  rubricSelected: boolean;
}

export interface CoverPlanV2 {
  scenario: CoverEngineV2Scenario;
  mode: CoverEngineV2Mode;
  rubric: RubricRef | null;
  template: HtmlTemplateRef | null;
  backgroundKind: BackgroundKind;
  needsBackground: boolean;
  needsHtmlOverlay: boolean;
  usesSharpOverlay: boolean;
  reason: string;
}

export interface PromptPlanV2 {
  prompt: string;
  systemPrompt?: string;
  userPrompt?: string;
  builder: 'legacy_brand_scene' | 'template_hybrid_scene' | 'direct_user_prompt';
}

export interface CoverEngineV2Result {
  cover: GeneratedCover | null;
  plan: CoverPlanV2;
  promptPlan: PromptPlanV2 | null;
  classification: TemplateClassification | null;
  debug: string[];
}


