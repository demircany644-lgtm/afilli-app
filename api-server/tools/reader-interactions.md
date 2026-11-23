# Chapter and paragraph discussions

## Safe migration

`reader-interactions.sql` is an additive transaction. It creates only the paragraph
registry, comment-to-paragraph associations, chapter/paragraph likes, short
anti-spam counters and reader reports. It does not change or copy existing users,
books, chapter manuscripts, comments or sessions.

The existing `book-community.sql` discussion schema and moderation trigger are
prerequisites. New paragraph associations reference the anonymous thread nodes,
not removable comment bodies: deleting a parent cannot delete another reader's
replies or lose their paragraph.

Development reconciliation:

```sh
pnpm --filter @workspace/api-server exec tsx tools/apply-reader-interactions.ts
```

The runner refuses production. The existing development community reconciliation
also applies this additive migration before checking release readiness.

For the Replit-managed production database, use the **Publish** flow: it compares
the development and production schemas and applies the approved schema-only diff.
Keep **overwrite production data** disabled. Do not run this development SQL runner
against production, add startup/build-time DDL, copy development rows, or use a
force schema push. Review that the diff only adds the new tables and their
constraints/indexes, then verify existing-data counts after publishing. The API
release gate refuses to start if the discussion schema or its existing moderation
trigger is missing. No production migration is performed by this application.

## Behavior

- Each chapter and paragraph has an independent discussion and reversible like.
  Unique indexes prevent duplicate likes even across concurrent requests.
- Unchanged, unambiguous text retains its discussion after insertions elsewhere.
  Changed or ambiguous duplicate passages keep their old discussion in an archive
  instead of assigning readers' writing to different text.
- Archived conversations remain readable/replyable. Owners can edit/delete their
  comments and revoke old likes; new root comments and new likes require current
  text. Deleting a parent keeps its replies, without a visible deleted-parent card.
- Exact released-HTML hashes protect the client against attaching paragraph
  controls to a different publication. A mismatch prompts a safe reload without
  silently moving reading progress.
- Open reading/discussion screens refresh automatically every five seconds while
  focused and foregrounded. Mutations invalidate relevant discussion caches.
- Comment submissions preserve immutable retry IDs and actor/context-bound
  drafts, including when an in-flight editor is closed and reopened.
- Reports are private to the reporter's submission and administrators.
  Administration requires the current database-backed role. Hiding preserves
  comment content/replies but hides the full branch; decisions are audited.
- Writes are limited to 30 reader actions per minute per account and three
  identical action bodies per minute. Retrying a successful comment's existing
  request ID does not consume another action. Old anti-spam hashes are pruned
  when reader actions run; deleting a comment cannot reset these limits.

## Focused verification

```sh
pnpm --filter @workspace/api-server exec tsx tests/reader-interactions.mjs
pnpm --filter @workspace/api-server exec tsx tests/book-community.mjs
pnpm --filter @workspace/api-server exec tsx --test tests/release-schema.mjs
node artifacts/api-server/tests/book-community-local.mjs
node artifacts/api-server/tests/comment-owner-local.mjs
node --experimental-strip-types --test lib/reader-core/test/paragraphs.test.ts
pnpm --filter @workspace/api-server exec tsx tests/writer-format.mjs
```

Integration tests create only synthetic development accounts/books and remove
them in `finally`. Optional browser fixtures must be explicitly cleaned afterward.
