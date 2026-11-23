import React from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { TopBar } from '@/components/bulletins/TopBar';
import { useCommunity } from '@/context/CommunityContext';
import { useOffline, withIdentity } from '@/components/profile/hooks';
import { useWriterPalette, Skeleton } from '@/components/writer/parts';
import { WriterShelf } from '@/components/writer/WriterShelf';
import { WriterScreen } from '@/components/writer/WriterScreen';
import { WriterStart } from '@/components/writer/WriterStart';
import { useNewWriterBook } from '@/components/writer/useNewWriterBook';

function WriterEntry({ owner }: { owner: string }) {
  const creation = useNewWriterBook(owner, id => router.push({ pathname: '/write', params: { book: id } }));
  return <WriterStart onLibrary={() => router.push({ pathname: '/write', params: { shelf: '1' } })}
    onCreate={() => void creation.create()} busy={creation.busy} error={creation.error} />;
}

function Write() {
  const W = useWriterPalette();
  const { ready, userId } = useCommunity();
  const { book, shelf } = useLocalSearchParams<{ book?: string; shelf?: string }>();
  const offline = useOffline();
  const owner = ready ? userId ?? 'guest' : null;
  const wanted = typeof book === 'string' && book ? book : null;
  const showShelf = shelf === '1' && !wanted;
  return (
    <View style={{ flex: 1, backgroundColor: W.cream }}>
      <TopBar title={showShelf ? 'Kitaplarım' : 'Kitap Yaz'} backTo={wanted || showShelf ? '/write' : '/'} />
      {!owner ? <Loading />
        : showShelf ? <WriterShelf key={owner} owner={owner} offline={offline} />
          : wanted ? <WriterScreen key={owner + ':' + wanted} owner={owner} id={wanted} offline={offline} />
            : <WriterEntry key={owner} owner={owner} />}
    </View>
  );
}
function Loading() {
  return <View style={{ padding: 16, gap: 12 }}><Skeleton h={180} /><Skeleton h={220} /><Skeleton h={300} /></View>;
}
export default withIdentity(Write);
