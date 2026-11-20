// Only interpolate internal SQL parameter references, never request values.
// Deleted content leaves anonymous structure; a hidden ancestor suppresses the
// whole branch. Live nodes retain only branches that still contain real text.
export function commentTree(book = '$1', chapters = '$2') {
  return `visible_comment_nodes AS (
    SELECT n.* FROM writer_comment_nodes n WHERE n.book_id=${book} AND n.parent_id IS NULL
      AND NOT n.moderation_hidden AND (n.chapter_id IS NULL OR n.chapter_id=ANY(${chapters}::uuid[]))
    UNION ALL
    SELECT n.* FROM writer_comment_nodes n JOIN visible_comment_nodes p ON n.parent_id=p.id
      WHERE NOT n.moderation_hidden AND n.book_id=${book}
      AND (n.chapter_id IS NULL OR n.chapter_id=ANY(${chapters}::uuid[]))
  ), live_comment_nodes(id) AS (
    SELECT n.id FROM visible_comment_nodes n JOIN writer_comments c ON c.id=n.id
    UNION
    SELECT n.parent_id FROM visible_comment_nodes n JOIN live_comment_nodes l ON l.id=n.id WHERE n.parent_id IS NOT NULL
  )`;
}
export function publicCommentCount(alias = 'b') {
  const chapters = `CASE WHEN ${alias}.published_data IS NULL THEN
    ARRAY(SELECT chapter_id FROM writer_comment_nodes WHERE book_id=${alias}.id AND chapter_id IS NOT NULL)
    ELSE ARRAY(SELECT (ch->>'id')::uuid FROM jsonb_array_elements(${alias}.published_data->'chapters') ch) END`;
  return `(WITH RECURSIVE ${commentTree(`${alias}.id`, chapters)}
    SELECT count(*)::int FROM writer_comments c JOIN visible_comment_nodes n ON n.id=c.id)`;
}
