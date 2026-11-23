import { Platform, ScrollView, ScrollViewProps } from 'react-native';
import {
  KeyboardAwareScrollView,
  KeyboardAwareScrollViewProps,
} from 'react-native-keyboard-controller';

export type ScrollViewHandle = {
  scrollTo: (options: { x?: number; y?: number; animated?: boolean }) => void;
};
type Props = KeyboardAwareScrollViewProps & ScrollViewProps & {
  onScrollReady?: (handle: ScrollViewHandle | null) => void;
};

export function KeyboardAwareScrollViewCompat({
  children,
  keyboardShouldPersistTaps = 'handled',
  onScrollReady,
  ...props
}: Props) {
  if (Platform.OS === 'web') {
    return (
      <ScrollView
        ref={onScrollReady}
        keyboardShouldPersistTaps={keyboardShouldPersistTaps}
        {...props}
      >
        {children}
      </ScrollView>
    );
  }
  return (
    <KeyboardAwareScrollView
      ref={onScrollReady}
      keyboardShouldPersistTaps={keyboardShouldPersistTaps}
      {...props}
    >
      {children}
    </KeyboardAwareScrollView>
  );
}
