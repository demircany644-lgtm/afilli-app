/**
 * JSON array of earned writer badge keys, evaluated from published reads.
 * Caller supplies a trusted SQL author-id expression, never request text.
 */
export function writerBadgesSql(authorId: string) {
  return `(SELECT coalesce(json_agg(badge ORDER BY sort_order),'[]'::json)
    FROM (
      SELECT 'successful'::text AS badge,1 AS sort_order
      WHERE (SELECT count(*) FROM authored_books b WHERE b.author_id=${authorId}
          AND b.publication='published' AND NOT b.moderation_hidden)>=1
        AND (SELECT count(*) FROM book_reads r JOIN authored_books b ON b.id=r.book_id
          WHERE b.author_id=${authorId} AND b.publication='published' AND NOT b.moderation_hidden
            AND r.reader_id<>b.author_id)>=10000
      UNION ALL
      SELECT 'master'::text,2
      WHERE (SELECT count(*) FROM authored_books b WHERE b.author_id=${authorId}
          AND b.publication='published' AND NOT b.moderation_hidden)>=3
        AND (SELECT count(*) FROM book_reads r JOIN authored_books b ON b.id=r.book_id
          WHERE b.author_id=${authorId} AND b.publication='published' AND NOT b.moderation_hidden
            AND r.reader_id<>b.author_id)>=50000
      UNION ALL
      SELECT 'popular'::text,3
      WHERE EXISTS(
        SELECT 1 FROM (
          SELECT b.author_id FROM authored_books b JOIN book_reads r ON r.book_id=b.id
          WHERE b.publication='published' AND NOT b.moderation_hidden
            AND r.reader_id<>b.author_id AND r.created_at>=now()-interval '30 days'
          GROUP BY b.author_id ORDER BY count(*) DESC,b.author_id LIMIT 10
        ) ranking WHERE ranking.author_id=${authorId}
      )
    ) achievements)`;
}
