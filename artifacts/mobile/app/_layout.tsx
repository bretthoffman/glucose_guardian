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
import { Platform } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { GlucoseProvider } from "@/context/GlucoseContext";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import {
  registerNotificationCategories,
  handleNotificationResponse,
} from "@/services/notifications";

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

function RootLayoutNav() {
  const { isLoggedIn, isLoading, isSignedIn, caregiverSession, doctorSession, alertPrefs } = useAuth();
  const segments = useSegments();
  const notificationListener = useRef<Notifications.EventSubscription | null>(null);
  const responseListener = useRef<Notifications.EventSubscription | null>(null);
  const permissionsRequested = useRef(false);
  const lastHandledNotifId = useRef<string | null>(null);
  const isWeb = Platform.OS === "web";

  useEffect(() => {
    if (isWeb || !isLoggedIn) return;
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    // Handles cold-start taps: app was killed, user tapped notification, app opened.
    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (cancelled || !response) return;
      const notifId = response.notification.request.identifier;
      if (lastHandledNotifId.current === notifId) return;
      lastHandledNotifId.current = notifId;
      timeoutId = setTimeout(() => handleNotificationResponse(response), 300);
    });

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [isLoggedIn, isWeb]);

  useEffect(() => {
    if (isLoading) return;

    const inAuth = segments[0] === "auth";
    const inOnboarding = segments[0] === "onboarding";

    if (!isSignedIn && !caregiverSession && !doctorSession && !inAuth) {
      router.replace("/auth");
    } else if (isSignedIn && !isLoggedIn && !inOnboarding) {
      router.replace("/onboarding");
    } else if ((isSignedIn || caregiverSession || doctorSession) && isLoggedIn && (inAuth || inOnboarding)) {
      router.replace("/(tabs)");
    }
  }, [isSignedIn, isLoggedIn, isLoading, caregiverSession, doctorSession, segments]);

  useEffect(() => {
    if (isWeb || !isLoggedIn || permissionsRequested.current) return;
    permissionsRequested.current = true;

    (async () => {
      await registerNotificationCategories();
    })();

    notificationListener.current = Notifications.addNotificationReceivedListener(
      (_notification) => {}
    );

    // Handles foreground and background taps (app already running)
    responseListener.current = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const notifId = response.notification.request.identifier;
        if (lastHandledNotifId.current === notifId) return;
        lastHandledNotifId.current = notifId;
        handleNotificationResponse(response);
      }
    );

    return () => {
      notificationListener.current?.remove();
      responseListener.current?.remove();
    };
  }, [isLoggedIn, alertPrefs.notificationsEnabled, isWeb]);

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
