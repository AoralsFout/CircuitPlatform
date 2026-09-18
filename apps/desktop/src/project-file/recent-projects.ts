/**
 * 最近项目的本地持久化：localStorage 实现，与主题偏好同一机制、独立键。
 *
 * 规格 #34 的既定取舍：保留最多 10 条，每条记录规范化路径、显示名（文件名）与最近使用时间；
 * 按规范化身份去重、最近使用在前。规范化与去重身份复用 `paths.ts` 的纯实现——同一份文件
 * 的不同写法（大小写、分隔符、相对段）被识别为同一条。本模块不做 IO 之外的环境假设：
 * 存储不可用或数据损坏时安静降级，绝不让记录失败影响已经完成的保存。
 */

import { normalizeProjectPath, projectPathIdentity, type PathPlatform } from "./paths.ts";

/** localStorage 的最小形状；测试注入等价的内存实现。 */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** 最近项目存储使用的 localStorage 键；与主题偏好、最近元件类型互相独立。 */
export const RECENT_PROJECTS_STORAGE_KEY = "circuit-platform.recent-projects";

/** 列表保留的最大条数；超出时丢弃最旧的记录。第一版固定，不提供配置。 */
export const RECENT_PROJECTS_LIMIT = 10;

/** 最近项目的一条记录。 */
export interface RecentProject {
  /** 规范化后的项目文件路径；用于去重身份与后续打开。 */
  path: string;
  /** 展示名：文件名，保留用户保存时的原始写法。 */
  displayName: string;
  /** 最近一次使用的 epoch 毫秒时间戳。 */
  lastUsedAt: number;
}

/** `rememberRecentProject` 的可选参数。 */
export interface RememberRecentProjectOptions {
  /** 记录时间戳；省略时取 `Date.now()`。 */
  now?: number;
  /** 保留条数上限；省略时取 `RECENT_PROJECTS_LIMIT`。 */
  limit?: number;
  /** 路径规范化与比较的平台语义；省略时取 `currentPathPlatform()`。 */
  platform?: PathPlatform;
  /** 存储键；省略时取 `RECENT_PROJECTS_STORAGE_KEY`。 */
  key?: string;
}

/**
 * 从路径的原始写法取显示名：最后一个分隔符之后的部分。
 * @param path 路径的任意写法。
 * @returns 文件名；路径没有分隔符时原样返回。
 */
export function projectDisplayName(path: string): string {
  // 同时匹配两种分隔符而不是按平台拆分：POSIX 上反斜杠是合法的文件名字符，
  // 取「最后一个 `/` 或 `\` 之后的部分」在两种平台上都给出正确的最后一段。
  const lastSeparator = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return lastSeparator === -1 ? path : path.slice(lastSeparator + 1);
}

/**
 * 读取最近项目列表，最近使用在前。
 * @param storage 本地存储；不可用时返回空列表。
 * @param key 存储键；省略时取 `RECENT_PROJECTS_STORAGE_KEY`。
 * @returns 形状完整的记录，按 `lastUsedAt` 从新到旧排列，至多 `RECENT_PROJECTS_LIMIT` 条。
 */
export function readRecentProjects(
  storage: KeyValueStorage | null | undefined,
  key = RECENT_PROJECTS_STORAGE_KEY,
): RecentProject[] {
  if (!storage) return [];
  try {
    const value: unknown = JSON.parse(storage.getItem(key) ?? "[]");
    if (!Array.isArray(value)) return [];
    return value
      .map((entry): RecentProject | null => {
        if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return null;
        const candidate = entry as Partial<RecentProject>;
        if (typeof candidate.path !== "string" || candidate.path === "") return null;
        if (typeof candidate.displayName !== "string") return null;
        if (typeof candidate.lastUsedAt !== "number" || !Number.isFinite(candidate.lastUsedAt)) return null;
        return { path: candidate.path, displayName: candidate.displayName, lastUsedAt: candidate.lastUsedAt };
      })
      .filter((entry): entry is RecentProject => entry !== null)
      .sort((left, right) => right.lastUsedAt - left.lastUsedAt)
      .slice(0, RECENT_PROJECTS_LIMIT);
  } catch {
    return [];
  }
}

/**
 * 记录一次项目文件的成功使用：按规范化身份去重、置顶并刷新时间戳，然后持久化。
 * @param storage 本地存储；不可用时只返回内存中的新列表，不抛错。
 * @param recentProjects 当前列表；调用方通常传 `readRecentProjects(storage)` 的结果。
 * @param path 本次使用的项目文件路径，任意写法；记录按规范化路径保存。
 * @param options 时间戳、上限、平台语义与存储键；见 `RememberRecentProjectOptions`。
 * @returns 记录之后的新列表，最近使用在前；空路径原样返回现有列表。
 */
export function rememberRecentProject(
  storage: KeyValueStorage | null | undefined,
  recentProjects: readonly RecentProject[],
  path: string,
  options: RememberRecentProjectOptions = {},
): RecentProject[] {
  if (typeof path !== "string" || path === "") return [...recentProjects];
  const normalized = normalizeProjectPath(path, { platform: options.platform });
  const identity = projectPathIdentity(normalized, options.platform);
  const entry: RecentProject = {
    path: normalized,
    displayName: projectDisplayName(path),
    lastUsedAt: options.now ?? Date.now(),
  };
  const next = [
    entry,
    ...recentProjects.filter((existing) => projectPathIdentity(existing.path, options.platform) !== identity),
  ].slice(0, Math.max(0, options.limit ?? RECENT_PROJECTS_LIMIT));
  try {
    storage?.setItem(options.key ?? RECENT_PROJECTS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // 存储不可写时仍返回内存状态：记录最近项目不能让已经成功的保存回退成失败。
  }
  return next;
}
