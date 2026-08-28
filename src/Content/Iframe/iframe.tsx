import React from 'react';
import { Root, createRoot } from 'react-dom/client';
import browser from 'webextension-polyfill';

import { createTheme, ThemeProvider } from '@mui/material/styles';
import { CacheProvider } from '@emotion/react';
import createCache from '@emotion/cache';

import { Utils } from '../../Utils';
import { ContentScriptManager, MainPageInformation } from '../ContentScriptManager';
import { IframeMessageTypes, IframeComponentTypes } from './iframeManager';
import { connectIframeParentChannel, postToIframeParent } from './IframeParentChannel';

import CreateNewEntryDialog from '../CreateNewEntryDialog';
import NotificationToast from '../NotificationToast';
import InlineMiniFieldMenu from '../InlineMiniFieldMenu';
import AutofillWarningDialog, { AutofillWarningData } from '../AutofillWarningDialog';

import { CustomStyleProvider, useCustomStyle } from '../../Contexts/CustomStyleContext';

import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { config } from '../../Localization/config';
import { NativeAppApi } from '../../Messaging/NativeAppApi';
import { defaultIFrameExtraHeight, defaultIFrameExtraWidth } from '../../SizeHandler';

const contentScriptManager = new ContentScriptManager();
const iframeRoot = document.getElementById('strongbox-autofill-iframe-root') ?? new HTMLElement();
const root: Root = createRoot(iframeRoot);

const emotionRoot = document.createElement('style');
document.head.appendChild(emotionRoot);
const cache = createCache({
  key: 'css',
  prepend: true,
  container: emotionRoot
});

function StyleWrapper({ children }: { children: React.ReactNode }) {
  const { getCustomStyle } = useCustomStyle();

  const theme = createTheme(getCustomStyle());

  return (
    <CacheProvider value={cache}>
      <ThemeProvider theme={theme}>{children}</ThemeProvider>
    </CacheProvider>
  );
}

async function render(iframeComponentType: IframeComponentTypes, data: MainPageInformation | string | AutofillWarningData) {
  i18next.init(config);

  const component = await build(iframeComponentType, data);

  root.render(
    <I18nextProvider i18n={i18next}>
      <CustomStyleProvider>
        <StyleWrapper>{component}</StyleWrapper>
      </CustomStyleProvider>
    </I18nextProvider>
  );

  setTimeout(() => {
    resize();
  }, 50);
}

async function build(iframeComponentType: IframeComponentTypes, data: MainPageInformation | string | AutofillWarningData) {
  switch (iframeComponentType) {
    case IframeComponentTypes.InlineMiniFieldMenu:
      return await buildInlineMiniFieldMenu(data as MainPageInformation);
    case IframeComponentTypes.CreateNewEntryDialog:
      return await buildCreateNewEntryDialog(data as MainPageInformation);
    case IframeComponentTypes.NotificationToast:
      return await buildNotificationToast(data as string);
    case IframeComponentTypes.AutofillWarning:
      return buildAutofillWarning(data as AutofillWarningData);
  }
}

function buildAutofillWarning(data: AutofillWarningData) {
  return React.createElement(AutofillWarningDialog, {
    data,
    onCancel: () => postToIframeParent({ type: IframeMessageTypes.cancelAutofillWarning }),
    onConfirm: () => postToIframeParent({ type: IframeMessageTypes.confirmAutofillWarning })
  });
}

async function buildInlineMiniFieldMenu(mainPageInformation: MainPageInformation) {
  const nativeAppApi = NativeAppApi.getInstance();

  const status = await contentScriptManager.getStatus();
  const showCreateNew = status?.serverSettings?.supportsCreateNew ?? false;
  const unlockedDatabaseAvailable = status ? status.databases.filter(database => database.autoFillEnabled && !database.locked).length != 0 : false;

  const unlockableDatabases = await contentScriptManager.getUnlockableDatabases(status);

  const credentials = status == null ? [] : ((await contentScriptManager.getCredentials(0, nativeAppApi.credentialResultsPageSize)) ?? []);

  const menuComponent = React.createElement(InlineMiniFieldMenu, {
    status,
    url: mainPageInformation.url,
    inlineMenuTruncatedHeight: mainPageInformation.inlineMenuTruncatedHeight,
    unlockedDatabaseAvailable,
    showCreateNew: showCreateNew && unlockedDatabaseAvailable,
    credentials,
    unlockableDatabases: unlockableDatabases,
    getCredentials: async (skip: number, take: number) => {
      return (await contentScriptManager.getCredentials(skip, take)) ?? [];
    },
    onCreateNewEntry: () => {
      postToIframeParent({
        type: IframeMessageTypes.showCreateNewEntryDialog,
        data: mainPageInformation
      });
    },
    onUnlockDatabase: async (databaseUuid: string) => {
      const unlockResponse = await contentScriptManager.unlockDatabase(databaseUuid);
      return unlockResponse;
    },
    onFillWithCredential: async credential => {
      postToIframeParent({
        type: IframeMessageTypes.onFillWithCredential,
        data: credential
      });
    },
    onFillSingleField: async (text, appendValue) => {
      postToIframeParent({
        type: IframeMessageTypes.onFillSingleField,
        data: { text, appendValue }
      });
    },
    onCopyUsername: credential => {
      contentScriptManager.onCopyUsername(credential);
    },
    onCopyPassword: credential => {
      contentScriptManager.onCopyPassword(credential);
    },
    onCopyTotp: credential => {
      contentScriptManager.onCopyTotp(credential);
    },
    onCopy: async text => {
      postToIframeParent({ type: IframeMessageTypes.onCopy, data: text });
      return true;
    },
    onRedirectUrl: url => {
      postToIframeParent({ type: IframeMessageTypes.onRedirectUrl, data: url });
    },
    refreshInlineMenu: async () => {
      postToIframeParent({
        type: IframeMessageTypes.backToInlineMiniFieldMenu
      });
    },
    beforeOpenSubMenu: (showDetails = false, restoreIframeSize = false) => {
      if (restoreIframeSize) {
        resize();
        return;
      }

      if (showDetails) {
        resize(330, 220);
      } else {
        if (iframeRoot.offsetHeight < 180) {
          resize(undefined, 120);
        }
      }
    },
    hideInlineMenusForAWhile: () => {
      postToIframeParent({ type: IframeMessageTypes.hideInlineMenusForAWhile });
    },
    showLargeTextView: () => {
      postToIframeParent({ type: IframeMessageTypes.showLargeTextView });
    },
    notifyAction: message => {
      postToIframeParent({
        type: IframeMessageTypes.showNotificationToast,
        data: message
      });
    },
    searchCredentials: async (query: string, skip: number, take: number) => {
      return await contentScriptManager.getSearchCredentials(query, skip, take);
    },
    getIcon: async (databaseId: string, nodeId: string) => {
      return await contentScriptManager.getIcon(databaseId, nodeId);
    },
    resize
  });

  return menuComponent;
}

async function buildCreateNewEntryDialog({ title, url, favIconBase64, favIconUrl }: MainPageInformation) {
  const createNewEntryDialog = React.createElement(CreateNewEntryDialog, {
    title,
    url,
    favIconBase64,
    favIconUrl,
    getStatus: async () => {
      const status = await contentScriptManager.getStatus();
      return status;
    },
    getGroups: async request => {
      const response = await contentScriptManager.getGroups(request);
      return response;
    },
    getNewEntryDefaultsV2: async request => {
      const response = await contentScriptManager.getNewEntryDefaultsV2(request);
      return response;
    },
    generatePasswordV2: async () => {
      const response = await contentScriptManager.generatePasswordV2();
      return response;
    },
    getPasswordStrength: async request => {
      const response = await contentScriptManager.getPasswordStrength(request);
      return response;
    },
    onCreate: async details => {
      const response = await contentScriptManager.createNewEntry(details);
      return response;
    },
    onCreatedItem: (credential, message) => {
      postToIframeParent({
        type: IframeMessageTypes.onCreatedNewItem,
        data: { credential, message }
      });
    },
    key: Utils.getUUIDString(),
    unlockDatabase: async uuid => {
      const response = await contentScriptManager.unlockDatabase(uuid);
      return response;
    },
    handleClose: () => {
      postToIframeParent({ type: IframeMessageTypes.remove });
    },
    notifyAction: message => {
      postToIframeParent({
        type: IframeMessageTypes.showNotificationToast,
        data: message
      });
    }
  });

  return createNewEntryDialog;
}

async function buildNotificationToast(message: string) {
  const snackbar = React.createElement(NotificationToast, {
    message,
    handleClose: () => {
      postToIframeParent({ type: IframeMessageTypes.remove });
    }
  });

  return snackbar;
}

function resize(extraWidth = defaultIFrameExtraWidth, extraHeight = defaultIFrameExtraHeight) {
  const children = iframeRoot.children[0] as HTMLElement;
  if (children) {
    postToIframeParent({
      type: IframeMessageTypes.resize,
      data: {
        width: `${children.offsetWidth + extraWidth}px`,
        height: `${children.offsetHeight + extraHeight}px`
      }
    });
  }
}

function onIFrameKeyup(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    postToIframeParent({
      type: IframeMessageTypes.remove
    });
  } else if (event.key === 'ArrowLeft') {
    const focusableElements = document.querySelectorAll('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])');

    const activeElement = document.activeElement;
    if (activeElement) {
      const index = Array.from(focusableElements).indexOf(activeElement);

      if (index !== -1 && index > 0) {
        const el = focusableElements[index - 1] as HTMLElement;
        el.focus();
      }
    }
  } else if (event.key === 'ArrowRight') {
    const focusableElements = document.querySelectorAll('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])');

    const activeElement = document.activeElement;
    if (activeElement) {
      const index = Array.from(focusableElements).indexOf(activeElement);
      if (index !== -1 && index < focusableElements.length - 1) {
        const el = focusableElements[index + 1] as HTMLElement;
        el.focus();
      }
    }
  }
}

function initScrollbars(showScrollbars: boolean) {
  if (!showScrollbars) {
    const styleElement = document.createElement('style');

    const cssRules = `
          div::-webkit-scrollbar { width: 0; display: none; } 
          div { overflow: -moz-scrollbars-none; -ms-overflow-style: none; scrollbar-width: none; }`;

    styleElement.innerHTML = cssRules;
    styleElement.id = 'hide-scrollbar-style';
    document.head.appendChild(styleElement);
  }
}

async function onMessageReceivedFromMainPage(event: MessageEvent) {
  if (event.data?.type !== IframeMessageTypes.render) {
    return;
  }

  const port = event.ports[0];
  const rejectChannel = () => {
    port?.postMessage({ type: IframeMessageTypes.remove });
    port?.close();
  };
  const channelToken = event.data?.data?.channelToken;
  if (!port || typeof channelToken !== 'string' || !/^[a-f0-9]{64}$/.test(channelToken)) {
    rejectChannel();
    return;
  }

  let channelClaimed = false;
  try {
    channelClaimed = await browser.runtime.sendMessage({
      type: 'claim-iframe-channel',
      details: { token: channelToken }
    });
  } catch {
    rejectChannel();
    return;
  }

  if (!channelClaimed) {
    rejectChannel();
    return;
  }

  connectIframeParentChannel(port);
  window.removeEventListener('message', onMessageReceivedFromMainPage);

  const iframeComponentType = event.data.data.iframeComponentType as IframeComponentTypes;
  switch (iframeComponentType) {
    case IframeComponentTypes.InlineMiniFieldMenu:
    case IframeComponentTypes.CreateNewEntryDialog: {
      const { showScrollbars } = event.data.data;
      initScrollbars(showScrollbars);

      const mainPageInformation: MainPageInformation = event.data.data.mainPageInformation;
      await render(iframeComponentType, mainPageInformation);
      break;
    }
    case IframeComponentTypes.NotificationToast: {
      const message: string = event.data.data.message;
      await render(iframeComponentType, message);
      break;
    }
    case IframeComponentTypes.AutofillWarning: {
      const warning = event.data.data.warning as AutofillWarningData;
      await render(iframeComponentType, warning);
      break;
    }
    default:
      break;
  }
}

window.addEventListener('message', onMessageReceivedFromMainPage);

window.addEventListener('keyup', onIFrameKeyup);
