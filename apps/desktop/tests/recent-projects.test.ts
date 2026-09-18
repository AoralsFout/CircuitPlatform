import assert from "node:assert/strict";
import test from "node:test";
import {
  projectDisplayName,
  readRecentProjects,
  rememberRecentProject,
  RECENT_PROJECTS_LIMIT,
  type KeyValueStorage,
  type RecentProject,
} from "../src/project-file/recent-projects.ts";

/** 与 localStorage 同形状的内存实现，测试之间互不共享状态。 */
function memoryStorage(): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
  };
}

function entry(path: string, displayName: string, lastUsedAt: number): RecentProject {
  return { path, displayName, lastUsedAt };
}

test("records a saved project with its normalized path, file name and timestamp", () => {
  const storage = memoryStorage();
  const recent = rememberRecentProject(storage, [], "E:\\demo\\电路 A.CIRCUIT.JSON", { now: 1000, platform: "windows" });

  assert.deepEqual(recent, [entry("E:\\demo\\电路 A.CIRCUIT.JSON", "电路 A.CIRCUIT.JSON", 1000)]);
  // 存进存储的是同一份记录；规范化保号不丢盘符与段的大小写。
  assert.deepEqual(readRecentProjects(storage), recent);
});

test("folds different spellings of the same path into one entry on windows", () => {
  const recent = rememberRecentProject(
    null,
    [entry("E:\\demo\\a.circuit.json", "a.circuit.json", 100)],
    "e:/demo/A.CIRCUIT.JSON",
    { now: 200, platform: "windows" },
  );

  // Windows 身份大小写不敏感、分隔符统一：更新原条目而不是追加一条，置顶并刷新时间戳。
  // 记录的路径是规范化写法（盘符统一大写），显示名保留本次保存的原始文件名。
  assert.equal(recent.length, 1);
  assert.deepEqual(recent[0], { path: "E:\\demo\\A.CIRCUIT.JSON", displayName: "A.CIRCUIT.JSON", lastUsedAt: 200 });
});

test("keeps distinct spellings apart on posix", () => {
  const recent = rememberRecentProject(
    null,
    [entry("/home/demo/a.circuit.json", "a.circuit.json", 100)],
    "/home/demo/A.circuit.json",
    { now: 200, platform: "posix" },
  );

  assert.equal(recent.length, 2);
  assert.equal(recent[0]?.path, "/home/demo/A.circuit.json");
  assert.equal(recent[1]?.path, "/home/demo/a.circuit.json");
});

test("keeps the list most-recent-first while re-recording older entries", () => {
  // 调用方传入的列表本来就按最近在前排列；这里只验证重录置顶的语义。
  let recent = [
    entry("E:\\c.circuit.json", "c.circuit.json", 30),
    entry("E:\\b.circuit.json", "b.circuit.json", 20),
    entry("E:\\a.circuit.json", "a.circuit.json", 10),
  ];
  recent = rememberRecentProject(null, recent, "E:\\b.circuit.json", { now: 40, platform: "windows" });

  assert.deepEqual(recent.map((item) => item.path), ["E:\\b.circuit.json", "E:\\c.circuit.json", "E:\\a.circuit.json"]);
  assert.deepEqual(recent.map((item) => item.lastUsedAt), [40, 30, 10]);
});

test("caps the list at the configured limit and drops the oldest records", () => {
  let recent: RecentProject[] = [];
  for (let index = 0; index < RECENT_PROJECTS_LIMIT + 3; index += 1) {
    recent = rememberRecentProject(null, recent, `E:\\p${index}.circuit.json`, { now: index, platform: "windows" });
  }

  assert.equal(recent.length, RECENT_PROJECTS_LIMIT);
  // 最新的在头部，被挤出去的是最旧的 p0、p1、p2。
  assert.equal(recent[0]?.path, `E:\\p${RECENT_PROJECTS_LIMIT + 2}.circuit.json`);
  assert.equal(recent.some((item) => item.path === "E:\\p0.circuit.json"), false);
});

test("ignores empty paths and persists nothing for them", () => {
  const storage = memoryStorage();
  const recent = [entry("E:\\a.circuit.json", "a.circuit.json", 10)];

  assert.deepEqual(rememberRecentProject(storage, recent, "", { platform: "windows" }), recent);
  assert.equal(storage.data.size, 0);
});

test("keeps the in-memory result when the storage rejects writes", () => {
  const failingStorage: KeyValueStorage = {
    getItem: () => null,
    setItem: () => {
      throw new Error("quota exceeded");
    },
  };
  const recent = rememberRecentProject(failingStorage, [], "E:\\a.circuit.json", { platform: "windows" });

  assert.equal(recent.length, 1);
  assert.equal(recent[0]?.displayName, "a.circuit.json");
});

test("reads valid records and silently drops malformed ones", () => {
  const storage = memoryStorage();
  storage.setItem("circuit-platform.recent-projects", JSON.stringify([
    entry("E:\\good.circuit.json", "good.circuit.json", 30),
    { path: "", displayName: "x", lastUsedAt: 1 },
    { path: "E:\\bad.circuit.json", displayName: 5, lastUsedAt: 1 },
    "not-an-object",
    null,
  ]));

  const recent = readRecentProjects(storage);
  assert.deepEqual(recent, [entry("E:\\good.circuit.json", "good.circuit.json", 30)]);
});

test("returns an empty list for corrupt or absent storage data", () => {
  const storage = memoryStorage();
  assert.deepEqual(readRecentProjects(null), []);
  assert.deepEqual(readRecentProjects(storage), []);

  storage.setItem("circuit-platform.recent-projects", "{not json");
  assert.deepEqual(readRecentProjects(storage), []);

  storage.setItem("circuit-platform.recent-projects", JSON.stringify({ not: "an array" }));
  assert.deepEqual(readRecentProjects(storage), []);
});

test("orders records by usage time on read even if the stored order was shuffled", () => {
  const storage = memoryStorage();
  storage.setItem("circuit-platform.recent-projects", JSON.stringify([
    entry("E:\\old.circuit.json", "old.circuit.json", 10),
    entry("E:\\new.circuit.json", "new.circuit.json", 50),
    entry("E:\\mid.circuit.json", "mid.circuit.json", 30),
  ]));

  assert.deepEqual(
    readRecentProjects(storage).map((item) => item.path),
    ["E:\\new.circuit.json", "E:\\mid.circuit.json", "E:\\old.circuit.json"],
  );
});

test("derives the display name from the last path segment in both spellings", () => {
  assert.equal(projectDisplayName("E:\\demo\\a.circuit.json"), "a.circuit.json");
  assert.equal(projectDisplayName("/home/demo/a.circuit.json"), "a.circuit.json");
  assert.equal(projectDisplayName("a.circuit.json"), "a.circuit.json");
});
