const assert = require("node:assert/strict");
const { mkdtemp, readFile, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { basename, dirname, join, resolve } = require("node:path");
const test = require("node:test");

async function probe(script, overrides = {}) {
  const { runRegressionProcess } = await import("../../../scripts/lib/regression-process.mjs");
  const directory = await mkdtemp(join(tmpdir(), "regression-runner-test-"));
  const logPath = join(directory, "output.log");
  try {
    const result = await runRegressionProcess({ command: process.execPath, args: ["-e", script], cwd: directory, env: process.env, logPath, successMarker: "probe passed", mirrorOutput: false, ...overrides });
    return { ...result, output: await readFile(logPath, "utf8") };
  } finally {
    const cleanupPath = resolve(directory);
    assert.equal(dirname(cleanupPath), resolve(tmpdir()));
    assert.ok(basename(cleanupPath).startsWith("regression-runner-test-"));
    await rm(cleanupPath, { recursive: true, force: true });
  }
}

test("regression runner requires a completed success marker and captures stdout and stderr", async () => {
  const result = await probe("console.log('probe passed'); console.error('diagnostic');");
  assert.equal(result.passed, true);
  assert.match(result.output, /probe passed/);
  assert.match(result.output, /diagnostic/);
});

test("regression runner rejects skipped or silently incomplete scenarios", async () => {
  const skipped = await probe("console.log('SKIP missing engine'); console.log('probe passed');");
  assert.equal(skipped.passed, false);
  assert.match(skipped.failure, /SKIP/);
  const incomplete = await probe("console.log('mounted');");
  assert.equal(incomplete.passed, false);
  assert.match(incomplete.failure, /完成标记/);
});

test("regression runner rejects failures even after a success marker", async () => {
  const result = await probe("console.log('probe passed'); process.exitCode = 7;");
  assert.equal(result.passed, false);
  assert.equal(result.exitCode, 7);
});

test("regression runner terminates a hung process and reports a timeout", async () => {
  const result = await probe("setInterval(() => {}, 1000);", { timeoutMs: 200 });
  assert.equal(result.passed, false);
  assert.match(result.failure, /超过 200ms/);
});

test("regression runner reports a missing executable as failure", async () => {
  const result = await probe("", { command: join(tmpdir(), "circuit-regression-no-such-command") });
  assert.equal(result.passed, false);
  assert.match(result.failure, /无法启动/);
});
