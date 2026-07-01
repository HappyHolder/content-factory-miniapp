# coverEngineV2

Second cover engine, built next to the production `coverBuilder`.

It is intentionally not imported by `draftGenerator`, `posts`, or the bot. The
current production engine keeps running until this module is explicitly wired in.

## Boundaries

- Uses the same existing model/render adapters:
  - DeepSeek helpers from `aiGenerator`
  - Replicate image generation from `imageGenerator`
  - Claude/HTML helpers from `claudeHtmlGenerator`
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

## Activation

Do not activate this module by changing old shared prompt helpers. Wire it in
only through an explicit router/call site when the product decision is made.
