/**
 * Every workaround for the pinned SDK (`@evenrealities/even_hub_sdk` 0.0.12)
 * lives here, so bumping the SDK is a one-file diff.
 *
 * `compressMode`: the SDK's `ImageRawDataUpdate.toJson()` spreads the instance
 * and then FORCES `compressMode: 2` (verified in `dist/index.js` of 0.0.12) —
 * an app-side value cannot override it. Even App < 2.2.7 mis-handles that
 * compressed path (the LZ4 regression behind spec 050 R5), which is why
 * `app.json` pins `min_app_version: 2.2.7` and why the companion page warns.
 * The constant below records what actually goes on the wire; if a later SDK
 * stops forcing it, set it here and nowhere else.
 *
 * `imageWidth`/`imageHeight` are not fields of the 0.0.12 model, but the model
 * keeps unknown keys (its constructor is `Object.assign`), so they are passed
 * through for hosts that expect them; the container's own rect is authoritative.
 */

export const COMPRESS_MODE = 2;

export interface ImageRawDataPayload {
  containerID: number;
  containerName: string;
  imageData: Uint8Array;
  imageWidth: number;
  imageHeight: number;
  compressMode: number;
}

export interface ImageRawDataInput {
  readonly containerID: number;
  readonly containerName: string;
  readonly imageData: Uint8Array;
  readonly imageWidth: number;
  readonly imageHeight: number;
}

/** The exact object handed to `updateImageRawData`, quirks included. */
export function imageRawDataPayload(
  input: ImageRawDataInput,
): ImageRawDataPayload {
  return {
    containerID: input.containerID,
    containerName: input.containerName,
    imageData: input.imageData,
    imageWidth: input.imageWidth,
    imageHeight: input.imageHeight,
    compressMode: COMPRESS_MODE,
  };
}

/** Minimum Even App version that decodes image payloads reliably (050 R5). */
export const MIN_EVEN_APP_VERSION = '2.2.7';
