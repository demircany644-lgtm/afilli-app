import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Linking, Platform, StyleSheet, Text, View, type TextStyle } from 'react-native';
import { makeStyles } from '@/hooks/useTheme';
import { Feather } from '@expo/vector-icons';
import { useGetWriterImageAccess, getGetWriterImageAccessQueryKey } from '@workspace/api-client-react';
import { F } from '@/components/ui';
import { scoped, actorRequest } from '@/components/profile/hooks';
import { useCommunity } from '@/context/CommunityContext';
import { writerMediaId } from '@/lib/writer-text';
import { CopyGuard, CopyProtectionHint } from './CopyGuard';
import { useWriterPalette, writerPalette, Confirm } from '@/components/writer/parts';
import { mediaUrl } from '@/components/bulletins/common';

/**
 * Manuscript HTML -> native Text/View. Nothing is executed: unknown tags are
 * flattened to their text, only http(s) links (confirmed) and canonical images render.
 */
import { parseHtml, hasImg, isBlock, BLOCK, type El, type Node } from '@workspace/reader-core';
export { parseHtml };

const PX = new Set([12, 14, 16, 17, 18, 20, 22, 24, 28, 32]);
type Mut<T> = { -readonly [K in keyof T]: T[K] };
function styleOf(attrs: Record<string, string>): TextStyle & { align?: 'left' | 'center' | 'right' } {
  const out: Mut<TextStyle> & { align?: 'left' | 'center' | 'right' } = {};
  for (const decl of (attrs.style ?? '').split(';')) {
    const [k, ...rest] = decl.split(':'); const v = rest.join(':').trim().toLowerCase(); const key = (k ?? '').trim().toLowerCase();
    if (key === 'color' && /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\))$/.test(v)) out.color = v;
    else if (key === 'font-size') { const n = parseInt(v, 10); if (PX.has(n)) { out.fontSize = n; out.lineHeight = Math.round(n * 1.6); } }
    else if (key === 'text-align' && (v === 'left' || v === 'center' || v === 'right')) out.align = v;
    else if (key === 'font-weight' && /^(?:normal|bold|[1-9]00)$/.test(v)) {
      const weight = v === 'normal' ? '400' : v === 'bold' ? '700' : v;
      out.fontWeight = weight as TextStyle['fontWeight'];
      out.fontFamily = Number(weight) >= 600 ? F.semi : Number(weight) < 400
        ? Platform.OS === 'android' ? 'sans-serif-light' : Platform.OS === 'ios' ? 'System' : 'system-ui'
        : Number(weight) === 500 ? F.med : F.body;
    }
    else if (key === 'font-style' && (v === 'italic' || v === 'normal')) out.fontStyle = v;
    else if ((key === 'text-decoration' || key === 'text-decoration-line') && /underline|line-through/.test(v))
      out.textDecorationLine = v.includes('underline') && v.includes('line-through') ? 'underline line-through' : v.includes('underline') ? 'underline' : 'line-through';
  }
  return out;
}

export function HtmlView({ html, night, owner, privatePreview = false, fontSize = 17, annotate }: { html: string; night?: boolean; owner: string | null; privatePreview?: boolean; fontSize?: number; annotate?: (path: string, text: React.ReactNode) => React.ReactNode }) {
  const W = useWriterPalette();
  const rs = useRsStyles();
  const [link, setLink] = useState<string | null>(null);
  const ink = night ? '#EADBC4' : W.ink;
  const base: TextStyle = { fontFamily: F.body, fontSize, lineHeight: Math.round(fontSize * 1.65), color: ink };
  const scaleStyle = (s: TextStyle): TextStyle => ({
    ...s,
    ...(s.fontSize ? { fontSize: s.fontSize * fontSize / 17 } : {}),
    ...(s.lineHeight ? { lineHeight: s.lineHeight * fontSize / 17 } : {}),
    ...(night && s.color ? { color: ink } : {}),
  });

  const inline = (n: Node, k: string): React.ReactNode => {
    if (typeof n === 'string') return n.replace(/\s+/g, ' ');
    const kids = n.kids.map((c, i) => inline(c, k + '.' + i));
    const { align: _a, ...raw } = styleOf(n.attrs);
    const s = scaleStyle(raw);
    switch (n.tag) {
      case 'br': return '\n';
      case 'strong': case 'b': return <Text key={k} style={[{ fontFamily: F.semi }, s]}>{kids}</Text>;
      case 'em': case 'i': return <Text key={k} style={[{ fontStyle: 'italic' }, s]}>{kids}</Text>;
      case 'u': return <Text key={k} style={[{ textDecorationLine: 'underline' }, s]}>{kids}</Text>;
      case 's': case 'strike': case 'del': return <Text key={k} style={[{ textDecorationLine: 'line-through' }, s]}>{kids}</Text>;
      case 'a': {
        const href = (n.attrs.href ?? '').trim();
        if (!/^https?:\/\//i.test(href)) return <Text key={k} style={s}>{kids}</Text>;
        return <Text key={k} style={[{ color: night ? '#E3C47A' : '#9A7430', textDecorationLine: 'underline' }, s]} accessibilityRole="link" onPress={() => setLink(href)}>{kids}</Text>;
      }
      default: return <Text key={k} style={s}>{kids}</Text>;
    }
  };
  const flowText = (nodes: Node[], k: string, style: TextStyle[], align?: string) => {
    const parts = nodes.map((c, i) => inline(c, k + '.' + i));
    const txt = nodes.length === 0 ? '' : null;
    const el = <Text key={k} selectable={false} style={[base, ...style.map(scaleStyle), align ? { textAlign: align as TextStyle['textAlign'] } : null]}>{txt ?? parts}</Text>;
    // Paragraph discussion controls attach by the same path reader-core reports.
    return annotate ? <React.Fragment key={k}>{annotate(k, el)}</React.Fragment> : el;
  };
  const blocks = (nodes: Node[], k: string, inherited: TextStyle[] = [], inheritedAlign?: string): React.ReactNode[] => {
    const out: React.ReactNode[] = []; let run: Node[] = [];
    const flush = () => { if (run.some((r) => typeof r !== 'string' || r.trim())) out.push(flowText(run, k + 'r' + out.length, [rs.p, ...inherited], inheritedAlign)); run = []; };
    nodes.forEach((n, i) => {
      if (!isBlock(n)) { run.push(n); return; }
      flush();
      out.push(block(n as El, k + '.' + i, inherited, inheritedAlign));
    });
    flush();
    return out;
  };
  const block = (n: El, k: string, inherited: TextStyle[], inheritedAlign?: string): React.ReactNode => {
    const s = styleOf(n.attrs);
    const { align: ownAlign, ...ts } = s;
    const align = ownAlign ?? inheritedAlign;
    const styles = [...inherited, ts];
    switch (n.tag) {
      case 'img': return <ReaderImage key={k} src={n.attrs.src ?? ''} owner={owner} privatePreview={privatePreview} />;
      case 'hr': return <View key={k} style={rs.hr} />;
      case 'blockquote': return <View key={k} style={rs.quote}>{blocks(n.kids, k, [...inherited, { fontStyle: 'italic' }, ts], align)}</View>;
      case 'ul': case 'ol': {
        let i = 0;
        return (
          <View key={k} style={rs.list}>
            {n.kids.filter((c): c is El => typeof c !== 'string' && c.tag === 'li').map((li, j) => {
              const { align: liAlign, ...liStyle } = styleOf(li.attrs);
              const itemStyles = [...styles, liStyle], itemAlign = liAlign ?? align;
              return (
              <View key={k + 'li' + j} style={rs.li}>
                <Text style={[base, rs.bullet]}>{n.tag === 'ol' ? ++i + '.' : '\u2022'}</Text>
                <View style={{ flex: 1 }}>{hasImg(li) || li.kids.some(isBlock) ? blocks(li.kids, k + 'l' + j, itemStyles, itemAlign) : flowText(li.kids, k + 'l' + j, itemStyles, itemAlign)}</View>
              </View>
            ); })}
          </View>
        );
      }
      default: {
        const head = n.tag === 'h1' ? rs.h1 : n.tag === 'h2' ? rs.h2 : n.tag === 'h3' ? rs.h3 : rs.p;
        if (hasImg(n) || n.kids.some((c) => typeof c !== 'string' && BLOCK.has(c.tag))) return <View key={k}>{blocks(n.kids, k, styles, align)}</View>;
        if (!n.kids.length || n.kids.every((c) => (typeof c === 'string' ? !c.trim() : c.tag === 'br'))) return <View key={k} style={{ height: 14 }} />;
        return flowText(n.kids, k, [...inherited, head, ts, n.tag.startsWith('h') ? { color: ink } : {}], align);
      }
    }
  };

  const tree = parseHtml(html);
  return (
    <CopyGuard>
      {blocks(tree.kids, 'b')}
      <CopyProtectionHint />
      <Confirm visible={!!link} title="Dış bağlantı" confirm="Aç" onCancel={() => setLink(null)}
        onConfirm={() => { const u = link; setLink(null); if (u) void Linking.openURL(u).catch(() => undefined); }}
        text={'Bu bağlantı Afilli dışına çıkıyor:\n' + (link ?? '') + '\nAçmak istiyor musun?'} />
    </CopyGuard>
  );
}

function ReaderImage({ src, owner, privatePreview }: { src: string; owner: string | null; privatePreview: boolean }) {
  const W = useWriterPalette();
  const rs = useRsStyles();
  const { ready } = useCommunity();
  const mid = writerMediaId(src);
  const [failed, setFailed] = useState(false);
  const [ratio, setRatio] = useState(4 / 3);
  const q = useGetWriterImageAccess(mid ?? '', { query: { enabled: privatePreview && !!owner && !!mid && ready, queryKey: scoped(getGetWriterImageAccessQueryKey(mid ?? ''), owner), staleTime: 240_000 }, request: actorRequest(owner) });
  // Public requests are checked against the released snapshot by the server.
  // Private preview alone may exchange an owner's reference for a signed URL.
  const uri = privatePreview ? q.data?.url : mid ? mediaUrl(src) : null;
  useEffect(() => { setFailed(false); }, [uri]);
  if (!mid) return null;
  if (privatePreview && q.isLoading) return <View style={[rs.img, rs.imgBox]}><ActivityIndicator color={W.gold} /></View>;
  if ((privatePreview && q.isError) || failed || !uri) {
    return (
      <View style={[rs.img, rs.imgBox]} accessibilityLabel="Görsel şu an gösterilemiyor">
        <Feather name="image" size={22} color={W.muted} />
        <Text style={rs.imgText}>Görsel şu an gösterilemiyor{q.isError ? '. Bağlantını kontrol et.' : ''}</Text>
      </View>
    );
  }
  return <Image source={{ uri }} accessibilityLabel="Bölüm görseli" accessibilityIgnoresInvertColors onError={() => setFailed(true)}
    onLoad={(e) => { const s = e.nativeEvent.source; if (s?.width && s?.height) setRatio(s.width / s.height); }}
    style={[rs.img, { aspectRatio: ratio }]} resizeMode="contain" />;
}

const useRsStyles = makeStyles((t) => {
  const W = writerPalette(t);
  return StyleSheet.create({
  p: { marginBottom: 14 },
  h1: { fontFamily: F.serifBold, fontSize: 26, lineHeight: 33, marginTop: 10, marginBottom: 10 },
  h2: { fontFamily: F.serifBold, fontSize: 22, lineHeight: 29, marginTop: 8, marginBottom: 8 },
  h3: { fontFamily: F.serifBold, fontSize: 19, lineHeight: 26, marginTop: 6, marginBottom: 8 },
  quote: { borderLeftWidth: 3, borderColor: W.gold, paddingLeft: 14, marginVertical: 6, opacity: 0.9 },
  list: { marginBottom: 12, gap: 4 },
  li: { flexDirection: 'row', gap: 8 },
  bullet: { width: 22, textAlign: 'right' },
  hr: { height: 1, backgroundColor: W.line, marginVertical: 16 },
  img: { width: '100%', borderRadius: 12, marginVertical: 10 },
  imgBox: { height: 160, backgroundColor: W.input, alignItems: 'center', justifyContent: 'center', gap: 6 },
  imgText: { fontFamily: F.body, fontSize: 12, color: W.muted },
  });
});
