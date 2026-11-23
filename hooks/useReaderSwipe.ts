import { useMemo, useRef } from 'react';
import { PanResponder } from 'react-native';
import { chapterSwipeStep, nextChapterIndex, startsChapterSwipe } from '@/lib/reader-swipe';

/** Read current props at release: never navigate with a prior chapter/account's closure. */
export function useReaderSwipe(props: {
  index: number; count: number; disabled: boolean; onSelectIndex: (index: number) => void;
}) {
  const latest = useRef(props);
  latest.current = props;
  const lastSwipe = useRef(0);
  const interrupted = useRef(false);
  return useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, drag) => !latest.current.disabled &&
      latest.current.count > 1 && startsChapterSwipe(drag),
    onPanResponderTerminationRequest: () => true,
    onPanResponderGrant: () => { interrupted.current = false; },
    onPanResponderStart: (_, drag) => { if (drag.numberActiveTouches > 1) interrupted.current = true; },
    onPanResponderMove: (_, drag) => { if (drag.numberActiveTouches > 1) interrupted.current = true; },
    onPanResponderTerminate: () => { interrupted.current = true; },
    onPanResponderRelease: (_, drag) => {
      const current = latest.current;
      if (interrupted.current || current.disabled || Date.now() - lastSwipe.current < 240) return;
      const index = nextChapterIndex(current.index, current.count, chapterSwipeStep(drag));
      if (index === null) return;
      lastSwipe.current = Date.now();
      current.onSelectIndex(index);
    },
  }), []).panHandlers;
}
