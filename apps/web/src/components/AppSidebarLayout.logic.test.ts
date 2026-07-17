import { describe, expect, it } from "vite-plus/test";
import { resolveThreadSidebarPresentation } from "./AppSidebarLayout.logic";

describe("resolveThreadSidebarPresentation", () => {
  it("uses the wider native presentation when the personal feature is enabled", () => {
    expect(resolveThreadSidebarPresentation(true)).toEqual({
      className: "native-macos-sidebar border-r border-sidebar-border text-sidebar-foreground",
      defaultWidth: "19rem",
      minWidth: 288,
      storageKey: "chat_thread_sidebar_width_native_v1",
    });
  });

  it("preserves the upstream presentation when the personal feature is disabled", () => {
    expect(resolveThreadSidebarPresentation(false)).toEqual({
      className: "border-r border-border bg-card text-foreground",
      defaultWidth: "16rem",
      minWidth: 208,
      storageKey: "chat_thread_sidebar_width",
    });
  });
});
