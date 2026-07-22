export interface ThreadSidebarPresentation {
  readonly className: string;
  readonly defaultWidth: string;
  readonly minWidth: number;
  readonly storageKey: string;
}

export type ThreadSidebarVariant = "native" | "upstream-legacy" | "upstream-v2";

export function resolveThreadSidebarVariant(input: {
  readonly enableNativeMacSidebar: boolean;
  readonly sidebarV2Enabled: boolean;
  readonly isOnSettings: boolean;
}): ThreadSidebarVariant {
  if (input.isOnSettings) {
    return input.enableNativeMacSidebar ? "native" : "upstream-legacy";
  }
  if (input.sidebarV2Enabled || !input.enableNativeMacSidebar) {
    return "upstream-v2";
  }
  return "native";
}

const UPSTREAM_SIDEBAR_PRESENTATION: ThreadSidebarPresentation = {
  className: "border-r border-border bg-card text-foreground",
  defaultWidth: "16rem",
  minWidth: 13 * 16,
  storageKey: "chat_thread_sidebar_width",
};

const NATIVE_MAC_SIDEBAR_PRESENTATION: ThreadSidebarPresentation = {
  className: "native-macos-sidebar border-r border-sidebar-border text-sidebar-foreground",
  defaultWidth: "19rem",
  minWidth: 18 * 16,
  storageKey: "chat_thread_sidebar_width_native_v1",
};

export function resolveThreadSidebarPresentation(
  enableNativeMacSidebar: boolean,
): ThreadSidebarPresentation {
  return enableNativeMacSidebar ? NATIVE_MAC_SIDEBAR_PRESENTATION : UPSTREAM_SIDEBAR_PRESENTATION;
}
