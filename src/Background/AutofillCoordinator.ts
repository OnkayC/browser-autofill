export type CoordinatedAutofillTrigger = 'page-load' | 'toolbar';

export interface CoordinatedCredential {
  password: string;
  url?: string;
  username: string;
}

export interface AutofillFrameDescriptor {
  frameId: number;
  parentFrameId: number;
  url: string;
}

export interface AutofillFrameInspection {
  candidateCount: number;
  focusedRole: 'username' | 'current-password' | 'new-password' | 'one-time-code' | 'ignored' | 'unknown';
  frameOrigin: string;
  frameUrl: string;
  pageLoadAttempted?: boolean;
  revision: number;
}

export interface AutofillFrameResult {
  passwordSatisfied: number;
  reasons: string[];
  status: 'complete' | 'partial' | 'no-target' | 'blocked';
  usernameSatisfied: number;
}

export interface AutofillCoordinatorRequest {
  credential: CoordinatedCredential;
  tabId: number;
  trigger: CoordinatedAutofillTrigger;
}

export interface AutofillFrameFillRequest {
  credential: CoordinatedCredential;
  expectedFrameUrl: string;
  expectedRevision: number;
  trigger: CoordinatedAutofillTrigger;
}

export interface AutofillCoordinatorAdapter {
  confirmOriginMismatch(tabId: number, frame: AutofillFrameDescriptor, credentialOrigin: string, frameOrigin: string): Promise<boolean>;
  fillFrame(tabId: number, frame: AutofillFrameDescriptor, request: AutofillFrameFillRequest): Promise<AutofillFrameResult | null>;
  getFrames(tabId: number): Promise<AutofillFrameDescriptor[]>;
  inspectFrame(tabId: number, frame: AutofillFrameDescriptor, trigger: CoordinatedAutofillTrigger): Promise<AutofillFrameInspection | null>;
}

interface InspectedFrame {
  frame: AutofillFrameDescriptor;
  inspection: AutofillFrameInspection;
}

export class AutofillCoordinator {
  private readonly adapter: AutofillCoordinatorAdapter;

  private readonly tabQueues = new Map<number, Promise<void>>();

  constructor(adapter: AutofillCoordinatorAdapter) {
    this.adapter = adapter;
  }

  async coordinate(request: AutofillCoordinatorRequest): Promise<AutofillFrameResult> {
    const previous = this.tabQueues.get(request.tabId) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(() => this.coordinateOnce(request));
    const tail = run.then(
      () => undefined,
      () => undefined
    );
    this.tabQueues.set(request.tabId, tail);
    void tail.then(() => {
      if (this.tabQueues.get(request.tabId) === tail) {
        this.tabQueues.delete(request.tabId);
      }
    });
    return run;
  }

  private async coordinateOnce(request: AutofillCoordinatorRequest): Promise<AutofillFrameResult> {
    const frames = await this.adapter.getFrames(request.tabId);
    const inspected = (
      await Promise.all(
        frames.map(async frame => {
          const inspection = await this.adapter.inspectFrame(request.tabId, frame, request.trigger);
          return inspection ? { frame, inspection } : null;
        })
      )
    ).filter((entry): entry is InspectedFrame => entry !== null && (entry.inspection.candidateCount > 0 || (request.trigger === 'page-load' && entry.inspection.pageLoadAttempted === false)));

    if (inspected.length === 0) {
      return this.result('no-target', 0, 0, ['no-eligible-fields']);
    }

    const topFrame = frames.find(frame => frame.frameId === 0);
    const topOrigin = topFrame ? this.resolvedOrigin(topFrame, frames) : 'null';
    const credentialOrigin = this.safeOrigin(request.credential.url ?? '');
    const eligible: InspectedFrame[] = [];
    let blockedFrames = 0;

    inspected.sort((left, right) => {
      const leftFocused = left.inspection.focusedRole === 'unknown' ? 1 : 0;
      const rightFocused = right.inspection.focusedRole === 'unknown' ? 1 : 0;
      return leftFocused - rightFocused || Number(right.frame.frameId === 0) - Number(left.frame.frameId === 0) || right.inspection.candidateCount - left.inspection.candidateCount;
    });
    const considered = request.trigger === 'page-load' ? inspected : inspected.slice(0, 1);

    for (const entry of considered) {
      const frameOrigin = this.safeOrigin(entry.inspection.frameOrigin);
      const trusted = entry.frame.frameId === 0 || (frameOrigin !== 'null' && frameOrigin === topOrigin) || (credentialOrigin !== 'null' && frameOrigin === credentialOrigin);
      if (trusted) {
        eligible.push(entry);
        continue;
      }

      if (entry.inspection.candidateCount === 0) {
        continue;
      }

      if (request.trigger === 'page-load') {
        blockedFrames += 1;
        continue;
      }

      if (await this.adapter.confirmOriginMismatch(request.tabId, entry.frame, credentialOrigin, frameOrigin)) {
        eligible.push(entry);
      } else {
        blockedFrames += 1;
      }
    }

    if (eligible.length === 0) {
      return this.result(blockedFrames > 0 ? 'blocked' : 'no-target', 0, 0, blockedFrames > 0 ? ['untrusted-frame'] : ['no-eligible-fields']);
    }

    const selected = eligible;
    const attemptedFrameResults = await Promise.all(
      selected.map(entry =>
        this.adapter.fillFrame(request.tabId, entry.frame, {
          credential: request.credential,
          expectedFrameUrl: entry.inspection.frameUrl,
          expectedRevision: entry.inspection.revision,
          trigger: request.trigger
        })
      )
    );
    const frameResults = attemptedFrameResults.filter((result): result is AutofillFrameResult => result !== null);
    const unavailableFrames = selected.length - frameResults.length;

    if (frameResults.length === 0) {
      return this.result('no-target', 0, 0, ['frame-unavailable']);
    }

    const passwordSatisfied = frameResults.reduce((total, result) => total + result.passwordSatisfied, 0);
    const usernameSatisfied = frameResults.reduce((total, result) => total + result.usernameSatisfied, 0);
    const reasons = Array.from(new Set(frameResults.flatMap(result => result.reasons)));
    if (blockedFrames > 0) {
      reasons.push('untrusted-frame');
    }
    if (unavailableFrames > 0) {
      reasons.push('frame-unavailable');
    }
    const statuses = new Set(frameResults.map(result => result.status));
    const status =
      unavailableFrames === 0 && statuses.size === 1 && statuses.has('complete') && blockedFrames === 0
        ? 'complete'
        : passwordSatisfied + usernameSatisfied > 0
          ? 'partial'
          : blockedFrames > 0 || statuses.has('blocked')
            ? 'blocked'
            : 'no-target';
    return this.result(status, usernameSatisfied, passwordSatisfied, reasons);
  }

  private resolvedOrigin(frame: AutofillFrameDescriptor, frames: AutofillFrameDescriptor[]): string {
    const origin = this.safeOrigin(frame.url);
    if (origin !== 'null') {
      return origin;
    }
    const parent = frames.find(candidate => candidate.frameId === frame.parentFrameId);
    return parent ? this.resolvedOrigin(parent, frames) : 'null';
  }

  private safeOrigin(url: string): string {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.origin : 'null';
    } catch {
      return 'null';
    }
  }

  private result(status: AutofillFrameResult['status'], usernameSatisfied: number, passwordSatisfied: number, reasons: string[]): AutofillFrameResult {
    return {
      passwordSatisfied,
      reasons: Array.from(new Set(reasons)),
      status,
      usernameSatisfied
    };
  }
}
