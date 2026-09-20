import assert from "node:assert/strict";
import test from "node:test";
import {
  currentPathPlatform,
  normalizeProjectPath,
  projectPathIdentity,
  projectDirectory,
  relativeProjectReference,
  resolveProjectReference,
  sameProjectPath,
} from "../src/project-file/paths.ts";

const win = { platform: "windows" as const };
const posix = { platform: "posix" as const };

test("detects the controlled platform probe only for defaults", () => {
  // 探测只为省略平台参数的应用代码兜底；下面的测试一律显式传参，两种平台语义都覆盖到。
  assert.ok(["windows", "posix"].includes(currentPathPlatform()));
});

test("unifies separators, removes dot segments, and uppercases the drive letter on Windows", () => {
  assert.equal(normalizeProjectPath("c:/proj/./sub\\..\\dir\\", win), "C:\\proj\\dir");
  assert.equal(normalizeProjectPath("C:\\proj\\sub\\..\\..\\f.circuit.json", win), "C:\\f.circuit.json");
  assert.equal(normalizeProjectPath("C:\\", win), "C:\\");
  assert.equal(normalizeProjectPath("C:/a/..", win), "C:\\");
});

test("resolves relative input against the base and keeps it relative without one", () => {
  assert.equal(
    normalizeProjectPath("..\\assets\\icon.png", { ...win, base: "C:\\proj\\src" }),
    "C:\\proj\\assets\\icon.png",
  );
  assert.equal(normalizeProjectPath("sub\\f.circuit.json", { ...win, base: "C:\\proj" }), "C:\\proj\\sub\\f.circuit.json");
  // 绝对输入不受基准影响；无基准的相对输入保持相对（身份用途必须传绝对输入或基准）。
  assert.equal(normalizeProjectPath("C:\\other\\f.circuit.json", { ...win, base: "C:\\proj" }), "C:\\other\\f.circuit.json");
  assert.equal(normalizeProjectPath("..\\a\\b.circuit.json", win), "..\\a\\b.circuit.json");
});

test("resolves relative references against the project directory on POSIX", () => {
  assert.equal(normalizeProjectPath("../lib/gate.circuit.json", { ...posix, base: "/home/u/proj" }), "/home/u/lib/gate.circuit.json");
  assert.equal(normalizeProjectPath("a/./b//c/../d/", posix), "a/b/d");
  assert.equal(normalizeProjectPath("/a/b", { ...posix, base: "/somewhere" }), "/a/b");
  assert.equal(normalizeProjectPath("../x", posix), "../x");
  assert.equal(normalizeProjectPath("/a/../..", posix), "/");
});

test("treats a drive letter as absolute even without a separator", () => {
  // 词法规范化没有每个盘各自 cwd 的信息：`C:foo` 这类盘相对写法按 `C:\foo` 处理，
  // 换取「有盘符就有绝对身份」这条单一规则。
  assert.equal(normalizeProjectPath("c:proj", win), "C:\\proj");
});

test("keeps UNC roots and folds their case only in identity", () => {
  assert.equal(normalizeProjectPath("//srv/share/dir", win), "\\\\srv\\share\\dir");
  assert.equal(normalizeProjectPath("\\\\srv\\share\\..\\x", win), "\\\\srv\\share\\x");
  assert.equal(
    normalizeProjectPath("\\\\FileServer\\Projects\\demo.circuit.json", win),
    "\\\\FileServer\\Projects\\demo.circuit.json",
  );
  assert.equal(sameProjectPath("\\\\SRV\\Share\\x", "\\\\srv\\share\\x", "windows"), true);
});

test("keeps the user's casing in the normalized form and folds it only for identity", () => {
  // 显示保留原始写法：规范化结果不改用户的大小写（盘符除外），折叠只发生在身份键里。
  const normalized = normalizeProjectPath("C:\\Users\\Me\\Proj.circuit.json", win);
  assert.equal(normalized, "C:\\Users\\Me\\Proj.circuit.json");
  assert.equal(projectPathIdentity(normalized, "windows"), "c:\\users\\me\\proj.circuit.json");
});

test("folds different spellings of the same project into one identity on Windows", () => {
  assert.equal(sameProjectPath("c:/proj/My File.circuit.json", "C:\\PROJ\\my file.CIRCUIT.JSON", "windows"), true);
  assert.equal(sameProjectPath("C:\\proj\\a\\..\\f.circuit.json", "C:\\proj\\f.circuit.json", "windows"), true);
  assert.equal(sameProjectPath("C:\\proj\\f.circuit.json", "C:\\other\\f.circuit.json", "windows"), false);
  assert.equal(
    projectPathIdentity("D:\\Work\\demo.circuit.json", "windows") === projectPathIdentity("d:/work/demo.circuit.json", "windows"),
    true,
  );
});

test("compares case-sensitively on POSIX and insensitively on Windows", () => {
  assert.equal(sameProjectPath("/Proj/A.circuit.json", "/proj/a.circuit.json", "posix"), false);
  assert.equal(sameProjectPath("/Proj/A.circuit.json", "/proj/a.circuit.json", "windows"), true);
  assert.equal(sameProjectPath("/proj/a.circuit.json", "/proj/a.circuit.json", "posix"), true);
});

test("never resolves symlinks and never touches the filesystem", () => {
  // 即使 `latest` 是指向 `proj-2024` 的目录链接（symlink/junction），词法规范化也不解析：
  // 经由不同链接到达的路径就是不同身份，这条被明确接受。
  assert.equal(
    sameProjectPath("C:\\data\\latest\\proj.circuit.json", "C:\\data\\proj-2024\\proj.circuit.json", "windows"),
    false,
  );
  // 不存在的路径照常规范化——纯词法函数不做存在性检查。
  assert.equal(
    normalizeProjectPath("C:\\no\\such\\dir\\f.circuit.json", win),
    "C:\\no\\such\\dir\\f.circuit.json",
  );
});

test("keeps backslashes as literal filename characters on POSIX", () => {
  assert.equal(normalizeProjectPath("/a\\b/c", posix), "/a\\b/c");
  assert.equal(sameProjectPath("/a\\b", "/a/b", "posix"), false);
});

test("normalization is idempotent", () => {
  for (const [input, options] of [
    ["c:/proj/./sub\\..\\dir\\", win],
    ["/a/./b//c/../d/", posix],
    ["..\\a\\b.circuit.json", win],
    ["../x", posix],
  ] as const) {
    const once = normalizeProjectPath(input, options);
    assert.equal(normalizeProjectPath(once, options), once);
  }
});

test("derives project directories and resolves references lexically", () => {
  assert.equal(projectDirectory("C:\\proj\\root.circuit.json", win), "C:\\proj");
  assert.equal(projectDirectory("/home/u/root.circuit.json", posix), "/home/u");
  assert.equal(
    resolveProjectReference("..\\lib\\child.circuit.json", "C:\\proj\\root.circuit.json", "windows"),
    "C:\\lib\\child.circuit.json",
  );
  assert.equal(
    resolveProjectReference("../lib/child.circuit.json", "/home/u/proj/root.circuit.json", "posix"),
    "/home/u/lib/child.circuit.json",
  );
});

test("computes portable relative references and rejects different Windows roots", () => {
  assert.equal(
    relativeProjectReference("C:\\lib\\child.circuit.json", "C:\\proj\\root.circuit.json", "windows"),
    "..\\lib\\child.circuit.json",
  );
  assert.equal(
    relativeProjectReference("/home/u/lib/child.circuit.json", "/home/u/proj/root.circuit.json", "posix"),
    "../lib/child.circuit.json",
  );
  assert.equal(relativeProjectReference("D:\\lib\\child.circuit.json", "C:\\proj\\root.circuit.json", "windows"), null);
  assert.equal(relativeProjectReference("/home/u/proj/other.circuit.json", "/home/u/proj/root.circuit.json", "posix"), "other.circuit.json");
});
