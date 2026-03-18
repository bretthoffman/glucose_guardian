import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as Notifications from "expo-notifications";
import { Stack, router, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect, useRef } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { GlucoseProvider } from "@/context/GlucoseContext";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import {
  registerNotificationCategories,
  requestNotificationPermissions,
  handleNotificationResponse,
} from "@/services/notifications";

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

function RootLayoutNav() {
  const { isLoggedIn, isLoading, isSignedIn, caregiverSession, alertPrefs } = useAuth();
  const segments = useSegments();
  const notificationListener = useRef<Notifications.EventSubscription | null>(null);
  const responseListener = useRef<Notifications.EventSubscription | null>(null);
  const permissionsRequested = useRef(false);

  useEffect(() => {
    if (isLoading) return;

    const inAuth = segments[0] === "auth";
    const inOnboarding = segments[0] === "onboarding";

    if (!isSignedIn && !caregiverSession && !inAuth) {
      router.replace("/auth");
    } else if (isSignedIn && !isLoggedIn && !inOnboarding) {
      router.replace("/onboarding");
    } else if ((isSignedIn || caregiverSession) && isLoggedIn && (inAuth || inOnboarding)) {
      router.replace("/(tabs)");
    }
  }, [isSignedIn, isLoggedIn, isLoading, caregiverSession, segments]);

  useEffect(() => {
    if (!isLoggedIn || permissionsRequested.current) return;
    permissionsRequested.current = true;

    (async () => {
      if (alertPrefs.notificationsEnabled) {
        await requestNotificationPermissions();
      }
      await registerNotificationCategories();
    })();

    notificationListener.current = Notifications.addNotificationReceivedListener(
      (_notification) => {}
    );

    responseListener.current = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        handleNotificationResponse(response);
      }
    );

    return () => {
      notificationListener.current?.remove();
      responseListener.current?.remove();
    };
  }, [isLoggedIn, alertPrefs.notificationsEnabled]);

  return (
    <Stack screenOptions={{ headerBackTitle: "Back" }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="auth" options={{ headerShown: false, gestureEnabled: false }} />
      <Stack.Screen name="onboarding" options={{ headerShown: false, gestureEnabled: false }} />
      <Stack.Screen
        name="cgm-setup"
        options={{
          headerShown: true,
          title: "Connect CGM",
          presentation: "modal",
          headerStyle: { backgroundColor: "transparent" },
        }}
      />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    feather: require("@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/Feather.ttf"),
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <GlucoseProvider>
              <GestureHandlerRootView>
                <KeyboardProvider>
                  <RootLayoutNav />
                </KeyboardProvider>
              </GestureHandlerRootView>
            </GlucoseProvider>
          </AuthProvider>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
