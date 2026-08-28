import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

function loadTypeScriptModule(relativeUrl) {
  const filename = fileURLToPath(new URL(relativeUrl, import.meta.url));
  const source = readFileSync(filename, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020
    },
    fileName: filename
  }).outputText;
  const module = { exports: {} };
  Function(
    'module',
    'exports',
    'require',
    output
  )(module, module.exports, () => {
    throw new Error('AutofillCoordinator must depend only on its adapter');
  });
  return module.exports;
}

test('blocks page-load filling in a mismatched cross-origin frame', async () => {
  const { AutofillCoordinator } = loadTypeScriptModule('../src/Background/AutofillCoordinator.ts');
  const fills = [];
  const adapter = {
    confirmOriginMismatch: async () => {
      throw new Error('automatic filling must not prompt');
    },
    fillFrame: async (tabId, frame, request) => {
      fills.push({ frameId: frame.frameId, request, tabId });
      return {
        passwordSatisfied: 1,
        reasons: [],
        status: 'complete',
        usernameSatisfied: 1
      };
    },
    getFrames: async () => [
      {
        frameId: 0,
        parentFrameId: -1,
        url: 'https://main.example.test/login'
      },
      {
        frameId: 3,
        parentFrameId: 0,
        url: 'https://untrusted.example.test/embed'
      }
    ],
    inspectFrame: async (_tabId, frame) => ({
      candidateCount: frame.frameId === 3 ? 1 : 0,
      focusedRole: 'unknown',
      frameOrigin: new URL(frame.url).origin,
      frameUrl: frame.url,
      revision: 7
    })
  };
  const coordinator = new AutofillCoordinator(adapter);

  const result = await coordinator.coordinate({
    credential: {
      password: 'secret',
      url: 'https://main.example.test/',
      username: 'person'
    },
    tabId: 42,
    trigger: 'page-load'
  });

  assert.deepEqual(fills, []);
  assert.equal(result.status, 'blocked');
  assert.deepEqual(result.reasons, ['untrusted-frame']);
});

test('requires and honors one-time confirmation for a manual cross-origin fill', async () => {
  const { AutofillCoordinator } = loadTypeScriptModule('../src/Background/AutofillCoordinator.ts');
  let confirmations = 0;
  const fills = [];
  const adapter = {
    confirmOriginMismatch: async () => {
      confirmations += 1;
      return true;
    },
    fillFrame: async (_tabId, frame) => {
      fills.push(frame.frameId);
      return {
        passwordSatisfied: 1,
        reasons: [],
        status: 'complete',
        usernameSatisfied: 1
      };
    },
    getFrames: async () => [
      {
        frameId: 0,
        parentFrameId: -1,
        url: 'https://main.example.test/'
      },
      {
        frameId: 9,
        parentFrameId: 0,
        url: 'https://payments.example.test/login'
      }
    ],
    inspectFrame: async (_tabId, frame) => ({
      candidateCount: frame.frameId === 9 ? 1 : 0,
      focusedRole: frame.frameId === 9 ? 'username' : 'unknown',
      frameOrigin: new URL(frame.url).origin,
      frameUrl: frame.url,
      revision: 2
    })
  };
  const coordinator = new AutofillCoordinator(adapter);

  const result = await coordinator.coordinate({
    credential: {
      password: 'secret',
      url: 'https://main.example.test/',
      username: 'person'
    },
    tabId: 7,
    trigger: 'toolbar'
  });

  assert.equal(confirmations, 1);
  assert.deepEqual(fills, [9]);
  assert.equal(result.status, 'complete');
});

test('trusts an about:blank frame through its same-origin parent', async () => {
  const { AutofillCoordinator } = loadTypeScriptModule('../src/Background/AutofillCoordinator.ts');
  const fills = [];
  const frames = [
    { frameId: 0, parentFrameId: -1, url: 'https://main.example.test/' },
    { frameId: 4, parentFrameId: 0, url: 'about:blank' }
  ];
  const coordinator = new AutofillCoordinator({
    confirmOriginMismatch: async () => false,
    fillFrame: async (_tabId, frame) => {
      fills.push(frame.frameId);
      return {
        passwordSatisfied: 1,
        reasons: [],
        status: 'complete',
        usernameSatisfied: 1
      };
    },
    getFrames: async () => frames,
    inspectFrame: async (_tabId, frame) => ({
      candidateCount: frame.frameId === 4 ? 1 : 0,
      focusedRole: 'unknown',
      frameOrigin: 'https://main.example.test',
      frameUrl: frame.url,
      revision: 1
    })
  });

  const result = await coordinator.coordinate({
    credential: {
      password: 'secret',
      url: 'https://main.example.test/',
      username: 'person'
    },
    tabId: 8,
    trigger: 'page-load'
  });

  assert.deepEqual(fills, [4]);
  assert.equal(result.status, 'complete');
});

test('does not treat two unresolved opaque origins as same-origin', async () => {
  const { AutofillCoordinator } = loadTypeScriptModule('../src/Background/AutofillCoordinator.ts');
  const fills = [];
  const frames = [
    { frameId: 0, parentFrameId: -1, url: 'data:text/html,top' },
    { frameId: 4, parentFrameId: 0, url: 'data:text/html,child' }
  ];
  const coordinator = new AutofillCoordinator({
    confirmOriginMismatch: async () => false,
    fillFrame: async (_tabId, frame) => {
      fills.push(frame.frameId);
      return {
        passwordSatisfied: 1,
        reasons: [],
        status: 'complete',
        usernameSatisfied: 1
      };
    },
    getFrames: async () => frames,
    inspectFrame: async (_tabId, frame) => ({
      candidateCount: frame.frameId === 4 ? 1 : 0,
      focusedRole: 'unknown',
      frameOrigin: 'null',
      frameUrl: frame.url,
      revision: 1
    })
  });

  const result = await coordinator.coordinate({
    credential: {
      password: 'secret',
      url: 'https://main.example.test/',
      username: 'person'
    },
    tabId: 8,
    trigger: 'page-load'
  });

  assert.deepEqual(fills, []);
  assert.equal(result.status, 'blocked');
  assert.deepEqual(result.reasons, ['untrusted-frame']);
});

test('blocks a same-URL frame when its inspected document origin is opaque', async () => {
  const { AutofillCoordinator } = loadTypeScriptModule('../src/Background/AutofillCoordinator.ts');
  const fills = [];
  const frames = [
    { frameId: 0, parentFrameId: -1, url: 'https://main.example.test/' },
    { frameId: 4, parentFrameId: 0, url: 'https://main.example.test/sandboxed-login' }
  ];
  const coordinator = new AutofillCoordinator({
    confirmOriginMismatch: async () => false,
    fillFrame: async (_tabId, frame) => {
      fills.push(frame.frameId);
      return {
        passwordSatisfied: 1,
        reasons: [],
        status: 'complete',
        usernameSatisfied: 1
      };
    },
    getFrames: async () => frames,
    inspectFrame: async (_tabId, frame) => ({
      candidateCount: frame.frameId === 4 ? 1 : 0,
      focusedRole: 'unknown',
      frameOrigin: frame.frameId === 4 ? 'null' : 'https://main.example.test',
      frameUrl: frame.url,
      revision: 1
    })
  });

  const result = await coordinator.coordinate({
    credential: {
      password: 'secret',
      url: 'https://main.example.test/',
      username: 'person'
    },
    tabId: 8,
    trigger: 'page-load'
  });

  assert.deepEqual(fills, []);
  assert.equal(result.status, 'blocked');
});

test('does not prompt for an unselected cross-origin frame', async () => {
  const { AutofillCoordinator } = loadTypeScriptModule('../src/Background/AutofillCoordinator.ts');
  let confirmations = 0;
  const fills = [];
  const frames = [
    { frameId: 0, parentFrameId: -1, url: 'https://main.example.test/' },
    { frameId: 5, parentFrameId: 0, url: 'https://ads.example.test/' }
  ];
  const coordinator = new AutofillCoordinator({
    confirmOriginMismatch: async () => {
      confirmations += 1;
      return false;
    },
    fillFrame: async (_tabId, frame) => {
      fills.push(frame.frameId);
      return {
        passwordSatisfied: 1,
        reasons: [],
        status: 'complete',
        usernameSatisfied: 1
      };
    },
    getFrames: async () => frames,
    inspectFrame: async (_tabId, frame) => ({
      candidateCount: 1,
      focusedRole: 'unknown',
      frameOrigin: new URL(frame.url).origin,
      frameUrl: frame.url,
      revision: 1
    })
  });

  await coordinator.coordinate({
    credential: {
      password: 'secret',
      url: 'https://main.example.test/',
      username: 'person'
    },
    tabId: 8,
    trigger: 'toolbar'
  });

  assert.equal(confirmations, 0);
  assert.deepEqual(fills, [0]);
});

test('serializes overlapping fills for the same tab', async () => {
  const { AutofillCoordinator } = loadTypeScriptModule('../src/Background/AutofillCoordinator.ts');
  let releaseFirstFill;
  let signalFirstFill;
  const firstFillStarted = new Promise(resolve => {
    signalFirstFill = resolve;
  });
  const holdFirstFill = new Promise(resolve => {
    releaseFirstFill = resolve;
  });
  let inspections = 0;
  let fills = 0;
  const coordinator = new AutofillCoordinator({
    confirmOriginMismatch: async () => false,
    fillFrame: async () => {
      fills += 1;
      if (fills === 1) {
        signalFirstFill();
        await holdFirstFill;
      }
      return {
        passwordSatisfied: 1,
        reasons: [],
        status: 'complete',
        usernameSatisfied: 1
      };
    },
    getFrames: async () => [{ frameId: 0, parentFrameId: -1, url: 'https://main.example.test/' }],
    inspectFrame: async (_tabId, frame) => {
      inspections += 1;
      return {
        candidateCount: 1,
        focusedRole: 'unknown',
        frameOrigin: new URL(frame.url).origin,
        frameUrl: frame.url,
        revision: inspections
      };
    }
  });
  const request = {
    credential: {
      password: 'secret',
      url: 'https://main.example.test/',
      username: 'person'
    },
    tabId: 11,
    trigger: 'page-load'
  };

  const first = coordinator.coordinate(request);
  await firstFillStarted;
  const second = coordinator.coordinate(request);
  await Promise.resolve();

  assert.equal(inspections, 1);
  releaseFirstFill();
  await Promise.all([first, second]);
  assert.equal(inspections, 2);
});

test('a repeated page-load pass fills a newly completed frame without refilling prior frames', async () => {
  const { AutofillCoordinator } = loadTypeScriptModule('../src/Background/AutofillCoordinator.ts');
  const filledFrames = new Set();
  const fillOrder = [];
  let childCompleted = false;
  const coordinator = new AutofillCoordinator({
    confirmOriginMismatch: async () => false,
    fillFrame: async (_tabId, frame) => {
      filledFrames.add(frame.frameId);
      fillOrder.push(frame.frameId);
      return {
        passwordSatisfied: 1,
        reasons: [],
        status: 'complete',
        usernameSatisfied: 1
      };
    },
    getFrames: async () => [
      { frameId: 0, parentFrameId: -1, url: 'https://main.example.test/' },
      ...(childCompleted
        ? [
            {
              frameId: 6,
              parentFrameId: 0,
              url: 'https://main.example.test/embedded-login'
            }
          ]
        : [])
    ],
    inspectFrame: async (_tabId, frame) => ({
      candidateCount: filledFrames.has(frame.frameId) ? 0 : 1,
      focusedRole: 'unknown',
      frameOrigin: new URL(frame.url).origin,
      frameUrl: frame.url,
      revision: 1
    })
  });
  const request = {
    credential: {
      password: 'secret',
      url: 'https://main.example.test/',
      username: 'person'
    },
    tabId: 12,
    trigger: 'page-load'
  };

  await coordinator.coordinate(request);
  childCompleted = true;
  await coordinator.coordinate(request);

  assert.deepEqual(fillOrder, [0, 6]);
});

test('lets an unattempted trusted frame wait for a dynamic page-load form', async () => {
  const { AutofillCoordinator } = loadTypeScriptModule('../src/Background/AutofillCoordinator.ts');
  const fills = [];
  const coordinator = new AutofillCoordinator({
    confirmOriginMismatch: async () => false,
    fillFrame: async (_tabId, frame) => {
      fills.push(frame.frameId);
      return {
        passwordSatisfied: 1,
        reasons: [],
        status: 'complete',
        usernameSatisfied: 1
      };
    },
    getFrames: async () => [{ frameId: 0, parentFrameId: -1, url: 'https://main.example.test/' }],
    inspectFrame: async (_tabId, frame) => ({
      candidateCount: 0,
      focusedRole: 'unknown',
      frameOrigin: new URL(frame.url).origin,
      frameUrl: frame.url,
      pageLoadAttempted: false,
      revision: 1
    })
  });

  const result = await coordinator.coordinate({
    credential: {
      password: 'secret',
      url: 'https://main.example.test/',
      username: 'person'
    },
    tabId: 15,
    trigger: 'page-load'
  });

  assert.deepEqual(fills, [0]);
  assert.equal(result.status, 'complete');
});

test('does not send credentials to an untrusted empty frame for dynamic retries', async () => {
  const { AutofillCoordinator } = loadTypeScriptModule('../src/Background/AutofillCoordinator.ts');
  const fills = [];
  const frames = [
    { frameId: 0, parentFrameId: -1, url: 'https://main.example.test/' },
    { frameId: 3, parentFrameId: 0, url: 'https://untrusted.example.test/login' }
  ];
  const coordinator = new AutofillCoordinator({
    confirmOriginMismatch: async () => false,
    fillFrame: async (_tabId, frame) => {
      fills.push(frame.frameId);
      return {
        passwordSatisfied: 0,
        reasons: ['no-eligible-fields'],
        status: 'no-target',
        usernameSatisfied: 0
      };
    },
    getFrames: async () => frames,
    inspectFrame: async (_tabId, frame) => ({
      candidateCount: 0,
      focusedRole: 'unknown',
      frameOrigin: new URL(frame.url).origin,
      frameUrl: frame.url,
      pageLoadAttempted: frame.frameId === 0,
      revision: 1
    })
  });

  await coordinator.coordinate({
    credential: {
      password: 'secret',
      url: 'https://main.example.test/',
      username: 'person'
    },
    tabId: 16,
    trigger: 'page-load'
  });

  assert.deepEqual(fills, []);
});

test('reports a partial result when one selected frame becomes unavailable', async () => {
  const { AutofillCoordinator } = loadTypeScriptModule('../src/Background/AutofillCoordinator.ts');
  const frames = [
    { frameId: 0, parentFrameId: -1, url: 'https://main.example.test/' },
    { frameId: 2, parentFrameId: 0, url: 'https://main.example.test/embedded' }
  ];
  const coordinator = new AutofillCoordinator({
    confirmOriginMismatch: async () => false,
    fillFrame: async (_tabId, frame) =>
      frame.frameId === 2
        ? null
        : {
            passwordSatisfied: 1,
            reasons: [],
            status: 'complete',
            usernameSatisfied: 1
          },
    getFrames: async () => frames,
    inspectFrame: async (_tabId, frame) => ({
      candidateCount: 1,
      focusedRole: 'unknown',
      frameOrigin: new URL(frame.url).origin,
      frameUrl: frame.url,
      revision: 1
    })
  });

  const result = await coordinator.coordinate({
    credential: {
      password: 'secret',
      url: 'https://main.example.test/',
      username: 'person'
    },
    tabId: 13,
    trigger: 'page-load'
  });

  assert.equal(result.status, 'partial');
  assert.deepEqual(result.reasons, ['frame-unavailable']);
});

test('preserves a blocked frame result when no fields were filled', async () => {
  const { AutofillCoordinator } = loadTypeScriptModule('../src/Background/AutofillCoordinator.ts');
  const coordinator = new AutofillCoordinator({
    confirmOriginMismatch: async () => false,
    fillFrame: async () => ({
      passwordSatisfied: 0,
      reasons: ['stale-frame'],
      status: 'blocked',
      usernameSatisfied: 0
    }),
    getFrames: async () => [{ frameId: 0, parentFrameId: -1, url: 'https://main.example.test/' }],
    inspectFrame: async (_tabId, frame) => ({
      candidateCount: 1,
      focusedRole: 'unknown',
      frameOrigin: new URL(frame.url).origin,
      frameUrl: frame.url,
      revision: 1
    })
  });

  const result = await coordinator.coordinate({
    credential: {
      password: 'secret',
      url: 'https://main.example.test/',
      username: 'person'
    },
    tabId: 14,
    trigger: 'page-load'
  });

  assert.equal(result.status, 'blocked');
  assert.deepEqual(result.reasons, ['stale-frame']);
});
