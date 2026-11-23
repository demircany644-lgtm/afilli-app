/** Route-only exceptions; ordinary screens must retain the five-button menu. */
export function isFullscreenChatPath(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, '');
  return path === '/writer-chat' || /^\/chat\/[^/?#]+$/.test(path);
}
