import { pool, type PoolClient } from '@workspace/db';
import type { VisualAsset, VisualCollectionAccount, VisualSelection, MessageGif } from '@workspace/api-zod';
import { fail } from './community';

export const visualColumns = `a.id,a.category,a.name,a.description,a.month,a.content_type AS "contentType",
  a.width,a.height,a.published,a.ready,
  (SELECT count(*)::int FROM visual_collection_items ci WHERE ci.asset_id=a.id) AS "savedCount"`;
export async function visualPremium(userId: string, db: PoolClient | typeof pool = pool) {
  return !!(await db.query(`SELECT 1 FROM premium_memberships WHERE user_id=$1 AND status='active'
    AND (source='free' OR expires_at>now())`, [userId])).rowCount;
}
export async function requireVisualPremium(userId: string, db: PoolClient | typeof pool = pool) {
  if (!await visualPremium(userId, db)) return fail(403, 'Bu koleksiyon için etkin Premium üyeliği gerekiyor.');
}
export async function selectedVisuals(userId: string, targetId: string, publicOnly = true): Promise<VisualSelection[]> {
  const result = await pool.query<VisualAsset & { targetId: string; caption: string }>(`SELECT ${visualColumns},
    s.target_id AS "targetId",s.caption FROM visual_selections s JOIN visual_assets a ON a.id=s.asset_id
    WHERE s.user_id=$1 AND s.target_id=$2 AND a.ready
      ${publicOnly ? `AND a.published AND EXISTS(SELECT 1 FROM premium_memberships m
        WHERE m.user_id=s.user_id AND m.status='active' AND (m.source='free' OR m.expires_at>now()))` : ''}
    ORDER BY a.category`, [userId, targetId]);
  return result.rows.map(({ targetId: target, caption, ...asset }) => ({ category: asset.category, targetId: target, asset, caption }));
}
export async function visualAccount(userId: string): Promise<VisualCollectionAccount> {
  const [active, saved, selections] = await Promise.all([
    visualPremium(userId),
    pool.query<{ asset_id: string }>('SELECT asset_id FROM visual_collection_items WHERE user_id=$1 ORDER BY saved_at DESC', [userId]),
    pool.query<VisualAsset & { targetId: string; caption: string }>(`SELECT ${visualColumns},s.target_id AS "targetId",s.caption
      FROM visual_selections s JOIN visual_assets a ON a.id=s.asset_id WHERE s.user_id=$1 AND a.ready
      ORDER BY s.updated_at DESC`, [userId]),
  ]);
  return { active, savedIds: saved.rows.map(r => r.asset_id),
    selections: selections.rows.map(({ targetId, caption, ...asset }) => ({ category: asset.category, targetId, caption, asset })) };
}
export function collectionGif(asset: Pick<VisualAsset, 'id' | 'name' | 'width' | 'height'>): MessageGif {
  const uri = `afilli://visual-collections/${asset.id}`;
  return { provider: 'afilli', id: asset.id, title: asset.name, width: asset.width, height: asset.height,
    url: uri, sourceUrl: uri, attribution: 'Afilli Premium Koleksiyonu', license: null };
}
export async function resolveCollectionGif(input: MessageGif, userId: string, db: PoolClient) {
  await requireVisualPremium(userId, db);
  const asset = (await db.query<VisualAsset>(`SELECT ${visualColumns} FROM visual_assets a
    JOIN visual_collection_items ci ON ci.asset_id=a.id AND ci.user_id=$2
    WHERE a.id=$1 AND a.category='animation' AND a.content_type='image/gif' AND a.ready AND a.published`,
  [input.id, userId])).rows[0];
  if (!asset) return fail(422, 'GIF etkin Premium koleksiyonunda bulunamadı.');
  return collectionGif(asset);
}
