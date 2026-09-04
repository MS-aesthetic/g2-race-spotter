/**
 * The ONLY file that imports `@evenrealities/even_hub_sdk`. Tests never load
 * it; everything else in the app talks to the `Bridge` interface.
 *
 * Notes on 0.0.12, all verified against `dist/index.d.ts`:
 * - the container models drop nothing on construction (`Object.assign`), so the
 *   extra keys the host reads (`textColor`) survive even though the .d.ts has
 *   no field for them;
 * - `createStartUpPageContainer` resolves to a numeric `StartUpPageCreateResult`
 *   (0 = success);
 * - `updateImageRawData` resolves to the string enum `ImageRawDataUpdateResult`.
 */

import {
  CreateStartUpPageContainer,
  ImageContainerProperty,
  ImageRawDataUpdate,
  ImageRawDataUpdateResult,
  RebuildPageContainer,
  TextContainerProperty,
  TextContainerUpgrade,
  waitForEvenAppBridge,
} from '@evenrealities/even_hub_sdk';

import type {
  Bridge,
  ImageContainer,
  ImageRawData,
  ImageSendResult,
  PageContainer,
  TextContainer,
  TextUpgrade,
} from './bridge.ts';

function textProperty(container: TextContainer): TextContainerProperty {
  const { textColor, ...modelled } = container;

  // `textColor` is not in the 0.0.12 model but the host honours it; assigning
  // it after construction keeps the SDK-shaped fields type-checked.
  return Object.assign(new TextContainerProperty(modelled), { textColor });
}

function imageProperty(container: ImageContainer): ImageContainerProperty {
  return new ImageContainerProperty(container);
}

function pageFields(page: PageContainer): {
  containerTotalNum: number;
  textObject: TextContainerProperty[];
  imageObject?: ImageContainerProperty[];
} {
  return {
    containerTotalNum: page.containerTotalNum,
    textObject: page.textObject.map(textProperty),
    ...(page.imageObject === undefined
      ? {}
      : { imageObject: page.imageObject.map(imageProperty) }),
  };
}

function imageUpdate(payload: ImageRawData): ImageRawDataUpdate {
  const { containerID, containerName, imageData, ...extra } = payload;

  return Object.assign(
    new ImageRawDataUpdate({ containerID, containerName, imageData }),
    extra,
  );
}

function sendResult(raw: ImageRawDataUpdateResult): ImageSendResult {
  return ImageRawDataUpdateResult.normalize(raw) as ImageSendResult;
}

export async function createEvenBridge(): Promise<Bridge> {
  const bridge = await waitForEvenAppBridge();

  return {
    async createStartUpPageContainer(page: PageContainer): Promise<number> {
      return Number(
        await bridge.createStartUpPageContainer(
          new CreateStartUpPageContainer(pageFields(page)),
        ),
      );
    },

    async rebuildPageContainer(page: PageContainer): Promise<boolean> {
      return bridge.rebuildPageContainer(
        new RebuildPageContainer(pageFields(page)),
      );
    },

    async updateImageRawData(payload: ImageRawData): Promise<ImageSendResult> {
      return sendResult(await bridge.updateImageRawData(imageUpdate(payload)));
    },

    async textContainerUpgrade(update: TextUpgrade): Promise<boolean> {
      return bridge.textContainerUpgrade(new TextContainerUpgrade(update));
    },

    async shutDownPageContainer(exitMode: number): Promise<boolean> {
      return bridge.shutDownPageContainer(exitMode);
    },

    async getLocalStorage(key: string): Promise<string | null> {
      const value = await bridge.getLocalStorage(key);
      return value === undefined || value === '' ? null : value;
    },

    async setLocalStorage(key: string, value: string): Promise<boolean> {
      return bridge.setLocalStorage(key, value);
    },

    onEvenHubEvent(listener: (event: unknown) => void): () => void {
      return bridge.onEvenHubEvent(listener);
    },
  };
}
