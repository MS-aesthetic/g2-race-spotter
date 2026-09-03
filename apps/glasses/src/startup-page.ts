export interface TextContainer {
  borderColor: number;
  borderWidth: number;
  containerID: number;
  containerName: string;
  content: string;
  height: number;
  isEventCapture: number;
  paddingLength: number;
  width: number;
  xPosition: number;
  yPosition: number;
}

export interface StartupPage {
  containerTotalNum: number;
  textObject: TextContainer[];
}

export interface StartupBridge {
  createStartUpPageContainer(page: StartupPage): Promise<number>;
}

export const startupPage: StartupPage = {
  containerTotalNum: 1,
  textObject: [
    {
      xPosition: 0,
      yPosition: 0,
      width: 576,
      height: 288,
      borderWidth: 0,
      borderColor: 0,
      paddingLength: 4,
      containerID: 1,
      containerName: 'greeting',
      content: 'Hello, driver',
      isEventCapture: 1,
    },
  ],
};

export function createStartupPage(
  bridge: StartupBridge,
): () => Promise<boolean> {
  let startup: Promise<boolean> | undefined;

  return () => {
    startup ??= createPageOnce(bridge);
    return startup;
  };
}

async function createPageOnce(bridge: StartupBridge): Promise<boolean> {
  const startedAt = performance.now();
  const result = await bridge.createStartUpPageContainer(startupPage);

  console.info('g2rs.bridge', {
    call: 'createStartUpPageContainer',
    ms: performance.now() - startedAt,
    result,
  });

  return result === 0;
}
