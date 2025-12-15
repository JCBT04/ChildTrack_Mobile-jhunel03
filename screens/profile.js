import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  Image,
  TouchableOpacity,
  Modal,
  TextInput,
  ScrollView,
  RefreshControl,
  Alert,
  FlatList,
  Dimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as ImagePicker from "expo-image-picker";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useTheme } from "../components/ThemeContext";

const DEFAULT_RENDER_BACKEND_URL = "https://childtrack-backend.onrender.com/";
const BACKEND_URL = DEFAULT_RENDER_BACKEND_URL.replace(/\/$/, "");

// Predefined avatar options
const AVATAR_OPTIONS = [
  { id: 1, icon: "person-circle", color: "#3498db", label: "Blue", kind: 'icon' },
  { id: 2, icon: "person-circle", color: "#e74c3c", label: "Red", kind: 'icon' },
  { id: 3, icon: "person-circle", color: "#2ecc71", label: "Green", kind: 'icon' },
  { id: 4, icon: "person-circle", color: "#f39c12", label: "Orange", kind: 'icon' },
  { id: 5, icon: "person-circle", color: "#9b59b6", label: "Purple", kind: 'icon' },
  { id: 6, icon: "person-circle", color: "#1abc9c", label: "Teal", kind: 'icon' },
  { id: 7, icon: "person-circle", color: "#e91e63", label: "Pink", kind: 'icon' },
  { id: 8, icon: "person-circle", color: "#ff6b6b", label: "Coral", kind: 'icon' },
  { id: 9, icon: "happy", color: "#3498db", label: "Happy", kind: 'icon' },
  { id: 10, icon: "school", color: "#2ecc71", label: "Student", kind: 'icon' },
  { id: 11, icon: "heart", color: "#e74c3c", label: "Heart", kind: 'icon' },
  { id: 12, icon: "star", color: "#f39c12", label: "Star", kind: 'icon' },
];

// Emoji-only avatar options
const EMOJI_OPTIONS = [
  { id: 101, emoji: "😊", color: "#ffd166", label: "Smile", kind: 'emoji' },
  { id: 102, emoji: "😄", color: "#ff9aa2", label: "Happy", kind: 'emoji' },
  { id: 103, emoji: "😍", color: "#ffb7b2", label: "Love", kind: 'emoji' },
  { id: 104, emoji: "🤓", color: "#cddafd", label: "Nerd", kind: 'emoji' },
  { id: 105, emoji: "🧑‍🏫", color: "#bde0fe", label: "Teacher", kind: 'emoji' },
  { id: 106, emoji: "👨‍👩‍👧", color: "#d4f1f4", label: "Family", kind: 'emoji' },
  { id: 107, emoji: "🦄", color: "#f3c4fb", label: "Unicorn", kind: 'emoji' },
  { id: 108, emoji: "🌟", color: "#fff2cc", label: "Star", kind: 'emoji' },
  { id: 109, emoji: "🎒", color: "#cdeac0", label: "Student", kind: 'emoji' },
  { id: 110, emoji: "⚽️", color: "#ffd6a5", label: "Sport", kind: 'emoji' },
];

const normalizeImageUrl = (url) => {
  if (!url) return null;
  try {
    if (url.startsWith('file://') || url.startsWith('content://')) {
      return encodeURI(url);
    }
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return encodeURI(url);
    }
    const prefix = BACKEND_URL.replace(/\/$/, '');
    const path = url.startsWith('/') ? url : `/${url}`;
    return encodeURI(`${prefix}${path}`);
  } catch (e) {
    return url;
  }
};

const Profile = ({ navigation, route }) => {
  const { darkModeEnabled } = useTheme();
  const isDark = darkModeEnabled;

  const [profile, setProfile] = useState({
    name: "",
    id: null,
    phone: "",
    address: "",
    username: "",
    image: null,
    must_change: false,
    avatarType: null, // 'uploaded' or 'preset'
    avatarPreset: null, // store preset avatar data
  });

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const mountedRef = useRef(true);

  const [modalVisible, setModalVisible] = useState(false);
  const [avatarModalVisible, setAvatarModalVisible] = useState(false);
  const [avatarSelectorVisible, setAvatarSelectorVisible] = useState(false);
  const [avatarSelectorTab, setAvatarSelectorTab] = useState('icons'); // 'icons' or 'emoji'
  const [selectedPreset, setSelectedPreset] = useState(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [pendingAvatar, setPendingAvatar] = useState(null);
  const [saving, setSaving] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const isForced = !!(profile.must_change || (route?.params?.forceChange));

  const fetchParentsForUsername = async (username) => {
    const token = await AsyncStorage.getItem("token");
    const headers = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Token ${token}`;

    try {
      const res = await fetch(`${BACKEND_URL}/api/parents/parents/`, { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      let parents = Array.isArray(data) ? data : (data?.results || []);
      parents = parents.filter((p) => p.username === username);
      if (parents.length) {
        await AsyncStorage.setItem("parent", JSON.stringify(parents[0]));
        return parents;
      }
    } catch (err) {
      console.warn("[Profile] Failed to fetch parents from API:", err?.message || err);
    }

    try {
      const storedParent = await AsyncStorage.getItem("parent");
      if (storedParent) {
        const parsed = JSON.parse(storedParent);
        if (parsed?.username === username) {
          return [parsed];
        }
      }
    } catch (err) {
      console.warn("[Profile] Failed to read cached parent:", err?.message || err);
    }

    return [];
  };

  const fetchParent = async ({ skipLoading = false } = {}) => {
    if (!skipLoading) setLoading(true);
    try {
      const username = await AsyncStorage.getItem("username");
      if (!username) {
        if (mountedRef.current) setLoading(false);
        return;
      }

      const parents = await fetchParentsForUsername(username);
      if (!mountedRef.current) return;
      if (!parents.length) {
        setLoading(false);
        return;
      }

      const p = parents[0];
      const avatarField = p.avatar_url || p.avatar;
      const avatarUrlRaw = avatarField
        ? (avatarField.startsWith("http") ? avatarField : `${avatarField}`)
        : null;
      const avatarUrl = normalizeImageUrl(avatarUrlRaw);

      // Check if avatar is a preset (stored in AsyncStorage)
      const storedAvatarType = await AsyncStorage.getItem(`avatar_type_${p.id}`);
      const storedAvatarPreset = await AsyncStorage.getItem(`avatar_preset_${p.id}`);

      if (mountedRef.current) {
        setProfile((prev) => ({
          ...prev,
          id: p.id || prev.id,
          name: p.name || prev.name,
          address: p.address || prev.address,
          username: p.username || prev.username,
          phone: p.contact_number || prev.phone,
          must_change: !!p.must_change_credentials,
          image: avatarUrl || prev.image,
          avatarType: storedAvatarType || 'uploaded',
          avatarPreset: storedAvatarPreset ? JSON.parse(storedAvatarPreset) : null,
        }));
        setLoading(false);
      }
    } catch (err) {
      console.warn("Failed to load parent profile:", err.message || err);
      if (mountedRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    fetchParent();
    if (route?.params?.forceChange) {
      setModalVisible(true);
    }
    return () => { mountedRef.current = false; };
  }, []);

  const onRefresh = async () => {
    console.log('[Profile] onRefresh called');
    setRefreshing(true);
    await fetchParent({ skipLoading: true });
    setRefreshing(false);
  };

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!result.canceled) {
      const uri = result.assets[0].uri;
      setProfile((prev) => ({ 
        ...prev, 
        image: normalizeImageUrl(uri),
        avatarType: 'uploaded',
        avatarPreset: null,
      }));
      setPendingAvatar(normalizeImageUrl(uri));
      setAvatarModalVisible(true);
    }
  };

  const takePhoto = async () => {
    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
      cameraType: ImagePicker.CameraType.front,
    });
    if (!result.canceled) {
      const uri = result.assets[0].uri;
      setProfile((prev) => ({ 
        ...prev, 
        image: normalizeImageUrl(uri),
        avatarType: 'uploaded',
        avatarPreset: null,
      }));
      setPendingAvatar(normalizeImageUrl(uri));
      setAvatarModalVisible(true);
    }
  };

  const selectPresetAvatar = async (avatar) => {
    // Set as currently selected in the selector (confirm to persist)
    setSelectedPreset(avatar);
  };

  const confirmPresetSelection = async () => {
    if (!selectedPreset) {
      Alert.alert('Error', 'Please choose an avatar first');
      return;
    }
    if (!profile.id) {
      Alert.alert('Error', 'No parent ID available to save avatar');
      return;
    }
    const avatar = selectedPreset;
    setProfile((prev) => ({
      ...prev,
      avatarType: 'preset',
      avatarPreset: avatar,
      image: null,
    }));

    try {
      await AsyncStorage.setItem(`avatar_type_${profile.id}`, 'preset');
      await AsyncStorage.setItem(`avatar_preset_${profile.id}`, JSON.stringify(avatar));
    } catch (e) {
      console.warn('[Profile] Failed to persist preset avatar', e);
    }

    setAvatarSelectorVisible(false);
    setSelectedPreset(null);
    Alert.alert('Success', 'Avatar updated successfully!');
  };

  const clearPresetSelection = async () => {
    if (!profile.id) {
      Alert.alert('Error', 'No parent ID available');
      return;
    }
    setProfile((prev) => ({ ...prev, avatarType: null, avatarPreset: null, image: null }));
    try {
      await AsyncStorage.removeItem(`avatar_type_${profile.id}`);
      await AsyncStorage.removeItem(`avatar_preset_${profile.id}`);
    } catch (e) {
      console.warn('[Profile] Failed to clear preset avatar', e);
    }
    setAvatarSelectorVisible(false);
    setSelectedPreset(null);
    Alert.alert('Success', 'Avatar cleared');
  };

  const uploadAvatar = async (imageUri) => {
    if (!imageUri) return;
    if (!profile.id) {
      Alert.alert('Error', 'No parent ID available to upload avatar');
      return;
    }
    setAvatarUploading(true);
    try {
      let uri = imageUri;
      if (uri && !uri.startsWith('file://') && !uri.startsWith('content://') && !uri.startsWith('http')) {
        uri = `file://${uri}`;
      }

      const uriParts = uri.split('/');
      let filename = uriParts[uriParts.length - 1];
      if (!filename.includes('.')) filename = `avatar_${Date.now()}.jpg`;

      let mime = 'image/jpeg';
      const match = filename.match(/\.([0-9a-zA-Z]+)(?:\?|$)/);
      if (match) {
        const ext = match[1].toLowerCase();
        if (ext === 'png') mime = 'image/png';
        else if (ext === 'gif') mime = 'image/gif';
        else if (ext === 'heic' || ext === 'heif') mime = 'image/heic';
        else if (ext === 'webp') mime = 'image/webp';
      }

      const formData = new FormData();
      formData.append('avatar', { uri, name: filename, type: mime });

      const headers = { Accept: 'application/json' };
      const token = await AsyncStorage.getItem('token');
      if (token) headers['Authorization'] = `Token ${token}`;

      const endpoint = `${BACKEND_URL}/api/parents/parent/${profile.id}/`;
      console.log('[Profile] Uploading avatar to:', endpoint);

      const xhrResult = await sendFormData(endpoint, headers, formData, 'PATCH');
      const text = xhrResult.responseText;
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch (e) { }

      if (!xhrResult.ok) {
        Alert.alert('Error', `Avatar upload failed (${xhrResult.status})`);
        return;
      }

      const avatarField = json?.avatar_url || json?.avatar;
      const avatarUrlRaw = avatarField ? (avatarField.startsWith('http') ? avatarField : `${avatarField}`) : imageUri;
      const avatarUrl = normalizeImageUrl(avatarUrlRaw);

      setProfile((prev) => ({ 
        ...prev, 
        image: avatarUrl,
        avatarType: 'uploaded',
        avatarPreset: null,
      }));

      // Save avatar type
      await AsyncStorage.setItem(`avatar_type_${profile.id}`, 'uploaded');
      await AsyncStorage.removeItem(`avatar_preset_${profile.id}`);

      try {
        const stored = await AsyncStorage.getItem('parent');
        const parsed = stored ? JSON.parse(stored) : {};
        const merged = { ...parsed, avatar_url: avatarField || parsed.avatar_url };
        await AsyncStorage.setItem('parent', JSON.stringify(merged));
      } catch (e) {
        console.warn('[Profile] Failed to update cached parent', e);
      }

      setPendingAvatar(null);
      setAvatarModalVisible(false);
      setModalVisible(false);

      Alert.alert('Success', 'Profile picture updated');
    } catch (err) {
      console.error('[Profile] Avatar upload error:', err);
      Alert.alert('Error', err.message || 'Failed to upload avatar');
    } finally {
      setAvatarUploading(false);
    }
  };

  const sendFormData = (endpoint, headers, formData, method = 'PATCH') => {
    return new Promise((resolve, reject) => {
      try {
        const xhr = new XMLHttpRequest();
        xhr.open(method, endpoint);
        Object.entries(headers || {}).forEach(([k, v]) => {
          if (v != null) xhr.setRequestHeader(k, v);
        });
        xhr.onload = () => {
          resolve({ status: xhr.status, ok: xhr.status >= 200 && xhr.status < 300, responseText: xhr.responseText });
        };
        xhr.onerror = () => reject(new Error('Network request failed'));
        xhr.send(formData);
      } catch (e) {
        reject(e);
      }
    });
  };

  const saveProfile = async () => {
    if (saving) return;
    if (!profile.id) {
      Alert.alert("Error", "No parent ID available to save");
      return;
    }

    const wasForced = !!((route?.params?.forceChange) || profile.must_change);

    if (wasForced) {
      if (!profile.username?.trim()) {
        Alert.alert('Error', 'Username is required');
        return;
      }
      if (!newPassword?.trim()) {
        Alert.alert('Error', 'New password is required');
        return;
      }
    }

    if (newPassword) {
      if (newPassword !== confirmPassword) {
        Alert.alert('Error', 'New passwords do not match');
        return;
      }
      if (newPassword.length < 6) {
        Alert.alert('Error', 'Password must be at least 6 characters');
        return;
      }
    }

    setSaving(true);

    try {
      const endpoint = `${BACKEND_URL}/api/parents/parent/${profile.id}/`;
      const isLocalImage = profile.image && !profile.image.startsWith("http");

      const formData = new FormData();
      
      if (profile.name) formData.append('name', profile.name);
      if (profile.username) formData.append('username', profile.username);
      if (profile.phone) formData.append('contact_number', profile.phone);
      if (profile.address) formData.append('address', profile.address);

      if (newPassword) {
        formData.append('password', newPassword);
        if (currentPassword && !wasForced) {
          formData.append('current_password', currentPassword);
        }
      }

      if (isLocalImage) {
        let uri = profile.image;
        if (uri && !uri.startsWith('file://') && !uri.startsWith('content://') && !uri.startsWith('http')) {
          uri = `file://${uri}`;
        }
        const uriParts = uri.split("/");
        let filename = uriParts[uriParts.length - 1];
        
        if (!filename.includes(".")) {
          filename = `avatar_${Date.now()}.jpg`;
        }

        let mime = "image/jpeg";
        const match = filename.match(/\.([0-9a-zA-Z]+)(?:\?|$)/);
        if (match) {
          const ext = match[1].toLowerCase();
          if (ext === "png") mime = "image/png";
          else if (ext === "gif") mime = "image/gif";
          else if (ext === "heic" || ext === "heif") mime = "image/heic";
          else if (ext === "webp") mime = "image/webp";
        }
        
        formData.append("avatar", {
          uri: uri,
          name: filename,
          type: mime,
        });
      }

      const headers = { 'Accept': 'application/json' };
      const token = await AsyncStorage.getItem('token');
      if (token) headers['Authorization'] = `Token ${token}`;

      let responseOk = false;
      let responseStatus = null;
      let responseText = null;
      let updated = null;

      if (isLocalImage) {
        const xhrResult = await sendFormData(endpoint, headers, formData, 'PATCH');
        responseStatus = xhrResult.status;
        responseText = xhrResult.responseText;
        responseOk = xhrResult.ok;
      } else {
        const response = await fetch(endpoint, {
          method: 'PATCH',
          headers,
          body: formData,
        });
        responseStatus = response.status;
        responseText = await response.text();
        responseOk = response.ok;
      }

      try {
        updated = responseText ? JSON.parse(responseText) : null;
      } catch (e) {
        console.warn('[Profile] Response not JSON');
      }

      if (!responseOk) {
        Alert.alert('Error', `Failed to save profile (${responseStatus})`);
        setSaving(false);
        return;
      }

      const avatarField = updated?.avatar_url || updated?.avatar;
      const avatarUrlRaw = avatarField ? (avatarField.startsWith("http") ? avatarField : `${avatarField}`) : profile.image;
      const avatarUrl = normalizeImageUrl(avatarUrlRaw);

      const normalized = {
        ...updated,
        contact_number: updated?.contact_number ?? profile.phone,
        address: updated?.address ?? profile.address,
        name: updated?.name ?? profile.name,
        username: updated?.username ?? profile.username,
        must_change: updated?.must_change_credentials ?? false,
      };

      setProfile((prev) => ({
        ...prev,
        ...normalized,
        phone: normalized.contact_number,
        image: avatarUrl,
      }));

      try {
        await AsyncStorage.setItem("parent", JSON.stringify(normalized));
        if (normalized.username) {
          await AsyncStorage.setItem("username", normalized.username);
        }
        await AsyncStorage.setItem("parent_must_change", normalized.must_change ? "1" : "0");
      } catch (err) {
        console.warn("[Profile] Failed to cache parent:", err?.message || err);
      }

      if (wasForced) {
        try {
          await AsyncStorage.removeItem('token');
          await AsyncStorage.removeItem('parent');
          await AsyncStorage.removeItem('username');
          await AsyncStorage.removeItem('parent_must_change');
        } catch (err) {
          console.warn('[Profile] Failed to clear session', err);
        }

        setModalVisible(false);

        try {
          navigation.reset({ index: 0, routes: [{ name: 'login' }] });
        } catch (e) {
          navigation.navigate('login');
        }

        setSaving(false);
        return;
      }

      Alert.alert('Success', 'Profile updated successfully!');
      setModalVisible(false);
      
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');

    } catch (err) {
      console.error("[Profile] Save error:", err);
      Alert.alert('Error', err.message || 'Failed to save profile. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const renderAvatar = () => {
    if (profile.avatarType === 'preset' && profile.avatarPreset) {
      if (profile.avatarPreset.kind === 'emoji') {
        return (
          <View style={[styles.avatar, { backgroundColor: profile.avatarPreset.color, justifyContent: 'center' }]}>
            <Text style={{ fontSize: 54 }}>{profile.avatarPreset.emoji}</Text>
          </View>
        );
      }
      return (
        <View style={[styles.avatar, { backgroundColor: profile.avatarPreset.color }]}>
          <Ionicons name={profile.avatarPreset.icon} size={80} color="#fff" />
        </View>
      );
    } else if (profile.image) {
      return (
        <Image 
          source={{ uri: profile.image }} 
          style={styles.avatar}
          onError={(e) => {
            console.warn('[Profile] Image load error:', e.nativeEvent.error);
            setProfile(prev => ({ ...prev, image: null }));
          }}
        />
      );
    } else {
      return (
        <View style={[styles.avatarPlaceholder, { backgroundColor: isDark ? "#333" : "#ddd" }]}>
          <Ionicons name="person-circle-outline" size={100} color={isDark ? "#888" : "#555"} />
        </View>
      );
    }
  };

  return (
    <LinearGradient
      colors={isDark ? ["#0b0f19", "#1a1f2b"] : ["#f5f5f5", "#e0e0e0"]}
      style={styles.container}
    >
      <View style={styles.header}>
        <Ionicons
          name="arrow-back"
          size={24}
          color={isDark ? "#fff" : "#333"}
          onPress={() => {
            if (isForced) {
              Alert.alert('Action Required', 'You must update your credentials before continuing.');
              return;
            }
            if (navigation.canGoBack && navigation.canGoBack()) {
              navigation.goBack();
            } else {
              navigation.navigate('home');
            }
          }}
        />
        <Text style={[styles.headerTitle, { color: isDark ? "#fff" : "#333" }]}>
          Profile
        </Text>
      </View>

      <ScrollView 
        contentContainerStyle={{ paddingBottom: 30 }} 
        refreshControl={
          <RefreshControl 
            refreshing={refreshing} 
            onRefresh={onRefresh} 
            tintColor={isDark ? '#fff' : '#333'} 
            colors={[isDark ? '#fff' : '#333']} 
            progressBackgroundColor={isDark ? '#111' : '#fff'} 
          />
        }
      >
        <View style={[styles.profileCard, { backgroundColor: isDark ? "#1e1e1e" : "#fff" }]}>
          <TouchableOpacity onPress={() => setAvatarModalVisible(true)}>
            {renderAvatar()}
            <View style={styles.cameraIconContainer}>
              <Ionicons name="camera" size={20} color="#fff" />
            </View>
          </TouchableOpacity>
          <Text style={[styles.name, { color: isDark ? "#fff" : "#333" }]}>
            {profile.name || 'No Name'}
          </Text>
        </View>

        <View style={styles.infoSection}>
          <View style={[styles.infoItem, { backgroundColor: isDark ? "#1e1e1e" : "#fff" }]}>
            <Ionicons name="person-circle-outline" size={22} color="#8e44ad" />
            <Text style={[styles.infoText, { color: isDark ? "#fff" : "#333" }]}>
              Username: {profile.username || 'Not set'}
            </Text>
          </View>

          <View style={[styles.infoItem, { backgroundColor: isDark ? "#1e1e1e" : "#fff" }]}>
            <Ionicons name="call-outline" size={22} color="#27ae60" />
            <Text style={[styles.infoText, { color: isDark ? "#fff" : "#333" }]}>
              Contact: {profile.phone || "No contact number"}
            </Text>
          </View>

          <View style={[styles.infoItem, { backgroundColor: isDark ? "#1e1e1e" : "#fff" }]}>
            <Ionicons name="home-outline" size={22} color="#2980b9" />
            <Text style={[styles.infoText, { color: isDark ? "#fff" : "#333" }]}>
              Address: {profile.address || "No address provided"}
            </Text>
          </View>
        </View>

        <TouchableOpacity
          style={[styles.editButton, { backgroundColor: isDark ? "#3498db" : "#2980b9" }]}
          onPress={() => setModalVisible(true)}
        >
          <Ionicons name="create-outline" size={20} color="#fff" />
          <Text style={styles.editText}>Edit Profile</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Edit Modal */}
      <Modal visible={modalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', alignItems: 'stretch' }}>
            <View style={[styles.modalContent, { backgroundColor: isDark ? "#2c2c2c" : "#fff" }]}>
              <Text style={[styles.modalTitle, { color: isDark ? "#fff" : "#333" }]}>
                {isForced ? 'Update Your Credentials' : 'Edit Profile'}
              </Text>

              {isForced && (
                <Text style={[styles.warningText, { color: isDark ? "#ffa726" : "#f57c00" }]}>
                  For security, please update your username and password before continuing.
                </Text>
              )}

              {!isForced && (
                <View style={styles.inputRow}>
                  <Ionicons name="person-outline" size={20} color={isDark ? "#fff" : "#333"} />
                  <TextInput
                    style={[styles.input, { color: isDark ? "#fff" : "#000" }]}
                    placeholder="Name"
                    placeholderTextColor="#999"
                    value={profile.name}
                    onChangeText={(text) => setProfile({ ...profile, name: text })}
                  />
                </View>
              )}

              <View style={styles.inputRow}>
                <Ionicons name="person-circle-outline" size={20} color={isDark ? "#fff" : "#333"} />
                <TextInput
                  style={[styles.input, { color: isDark ? "#fff" : "#000" }]}
                  placeholder="Username *"
                  placeholderTextColor="#999"
                  value={profile.username}
                  onChangeText={(text) => setProfile({ ...profile, username: text })}
                />
              </View>

              {isForced ? (
                <>
                  <View style={styles.inputRow}>
                    <Ionicons name="key-outline" size={20} color={isDark ? "#fff" : "#333"} />
                    <TextInput
                      style={[styles.input, { color: isDark ? "#fff" : "#000" }]}
                      placeholder="New password (required) *"
                      placeholderTextColor="#999"
                      value={newPassword}
                      onChangeText={setNewPassword}
                      secureTextEntry={!showNewPassword}
                    />
                    <TouchableOpacity onPress={() => setShowNewPassword((s) => !s)} style={{ paddingHorizontal: 8 }}>
                      <Ionicons name={showNewPassword ? "eye" : "eye-off"} size={20} color={isDark ? "#fff" : "#333"} />
                    </TouchableOpacity>
                  </View>

                  <View style={styles.inputRow}>
                    <Ionicons name="checkmark-done-outline" size={20} color={isDark ? "#fff" : "#333"} />
                    <TextInput
                      style={[styles.input, { color: isDark ? "#fff" : "#000" }]}
                      placeholder="Confirm new password *"
                      placeholderTextColor="#999"
                      value={confirmPassword}
                      onChangeText={setConfirmPassword}
                      secureTextEntry={!showConfirmPassword}
                    />
                    <TouchableOpacity onPress={() => setShowConfirmPassword((s) => !s)} style={{ paddingHorizontal: 8 }}>
                      <Ionicons name={showConfirmPassword ? "eye" : "eye-off"} size={20} color={isDark ? "#fff" : "#333"} />
                    </TouchableOpacity>
                  </View>
                </>
              ) : (
                <>
                  <View style={styles.inputRow}>
                    <Ionicons name="call-outline" size={20} color={isDark ? "#fff" : "#333"} />
                    <TextInput
                      style={[styles.input, { color: isDark ? "#fff" : "#000" }]}
                      placeholder="Phone"
                      placeholderTextColor="#999"
                      value={profile.phone}
                      onChangeText={(text) => setProfile({ ...profile, phone: text })}
                      keyboardType="phone-pad"
                    />
                  </View>

                  <View style={styles.inputRow}>
                    <Ionicons name="home-outline" size={20} color={isDark ? "#fff" : "#333"} />
                    <TextInput
                      style={[styles.input, { color: isDark ? "#fff" : "#000" }]}
                      placeholder="Address"
                      placeholderTextColor="#999"
                      value={profile.address}
                      onChangeText={(text) => setProfile({ ...profile, address: text })}
                      multiline
                    />
                  </View>
                </>
              )}

              <View style={styles.modalButtons}>
                <TouchableOpacity
                  style={[styles.saveButton, { opacity: saving ? 0.6 : 1 }]}
                  onPress={saveProfile}
                  disabled={saving}
                >
                  <Text style={styles.saveButtonText}>
                    {saving ? "Saving..." : "Save"}
                  </Text>
                </TouchableOpacity>
                
                <TouchableOpacity
                  style={[styles.cancelButtonStyle, isForced ? { opacity: 0.6 } : null]}
                  onPress={() => {
                    if (isForced) {
                      Alert.alert('Action Required', 'You must change your credentials before continuing.');
                      return;
                    }
                    setModalVisible(false);
                  }}
                  disabled={saving || isForced}
                >
                  <Text style={styles.cancelButtonText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </View>
      </Modal>

      {/* Avatar Update Modal */}
      <Modal visible={avatarModalVisible} animationType="fade" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.avatarModal, { backgroundColor: isDark ? "#2c2c2c" : "#fff" }]}>
            <Text style={[styles.modalTitle, { color: isDark ? "#fff" : "#333" }]}>
              Update Profile Picture
            </Text>

            {pendingAvatar ? (
              <>
                <Image source={{ uri: pendingAvatar }} style={[styles.avatar, { marginBottom: 8 }]} />
                <View style={{ flexDirection: 'row', width: '100%', justifyContent: 'space-between' }}>
                  <TouchableOpacity
                    style={[styles.saveButton, { flex: 1, marginRight: 8, opacity: avatarUploading ? 0.6 : 1 }]}
                    onPress={() => {
                      const uriToUpload = pendingAvatar;
                      setPendingAvatar(null);
                      setAvatarModalVisible(false);
                      setModalVisible(false);
                      uploadAvatar(uriToUpload);
                    }}
                    disabled={avatarUploading}
                  >
                    <Text style={styles.saveButtonText}>{avatarUploading ? 'Uploading...' : 'Upload'}</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.cancelButtonStyle, { flex: 1, marginLeft: 8 }]}
                    onPress={() => { setPendingAvatar(null); setAvatarModalVisible(false); }}
                    disabled={avatarUploading}
                  >
                    <Text style={styles.cancelButtonText}>Cancel</Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              <>
                <TouchableOpacity
                  style={[styles.avatarOption, { backgroundColor: isDark ? "#333" : "#f0f0f0" }]}
                  onPress={() => {
                    setAvatarModalVisible(false);
                    setAvatarSelectorVisible(true);
                  }}
                >
                  <Ionicons name="color-palette-outline" size={24} color={isDark ? "#ffa726" : "#f39c12"} />
                  <Text style={[styles.optionText, { color: isDark ? "#fff" : "#333" }]}>
                    Choose Avatar
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.avatarOption, { backgroundColor: isDark ? "#333" : "#f0f0f0" }]}
                  onPress={takePhoto}
                >
                  <Ionicons name="camera-outline" size={24} color={isDark ? "#4da6ff" : "#3498db"} />
                  <Text style={[styles.optionText, { color: isDark ? "#fff" : "#333" }]}>
                    Selfie
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.avatarOption, { backgroundColor: isDark ? "#333" : "#f0f0f0" }]}
                  onPress={pickImage}
                >
                  <Ionicons name="image-outline" size={24} color={isDark ? "#6edc82" : "#27ae60"} />
                  <Text style={[styles.optionText, { color: isDark ? "#fff" : "#333" }]}>
                    Choose from Gallery
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.cancelButton, { backgroundColor: isDark ? "#444" : "#eee" }]}
                  onPress={() => { setPendingAvatar(null); setAvatarModalVisible(false); }}
                >
                  <Text style={[styles.cancelText, { color: isDark ? "#fff" : "#333" }]}>
                    Cancel
                  </Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* Avatar Selector Modal */}
      <Modal visible={avatarSelectorVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.avatarSelectorModal, { backgroundColor: isDark ? "#2c2c2c" : "#fff" }]}>
            <Text style={[styles.modalTitle, { color: isDark ? "#fff" : "#333", marginBottom: 20 }]}>
              Choose an Avatar
            </Text>
            <View style={styles.tabContainer}>
              <TouchableOpacity
                style={[styles.tabButton, avatarSelectorTab === 'icons' ? styles.tabButtonActive : null]}
                onPress={() => setAvatarSelectorTab('icons')}
              >
                <Text style={styles.tabText}>Icons</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.tabButton, avatarSelectorTab === 'emoji' ? styles.tabButtonActive : null]}
                onPress={() => setAvatarSelectorTab('emoji')}
              >
                <Text style={styles.tabText}>Emoji</Text>
              </TouchableOpacity>
            </View>

            <FlatList
              data={avatarSelectorTab === 'icons' ? AVATAR_OPTIONS : EMOJI_OPTIONS}
              numColumns={3}
              keyExtractor={(item) => item.id.toString()}
              renderItem={({ item }) => {
                const isSelected = selectedPreset?.id === item.id;
                return (
                  <TouchableOpacity
                    style={styles.avatarOptionItem}
                    onPress={() => selectPresetAvatar(item)}
                  >
                    <View style={[
                      styles.avatarPreview,
                      { backgroundColor: item.color, borderWidth: isSelected ? 3 : 0, borderColor: isSelected ? '#ffd166' : 'transparent' }
                    ]}>
                      {item.kind === 'icon' ? (
                        <Ionicons name={item.icon} size={50} color="#fff" />
                      ) : (
                        <Text style={{ fontSize: 44 }}>{item.emoji}</Text>
                      )}
                    </View>
                    <Text style={[styles.avatarLabel, { color: isDark ? "#fff" : "#333" }] }>
                      {item.label}
                    </Text>
                  </TouchableOpacity>
                );
              }}
              contentContainerStyle={styles.avatarGrid}
            />

            {selectedPreset ? (
              <View style={{ width: '100%', alignItems: 'center', marginTop: 8 }}>
                <Text style={[styles.modalTitle, { fontSize: 16, marginBottom: 8, color: isDark ? '#fff' : '#333' }]}>Selected</Text>
                <View style={{ flexDirection: 'row', width: '100%', justifyContent: 'space-between' }}>
                  <TouchableOpacity
                    style={[styles.saveButton, { flex: 1, marginRight: 8 }]}
                    onPress={confirmPresetSelection}
                  >
                    <Text style={styles.saveButtonText}>Confirm</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.cancelButtonStyle, { flex: 1, marginLeft: 8 }]}
                    onPress={clearPresetSelection}
                  >
                    <Text style={styles.cancelButtonText}>Clear</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <TouchableOpacity
                style={[styles.cancelButton, { backgroundColor: isDark ? "#444" : "#eee", marginTop: 20 }]}
                onPress={() => setAvatarSelectorVisible(false)}
              >
                <Text style={[styles.cancelText, { color: isDark ? "#fff" : "#333" }]}> 
                  Cancel
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </Modal>
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
  profileCard: {
    alignItems: "center",
    margin: 20,
    padding: 20,
    borderRadius: 16,
    elevation: 3,
  },
  avatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
    marginBottom: 12,
    backgroundColor: "#ccc",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarPlaceholder: {
    width: 100,
    height: 100,
    borderRadius: 50,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  cameraIconContainer: {
    position: 'absolute',
    bottom: 12,
    right: 0,
    backgroundColor: '#3498db',
    borderRadius: 15,
    width: 30,
    height: 30,
    justifyContent: 'center',
    alignItems: 'center',
  },
  name: { fontSize: 20, fontWeight: "700" },
  infoSection: { marginTop: 10, marginHorizontal: 16 },
  infoItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    elevation: 2,
  },
  infoText: { marginLeft: 12, fontSize: 15, fontWeight: "500", flex: 1 },
  editButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginHorizontal: 50,
    padding: 14,
    borderRadius: 30,
    marginTop: 20,
  },
  editText: { color: "#fff", fontWeight: "600", marginLeft: 8, fontSize: 16 },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    alignItems: "stretch",
  },
  modalContent: {
    width: "90%",
    alignSelf: 'center',
    padding: 20,
    borderRadius: 16,
    maxHeight: '90%',
  },
  avatarModal: {
    width: "80%",
    alignSelf: "center",
    padding: 20,
    borderRadius: 16,
    alignItems: "center",
  },
  avatarSelectorModal: {
    width: "90%",
    maxHeight: "80%",
    alignSelf: "center",
    padding: 20,
    borderRadius: 16,
  },
  modalTitle: { fontSize: 18, fontWeight: "700", marginBottom: 16 },
  warningText: {
    fontSize: 14,
    marginBottom: 16,
    textAlign: 'center',
    fontWeight: '500',
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    paddingHorizontal: 10,
    marginBottom: 12,
  },
  input: {
    flex: 1,
    fontSize: 16,
    padding: 10,
  },
  modalButtons: {
    marginTop: 8,
    gap: 10,
  },
  saveButton: {
    backgroundColor: '#27ae60',
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  cancelButtonStyle: {
    backgroundColor: '#e74c3c',
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  cancelButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  avatarOption: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    width: "100%",
    borderRadius: 8,
    marginBottom: 12,
  },
  optionText: {
    marginLeft: 12,
    fontSize: 16,
    fontWeight: '600',
  },
  cancelButton: {
    marginTop: 10,
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 8,
    alignSelf: 'stretch',
    alignItems: 'center',
  },
  cancelText: {
    fontSize: 16,
    fontWeight: '600',
  },
  avatarGrid: {
    paddingBottom: 10,
  },
  tabContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: 12,
  },
  tabButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    marginHorizontal: 6,
    backgroundColor: '#eee',
  },
  tabButtonActive: {
    backgroundColor: '#27ae60',
  },
  tabText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
  },
  avatarOptionItem: {
    flex: 1,
    alignItems: 'center',
    margin: 8,
    maxWidth: (Dimensions.get('window').width - 80) / 3,
  },
  avatarPreview: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
  avatarLabel: {
    fontSize: 12,
    fontWeight: '500',
    textAlign: 'center',
  },
});

export default Profile;