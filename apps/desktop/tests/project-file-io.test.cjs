const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { writeTextFileAtomically } = require("../electron/project-file-io.cjs");

/** 建一个用完即删的临时目录，真实文件系统上验证原子替换语义。 */
function makeTempDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "circuit-save-"));
}

test("writes the target file with the exact content and leaves no temporary files", () => {
  const directory = makeTempDirectory();
  try {
    const target = path.join(directory, "demo.circuit.json");
    writeTextFileAtomically(fs, target, '{"version":1}');
    assert.equal(fs.readFileSync(target, "utf8"), '{"version":1}');
    assert.deepEqual(fs.readdirSync(directory), ["demo.circuit.json"]);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("replaces an existing target without leaving partial content behind", () => {
  const directory = makeTempDirectory();
  try {
    const target = path.join(directory, "demo.circuit.json");
    fs.writeFileSync(target, "旧内容", "utf8");
    writeTextFileAtomically(fs, target, "新内容");
    assert.equal(fs.readFileSync(target, "utf8"), "新内容");
    assert.deepEqual(fs.readdirSync(directory), ["demo.circuit.json"]);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("a failed write leaves the previous target content untouched and cleans the temporary file", () => {
  const directory = makeTempDirectory();
  try {
    const target = path.join(directory, "demo.circuit.json");
    fs.writeFileSync(target, "旧内容", "utf8");
    const brokenFs = {
      writeFileSync() {
        throw Object.assign(new Error("磁盘已满"), { code: "ENOSPC" });
      },
      renameSync() {
        throw new Error("不应被调用");
      },
      unlinkSync() {},
    };
    assert.throws(() => writeTextFileAtomically(brokenFs, target, "新内容"), /磁盘已满/);
    assert.equal(fs.readFileSync(target, "utf8"), "旧内容");
    assert.deepEqual(fs.readdirSync(directory), ["demo.circuit.json"]);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("a failed rename cleans the temporary file and keeps the previous target", () => {
  const directory = makeTempDirectory();
  try {
    const target = path.join(directory, "demo.circuit.json");
    fs.writeFileSync(target, "旧内容", "utf8");
    const tempPaths = [];
    const brokenFs = {
      writeFileSync(tempPath, content) {
        tempPaths.push(tempPath);
        fs.writeFileSync(tempPath, content, "utf8");
      },
      renameSync() {
        throw new Error("替换失败");
      },
      unlinkSync(tempPath) {
        fs.unlinkSync(tempPath);
      },
    };
    assert.throws(() => writeTextFileAtomically(brokenFs, target, "新内容"), /替换失败/);
    assert.equal(fs.readFileSync(target, "utf8"), "旧内容");
    assert.deepEqual(fs.readdirSync(directory), ["demo.circuit.json"]);
    assert.equal(tempPaths.length, 1);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
