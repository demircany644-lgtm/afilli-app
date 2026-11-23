export type ReaderDrag = {
  dx: number;
  dy: number;
  vx: number;
  numberActiveTouches: number;
};

/** Keep vertical reading, taps, small drags and multi-touch out of chapter navigation. */
export function startsChapterSwipe(drag: ReaderDrag) {
  return Number.isFinite(drag.dx) && Number.isFinite(drag.dy) &&
    drag.numberActiveTouches === 1 &&
    Math.abs(drag.dx) >= 24 && Math.abs(drag.dx) > Math.abs(drag.dy) * 1.8;
}

/** The requested direction is intentional: left-to-right advances to the NEXT chapter. */
export function chapterSwipeStep(drag: ReaderDrag): -1 | 0 | 1 {
  if (![drag.dx, drag.dy, drag.vx].every(Number.isFinite) || drag.numberActiveTouches > 1 ||
    Math.abs(drag.dx) <= Math.abs(drag.dy) * 1.8) return 0;
  const distance = Math.abs(drag.dx);
  const flick = distance >= 36 && Math.abs(drag.vx) >= .65 && Math.sign(drag.vx) === Math.sign(drag.dx);
  return distance >= 72 || flick ? (drag.dx > 0 ? 1 : -1) : 0;
}

export function nextChapterIndex(index: number, length: number, step: number) {
  const next = index + step;
  return Number.isInteger(index) && index >= 0 && (step === 1 || step === -1) &&
    next >= 0 && next < length ? next : null;
}
