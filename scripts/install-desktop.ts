#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off globalDate:off globalTimers:off

import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import {
  assertPinnedLocalDesktopSigningIdentity,
  certificateFingerprints,
  DESKTOP_FORK_BUNDLE_ID,
  type LocalDesktopSigningState,
  LocalSignedAppValidationError,
  parseDesignatedRequirement,
  pinLocalDesktopDesignatedRequirement,
  resolveLocalDesktopSigningStatePath,
  runLocalDesktopCommand,
  validateLocalSignedAppMetadata,
} from "./lib/local-desktop-signing.ts";

export const DESKTOP_FORK_APPLICATION_NAME = "T3 Code (Fork).app";
export const DESKTOP_FORK_INSTALL_PATH = NodePath.join(
  "/Applications",
  DESKTOP_FORK_APPLICATION_NAME,
);

export interface ValidatedLocalDesktopApp {
  readonly designatedRequirement: string;
  readonly codeObjectCount: number;
}

export interface DesktopInstallTransactionHooks {
  readonly copyApp: (sourceAppPath: string, destinationAppPath: string) => Promise<void>;
  readonly movePath?: ((sourcePath: string, destinationPath: string) => Promise<void>) | undefined;
  readonly validateApp: (appPath: string) => Promise<void>;
  readonly quitInstalledApp: () => Promise<void>;
  readonly launchApp: (appPath: string) => Promise<void>;
}

export class DesktopInstallTransactionError extends Error {
  override readonly name = "DesktopInstallTransactionError";

  constructor(options: {
    readonly cause: unknown;
    readonly rollbackCause?: unknown;
    readonly recoveryDirectory?: string;
  }) {
    const recovery = options.recoveryDirectory
      ? ` Recovery contents are preserved in ${options.recoveryDirectory}.`
      : " The original installation state was restored.";
    super(`Desktop installation failed.${recovery}`, { cause: options.cause });
    this.rollbackCause = options.rollbackCause;
    this.recoveryDirectory = options.recoveryDirectory;
  }

  readonly rollbackCause: unknown;
  readonly recoveryDirectory: string | undefined;
}

export class DesktopAppSignatureInspectionError extends Error {
  override readonly name = "DesktopAppSignatureInspectionError";
  readonly appPath: string;
  readonly operation: string;

  constructor(appPath: string, operation: string, options?: ErrorOptions) {
    super(`Could not ${operation} for ${appPath}.`, options);
    this.appPath = appPath;
    this.operation = operation;
  }
}

const MACH_O_MAGICS = new Set([
  0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe, 0xcafebabf, 0xbebafeca, 0xbfbafeca,
]);

function isMachOMagic(header: Uint8Array): boolean {
  if (header.length < 4) return false;
  const magic = Buffer.from(header).readUInt32BE(0);
  return MACH_O_MAGICS.has(magic);
}

async function isMachOFile(filePath: string): Promise<boolean> {
  const handle = await NodeFSP.open(filePath, "r");
  try {
    const header = Buffer.alloc(4);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    return isMachOMagic(header.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
}

async function collectMachOCodePaths(rootPath: string): Promise<ReadonlyArray<string>> {
  const codePaths: string[] = [];
  const pending = [rootPath];
  while (pending.length > 0) {
    const directory = pending.pop()!;
    for (const entry of await NodeFSP.readdir(directory, { withFileTypes: true })) {
      const entryPath = NodePath.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        pending.push(entryPath);
        continue;
      }
      if (!entry.isFile()) continue;
      const stat = await NodeFSP.stat(entryPath);
      const nativeExtension = /\.(?:dylib|node|so)$/u.test(entry.name);
      if (!nativeExtension && (stat.mode & 0o111) === 0) continue;
      if (await isMachOFile(entryPath)) codePaths.push(entryPath);
    }
  }
  return codePaths.sort();
}

async function assertAppDirectory(appPath: string): Promise<void> {
  const stat = await NodeFSP.lstat(appPath);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`Expected a non-symlink application bundle at ${appPath}.`);
  }
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await NodeFSP.lstat(targetPath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export async function extractSigningCertificate(
  codePath: string,
  certificatePrefix: string,
  runCommand = runLocalDesktopCommand,
): Promise<{ readonly certificateSha1: string; readonly certificateSha256: string }> {
  try {
    await runCommand("/usr/bin/codesign", [
      "--display",
      `--extract-certificates=${certificatePrefix}`,
      codePath,
    ]);
    return certificateFingerprints(await NodeFSP.readFile(`${certificatePrefix}0`));
  } catch (cause) {
    throw new DesktopAppSignatureInspectionError(codePath, "extract its signing certificate", {
      cause,
    });
  }
}

export async function validateLocalDesktopApp(
  appPath: string,
  state: LocalDesktopSigningState,
): Promise<ValidatedLocalDesktopApp> {
  await assertAppDirectory(appPath);
  const infoPlistPath = NodePath.join(appPath, "Contents", "Info.plist");
  const certificateDirectory = await NodeFSP.mkdtemp(
    NodePath.join(NodeOS.tmpdir(), "t3code-signature-certificates-"),
  );

  try {
    let bundleId: string;
    try {
      const output = await runLocalDesktopCommand("/usr/bin/plutil", [
        "-extract",
        "CFBundleIdentifier",
        "raw",
        "-o",
        "-",
        infoPlistPath,
      ]);
      bundleId = output.stdout.trim();
    } catch (cause) {
      throw new DesktopAppSignatureInspectionError(appPath, "read its bundle identifier", {
        cause,
      });
    }

    try {
      await runLocalDesktopCommand("/usr/bin/codesign", [
        "--verify",
        "--deep",
        "--strict",
        "--verbose=2",
        appPath,
      ]);
    } catch (cause) {
      throw new DesktopAppSignatureInspectionError(appPath, "verify its complete code signature", {
        cause,
      });
    }

    const requirementOutput = await runLocalDesktopCommand("/usr/bin/codesign", [
      "--display",
      "--requirements",
      "-",
      appPath,
    ]);
    const designatedRequirement = parseDesignatedRequirement(
      `${requirementOutput.stdout}\n${requirementOutput.stderr}`,
    );
    if (!designatedRequirement) {
      throw new LocalSignedAppValidationError("designated-requirement-identifier");
    }

    const appCertificate = await extractSigningCertificate(
      appPath,
      NodePath.join(certificateDirectory, "app-"),
    );
    const machOPaths = await collectMachOCodePaths(NodePath.join(appPath, "Contents"));
    const nestedCode: Array<{
      path: string;
      certificateSha1: string;
      certificateSha256: string;
    }> = [];
    for (const [index, codePath] of machOPaths.entries()) {
      try {
        await runLocalDesktopCommand("/usr/bin/codesign", [
          "--verify",
          "--strict",
          "--verbose=2",
          codePath,
        ]);
      } catch (cause) {
        throw new DesktopAppSignatureInspectionError(codePath, "verify its code signature", {
          cause,
        });
      }
      nestedCode.push({
        path: NodePath.relative(appPath, codePath),
        ...(await extractSigningCertificate(
          codePath,
          NodePath.join(certificateDirectory, `code-${String(index)}-`),
        )),
      });
    }

    return {
      designatedRequirement: validateLocalSignedAppMetadata({
        state,
        bundleId,
        ...appCertificate,
        designatedRequirement,
        nestedCode,
      }),
      codeObjectCount: nestedCode.length + 1,
    };
  } finally {
    await NodeFSP.rm(certificateDirectory, { recursive: true, force: true });
  }
}

export async function replaceInstalledDesktopApp(input: {
  readonly sourceAppPath: string;
  readonly targetAppPath: string;
  readonly hooks: DesktopInstallTransactionHooks;
}): Promise<{ readonly replacedExistingApp: boolean; readonly cleanupWarning?: unknown }> {
  const targetParent = NodePath.dirname(input.targetAppPath);
  const targetName = NodePath.basename(input.targetAppPath);
  const hadInstalledApp = await pathExists(input.targetAppPath);
  if (hadInstalledApp) await assertAppDirectory(input.targetAppPath);

  const transactionDirectory = await NodeFSP.mkdtemp(
    NodePath.join(targetParent, ".t3code-fork-install-"),
  );
  const incomingAppPath = NodePath.join(transactionDirectory, `incoming-${targetName}`);
  const previousAppPath = NodePath.join(transactionDirectory, `previous-${targetName}`);
  const failedAppPath = NodePath.join(transactionDirectory, `failed-${targetName}`);
  let previousAppMoved = false;
  let incomingAppInstalled = false;
  let installationCommitted = false;
  let quitCompleted = false;
  let keepRecoveryDirectory = false;
  let cleanupWarning: unknown;
  const movePath = input.hooks.movePath ?? NodeFSP.rename;

  try {
    await input.hooks.copyApp(input.sourceAppPath, incomingAppPath);
    await input.hooks.validateApp(incomingAppPath);
    await input.hooks.quitInstalledApp();
    quitCompleted = true;

    if (hadInstalledApp) {
      await assertAppDirectory(input.targetAppPath);
      await movePath(input.targetAppPath, previousAppPath);
      previousAppMoved = true;
    }
    await movePath(incomingAppPath, input.targetAppPath);
    incomingAppInstalled = true;
    await input.hooks.validateApp(input.targetAppPath);
    await input.hooks.launchApp(input.targetAppPath);
    installationCommitted = true;
  } catch (cause) {
    let rollbackCause: unknown;
    try {
      if (incomingAppInstalled && (await pathExists(input.targetAppPath))) {
        await movePath(input.targetAppPath, failedAppPath);
        incomingAppInstalled = false;
      }
      if (previousAppMoved) {
        await movePath(previousAppPath, input.targetAppPath);
        previousAppMoved = false;
      }
    } catch (error) {
      rollbackCause = error;
      keepRecoveryDirectory = true;
    }
    const previousAppAvailable =
      hadInstalledApp &&
      quitCompleted &&
      !keepRecoveryDirectory &&
      (await pathExists(input.targetAppPath));
    if (previousAppAvailable) {
      try {
        await assertAppDirectory(input.targetAppPath);
        await input.hooks.launchApp(input.targetAppPath);
      } catch (error) {
        rollbackCause ??= error;
      }
    }
    throw new DesktopInstallTransactionError({
      cause,
      ...(rollbackCause ? { rollbackCause } : {}),
      ...(keepRecoveryDirectory ? { recoveryDirectory: transactionDirectory } : {}),
    });
  } finally {
    if (!keepRecoveryDirectory) {
      try {
        await NodeFSP.rm(transactionDirectory, { recursive: true, force: true });
      } catch (error) {
        cleanupWarning = error;
      }
    }
  }

  return {
    replacedExistingApp: hadInstalledApp,
    ...(installationCommitted && cleanupWarning ? { cleanupWarning } : {}),
  };
}

async function runStreamingCommand(
  executable: string,
  args: ReadonlyArray<string>,
  cwd: string,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = NodeChildProcess.spawn(executable, [...args], { cwd, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (exitCode, signal) => {
      if (exitCode === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `${NodePath.basename(executable)} exited with ${exitCode === null ? `signal ${signal ?? "unknown"}` : `code ${String(exitCode)}`}.`,
        ),
      );
    });
  });
}

async function copyApplication(sourceAppPath: string, destinationAppPath: string): Promise<void> {
  await runLocalDesktopCommand("/usr/bin/ditto", [sourceAppPath, destinationAppPath]);
}

async function isInstalledForkRunning(): Promise<boolean> {
  const output = await runLocalDesktopCommand("/usr/bin/osascript", [
    "-e",
    `return application id "${DESKTOP_FORK_BUNDLE_ID}" is running`,
  ]);
  return output.stdout.trim().toLowerCase() === "true";
}

async function quitInstalledFork(): Promise<void> {
  if (!(await isInstalledForkRunning())) return;
  await runLocalDesktopCommand("/usr/bin/osascript", [
    "-e",
    `if application id "${DESKTOP_FORK_BUNDLE_ID}" is running then tell application id "${DESKTOP_FORK_BUNDLE_ID}" to quit`,
  ]);
  const deadline = Date.now() + 20_000;
  while (await isInstalledForkRunning()) {
    if (Date.now() >= deadline) {
      throw new Error(
        "T3 Code (Fork) did not quit within 20 seconds; the installed app was not changed.",
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

async function launchApplication(appPath: string): Promise<void> {
  await runLocalDesktopCommand("/usr/bin/open", [appPath]);
}

function parseInstallArchitecture(args: ReadonlyArray<string>): "arm64" {
  if (args.length === 2 && args[0] === "--arch" && args[1] === "arm64") return "arm64";
  throw new Error("Usage: node scripts/install-desktop.ts --arch arm64");
}

async function findZipArtifact(artifactDirectory: string, arch: "arm64"): Promise<string> {
  const candidates = (await NodeFSP.readdir(artifactDirectory))
    .filter((entry) => entry.endsWith(`-${arch}.zip`))
    .map((entry) => NodePath.join(artifactDirectory, entry));
  if (candidates.length !== 1) {
    throw new Error(
      `Expected exactly one ${arch} desktop ZIP artifact, found ${String(candidates.length)}.`,
    );
  }
  return candidates[0]!;
}

export async function installDesktop(args = process.argv.slice(2)): Promise<void> {
  // oxlint-disable-next-line t3code/no-global-process-runtime -- Standalone maintainer entry point has no Effect runtime.
  if (process.platform !== "darwin") {
    throw new Error("install:desktop:arm64 must run on macOS.");
  }
  const arch = parseInstallArchitecture(args);
  // oxlint-disable-next-line t3code/no-global-process-runtime -- Standalone maintainer entry point has no Effect runtime.
  if (process.arch !== arch) {
    throw new Error(`install:desktop:${arch} must run on an ${arch} macOS host.`);
  }

  const repoRoot = NodePath.resolve(NodeURL.fileURLToPath(new URL("..", import.meta.url)));
  const statePath = resolveLocalDesktopSigningStatePath();
  await assertPinnedLocalDesktopSigningIdentity({ statePath });
  const workingDirectory = await NodeFSP.mkdtemp(
    NodePath.join(NodeOS.tmpdir(), "t3code-desktop-install-"),
  );
  const artifactDirectory = NodePath.join(workingDirectory, "artifacts");
  const extractedDirectory = NodePath.join(workingDirectory, "extracted");

  try {
    await NodeFSP.mkdir(artifactDirectory, { recursive: true });
    await NodeFSP.mkdir(extractedDirectory, { recursive: true });
    console.log("Building the production arm64 desktop ZIP with the pinned local identity...");
    await runStreamingCommand(
      process.execPath,
      [
        "scripts/build-desktop-artifact.ts",
        "--platform",
        "mac",
        "--target",
        "zip",
        "--arch",
        arch,
        "--local-signed",
        "--output-dir",
        artifactDirectory,
      ],
      repoRoot,
    );

    const zipPath = await findZipArtifact(artifactDirectory, arch);
    await runLocalDesktopCommand("/usr/bin/ditto", ["-x", "-k", zipPath, extractedDirectory]);
    const sourceAppPath = NodePath.join(extractedDirectory, DESKTOP_FORK_APPLICATION_NAME);
    const pinned = await assertPinnedLocalDesktopSigningIdentity({ statePath });
    const validation = await validateLocalDesktopApp(sourceAppPath, pinned.state);
    const state = await pinLocalDesktopDesignatedRequirement(
      pinned.state,
      validation.designatedRequirement,
      statePath,
    );
    console.log(
      `Validated ${String(validation.codeObjectCount)} signed code objects and designated requirement: ${validation.designatedRequirement}`,
    );

    const installResult = await replaceInstalledDesktopApp({
      sourceAppPath,
      targetAppPath: DESKTOP_FORK_INSTALL_PATH,
      hooks: {
        copyApp: copyApplication,
        validateApp: async (appPath) => {
          await validateLocalDesktopApp(appPath, state);
        },
        quitInstalledApp: quitInstalledFork,
        launchApp: launchApplication,
      },
    });
    if (installResult.cleanupWarning) {
      console.warn(
        "The app was installed, but its temporary transaction directory could not be removed.",
      );
    }
    console.log(
      `${installResult.replacedExistingApp ? "Replaced" : "Installed"} ${DESKTOP_FORK_INSTALL_PATH} and launched it.`,
    );
  } finally {
    await NodeFSP.rm(workingDirectory, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  installDesktop().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
