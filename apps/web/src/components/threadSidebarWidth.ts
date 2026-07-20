export const THREAD_SIDEBAR_WIDTH_STORAGE_KEY = "chat_thread_sidebar_width";
export const THREAD_SIDEBAR_DEFAULT_WIDTH = 16 * 16;
export const THREAD_SIDEBAR_MIN_WIDTH = 13 * 16;
export const THREAD_MAIN_CONTENT_MIN_WIDTH = 40 * 16;

export function resolveThreadSidebarMaximumWidth(
  viewportWidth: number,
  minimumWidth = THREAD_SIDEBAR_MIN_WIDTH,
): number {
  return Math.max(minimumWidth, Math.floor(viewportWidth) - THREAD_MAIN_CONTENT_MIN_WIDTH);
}

export function resolveInitialThreadSidebarWidth(
  storedWidth: number | null,
  viewportWidth: number,
  options: {
    readonly defaultWidth?: number;
    readonly minimumWidth?: number;
  } = {},
): number {
  const defaultWidth = options.defaultWidth ?? THREAD_SIDEBAR_DEFAULT_WIDTH;
  const minimumWidth = options.minimumWidth ?? THREAD_SIDEBAR_MIN_WIDTH;
  const preferredWidth = storedWidth === null ? defaultWidth : Math.max(minimumWidth, storedWidth);
  return Math.min(preferredWidth, resolveThreadSidebarMaximumWidth(viewportWidth, minimumWidth));
}
