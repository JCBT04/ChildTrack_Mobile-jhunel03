import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  Switch,
  TouchableOpacity,
  Alert,
  ScrollView,
  RefreshControl,
  Image,
  ActivityIndicator,
  Modal,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from 'expo-notifications';
import NotificationService from '../services/NotificationService';

const DEFAULT_RENDER_BACKEND_URL = "https://childtrack-backend.onrender.com/";
const BACKEND_URL = DEFAULT_RENDER_BACKEND_URL.replace(/\/$/, "");
import { useTheme } from "../components/ThemeContext";

const NOTIFICATIONS_ENABLED_KEY = 'notifications_enabled';

const Settings = ({ navigation }) => {
  const { darkModeEnabled, setDarkModeEnabled } = useTheme();
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [qrText, setQrText] = useState(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [qrRaw, setQrRaw] = useState(null);
  const [qrNotFound, setQrNotFound] = useState(false);
  const [searchedStudent, setSearchedStudent] = useState(null);
  const [showQrData, setShowQrData] = useState(false);
  const [qrEnlarged, setQrEnlarged] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const isDark = darkModeEnabled;

  let QRCodeSVG = null;
  try {
    QRCodeSVG = require('react-native-qrcode-svg').default;
  } catch (e) {
    QRCodeSVG = null;
  }

  // Load notification preference on mount
  useEffect(() => {
    loadNotificationPreference();
  }, []);

  const loadNotificationPreference = async () => {
    try {
      const saved = await AsyncStorage.getItem(NOTIFICATIONS_ENABLED_KEY);
      if (saved !== null) {
        setNotificationsEnabled(saved === 'true');
      }
    } catch (error) {
      console.error('Error loading notification preference:', error);
    }
  };

  const handleNotificationToggle = async (value) => {
    if (value) {
      // User is trying to turn ON notifications - request permission
      try {
        const { status: existingStatus } = await Notifications.getPermissionsAsync();
        let finalStatus = existingStatus;
        
        if (existingStatus !== 'granted') {
          const { status } = await Notifications.requestPermissionsAsync();
          finalStatus = status;
        }
        
        if (finalStatus !== 'granted') {
          Alert.alert(
            'Permission Required',
            'Please enable notifications in your device settings to receive updates about your child.',
            [{ text: 'OK' }]
          );
          return; // Don't toggle the switch
        }

        // Permission granted - enable notifications
        await AsyncStorage.setItem(NOTIFICATIONS_ENABLED_KEY, 'true');
        setNotificationsEnabled(true);
        
        // Start the notification service
        await NotificationService.initialize();
        console.log('[Settings] Notifications enabled and service started');
        
      } catch (error) {
        console.error('[Settings] Error enabling notifications:', error);
        Alert.alert('Error', 'Failed to enable notifications. Please try again.');
      }
    } else {
      // User is turning OFF notifications
      try {
        await AsyncStorage.setItem(NOTIFICATIONS_ENABLED_KEY, 'false');
        setNotificationsEnabled(false);
        
        // Stop the notification service
        NotificationService.stopPolling();
        console.log('[Settings] Notifications disabled and service stopped');
        
      } catch (error) {
        console.error('[Settings] Error disabling notifications:', error);
      }
    }
  };

  const handleLogout = () => {
    logoutNow();
  };

  const logoutNow = async () => {
    try {
      console.log('logoutNow: removing session keys (preserving username)');
      const keysToRemove = ['lastRoute', 'parent', 'token', 'parents'];
      try {
        await AsyncStorage.multiRemove(keysToRemove);
        console.log('logoutNow: multiRemove succeeded', keysToRemove);
      } catch (mrErr) {
        console.warn('logoutNow: multiRemove failed, falling back to individual removes', mrErr);
        await AsyncStorage.removeItem('lastRoute');
        await AsyncStorage.removeItem('parent');
        await AsyncStorage.removeItem('token');
        await AsyncStorage.removeItem('parents');
      }

      const checkLast = await AsyncStorage.getItem('lastRoute');
      const checkParent = await AsyncStorage.getItem('parent');
      console.log('logoutNow post-remove lastRoute:', checkLast, 'parent:', checkParent);

      if (checkParent) {
        console.warn('logoutNow: parent data still present — clearing all AsyncStorage');
        await AsyncStorage.clear();
      }

      navigation.reset({ index: 0, routes: [{ name: 'login' }] });
      try { navigation.replace && navigation.replace('login'); } catch (e) {}

      console.log('logoutNow: navigated to login');
    } catch (error) {
      console.error('logoutNow Error:', error);
      Alert.alert('Error', 'Something went wrong while logging out.');
    }
  };

  const fetchAttendanceQr = async () => {
    setQrLoading(true);
    try {
      const username = await AsyncStorage.getItem('username');
      const token = await AsyncStorage.getItem('token');
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Token ${token}`;

      const storedParentRaw = await AsyncStorage.getItem('parent');
      if (storedParentRaw) {
        try {
          const p = JSON.parse(storedParentRaw);
          const studentLrn = p.student_lrn || (p.student && p.student.lrn) || null;
          const studentName = p.student_name || (p.student && p.student.name) || null;

          const url = `${BACKEND_URL}/api/attendance/public/`;
          const resp = await fetch(url);
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          const data = await resp.json();
          const list = Array.isArray(data) ? data : (data && data.results ? data.results : []);

          let match = null;
          if (studentLrn) {
            match = list.find(it => (it.student_lrn || it.lrn || '').toString() === studentLrn.toString());
          }
          if (!match && studentName) {
            match = list.find(it => (it.student_name || '').toLowerCase() === (studentName || '').toLowerCase());
          }
          if (!match) {
            console.warn('[Setting] No attendance record matched cached parent', { studentLrn, studentName });
            return { searched: { studentLrn, studentName }, result: null };
          }

          const qr = match.qr_code_data || match.qr_data || null;
          if (!qr) return { searched: { studentLrn, studentName }, result: null };

          const raw = qr.toString();
          try {
            const parsed = JSON.parse(raw);
            const pretty = JSON.stringify(parsed, null, 2);
            return { searched: { studentLrn, studentName }, result: { raw, pretty } };
          } catch (e) {
            return { searched: { studentLrn, studentName }, result: { raw, pretty: raw } };
          }
        } catch (e) {
          console.warn('[Setting] cached parent flow failed', e);
        }
      }

      const extractParentsFromTeachers = (payload) => {
        const teachersArray = Array.isArray(payload)
          ? payload
          : payload && Array.isArray(payload.results)
            ? payload.results
            : [];

        const aggregated = [];
        teachersArray.forEach((teacher) => {
          if (!teacher || typeof teacher !== 'object') return;
          const students = Array.isArray(teacher.students) ? teacher.students : [];
          students.forEach((student) => {
            if (!student || typeof student !== 'object') return;
            const parents = Array.isArray(student.parents_guardians) ? student.parents_guardians : [];
            parents.forEach((parent) => {
              if (parent) aggregated.push(parent);
            });
          });
        });
        return aggregated;
      };

      let fetchedParentRecords = [];
      try {
        const parentsResp = await fetch(`${BACKEND_URL}/api/parents/parents/`, { headers });
        if (!parentsResp.ok) throw new Error(`HTTP ${parentsResp.status}`);
        const parentsData = await parentsResp.json();
        fetchedParentRecords = Array.isArray(parentsData) ? parentsData : (parentsData && parentsData.results ? parentsData.results : []);
      } catch (e) {
        if (token) {
          try {
            const fallbackResp = await fetch(`${BACKEND_URL}/api/parents/all-teachers-students/`, { headers });
            if (fallbackResp.ok) {
              const fallbackData = await fallbackResp.json();
              fetchedParentRecords = extractParentsFromTeachers(fallbackData);
            }
          } catch (fb) {
            console.warn('[Setting] fallback parents fetch failed', fb);
          }
        }
        if (!fetchedParentRecords.length) {
          try {
            const storedParent = await AsyncStorage.getItem('parent');
            if (storedParent) fetchedParentRecords = [JSON.parse(storedParent)];
          } catch (pe) { }
        }
      }

      const parentsList = username ? fetchedParentRecords.filter(p => p.username === username) : fetchedParentRecords;
      const kids = parentsList.filter(p => p && p.student_name).map(p => ({
        lrn: p.student_lrn || '',
        name: p.student_name,
      }));

      let studentLrn = null;
      let studentName = null;
      if (kids.length) {
        studentLrn = kids[0].lrn;
        studentName = kids[0].name;
      } else {
        const parentRaw = await AsyncStorage.getItem('parent');
        if (parentRaw) {
          try {
            const parent = JSON.parse(parentRaw);
            studentLrn = parent.student_lrn || (parent.student && parent.student.lrn) || null;
            studentName = parent.student_name || (parent.student && parent.student.name) || null;
          } catch (e) { }
        }
      }

      const url = `${BACKEND_URL}/api/attendance/public/`;
      const resp = await fetch(url);
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }
      const data = await resp.json();
      const list = Array.isArray(data) ? data : (data && data.results ? data.results : []);

      let match = null;
      if (studentLrn) {
        match = list.find(it => (it.student_lrn || it.lrn || '').toString() === studentLrn.toString());
      }
      if (!match && studentName) {
        match = list.find(it => (it.student_name || '').toLowerCase() === studentName.toLowerCase());
      }

      if (!match) {
        console.warn('[Setting] No attendance record matched (no fallback)', { studentLrn, studentName, attendanceCount: list.length });
        return { searched: { studentLrn, studentName }, result: null };
      }

      const qr = match.qr_code_data || match.qr_data || null;
      if (!qr) return { searched: { studentLrn, studentName }, result: null };

      const raw = qr.toString();
      try {
        const parsed = JSON.parse(raw);
        const pretty = JSON.stringify(parsed, null, 2);
        return { searched: { studentLrn, studentName }, result: { raw, pretty } };
      } catch (e) {
        return { searched: { studentLrn, studentName }, result: { raw, pretty: raw } };
      }
    } catch (err) {
      console.warn('[Setting] fetchAttendanceQr error', err);
      return null;
    } finally {
      setQrLoading(false);
    }
  };

  const handleToggleAttendanceQr = async () => {
    if (qrRaw || qrText || qrNotFound) {
      setQrText(null);
      setQrRaw(null);
      setQrNotFound(false);
      setSearchedStudent(null);
      setShowQrData(false);
      return;
    }
    setQrNotFound(false);
    const result = await fetchAttendanceQr();
    if (!result) {
      setQrRaw(null);
      setQrText(null);
      setQrNotFound(true);
      setSearchedStudent(null);
      return;
    }
    setSearchedStudent(result.searched || null);
    if (result.result) {
      setQrRaw(result.result.raw);
      setQrText(result.result.pretty);
      setQrNotFound(false);
      setShowQrData(false);
    } else {
      setQrRaw(null);
      setQrText(null);
      setQrNotFound(true);
      setShowQrData(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      const result = await fetchAttendanceQr();
      if (!result) {
        setSearchedStudent(null);
        if (!qrRaw && !qrText) setQrNotFound(true);
        return;
      }

      setSearchedStudent(result.searched || null);

      if (qrRaw || qrText) {
        if (result.result) {
          setQrRaw(result.result.raw);
          setQrText(result.result.pretty);
          setQrNotFound(false);
        } else {
          setQrRaw(null);
          setQrText(null);
          setQrNotFound(true);
        }
      } else {
        if (result.result) {
          setQrNotFound(false);
        } else {
          setQrNotFound(true);
        }
      }
    } catch (e) {
      console.warn('[Setting] onRefresh error', e);
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <LinearGradient
      colors={isDark ? ["#0b0f19", "#1a1f2b"] : ["#f5f5f5", "#e0e0e0"]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.container}
    >
      <ScrollView
        contentContainerStyle={{ paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
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
            Settings
          </Text>
        </View>

        <TouchableOpacity onPress={() => navigation.navigate("profile")}>
          <LinearGradient
            colors={isDark ? ["#1e1e1e", "#121212"] : ["#ffffff", "#f4f6f9"]}
            style={styles.item}
          >
            <Ionicons name="person-circle-outline" size={24} color="#3498db" />
            <Text style={[styles.itemText, { color: isDark ? "#fff" : "#333" }]}>
              Profile
            </Text>
          </LinearGradient>
        </TouchableOpacity>

        <TouchableOpacity onPress={handleToggleAttendanceQr}>
          <LinearGradient
            colors={isDark ? ["#1e1e1e", "#121212"] : ["#ffffff", "#f4f6f9"]}
            style={styles.item}
          >
            <Ionicons name="qr-code-outline" size={24} color="#16a085" />
            <Text style={[styles.itemText, { color: isDark ? "#fff" : "#333" }]}>Fetch Attendance QR</Text>
          </LinearGradient>
        </TouchableOpacity>

        {qrRaw ? (
          <LinearGradient
            colors={isDark ? ["#121212", "#0b0f19"] : ["#ffffff", "#f4f6f9"]}
            style={[styles.item, { alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }]}
          >
            {qrLoading ? (
              <ActivityIndicator size="small" color={isDark ? '#fff' : '#333'} />
            ) : null}

            {qrRaw && typeof qrRaw === 'string' && qrRaw.startsWith('data:') ? (
              <TouchableOpacity activeOpacity={0.9} onPress={() => setQrEnlarged(true)}>
                <View style={{ padding: 6, backgroundColor: '#fff', borderRadius: 8, marginBottom: 8 }}>
                  <Image source={{ uri: qrRaw }} style={{ width: 220, height: 220 }} resizeMode="contain" />
                </View>
              </TouchableOpacity>
            ) : qrRaw && QRCodeSVG ? (
              <TouchableOpacity activeOpacity={0.9} onPress={() => setQrEnlarged(true)}>
                <View style={{ alignItems: 'center', marginBottom: 8 }}>
                  <View style={{ padding: 6, backgroundColor: '#fff', borderRadius: 8 }}>
                    <QRCodeSVG value={qrRaw} size={200} color="#000" backgroundColor="#fff" />
                  </View>
                </View>
              </TouchableOpacity>
            ) : (
              <View style={{ paddingHorizontal: 6 }} />
            )}

            {qrRaw ? (
              <View style={{ flexDirection: 'row', marginTop: 6 }}>
                <TouchableOpacity
                  onPress={() => setShowQrData(s => !s)}
                  style={{ paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8, backgroundColor: isDark ? '#2b2b2b' : '#eef2f5' }}
                >
                  <Text style={{ color: isDark ? '#fff' : '#333', fontSize: 12 }}>
                    {showQrData ? 'Hide data' : 'Show data'}
                  </Text>
                </TouchableOpacity>
              </View>
            ) : null}

            {qrText && showQrData ? (
              <View style={{ paddingHorizontal: 8, marginTop: 6 }}>
                <Text style={{ color: isDark ? '#fff' : '#333', fontSize: 12 }}>{qrText}</Text>
              </View>
            ) : null}
          </LinearGradient>
        ) : null}

        {qrNotFound ? (
          <LinearGradient
            colors={isDark ? ["#121212", "#0b0f19"] : ["#ffffff", "#f4f6f9"]}
            style={[styles.item, { alignItems: 'center', justifyContent: 'center' }]}
          >
            <Text style={{ color: isDark ? '#fff' : '#333', fontSize: 14 }}>
              {`No attendance QR data found${searchedStudent && (searchedStudent.studentName || searchedStudent.studentLrn) ? ' for ' : ''}`}
              {searchedStudent && searchedStudent.studentName ? `${searchedStudent.studentName}` : ''}
              {searchedStudent && searchedStudent.studentLrn ? ` ${searchedStudent.studentLrn ? `(LRN: ${searchedStudent.studentLrn})` : ''}` : ''}
              .
            </Text>
          </LinearGradient>
        ) : null}

        <Modal visible={qrEnlarged} transparent animationType="fade" onRequestClose={() => setQrEnlarged(false)}>
          <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setQrEnlarged(false)}>
            <View style={styles.modalContent}>
              {qrRaw && typeof qrRaw === 'string' && qrRaw.startsWith('data:') ? (
                <View style={{ padding: 12, backgroundColor: '#fff', borderRadius: 12 }}>
                  <Image source={{ uri: qrRaw }} style={{ width: 340, height: 340 }} resizeMode="contain" />
                </View>
              ) : QRCodeSVG ? (
                <View style={{ alignItems: 'center' }}>
                  <View style={{ padding: 12, backgroundColor: '#fff', borderRadius: 12 }}>
                    <QRCodeSVG value={qrRaw} size={340} color="#000" backgroundColor="#fff" />
                  </View>
                </View>
              ) : null}
            </View>
          </TouchableOpacity>
        </Modal>

        <LinearGradient
          colors={isDark ? ["#1e1e1e", "#121212"] : ["#ffffff", "#f4f6f9"]}
          style={styles.item}
        >
          <Ionicons name="notifications-outline" size={24} color="#f39c12" />
          <Text style={[styles.itemText, { color: isDark ? "#fff" : "#333" }]}>
            Notifications
          </Text>
          <Switch
            value={notificationsEnabled}
            onValueChange={handleNotificationToggle}
            thumbColor={notificationsEnabled ? "#27ae60" : "#ccc"}
          />
        </LinearGradient>

        <LinearGradient
          colors={isDark ? ["#1e1e1e", "#121212"] : ["#ffffff", "#f4f6f9"]}
          style={styles.item}
        >
          <Ionicons name="moon-outline" size={24} color="#8e44ad" />
          <Text style={[styles.itemText, { color: isDark ? "#fff" : "#333" }]}>
            Dark Mode
          </Text>
          <Switch
            value={isDark}
            onValueChange={setDarkModeEnabled}
            thumbColor={isDark ? "#27ae60" : "#ccc"}
          />
        </LinearGradient>

        <TouchableOpacity onPress={() => navigation.navigate("changepass")}>
          <LinearGradient
            colors={isDark ? ["#1e1e1e", "#121212"] : ["#ffffff", "#f4f6f9"]}
            style={styles.item}
          >
            <Ionicons name="lock-closed-outline" size={24} color="#2ecc71" />
            <Text style={[styles.itemText, { color: isDark ? "#fff" : "#333" }]}>
              Change Password
            </Text>
          </LinearGradient>
        </TouchableOpacity>

        <TouchableOpacity onPress={handleLogout}>
          <LinearGradient
            colors={isDark ? ["#1e1e1e", "#121212"] : ["#ffffff", "#f4f6f9"]}
            style={styles.item}
          >
            <Ionicons name="log-out-outline" size={24} color="#e74c3c" />
            <Text style={[styles.itemText, { color: isDark ? "#fff" : "#333" }]}>
              Logout
            </Text>
          </LinearGradient>
        </TouchableOpacity>
      </ScrollView>
    </LinearGradient>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#ddd",
    marginTop: 40,
  },
  headerTitle: { fontSize: 20, fontWeight: "700", marginLeft: 12 },
  item: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    borderRadius: 12,
    marginHorizontal: 16,
    marginVertical: 8,
    elevation: 2,
  },
  itemText: {
    flex: 1,
    fontSize: 16,
    marginLeft: 12,
    fontWeight: "500",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: 'transparent',
    padding: 12,
    borderRadius: 12,
  },
});

export default Settings;