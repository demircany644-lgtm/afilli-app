import type { GetDiscoveryBooksSort } from '@workspace/api-client-react';

export type Sort = GetDiscoveryBooksSort;
export type DiscoveryShelf = { id: string; title: string; sort: Sort };

const newest: DiscoveryShelf = { id: 'yeni-yazilan', title: 'Yeni Yazılan Kitaplar', sort: 'new' };

// Keep legacy section IDs and ranking rules. Recommendations currently use
// the same released-book feed as newest; this does not add a curated selection.
export const SHELVES: readonly DiscoveryShelf[] = [
  { id: 'oneriler', title: 'Afilli Önerileri', sort: 'new' },
  { id: 'cok-okunan', title: 'Çok Okunanlar', sort: 'read' },
  { id: 'populer', title: 'Popüler Kitaplar', sort: 'popular' },
  newest,
];
export const SORTS: readonly Sort[] = ['new', 'read', 'popular'];
export const SORT_LABEL: Record<Sort, string> = { new: 'Yeni', read: 'Çok okunan', popular: 'Popüler' };

/** Preserve section identity even when two sections share a server sort. */
export function resolveDiscoveryShelf(section: unknown, sort?: unknown): DiscoveryShelf {
  const exact = typeof section === 'string' ? SHELVES.find(s => s.id === section) : undefined;
  if (exact) return exact;
  return SHELVES.find(s => s.sort === sort && s.id !== 'oneriler') ?? newest;
}
