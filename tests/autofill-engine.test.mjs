import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
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
    throw new Error(`AutofillEngine must not depend on runtime test mocks`);
  });
  return module.exports;
}

function makeInputsVisible(document) {
  for (const input of document.querySelectorAll('input')) {
    Object.defineProperties(input, {
      offsetHeight: { configurable: true, value: 30 },
      offsetWidth: { configurable: true, value: 240 }
    });
    input.getBoundingClientRect = () => ({
      bottom: 50,
      height: 30,
      left: 10,
      right: 250,
      top: 20,
      width: 240,
      x: 10,
      y: 20,
      toJSON: () => ({})
    });
    input.getClientRects = () => [input.getBoundingClientRect()];
  }
}

test('fills an opaque localized username paired with its password', async () => {
  const { AutofillEngine } = loadTypeScriptModule('../src/Content/Autofill/AutofillEngine.ts');
  const dom = new JSDOM(
    `
      <form>
        <label for="opaque-user">用户名称*</label>
        <input id="opaque-user" type="text">
        <label for="opaque-password">密码*</label>
        <input id="opaque-password" type="password">
      </form>
    `,
    { url: 'https://login.example.test/' }
  );
  makeInputsVisible(dom.window.document);

  const engine = new AutofillEngine(dom.window.document);
  const result = await engine.fill({
    credential: {
      username: 'zce701',
      password: 'secret',
      url: 'https://login.example.test/'
    },
    trigger: 'toolbar'
  });

  assert.equal(dom.window.document.querySelector('#opaque-user').value, 'zce701');
  assert.equal(dom.window.document.querySelector('#opaque-password').value, 'secret');
  assert.deepEqual(result, {
    passwordSatisfied: 1,
    reasons: [],
    status: 'complete',
    usernameSatisfied: 1
  });
  engine.dispose();
});

test('reports the effective window origin for frame trust decisions', async () => {
  const { AutofillEngine } = loadTypeScriptModule('../src/Content/Autofill/AutofillEngine.ts');
  const dom = new JSDOM(`<form><input><input type="password"></form>`, {
    url: 'https://main.example.test/sandboxed-login'
  });
  Object.defineProperty(dom.window, 'origin', {
    configurable: true,
    value: 'null'
  });
  makeInputsVisible(dom.window.document);
  const engine = new AutofillEngine(dom.window.document);

  const inspection = await engine.inspect();

  assert.equal(inspection.frameOrigin, 'null');
  engine.dispose();
});

test('retries a page-load fill when a dynamic login form appears', async () => {
  const { AutofillEngine } = loadTypeScriptModule('../src/Content/Autofill/AutofillEngine.ts');
  const dom = new JSDOM(`<main id="app"></main>`, {
    url: 'https://spa.example.test/'
  });
  const engine = new AutofillEngine(dom.window.document);

  dom.window.setTimeout(() => {
    dom.window.document.querySelector('#app').innerHTML = `
      <form>
        <input id="dynamic-user" autocomplete="username">
        <input id="dynamic-password" type="password" autocomplete="current-password">
      </form>
    `;
    makeInputsVisible(dom.window.document);
  }, 10);

  const result = await engine.fill({
    credential: {
      username: 'dynamic-user',
      password: 'dynamic-secret',
      url: 'https://spa.example.test/'
    },
    trigger: 'page-load'
  });

  assert.equal(result.status, 'complete');
  assert.equal(dom.window.document.querySelector('#dynamic-user').value, 'dynamic-user');
  assert.equal(dom.window.document.querySelector('#dynamic-password').value, 'dynamic-secret');
  engine.dispose();
});

test('applies an exact-origin selector rule before generic heuristics', async () => {
  const { AutofillEngine } = loadTypeScriptModule('../src/Content/Autofill/AutofillEngine.ts');
  const dom = new JSDOM(
    `
      <form>
        <input id="secret-box" type="password">
        <input id="identity-box" type="text">
      </form>
    `,
    { url: 'https://rules.example.test/login' }
  );
  makeInputsVisible(dom.window.document);
  const engine = new AutofillEngine(dom.window.document, [
    {
      id: 'rules-example',
      origins: ['https://rules.example.test'],
      pathPrefixes: ['/login'],
      selectors: {
        currentPassword: ['#secret-box'],
        username: ['#identity-box']
      }
    }
  ]);

  const result = await engine.fill({
    credential: {
      username: 'rule-user',
      password: 'rule-secret',
      url: 'https://rules.example.test/'
    },
    trigger: 'toolbar'
  });

  assert.equal(result.status, 'complete');
  assert.equal(dom.window.document.querySelector('#identity-box').value, 'rule-user');
  assert.equal(dom.window.document.querySelector('#secret-box').value, 'rule-secret');
  engine.dispose();
});

test('recognizes a structurally paired opaque username for the inline menu', async () => {
  const { AutofillEngine } = loadTypeScriptModule('../src/Content/Autofill/AutofillEngine.ts');
  const dom = new JSDOM(`<form><input id="opaque"><input type="password"></form>`, { url: 'https://inline.example.test/' });
  makeInputsVisible(dom.window.document);
  const username = dom.window.document.querySelector('#opaque');
  const engine = new AutofillEngine(dom.window.document);

  const inspection = await engine.inspect(username);

  assert.equal(inspection.focusedRole, 'username');
  assert.equal(inspection.candidateCount, 1);
  engine.dispose();
});

test('does not treat the username in a registration form as a standalone login', async () => {
  const { AutofillEngine } = loadTypeScriptModule('../src/Content/Autofill/AutofillEngine.ts');
  const dom = new JSDOM(
    `
      <form>
        <input id="registration-user" autocomplete="username">
        <input id="new-password" type="password" autocomplete="new-password">
        <input id="confirm-password" type="password" autocomplete="new-password">
      </form>
    `,
    { url: 'https://register.example.test/' }
  );
  makeInputsVisible(dom.window.document);
  const engine = new AutofillEngine(dom.window.document);

  const result = await engine.fill({
    credential: {
      username: 'existing-user',
      password: 'existing-secret',
      url: 'https://register.example.test/'
    },
    trigger: 'toolbar'
  });

  assert.equal(result.status, 'no-target');
  assert.equal(dom.window.document.querySelector('#registration-user').value, '');
  assert.equal(dom.window.document.querySelector('#new-password').value, '');
  engine.dispose();
});

test('discovers a login pair added inside an open shadow root', async () => {
  const { AutofillEngine } = loadTypeScriptModule('../src/Content/Autofill/AutofillEngine.ts');
  const dom = new JSDOM(`<login-shell></login-shell>`, {
    url: 'https://shadow.example.test/'
  });
  const host = dom.window.document.querySelector('login-shell');
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <div role="form">
      <input id="shadow-user">
      <input id="shadow-password" type="password">
    </div>
  `;
  makeInputsVisible(shadow);
  const engine = new AutofillEngine(dom.window.document);

  const result = await engine.fill({
    credential: {
      username: 'shadow-user',
      password: 'shadow-secret',
      url: 'https://shadow.example.test/'
    },
    trigger: 'toolbar'
  });

  assert.equal(result.status, 'complete');
  assert.equal(shadow.querySelector('#shadow-user').value, 'shadow-user');
  assert.equal(shadow.querySelector('#shadow-password').value, 'shadow-secret');
  engine.dispose();
});

test('does not treat a newsletter email field as a username-only login', async () => {
  const { AutofillEngine } = loadTypeScriptModule('../src/Content/Autofill/AutofillEngine.ts');
  const dom = new JSDOM(
    `
      <form id="newsletter">
        <h2>Subscribe to our newsletter</h2>
        <label for="email">Email</label>
        <input id="email" type="email">
      </form>
    `,
    { url: 'https://news.example.test/' }
  );
  makeInputsVisible(dom.window.document);
  const engine = new AutofillEngine(dom.window.document);

  const result = await engine.fill({
    credential: {
      username: 'private@example.test',
      password: 'secret',
      url: 'https://news.example.test/'
    },
    trigger: 'toolbar'
  });

  assert.equal(result.status, 'no-target');
  assert.equal(dom.window.document.querySelector('#email').value, '');
  engine.dispose();
});

test('page-load fills matched pairs in every form without filling search or OTP fields', async () => {
  const { AutofillEngine } = loadTypeScriptModule('../src/Content/Autofill/AutofillEngine.ts');
  const dom = new JSDOM(
    `
      <input id="site-search" type="search">
      <form id="header-login">
        <input id="header-user">
        <input id="header-password" type="password">
        <input id="header-otp" autocomplete="one-time-code">
      </form>
      <form id="dialog-login">
        <input id="dialog-user">
        <input id="dialog-password" type="password" autocomplete="current-password">
      </form>
    `,
    { url: 'https://multi.example.test/' }
  );
  makeInputsVisible(dom.window.document);
  const engine = new AutofillEngine(dom.window.document);

  const result = await engine.fill({
    credential: {
      username: 'multi-user',
      password: 'multi-secret',
      url: 'https://multi.example.test/'
    },
    trigger: 'page-load'
  });

  assert.equal(result.status, 'complete');
  assert.equal(result.usernameSatisfied, 2);
  assert.equal(result.passwordSatisfied, 2);
  assert.equal(dom.window.document.querySelector('#site-search').value, '');
  assert.equal(dom.window.document.querySelector('#header-otp').value, '');
  assert.equal(dom.window.document.querySelector('#header-user').value, 'multi-user');
  assert.equal(dom.window.document.querySelector('#dialog-user').value, 'multi-user');
  engine.dispose();
});

test('requires an explicit inline override for a new-password field', async () => {
  const { AutofillEngine } = loadTypeScriptModule('../src/Content/Autofill/AutofillEngine.ts');
  const dom = new JSDOM(`<form><input id="new-password" type="password" autocomplete="new-password"></form>`, { url: 'https://account.example.test/' });
  makeInputsVisible(dom.window.document);
  const field = dom.window.document.querySelector('#new-password');
  const engine = new AutofillEngine(dom.window.document);
  const credential = {
    username: 'person',
    password: 'saved-secret',
    url: 'https://account.example.test/'
  };

  const blocked = await engine.fill({
    credential,
    initiator: field,
    trigger: 'inline'
  });
  assert.equal(blocked.status, 'blocked');
  assert.equal(field.value, '');

  const confirmed = await engine.fill({
    allowNewPassword: true,
    credential,
    initiator: field,
    trigger: 'inline'
  });
  assert.equal(confirmed.status, 'complete');
  assert.equal(field.value, 'saved-secret');
  engine.dispose();
});

test('honors a selector-rule new-password role only after inline confirmation', async () => {
  const { AutofillEngine } = loadTypeScriptModule('../src/Content/Autofill/AutofillEngine.ts');
  const dom = new JSDOM(`<form><input id="site-specific-secret" type="password"></form>`, { url: 'https://account.example.test/change-password' });
  makeInputsVisible(dom.window.document);
  const field = dom.window.document.querySelector('#site-specific-secret');
  const engine = new AutofillEngine(dom.window.document, [
    {
      id: 'account-change-password',
      origins: ['https://account.example.test'],
      selectors: { newPassword: ['#site-specific-secret'] }
    }
  ]);
  const credential = {
    username: 'person',
    password: 'saved-secret',
    url: 'https://account.example.test/'
  };

  const blocked = await engine.fill({
    credential,
    initiator: field,
    trigger: 'inline'
  });
  assert.equal(blocked.status, 'blocked');
  assert.equal(field.value, '');

  const confirmed = await engine.fill({
    allowNewPassword: true,
    credential,
    initiator: field,
    trigger: 'inline'
  });
  assert.equal(confirmed.status, 'complete');
  assert.equal(field.value, 'saved-secret');
  engine.dispose();
});

test('reports a partial fill when page handlers reject one credential field', async () => {
  const { AutofillEngine } = loadTypeScriptModule('../src/Content/Autofill/AutofillEngine.ts');
  const dom = new JSDOM(`<form><input id="user"><input id="password" type="password"></form>`, { url: 'https://controlled.example.test/' });
  makeInputsVisible(dom.window.document);
  const username = dom.window.document.querySelector('#user');
  username.addEventListener('input', () => {
    username.value = '';
  });
  const engine = new AutofillEngine(dom.window.document);

  const result = await engine.fill({
    credential: {
      username: 'rejected-user',
      password: 'accepted-secret',
      url: 'https://controlled.example.test/'
    },
    trigger: 'toolbar'
  });

  assert.equal(result.status, 'partial');
  assert.equal(result.usernameSatisfied, 0);
  assert.equal(result.passwordSatisfied, 1);
  assert.deepEqual(result.reasons, ['field-rejected-value']);
  engine.dispose();
});

test('uses a selector-rule OTP role only as an exclusion', async () => {
  const { AutofillEngine } = loadTypeScriptModule('../src/Content/Autofill/AutofillEngine.ts');
  const dom = new JSDOM(
    `
      <form>
        <input id="login-identity">
        <input id="opaque-code">
        <input id="login-secret" type="password">
      </form>
    `,
    { url: 'https://rules.example.test/login' }
  );
  makeInputsVisible(dom.window.document);
  const engine = new AutofillEngine(dom.window.document, [
    {
      id: 'rules-otp',
      origins: ['https://rules.example.test'],
      selectors: { oneTimeCode: ['#opaque-code'] }
    }
  ]);

  const result = await engine.fill({
    credential: {
      username: 'rule-user',
      password: 'rule-secret',
      url: 'https://rules.example.test/'
    },
    trigger: 'toolbar'
  });

  assert.equal(result.status, 'complete');
  assert.equal(dom.window.document.querySelector('#login-identity').value, 'rule-user');
  assert.equal(dom.window.document.querySelector('#opaque-code').value, '');
  assert.equal(dom.window.document.querySelector('#login-secret').value, 'rule-secret');
  engine.dispose();
});

test('toolbar filling chooses the strongest logical form only', async () => {
  const { AutofillEngine } = loadTypeScriptModule('../src/Content/Autofill/AutofillEngine.ts');
  const dom = new JSDOM(
    `
      <form id="weak-login">
        <input id="weak-user">
        <input id="weak-password" type="password">
      </form>
      <form id="strong-login">
        <input id="strong-user" autocomplete="username">
        <input id="strong-password" type="password" autocomplete="current-password">
      </form>
    `,
    { url: 'https://multi.example.test/' }
  );
  makeInputsVisible(dom.window.document);
  const engine = new AutofillEngine(dom.window.document);

  const result = await engine.fill({
    credential: {
      username: 'best-user',
      password: 'best-secret',
      url: 'https://multi.example.test/'
    },
    trigger: 'toolbar'
  });

  assert.equal(result.status, 'complete');
  assert.equal(dom.window.document.querySelector('#weak-user').value, '');
  assert.equal(dom.window.document.querySelector('#weak-password').value, '');
  assert.equal(dom.window.document.querySelector('#strong-user').value, 'best-user');
  assert.equal(dom.window.document.querySelector('#strong-password').value, 'best-secret');
  engine.dispose();
});

test('ignores hidden disabled and readonly username decoys', async () => {
  const { AutofillEngine } = loadTypeScriptModule('../src/Content/Autofill/AutofillEngine.ts');
  const dom = new JSDOM(
    `
      <form>
        <input id="eligible-user">
        <input id="hidden-user" hidden>
        <input id="disabled-user" disabled>
        <input id="readonly-user" readonly>
        <input id="login-password" type="password">
      </form>
    `,
    { url: 'https://decoys.example.test/' }
  );
  makeInputsVisible(dom.window.document);
  const engine = new AutofillEngine(dom.window.document);

  const result = await engine.fill({
    credential: {
      username: 'real-user',
      password: 'real-secret',
      url: 'https://decoys.example.test/'
    },
    trigger: 'toolbar'
  });

  assert.equal(result.status, 'complete');
  assert.equal(dom.window.document.querySelector('#eligible-user').value, 'real-user');
  assert.equal(dom.window.document.querySelector('#hidden-user').value, '');
  assert.equal(dom.window.document.querySelector('#disabled-user').value, '');
  assert.equal(dom.window.document.querySelector('#readonly-user').value, '');
  assert.equal(dom.window.document.querySelector('#login-password').value, 'real-secret');
  engine.dispose();
});
