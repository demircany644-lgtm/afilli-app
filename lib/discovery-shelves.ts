import type { GetDiscoveryBooksSort } from '@workspace/api-client-react';

export type Sort = GetDiscoveryBooksSort;
export type DiscoveryShelf = { id: string; title: string; sort: Sort };
export type HomeRecommendationShelf = DiscoveryShelf & { routeSection: string; compact: boolean };

const newest: DiscoveryShelf = { id: 'yeni-yazilan', title: 'Yeni Yazılan Kitaplar', sort: 'new' };

export const RECOMMENDATION_CATEGORIES = [
  { id: 'romantik', title: 'Romantik' },
  { id: 'gerilim-polisiye-gizem', title: 'Gerilim – Polisiye – Gizem' },
  { id: 'fantastik', title: 'Fantastik' },
  { id: 'mafya-yeralti', title: 'Mafya – Yeraltı Dünyası' },
  { id: 'bilim-kurgu-distopya', title: 'Bilim Kurgu – Distopya' },
  { id: 'dram-hayat-hikayeleri', title: 'Dram – Hayat Hikâyeleri' },
] as const;

export const HOME_BOOK_CATEGORIES = [
  { id: 'ask-romani', title: 'Aşk Romanı', sort: 'new' },
  { id: 'fantastik-bilim-kurgu', title: 'En Çok Okunanlar – Fantastik / Bilim Kurgu', sort: 'read' },
  { id: 'polisiye-gerilim', title: 'Polisiye / Gerilim', sort: 'new' },
  { id: 'mafya', title: 'Mafya', sort: 'new' },
  { id: 'psikolojik-iliskiler', title: 'Psikolojik İlişkiler', sort: 'new' },
  { id: 'dram-hayat-hikayeleri', title: 'Dram / Hayat Hikâyeleri', sort: 'new' },
] as const satisfies readonly DiscoveryShelf[];

export type HomeBookCategory = (typeof HOME_BOOK_CATEGORIES)[number];
export type DiscoveryCategoryId = (typeof RECOMMENDATION_CATEGORIES)[number]['id'] | HomeBookCategory['id'];
export function discoveryCategoryTitle(id: DiscoveryCategoryId | null) {
  if (!id) return undefined;
  return [...HOME_BOOK_CATEGORIES, ...RECOMMENDATION_CATEGORIES].find((category) => category.id === id)?.title;
}

export const RECOMMENDATION_RANKS = [
  { id: 'oneriler-cok-okunan', title: 'En Çok Okunan Kitaplar', sort: 'read', routeSection: 'cok-okunan', compact: true },
  { id: 'oneriler-cok-begenilen', title: 'En Çok Beğenilen Kitaplar', sort: 'popular', routeSection: 'populer', compact: true },
] as const satisfies readonly HomeRecommendationShelf[];

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
