import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error(`无效的发布版本：${version}`);
const name = `CircuitPlatform-${version}-windows-x64-setup.exe`;
const content = await readFile(join(root, "release", name));
const digest = createHash("sha256").update(content).digest("hex");
await writeFile(join(root, "release/SHA256SUMS.txt"), `${digest}  ${name}\n`, "utf8");
console.log(`已生成安装器校验值：${name} (${content.length} bytes)`);
