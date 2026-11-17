/** Remove a reader's shelf entry only; authored books and drafts are untouched. */
export function removeLibraryEntry<T extends { saved: string[]; library: Record<string, number> }>(state: T, id: string): T {
  const library = { ...state.library };
  delete library[id];
  return { ...state, saved: state.saved.filter((key) => key !== id), library };
}
