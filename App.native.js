import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, Alert, AppState } from 'react-native';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ─── Background Location Task ───
const BACKGROUND_LOCATION_TASK = 'casevault-background-location';
const STORAGE_KEY = '@casevault_tracking_session';

// This runs even when the app is backgrounded/screen locked
TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }) => {
  if (error) {
    console.error('Background location error:', error);
    return;
  }
  if (data) {
    const { locations } = data;
    if (locations && locations.length > 0) {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        const session = raw ? JSON.parse(raw) : null;
        if (session && session.active) {
          const newPositions = locations.map(loc => ({
            lat: loc.coords.latitude,
            lng: loc.coords.longitude,
            accuracy: loc.coords.accuracy,
            speed: loc.coords.speed,
            time: loc.timestamp,
          }));

          // Calculate distance for new points
          let addedDistance = 0;
          const allPositions = [...(session.positions || [])];
          
          for (const pos of newPositions) {
            if (allPositions.length > 0) {
              const last = allPositions[allPositions.length - 1];
              const d = haversine(last.lat, last.lng, pos.lat, pos.lng);
              // Filter jitter: > 26ft (0.005 mi) and reasonable accuracy
              if (d > 0.005 && pos.accuracy < 50) {
                addedDistance += d;
                allPositions.push(pos);
              }
            } else {
              allPositions.push(pos);
            }
          }

          session.positions = allPositions;
          session.distance = (session.distance || 0) + addedDistance;
          session.lastUpdate = Date.now();
          
          await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(session));
        }
      } catch (e) {
        console.error('Error saving background location:', e);
      }
    }
  }
});

// Haversine formula — miles
function haversine(lat1, lon1, lat2, lon2) {
  const R = 3959;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatTime(s) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
}

export default function App() {
  const [tracking, setTracking] = useState(false);
  const [mode, setMode] = useState(null); // 'gps' | 'timer'
  const [elapsed, setElapsed] = useState(0);
  const [distance, setDistance] = useState(0);
  const [positions, setPositions] = useState([]);
  const [currentPos, setCurrentPos] = useState(null);
  const [gpsStatus, setGpsStatus] = useState('idle');
  const [logs, setLogs] = useState([]);
  const startTimeRef = useRef(null);
  const timerRef = useRef(null);
  const foregroundSubRef = useRef(null);

  const addLog = (msg) => {
    setLogs(prev => [`${new Date().toLocaleTimeString()} — ${msg}`, ...prev].slice(0, 50));
  };

  // Poll AsyncStorage for background updates
  useEffect(() => {
    if (!tracking || mode !== 'gps') return;
    
    const pollInterval = setInterval(async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) {
          const session = JSON.parse(raw);
          if (session.active) {
            setDistance(session.distance || 0);
            setPositions(session.positions || []);
            if (session.positions?.length > 0) {
              const last = session.positions[session.positions.length - 1];
              setCurrentPos(last);
            }
          }
        }
      } catch (e) {}
    }, 2000);

    return () => clearInterval(pollInterval);
  }, [tracking, mode]);

  // Timer — uses timestamps, survives background
  useEffect(() => {
    if (!tracking) return;
    timerRef.current = setInterval(() => {
      if (startTimeRef.current) {
        setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [tracking]);

  // Listen for app state changes
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && tracking && startTimeRef.current) {
        // Recalculate elapsed when coming back
        setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
        addLog('App returned to foreground');
      }
    });
    return () => sub?.remove();
  }, [tracking]);

  // Recover session on mount
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) {
          const session = JSON.parse(raw);
          if (session.active && session.startTime) {
            const age = Date.now() - session.startTime;
            if (age < 24 * 60 * 60 * 1000) {
              Alert.alert(
                'Active Session Found',
                `Found a tracking session (${formatTime(Math.floor(age / 1000))} elapsed, ${(session.distance || 0).toFixed(2)} mi). Resume it?`,
                [
                  { text: 'Discard', onPress: () => clearSession(), style: 'destructive' },
                  { text: 'Resume', onPress: () => resumeSession(session) },
                ]
              );
            } else {
              await clearSession();
            }
          }
        }
      } catch (e) {}
    })();
  }, []);

  const clearSession = async () => {
    await AsyncStorage.removeItem(STORAGE_KEY);
    const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_LOCATION_TASK);
    if (isRegistered) {
      await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
    }
  };

  const resumeSession = async (session) => {
    setMode(session.mode);
    setTracking(true);
    setDistance(session.distance || 0);
    setPositions(session.positions || []);
    startTimeRef.current = session.startTime;
    setElapsed(Math.floor((Date.now() - session.startTime) / 1000));
    
    if (session.mode === 'gps') {
      await startBackgroundLocation();
    }
    addLog('Session resumed');
  };

  const startBackgroundLocation = async () => {
    try {
      const { status: bgStatus } = await Location.requestBackgroundPermissionsAsync();
      if (bgStatus === 'granted') {
        const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_LOCATION_TASK);
        if (!isRegistered) {
          await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
            accuracy: Location.Accuracy.High,
            distanceInterval: 10,
            timeInterval: 5000,
            showsBackgroundLocationIndicator: true,
            foregroundService: {
              notificationTitle: 'CaseVault Tracking',
              notificationBody: 'GPS mileage tracking is active',
              notificationColor: '#00ff00',
            },
          });
        }
        addLog('Background GPS enabled');
        return true;
      } else {
        addLog('Background GPS not available — foreground only');
        return false;
      }
    } catch (e) {
      addLog('Background GPS error: ' + e.message);
      return false;
    }
  };

  const startTracking = async (trackMode) => {
    try {
      // Request foreground permission
      const { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
      if (fgStatus !== 'granted') {
        Alert.alert('Permission Denied', 'CaseVault needs location access to track mileage.');
        return;
      }

      // Start tracking immediately — don't block on background permission
      await startTrackingInner(trackMode);

      // Try to enable background location as a bonus (non-blocking)
      if (trackMode === 'gps') {
        startBackgroundLocation();
      }
    } catch (e) {
      addLog('Start error: ' + e.message);
      Alert.alert('Error', 'Failed to start tracking: ' + e.message);
    }
  };

  const startTrackingInner = async (trackMode) => {
    setMode(trackMode);
    setTracking(true);
    setDistance(0);
    setElapsed(0);
    setPositions([]);
    setGpsStatus('idle');
    startTimeRef.current = Date.now();

    // Save session
    const session = {
      active: true,
      mode: trackMode,
      startTime: Date.now(),
      distance: 0,
      positions: [],
      caseId: null,
    };
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(session));

    if (trackMode === 'gps') {
      // Start foreground GPS subscription for live updates
      try {
        foregroundSubRef.current = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.High, distanceInterval: 5 },
          (loc) => {
            const newPos = {
              lat: loc.coords.latitude,
              lng: loc.coords.longitude,
              accuracy: loc.coords.accuracy,
              speed: loc.coords.speed,
            };
            setCurrentPos(newPos);
            setGpsStatus('active');

            // Update distance in foreground
            setPositions((prev) => {
              if (prev.length > 0) {
                const last = prev[prev.length - 1];
                const d = haversine(last.lat, last.lng, newPos.lat, newPos.lng);
                if (d > 0.005 && loc.coords.accuracy < 50) {
                  setDistance((prevDist) => {
                    const updated = prevDist + d;
                    // Persist to storage
                    AsyncStorage.getItem(STORAGE_KEY).then(raw => {
                      if (raw) {
                        const s = JSON.parse(raw);
                        s.distance = updated;
                        s.positions = [...(s.positions || []), newPos];
                        AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(s));
                      }
                    }).catch(() => {});
                    return updated;
                  });
                  return [...prev, newPos];
                }
                return prev;
              }
              return [newPos];
            });
          }
        );
        setGpsStatus('active');
        addLog('Foreground GPS started');
      } catch (e) {
        setGpsStatus('error');
        addLog('GPS error: ' + e.message);
      }
    }

    try { await activateKeepAwakeAsync(); } catch (e) {}
    addLog(`Tracking started: ${trackMode === 'gps' ? 'GPS + Timer' : 'Timer only'}`);
  };

  const stopTracking = async () => {
    setTracking(false);
    setMode(null);

    if (timerRef.current) clearInterval(timerRef.current);
    if (foregroundSubRef.current) {
      foregroundSubRef.current.remove();
      foregroundSubRef.current = null;
    }

    // Stop background location
    const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_LOCATION_TASK);
    if (isRegistered) {
      await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
    }

    // Get final data from storage
    let finalDistance = distance;
    let finalPositions = positions;
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        const session = JSON.parse(raw);
        finalDistance = session.distance || distance;
        finalPositions = session.positions || positions;
      }
    } catch (e) {}

    const finalElapsed = startTimeRef.current
      ? Math.floor((Date.now() - startTimeRef.current) / 1000)
      : elapsed;

    setDistance(finalDistance);
    setElapsed(finalElapsed);
    setGpsStatus('idle');

    try { deactivateKeepAwake(); } catch (e) {}
    await AsyncStorage.removeItem(STORAGE_KEY);
    
    addLog(`Stopped: ${finalDistance.toFixed(2)} mi, ${formatTime(finalElapsed)}, ${finalPositions.length} GPS points`);
    
    Alert.alert(
      'Tracking Complete',
      `Time: ${formatTime(finalElapsed)}\nDistance: ${finalDistance.toFixed(2)} miles\nGPS Points: ${finalPositions.length}`,
      [{ text: 'OK' }]
    );

    startTimeRef.current = null;
  };

  const statusColors = { idle: '#555', active: '#0f0', paused: '#f90', error: '#f44' };

  return (
    <View style={s.container}>
      <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent}>
        {/* Header */}
        <Text style={s.logo}>◈ CASEVAULT</Text>
        <Text style={s.subtitle}>Background GPS Tracker — Proof of Concept</Text>

        {/* Stats */}
        <View style={s.statsRow}>
          <View style={s.statBox}>
            <Text style={[s.statValue, { color: mode === 'gps' ? '#0f0' : '#555' }]}>
              {mode === 'gps' ? distance.toFixed(2) : '—'}
            </Text>
            <Text style={s.statLabel}>MILES</Text>
          </View>
          <View style={s.statBox}>
            <Text style={[s.statValue, { color: '#4af' }]}>{formatTime(elapsed)}</Text>
            <Text style={s.statLabel}>ELAPSED</Text>
          </View>
          <View style={s.statBox}>
            <Text style={[s.statValue, { color: '#f90' }]}>
              {currentPos ? currentPos.lat.toFixed(4) : '—'}
            </Text>
            <Text style={s.statLabel}>LATITUDE</Text>
          </View>
        </View>

        {/* GPS Status */}
        {tracking && (
          <View style={s.statusBar}>
            <View style={[s.statusDot, { backgroundColor: statusColors[gpsStatus] }]} />
            <Text style={[s.statusText, { color: statusColors[gpsStatus] }]}>
              {mode === 'gps'
                ? gpsStatus === 'active' ? 'GPS Active — Background Tracking On' : 'GPS Connecting...'
                : 'Timer Only — No GPS'}
            </Text>
          </View>
        )}

        {/* GPS Accuracy */}
        {tracking && mode === 'gps' && currentPos?.accuracy && (
          <Text style={[s.accuracy, {
            color: currentPos.accuracy < 20 ? '#0f0' : currentPos.accuracy < 50 ? '#f90' : '#f44'
          }]}>
            Accuracy: ±{Math.round(currentPos.accuracy)}m • {positions.length} points
            {currentPos.speed > 0 ? ` • ${(currentPos.speed * 2.237).toFixed(0)} mph` : ''}
          </Text>
        )}

        {/* Controls */}
        {!tracking ? (
          <View style={s.controls}>
            <TouchableOpacity style={s.btnPrimary} onPress={() => startTracking('gps')}>
              <Text style={s.btnPrimaryText}>📍 Start with GPS</Text>
              <Text style={s.btnSubtext}>Time + Location + Mileage</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.btnSecondary} onPress={() => startTracking('timer')}>
              <Text style={s.btnSecondaryText}>⏱️ Timer Only</Text>
              <Text style={s.btnSubtextDim}>Time tracking, no GPS</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity style={s.btnStop} onPress={stopTracking}>
            <Text style={s.btnStopText}>⏹ Stop & Save</Text>
          </TouchableOpacity>
        )}

        {/* Info */}
        {tracking && mode === 'gps' && (
          <View style={s.infoBox}>
            <Text style={s.infoText}>
              GPS tracking continues in the background — lock your phone, switch to Maps, make calls. 
              Mileage keeps accumulating. Come back anytime to check progress.
            </Text>
          </View>
        )}

        {/* Log */}
        <Text style={s.logTitle}>Activity Log</Text>
        {logs.length === 0 ? (
          <Text style={s.logEmpty}>No activity yet. Start tracking to begin.</Text>
        ) : (
          logs.map((log, i) => (
            <Text key={i} style={s.logEntry}>{log}</Text>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0b0f',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingTop: 60,
    paddingBottom: 40,
  },
  logo: {
    fontFamily: 'monospace',
    fontSize: 16,
    fontWeight: '700',
    color: '#0f0',
    letterSpacing: 3,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 12,
    color: '#666',
    marginBottom: 24,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 20,
  },
  statBox: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderRadius: 10,
    padding: 16,
    alignItems: 'center',
  },
  statValue: {
    fontFamily: 'monospace',
    fontSize: 22,
    fontWeight: '700',
  },
  statLabel: {
    fontSize: 10,
    color: '#666',
    letterSpacing: 1,
    marginTop: 4,
  },
  statusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusText: {
    fontSize: 12,
    fontFamily: 'monospace',
  },
  accuracy: {
    fontSize: 11,
    fontFamily: 'monospace',
    marginBottom: 16,
    paddingHorizontal: 4,
  },
  controls: {
    gap: 10,
    marginBottom: 20,
  },
  btnPrimary: {
    backgroundColor: 'rgba(0,255,0,0.1)',
    borderWidth: 1,
    borderColor: '#0f0',
    borderRadius: 10,
    padding: 18,
    alignItems: 'center',
  },
  btnPrimaryText: {
    color: '#0f0',
    fontSize: 16,
    fontWeight: '700',
  },
  btnSubtext: {
    color: 'rgba(0,255,0,0.5)',
    fontSize: 11,
    marginTop: 4,
  },
  btnSecondary: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 10,
    padding: 18,
    alignItems: 'center',
  },
  btnSecondaryText: {
    color: '#aaa',
    fontSize: 16,
    fontWeight: '600',
  },
  btnSubtextDim: {
    color: '#555',
    fontSize: 11,
    marginTop: 4,
  },
  btnStop: {
    backgroundColor: 'rgba(255,68,68,0.1)',
    borderWidth: 1,
    borderColor: '#f44',
    borderRadius: 10,
    padding: 18,
    alignItems: 'center',
    marginBottom: 20,
  },
  btnStopText: {
    color: '#f44',
    fontSize: 16,
    fontWeight: '700',
  },
  infoBox: {
    backgroundColor: 'rgba(74,170,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(74,170,255,0.15)',
    borderRadius: 8,
    padding: 12,
    marginBottom: 20,
  },
  infoText: {
    color: '#4af',
    fontSize: 12,
    lineHeight: 18,
  },
  logTitle: {
    color: '#0f0',
    fontSize: 12,
    fontWeight: '700',
    fontFamily: 'monospace',
    letterSpacing: 1,
    marginBottom: 10,
    textTransform: 'uppercase',
  },
  logEmpty: {
    color: '#444',
    fontSize: 12,
  },
  logEntry: {
    color: '#888',
    fontSize: 11,
    fontFamily: 'monospace',
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.03)',
  },
});
