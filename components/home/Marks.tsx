import React from 'react';
import Svg, { Circle, Path } from 'react-native-svg';
import colors from '@/constants/colors';

// Quill resting on an open book: the Afilli mark.
export function FeatherBookMark({ size = 40, color, bg = colors.home.bg }: { size?: number; color: string; bg?: string }) {
  return (
    <Svg width={size} height={size * 0.8} viewBox="0 0 50 40">
      <Path d="M4 30 C12 26 20 27 25 31 C30 27 38 26 46 30 L46 36 C38 32 30 33 25 37 C20 33 12 32 4 36 Z" fill="none" stroke={color} strokeWidth={1.8} strokeLinejoin="round" />
      <Path d="M25 31 L25 37" stroke={color} strokeWidth={1.4} />
      <Path d="M10 27 C14 14 26 5 42 2 C38 12 30 22 14 26 Z" fill={color} />
      <Path d="M12 28 C20 20 28 13 38 6" stroke={bg} strokeWidth={0.9} fill="none" />
    </Svg>
  );
}

// Black disc with concentric white rings and a white quill.
export function WriteDisc({ size, disc, ring }: { size: number; disc: string; ring: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Circle cx={50} cy={50} r={48} fill={disc} stroke={ring} strokeWidth={3} />
      <Circle cx={50} cy={50} r={40} fill="none" stroke={ring} strokeOpacity={0.55} strokeWidth={1} />
      <Circle cx={50} cy={50} r={33} fill="none" stroke={ring} strokeOpacity={0.35} strokeWidth={0.8} />
      <Path d="M36 66 C40 50 50 38 66 31 C63 44 54 56 40 63 Z" fill={ring} />
      <Path d="M34 70 L58 40" stroke={disc} strokeWidth={1.2} />
      <Path d="M33 71 L37 65" stroke={ring} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}
