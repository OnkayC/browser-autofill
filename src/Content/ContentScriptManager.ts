import { AutoFillCredential } from '../Messaging/Protocol/AutoFillCredential';
import { GetStatusResponse } from '../Messaging/Protocol/GetStatusResponse';
import browser from 'webextension-polyfill';
import { CreateEntryRequest } from '../Messaging/Protocol/CreateEntryRequest';
import { CreateEntryResponse } from '../Messaging/Protocol/CreateEntryResponse';
import ReactDOM from 'react-dom/client';
import { Utils } from '../Utils';
import { GetGroupsResponse } from '../Messaging/Protocol/GetGroupsResponse';
import { GetGroupsRequest } from '../Messaging/Protocol/GetGroupsRequest';
import { GetNewEntryDefaultsRequest } from '../Messaging/Protocol/GetNewEntryDefaultsRequest';
import { GetNewEntryDefaultsResponse } from '../Messaging/Protocol/GetNewEntryDefaultsResponse';
import { GeneratePasswordRequest } from '../Messaging/Protocol/GeneratePasswordRequest';
import { GeneratePasswordResponse } from '../Messaging/Protocol/GeneratePasswordResponse';
import { UnlockResponse } from '../Messaging/Protocol/UnlockResponse';
import { AutofillEngine, AutofillInspection, AutofillResult, AutofillTrigger } from './Autofill/AutofillEngine';
import { autofillRulesStorageKey, createBrowserAutofillRuleStore } from './Autofill/BrowserAutofillRuleStorage';
import { SettingsStore } from '../Settings/SettingsStore';
import { LastKnownDatabasesItem, Settings } from '../Settings/Settings';
import { IframeComponentTypes, IframeManager } from './Iframe/iframeManager';
import { GeneratePasswordV2Response } from '../Messaging/Protocol/GeneratePasswordV2Response';
import { GetPasswordAndStrengthRequest } from '../Messaging/Protocol/GetPasswordAndStrengthRequest';
import { GetPasswordAndStrengthResponse } from '../Messaging/Protocol/GetPasswordAndStrengthResponse';
import { SearchResponse } from '../Messaging/Protocol/SearchResponse';
import { GetNewEntryDefaultsResponseV2 } from '../Messaging/Protocol/GetNewEntryDefaultsResponseV2';

export interface MainPageInformation {
  title: string;
  url: string;
  favIconBase64: string | null;
  favIconUrl: string | null;
  inlineMenuTruncatedHeight: string | null;
}

type CoordinatedAutofillInspection = AutofillInspection & {
  pageLoadAttempted: boolean;
};

export class ContentScriptManager {
  pageLoadFillDone = false;
  reactRoot: ReactDOM.Root;
  reactRootPopupMenu: ReactDOM.Root | null;
  currentInlineMenuInputElement: HTMLElement | null;
  iframeManager: IframeManager;
  hideInlineMenusForAWhile = false;
  showLargeTextView = false;
  private readonly autofillEngine: AutofillEngine;
  private readonly autofillRulesReady: Promise<void>;
  private readonly autofillRuleStore = createBrowserAutofillRuleStore();

  constructor() {
    this.iframeManager = new IframeManager(this);
    this.autofillEngine = new AutofillEngine(document);
    this.autofillRulesReady = this.autofillRuleStore
      .load()
      .then(rules => this.autofillEngine.replaceRules(rules))
      .catch(() => undefined);
    browser.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'local' && Object.prototype.hasOwnProperty.call(changes, autofillRulesStorageKey)) {
        void this.autofillRuleStore
          .load()
          .then(rules => this.autofillEngine.replaceRules(rules))
          .catch(() => undefined);
      }
    });
  }

  onDOMLoaded() {
    this.addFocusListener();

    this.autoShowInlineMenuIfFocusedInputRecognized();
  }

  async getStatus(): Promise<GetStatusResponse | null> {
    const ret = await browser.runtime.sendMessage({ type: 'get-status' });

    return ret;
  }

  async getCredentials(skip: number, take: number): Promise<AutoFillCredential[] | null> {
    const ret = await browser.runtime.sendMessage({
      type: 'get-credentials',
      details: { skip, take }
    });

    return ret;
  }

  async getIcon(databaseId: string, nodeId: string) {
    const ret = await browser.runtime.sendMessage({
      type: 'get-icon',
      details: { databaseId, nodeId }
    });

    return ret;
  }

  async getSearchCredentials(query: string, skip: number, take: number): Promise<SearchResponse | null> {
    const ret = await browser.runtime.sendMessage({
      type: 'get-search',
      details: { query, skip, take }
    });

    return ret;
  }

  async getGroups(request: GetGroupsRequest): Promise<GetGroupsResponse | null> {
    const ret = await browser.runtime.sendMessage({
      type: 'get-groups',
      details: request
    });

    return ret;
  }

  async launchStrongbox() {
    const ret = await browser.runtime.sendMessage({ type: 'launch-strongbox' });

    return ret;
  }

  async onCopyUsername(credential: AutoFillCredential) {
    await browser.runtime.sendMessage({
      type: 'copy-username',
      details: credential
    });
  }

  async onCopyPassword(credential: AutoFillCredential) {
    await browser.runtime.sendMessage({
      type: 'copy-password',
      details: credential
    });
  }

  async onCopyTotp(credential: AutoFillCredential) {
    await browser.runtime.sendMessage({
      type: 'copy-totp',
      details: credential
    });
  }

  async onCopy(value: string) {
    await browser.runtime.sendMessage({ type: 'copy-string', details: value });
  }

  async onLaunchUrl(url: string) {
    await browser.runtime.sendMessage({
      type: 'content-script-requests-url-launch',
      details: url
    });
  }

  async unlockDatabase(uuid: string): Promise<UnlockResponse | null> {
    const ret = await browser.runtime.sendMessage({
      type: 'unlock-database',
      details: {
        uuid: uuid
      }
    });

    return ret;
  }

  async getNewEntryDefaults(request: GetNewEntryDefaultsRequest): Promise<GetNewEntryDefaultsResponse | null> {
    const ret = await browser.runtime.sendMessage({
      type: 'get-new-entry-defaults',
      details: request
    });

    return ret;
  }

  async getNewEntryDefaultsV2(request: GetNewEntryDefaultsRequest): Promise<GetNewEntryDefaultsResponseV2 | null> {
    const ret = await browser.runtime.sendMessage({
      type: 'get-new-entry-defaults-v2',
      details: request
    });

    return ret;
  }

  async generatePassword(request: GeneratePasswordRequest): Promise<GeneratePasswordResponse | null> {
    const ret = await browser.runtime.sendMessage({
      type: 'generate-password',
      details: request
    });

    return ret;
  }

  async generatePasswordV2(): Promise<GeneratePasswordV2Response | null> {
    const ret = await browser.runtime.sendMessage({
      type: 'generate-password-v2'
    });

    return ret;
  }

  async getPasswordStrength(request: GetPasswordAndStrengthRequest): Promise<GetPasswordAndStrengthResponse | null> {
    const ret = await browser.runtime.sendMessage({
      type: 'get-password-strength',
      details: request
    });

    return ret;
  }

  async createNewEntry(details: CreateEntryRequest): Promise<CreateEntryResponse | null> {
    const ret = await browser.runtime.sendMessage({
      type: 'create-new-entry',
      details: details
    });

    return ret;
  }

  async copyTotpCodeIfConfiguredAfterFill(details: AutoFillCredential): Promise<void> {
    const ret = await browser.runtime.sendMessage({
      type: 'copy-totp-after-fill',
      details: details
    });

    return ret;
  }

  async getCurrentTab(): Promise<browser.Tabs.Tab | null> {
    const ret = await browser.runtime.sendMessage({
      type: 'get-tab-for-this-content-script'
    });

    return ret;
  }

  async onCreatedNewItem(credential: AutoFillCredential, message: string) {
    await this.onFillWithCredential(credential);

    setTimeout(() => {
      this.showNotificationToast(message);
    }, 300);
  }

  showNotificationToast(message: string) {
    this.iframeManager.initialize(IframeComponentTypes.NotificationToast, document.body as HTMLInputElement, false, message);
  }

  showCreateNewDialog() {
    this.iframeManager.initialize(IframeComponentTypes.CreateNewEntryDialog, document.body as HTMLInputElement, false);
  }

  async getFavIconBase64Data(url: string): Promise<string | null> {
    const testImg = document.createElement('img') as HTMLImageElement;
    if (testImg === null) {
      return null;
    }

    testImg.src = url;

    try {
      await testImg.decode();
    } catch (error) {
      return null;
    }

    const imageData = Utils.getImageElementBase64PNGData(testImg);

    if (imageData && imageData?.length > 20 * 1024) {
      return null;
    }

    const chromeDefaultFavIconHash = -1499456902;
    if (imageData == null || testImg.naturalHeight === 0) {
      return null;
    } else if (Utils.quickHashString(imageData) === chromeDefaultFavIconHash) {
      return null;
    }

    return imageData;
  }

  async getFavIconUrl(): Promise<string | null> {
    if (Utils.isFirefox()) {
      const thisTab = await this.getCurrentTab();
      return thisTab?.favIconUrl ?? null;
    } else {
      const url = new URL(browser.runtime.getURL('/_favicon/'));
      url.searchParams.set('pageUrl', document.location.href);
      url.searchParams.set('size', '128');
      return url.toString();
    }
  }

  handleSaveNewEntry(details: CreateEntryRequest) {
    return this.createNewEntry(details);
  }

  async getLastKnownAutoFillDatabases(): Promise<LastKnownDatabasesItem[]> {
    const stored = await SettingsStore.getSettings();
    return stored.lastKnownDatabases;
  }

  async shouldAutoShowInlineMenuOnFocus(): Promise<boolean> {
    const settings = await SettingsStore.getSettings();

    if (!this.showLargeTextView) {
      settings.uuidForLargeTextView = String();
      SettingsStore.setSettings(settings);
    }

    if (!Utils.isMacintosh()) {
      return false;
    }

    if (!settings.showInlineIconAndPopupMenu || Settings.isUrlIsInDoNotShowInlineMenusList(settings, document.location.href)) {
      return false;
    }

    if (!settings.showInlineIconAndPopupMenu || Settings.isUrlPageIsInDoNotShowInlineMenusList(settings, document.location.href)) {
      return false;
    }

    if (!settings.showInlineIconAndPopupMenu || this.hideInlineMenusForAWhile) {
      return false;
    }

    return true;
  }

  listen = false;
  focusOrBlurListener: EventListener = event => this.onFocusChanged(event);
  addFocusListener() {
    this.listen = true;
    document.addEventListener('focus', this.focusOrBlurListener, true);
    document.addEventListener('blur', this.focusOrBlurListener, true);
  }

  removeFocusListener() {
    this.listen = false;
    document.removeEventListener('focus', this.focusOrBlurListener, true);
    document.removeEventListener('blur', this.focusOrBlurListener, true);
  }

  timeout: NodeJS.Timeout | null;
  clearBlurTimeout() {
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }
  }

  async onFocusChanged(event: Event) {
    this.currentInlineMenuInputElement = null;

    if (!this.listen) {
      return;
    }

    this.clearBlurTimeout();

    if (event.type === 'blur') {
      this.timeout = setTimeout(() => {
        this.autoShowInlineMenuIfFocusedInputRecognized();
        this.timeout = null;
      }, 200);
    } else {
      this.autoShowInlineMenuIfFocusedInputRecognized();
    }
  }

  async autoShowInlineMenuIfFocusedInputRecognized() {
    await this.autofillRulesReady;
    if (document.activeElement && document.activeElement instanceof HTMLInputElement) {
      const focusedElement = document.activeElement as HTMLInputElement;

      const shouldRun = await this.shouldAutoShowInlineMenuOnFocus();
      if (!shouldRun) {
        return;
      }

      const inspection = await this.autofillEngine.inspect(focusedElement);
      const isRecognizedUsernameField = inspection.focusedRole === 'username';
      const isRecognizedPasswordField = inspection.focusedRole === 'current-password';

      if (isRecognizedUsernameField || isRecognizedPasswordField) {
        this.currentInlineMenuInputElement = focusedElement;

        this.showInlineMenuOnInputElement(focusedElement, isRecognizedPasswordField);
      } else {
      }
    } else {
    }
  }

  async forceShowInlineMenuOnCurrentInput() {
    await this.autofillRulesReady;
    if (!Utils.isMacintosh()) {
      return false;
    }

    if (document.activeElement && document.activeElement instanceof HTMLInputElement) {
      const focusedElement = document.activeElement as HTMLInputElement;

      this.currentInlineMenuInputElement = focusedElement;

      const inspection = await this.autofillEngine.inspect(focusedElement);
      const isLikelyPasswordField = inspection.focusedRole === 'current-password' || inspection.focusedRole === 'new-password' || focusedElement.type === 'password';

      await this.showInlineMenuOnInputElement(focusedElement, isLikelyPasswordField);
    } else {
    }
  }

  async showInlineMenuOnInputElement(fieldElement: HTMLInputElement, isPasswordField: boolean) {
    const status = await this.getStatus();

    if (status == null) {
    }

    this.iframeManager.initialize(IframeComponentTypes.InlineMiniFieldMenu, fieldElement, isPasswordField);
  }

  async getUnlockableDatabases(status: GetStatusResponse | null): Promise<LastKnownDatabasesItem[]> {
    if (status) {
      return status.databases.filter(database => database.autoFillEnabled && database.locked).map(database => new LastKnownDatabasesItem(database.nickName, database.uuid));
    } else {
      const stored = await SettingsStore.getSettings();
      return stored.lastKnownDatabases;
    }
  }

  async onFillWithCredential(credential: AutoFillCredential, inlineFieldInitiator: HTMLInputElement | null = null, inlineFieldInitiatorIsPassword = false) {
    await this.autoFillWithCredential(credential, false, inlineFieldInitiator, inlineFieldInitiatorIsPassword);
  }

  async onFillSingleField(text: string, inlineFieldInitiator: HTMLInputElement, appendValue = false) {
    await this.autoFillSingleField(text, inlineFieldInitiator, appendValue);
  }

  async autoFillWithCredential(
    credential: AutoFillCredential,
    isPageLoadFill = false,
    inlineFieldInitiator: HTMLInputElement | null = null,
    inlineFieldInitiatorIsPassword = false
  ): Promise<AutofillResult> {
    await this.autofillRulesReady;

    if (isPageLoadFill) {
      const settings = await SettingsStore.getSettings();
      if (Settings.isUrlInDoNotFillList(settings, document.location.href)) {
        return {
          passwordSatisfied: 0,
          reasons: ['disabled-for-site'],
          status: 'blocked',
          usernameSatisfied: 0
        };
      }

      if (this.pageLoadFillDone) {
        return {
          passwordSatisfied: 0,
          reasons: ['page-load-already-attempted'],
          status: 'blocked',
          usernameSatisfied: 0
        };
      }

      this.pageLoadFillDone = true;
    }

    this.removeFocusListener();

    const trigger: AutofillTrigger = isPageLoadFill ? 'page-load' : inlineFieldInitiator ? 'inline' : 'toolbar';
    if (trigger === 'inline' && this.isCrossOriginFrame()) {
      const credentialOrigin = this.safeOrigin(credential.url);
      const frameOrigin = this.safeOrigin(document.location.href);
      if (credentialOrigin !== frameOrigin) {
        const confirmed = await this.iframeManager.confirmAutofillWarning({
          credentialOrigin,
          frameOrigin,
          kind: 'origin-mismatch'
        });
        if (!confirmed) {
          this.addFocusListener();
          return {
            passwordSatisfied: 0,
            reasons: ['untrusted-frame'],
            status: 'blocked',
            usernameSatisfied: 0
          };
        }
      }
    }
    const allowNewPassword =
      trigger === 'inline' && inlineFieldInitiatorIsPassword && (await this.autofillEngine.inspect(inlineFieldInitiator)).focusedRole === 'new-password'
        ? await this.iframeManager.confirmAutofillWarning({
            kind: 'new-password'
          })
        : false;
    const filled = await this.autofillEngine.fill({
      allowNewPassword,
      credential,
      initiator: inlineFieldInitiator,
      trigger
    });

    setTimeout(() => {
      this.addFocusListener();
    }, 500);

    if (filled.usernameSatisfied + filled.passwordSatisfied > 0) {
      this.iframeManager.remove();
      if (filled.status === 'complete' && filled.passwordSatisfied > 0) {
        this.copyTotpCodeIfConfiguredAfterFill(credential);
      }
    }

    return filled;
  }

  async autoFillSingleField(text: string, inlineFieldInitiator: HTMLInputElement, appendValue = false): Promise<void> {
    await this.autofillRulesReady;

    this.removeFocusListener();

    this.autofillEngine.fillSingleField(inlineFieldInitiator, text, appendValue);

    setTimeout(() => {
      this.addFocusListener();
    }, 500);

    if (!appendValue) {
      this.iframeManager.remove();
    }
  }

  async inspectAutofill(trigger?: 'page-load' | 'toolbar'): Promise<CoordinatedAutofillInspection> {
    await this.autofillRulesReady;
    const activeElement = document.activeElement instanceof HTMLInputElement ? document.activeElement : null;
    const inspection = await this.autofillEngine.inspect(activeElement);
    return {
      ...inspection,
      candidateCount: trigger === 'page-load' && this.pageLoadFillDone ? 0 : inspection.candidateCount,
      pageLoadAttempted: this.pageLoadFillDone
    };
  }

  async fillCoordinated(credential: AutoFillCredential, trigger: 'page-load' | 'toolbar', expectedFrameUrl: string, expectedRevision: number): Promise<AutofillResult> {
    const inspection = await this.autofillEngine.inspect();
    if (inspection.frameUrl !== expectedFrameUrl || inspection.revision !== expectedRevision) {
      return {
        passwordSatisfied: 0,
        reasons: ['stale-frame'],
        status: 'blocked',
        usernameSatisfied: 0
      };
    }
    return this.autoFillWithCredential(credential, trigger === 'page-load');
  }

  confirmOriginMismatch(credentialOrigin: string, frameOrigin: string): Promise<boolean> {
    return this.iframeManager.confirmAutofillWarning({
      credentialOrigin,
      frameOrigin,
      kind: 'origin-mismatch'
    });
  }

  private isCrossOriginFrame(): boolean {
    if (window.top === window) {
      return false;
    }
    try {
      return window.top?.location.origin !== window.location.origin;
    } catch {
      return true;
    }
  }

  private safeOrigin(url: string): string {
    try {
      return new URL(url).origin;
    } catch {
      return 'unknown';
    }
  }
}
