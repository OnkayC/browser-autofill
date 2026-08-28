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
    throw new Error('AutofillRuleStore must depend only on its storage adapter');
  });
  return module.exports;
}

test('imports and persists a versioned exact-origin rule document', async () => {
  const { AutofillRuleStore } = loadTypeScriptModule('../src/Content/Autofill/AutofillRuleStore.ts');
  let saved = null;
  const storage = {
    load: async () => saved,
    save: async document => {
      saved = document;
    }
  };
  const store = new AutofillRuleStore(storage, selector => selector.startsWith('#'));
  const json = JSON.stringify({
    rules: [
      {
        enabled: true,
        id: 'bank-login',
        origins: ['https://bank.example.test'],
        pathPrefixes: ['/login'],
        selectors: {
          currentPassword: ['#password'],
          username: ['#username']
        }
      }
    ],
    version: 1
  });

  const rules = await store.import(json);

  assert.equal(rules.length, 1);
  assert.equal(saved.version, 1);
  assert.equal(saved.rules[0].id, 'bank-login');
  assert.equal(await store.export(), JSON.stringify(saved, null, 2));
});

test('rejects wildcard origins and invalid selectors', async () => {
  const { AutofillRuleStore } = loadTypeScriptModule('../src/Content/Autofill/AutofillRuleStore.ts');
  const store = new AutofillRuleStore({ load: async () => null, save: async () => undefined }, selector => selector.startsWith('#'));

  await assert.rejects(
    store.import(
      JSON.stringify({
        rules: [
          {
            id: 'unsafe',
            origins: ['https://*.example.test'],
            selectors: { username: ['input['] }
          }
        ],
        version: 1
      })
    ),
    /exact http or https origin/
  );
});

test('skips corrupted stored rules while retaining valid rules', async () => {
  const { AutofillRuleStore } = loadTypeScriptModule('../src/Content/Autofill/AutofillRuleStore.ts');
  const stored = {
    rules: [
      {
        id: 'corrupted',
        origins: ['https://*.example.test'],
        selectors: { username: ['#bad'] }
      },
      {
        id: 'valid-login',
        origins: ['https://login.example.test'],
        selectors: { username: ['#user'] }
      }
    ],
    version: 1
  };
  const store = new AutofillRuleStore({ load: async () => stored, save: async () => undefined }, selector => selector.startsWith('#'));

  const rules = await store.load();

  assert.deepEqual(
    rules.map(rule => rule.id),
    ['valid-login']
  );
});
