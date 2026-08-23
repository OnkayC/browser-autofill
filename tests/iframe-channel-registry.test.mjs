import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";

function loadTypeScriptModule(
  relativeUrl,
  browserId = "strongbox@phoebecode.com",
) {
  const filename = fileURLToPath(new URL(relativeUrl, import.meta.url));
  const source = readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filename,
  }).outputText;
  const module = { exports: {} };
  const browser = {
    runtime: { getURL: (path) => `moz-extension://${browserId}/${path}` },
  };

  Function(
    "module",
    "exports",
    "require",
    output,
  )(module, module.exports, () => ({ default: browser }));
  return module.exports;
}

const { IframeChannelRegistry } = loadTypeScriptModule(
  "../src/Background/IframeChannelRegistry.ts",
);
const validToken = (character) => character.repeat(64);
const webSender = (tabId) => ({
  tab: { id: tabId },
  url: "https://example.test/login",
});
const iframeSender = (tabId) => ({
  tab: { id: tabId },
  url: "moz-extension://strongbox@phoebecode.com/iframe.html",
});

test("accepts registrations only from web content scripts with strong tokens", () => {
  assert.equal(IframeChannelRegistry.register("short", webSender(11)), false);
  assert.equal(
    IframeChannelRegistry.register(validToken("a"), iframeSender(11)),
    false,
  );
  assert.equal(
    IframeChannelRegistry.register(validToken("b"), webSender(11)),
    true,
  );
});

test("allows a registered extension iframe in the same tab to claim once", () => {
  const wrongTabToken = validToken("c");
  assert.equal(
    IframeChannelRegistry.register(wrongTabToken, webSender(21)),
    true,
  );
  assert.equal(
    IframeChannelRegistry.claim(wrongTabToken, iframeSender(22)),
    false,
  );
  assert.equal(
    IframeChannelRegistry.claim(wrongTabToken, iframeSender(21)),
    false,
  );

  const wrongContextToken = validToken("d");
  assert.equal(
    IframeChannelRegistry.register(wrongContextToken, webSender(21)),
    true,
  );
  assert.equal(
    IframeChannelRegistry.claim(wrongContextToken, webSender(21)),
    false,
  );

  const validChannelToken = validToken("e");
  assert.equal(
    IframeChannelRegistry.register(validChannelToken, webSender(21)),
    true,
  );
  assert.equal(
    IframeChannelRegistry.claim(validChannelToken, iframeSender(21)),
    true,
  );
  assert.equal(
    IframeChannelRegistry.claim(validChannelToken, iframeSender(21)),
    false,
  );
});
