import type { WriterDocument } from '@workspace/api-client-react';

/** Manuscript-only copy: new chapter identities keep all reader discussions on the source book. */
export function copyWriterDocument(document: WriterDocument, createId: () => string): WriterDocument {
  return {
    ...document,
    chapters: document.chapters.map(chapter => ({
      ...chapter,
      id: createId(),
      status: 'draft',
    })),
  };
}
