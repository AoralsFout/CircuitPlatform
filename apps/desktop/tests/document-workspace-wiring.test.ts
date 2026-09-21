import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const desktopRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..");

test("App projects active document tabs and forwards activation/close commands", async () => {
  const app = await readFile(join(desktopRoot, "src", "App.vue"), "utf8");
  const facade = await readFile(join(desktopRoot, "src", "composables", "useDocumentWorkspace.ts"), "utf8");
  const topBar = await readFile(join(desktopRoot, "src", "components", "TopBar.vue"), "utf8");
  assert.match(app, /useDocumentWorkspace/);
  assert.match(app, /:tabs="tabs"/);
  assert.match(app, /:active-document-key="activeDocumentKey"/);
  assert.match(app, /@activate-tab="activateTab"/);
  assert.match(app, /@close-tab="closeTab"/);
  assert.match(app, /disposeDocumentWorkspace\(\)/);
  assert.match(facade, /projectPathIdentity/);
  assert.match(facade, /const pathKeys = new Map/);
  assert.match(facade, /binding\.dispose\(\)/);
  assert.match(facade, /if \(disposed \|\| record\.disposed\) return false/);
  assert.match(topBar, /class="document-tab__close-wrap"/);
  assert.doesNotMatch(topBar, /v-if="tabs\.length > 1"/);
  assert.match(topBar, /event\.target\.closest\("button"\)/);
});

test("per-document facade keeps editor-state controllers with each document", async () => {
  const facade = await readFile(join(desktopRoot, "src", "composables", "useDocumentWorkspace.ts"), "utf8");
  assert.match(facade, /useWorkspace\(\{ documentKey: key(?:, temporaryName)?/);
  assert.match(facade, /useEditorState\(/);
  assert.match(facade, /const active = computed/);
  assert.match(facade, /return workspaceFacade/);
});
