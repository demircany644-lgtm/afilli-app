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

/** Size portrait covers so two fit and roughly half of a third peeks in. */
export function homeCategoryCarouselLayout(viewportWidth: number, horizontalPadding: number, gap = 12) {
  const contentWidth = Math.max(0, Math.min(viewportWidth, 560) - horizontalPadding * 2);
  const coverWidth = Math.floor(Math.min(190, Math.max(0, (contentWidth - gap * 2) / 2.5)));
  return {
    coverWidth,
    coverHeight: Math.round(coverWidth * 1.5),
    gap,
  };
}
