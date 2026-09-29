import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tag = process.argv[2] ?? process.env.GITHUB_REF_NAME;
const { version } = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
if (tag !== `v${version}`) {
  console.error(`发布标签 ${tag ?? "(缺失)"} 必须等于 package.json 版本 v${version}。`);
  process.exitCode = 1;
} else {
  console.log(`发布标签与版本一致：${tag}`);
}
