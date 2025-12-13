import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  SectionList,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { TouchableOpacity } from 'react-native';
import { LinearGradient } from "expo-linear-gradient";
import { useTheme } from "../components/ThemeContext";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';

const DEFAULT_RENDER_BACKEND_URL = "https://childtrack-backend.onrender.com";
const BACKEND_URL = DEFAULT_RENDER_BACKEND_URL.replace(/\/$/, "");

// Configure how notifications are handled when the app is in foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

const NotificationsScreen = ({ navigation }) => {
  const { darkModeEnabled } = useTheme();
  const isDark = darkModeEnabled;

  const [sections, setSections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [readIds, setReadIds] = useState(new Set());
  const [expoPushToken, setExpoPushToken] = useState('');
  const [permissionStatus, setPermissionStatus] = useState('undetermined');
  
  const notificationListener = useRef();
  const responseListener = useRef();

  const USE_SINGLE_COLOR_NOTIF = false;
  const SINGLE_COLOR_NOTIF = '#3498db';
  const NOTIF_PALETTE = ['#e74c3c','#27ae60','#3498db','#9b59b6','#f39c12','#2ecc71'];

  const hashStringToInt = (str) => {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h;
  };

  const mulberry32 = (a) => {
    return function() {
      var t = a += 0x6D2B79F5;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
  };

  const pickColorForNotif = (key) => {
    if (USE_SINGLE_COLOR_NOTIF) return SINGLE_COLOR_NOTIF;
    const seededKey = `notif:${String(key || '')}`;
    const seed = Math.abs(hashStringToInt(seededKey));
    const rnd = mulberry32(seed)();
    const idx = Math.floor(rnd * NOTIF_PALETTE.length);
    return NOTIF_PALETTE[idx];
  };

  const READ_IDS_KEY = 'read_notifications';

  // Request notification permissions
  const registerForPushNotificationsAsync = async () => {
    let token;

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#FF231F7C',
      });
    }

    if (Device.isDevice) {
      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;
      setPermissionStatus(existingStatus);

      if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
        setPermissionStatus(status);
      }

      if (finalStatus !== 'granted') {
        Alert.alert(
          'Permission Required',
          'Please enable notifications in your device settings to receive important updates about your child.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open Settings', onPress: () => Notifications.getPermissionsAsync() }
          ]
        );
        return;
      }

      try {
        const projectId = Constants?.expoConfig?.extra?.eas?.projectId ?? Constants?.easConfig?.projectId;
        if (!projectId) {
          console.warn('Project ID not found');
        }
        token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
        console.log('Push token:', token);
        setExpoPushToken(token);
        
        // Save token to backend
        await savePushTokenToBackend(token);
      } catch (e) {
        console.error('Error getting push token:', e);
      }
    } else {
      Alert.alert('Error', 'Must use physical device for Push Notifications');
    }

    return token;
  };

  // Save push token to your backend
  const savePushTokenToBackend = async (token) => {
    try {
      const authToken = await AsyncStorage.getItem('token');
      const parentRaw = await AsyncStorage.getItem("parent");
      
      if (!authToken || !parentRaw) return;
      
      const parent = JSON.parse(parentRaw);
      
      const response = await fetch(`${BACKEND_URL}/api/parents/${parent.id}/push-token/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Token ${authToken}`,
        },
        body: JSON.stringify({
          push_token: token,
          device_type: Platform.OS,
        }),
      });

      if (response.ok) {
        console.log('Push token saved to backend');
      }
    } catch (error) {
      console.error('Error saving push token:', error);
    }
  };

  const isSameDay = (d1, d2) => {
    if (!d1 || !d2) return false;
    return d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth() && d1.getDate() === d2.getDate();
  };

  const isToday = (date) => {
    if (!date) return false;
    const today = new Date();
    return isSameDay(date, today);
  };

  const fetchNotificationsFromAPI = async () => {
    const parentRaw = await AsyncStorage.getItem("parent");
    let query = "";
    if (parentRaw) {
      try {
        const parent = JSON.parse(parentRaw);
        if (parent && parent.id) {
          query = `?parent=${encodeURIComponent(parent.id)}`;
        }
      } catch (err) {
        console.warn("Failed to parse parent cache", err);
      }
    }

    const url = `${BACKEND_URL}/api/parents/notifications/${query}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Network response not ok');
    const data = await res.json();
    const serverItems = Array.isArray(data) ? data : (Array.isArray(data.results) ? data.results : (Array.isArray(data.value) ? data.value : []));
    const TYPE_LABELS = { attendance: 'Attendance', pickup: 'Pickup', event: 'Event', other: 'Other' };

    const mappedServer = (serverItems || []).map((n) => ({
      id: String(n.id),
      type: n.type,
      typeLabel: TYPE_LABELS[n.type] || (n.type ? String(n.type).charAt(0).toUpperCase() + String(n.type).slice(1) : 'Other'),
      message: n.message || (n.extra_data && JSON.stringify(n.extra_data)) || '',
      time: (n.created_at || n.timestamp) ? new Date(n.created_at || n.timestamp).toLocaleString() : '',
      timestamp: (n.created_at || n.timestamp) ? new Date(n.created_at || n.timestamp) : new Date(),
      icon: (n.type === 'attendance' ? 'people' : n.type === 'pickup' ? 'person-circle-outline' : (n.type === 'event' ? 'calendar' : 'notifications-outline')),
      color: pickColorForNotif(n.id || n.type),
      raw: n,
      read: !!n.read,
      source: 'parent',
    }));

    // Fetch attendance records
    let attendanceItems = [];
    try {
      const attendResp = await fetch(`${BACKEND_URL}/api/attendance/public/`);
      if (attendResp.ok) {
        let attendData = await attendResp.json();
        attendData = Array.isArray(attendData) ? attendData : (Array.isArray(attendData.results) ? attendData.results : []);
        
        let storedParent = null;
        try { storedParent = parentRaw ? JSON.parse(parentRaw) : null; } catch (e) { storedParent = null; }
        const myStudentName = storedParent?.student_name?.trim().toLowerCase() || null;
        const myStudentLrn = storedParent?.student_lrn || storedParent?.student || null;

        const filtered = (attendData || []).filter(a => {
          if (!a) return false;
          const recName = (a.student_name || '').trim().toLowerCase();
          const recLrn = (a.student_lrn || '').toString();
          if (myStudentLrn && recLrn && String(myStudentLrn) === recLrn) return true;
          if (myStudentName && recName && myStudentName === recName) return true;
          return false;
        });

        const today = new Date();
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        
        const recentMatches = (filtered || []).filter(it => {
          const rawDate = it.date || it.timestamp || it.created_at;
          if (!rawDate) return false;
          const recDate = new Date(rawDate);
          if (Number.isNaN(recDate.getTime())) return false;
          const status = (it.status || '').toString().toLowerCase().trim().replace(/[\s_-]/g, '');
          const isValidStatus = (status === 'present' || status === 'pickup' || status === 'dropoff');
          const isRecentDate = isSameDay(recDate, today) || isSameDay(recDate, yesterday);
          return isValidStatus && isRecentDate;
        });

        attendanceItems = (recentMatches || []).map(it => {
          const status = (it.status || '').toString().toLowerCase().trim().replace(/[\s_-]/g, '');
          let message = 'Your child is in the classroom';
          let icon = 'people';
          let color = '#27ae60';
          
          if (status === 'pickup') {
            message = 'Your child has been picked up';
            icon = 'log-out-outline';
            color = '#3498db';
          } else if (status === 'dropoff') {
            message = 'Your child is in the classroom';
            icon = 'people';
            color = '#27ae60';
          }

          const itemDate = it.date || it.timestamp || it.created_at;
          return {
            id: `attendance-${it.id}`,
            type: 'attendance',
            typeLabel: 'Attendance',
            message: message,
            time: itemDate ? new Date(itemDate).toLocaleString() : '',
            timestamp: itemDate ? new Date(itemDate) : new Date(),
            icon: icon,
            color: color,
            raw: it,
            read: false,
            source: 'attendance',
          };
        });
      }
    } catch (e) {
      console.warn('[Notifications] attendance fetch failed', e);
    }

    // Fetch events
    let eventItems = [];
    try {
      let storedParentForEvents = null;
      try { storedParentForEvents = parentRaw ? JSON.parse(parentRaw) : null; } catch (e) { storedParentForEvents = null; }
      const section = storedParentForEvents?.student_section || storedParentForEvents?.student?.section || null;
      const eventsQuery = section ? `${BACKEND_URL}/api/parents/events/?section=${encodeURIComponent(section)}` : `${BACKEND_URL}/api/parents/events/`;
      const eventsResp = await fetch(eventsQuery);
      if (eventsResp.ok) {
        let eventsData = await eventsResp.json();
        eventsData = Array.isArray(eventsData) ? eventsData : (Array.isArray(eventsData.results) ? eventsData.results : []);
        const now = new Date();
        const cutoff = new Date();
        cutoff.setDate(now.getDate() + 7);

        const upcoming = (eventsData || []).filter(ev => {
          const raw = ev.scheduled_at || ev.timestamp || ev.date;
          if (!raw) return false;
          const d = new Date(raw);
          if (Number.isNaN(d.getTime())) return false;
          return isSameDay(d, now) || (d >= now && d <= cutoff);
        });

        eventItems = (upcoming || []).map(ev => {
          const eventDate = ev.scheduled_at || ev.timestamp || ev.date;
          return {
            id: `event-${ev.id}`,
            type: 'event',
            typeLabel: 'Event',
            subType: ev.event_type || '',
            message: ev.event_type || ev.title || 'Event',
            time: eventDate ? new Date(eventDate).toLocaleString() : '',
            timestamp: eventDate ? new Date(eventDate) : new Date(),
            icon: 'calendar',
            color: '#3498db',
            raw: ev,
            read: false,
            source: 'event',
          };
        });
      }
    } catch (e) {
      console.warn('[Notifications] events fetch failed', e);
    }

    // Fetch unregistered guardians
    let unregisteredItems = [];
    try {
      const guardiansResp = await fetch(`${BACKEND_URL}/api/guardian/public/`);
      if (guardiansResp.ok) {
        let guardiansData = await guardiansResp.json();
        guardiansData = Array.isArray(guardiansData) ? guardiansData : (Array.isArray(guardiansData.results) ? guardiansData.results : (Array.isArray(guardiansData.value) ? guardiansData.value : []));

        let storedParentForGuardians = null;
        try { storedParentForGuardians = parentRaw ? JSON.parse(parentRaw) : null; } catch (e) { storedParentForGuardians = null; }
        const myStudentName = storedParentForGuardians?.student_name?.trim().toLowerCase() || null;
        const myStudentLrn = storedParentForGuardians?.student_lrn || storedParentForGuardians?.student || null;

        const matched = (guardiansData || []).filter(g => {
          if (!g) return false;
          const status = (g.status || '').toString().toLowerCase();
          if (status !== 'pending' && status !== 'unregistered') return false;
          const recName = (g.student_name || '').trim().toLowerCase();
          const recLrn = (g.student_lrn || '').toString();
          if (myStudentLrn && recLrn && String(myStudentLrn) === recLrn) return true;
          if (myStudentName && recName && myStudentName === recName) return true;
          return false;
        });

        unregisteredItems = (matched || []).map(u => {
          const guardianDate = u.created_at || u.timestamp;
          return {
            id: `unregistered-${u.id}`,
            type: 'unregistered',
            typeLabel: 'Unregistered',
            message: (u.name || u.guardian_name || u.username || 'Unregistered guardian') + (u.student_name ? ` for ${u.student_name}` : ''),
            time: guardianDate ? new Date(guardianDate).toLocaleString() : '',
            timestamp: guardianDate ? new Date(guardianDate) : new Date(),
            icon: 'close-circle',
            color: '#e74c3c',
            raw: u,
            read: false,
            source: 'guardian',
          };
        });
      }
    } catch (e) {
      console.warn('[Notifications] guardian fetch failed', e);
    }

    const combined = [...mappedServer, ...attendanceItems, ...eventItems, ...unregisteredItems];
    const seen = new Map();
    combined.forEach(it => { if (!seen.has(it.id)) seen.set(it.id, it); });
    return Array.from(seen.values());
  };

  const groupNotificationsByDate = (notifications) => {
    const today = [];
    const earlier = [];

    notifications.forEach(notif => {
      if (isToday(notif.timestamp)) {
        today.push(notif);
      } else {
        earlier.push(notif);
      }
    });

    today.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    earlier.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    const sections = [];
    if (today.length > 0) {
      sections.push({ title: 'Today', data: today });
    }
    if (earlier.length > 0) {
      sections.push({ title: 'Earlier', data: earlier });
    }

    return sections;
  };

  useEffect(() => {
    let mounted = true;
    
    // Request notification permissions
    registerForPushNotificationsAsync();

    // Load notifications
    (async () => {
      try {
        const items = await fetchNotificationsFromAPI();
        const serverReadIds = items.filter(it => it.read).map(it => String(it.id));
        const storedReadRaw = await AsyncStorage.getItem(READ_IDS_KEY);
        const storedRead = storedReadRaw ? JSON.parse(storedReadRaw) : [];
        const fallbackReadIds = Array.isArray(storedRead) ? storedRead.map(String) : [];
        const combinedRead = new Set([...serverReadIds, ...fallbackReadIds]);
        if (!mounted) return;
        setReadIds(combinedRead);
        const groupedSections = groupNotificationsByDate(items);
        setSections(groupedSections);
      } catch (err) {
        console.warn('Failed to load notifications:', err.message || err);
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    // Notification listeners
    notificationListener.current = Notifications.addNotificationReceivedListener(notification => {
      console.log('Notification received:', notification);
      // Refresh notifications when a new one arrives
      onRefresh();
    });

    responseListener.current = Notifications.addNotificationResponseReceivedListener(response => {
      console.log('Notification tapped:', response);
      const data = response.notification.request.content.data;
      // Handle notification tap - navigate to relevant screen
      if (data?.event_id) {
        navigation.navigate('event', { id: data.event_id });
      }
    });

    return () => {
      mounted = false;
      if (notificationListener.current) {
        Notifications.removeNotificationSubscription(notificationListener.current);
      }
      if (responseListener.current) {
        Notifications.removeNotificationSubscription(responseListener.current);
      }
    };
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      const items = await fetchNotificationsFromAPI();
      const groupedSections = groupNotificationsByDate(items);
      setSections(groupedSections);
    } catch (err) {
      console.warn('Refresh failed:', err);
    } finally {
      setRefreshing(false);
    }
  };

  const saveReadIds = async (setObj) => {
    try {
      const arr = Array.from(setObj);
      await AsyncStorage.setItem(READ_IDS_KEY, JSON.stringify(arr));
    } catch (e) {
      console.warn('Failed saving read ids', e);
    }
  };

  const markAsRead = async (id) => {
    try {
      const sid = String(id);
      if (readIds.has(sid)) return;
      const next = new Set(readIds);
      next.add(sid);
      setReadIds(next);
      await saveReadIds(next);
      try {
        const token = await AsyncStorage.getItem('token');
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers.Authorization = `Token ${token}`;
        const resp = await fetch(`${BACKEND_URL}/api/parents/notifications/${sid}/`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ read: true }),
        });
        if (resp.ok) {
          setSections((prevSections) =>
            prevSections.map(section => ({
              ...section,
              data: section.data.map(it => (String(it.id) === sid ? { ...it, read: true } : it))
            }))
          );
        }
      } catch (e) {
        console.warn('Failed to persist read to server', e);
      }
    } catch (e) {
      console.warn('markAsRead error', e);
    }
  };

  const renderItem = ({ item }) => (
    <TouchableOpacity onPress={() => handlePressNotification(item)} activeOpacity={0.8}>
      <LinearGradient
        colors={isDark ? ["#1e1e1e", "#121212"] : ["#ffffff", "#f4f6f9"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.card}
      >
        <Ionicons
          name={item.icon}
          size={32}
          color={item.color}
          style={styles.icon}
        />
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
            <View style={[styles.badge, { backgroundColor: item.color }]}>
              <Text style={styles.badgeText}>{item.typeLabel}</Text>
            </View>
            {item.type !== 'event' && item.subType ? (
              <Text style={[styles.subBadgeText, { color: isDark ? '#cbd5e0' : '#666', marginLeft: 8 }]}>{item.subType}</Text>
            ) : null}
          </View>

          <Text style={[styles.message, { color: isDark ? "#fff" : "#333", fontWeight: readIds.has(String(item.id)) ? '400' : '700' }]}> 
            {item.message}
          </Text>
          <Text style={[styles.time, { color: isDark ? "#bbb" : "#777" }]}>{item.time}</Text>
        </View>
        {!readIds.has(String(item.id)) ? (
          <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: '#e74c3c', marginLeft: 8 }} />
        ) : null}
      </LinearGradient>
    </TouchableOpacity>
  );

  const renderSectionHeader = ({ section: { title } }) => (
    <View style={[styles.sectionHeader, { backgroundColor: isDark ? '#0b0f19' : '#f5f5f5' }]}>
      <Text style={[styles.sectionHeaderText, { color: isDark ? '#a0aec0' : '#666' }]}>
        {title}
      </Text>
    </View>
  );

  const handlePressNotification = async (item) => {
    await markAsRead(item.id);
    const raw = item.raw || {};
    try {
      const extra = raw.extra_data || (raw.extra_data === null ? null : raw.extra_data);
      if (extra && typeof extra === 'object') {
        if (extra.event_id) {
          navigation.navigate('event', { id: extra.event_id });
          return;
        }
      }
    } catch (e) {
      // ignore
    }
  };

  const getTotalUnreadCount = () => {
    let total = 0;
    sections.forEach(section => {
      section.data.forEach(item => {
        if (!readIds.has(String(item.id))) {
          total++;
        }
      });
    });
    return total;
  };

  // Show permission status indicator
  const renderPermissionBanner = () => {
    if (permissionStatus === 'granted') return null;
    
    return (
      <TouchableOpacity 
        style={[styles.permissionBanner, { backgroundColor: isDark ? '#2d3748' : '#fff3cd' }]}
        onPress={registerForPushNotificationsAsync}
      >
        <Ionicons name="notifications-off" size={20} color="#856404" style={{ marginRight: 8 }} />
        <Text style={[styles.permissionText, { color: isDark ? '#ffd700' : '#856404' }]}>
          Enable notifications to stay updated
        </Text>
        <Ionicons name="chevron-forward" size={20} color="#856404" />
      </TouchableOpacity>
    );
  };

  return (
    <LinearGradient
      colors={isDark ? ['#0b0f19', '#1a1f2b'] : ['#f5f5f5', '#e0e0e0']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.container}
    >
      <View style={styles.header}>
        <Ionicons
          name="arrow-back"
          size={24}
          color={isDark ? "#fff" : "#333"}
          onPress={() => {
            if (navigation.canGoBack && navigation.canGoBack()) {
              navigation.goBack();
            } else {
              navigation.navigate('home');
            }
          }}
        />
        <Text style={[styles.headerTitle, { color: isDark ? "#fff" : "#333" }]}>
          Notifications
        </Text>
        {getTotalUnreadCount() > 0 ? (
          <View style={{ marginLeft: 8, backgroundColor: '#e74c3c', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12 }}>
            <Text style={{ color: '#fff', fontWeight: '700' }}>{getTotalUnreadCount()}</Text>
          </View>
        ) : null}
      </View>

      {renderPermissionBanner()}

      {loading ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" color={isDark ? '#fff' : '#333'} />
        </View>
      ) : (
        <SectionList
          sections={sections}
          renderItem={renderItem}
          renderSectionHeader={renderSectionHeader}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16 }}
          showsVerticalScrollIndicator={false}
          style={{ flex: 1 }}
          stickySectionHeadersEnabled={true}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={() => (
            <View style={{ padding: 20, alignItems: 'center' }}>
              <Text style={{ color: isDark ? '#fff' : '#333' }}>No notifications</Text>
            </View>
          )}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={isDark ? '#fff' : '#333'}
              colors={[isDark ? '#fff' : '#333']}
              progressBackgroundColor={isDark ? '#111' : '#fff'}
            />
          }
        />
      )}
    </LinearGradient>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#ddd",
    marginTop: 40,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "700",
    marginLeft: 12,
  },
  permissionBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    marginHorizontal: 16,
    marginTop: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ffeaa7',
  },
  permissionText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
  },
  sectionHeader: {
    paddingVertical: 12,
    paddingTop: 20,
  },
  sectionHeaderText: {
    fontSize: 14,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    elevation: 3,
  },
  icon: {
    marginRight: 12,
  },
  message: {
    fontSize: 15,
    fontWeight: "500",
    marginBottom: 4,
  },
  time: {
    fontSize: 12,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    alignSelf: 'flex-start',
  },
  badgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  subBadgeText: {
    fontSize: 12,
  },
});

export default NotificationsScreen;