import React, { useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { deleteWriterComment, editWriterComment, type WriterComment } from '@workspace/api-client-react';
import { useCommunity } from '@/context/CommunityContext';
import { actorRequest, useOwnerGuard } from '@/components/profile/hooks';
import { apiError, Btn } from '@/components/bulletins/common';
import { F } from '@/components/ui';
import { makeStyles } from '@/hooks/useTheme';
import { useWriterPalette, writerPalette } from './parts';

/** Ordinary discussion actions are author-only; admin moderation remains separate. */
export function CommentOwnerActions({ comment, blocked, onChanged }: {
  comment: WriterComment; blocked: boolean; onChanged: (comment: WriterComment) => void;
}) {
  const { userId } = useCommunity();
  const guard = useOwnerGuard(userId);
  const W = useWriterPalette(), styles = useStyles();
  const [mode, setMode] = useState<'closed' | 'edit' | 'delete'>('closed');
  const [draft, setDraft] = useState('');
  const latest = useRef(draft);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const lock = useRef(false);
  const own = !!userId && comment.author.id === userId && !comment.deleted;
  const change = async (remove: boolean) => {
    if (!own || !userId || !guard() || lock.current || blocked) return;
    const sent = latest.current.trim();
    if (!remove && !sent) { setError('Yorumunu yaz.'); return; }
    lock.current = true; setBusy(true); setError(null); setNotice(null);
    try {
      const next = remove
        ? await deleteWriterComment(comment.id, actorRequest(userId))
        : await editWriterComment(comment.id, { body: sent }, actorRequest(userId));
      if (!guard()) return;
      onChanged(next);
      if (remove || latest.current.trim() === sent) setMode('closed');
      else setNotice('Önceki metin kaydedildi. Son değişikliğini de kaydedebilirsin.');
    } catch (e) {
      if (guard()) setError(apiError(e, remove ? 'Yorum silinemedi. Tekrar deneyebilirsin.' : 'Yorum kaydedilemedi. Metnin duruyor.'));
    } finally { lock.current = false; if (guard()) setBusy(false); }
  };
  if (!own) return null;
  const cancel = () => { if (!lock.current) { setMode('closed'); setError(null); setNotice(null); } };
  return (
    <View style={styles.wrap}>
      {mode === 'closed' ? <View style={styles.actions}>
        <Btn label="Düzenle" icon="edit-3" ghost testID={'comment-edit-' + comment.id} disabled={blocked}
          onPress={() => { latest.current = comment.body; setDraft(comment.body); setMode('edit'); setError(null); setNotice(null); }} />
        <Btn label="Sil" icon="trash-2" ghost testID={'comment-delete-' + comment.id} disabled={blocked}
          onPress={() => { setMode('delete'); setError(null); setNotice(null); }} />
      </View> : mode === 'edit' ? <View style={styles.editor}>
        <TextInput testID={'comment-edit-input-' + comment.id} accessibilityLabel="Yorumunu düzenle" multiline autoFocus
          value={draft} maxLength={3000} onChangeText={value => { latest.current = value; setDraft(value); }}
          style={styles.input} placeholderTextColor={W.muted} />
        <View style={styles.actions}>
          <Btn label={busy ? 'Kaydediliyor' : 'Kaydet'} testID={'comment-edit-save-' + comment.id} busy={busy}
            disabled={busy || blocked || !draft.trim()} onPress={() => void change(false)} />
          <Btn label="Vazgeç" ghost disabled={busy} onPress={cancel} />
        </View>
      </View> : <View style={styles.editor} testID={'comment-delete-confirm-' + comment.id}>
        <Text style={styles.text}>Yorumun silinsin mi? Altındaki yanıtlar korunur.</Text>
        <View style={styles.actions}>
          <Btn label={busy ? 'Siliniyor' : 'Yorumu sil'} testID={'comment-delete-yes-' + comment.id} disabled={busy || blocked}
            busy={busy} onPress={() => void change(true)} />
          <Btn label="Vazgeç" ghost disabled={busy} onPress={cancel} />
        </View>
      </View>}
      {error ? <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text> : null}
      {notice ? <Text style={styles.text} accessibilityLiveRegion="polite">{notice}</Text> : null}
    </View>
  );
}

const useStyles = makeStyles(theme => {
  const W = writerPalette(theme);
  return StyleSheet.create({
    wrap: { gap: 6, marginTop: 6 },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    editor: { gap: 8 },
    text: { fontFamily: F.body, fontSize: 13, color: W.muted },
    error: { fontFamily: F.body, fontSize: 13, color: W.danger },
    input: { minHeight: 90, maxHeight: 240, textAlignVertical: 'top', borderWidth: 1, borderColor: W.line,
      borderRadius: 12, padding: 12, fontFamily: F.body, fontSize: 15, color: W.ink, backgroundColor: W.paper },
  });
});
