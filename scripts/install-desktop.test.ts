// @effect-diagnostics nodeBuiltinImport:off

import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { assert, it } from "@effect/vitest";

import {
  DesktopInstallTransactionError,
  extractSigningCertificate,
  replaceInstalledDesktopApp,
} from "./install-desktop.ts";

it("passes the certificate prefix as an attached codesign option value", async () => {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "desktop-signature-test-"));
  const certificatePrefix = NodePath.join(root, "app-");
  const certificate = Buffer.from("leaf certificate fixture");
  const calls: Array<{ executable: string; args: ReadonlyArray<string> }> = [];

  try {
    const fingerprints = await extractSigningCertificate(
      "/tmp/T3 Code (Fork).app",
      certificatePrefix,
      async (executable, args) => {
        calls.push({ executable, args });
        await NodeFSP.writeFile(`${certificatePrefix}0`, certificate);
        return { stdout: "", stderr: "" };
      },
    );

    assert.deepStrictEqual(calls, [
      {
        executable: "/usr/bin/codesign",
        args: [
          "--display",
          `--extract-certificates=${certificatePrefix}`,
          "/tmp/T3 Code (Fork).app",
        ],
      },
    ]);
    assert.equal(fingerprints.certificateSha1, "94AB4C24F08601CD8CD88EE0FF44773748DAE456");
    assert.equal(
      fingerprints.certificateSha256,
      "A7CEF11E6422CED475C9D93DC483A0AE61527A6FE8B79B8CDE36C67C13283311",
    );
  } finally {
    await NodeFSP.rm(root, { recursive: true, force: true });
  }
});

async function writeAppFixture(appPath: string, version: string): Promise<void> {
  await NodeFSP.mkdir(appPath, { recursive: true });
  await NodeFSP.writeFile(NodePath.join(appPath, "version.txt"), version);
}

it("restores and relaunches the previous app when post-replacement validation fails", async () => {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "desktop-install-test-"));
  const sourceAppPath = NodePath.join(root, "source.app");
  const targetAppPath = NodePath.join(root, "installed.app");
  await writeAppFixture(sourceAppPath, "new");
  await writeAppFixture(targetAppPath, "old");

  let validationCount = 0;
  let quitCount = 0;
  const launchedVersions: string[] = [];
  try {
    let installError: unknown;
    try {
      await replaceInstalledDesktopApp({
        sourceAppPath,
        targetAppPath,
        hooks: {
          copyApp: async (source, destination) => {
            await NodeFSP.cp(source, destination, { recursive: true });
          },
          validateApp: async () => {
            validationCount += 1;
            if (validationCount === 2) throw new Error("installed validation failed");
          },
          quitInstalledApp: async () => {
            quitCount += 1;
          },
          launchApp: async (appPath) => {
            launchedVersions.push(
              (await NodeFSP.readFile(NodePath.join(appPath, "version.txt"), "utf8")).trim(),
            );
          },
        },
      });
    } catch (error) {
      installError = error;
    }

    assert.instanceOf(installError, DesktopInstallTransactionError);
    assert.equal(validationCount, 2);
    assert.equal(quitCount, 1);
    assert.deepStrictEqual(launchedVersions, ["old"]);
    assert.equal(
      (await NodeFSP.readFile(NodePath.join(targetAppPath, "version.txt"), "utf8")).trim(),
      "old",
    );
    assert.deepStrictEqual((await NodeFSP.readdir(root)).sort(), ["installed.app", "source.app"]);
  } finally {
    await NodeFSP.rm(root, { recursive: true, force: true });
  }
});

it("does not quit or touch the installed app when incoming validation fails", async () => {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "desktop-install-test-"));
  const sourceAppPath = NodePath.join(root, "source.app");
  const targetAppPath = NodePath.join(root, "installed.app");
  await writeAppFixture(sourceAppPath, "new");
  await writeAppFixture(targetAppPath, "old");

  let quitCount = 0;
  try {
    let installError: unknown;
    try {
      await replaceInstalledDesktopApp({
        sourceAppPath,
        targetAppPath,
        hooks: {
          copyApp: async (source, destination) => {
            await NodeFSP.cp(source, destination, { recursive: true });
          },
          validateApp: async () => {
            throw new Error("incoming validation failed");
          },
          quitInstalledApp: async () => {
            quitCount += 1;
          },
          launchApp: async () => undefined,
        },
      });
    } catch (error) {
      installError = error;
    }

    assert.instanceOf(installError, DesktopInstallTransactionError);
    assert.equal(quitCount, 0);
    assert.equal(
      (await NodeFSP.readFile(NodePath.join(targetAppPath, "version.txt"), "utf8")).trim(),
      "old",
    );
  } finally {
    await NodeFSP.rm(root, { recursive: true, force: true });
  }
});

it("relaunches the untouched previous app when its move fails after quit", async () => {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "desktop-install-test-"));
  const sourceAppPath = NodePath.join(root, "source.app");
  const targetAppPath = NodePath.join(root, "installed.app");
  await writeAppFixture(sourceAppPath, "new");
  await writeAppFixture(targetAppPath, "old");

  const launchedVersions: string[] = [];
  try {
    let installError: unknown;
    try {
      await replaceInstalledDesktopApp({
        sourceAppPath,
        targetAppPath,
        hooks: {
          copyApp: async (source, destination) => {
            await NodeFSP.cp(source, destination, { recursive: true });
          },
          movePath: async () => {
            throw new Error("move failed");
          },
          validateApp: async () => undefined,
          quitInstalledApp: async () => undefined,
          launchApp: async (appPath) => {
            launchedVersions.push(
              (await NodeFSP.readFile(NodePath.join(appPath, "version.txt"), "utf8")).trim(),
            );
          },
        },
      });
    } catch (error) {
      installError = error;
    }

    assert.instanceOf(installError, DesktopInstallTransactionError);
    assert.deepStrictEqual(launchedVersions, ["old"]);
    assert.equal(
      (await NodeFSP.readFile(NodePath.join(targetAppPath, "version.txt"), "utf8")).trim(),
      "old",
    );
    assert.deepStrictEqual((await NodeFSP.readdir(root)).sort(), ["installed.app", "source.app"]);
  } finally {
    await NodeFSP.rm(root, { recursive: true, force: true });
  }
});
