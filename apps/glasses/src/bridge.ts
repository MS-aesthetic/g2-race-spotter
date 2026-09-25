/**
 * The subset of the Even Hub bridge this app uses, as a plain interface.
 *
 * Everything above this line is pure TypeScript that runs in Node: tests fake
 * this interface and never import `@evenrealities/even_hub_sdk`. The single
 * file that touches the real SDK is `even-bridge.ts`, which no test imports.
 */

export interface TextContainer {
  containerID: number;
  containerName: string;
  xPosition: number;
  yPosition: number;
  width: number;
  height: number;
  borderWidth: number;
  borderColor: number;
  paddingLength: number;
  isEventCapture: number;
  zOrderIndex: number;
  textColor: number;
  content: string;
}

export interface ImageContainer {
  containerID: number;
  containerName: string;
  xPosition: number;
  yPosition: number;
  width: number;
  height: number;
  zOrderIndex: number;
}

export interface PageContainer {
  containerTotalNum: number;
  textObject: TextContainer[];
  imageObject?: ImageContainer[];
}

export interface TextUpgrade {
  containerID: number;
  containerName: string;
  content: string;
}

/** Host result of `updateImageRawData`, normalised to the SDK's enum names. */
export type ImageSendResult =
  | 'success'
  | 'imageException'
  | 'imageSizeInvalid'
  | 'imageToGray4Failed'
  | 'sendFailed';

export interface ImageRawData {
  containerID: number;
  containerName: string;
  imageData: Uint8Array;
  imageWidth: number;
  imageHeight: number;
  compressMode: number;
}

/** `0 = success` (`StartUpPageCreateResult.success`). */
export const START_UP_PAGE_SUCCESS = 0;

export interface Bridge {
  createStartUpPageContainer(page: PageContainer): Promise<number>;
  rebuildPageContainer(page: PageContainer): Promise<boolean>;
  updateImageRawData(payload: ImageRawData): Promise<ImageSendResult>;
  textContainerUpgrade(update: TextUpgrade): Promise<boolean>;
  shutDownPageContainer(exitMode: number): Promise<boolean>;
  getLocalStorage(key: string): Promise<string | null>;
  setLocalStorage(key: string, value: string): Promise<boolean>;
  /** Subscribes to host events; returns an unsubscribe function. */
  onEvenHubEvent(listener: (event: unknown) => void): () => void;
}

/**
 * Spec 030 R7: every bridge call is timed and logged as `{call, ms, result}`,
 * plus the target `container` name for calls that address one container.
 */
export interface BridgeCallLog {
  call: string;
  ms: number;
  result: unknown;
  container?: string;
}

export type BridgeLogger = (entry: BridgeCallLog) => void;

export const consoleBridgeLogger: BridgeLogger = (entry) => {
  console.info('g2rs.bridge', entry);
};
