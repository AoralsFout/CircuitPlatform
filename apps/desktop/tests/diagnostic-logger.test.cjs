const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createDiagnosticLogger } = require("../electron/diagnostic-logger.cjs");

async function temporaryDirectory(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "circuit-diagnostics-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

test("diagnostic logs persist only approved metadata and never project content or raw errors", async (t) => {
  const directory = await temporaryDirectory(t);
  const logger = createDiagnosticLogger({ directory });
  assert.equal(logger.log("app_start", {
    packaged: true,
    version: "0.1.0",
    platform: "win32",
    message: "private project contents",
    path: "C:/Users/private-user/private-project.circuit.json",
    project: { title: "private project" },
    stderr: "sensitive stderr",
    requestId: "secret request identity",
    documentKey: "secret document identity",
  }), true);
  logger.log("app_error", {
    code: "EACCES",
    operation: "save_project",
    reason: "raw private stderr",
    error: new Error("private file path"),
  });
  logger.log("renderer_gone", { reason: "crashed", exitCode: 7 });
  assert.equal(logger.log("private-untrusted-event", { message: "private" }), false);
  await logger.flush();
  const content = await fs.readFile(logger.filePath, "utf8");
  assert.doesNotMatch(content, /private|sensitive|secret/);
  const entries = content.trim().split("\n").map(JSON.parse);
  assert.equal(entries.length, 3);
  assert.equal(entries[0].packaged, true);
  assert.equal(entries[1].code, "EACCES");
  assert.equal(entries[2].reason, "crashed");
  assert.ok(entries.every((entry) => !Number.isNaN(Date.parse(entry.timestamp))));
});

test("rotation caps total file count and bytes while retaining the newest diagnostics", async (t) => {
  const directory = await temporaryDirectory(t);
  const logger = createDiagnosticLogger({ directory, maxFileBytes: 320, maxFiles: 3 });
  for (let epoch = 1; epoch <= 30; epoch += 1) {
    assert.equal(logger.log("engine_spawn", { epoch }), true);
  }
  await logger.flush();
  const names = await fs.readdir(directory);
  assert.equal(names.length, 3);
  assert.deepEqual(names.sort(), ["circuit-platform.log", "circuit-platform.log.1", "circuit-platform.log.2"]);
  for (const name of names) {
    assert.ok((await fs.stat(path.join(directory, name))).size <= 320);
    const lines = (await fs.readFile(path.join(directory, name), "utf8")).trim().split("\n");
    assert.ok(lines.every((line) => JSON.parse(line).event === "engine_spawn"));
  }
  const current = (await fs.readFile(logger.filePath, "utf8")).trim().split("\n").map(JSON.parse);
  assert.equal(current.at(-1).epoch, 30);
});

test("a second logger resumes existing size accounting and rotates before appending", async (t) => {
  const directory = await temporaryDirectory(t);
  const first = createDiagnosticLogger({ directory, maxFileBytes: 256, maxFiles: 2 });
  first.log("engine_spawn", { epoch: 1 });
  first.log("engine_spawn", { epoch: 2 });
  await first.flush();
  const second = createDiagnosticLogger({ directory, maxFileBytes: 256, maxFiles: 2 });
  for (let epoch = 3; epoch <= 8; epoch += 1) second.log("engine_spawn", { epoch });
  await second.flush();
  const names = await fs.readdir(directory);
  assert.equal(names.length, 2);
  for (const name of names) assert.ok((await fs.stat(path.join(directory, name))).size <= 256);
});

test("one-file retention discards the old file without creating backups", async (t) => {
  const directory = await temporaryDirectory(t);
  const logger = createDiagnosticLogger({ directory, maxFileBytes: 256, maxFiles: 1 });
  for (let epoch = 1; epoch <= 10; epoch += 1) logger.log("engine_spawn", { epoch });
  await logger.flush();
  assert.deepEqual(await fs.readdir(directory), ["circuit-platform.log"]);
  assert.ok((await fs.stat(logger.filePath)).size <= 256);
  assert.equal(JSON.parse((await fs.readFile(logger.filePath, "utf8")).trim().split("\n").at(-1)).epoch, 10);
});

test("unwritable log locations disable diagnostics without rejecting flush or future application work", async (t) => {
  const directory = await temporaryDirectory(t);
  const blocker = path.join(directory, "not-a-directory");
  await fs.writeFile(blocker, "unchanged");
  const logger = createDiagnosticLogger({ directory: path.join(blocker, "logs") });
  assert.equal(logger.log("app_start"), true);
  await assert.doesNotReject(logger.flush());
  assert.equal(logger.status().disabled, true);
  assert.equal(logger.log("app_ready"), false);
  assert.equal(await fs.readFile(blocker, "utf8"), "unchanged");
});

test("a burst exceeding the queue limit drops diagnostics instead of growing memory", async (t) => {
  const directory = await temporaryDirectory(t);
  const logger = createDiagnosticLogger({ directory, maxQueuedEntries: 2 });
  const accepted = [];
  for (let epoch = 0; epoch < 100; epoch += 1) accepted.push(logger.log("engine_spawn", { epoch }));
  assert.equal(accepted.filter(Boolean).length, 2);
  assert.equal(logger.status().droppedEntries, 98);
  await logger.flush();
  assert.equal((await fs.readFile(logger.filePath, "utf8")).trim().split("\n").length, 2);
  assert.equal(logger.log("app_quit"), true);
  await logger.flush();
  assert.match(await fs.readFile(logger.filePath, "utf8"), /app_quit/);
});
