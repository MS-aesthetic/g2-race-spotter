/**
 * Render-mode selection, run once before `createStartUpPageContainer`.
 *
 * Order: `?render=` in the page URL, then the bridge KV override
 * (`g2rs:v1:render`), then image. The simulator is deliberately NOT detected:
 * image mode is the normal path on hardware and in the simulator alike
 * (spec 050 R6), so `import.meta.env.MODE` must never reach this decision.
 */

export type RenderMode = 'image' | 'text';

export const DEFAULT_RENDER_MODE: RenderMode = 'image';

export interface RenderModeInput {
  /** `location.search` (or a full URL query string); `''` when absent. */
  readonly search?: string;
  /** Value stored under `g2rs:v1:render`, or null/undefined when unset. */
  readonly kv?: string | null;
}

export function isRenderMode(value: unknown): value is RenderMode {
  return value === 'image' || value === 'text';
}

function fromSearch(search: string | undefined): RenderMode | undefined {
  if (!search) {
    return undefined;
  }

  const value = new URLSearchParams(
    search.startsWith('?') ? search.slice(1) : search,
  ).get('render');

  return isRenderMode(value) ? value : undefined;
}

export function resolveRenderMode(input: RenderModeInput = {}): RenderMode {
  const fromUrl = fromSearch(input.search);
  if (fromUrl !== undefined) {
    return fromUrl;
  }

  const stored = input.kv?.trim();
  return isRenderMode(stored) ? stored : DEFAULT_RENDER_MODE;
}
