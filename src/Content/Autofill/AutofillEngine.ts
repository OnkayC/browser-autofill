export type AutofillTrigger = 'page-load' | 'toolbar' | 'inline';

export type AutofillStatus = 'complete' | 'partial' | 'no-target' | 'blocked';

export type AutofillReason =
  | 'ambiguous-password'
  | 'disabled-for-site'
  | 'field-rejected-value'
  | 'new-password-requires-confirmation'
  | 'no-eligible-fields'
  | 'page-load-already-attempted'
  | 'stale-frame'
  | 'untrusted-frame';

export interface AutofillCredentialLike {
  username: string;
  password: string;
  url?: string;
}

export interface AutofillRequest {
  credential: AutofillCredentialLike;
  trigger: AutofillTrigger;
  initiator?: HTMLInputElement | null;
  allowNewPassword?: boolean;
}

export interface AutofillResult {
  passwordSatisfied: number;
  reasons: AutofillReason[];
  status: AutofillStatus;
  usernameSatisfied: number;
}

export type AutofillFieldRole = 'username' | 'current-password' | 'new-password' | 'one-time-code' | 'ignored' | 'unknown';

export interface AutofillInspection {
  candidateCount: number;
  focusedRole: AutofillFieldRole;
  frameOrigin: string;
  frameUrl: string;
  revision: number;
}

export interface AutofillSiteRule {
  disableHeuristics?: boolean;
  id: string;
  origins: string[];
  pathPrefixes?: string[];
  selectors: {
    currentPassword?: string[];
    ignore?: string[];
    newPassword?: string[];
    oneTimeCode?: string[];
    username?: string[];
  };
}

interface FieldSnapshot {
  autocomplete: Set<string>;
  contextText: string;
  element: HTMLInputElement;
  forcedRole?: AutofillFieldRole;
  ignored: boolean;
  logicalOwner: object;
  order: number;
  rendered: boolean;
  semanticText: string;
}

interface LoginTarget {
  password: FieldSnapshot | null;
  tier: number;
  username: FieldSnapshot | null;
}

interface Analysis {
  fields: FieldSnapshot[];
  reasons: AutofillReason[];
  targets: LoginTarget[];
}

const usernameKeywords = [
  'username',
  'user name',
  'userid',
  'user id',
  'email',
  'e-mail',
  'login',
  'account',
  'customer',
  'clientnumber',
  'benutzer',
  'utilisateur',
  'usuario',
  'utente',
  'gebruikersnaam',
  '用户名',
  '用户名称',
  '帳號',
  '账号'
];

const searchKeywords = ['search', 'find', 'query', 'suche', 'recherche', 'buscar', '搜索'];
const otpKeywords = ['one-time', 'one time', 'otp', 'totp', '2fa', 'mfa', 'verification code', 'security code', '验证码'];
const captchaKeywords = ['captcha', 'recaptcha', 'hcaptcha'];
const newPasswordKeywords = ['new password', 'confirm password', 'repeat password', 'password confirmation', 'create password'];
const currentPasswordKeywords = ['current password', 'existing password', 'old password'];
const newsletterKeywords = ['newsletter', 'subscribe', 'mailing list', 'email updates'];
const ignoreAttributes = ['data-1p-ignore', 'data-op-ignore', 'data-bwignore', 'data-strongbox-ignore'];

function containsAny(value: string, keywords: string[]): boolean {
  return keywords.some(keyword => value.includes(keyword));
}

function normalize(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
}

export class AutofillEngine {
  private readonly document: Document;

  private rules: AutofillSiteRule[];

  private readonly mutationObservers: MutationObserver[] = [];

  private readonly observedRoots = new WeakSet<object>();

  private revisionTimer: number | null = null;

  private readonly mutationWaiters = new Set<() => void>();

  private revision = 0;

  constructor(document: Document, rules: AutofillSiteRule[] = []) {
    this.document = document;
    this.rules = rules;
    this.observeRoot(document);
  }

  async inspect(initiator: HTMLInputElement | null = null): Promise<AutofillInspection> {
    const analysis = this.analyse(initiator, false);
    const interactiveInitiator = initiator !== null && this.isInteractive(initiator);
    const structurallyRecognizedUsername = interactiveInitiator && analysis.targets.some(target => target.username?.element === initiator);
    const structurallyRecognizedPassword = interactiveInitiator && analysis.targets.some(target => target.password?.element === initiator);
    return {
      candidateCount: analysis.targets.length,
      focusedRole: structurallyRecognizedUsername
        ? 'username'
        : structurallyRecognizedPassword
          ? 'current-password'
          : interactiveInitiator && initiator
            ? this.roleForSnapshot(analysis.fields.find(field => field.element === initiator))
            : 'unknown',
      frameOrigin: this.document.defaultView?.origin ?? this.safeOrigin(this.document.location?.href ?? ''),
      frameUrl: this.document.location?.href ?? '',
      revision: this.revision
    };
  }

  async fill(request: AutofillRequest): Promise<AutofillResult> {
    let result = this.fillOnce(request);
    if (request.trigger !== 'page-load' || result.status !== 'no-target') {
      return result;
    }

    for (const delay of [250, 750]) {
      await this.waitForRelevantChange(delay);
      result = this.fillOnce(request);
      if (result.status !== 'no-target') {
        return result;
      }
    }
    return result;
  }

  fillSingleField(element: HTMLInputElement, text: string, append = false): boolean {
    return this.fillElement(element, append ? element.value + text : text);
  }

  replaceRules(rules: AutofillSiteRule[]): void {
    this.rules = [...rules];
    this.revision += 1;
  }

  private fillOnce(request: AutofillRequest): AutofillResult {
    const initiator = request.initiator ?? null;
    const analysis = this.analyse(initiator, request.trigger === 'inline');
    const initiatorSnapshot = analysis.fields.find(field => field.element === initiator);

    if (initiatorSnapshot && this.isNewPassword(initiatorSnapshot)) {
      if (request.trigger !== 'inline' || !request.allowNewPassword) {
        return this.result('blocked', 0, 0, ['new-password-requires-confirmation']);
      }

      const passwordSatisfied = this.fillElement(initiatorSnapshot.element, request.credential.password) ? 1 : 0;
      return this.result(passwordSatisfied ? 'complete' : 'partial', 0, passwordSatisfied, passwordSatisfied ? [] : ['field-rejected-value']);
    }

    if (analysis.targets.length === 0) {
      const reasons: AutofillReason[] = analysis.reasons.length > 0 ? analysis.reasons : ['no-eligible-fields'];
      return this.result('no-target', 0, 0, reasons);
    }

    const targets = request.trigger === 'page-load' ? analysis.targets : analysis.targets.slice(0, 1);
    let expectedPassword = 0;
    let expectedUsername = 0;
    let passwordSatisfied = 0;
    let usernameSatisfied = 0;
    const reasons = [...analysis.reasons];

    for (const target of targets) {
      if (target.username && request.credential.username.length > 0) {
        expectedUsername += 1;
        if (this.fillElement(target.username.element, request.credential.username)) {
          usernameSatisfied += 1;
        } else {
          reasons.push('field-rejected-value');
        }
      }

      if (target.password && request.credential.password.length > 0) {
        expectedPassword += 1;
        if (this.fillElement(target.password.element, request.credential.password)) {
          passwordSatisfied += 1;
        } else {
          reasons.push('field-rejected-value');
        }
      }
    }

    const expected = expectedPassword + expectedUsername;
    const satisfied = passwordSatisfied + usernameSatisfied;
    const status: AutofillStatus = satisfied === expected && expected > 0 ? 'complete' : satisfied > 0 ? 'partial' : 'no-target';
    return this.result(status, usernameSatisfied, passwordSatisfied, Array.from(new Set(reasons)));
  }

  dispose(): void {
    for (const observer of this.mutationObservers) {
      observer.disconnect();
    }
    this.mutationObservers.length = 0;
    if (this.revisionTimer !== null) {
      this.document.defaultView?.clearTimeout(this.revisionTimer);
      this.revisionTimer = null;
    }
    for (const waiter of this.mutationWaiters) {
      waiter();
    }
    this.mutationWaiters.clear();
  }

  private analyse(initiator: HTMLInputElement | null, allowFocusedUsername: boolean): Analysis {
    const fields = this.collectFields();
    const reasons: AutofillReason[] = [];
    const targets: LoginTarget[] = [];
    const rule = this.matchingRule();
    if (rule) {
      this.applyRuleRoles(rule, fields);
      const ruleTarget = this.targetFromRule(rule, fields);
      if (ruleTarget) {
        targets.push(ruleTarget);
        return { fields, reasons, targets };
      }
      if (rule.disableHeuristics) {
        return { fields, reasons, targets };
      }
    }
    const passwordGroups = new Map<object, FieldSnapshot[]>();

    for (const field of fields) {
      if (!this.isPasswordCandidate(field) || this.isNewPassword(field)) {
        continue;
      }
      const candidates = passwordGroups.get(field.logicalOwner) ?? [];
      candidates.push(field);
      passwordGroups.set(field.logicalOwner, candidates);
    }

    for (const [owner, passwords] of passwordGroups) {
      let selectedPasswords = passwords.filter(field => field.autocomplete.has('current-password'));
      if (selectedPasswords.length === 0) {
        const semanticCurrent = passwords.filter(field => containsAny(field.semanticText, currentPasswordKeywords));
        if (semanticCurrent.length > 0) {
          selectedPasswords = semanticCurrent;
        } else if (passwords.length === 1) {
          selectedPasswords = passwords;
        } else if (initiator) {
          selectedPasswords = passwords.filter(field => field.element === initiator);
        }
      }

      if (selectedPasswords.length === 0) {
        reasons.push('ambiguous-password');
        continue;
      }

      for (const password of selectedPasswords) {
        const usernameCandidates = fields.filter(field => {
          return field.logicalOwner === owner && field.order < password.order && this.isUsernameCandidate(field);
        });
        const exact = usernameCandidates.filter(field => field.autocomplete.has('username'));
        const semantic = usernameCandidates.filter(field => this.hasUsernameSemantics(field));
        const focused = usernameCandidates.filter(field => field.element === initiator);
        const candidates = focused.length > 0 ? focused : exact.length > 0 ? exact : semantic.length > 0 ? semantic : usernameCandidates;
        const username = candidates.length > 0 ? candidates[candidates.length - 1] : null;
        const tier = focused.length > 0 ? 0 : exact.length > 0 ? 1 : semantic.length > 0 ? 2 : username ? 3 : 4;
        targets.push({ password, tier, username });
      }
    }

    const ownersWithPasswords = new Set(fields.filter(field => this.isPasswordCandidate(field)).map(field => field.logicalOwner));
    for (const field of fields) {
      if (!this.isUsernameCandidate(field) || ownersWithPasswords.has(field.logicalOwner)) {
        continue;
      }
      if (this.hasUsernameSemantics(field) || field.autocomplete.has('username') || (allowFocusedUsername && field.element === initiator)) {
        targets.push({
          password: null,
          tier: field.element === initiator ? 0 : field.autocomplete.has('username') ? 1 : 2,
          username: field
        });
      }
    }

    if (initiator) {
      const initiatingField = fields.find(field => field.element === initiator);
      if (initiatingField) {
        const sameOwner = targets.filter(target => target.username?.logicalOwner === initiatingField.logicalOwner || target.password?.logicalOwner === initiatingField.logicalOwner);
        if (sameOwner.length > 0) {
          targets.splice(0, targets.length, ...sameOwner);
        }
      }
    }

    targets.sort((left, right) => left.tier - right.tier || (left.password?.order ?? left.username?.order ?? 0) - (right.password?.order ?? right.username?.order ?? 0));
    return { fields, reasons: Array.from(new Set(reasons)), targets };
  }

  private collectFields(): FieldSnapshot[] {
    const inputs: HTMLInputElement[] = [];
    this.collectInputsFromRoot(this.document, inputs);

    return inputs.map((element, order) => {
      const logicalOwner = this.logicalOwner(element);
      return {
        autocomplete: new Set(
          normalize(element.autocomplete ?? '')
            .split(' ')
            .filter(Boolean)
        ),
        contextText: this.contextText(logicalOwner),
        element,
        ignored: this.isIgnored(element),
        logicalOwner,
        order,
        rendered: this.isRendered(element),
        semanticText: this.semanticText(element)
      };
    });
  }

  private matchingRule(): AutofillSiteRule | null {
    let url: URL;
    try {
      url = new URL(this.document.location.href);
    } catch {
      return null;
    }
    return (
      this.rules.find(rule => {
        if (!rule.origins.includes(url.origin)) {
          return false;
        }
        return !rule.pathPrefixes || rule.pathPrefixes.length === 0 || rule.pathPrefixes.some(prefix => url.pathname.startsWith(prefix));
      }) ?? null
    );
  }

  private applyRuleRoles(rule: AutofillSiteRule, fields: FieldSnapshot[]): void {
    const roles: Array<[string[] | undefined, AutofillFieldRole]> = [
      [rule.selectors.ignore, 'ignored'],
      [rule.selectors.newPassword, 'new-password'],
      [rule.selectors.oneTimeCode, 'one-time-code'],
      [rule.selectors.username, 'username'],
      [rule.selectors.currentPassword, 'current-password']
    ];
    for (const [selectors, role] of roles) {
      for (const selector of selectors ?? []) {
        try {
          for (const element of Array.from(this.document.querySelectorAll<HTMLInputElement>(selector))) {
            const field = fields.find(candidate => candidate.element === element);
            if (field) {
              field.forcedRole = role;
              field.ignored = role === 'ignored';
            }
          }
        } catch {
          continue;
        }
      }
    }
  }

  private targetFromRule(rule: AutofillSiteRule, fields: FieldSnapshot[]): LoginTarget | null {
    const username = this.uniqueRuleField(rule.selectors.username, fields);
    const password = this.uniqueRuleField(rule.selectors.currentPassword, fields);
    if (!username && !password) {
      return null;
    }
    if ((username && !this.isUsernameCandidate(username)) || (password && !this.isPasswordCandidate(password))) {
      return null;
    }
    return { password, tier: -1, username };
  }

  private uniqueRuleField(selectors: string[] | undefined, fields: FieldSnapshot[]): FieldSnapshot | null {
    for (const selector of selectors ?? []) {
      try {
        const matches = Array.from(this.document.querySelectorAll<HTMLInputElement>(selector));
        if (matches.length === 1) {
          return fields.find(field => field.element === matches[0]) ?? null;
        }
      } catch {
        continue;
      }
    }
    return null;
  }

  private collectInputsFromRoot(root: Document | ShadowRoot, inputs: HTMLInputElement[]): void {
    this.observeRoot(root);
    for (const input of Array.from(root.querySelectorAll<HTMLInputElement>('input'))) {
      inputs.push(input);
    }

    for (const element of Array.from(root.querySelectorAll<HTMLElement>('*'))) {
      if (element.shadowRoot) {
        this.collectInputsFromRoot(element.shadowRoot, inputs);
      }
    }
  }

  private logicalOwner(element: HTMLInputElement): object {
    if (element.form) {
      return element.form;
    }

    const owner = element.closest('dialog, fieldset, [role="form"]');
    if (owner) {
      return owner;
    }

    const root = element.getRootNode();
    return root === this.document ? this.document : root;
  }

  private semanticText(element: HTMLInputElement): string {
    const values = [element.id, element.name, element.placeholder, element.title, element.getAttribute('aria-label') ?? '', element.className];
    for (const label of Array.from(element.labels ?? [])) {
      values.push(label.textContent ?? '');
    }

    for (const attribute of ['aria-labelledby', 'aria-describedby']) {
      const ids = (element.getAttribute(attribute) ?? '').split(/\s+/).filter(Boolean);
      for (const id of ids) {
        const describedBy = element.ownerDocument.getElementById(id);
        if (describedBy) {
          values.push(describedBy.textContent ?? '');
        }
      }
    }

    for (const [key, value] of Object.entries(element.dataset)) {
      values.push(key, value ?? '');
    }
    return normalize(values.join(' '));
  }

  private contextText(owner: object): string {
    const ElementConstructor = this.document.defaultView?.Element;
    if (!ElementConstructor || !(owner instanceof ElementConstructor)) {
      return '';
    }
    const element = owner as Element;
    return normalize(`${element.id} ${element.className} ${element.getAttribute('aria-label') ?? ''} ${(element.textContent ?? '').slice(0, 2000)}`);
  }

  private isUsernameCandidate(field: FieldSnapshot): boolean {
    const type = field.element.type;
    return (
      (type === 'text' || type === 'email' || type === 'tel') &&
      this.isEligible(field) &&
      !this.isSearch(field) &&
      !this.isOtp(field) &&
      !containsAny(field.semanticText, captchaKeywords) &&
      !containsAny(field.contextText, newsletterKeywords)
    );
  }

  private isPasswordCandidate(field: FieldSnapshot): boolean {
    return field.element.type === 'password' && this.isEligible(field) && !this.isOtp(field);
  }

  private isEligible(field: FieldSnapshot): boolean {
    return field.rendered && !field.ignored && !field.element.disabled && !field.element.readOnly && field.element.isConnected;
  }

  private hasUsernameSemantics(field: FieldSnapshot): boolean {
    return field.forcedRole === 'username' || field.autocomplete.has('username') || containsAny(field.semanticText, usernameKeywords);
  }

  private isSearch(field: FieldSnapshot): boolean {
    return field.element.type === 'search' || containsAny(field.semanticText, searchKeywords);
  }

  private isOtp(field: FieldSnapshot): boolean {
    return field.forcedRole === 'one-time-code' || field.autocomplete.has('one-time-code') || containsAny(field.semanticText, otpKeywords);
  }

  private isNewPassword(field: FieldSnapshot): boolean {
    return field.forcedRole === 'new-password' || field.autocomplete.has('new-password') || containsAny(field.semanticText, newPasswordKeywords);
  }

  private isIgnored(element: HTMLInputElement): boolean {
    let current: Element | null = element;
    while (current) {
      if (ignoreAttributes.some(attribute => current?.hasAttribute(attribute))) {
        return true;
      }
      current = current.parentElement;
    }
    return false;
  }

  private isRendered(element: HTMLInputElement): boolean {
    const view = element.ownerDocument.defaultView;
    const rect = element.getBoundingClientRect();
    if (rect.width < 10 || rect.height < 10) {
      return false;
    }

    let current: HTMLElement | null = element;
    while (current) {
      const style = view?.getComputedStyle(current);
      if (
        style &&
        (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || style.opacity === '0' || style.clipPath === 'inset(50%)' || style.clipPath === 'circle(0px)')
      ) {
        return false;
      }
      if (current.hidden) {
        return false;
      }
      if (current.parentElement) {
        current = current.parentElement;
      } else {
        const root = current.getRootNode() as ShadowRoot;
        current = root.host instanceof (view?.HTMLElement ?? HTMLElement) ? (root.host as HTMLElement) : null;
      }
    }
    return true;
  }

  private isInteractive(element: HTMLInputElement): boolean {
    if (!this.isRendered(element)) {
      return false;
    }
    const view = element.ownerDocument.defaultView;
    const rect = element.getBoundingClientRect();
    if (view && (rect.bottom < 0 || rect.right < 0 || rect.top > view.innerHeight || rect.left > view.innerWidth)) {
      return false;
    }
    if (typeof element.ownerDocument.elementFromPoint !== 'function') {
      return true;
    }
    const hit = element.ownerDocument.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return hit === null || hit === element || element.contains(hit) || Array.from(element.labels ?? []).some(label => label === hit || label.contains(hit));
  }

  private roleForSnapshot(field?: FieldSnapshot): AutofillFieldRole {
    if (!field || field.ignored) {
      return field ? 'ignored' : 'unknown';
    }
    if (field.forcedRole) {
      return field.forcedRole;
    }
    if (this.isOtp(field)) {
      return 'one-time-code';
    }
    if (this.isNewPassword(field)) {
      return 'new-password';
    }
    if (this.isPasswordCandidate(field)) {
      return 'current-password';
    }
    if (this.isUsernameCandidate(field) && this.hasUsernameSemantics(field)) {
      return 'username';
    }
    return 'unknown';
  }

  private fillElement(element: HTMLInputElement, value: string): boolean {
    if (value.length === 0 || element.disabled || element.readOnly || !element.isConnected) {
      return false;
    }
    if (element.value === value) {
      return true;
    }

    const view = element.ownerDocument.defaultView;
    try {
      element.dispatchEvent(
        new (view?.MouseEvent ?? MouseEvent)('click', {
          bubbles: true,
          cancelable: true
        })
      );
      element.focus();
      element.dispatchEvent(
        new (view?.KeyboardEvent ?? KeyboardEvent)('keydown', {
          bubbles: true
        })
      );
      const setter = view ? Object.getOwnPropertyDescriptor(view.HTMLInputElement.prototype, 'value')?.set : undefined;
      if (setter) {
        setter.call(element, value);
      } else {
        element.value = value;
      }
      element.dispatchEvent(new (view?.KeyboardEvent ?? KeyboardEvent)('keyup', { bubbles: true }));
      element.dispatchEvent(
        new (view?.Event ?? Event)('input', {
          bubbles: true,
          cancelable: false
        })
      );
      element.dispatchEvent(
        new (view?.Event ?? Event)('change', {
          bubbles: true,
          cancelable: false
        })
      );
      if (element.value === value) {
        element.classList.add('com-phoebecode-strongbox-autofill-animated');
        view?.setTimeout(() => element.classList.remove('com-phoebecode-strongbox-autofill-animated'), 500);
        return true;
      }
    } catch {
      return false;
    }
    return false;
  }

  private observeRoot(root: Document | ShadowRoot): void {
    const view = this.document.defaultView;
    const target = root === this.document ? this.document.documentElement : root;
    if (!view?.MutationObserver || !target || this.observedRoots.has(root)) {
      return;
    }
    this.observedRoots.add(root);
    const observer = new view.MutationObserver(() => this.scheduleRevision());
    observer.observe(target, {
      attributes: true,
      childList: true,
      characterData: true,
      subtree: true
    });
    this.mutationObservers.push(observer);
  }

  private scheduleRevision(): void {
    const view = this.document.defaultView;
    if (!view || this.revisionTimer !== null) {
      return;
    }
    this.revisionTimer = view.setTimeout(() => {
      this.revisionTimer = null;
      this.revision += 1;
      for (const waiter of this.mutationWaiters) {
        waiter();
      }
    }, 50);
  }

  private waitForRelevantChange(timeoutMs: number): Promise<void> {
    const view = this.document.defaultView;
    return new Promise(resolve => {
      let finished = false;
      const finish = () => {
        if (finished) {
          return;
        }
        finished = true;
        this.mutationWaiters.delete(finish);
        resolve();
      };
      this.mutationWaiters.add(finish);
      (view?.setTimeout ?? setTimeout)(finish, timeoutMs);
    });
  }

  private safeOrigin(url: string): string {
    try {
      return new URL(url).origin;
    } catch {
      return 'null';
    }
  }

  private result(status: AutofillStatus, usernameSatisfied: number, passwordSatisfied: number, reasons: AutofillReason[]): AutofillResult {
    return { passwordSatisfied, reasons, status, usernameSatisfied };
  }
}
