export const CHAPTER_PAGE_SIZE = 20;

/** Bounds the rendered rows, not the number of chapters in a manuscript. */
export function chapterWindow(total: number, requestedPage: number) {
  const pages = Math.max(1, Math.ceil(total / CHAPTER_PAGE_SIZE));
  const page = Math.max(0, Math.min(pages - 1, requestedPage));
  const start = page * CHAPTER_PAGE_SIZE;
  return { page, pages, start, end: Math.min(total, start + CHAPTER_PAGE_SIZE) };
}
