import browser from 'webextension-polyfill';
import { AutofillRuleDocumentV1, AutofillRuleStorage, AutofillRuleStore } from './AutofillRuleStore';

export const autofillRulesStorageKey = 'autofill.rules.v1';

class BrowserAutofillRuleStorage implements AutofillRuleStorage {
  async load(): Promise<unknown> {
    const stored = await browser.storage.local.get(autofillRulesStorageKey);
    return stored[autofillRulesStorageKey] ?? null;
  }

  async save(document: AutofillRuleDocumentV1): Promise<void> {
    await browser.storage.local.set({ [autofillRulesStorageKey]: document });
  }
}

function selectorIsValid(selector: string): boolean {
  try {
    document.createDocumentFragment().querySelector(selector);
    return true;
  } catch {
    return false;
  }
}

export function createBrowserAutofillRuleStore(): AutofillRuleStore {
  return new AutofillRuleStore(new BrowserAutofillRuleStorage(), selectorIsValid);
}
