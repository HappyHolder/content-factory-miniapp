# coverEngineV2

Primary modular cover engine. Production calls it through `coverEngineRouter` from
draft generation, post regeneration and bot flows. The legacy `coverBuilder`
remains only for `ai_html` covers that have no uploaded HTML template.

## Boundaries

- Uses the production model/render adapters:
  - direct OpenAI text helpers from `aiGenerator` / `assistantModel`
  - direct OpenAI image generation from `imageGenerator`
  - HTML planning helpers from `claudeHtmlGenerator`
  - Playwright/Satori renderers
- Does not mutate posts or database rows.
- Supports `dryRunCoverV2` to inspect routing and prompt plans without external
  AI/image calls.

## Scenarios

- `brand_ai_overlay`  
  Channel-style cover: AI background from post meaning, then branded HTML overlay.
  This is separate from market HTML templates.

- `ai_sharp_overlay`  
  Pure AI cover with sharp text/logo overlay.

- `html_template`  
  Render a concrete HTML template without AI background.

- `hybrid_template_background`  
  Generate an AI background under a concrete HTML template.

- `rubric_template_pack`  
  A rubric/template pack chooses mode + template, then the engine builds the
  cover using that recipe.

- `satori_fallback`  
  Final internal fallback when V2 rendering does not produce a cover.

## Routing

All activation decisions belong in `coverEngineRouter.ts`. Do not call the legacy
and V2 engines directly from product routes; keeping the choice in one router
preserves consistent behavior across Create, bot drafts and regeneration.
