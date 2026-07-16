import { ProjectId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { getThreadProjectId, isStandaloneThread, resolveThreadContext } from "./threadContext.js";

describe("thread context", () => {
  it("upgrades legacy project threads", () => {
    const projectId = ProjectId.make("project-1");
    expect(resolveThreadContext({ projectId })).toEqual({ kind: "project", projectId });
    expect(getThreadProjectId({ projectId })).toBe(projectId);
  });

  it("resolves standalone threads without a project", () => {
    const thread = { projectId: null, context: { kind: "standalone" } as const };
    expect(isStandaloneThread(thread)).toBe(true);
    expect(getThreadProjectId(thread)).toBeNull();
  });

  it("uses the explicit context during the compatibility transition", () => {
    const projectId = ProjectId.make("legacy-project");
    expect(isStandaloneThread({ projectId, context: { kind: "standalone" } })).toBe(true);
  });
});
