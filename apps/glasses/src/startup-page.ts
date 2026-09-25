/**
 * The page the glasses show, created exactly once (constitution §6). Layout is
 * the table in the `g2-hud-display` skill (Maxx, 2026-09-25 design round 4).
 *
 * Image mode, 7 containers: the full-canvas `bg`, FOUR 288×48 image containers
 * along the top and bottom edges (the two HUD strips, each split at x 288), the
 * `msg` text in the centre band and the `status` text on the right border. The
 * pinned SDK (0.0.12) caps a page at 4 image / 8 text / 12 containers.
 *
 * Text mode, 4 containers: `bg`, one `hud` text container in slot 2, `msg`,
 * `status` — the page the mid-session fallback rebuilds to. Slot 2 is `stripTL`
 * in image mode and `hud` in text mode, so both pages number their containers
 * 1..n without gaps.
 */

import {
  consoleBridgeLogger,
  START_UP_PAGE_SUCCESS,
  type BridgeLogger,
  type ImageContainer,
  type PageContainer,
  type TextContainer,
} from './bridge.ts';
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  HALF_WIDTH,
  STRIP_HEIGHT,
  STRIP_Y,
  type StripId,
} from './render/hud-design.ts';
import type { RenderMode } from './render/mode.ts';

export type { PageContainer, TextContainer, ImageContainer };
/** Kept for the pre-existing import name. */
export type StartupPage = PageContainer;

export const CONTAINER_BG = 1;
/** Text mode only: the single text HUD (`renderText`). */
export const CONTAINER_HUD = 2;
export const CONTAINER_MSG = 3;
export const CONTAINER_STATUS = 4;
/** Image mode only: the four HUD strip halves. `stripTL` reuses slot 2. */
export const CONTAINER_STRIP_TL = 2;
export const CONTAINER_STRIP_TR = 5;
export const CONTAINER_STRIP_BL = 6;
export const CONTAINER_STRIP_BR = 7;

/** Names of the text containers (slot 2 is `hud` here: the text-mode page). */
export const CONTAINER_NAMES = {
  [CONTAINER_BG]: 'bg',
  [CONTAINER_HUD]: 'hud',
  [CONTAINER_MSG]: 'msg',
  [CONTAINER_STATUS]: 'status',
} as const;

export interface StripContainer {
  readonly containerID: number;
  readonly containerName: string;
  readonly strip: StripId;
  /** 0 = left half of the strip (x 0..287), 1 = right half (x 288..575). */
  readonly half: 0 | 1;
  readonly zOrderIndex: number;
}

/**
 * The four image containers, in send priority order: the lane strip first.
 * Rects come from `hud-design.ts` (`STRIP_Y`, `HALF_WIDTH`, `STRIP_HEIGHT`).
 */
export const STRIP_CONTAINERS: readonly StripContainer[] = [
  {
    containerID: CONTAINER_STRIP_TL,
    containerName: 'stripTL',
    strip: 'top',
    half: 0,
    zOrderIndex: 6,
  },
  {
    containerID: CONTAINER_STRIP_TR,
    containerName: 'stripTR',
    strip: 'top',
    half: 1,
    zOrderIndex: 7,
  },
  {
    containerID: CONTAINER_STRIP_BL,
    containerName: 'stripBL',
    strip: 'bottom',
    half: 0,
    zOrderIndex: 8,
  },
  {
    containerID: CONTAINER_STRIP_BR,
    containerName: 'stripBR',
    strip: 'bottom',
    half: 1,
    zOrderIndex: 9,
  },
];

/** SDK 0.0.12 `CreateStartUpPageContainer` / `RebuildPageContainer` caps. */
export const SDK_MAX_IMAGE_CONTAINERS = 4;
export const SDK_MAX_TEXT_CONTAINERS = 8;
export const SDK_MAX_CONTAINERS = 12;

/**
 * Text-mode HUD: two short lines at the top centre, clear of the message band.
 */
const HUD_TEXT_X = 144;
const HUD_TEXT_Y = 8;
const HUD_TEXT_WIDTH = 288;
const HUD_TEXT_HEIGHT = 96;

/**
 * Message in the centre band (a message is meant to be read). It stops at
 * x 520 so it clears the status strip on the right border.
 */
const MSG_X = 16;
const MSG_Y = 112;
const MSG_WIDTH = 504;
const MSG_HEIGHT = 64;

/** `L`/`S`, small, on the right border at mid-height. */
const STATUS_X = 528;
const STATUS_Y = 124;
const STATUS_WIDTH = 40;
const STATUS_HEIGHT = 28;

export const STATUS_TEXT_COLOR = 2;

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
    width: CANVAS_WIDTH,
    height: CANVAS_HEIGHT,
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
    xPosition: HUD_TEXT_X,
    yPosition: HUD_TEXT_Y,
    width: HUD_TEXT_WIDTH,
    height: HUD_TEXT_HEIGHT,
    paddingLength: 4,
    zOrderIndex: 3,
    textColor: 4,
    content,
  });
}

function stripImage(container: StripContainer): ImageContainer {
  return {
    containerID: container.containerID,
    containerName: container.containerName,
    xPosition: container.half * HALF_WIDTH,
    yPosition: STRIP_Y[container.strip],
    width: HALF_WIDTH,
    height: STRIP_HEIGHT,
    zOrderIndex: container.zOrderIndex,
  };
}

function messageContainer(content: string): TextContainer {
  return text({
    containerID: CONTAINER_MSG,
    containerName: CONTAINER_NAMES[CONTAINER_MSG],
    xPosition: MSG_X,
    yPosition: MSG_Y,
    width: MSG_WIDTH,
    height: MSG_HEIGHT,
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
    xPosition: STATUS_X,
    yPosition: STATUS_Y,
    width: STATUS_WIDTH,
    height: STATUS_HEIGHT,
    paddingLength: 2,
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

/** Builds the page for either render mode (7 containers image, 4 text). */
export function buildPage(content: PageContent): PageContainer {
  const message = messageContainer(content.message ?? '');
  const status = statusContainer(content.status);

  if (content.mode === 'text') {
    return {
      containerTotalNum: 4,
      textObject: [background(), hudText(content.hud ?? ''), message, status],
    };
  }

  const imageObject = STRIP_CONTAINERS.map(stripImage);
  const textObject = [background(), message, status];
  return {
    containerTotalNum: textObject.length + imageObject.length,
    textObject,
    imageObject,
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
