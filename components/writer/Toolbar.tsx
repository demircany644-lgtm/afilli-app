import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { makeStyles } from '@/hooks/useTheme';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { F, tap } from '@/components/ui';
import type { EditorSel } from '@/lib/writer-editor-html';
import { useWriterPalette, writerPalette } from '@/components/writer/parts';

export const INK_COLORS = [
  { v: '#3E2A1A', label: 'Mürekkep' }, { v: '#9A7430', label: 'Altın' }, { v: '#A6392D', label: 'Kırmızı' },
  { v: '#4F6B3A', label: 'Yeşil' }, { v: '#2F4E6E', label: 'Lacivert' }, { v: '#8C7660', label: 'Gri' },
];
type Cmd = (name: string, value?: unknown) => void;
type Extra = { onLink: () => void; onImage: () => void; onSpell: () => void; onVoice: () => void; night: boolean; onNight: () => void; focus: boolean; onFocus: () => void; spellBusy: boolean; imageBusy: boolean };

function T({ icon, mc, label, on, onPress, text, disabled, busy, thin }: { thin?: boolean; icon?: keyof typeof Feather.glyphMap; mc?: keyof typeof MaterialCommunityIcons.glyphMap; label: string; on?: boolean; onPress: () => void; text?: string; disabled?: boolean; busy?: boolean }) {
  const W = useWriterPalette();
  const tb = useTbStyles();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: !!on, disabled: !!disabled, busy: !!busy }} disabled={disabled}
      testID={'tool-' + label.replace(/\s+/g, '-').toLowerCase()} onPress={() => { tap(); onPress(); }} hitSlop={2}
      style={({ pressed }) => [tb.btn, on && tb.on, { opacity: disabled ? 0.35 : pressed || busy ? 0.55 : 1 }]}>
      {text ? <Text style={[tb.txt, thin && { fontFamily: F.body, fontWeight: '200', letterSpacing: 0.4 }, on && { color: W.paper }]}>{text}</Text> : mc ? <MaterialCommunityIcons name={mc} size={19} color={on ? W.paper : W.ink} /> : <Feather name={icon!} size={17} color={on ? W.paper : W.ink} />}
    </Pressable>
  );
}

type Panel = null | 'style' | 'align' | 'size' | 'color' | 'more';
export function Toolbar({ sel, cmd, x }: { sel: EditorSel | null; cmd: Cmd; x: Extra }) {
  const tb = useTbStyles();
  const [panel, setPanel] = useState<Panel>(null);
  const s = sel;
  const weight = s?.weight ?? (s?.bold ? 'bold' : s ? 'normal' : undefined);
  const toggle = (p: Panel) => setPanel(panel === p ? null : p);
  const run = (n: string, v?: unknown) => { cmd(n, v); };
  const alignIcon = s?.center ? 'align-center' : s?.right ? 'align-right' : 'align-left';
  return (
    <View style={tb.wrap}>
      <ScrollView horizontal showsHorizontalScrollIndicator keyboardShouldPersistTaps="always" contentContainerStyle={tb.row}
        accessibilityLabel="Yazı araçları" accessibilityHint="Diğer araçlar için yana kaydır">
        <T text="Aa" label="Normal yazı" on={weight === 'normal'} onPress={() => run('normal')} />
        <T mc="format-bold" label="Kalın" on={weight === 'bold' || s?.bold} onPress={() => run('bold')} />
        <T text="İnce" thin label="İnce yazı" on={weight === 'thin'} onPress={() => run('thin')} />
        <T mc="format-italic" label="Eğik" on={s?.italic} onPress={() => run('italic')} />
        <View style={tb.sep} />
        <T mc="format-text" label="Stiller" on={panel === 'style'} onPress={() => toggle('style')} />
        <T mc="format-size" label="Yazı boyutu" on={panel === 'size'} onPress={() => toggle('size')} />
        <T mc="format-list-numbered" label="Numaralı liste" on={s?.ol} onPress={() => run('insertOrderedList')} />
        <T icon={alignIcon} label="Hizalama" on={panel === 'align'} onPress={() => toggle('align')} />
        <View style={tb.sep} />
        <T icon="more-horizontal" label="Diğer araçlar" on={panel === 'more'} onPress={() => toggle('more')} />
        <T icon={x.focus ? 'minimize-2' : 'maximize-2'} label={x.focus ? 'Tam ekrandan çık' : 'Tam ekran'} on={x.focus} onPress={x.onFocus} />
      </ScrollView>
      {panel === 'style' ? (
        <View style={tb.panel} accessibilityLabel="Stiller">
          <Opt id="style-p" label="Normal paragraf" on={s?.block === 'p'} onPress={() => run('paragraph')}><Text style={tb.optText}>Paragraf</Text></Opt>
          <Opt id="style-h1" label="Başlık 1" on={s?.block === 'h1'} onPress={() => run('h1')}><Text style={[tb.optText, { fontSize: 19, fontFamily: F.serifBold }]}>Başlık 1</Text></Opt>
          <Opt id="style-h2" label="Başlık 2" on={s?.block === 'h2'} onPress={() => run('h2')}><Text style={[tb.optText, { fontSize: 17, fontFamily: F.serifBold }]}>Başlık 2</Text></Opt>
          <Opt id="style-h3" label="Başlık 3" on={s?.block === 'h3'} onPress={() => run('h3')}><Text style={[tb.optText, { fontSize: 15, fontFamily: F.serifBold }]}>Başlık 3</Text></Opt>
          <Opt id="style-quote" label="Alıntı" on={s?.block === 'blockquote'} onPress={() => run('blockquote')}><Text style={[tb.optText, { fontStyle: 'italic' }]}>“Alıntı”</Text></Opt>
          <Opt id="style-italic" label="Eğik yazı" on={s?.italic} onPress={() => run('italic')}><Text style={[tb.optText, { fontStyle: 'italic' }]}>Eğik</Text></Opt>
        </View>
      ) : panel === 'align' ? (
        <View style={tb.panel}>
          <T icon="align-left" label="Sola hizala" on={!!s && !s.center && !s.right} onPress={() => run('justifyLeft')} />
          <T icon="align-center" label="Ortala" on={s?.center} onPress={() => run('justifyCenter')} />
          <T icon="align-right" label="Sağa hizala" on={s?.right} onPress={() => run('justifyRight')} />
        </View>
      ) : panel === 'size' ? (
        <View style={tb.panel}>
          {([['small', 'Küçük', 13], ['medium', 'Orta', 16], ['large', 'Büyük', 20]] as const).map(([v, l, fs]) => (
            <Opt key={v} id={'size-' + v} label={'Yazı boyutu ' + l} onPress={() => { run('size', v); setPanel(null); }}>
              <Text style={[tb.optText, { fontSize: fs }]}>{l}</Text>
            </Opt>
          ))}
        </View>
      ) : panel === 'color' ? (
        <View style={tb.panel}>
          {INK_COLORS.map((c) => (
            <Pressable key={c.v} testID={'color-' + c.label} accessibilityRole="button" accessibilityLabel={'Yazı rengi ' + c.label} onPress={() => { tap(); cmd('color', c.v); setPanel(null); }} style={tb.swatchHit}>
              <View style={[tb.swatch, { backgroundColor: c.v }]} />
            </Pressable>
          ))}
        </View>
      ) : panel === 'more' ? (
        <View style={tb.panel}>
          <T icon="rotate-ccw" label="Geri al" onPress={() => cmd('undo')} />
          <T icon="rotate-cw" label="Yinele" onPress={() => cmd('redo')} />
          <T mc="format-underline" label="Altı çizili" on={s?.underline} onPress={() => cmd('underline')} />
          <T mc="format-strikethrough-variant" label="Üstü çizili" on={s?.strike} onPress={() => cmd('strikeThrough')} />
          <T mc="format-header-1" label="Başlık 1" on={s?.block === 'h1'} onPress={() => cmd('h1')} />
          <T mc="format-header-2" label="Başlık 2" on={s?.block === 'h2'} onPress={() => cmd('h2')} />
          <T mc="format-header-3" label="Başlık 3" on={s?.block === 'h3'} onPress={() => cmd('h3')} />
          <T mc="format-quote-open" label="Alıntı" on={s?.block === 'blockquote'} onPress={() => cmd('blockquote')} />
          <T mc="format-list-bulleted" label="Madde listesi" on={s?.ul} onPress={() => cmd('insertUnorderedList')} />
          <T mc="format-color-text" label="Yazı rengi" onPress={() => setPanel('color')} />
          <T icon="link" label="Bağlantı ekle" onPress={x.onLink} />
          <T icon="image" label="Bölüme fotoğraf ekle" onPress={x.onImage} busy={x.imageBusy} disabled={x.imageBusy} />
          <T mc="spellcheck" label="Yazım denetimi" onPress={x.onSpell} busy={x.spellBusy} disabled={x.spellBusy} />
          <T icon="mic" label="Sesli yazma" onPress={x.onVoice} />
          <T icon={x.night ? 'sun' : 'moon'} label={x.night ? 'Gündüz modu' : 'Gece modu'} on={x.night} onPress={x.onNight} />
        </View>
      ) : null}
    </View>
  );
}

function Opt({ id, label, on, onPress, children }: { id: string; label: string; on?: boolean; onPress: () => void; children: React.ReactNode }) {
  const tb = useTbStyles();
  return (
    <Pressable testID={id} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: !!on }} hitSlop={2}
      onPress={() => { tap(); onPress(); }} style={({ pressed }) => [tb.opt, on && tb.optOn, { opacity: pressed ? 0.6 : 1 }]}>
      {children}
    </Pressable>
  );
}

const useTbStyles = makeStyles((t) => {
  const W = writerPalette(t);
  return StyleSheet.create({
  wrap: { backgroundColor: W.paper, borderRadius: 14, borderWidth: 1, borderColor: W.line, marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 2, padding: 5 },
  btn: { minWidth: 44, height: 44, paddingHorizontal: 4, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  on: { backgroundColor: W.ink },
  txt: { fontFamily: F.semi, fontSize: 13, color: W.ink },
  sep: { width: 1, height: 22, backgroundColor: W.line, marginHorizontal: 3 },
  panel: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, padding: 10, paddingTop: 2, alignItems: 'center' },
  opt: { paddingHorizontal: 14, minHeight: 44, borderRadius: 10, backgroundColor: W.cream, justifyContent: 'center', borderWidth: 1, borderColor: 'transparent' },
  optOn: { borderColor: W.ink },
  swatchHit: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  optText: { fontFamily: F.serif, color: W.ink },
  swatch: { width: 32, height: 32, borderRadius: 16, borderWidth: 2, borderColor: W.paper, shadowColor: W.deep, shadowOpacity: 0.2, shadowRadius: 2, elevation: 2 },
  });
});
