import { pool } from '@workspace/db';
import type { Conversation, DirectMessage, MessageGif } from '@workspace/api-zod';
import { fail, type Transaction } from './community';
import { PERSON } from './social';

export async function assertDirectMessageSchema() {
  const { rows } = await pool.query(`SELECT
    (SELECT count(*) FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='direct_messages'
      AND column_name IN ('sequence','payload_hash','reply_to_id','has_reply','gif','photo_id','change_sequence','deleted_at','media_expired_at'))=9
    AND EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='direct_messages'
      AND column_name='sequence' AND is_identity='YES') AS ok`);
  if (!rows[0]?.ok) throw new Error('Private message release blocked: apply tools/direct-messages.sql and tools/direct-message-media.sql before release.');
}

export async function member(thread: string, actor: string, client: Transaction | typeof pool = pool, lock = false) {
  return (await client.query<{ user_low: string; user_high: string }>(`SELECT user_low,user_high FROM conversations
    WHERE id=$1 AND (user_low=$2 OR user_high=$2) ${lock ? 'FOR UPDATE' : ''}`, [thread, actor])).rows[0] ?? fail(404, 'Konuşma bulunamadı.');
}

export async function threads(actor: string, id: string | null = null): Promise<Conversation[]> {
  const result = await pool.query<Conversation>(`SELECT c.id,${PERSON} AS peer,
    (SELECT CASE WHEN deleted_at IS NOT NULL THEN 'Bu mesaj silindi' WHEN body<>'' THEN body
      WHEN media_expired_at IS NOT NULL OR created_at<=now()-interval '7 days' AND (gif IS NOT NULL OR photo_id IS NOT NULL) THEN 'Bu medya süresi dolduğu için silindi'
      WHEN photo_id IS NOT NULL THEN 'Fotoğraf' WHEN gif IS NOT NULL THEN 'GIF' ELSE body END
      FROM direct_messages WHERE thread_id=c.id ORDER BY sequence DESC LIMIT 1) AS "lastMessage",
    c.updated_at AS "updatedAt",(SELECT count(*)::int FROM direct_messages WHERE thread_id=c.id AND sender_id<>$1 AND read_at IS NULL AND deleted_at IS NULL) AS "unreadCount",
    coalesce(u.online_visible AND (CASE WHEN c.user_low=u.id THEN c.low_typing_until ELSE c.high_typing_until END)>now(),false) AS "peerTyping",
    coalesce(u.online_visible AND u.presence_active AND u.last_seen>now()-interval '60 seconds',false) AS "peerOnline",
    CASE WHEN u.online_visible THEN u.last_seen ELSE NULL END AS "peerLastSeen"
    FROM conversations c JOIN community_users u ON u.id=CASE WHEN c.user_low=$1 THEN c.user_high ELSE c.user_low END
    WHERE (c.user_low=$1 OR c.user_high=$1) AND ($2::uuid IS NULL OR c.id=$2) ORDER BY c.updated_at DESC,c.id DESC LIMIT 100`, [actor, id]);
  return result.rows.map(row => ({ ...row, updatedAt: new Date(row.updatedAt).toISOString(), peerLastSeen: row.peerLastSeen ? new Date(row.peerLastSeen).toISOString() : null }));
}

export async function messageData(ids: string[]): Promise<DirectMessage[]> {
  const active = (a: string) => `${a}.deleted_at IS NULL AND ${a}.media_expired_at IS NULL AND ${a}.created_at>now()-interval '7 days'`;
  const expired = (a: string) => `(${a}.media_expired_at IS NOT NULL OR (${a}.gif IS NOT NULL OR ${a}.photo_id IS NOT NULL) AND ${a}.created_at<=now()-interval '7 days')`;
  const rows = (await pool.query<DirectMessage>(`SELECT m.id,m.thread_id AS "threadId",${PERSON} AS sender,
    CASE WHEN m.deleted_at IS NULL THEN m.body ELSE '' END AS body,
    m.client_id AS "clientId",m.sequence::text AS sequence,m.change_sequence::text AS "changeSequence",
    m.deleted_at AS "deletedAt",${expired('m')} AS "mediaExpired",
    CASE WHEN m.gif IS NOT NULL OR m.photo_id IS NOT NULL OR m.media_expired_at IS NOT NULL THEN m.created_at+interval '7 days' ELSE NULL END AS "mediaExpiresAt",
    CASE WHEN ${active('m')} THEN m.gif ELSE NULL END AS gif,
    CASE WHEN ${active('m')} AND p.ready AND p.delete_requested_at IS NULL THEN jsonb_build_object('id',p.id,'width',p.width,'height',p.height) ELSE NULL END AS photo,
    m.created_at AS "createdAt",m.read_at AS "readAt",
    CASE WHEN m.deleted_at IS NOT NULL OR NOT m.has_reply THEN NULL WHEN q.id IS NULL OR q.deleted_at IS NOT NULL THEN jsonb_build_object('id',NULL,'available',false,'sender',NULL,'body',NULL,'gif',NULL,'photo',NULL)
      ELSE jsonb_build_object('id',q.id,'available',true,'sender',jsonb_build_object('id',qu.id,'nickname',qu.nickname,'avatar',qu.avatar),
        'body',q.body,'mediaExpired',${expired('q')},'gif',CASE WHEN ${active('q')} THEN q.gif ELSE NULL END,
        'photo',CASE WHEN ${active('q')} AND qp.ready AND qp.delete_requested_at IS NULL THEN jsonb_build_object('id',qp.id,'width',qp.width,'height',qp.height) ELSE NULL END) END AS reply
    FROM direct_messages m JOIN community_users u ON u.id=m.sender_id
    LEFT JOIN direct_messages q ON q.id=m.reply_to_id AND q.thread_id=m.thread_id
    LEFT JOIN community_users qu ON qu.id=q.sender_id
    LEFT JOIN direct_message_uploads p ON p.id=m.photo_id
    LEFT JOIN direct_message_uploads qp ON qp.id=q.photo_id
    WHERE m.id=ANY($1::uuid[]) ORDER BY m.sequence DESC`, [ids])).rows;
  return rows.map(row => ({ ...row, createdAt: new Date(row.createdAt).toISOString(), readAt: row.readAt ? new Date(row.readAt).toISOString() : null,
    deletedAt: row.deletedAt ? new Date(row.deletedAt).toISOString() : null,
    mediaExpiresAt: row.mediaExpiresAt ? new Date(row.mediaExpiresAt).toISOString() : null }));
}

export function sequence(value: unknown) {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,18})$/.test(value) || BigInt(value) > 9223372036854775807n) return fail(400, 'Mesaj sırası geçersiz.');
  return value;
}

/** Never let arbitrary remote URLs become executable links or tracking attachments. */
export function validateGif(gif: MessageGif | null | undefined): MessageGif | null {
  if (!gif) return null;
  const validUrl = (raw: string, hosts: string[]) => {
    try {
      const u = new URL(raw);
      return u.protocol === 'https:' && !u.username && !u.password && !u.port && hosts.includes(u.hostname);
    } catch { return false; }
  };
  const media = ['static.klipy.com', 'static1.klipy.com', 'static2.klipy.com'];
  const sources = ['klipy.com', 'www.klipy.com'];
  if (!validUrl(gif.url, media) || !validUrl(gif.sourceUrl, sources)) return fail(400, 'GIF yalnızca izin verilen sağlayıcıdan seçilebilir.');
  return { ...gif, attribution: 'Powered by KLIPY', license: null };
}
