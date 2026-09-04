/**
 * The page the glasses show: four containers, created exactly once
 * (constitution §6). Layout is the table in the `g2-hud-display` skill.
 *
 * Slot 2 is the single image container in image mode and a text container in
 * text mode — the same rect either way, so the mid-session fallback can swap it
 * with one `rebuildPageContainer`.
 */

import {
  consoleBridgeLogger,
  START_UP_PAGE_SUCCESS,
  type BridgeLogger,
  type ImageContainer,
  type PageContainer,
  type TextContainer,
} from './bridge.ts';
import { HUD_HEIGHT, HUD_WIDTH } from './render/hud-design.ts';
import type { RenderMode } from './render/mode.ts';

export type { PageContainer, TextContainer, ImageContainer };
/** Kept for the pre-existing import name. */
export type StartupPage = PageContainer;

export const CONTAINER_BG = 1;
export const CONTAINER_HUD = 2;
export const CONTAINER_MSG = 3;
export const CONTAINER_STATUS = 4;

export const CONTAINER_NAMES = {
  [CONTAINER_BG]: 'bg',
  [CONTAINER_HUD]: 'hud',
  [CONTAINER_MSG]: 'msg',
  [CONTAINER_STATUS]: 'status',
} as const;

const HUD_X = 144;
const HUD_Y = 8;

export const STATUS_TEXT_COLOR = 2;
export const STATUS_ALERT_TEXT_COLOR = 4;

function text(
  container: Partial<TextContainer> & {
    containerID: number;
    containerName: string;
  },
): TextContainer {
  return {
    xPosition: 0,
    yPosition: 0,
    width: 0,
    height: 0,
    borderWidth: 0,
    borderColor: 0,
    paddingLength: 0,
    isEventCapture: 0,
    zOrderIndex: 0,
    textColor: 0,
    content: '',
    ...container,
  };
}

/**
 * Full-canvas background. The only event-capture container, so every temple tap
 * arrives as a text event on container 1.
 */
function background(): TextContainer {
  return text({
    containerID: CONTAINER_BG,
    containerName: CONTAINER_NAMES[CONTAINER_BG],
    xPosition: 0,
    yPosition: 0,
    width: 576,
    height: 288,
    isEventCapture: 1,
    zOrderIndex: 1,
    textColor: 0,
    content: ' ',
  });
}

function hudText(content: string): TextContainer {
  return text({
    containerID: CONTAINER_HUD,
    containerName: CONTAINER_NAMES[CONTAINER_HUD],
    xPosition: HUD_X,
    yPosition: HUD_Y,
    width: HUD_WIDTH,
    height: HUD_HEIGHT,
    paddingLength: 4,
    zOrderIndex: 3,
    textColor: 4,
    content,
  });
}

function hudImage(): ImageContainer {
  return {
    containerID: CONTAINER_HUD,
    containerName: CONTAINER_NAMES[CONTAINER_HUD],
    xPosition: HUD_X,
    yPosition: HUD_Y,
    width: HUD_WIDTH,
    height: HUD_HEIGHT,
    zOrderIndex: 3,
  };
}

function messageContainer(content: string): TextContainer {
  return text({
    containerID: CONTAINER_MSG,
    containerName: CONTAINER_NAMES[CONTAINER_MSG],
    xPosition: 16,
    yPosition: 160,
    width: 544,
    height: 96,
    paddingLength: 4,
    zOrderIndex: 4,
    textColor: 4,
    content,
  });
}

function statusContainer(content: string): TextContainer {
  return text({
    containerID: CONTAINER_STATUS,
    containerName: CONTAINER_NAMES[CONTAINER_STATUS],
    xPosition: 16,
    yPosition: 258,
    width: 544,
    height: 28,
    paddingLength: 4,
    zOrderIndex: 5,
    textColor: STATUS_TEXT_COLOR,
    content,
  });
}

export interface PageContent {
  readonly mode: RenderMode;
  /** Status strip text baked into the page (image data is not allowed here). */
  readonly status: string;
  readonly message?: string;
  /** Text-mode HUD content; ignored in image mode. */
  readonly hud?: string;
}

/** Builds the 4-container page for either render mode. */
export function buildPage(content: PageContent): PageContainer {
  const message = messageContainer(content.message ?? '');
  const status = statusContainer(content.status);

  if (content.mode === 'text') {
    return {
      containerTotalNum: 4,
      textObject: [background(), hudText(content.hud ?? ''), message, status],
    };
  }

  return {
    containerTotalNum: 4,
    textObject: [background(), message, status],
    imageObject: [hudImage()],
  };
}

export interface StartupBridge {
  createStartUpPageContainer(page: PageContainer): Promise<number>;
}

/**
 * One-call guard: repeated calls return the first result. A failed create is
 * never retried — a retry blocks ~2.1 s and drops input (constitution §6).
 */
export function createStartupPage(
  bridge: StartupBridge,
  page: PageContainer,
  log: BridgeLogger = consoleBridgeLogger,
): () => Promise<boolean> {
  let startup: Promise<boolean> | undefined;

  return () => {
    startup ??= createPageOnce(bridge, page, log);
    return startup;
  };
}

async function createPageOnce(
  bridge: StartupBridge,
  page: PageContainer,
  log: BridgeLogger,
): Promise<boolean> {
  const startedAt = performance.now();
  const result = await bridge.createStartUpPageContainer(page);

  log({
    call: 'createStartUpPageContainer',
    ms: performance.now() - startedAt,
    result,
  });

  return result === START_UP_PAGE_SUCCESS;
}
