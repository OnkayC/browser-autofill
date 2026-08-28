import browser from 'webextension-polyfill';
import { AutofillCoordinatorAdapter, AutofillFrameDescriptor, AutofillFrameFillRequest, AutofillFrameInspection, AutofillFrameResult, CoordinatedAutofillTrigger } from './AutofillCoordinator';

export class BrowserAutofillAdapter implements AutofillCoordinatorAdapter {
  async getFrames(tabId: number): Promise<AutofillFrameDescriptor[]> {
    const frames = await browser.webNavigation.getAllFrames({ tabId });
    return (frames ?? []).map(frame => ({
      frameId: frame.frameId,
      parentFrameId: frame.parentFrameId,
      url: frame.url
    }));
  }

  async inspectFrame(tabId: number, frame: AutofillFrameDescriptor, trigger: CoordinatedAutofillTrigger): Promise<AutofillFrameInspection | null> {
    try {
      return (await browser.tabs.sendMessage(tabId, { type: 'inspect-autofill', trigger }, { frameId: frame.frameId })) as AutofillFrameInspection;
    } catch {
      return null;
    }
  }

  async fillFrame(tabId: number, frame: AutofillFrameDescriptor, request: AutofillFrameFillRequest): Promise<AutofillFrameResult | null> {
    try {
      return (await browser.tabs.sendMessage(
        tabId,
        {
          type: 'fill-autofill',
          credential: request.credential,
          expectedFrameUrl: request.expectedFrameUrl,
          expectedRevision: request.expectedRevision,
          trigger: request.trigger
        },
        { frameId: frame.frameId }
      )) as AutofillFrameResult;
    } catch {
      return null;
    }
  }

  async confirmOriginMismatch(tabId: number, frame: AutofillFrameDescriptor, credentialOrigin: string, frameOrigin: string): Promise<boolean> {
    try {
      return Boolean(
        await browser.tabs.sendMessage(
          tabId,
          {
            type: 'confirm-autofill-origin',
            credentialOrigin,
            frameOrigin: frameOrigin === 'null' ? '' : frameOrigin
          },
          { frameId: frame.frameId }
        )
      );
    } catch {
      return false;
    }
  }
}
