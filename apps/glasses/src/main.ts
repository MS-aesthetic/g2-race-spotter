import {
  CreateStartUpPageContainer,
  TextContainerProperty,
  waitForEvenAppBridge,
} from '@evenrealities/even_hub_sdk';

import { createStartupPage, type StartupPage } from './startup-page';

const bridge = await waitForEvenAppBridge();
const startPage = createStartupPage({
  async createStartUpPageContainer(page: StartupPage): Promise<number> {
    return Number(
      await bridge.createStartUpPageContainer(
        new CreateStartUpPageContainer({
          ...page,
          textObject: page.textObject.map(
            (container) => new TextContainerProperty(container),
          ),
        }),
      ),
    );
  },
});

void startPage();
