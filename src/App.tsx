import { useCallback, useEffect, useRef, useState } from 'react';
import { io as createSocket, Socket } from 'socket.io-client';
import type { DispatchedAlertPayload } from '../server/services/alerts';
import { AppScreen, Navbar, ToastNotice, ToastStack } from './components/Navbar';
import { api, ApiError, getAuthToken, setAuthToken } from './lib/api';
import { DEFAULT_CENTER } from './lib/format';
import {
  PublicHelpRequest,
  PublicIncident,
  TimelineEntry,
  UserProfile,
  UserRole,
} from './types/saath';
import { HelpView } from './views/HelpView';
import { IncidentDetailView } from './views/IncidentDetailView';
import { LoginView } from './views/LoginView';
import { MapView } from './views/MapView';
import { OperatorView } from './views/OperatorView';
import { ReportView } from './views/ReportView';
import { RouteView } from './views/RouteView';
import { SimulatedSosEvent, SosView } from './views/SosView';

export default function App() {
  const [screen, setScreen] = useState<AppScreen>('map');
  const [loginInitialRole, setLoginInitialRole] = useState<UserRole>('citizen');
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);

  const [center, setCenter] = useState(DEFAULT_CENTER);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);

  const [incidents, setIncidents] = useState<PublicIncident[]>([]);
  const [incidentsLoading, setIncidentsLoading] = useState(true);
  const [incidentsError, setIncidentsError] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [radiusKm, setRadiusKm] = useState(5);
  const [includeStale, setIncludeStale] = useState(false);

  const [selectedIncidentId, setSelectedIncidentId] = useState<number | null>(null);
  const [selectedIncident, setSelectedIncident] = useState<PublicIncident | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [toasts, setToasts] = useState<ToastNotice[]>([]);
  const [demoPhoneAlerts, setDemoPhoneAlerts] = useState<Record<number, DispatchedAlertPayload>>({});
  const [sosEvents, setSosEvents] = useState<SimulatedSosEvent[]>([]);
  const [liveHelpRequests, setLiveHelpRequests] = useState<PublicHelpRequest[]>([]);
  const [liveRefreshTick, setLiveRefreshTick] = useState(0);

  const socketRef = useRef<Socket | null>(null);
  const fetchIncidentsRef = useRef<() => Promise<void>>(async () => {});
  const filtersRef = useRef({ categoryFilter: '', statusFilter: '', includeStale: false });
  filtersRef.current = { categoryFilter, statusFilter, includeStale };

  const pushToast = useCallback(
    (title: string, message: string, tone: ToastNotice['tone'] = 'info') => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setToasts((prev) => [{ id, title, message, tone }, ...prev].slice(0, 4));
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 6500);
    },
    [],
  );

  const fetchIncidents = useCallback(async () => {
    setIncidentsLoading(true);
    setIncidentsError(null);
    try {
      const res = await api.getIncidents({
        lat: center.lat,
        lng: center.lng,
        radius_km: radiusKm,
        category: categoryFilter || undefined,
        status: statusFilter || undefined,
        include_stale: includeStale,
      });
      setIncidents(res.incidents);
    } catch (err) {
      setIncidentsError(err instanceof Error ? err.message : 'Unable to load incidents.');
    } finally {
      setIncidentsLoading(false);
    }
  }, [center.lat, center.lng, radiusKm, categoryFilter, statusFilter, includeStale]);

  fetchIncidentsRef.current = fetchIncidents;

  useEffect(() => {
    fetchIncidents();
  }, [fetchIncidents]);

  // Restore per-tab session on reload if token is valid
  useEffect(() => {
    const existing = getAuthToken();
    if (!existing) return;
    api
      .getMe()
      .then((user) => {
        setCurrentUser(user);
        socketRef.current?.emit('auth:sync', { token: existing });
      })
      .catch(() => {
        setAuthToken(null);
      });
  }, []);

  const loadIncidentDetail = useCallback(
    async (id: number) => {
      setDetailLoading(true);
      setDetailError(null);
      try {
        const res = await api.getIncident(id, center.lat, center.lng);
        setSelectedIncident(res.incident);
      } catch (err) {
        setDetailError(err instanceof Error ? err.message : 'Unable to load incident details.');
      } finally {
        setDetailLoading(false);
      }
    },
    [center.lat, center.lng],
  );

  // Socket.IO connection & real-time event handlers (mounted once; survives filter changes)
  useEffect(() => {
    const socket = createSocket({
      transports: ['websocket', 'polling'],
      auth: (cb) => cb({ token: getAuthToken() || '' }),
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      const token = getAuthToken();
      if (token) {
        socket.emit('auth:sync', { token });
      }
      fetchIncidentsRef.current();
    });

    socket.on('incident:new', (inc: PublicIncident) => {
      const { categoryFilter: cat, statusFilter: st, includeStale: stale } = filtersRef.current;
      const matchesCat = !cat || inc.category === cat;
      const matchesSt = !st || inc.status === st;
      const matchesFresh = stale || inc.freshness !== 'stale';
      if (matchesCat && matchesSt && matchesFresh) {
        setIncidents((prev) => (prev.some((p) => p.id === inc.id) ? prev : [inc, ...prev]));
      }
      setLiveRefreshTick((t) => t + 1);
    });

    socket.on(
      'incident:status',
      (payload: {
        id: number;
        status: PublicIncident['status'];
        status_label: string;
        confirmations_count: number;
        timeline: TimelineEntry[];
      }) => {
        setIncidents((prev) => {
          const activeStatusFilter = filtersRef.current.statusFilter;
          if (payload.status === 'dismissed' && activeStatusFilter !== 'dismissed') {
            return prev.filter((item) => item.id !== payload.id);
          }
          if (activeStatusFilter && payload.status !== activeStatusFilter) {
            return prev.filter((item) => item.id !== payload.id);
          }
          return prev.map((item) =>
            item.id === payload.id
              ? {
                  ...item,
                  status: payload.status,
                  status_label: payload.status_label,
                  confirmations_count: payload.confirmations_count,
                }
              : item,
          );
        });
        setSelectedIncident((prev) =>
          prev && prev.id === payload.id
            ? {
                ...prev,
                status: payload.status,
                status_label: payload.status_label,
                confirmations_count: payload.confirmations_count,
                timeline: payload.timeline,
              }
            : prev,
        );
        setLiveRefreshTick((t) => t + 1);
      },
    );

    socket.on('alert:nearby', (payload: DispatchedAlertPayload) => {
      pushToast('Nearby Report Alert', payload.message, 'warning');
    });

    socket.on('demo_phone:alert', (payload: DispatchedAlertPayload) => {
      setDemoPhoneAlerts((prev) => ({ ...prev, [payload.recipient_user_id]: payload }));
    });

    socket.on('sos:notify', (payload: SimulatedSosEvent) => {
      setSosEvents((prev) => {
        const filtered = prev.filter((e) => e.sos_id !== payload.sos_id);
        return [payload, ...filtered];
      });
      setLiveRefreshTick((t) => t + 1);
    });

    socket.on('sos:location', (payload: { sos_id: number; lat: number; lng: number }) => {
      setSosEvents((prev) =>
        prev.map((e) =>
          e.sos_id === payload.sos_id ? { ...e, lat: payload.lat, lng: payload.lng } : e,
        ),
      );
    });

    socket.on('sos:ended', (payload: { sos_id: number }) => {
      setSosEvents((prev) => prev.filter((e) => e.sos_id !== payload.sos_id));
      setLiveHelpRequests((prev) => prev.filter((r) => r.sos_id !== payload.sos_id));
    });

    socket.on('help:closed', (payload: { sos_id: number }) => {
      setLiveHelpRequests((prev) => prev.filter((r) => r.sos_id !== payload.sos_id));
    });

    socket.on('help:request', (payload: PublicHelpRequest) => {
      setLiveHelpRequests((prev) =>
        prev.some((r) => r.id === payload.id) ? prev : [payload, ...prev],
      );
      pushToast(
        'Nearby help requested',
        'Someone nearby requested help (approximate area). Check Help Network for safe-distance guidance.',
        'warning',
      );
      setLiveRefreshTick((t) => t + 1);
    });

    socket.on('demo:reset', () => {
      setDemoPhoneAlerts({});
      setSosEvents([]);
      setLiveHelpRequests([]);
      fetchIncidentsRef.current();
      setLiveRefreshTick((t) => t + 1);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [pushToast]);

  const handleLocateMe = () => {
    if (!navigator.geolocation) {
      pushToast('Location unavailable', 'Browser geolocation is not supported; using Nagpur center.', 'info');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const next = {
          lat: Number(pos.coords.latitude.toFixed(5)),
          lng: Number(pos.coords.longitude.toFixed(5)),
        };
        setCenter(next);
        setUserLocation(next);
        if (currentUser) {
          api.updateMe({ last_lat: next.lat, last_lng: next.lng }).then(setCurrentUser).catch(() => {});
        }
      },
      () => {
        pushToast('Location denied', 'Defaulting to Nagpur center. You can still pin manually.', 'info');
      },
      { timeout: 6000 },
    );
  };

  const handleOpenDetail = (id: number) => {
    setSelectedIncidentId(id);
    setScreen('detail');
    loadIncidentDetail(id);
  };

  const handleConfirmIncident = async (id: number) => {
    if (!currentUser) {
      setLoginInitialRole('citizen');
      setScreen('login');
      pushToast('Sign in required', 'Sign in with a demo account to confirm a report.', 'info');
      return;
    }
    try {
      const res = await api.confirmIncident(id);
      setIncidents((prev) => prev.map((i) => (i.id === id ? { ...i, ...res.incident } : i)));
      if (selectedIncident?.id === id) {
        setSelectedIncident(res.incident);
      }
      pushToast(
        res.status_flipped ? 'Status updated to Community-confirmed' : 'Confirmation recorded',
        res.status_flipped
          ? 'Two distinct community confirmations reached.'
          : 'Thank you for helping verify local awareness.',
        'success',
      );
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setScreen('login');
      } else {
        pushToast('Confirmation notice', err instanceof Error ? err.message : 'Unable to confirm.', 'error');
      }
      throw err;
    }
  };

  const handleUpdateProfile = async (patch: Partial<UserProfile>) => {
    if (!currentUser) return;
    try {
      const updated = await api.updateMe(patch);
      setCurrentUser(updated);
    } catch (err) {
      pushToast('Settings error', err instanceof Error ? err.message : 'Could not save setting.', 'error');
    }
  };

  const handleLoginSuccess = (token: string, user: UserProfile) => {
    setAuthToken(token);
    setCurrentUser(user);
    socketRef.current?.emit('auth:sync', { token });
    pushToast('Signed in', `Active session: ${user.display_name} (${user.role}).`, 'success');
    setScreen(user.role === 'operator' ? 'operator' : 'map');
  };

  const handleLogout = async () => {
    await api.logout().catch(() => {});
    setAuthToken(null);
    setCurrentUser(null);
    socketRef.current?.emit('auth:sync', { token: '' });
    pushToast('Signed out', 'Session cleared.', 'info');
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      <Navbar
        activeScreen={screen}
        onNavigate={(next) => {
          if (next === 'login') setLoginInitialRole('citizen');
          setScreen(next);
        }}
      />

      <ToastStack
        toasts={toasts}
        onDismiss={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 pb-24 md:pb-10">
        {screen === 'map' && (
          <MapView
            center={center}
            userLocation={userLocation}
            incidents={incidents}
            loading={incidentsLoading}
            error={incidentsError}
            categoryFilter={categoryFilter}
            statusFilter={statusFilter}
            radiusKm={radiusKm}
            includeStale={includeStale}
            currentUser={currentUser}
            onChangeCategory={setCategoryFilter}
            onChangeStatus={setStatusFilter}
            onChangeRadius={setRadiusKm}
            onChangeIncludeStale={setIncludeStale}
            onLocateMe={handleLocateMe}
            onRefresh={fetchIncidents}
            onSelectIncident={handleOpenDetail}
            onConfirmIncident={(id) => {
              handleConfirmIncident(id).catch(() => {});
            }}
            onToggleAlertOptIn={(val) => handleUpdateProfile({ alerts_opt_in: val })}
            onChangeAlertRadius={(r) => handleUpdateProfile({ alert_radius_km: r })}
            onNavigate={setScreen}
          />
        )}

        {screen === 'report' && (
          <ReportView
            defaultCenter={userLocation || center}
            currentUser={currentUser}
            onBack={() => setScreen('map')}
            onRequireLogin={() => {
              setLoginInitialRole('citizen');
              setScreen('login');
            }}
            onCreated={(created) => {
              setIncidents((prev) =>
                prev.some((p) => p.id === created.id) ? prev : [created, ...prev],
              );
              pushToast(
                'Report submitted',
                'Saved as Unverified. AI triage completed and nearby opted-in alerts dispatched.',
                'success',
              );
              handleOpenDetail(created.id);
            }}
          />
        )}

        {screen === 'detail' && (
          <IncidentDetailView
            incident={selectedIncident}
            loading={detailLoading}
            error={detailError}
            onBack={() => setScreen('map')}
            onConfirm={handleConfirmIncident}
          />
        )}

        {screen === 'routes' && (
          <RouteView
            origin={userLocation || center}
            onSelectIncident={handleOpenDetail}
          />
        )}

        {screen === 'sos' && (
          <SosView
            currentUser={currentUser}
            currentLocation={userLocation || center}
            sosEvents={sosEvents}
            onRequireLogin={() => {
              setLoginInitialRole('citizen');
              setScreen('login');
            }}
            onNotifyToast={pushToast}
          />
        )}

        {screen === 'help' && (
          <HelpView
            currentUser={currentUser}
            currentLocation={userLocation || center}
            liveHelpRequests={liveHelpRequests}
            onToggleHelpOptIn={(val) => handleUpdateProfile({ help_opt_in: val })}
            onRequireLogin={() => {
              setLoginInitialRole('citizen');
              setScreen('login');
            }}
            onNotifyToast={pushToast}
          />
        )}

        {screen === 'operator' && (
          <OperatorView
            currentUser={currentUser}
            demoPhoneAlerts={demoPhoneAlerts}
            liveRefreshTick={liveRefreshTick}
            onRequireOperatorLogin={() => {
              setLoginInitialRole('operator');
              setScreen('login');
            }}
            onDemoResetDone={fetchIncidents}
            onNotifyToast={pushToast}
          />
        )}

        {screen === 'login' && (
          <LoginView
            currentUser={currentUser}
            initialRole={loginInitialRole}
            onLoginSuccess={handleLoginSuccess}
            onLogout={handleLogout}
            onUpdateProfile={handleUpdateProfile}
          />
        )}
      </main>

      {/* Persistent Honest-Limit Footer Disclaimer */}
      <footer className="border-t border-slate-200 bg-white text-xs text-slate-600 py-4 px-4 sm:px-6 mb-14 md:mb-0">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
          <span>
            SAATH Civic Pulse &amp; Public Information Prototype · Simulated alerts &amp; demo routes · Not a replacement for emergency services (India: 112).
          </span>
          <span className="text-slate-500">
            Seed data and CCTV references are synthetic.
          </span>
        </div>
      </footer>
    </div>
  );
}
