/**
 * The page the glasses show, created exactly once (constitution §6). Layout is
 * the table in the `g2-hud-display` skill (Maxx, 2026-10-01 design round 6).
 *
 * Image mode, 6 containers: the full-canvas `bg`, FOUR image containers along
 * the top and bottom edges (the two HUD strips, each split at x 288: 288×96 on
 * top, 288×144 below) and the `status` text on the right border. There is no
 * `msg` text container: the message is drawn into the top strip as a bitmap
 * (the SDK text container has one fixed, small font). The pinned SDK (0.0.12)
 * caps a page at 4 image / 8 text / 12 containers.
 *
 * Text mode, 4 containers: `bg`, one `hud` text container in slot 2 (bottom
 * centre), `msg` (upper middle), `status` — the page the mid-session fallback
 * rebuilds to. Slots 2 and 3 are `stripTL`/`stripTR` in image mode and
 * `hud`/`msg` in text mode, and `status` is 4 in both, so both pages number
 * their containers 1..n without gaps.
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
  STRIP_HEIGHTS,
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
/** Text mode only: the message (image mode draws it into the top strip). */
export const CONTAINER_MSG = 3;
export const CONTAINER_STATUS = 4;
/**
 * Image mode only: the four HUD strip halves. `stripTL` and `stripTR` reuse
 * the text page's slots 2 and 3 (`hud`, `msg`).
 */
export const CONTAINER_STRIP_TL = 2;
export const CONTAINER_STRIP_TR = 3;
export const CONTAINER_STRIP_BL = 5;
export const CONTAINER_STRIP_BR = 6;

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
 * Rects come from `hud-design.ts` (`STRIP_Y`, `HALF_WIDTH`, `STRIP_HEIGHTS`).
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
 * Text-mode HUD: two short lines at the bottom centre, because the message
 * owns the upper middle. Text mode has no image strips, so these rects are
 * its own (unchanged since design round 5), not derived from `STRIP_Y`.
 */
const HUD_TEXT_X = 144;
const HUD_TEXT_Y = 192;
const HUD_TEXT_WIDTH = 288;
const HUD_TEXT_HEIGHT = 96;

/**
 * Text-mode message, upper middle under where the ▲ is in image mode (Maxx,
 * design round 5: "Put text upper middle below the top rectangle"), centred
 * on the seam.
 */
const MSG_WIDTH = 288;
const MSG_X = HALF_WIDTH - MSG_WIDTH / 2;
const MSG_Y = 52;
const MSG_HEIGHT = 48;

/**
 * `L`/`S`, small, on the right border in the band between the strips (image
 * mode: canvas y 96–143; round 6 moved it up from 124 to stay clear of the
 * 144-px bottom strip). The same rect in text mode, so it does not jump on a
 * fallback.
 */
const STATUS_X = 528;
const STATUS_Y = 108;
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
    height: STRIP_HEIGHTS[container.strip],
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
  /** Text-mode message; ignored in image mode (the top strip draws it). */
  readonly message?: string;
  /** Text-mode HUD content; ignored in image mode. */
  readonly hud?: string;
}

/** Builds the page for either render mode (6 containers image, 4 text). */
export function buildPage(content: PageContent): PageContainer {
  const status = statusContainer(content.status);

  if (content.mode === 'text') {
    return {
      containerTotalNum: 4,
      textObject: [
        background(),
        hudText(content.hud ?? ''),
        messageContainer(content.message ?? ''),
        status,
      ],
    };
  }

  const imageObject = STRIP_CONTAINERS.map(stripImage);
  const textObject = [background(), status];
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
