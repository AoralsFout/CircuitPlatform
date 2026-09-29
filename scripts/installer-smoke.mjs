import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import config from "../electron-builder.cjs";
import { checkPackageContents, checkPackagedEngine } from "./check-package.mjs";
import { readReleaseVersion } from "./release-version.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const delay = (ms) => new Promise((done) => setTimeout(done, ms));

function installationRecords() {
  // 同时检查 HKCU/HKLM 和两个注册表视图；任何读失败均阻止测试，避免把未知状态当未安装。
  const script = `
    $ErrorActionPreference = 'Stop'
    [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
    $records = @()
    foreach ($hive in @('CurrentUser', 'LocalMachine')) {
      foreach ($view in @('Registry64', 'Registry32')) {
        $baseKey = [Microsoft.Win32.RegistryKey]::OpenBaseKey($hive, $view)
        try {
          $uninstall = $baseKey.OpenSubKey('Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall')
          if ($null -ne $uninstall) {
            try {
              foreach ($name in $uninstall.GetSubKeyNames()) {
                $entry = $uninstall.OpenSubKey($name)
                if ($null -eq $entry) { throw "Cannot inspect uninstall entry $name" }
                try {
                  $display = [string]$entry.GetValue('DisplayName')
                  if ($name -eq $env:CIRCUIT_INSTALLER_GUID -or $display -match '^CircuitPlatform(?:$|\\s)') {
                    $location = [string]$entry.GetValue('InstallLocation')
                    $uninstallCommand = [string]$entry.GetValue('UninstallString')
                    if (-not $location -and $uninstallCommand -match '^"([^"]+)"') {
                      $location = [System.IO.Path]::GetDirectoryName($Matches[1])
                    }
                    $records += @{ hive=$hive; view=$view; name=$name; kind='uninstall'; location=$location }
                  }
                } finally { $entry.Dispose() }
              }
            } finally { $uninstall.Dispose() }
          }
          $identity = $baseKey.OpenSubKey('Software\\' + $env:CIRCUIT_INSTALLER_GUID)
          if ($null -ne $identity) {
            try { $records += @{ hive=$hive; view=$view; name=$env:CIRCUIT_INSTALLER_GUID; kind='identity'; location=[string]$identity.GetValue('InstallLocation') } }
            finally { $identity.Dispose() }
          }
        } finally { $baseKey.Dispose() }
      }
    }
    ConvertTo-Json -InputObject @($records) -Compress
  `;
  const result = spawnSync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 30_000,
    env: { ...process.env, CIRCUIT_INSTALLER_GUID: config.nsis.guid },
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `无法确认已有安装状态：${result.stderr}`);
  return JSON.parse(result.stdout.trim());
}

function run(command, args, options = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd: root, windowsHide: true, stdio: "inherit", ...options });
    const timer = setTimeout(() => { child.kill(); reject(new Error(`安装验收进程超时：${command}`)); }, 180_000);
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) resolveRun();
      else reject(new Error(`安装验收进程失败 (${code})：${command}`));
    });
  });
}

async function main() {
  assert.equal(process.platform, "win32", "NSIS 安装验收仅支持 Windows");
  const version = readReleaseVersion();
  const installer = resolve(process.argv[2] ?? join(root, `release/CircuitPlatform-${version}-windows-x64-setup.exe`));
  const reportDirectory = join(root, "release/smoke");
  await mkdir(reportDirectory, { recursive: true });
  // 前置检查或卸载保护失败时也不能留下上一轮成功报告。
  await writeFile(join(reportDirectory, "installer-smoke.json"), `${JSON.stringify({ passed: false, installer, version, startedAt: new Date().toISOString() }, null, 2)}\n`);
  assert.ok(existsSync(installer), `未找到安装器：${installer}`);
  assert.deepEqual(installationRecords(), [], "已有 CircuitPlatform 安装；为避免覆盖，请在干净的 Windows 运行器执行安装验收。");

  const temporaryDirectory = await mkdtemp(join(tmpdir(), "circuitplatform-installer-"));
  const installationDirectory = join(temporaryDirectory, "安装位置 with spaces");
  const uninstaller = join(installationDirectory, "Uninstall CircuitPlatform.exe");
  let installed = false;
  let removed = false;
  let failure;
  try {
    // NSIS 要求 /D 为最后一项且值不加引号，因此使用原始 Windows 参数而非 shell 拼接。
    await run(installer, ["/S", "/currentuser", `/D=${installationDirectory}`], { windowsVerbatimArguments: true });
    installed = true;
    const records = installationRecords();
    assert.ok(records.some((record) => record.kind === "uninstall"), "安装后缺少系统卸载条目");
    assert.ok(records.every((record) => record.hive === "CurrentUser" && resolve(record.location).toLowerCase() === installationDirectory.toLowerCase()), "安装器未使用指定的当前用户目录");
    const contents = checkPackageContents(installationDirectory, version);
    checkPackagedEngine(contents.enginePath);
    await run(process.execPath, [join(root, "scripts/packaged-smoke.mjs"), installationDirectory]);
  } catch (error) {
    failure = error;
  } finally {
    if (existsSync(uninstaller)) {
      const records = installationRecords();
      assert.ok(records.every((record) => record.location && resolve(record.location).toLowerCase() === installationDirectory.toLowerCase()), "发现非本次临时安装，拒绝卸载");
      await run(uninstaller, ["/S", "/currentuser"]);
      const deadline = Date.now() + 30_000;
      let remainingRecords = installationRecords();
      while ((existsSync(installationDirectory) || remainingRecords.length > 0) && Date.now() < deadline) {
        await delay(500);
        remainingRecords = installationRecords();
      }
      assert.ok(!existsSync(installationDirectory), `卸载后安装目录仍存在：${installationDirectory}`);
      assert.deepEqual(remainingRecords, [], "卸载后应用注册表条目仍存在");
      removed = true;
    }
    // 仅在未安装或卸载成功后删除本次唯一临时根目录，失败安装保留现场供诊断。
    if (removed || (!existsSync(installationDirectory) && installationRecords().length === 0)) {
      const temporaryRelative = relative(resolve(tmpdir()), temporaryDirectory);
      assert.ok(!isAbsolute(temporaryRelative) && !temporaryRelative.startsWith("..") && dirname(temporaryRelative) === "." && temporaryRelative.startsWith("circuitplatform-installer-"));
      await rm(temporaryDirectory, { recursive: true, force: true, maxRetries: 3 });
    }
    await writeFile(join(reportDirectory, "installer-smoke.json"), `${JSON.stringify({ passed: !failure && installed && removed, installer, version, installed, removed, timestamp: new Date().toISOString(), error: failure?.message }, null, 2)}\n`);
  }
  if (failure) throw failure;
  console.log(`Installer install, application smoke and uninstall passed: ${installer}`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
