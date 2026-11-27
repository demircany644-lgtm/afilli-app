/** Remove a reader's shelf entry only; authored books and drafts are untouched. */
export function removeLibraryEntry<T extends { saved: string[]; library: Record<string, number> }>(state: T, id: string): T {
  const library = { ...state.library };
  delete library[id];
  return { ...state, saved: state.saved.filter((key) => key !== id), library };
}

export const FEATURED_BOOK_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

/** Rotates through newest-first releases in seven-day windows; a new release starts at slot zero. */
export function featuredBookIndex(publishedAt: string | number, now = Date.now()): number {
  const start = typeof publishedAt === 'number' ? publishedAt : Date.parse(publishedAt);
  if (!Number.isFinite(start)) return 0;
  return Math.max(0, Math.floor((now - start) / FEATURED_BOOK_INTERVAL_MS));
}
