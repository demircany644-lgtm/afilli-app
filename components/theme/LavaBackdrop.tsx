import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Svg, { Defs, LinearGradient, RadialGradient, Path, Rect, Stop, Ellipse } from 'react-native-svg';
import Animated, { cancelAnimation, Easing, interpolate, useAnimatedStyle, useSharedValue, withRepeat, withTiming, type SharedValue } from 'react-native-reanimated';
import colors from '@/constants/colors';
import { useAppearance } from '@/context/AppearanceContext';

const L = colors.lava;

/** Bounded animation clock: one shared value per layer, paused off-screen / background / reduced motion. */
function useLoop(ms: number, run: boolean) {
  const v = useSharedValue(0);
  useEffect(() => {
    if (!run) { cancelAnimation(v); return; }
    v.value = 0;
    v.value = withRepeat(withTiming(1, { duration: ms, easing: Easing.inOut(Easing.sin) }), -1, true);
    return () => cancelAnimation(v);
  }, [run, ms, v]);
  return v;
}

function Flame({ x, w, h, delay, t, flip, opacity }: { x: number; w: number; h: number; delay: number; t: SharedValue<number>; flip?: boolean; opacity: number }) {
  const s = useAnimatedStyle(() => {
    const p = (t.value + delay) % 1;
    return {
      opacity: opacity * interpolate(p, [0, 0.5, 1], [0.7, 1, 0.75]),
      transform: [
        { translateY: interpolate(p, [0, 1], [8, -10]) },
        { scaleY: interpolate(p, [0, 0.5, 1], [0.92, 1.08, 0.95]) },
        { scaleX: (flip ? -1 : 1) * interpolate(p, [0, 1], [1.02, 0.94]) },
      ],
    };
  });
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: x, bottom: -10, width: w, height: h }, s]}>
      <Svg width={w} height={h} viewBox="0 0 100 200">
        <Defs>
          <LinearGradient id="fl" x1="0" y1="1" x2="0" y2="0">
            <Stop offset="0" stopColor={L.core} stopOpacity="0.95" />
            <Stop offset="0.35" stopColor={L.flame} stopOpacity="0.85" />
            <Stop offset="0.75" stopColor={L.ember} stopOpacity="0.45" />
            <Stop offset="1" stopColor={L.ember} stopOpacity="0" />
          </LinearGradient>
        </Defs>
        <Path d="M50 200 C10 170 18 130 34 104 C46 84 30 60 44 22 C52 54 70 64 66 92 C80 80 78 58 74 42 C96 74 98 128 84 160 C76 182 64 196 50 200 Z" fill="url(#fl)" />
        <Path d="M50 200 C32 182 34 158 44 138 C50 126 46 112 52 96 C60 116 72 132 64 160 C60 180 56 194 50 200 Z" fill={L.core} opacity={0.55} />
      </Svg>
    </Animated.View>
  );
}

function Ember({ x, y, size, delay, t }: { x: number; y: number; size: number; delay: number; t: SharedValue<number> }) {
  const s = useAnimatedStyle(() => {
    const p = (t.value * 2 + delay) % 1;
    return { opacity: interpolate(p, [0, 0.2, 0.8, 1], [0, 1, 0.7, 0]), transform: [{ translateY: -p * 140 }, { translateX: Math.sin(p * 6.28 + delay * 9) * 10 }] };
  });
  return <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: x, top: y, width: size, height: size, borderRadius: size, backgroundColor: L.spark }, s]} />;
}

/**
 * Molten lava backdrop. Pure layered SVG + reanimated transforms/opacity:
 * a fixed lava-vein field, slow parallax glow, a few bounded flame tongues and embers.
 * `scrollY` (optional) drives gentle parallax.
 */
export function LavaBackdrop({ scrollY, still }: { scrollY?: SharedValue<number>; still?: boolean }) {
  const { width, height } = useWindowDimensions();
  const { active, reduceMotion, lowPower } = useAppearance();
  // Only the focused, visible route animates; stacked/unfocused screens freeze.
  const [focused, setFocused] = useState(false);
  useFocusEffect(useCallback(() => { setFocused(true); return () => setFocused(false); }, []));
  const run = !still && focused && active && !reduceMotion;
  const slow = lowPower === true ? 2.4 : 1;
  const t = useLoop(Math.round(5200 * slow), run);
  const g = useLoop(Math.round(9000 * slow), run);
  const emberCount = lowPower ? 6 : 14;

  const embers = useMemo(() => Array.from({ length: emberCount }, (_, i) => ({
    x: ((i * 73) % 97) / 97 * width, y: height * (0.35 + ((i * 41) % 60) / 100), size: 2 + (i % 3), delay: (i * 0.137) % 1,
  })), [emberCount, width, height]);

  const veins = useAnimatedStyle(() => ({
    transform: [{ translateY: scrollY ? -Math.min(scrollY.value, 3000) * 0.12 : 0 }, { scale: 1.08 }],
    opacity: interpolate(g.value, [0, 1], [0.78, 1]),
  }));
  const fire = useAnimatedStyle(() => ({ transform: [{ translateY: scrollY ? Math.min(scrollY.value, 3000) * 0.04 : 0 }] }));

  const H = height * 1.6;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: L.bg, overflow: 'hidden' }]}>
      <Animated.View style={[{ position: 'absolute', left: 0, top: 0, width, height: H }, veins]}>
        <Svg width={width} height={H} viewBox={`0 0 400 ${Math.round(400 * H / width)}`} preserveAspectRatio="none">
          <Defs>
            <RadialGradient id="pool" cx="0.5" cy="0.5" r="0.5">
              <Stop offset="0" stopColor={L.flame} stopOpacity="0.55" />
              <Stop offset="1" stopColor={L.ember} stopOpacity="0" />
            </RadialGradient>
          </Defs>
          <Rect x="0" y="0" width="400" height="4000" fill={L.bg} />
          <Ellipse cx="210" cy="180" rx="160" ry="120" fill="url(#pool)" />
          <Ellipse cx="160" cy="560" rx="150" ry="140" fill="url(#pool)" />
          <Ellipse cx="240" cy="980" rx="170" ry="130" fill="url(#pool)" />
          {[
            'M180 -20 C230 80 150 160 210 260 C260 340 160 420 190 520 C220 620 140 700 200 820 C250 920 170 1020 220 1140',
            'M-10 300 C60 280 100 330 160 310 C220 290 260 340 330 320 C370 310 390 330 420 320',
            'M40 640 C90 600 130 680 190 640 C240 610 290 690 360 650',
            'M300 0 C280 90 340 140 310 230 C290 300 350 360 330 440',
            'M20 900 C80 860 120 940 200 900 C260 870 320 930 410 890',
          ].map((d, i) => (
            <React.Fragment key={i}>
              <Path d={d} stroke={L.ember} strokeWidth={i === 0 ? 34 : 16} strokeOpacity={0.35} fill="none" strokeLinecap="round" />
              <Path d={d} stroke={L.flame} strokeWidth={i === 0 ? 12 : 5} strokeOpacity={0.85} fill="none" strokeLinecap="round" />
              <Path d={d} stroke={L.core} strokeWidth={i === 0 ? 3 : 1.4} strokeOpacity={0.9} fill="none" strokeLinecap="round" />
            </React.Fragment>
          ))}
        </Svg>
      </Animated.View>
      {still ? null : <Animated.View style={[StyleSheet.absoluteFill, fire]}>
        <Flame x={width * 0.62} w={width * 0.5} h={height * 0.55} delay={0} t={t} opacity={0.75} />
        <Flame x={-width * 0.12} w={width * 0.38} h={height * 0.38} delay={0.4} t={t} flip opacity={0.55} />
        <Flame x={width * 0.3} w={width * 0.3} h={height * 0.26} delay={0.7} t={t} opacity={0.45} />
        {!lowPower ? <Flame x={width * 0.8} w={width * 0.3} h={height * 0.3} delay={0.25} t={g} flip opacity={0.6} /> : null}
        {run ? embers.map((e, i) => <Ember key={i} {...e} t={g} />) : null}
      </Animated.View>}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: L.scrim }]} />
    </View>
  );
}

/** Subtle flame reflection under a cover's lower edge. */
export function CoverGlow({ w }: { w: number }) {
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 22, borderBottomLeftRadius: 6, borderBottomRightRadius: 6, overflow: 'hidden' }}>
      <Svg width={w} height={22}>
        <Defs>
          <LinearGradient id="cg" x1="0" y1="1" x2="0" y2="0">
            <Stop offset="0" stopColor={L.flame} stopOpacity="0.55" />
            <Stop offset="1" stopColor={L.ember} stopOpacity="0" />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width={w} height={22} fill="url(#cg)" />
      </Svg>
    </View>
  );
}
