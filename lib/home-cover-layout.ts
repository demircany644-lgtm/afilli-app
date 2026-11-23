/**
 * Home-only cover extension. Borrow 5 from the heading gap and 14 from
 * the space below the cover, without moving the next shelf.
 * Logical units approximate the requested increase, not physical millimetres.
 */
export function homeCoverLayout(originalHeight: number) {
  const height = originalHeight + 19;
  return {
    height,
    marginTop: -5,
    frameHeight: height + 2,
    // Keep the original internal padding so native scroll clipping does not
    // cut off the cover shadow. Only that padding extends beyond the frame;
    // the whole cover and its touch target stay inside the frame.
    scrollHeight: height + 2 + 14,
  };
}
