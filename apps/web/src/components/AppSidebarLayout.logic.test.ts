import { describe, expect, it } from "vite-plus/test";
import {
  resolveThreadSidebarPresentation,
  resolveThreadSidebarVariant,
} from "./AppSidebarLayout.logic";

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

describe("resolveThreadSidebarVariant", () => {
  it("uses the personal sidebar by default", () => {
    expect(
      resolveThreadSidebarVariant({
        enableNativeMacSidebar: true,
        sidebarV2Enabled: false,
        isOnSettings: false,
      }),
    ).toBe("native");
  });

  it("makes upstream sidebar v2 the personal-flag-off behavior", () => {
    expect(
      resolveThreadSidebarVariant({
        enableNativeMacSidebar: false,
        sidebarV2Enabled: false,
        isOnSettings: false,
      }),
    ).toBe("upstream-v2");
  });

  it("allows the upstream beta preference to opt into v2 while the personal flag is on", () => {
    expect(
      resolveThreadSidebarVariant({
        enableNativeMacSidebar: true,
        sidebarV2Enabled: true,
        isOnSettings: false,
      }),
    ).toBe("upstream-v2");
  });

  it("keeps settings on the v1 implementation", () => {
    expect(
      resolveThreadSidebarVariant({
        enableNativeMacSidebar: false,
        sidebarV2Enabled: true,
        isOnSettings: true,
      }),
    ).toBe("upstream-legacy");
  });
});
