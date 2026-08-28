import browser from 'webextension-polyfill';
import './content.css';
import { ContentScriptManager } from './ContentScriptManager';
import { Utils } from '../Utils';

const contentScriptManager = new ContentScriptManager();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', afterDOMLoaded);
} else {
  afterDOMLoaded();
}

function afterDOMLoaded() {
  contentScriptManager.onDOMLoaded();
}

browser.runtime.onMessage.addListener((message): Promise<unknown> | void => {
  if (message.type === 'inspect-autofill') {
    return contentScriptManager.inspectAutofill(message.trigger);
  } else if (message.type === 'fill-autofill') {
    return contentScriptManager.fillCoordinated(message.credential, message.trigger, message.expectedFrameUrl, message.expectedRevision);
  } else if (message.type === 'confirm-autofill-origin') {
    return contentScriptManager.confirmOriginMismatch(message.credentialOrigin, message.frameOrigin);
  } else if (message.credential) {
    return contentScriptManager.autoFillWithCredential(message.credential, message.onLoadFill, null, false);
  } else if (message.restoreFocus) {
    contentScriptManager.iframeManager.restoreFocus();
  } else if (message.openCreateNewDialog) {
    if (Utils.isParentDocument()) {
      contentScriptManager.showCreateNewDialog();
    }
  } else if (message.openInlineMenu) {
    contentScriptManager.forceShowInlineMenuOnCurrentInput();
  }
});
