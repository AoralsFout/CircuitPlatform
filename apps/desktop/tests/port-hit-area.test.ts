import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

const desktopRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..");

test("port hit area stays 24px square and straddles the component boundary", async () => {
  const styles = await readFile(join(desktopRoot, "src", "styles.css"), "utf8");
  const portRule = styles.match(/\.node-port\s*\{([^}]*)\}/)?.[1] ?? "";
  const feedbackRule = styles.match(/\.node-port:hover, \.node-port:focus-visible, \.node-port--connection-target\s*\{([^}]*)\}/)?.[1] ?? "";

  assert.match(portRule, /(?:^|;)\s*width:\s*24px;/);
  assert.match(portRule, /(?:^|;)\s*height:\s*24px;/);
  assert.match(portRule, /(?:^|;)\s*border:\s*1px solid transparent;/);
  assert.match(styles, /\.node-port--left\s*\{[^}]*left:\s*-12px;/);
  assert.match(styles, /\.node-port--right\s*\{[^}]*right:\s*-12px;/);
  assert.match(styles, /\.node-port--left \.node-port__anchor\s*\{[^}]*left:\s*50%;/);
  assert.match(styles, /\.node-port--right \.node-port__anchor\s*\{[^}]*right:\s*50%;/);
  assert.match(feedbackRule, /(?:^|;)\s*border-color:\s*color-mix\(/);
});
