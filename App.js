import { StatusBar } from "expo-status-bar";
import { StyleSheet } from "react-native";
import { NavigationContainer, DefaultTheme, DarkTheme, createNavigationContainerRef } from "@react-navigation/native";
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useColorScheme } from "react-native";
import { useEffect, useRef } from "react";
import Loading from "./screens/loading";
import Login from './screens/login';
import FPass from './screens/forgotpassword';
import Home from './screens/home';
import Event from './screens/event';
import Attendance from './screens/attendance';
import Schedule from './screens/schedule';
import Unregistered from './screens/unregistered';
import Authorized from './screens/authorized';
import Unauthorized from './screens/unauthorized';
import Notification from './screens/notification';
import Setting from './screens/setting';
import { ThemeProvider } from "./components/ThemeContext";
import Profile from './screens/profile';
import ChangePass from './screens/changepass';
import NotificationService from './services/NotificationService';

const Stack = createNativeStackNavigator();
const navigationRef = createNavigationContainerRef();

const IGNORE_ROUTES = ['loading', 'login'];
const NOTIFICATIONS_ENABLED_KEY = 'notifications_enabled';

export default function App() {
  const scheme = useColorScheme();
  const isInitialized = useRef(false);

  useEffect(() => {
    const initNotifications = async () => {
      if (isInitialized.current) return;
      isInitialized.current = true;

      try {
        // Check if user has enabled notifications in settings
        const notificationsEnabled = await AsyncStorage.getItem(NOTIFICATIONS_ENABLED_KEY);
        
        if (notificationsEnabled === 'true') {
          console.log('[App] User has enabled notifications - initializing service...');
          const success = await NotificationService.initialize();
          
          if (success) {
            console.log('[App] ✅ Notification service initialized successfully');
            
            if (navigationRef.isReady()) {
              NotificationService.setupListeners(navigationRef);
              console.log('[App] ✅ Navigation listeners set up');
            }
          } else {
            console.warn('[App] ⚠️ Notification service initialization failed');
          }
        } else {
          console.log('[App] Notifications disabled by user - skipping initialization');
        }
      } catch (error) {
        console.error('[App] ❌ Error checking notification preferences:', error);
      }
    };

    initNotifications();

    return () => {
      console.log('[App] Cleaning up notification service...');
      NotificationService.removeListeners();
    };
  }, []);

  const onReady = async () => {
    if (isInitialized.current && navigationRef.isReady()) {
      try {
        const notificationsEnabled = await AsyncStorage.getItem(NOTIFICATIONS_ENABLED_KEY);
        if (notificationsEnabled === 'true') {
          NotificationService.setupListeners(navigationRef);
          console.log('[App] Navigation ready - listeners set up');
        }
      } catch (error) {
        console.error('[App] Error setting up listeners on ready:', error);
      }
    }
  };

  return (
    <ThemeProvider>
      <NavigationContainer
        ref={navigationRef}
        onReady={onReady}
        onStateChange={async () => {
          try {
            if (!navigationRef.isReady()) return;
            const route = navigationRef.getCurrentRoute();
            if (route && route.name && !IGNORE_ROUTES.includes(route.name)) {
              await AsyncStorage.setItem('lastRoute', route.name);
            }
          } catch (e) {
            console.warn('[App] Failed to save last route:', e);
          }
        }}
        theme={scheme === "dark" ? DarkTheme : DefaultTheme}
      >
        <StatusBar style={scheme === "dark" ? "light" : "dark"} />
        <Stack.Navigator
          initialRouteName="loading"
          screenOptions={{ headerShown: false }}
        >
          <Stack.Screen name="loading" component={Loading} />
          <Stack.Screen name="login" component={Login} />
          <Stack.Screen name="fpass" component={FPass} />
          <Stack.Screen name="home" component={Home} />
          <Stack.Screen name="event" component={Event} />
          <Stack.Screen name="attendance" component={Attendance} />
          <Stack.Screen name="schedule" component={Schedule} />
          <Stack.Screen name="unregistered" component={Unregistered} />
          <Stack.Screen name="authorized" component={Authorized} />
          <Stack.Screen name="unauthorized" component={Unauthorized} />
          <Stack.Screen name="notification" component={Notification} />
          <Stack.Screen name="setting" component={Setting} />
          <Stack.Screen name="profile" component={Profile} />
          <Stack.Screen name="changepass" component={ChangePass} />
        </Stack.Navigator>
      </NavigationContainer>
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});