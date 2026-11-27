import React, { useEffect } from 'react';
import { SavedBookSync } from '@/components/SavedBookSync';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { ErrorFallback, type ErrorFallbackProps } from '@/components/ErrorFallback';
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, useFonts } from '@expo-google-fonts/inter';
import { GreatVibes_400Regular } from '@expo-google-fonts/great-vibes';
import { PlayfairDisplay_600SemiBold, PlayfairDisplay_700Bold, PlayfairDisplay_400Regular_Italic } from '@expo-google-fonts/playfair-display';
import { Redirect, Stack, usePathname } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { AppProvider } from '@/context/AppContext';
import colors from '@/constants/colors';
import { View } from 'react-native';
import { BottomNavigation } from '@/components/BottomNavigation';
import { MagazineProvider } from '@/context/MagazineContext';
import { AuthProvider } from '@/context/AuthContext';
import { setBaseUrl } from '@workspace/api-client-react';
import { CommunityProvider } from '@/context/CommunityContext';
import { DirectMessagesProvider } from '@/context/DirectMessagesContext';
import { AppearanceProvider, useAppearance } from '@/context/AppearanceContext';
import { useTheme } from '@/hooks/useTheme';
import { isFullscreenChatPath } from '@/lib/fullscreen-chat';
import { useAuth } from '@/context/AuthContext';

const apiDomain = process.env.EXPO_PUBLIC_DOMAIN;
if (apiDomain) setBaseUrl(`https://${apiDomain}`);

SplashScreen.preventAutoHideAsync();
const queryClient = new QueryClient();

function StartupErrorFallback(props: ErrorFallbackProps) {
  return <SafeAreaProvider><ErrorFallback {...props} /></SafeAreaProvider>;
}

function RootLayoutNav() {
  const pathname = usePathname();
  const fullscreenChat = isFullscreenChatPath(pathname);
  const { accessMode } = useAuth();
  const { isLava } = useAppearance();
  const t = useTheme();
  const bg = isLava ? colors.lava.bg : t.light.background;
  const appealPaths = ['/account-restricted', '/account-appeal', '/afilli-rules', '/saved', '/(tabs)/saved'];
  const contactPaths = ['/account-restricted', '/prohibited-image-contact'];
  if (accessMode === 'normal' && pathname === '/account-restricted') return <Redirect href="/" />;
  if (accessMode === 'appeal' && !appealPaths.includes(pathname)) return <Redirect href="/account-restricted" />;
  if (accessMode === 'contact' && !contactPaths.includes(pathname)) return <Redirect href="/account-restricted" />;
  return (
    <View style={{ flex: 1, backgroundColor: bg }}>
      <StatusBar style={t.isDark || (isLava && pathname === '/') ? 'light' : 'dark'} />
      <View style={{ flex: 1, minHeight: 0 }}>
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: bg }, animation: 'slide_from_right' }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="search" options={{ animation: 'fade' }} />
          <Stack.Screen name="account-restricted" />
          <Stack.Screen name="account-appeal" />
          <Stack.Screen name="afilli-rules" />
          <Stack.Screen name="prohibited-image-contact" />
        </Stack>
      </View>
      {/* Full-screen chats (writer chat and private /chat/[id]) hide the five tabs; other screens keep them. */}
      {accessMode === 'normal' ? <SavedBookSync /> : null}
      {accessMode === 'normal' && !fullscreenChat ? <BottomNavigation /> : null}
    </View>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold,
    GreatVibes_400Regular, PlayfairDisplay_600SemiBold, PlayfairDisplay_700Bold, PlayfairDisplay_400Regular_Italic,
  });
  useEffect(() => { if (fontsLoaded || fontError) SplashScreen.hideAsync(); }, [fontsLoaded, fontError]);
  if (!fontsLoaded && !fontError) return null;
  return (
    <ErrorBoundary FallbackComponent={StartupErrorFallback}>
    <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
          <AppearanceProvider>
          <AppProvider>
            <CommunityProvider>
            <DirectMessagesProvider>
            <MagazineProvider>
              <GestureHandlerRootView style={{ flex: 1 }}>
                <KeyboardProvider>
                  <RootLayoutNav />
                </KeyboardProvider>
              </GestureHandlerRootView>
            </MagazineProvider>
            </DirectMessagesProvider>
            </CommunityProvider>
          </AppProvider>
          </AppearanceProvider>
          </AuthProvider>
        </QueryClientProvider>
    </SafeAreaProvider>
    </ErrorBoundary>
  );
}
