export type ProfileCropSpec = { rotation: 0 | 90 | 180 | 270; zoom: number; dx: number; dy: number };
export type ProfileCropPurpose = 'avatar' | 'cover';

/** Crop rectangle in the post-rotation source; avatar is square and profile covers are 3:1. */
export function profileCropRect(width: number, height: number, purpose: ProfileCropPurpose, spec: ProfileCropSpec) {
  const [rotatedWidth, rotatedHeight] = spec.rotation % 180 ? [height, width] : [width, height];
  const ratio = purpose === 'avatar' ? 1 : 3;
  let cropWidth = rotatedWidth;
  let cropHeight = cropWidth / ratio;
  if (cropHeight > rotatedHeight) {
    cropHeight = rotatedHeight;
    cropWidth = cropHeight * ratio;
  }
  cropWidth = Math.max(1, Math.min(rotatedWidth, cropWidth / Math.max(1, spec.zoom)));
  cropHeight = Math.max(1, Math.min(rotatedHeight, cropHeight / Math.max(1, spec.zoom)));
  const unit = Math.max(1, Math.floor(Math.min(cropWidth / ratio, cropHeight)));
  cropWidth = unit * ratio;
  cropHeight = unit;
  const dx = Math.max(-1, Math.min(1, spec.dx));
  const dy = Math.max(-1, Math.min(1, spec.dy));
  const x = Math.round((rotatedWidth - cropWidth) / 2 * (1 + dx));
  const y = Math.round((rotatedHeight - cropHeight) / 2 * (1 + dy));
  return {
    rotatedWidth,
    rotatedHeight,
    x: Math.max(0, Math.min(rotatedWidth - cropWidth, x)),
    y: Math.max(0, Math.min(rotatedHeight - cropHeight, y)),
    width: Math.floor(cropWidth),
    height: Math.floor(cropHeight),
  };
}
