/**
 * 项目路径的词法规范化：身份是规范化后的绝对路径，规则由规格 #34 定死。
 *
 * 规范化是纯词法操作——统一分隔符、消除 `.` 与 `..` 段、Windows 盘符统一大写——
 * 不做任何 IO，不读工作目录，也不解析符号链接：同一实体经由不同链接到达的路径就是
 * 不同身份，这条被明确接受。显示始终保留用户的原始写法，调用方保存原始输入；
 * 规范化结果只用于身份与比较，比较在 Windows 上大小写不敏感、POSIX 上大小写敏感。
 */

/** 路径语义所属的平台；同一输入在两种平台上会得到不同的规范化结果与比较规则。 */
export type PathPlatform = "windows" | "posix";

/**
 * 当前运行平台的受控探测点，也是本模块唯一读取运行环境的地方。
 * @returns 应用代码省略平台参数时使用的平台；单元测试显式传参覆盖两种语义，不依赖这里。
 */
export function currentPathPlatform(): PathPlatform {
  // 走 `globalThis` 而不是直接引用 `process`：渲染进程与浏览器环境里没有 Node 类型可依赖，
  // 探测必须在不引入任何环境假设的前提下保持安全。
  const detected = (globalThis as { process?: { platform?: string } }).process?.platform;
  return detected === "win32" ? "windows" : "posix";
}

/** `normalizeProjectPath` 的可选参数。 */
export interface ProjectPathOptions {
  /**
   * 相对输入的基准路径。文件内部的相对引用（Phase 5.5 的 Subcircuit）以包含引用的那份
   * Project 文件所在目录为基准；省略时相对输入保持相对——身份用途必须传绝对输入或基准。
   */
  base?: string;
  /** 平台语义；省略时取 `currentPathPlatform()`。 */
  platform?: PathPlatform;
}

/** 拆解后的路径：根前缀（相对路径为空串）加上尚待消解 `..` 的原始段。 */
interface PathParts {
  root: string;
  segments: string[];
}

/**
 * 把一个路径词法规范化：绝对化（有基准时）、统一分隔符、消除 `.`/`..` 段。
 * @param input 用户写法的路径；显示用途请另行保留这个原始值。
 * @param options 基准路径与平台语义。
 * @returns 规范化后的路径字符串；相对输入且无基准时结果仍是相对路径。
 */
export function normalizeProjectPath(input: string, options: ProjectPathOptions = {}): string {
  const platform = options.platform ?? currentPathPlatform();
  const parts = platform === "windows" ? parseWindowsPath(input) : parsePosixPath(input);

  // 相对输入才需要基准；基准先原样并入段序列，`.`/`..` 在合并后统一消解，
  // 这与词法 resolve 的语义一致（`a/b` + `../c` 归结为 `a/c`）。
  if (parts.root === "" && options.base !== undefined && options.base !== "") {
    const base = platform === "windows" ? parseWindowsPath(options.base) : parsePosixPath(options.base);
    parts.segments = [...base.segments, ...parts.segments];
    parts.root = base.root;
  }

  const resolved = resolveSegments(parts.segments, parts.root !== "");
  return platform === "windows" ? joinWindowsPath(parts.root, resolved) : joinPosixPath(parts.root, resolved);
}

/**
 * 判断两条写法不同的路径是否指向同一份 Project。
 * @param a 一条路径的任意写法。
 * @param b 另一条路径的任意写法。
 * @param platform 比较所用的平台语义；Windows 大小写不敏感，POSIX 敏感。
 * @returns 两条路径规范化并按平台规则折叠后一致时返回 true。
 */
export function sameProjectPath(a: string, b: string, platform: PathPlatform = currentPathPlatform()): boolean {
  return projectPathIdentity(a, platform) === projectPathIdentity(b, platform);
}

/**
 * 一条路径的身份键：规范化后在 Windows 上折叠为小写。
 * @param path 路径的任意写法。
 * @param platform 平台语义。
 * @returns 可直接用于去重表与映射键的字符串；同一份 Project 的不同写法得到同一个键。
 */
export function projectPathIdentity(path: string, platform: PathPlatform = currentPathPlatform()): string {
  const normalized = normalizeProjectPath(path, { platform });
  return platform === "windows" ? normalized.toLowerCase() : normalized;
}

/**
 * 取项目文件所在目录的词法路径。
 * @param path 项目文件路径，可以是绝对路径或带 `base` 的相对路径。
 * @param options 路径平台与相对路径基准。
 * @returns 不含最后一段文件名的规范化目录路径。
 */
export function projectDirectory(path: string, options: ProjectPathOptions = {}): string {
  const platform = options.platform ?? currentPathPlatform();
  const normalized = normalizeProjectPath(path, options);
  const parts = platform === "windows" ? parseWindowsPath(normalized) : parsePosixPath(normalized);
  if (parts.segments.length > 0) parts.segments.pop();
  return platform === "windows" ? joinWindowsPath(parts.root, parts.segments) : joinPosixPath(parts.root, parts.segments);
}

/**
 * 按包含它的 Project 目录解析一条 Subcircuit 相对引用。
 * @param reference 文件中保存的相对引用或绝对路径。
 * @param parentProject 父 Project 的路径。
 * @param platform 平台语义。
 * @returns 规范化后的目标路径；不访问文件系统。
 */
export function resolveProjectReference(
  reference: string,
  parentProject: string,
  platform: PathPlatform = currentPathPlatform(),
): string {
  return normalizeProjectPath(reference, { base: projectDirectory(parentProject, { platform }), platform });
}

/**
 * 以父 Project 所在目录为基准计算目标 Project 的相对引用。
 * @param targetProject 目标 Project 路径。
 * @param parentProject 父 Project 路径。
 * @param platform 平台语义。
 * @returns 可保存的相对路径；不同根（例如不同 Windows 盘符）时返回 null。
 */
export function relativeProjectReference(
  targetProject: string,
  parentProject: string,
  platform: PathPlatform = currentPathPlatform(),
): string | null {
  const target = normalizeProjectPath(targetProject, { platform });
  const base = projectDirectory(parentProject, { platform });
  const targetParts = platform === "windows" ? parseWindowsPath(target) : parsePosixPath(target);
  const baseParts = platform === "windows" ? parseWindowsPath(base) : parsePosixPath(base);
  const equalSegment = platform === "windows"
    ? (left: string, right: string) => left.toLowerCase() === right.toLowerCase()
    : (left: string, right: string) => left === right;
  if (targetParts.root.toLowerCase() !== baseParts.root.toLowerCase()) return null;

  let common = 0;
  while (common < targetParts.segments.length && common < baseParts.segments.length &&
    equalSegment(targetParts.segments[common]!, baseParts.segments[common]!)) common += 1;
  const relative = [
    ...baseParts.segments.slice(common).map(() => ".."),
    ...targetParts.segments.slice(common),
  ];
  if (relative.length === 0) return ".";
  return platform === "windows" ? relative.join("\\") : relative.join("/");
}

/** 按 Windows 分隔符拆出原始段，空段与 `.` 段在词法上不承载任何信息，直接丢弃。 */
function splitWindowsSegments(text: string): string[] {
  return text.split("\\").filter((segment) => segment !== "" && segment !== ".");
}

function parseWindowsPath(input: string): PathParts {
  const unified = input.replace(/\//g, "\\");

  // UNC 根是 `\\server\share` 两段；只有一段（或空）时按已有前缀保留，`..` 处理仍有根可依。
  if (unified.startsWith("\\\\")) {
    const raw = splitWindowsSegments(unified.slice(2));
    const head = raw.slice(0, 2);
    return { root: `\\\\${head.join("\\")}`, segments: raw.slice(2) };
  }

  // 盘符出现即视为绝对路径：词法规范化没有每个盘各自 cwd 的信息，`C:foo` 这类
  // 盘相对写法按 `C:\foo` 处理，换取「有盘符就有绝对身份」这条单一规则。
  const drive = /^([A-Za-z]):(.*)$/.exec(unified);
  if (drive) {
    return { root: `${drive[1]!.toUpperCase()}:\\`, segments: splitWindowsSegments(drive[2]!) };
  }

  // 没有盘符但以根分隔符开头（`\foo`）指向当前盘的根，同样是绝对路径。
  if (unified.startsWith("\\")) {
    return { root: "\\", segments: splitWindowsSegments(unified) };
  }

  return { root: "", segments: splitWindowsSegments(unified) };
}

function parsePosixPath(input: string): PathParts {
  // 反斜杠在 POSIX 上是合法的文件名字符，只有 `/` 是分隔符，不做任何替换。
  const absolute = input.startsWith("/");
  const segments = input.split("/").filter((segment) => segment !== "" && segment !== ".");
  return { root: absolute ? "/" : "", segments };
}

/**
 * 消解 `.` 与 `..` 段。有根时越出根的 `..` 被丢弃（`C:\..` 就是 `C:\`）；
 * 相对路径越出起点的 `..` 保留，它表达的是「基准之外的引用」这一事实本身。
 */
function resolveSegments(segments: string[], hasRoot: boolean): string[] {
  const stack: string[] = [];
  for (const segment of segments) {
    if (segment === "..") {
      if (stack.length > 0 && stack[stack.length - 1] !== "..") stack.pop();
      else if (!hasRoot) stack.push("..");
    } else {
      stack.push(segment);
    }
  }
  return stack;
}

function joinWindowsPath(root: string, segments: string[]): string {
  // UNC 根不带尾分隔符（`\\server\share`），其余根形式固定以一个反斜杠结尾（`C:\`、`\`）。
  if (root.startsWith("\\\\")) {
    return segments.length > 0 ? `${root}\\${segments.join("\\")}` : root;
  }
  return root + segments.join("\\");
}

function joinPosixPath(root: string, segments: string[]): string {
  return root === "/" ? `/${segments.join("/")}` : segments.join("/");
}
