import type { AutofillSiteRule } from './AutofillEngine';

export interface StoredAutofillSiteRule extends AutofillSiteRule {
  enabled?: boolean;
}

export interface AutofillRuleDocumentV1 {
  rules: StoredAutofillSiteRule[];
  version: 1;
}

export interface AutofillRuleStorage {
  load(): Promise<unknown>;
  save(document: AutofillRuleDocumentV1): Promise<void>;
}

export const bundledAutofillRules: AutofillSiteRule[] = [];

const maximumRules = 500;
const maximumSelectorsPerRole = 20;
const maximumSelectorLength = 500;
const selectorRoles = ['currentPassword', 'ignore', 'newPassword', 'oneTimeCode', 'username'] as const;

export class AutofillRuleStore {
  private readonly storage: AutofillRuleStorage;

  private readonly selectorIsValid: (selector: string) => boolean;

  constructor(storage: AutofillRuleStorage, selectorIsValid: (selector: string) => boolean) {
    this.storage = storage;
    this.selectorIsValid = selectorIsValid;
  }

  async load(): Promise<AutofillSiteRule[]> {
    const stored = this.validateDocument(await this.storage.load(), false);
    const enabledUserRules = stored.rules.filter(rule => rule.enabled !== false);
    return [...enabledUserRules, ...bundledAutofillRules];
  }

  async import(json: string): Promise<AutofillSiteRule[]> {
    if (json.length > 1_000_000) {
      throw new Error('Autofill rule document exceeds the 1 MB limit.');
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      throw new Error('Autofill rule document is not valid JSON.');
    }
    const document = this.validateDocument(parsed, true);
    await this.storage.save(document);
    return document.rules.filter(rule => rule.enabled !== false);
  }

  async export(): Promise<string> {
    const document = this.validateDocument(await this.storage.load(), false);
    return JSON.stringify(document, null, 2);
  }

  async remove(id: string): Promise<void> {
    const document = this.validateDocument(await this.storage.load(), false);
    document.rules = document.rules.filter(rule => rule.id !== id);
    await this.storage.save(document);
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    const document = this.validateDocument(await this.storage.load(), false);
    const rule = document.rules.find(candidate => candidate.id === id);
    if (rule) {
      rule.enabled = enabled;
      await this.storage.save(document);
    }
  }

  private validateDocument(value: unknown, strict: boolean): AutofillRuleDocumentV1 {
    if (value === null || value === undefined) {
      return { rules: [], version: 1 };
    }
    if (typeof value !== 'object' || (value as { version?: unknown }).version !== 1 || !Array.isArray((value as { rules?: unknown }).rules)) {
      if (!strict) {
        return { rules: [], version: 1 };
      }
      throw new Error('Autofill rule document must use version 1 and contain a rules array.');
    }

    const rules = (value as { rules: unknown[] }).rules;
    if (strict && rules.length > maximumRules) {
      throw new Error(`Autofill rule document contains more than ${maximumRules} rules.`);
    }
    const ids = new Set<string>();
    const validated: StoredAutofillSiteRule[] = [];
    for (const [index, rule] of rules.entries()) {
      if (validated.length >= maximumRules) {
        break;
      }
      try {
        validated.push(this.validateRule(rule, index, ids));
      } catch (error) {
        if (strict) {
          throw error;
        }
      }
    }
    return { rules: validated, version: 1 };
  }

  private validateRule(value: unknown, index: number, ids: Set<string>): StoredAutofillSiteRule {
    if (typeof value !== 'object' || value === null) {
      throw new Error(`Rule ${index + 1} must be an object.`);
    }
    const rule = value as Partial<StoredAutofillSiteRule>;
    if (typeof rule.id !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,99}$/i.test(rule.id) || ids.has(rule.id)) {
      throw new Error(`Rule ${index + 1} must have a unique, stable id.`);
    }
    if (!Array.isArray(rule.origins) || rule.origins.length === 0 || rule.origins.some(origin => !this.isExactWebOrigin(origin))) {
      throw new Error(`Rule ${rule.id} must contain at least one exact http or https origin.`);
    }
    if (rule.pathPrefixes && (!Array.isArray(rule.pathPrefixes) || rule.pathPrefixes.some(prefix => typeof prefix !== 'string' || !prefix.startsWith('/')))) {
      throw new Error(`Rule ${rule.id} path prefixes must begin with '/'.`);
    }
    if (typeof rule.selectors !== 'object' || rule.selectors === null) {
      throw new Error(`Rule ${rule.id} must contain selectors.`);
    }

    const selectors: StoredAutofillSiteRule['selectors'] = {};
    for (const role of selectorRoles) {
      const roleSelectors = rule.selectors[role];
      if (roleSelectors === undefined) {
        continue;
      }
      if (!Array.isArray(roleSelectors) || roleSelectors.length > maximumSelectorsPerRole) {
        throw new Error(`Rule ${rule.id} has too many ${role} selectors.`);
      }
      const validatedSelectors = roleSelectors.map(selector => {
        if (typeof selector !== 'string' || selector.length === 0 || selector.length > maximumSelectorLength || !this.selectorIsValid(selector)) {
          throw new Error(`Rule ${rule.id} contains an invalid ${role} selector.`);
        }
        return selector;
      });
      selectors[role] = validatedSelectors;
    }

    const validatedRule = {
      disableHeuristics: rule.disableHeuristics === true,
      enabled: rule.enabled !== false,
      id: rule.id,
      origins: [...rule.origins],
      pathPrefixes: rule.pathPrefixes ? [...rule.pathPrefixes] : undefined,
      selectors
    };
    ids.add(rule.id);
    return validatedRule;
  }

  private isExactWebOrigin(value: unknown): value is string {
    if (typeof value !== 'string' || value.includes('*')) {
      return false;
    }
    try {
      const parsed = new URL(value);
      return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.origin === value;
    } catch {
      return false;
    }
  }
}
