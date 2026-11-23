import { AlertTriangle, HandHelping, MapPin, PhoneCall, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { SosSession, TrustedContact, UserProfile } from '../types/saath';
import { api } from '../lib/api';
import { formatTimeStamp } from '../lib/format';

export interface SimulatedSosEvent {
  sos_id: number;
  user_display_name: string;
  lat: number;
  lng: number;
  started_at: string;
  sharing_expires_at: string;
  notified_contacts: Array<{ id: number; name: string }>;
}

interface SosViewProps {
  currentUser: UserProfile | null;
  currentLocation: { lat: number; lng: number };
  sosEvents: SimulatedSosEvent[];
  onRequireLogin: () => void;
  onNotifyToast: (title: string, message: string, tone: 'info' | 'warning' | 'success' | 'error') => void;
}

export function SosView({
  currentUser,
  currentLocation,
  sosEvents,
  onRequireLogin,
  onNotifyToast,
}: SosViewProps) {
  const [activeSos, setActiveSos] = useState<SosSession | null>(null);
  const [contacts, setContacts] = useState<TrustedContact[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [countdownSec, setCountdownSec] = useState<number>(0);
  const [helpSentCount, setHelpSentCount] = useState<number | null>(null);

  useEffect(() => {
    if (!currentUser) {
      setActiveSos(null);
      setContacts([]);
      return;
    }

    api
      .getActiveSos()
      .then((res) => setActiveSos(res.sos))
      .catch(() => {});

    api
      .getContacts()
      .then((res) => setContacts(res.contacts))
      .catch(() => {});
  }, [currentUser?.id]);

  // Countdown timer while SOS active
  useEffect(() => {
    if (!activeSos || activeSos.status !== 'active') {
      setCountdownSec(0);
      return;
    }
    const updateCountdown = () => {
      const remaining = Math.max(
        0,
        Math.floor((new Date(activeSos.sharing_expires_at).getTime() - Date.now()) / 1000),
      );
      setCountdownSec(remaining);
      if (remaining === 0) {
        setActiveSos((prev) => (prev ? { ...prev, expired: true } : prev));
      }
    };
    updateCountdown();
    const id = window.setInterval(updateCountdown, 1000);
    return () => window.clearInterval(id);
  }, [activeSos?.id, activeSos?.status, activeSos?.sharing_expires_at]);

  // Browser watchPosition while SOS is active & unexpired
  useEffect(() => {
    if (!activeSos || activeSos.status !== 'active' || activeSos.expired) return;
    if (!navigator.geolocation) return;

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        api
          .updateSosLocation(
            activeSos.id,
            Number(pos.coords.latitude.toFixed(5)),
            Number(pos.coords.longitude.toFixed(5)),
          )
          .then((res) => setActiveSos(res.sos))
          .catch(() => {});
      },
      () => {
        // Ignore geolocation errors silently; user can use simulated movement in demo
      },
      { enableHighAccuracy: false, maximumAge: 10000 },
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [activeSos?.id, activeSos?.status, activeSos?.expired]);

  const handleConfirmStart = async () => {
    setConfirmOpen(false);
    if (!currentUser) {
      onRequireLogin();
      return;
    }
    setLoading(true);
    setError(null);
    setHelpSentCount(null);
    try {
      const res = await api.startSos(currentLocation.lat, currentLocation.lng);
      setActiveSos(res.sos);
      onNotifyToast(
        'SOS live sharing started',
        'Simulated notifications sent to your trusted contacts for 15 minutes.',
        'warning',
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to start SOS session.');
    } finally {
      setLoading(false);
    }
  };

  const handleSimulateMove = async () => {
    if (!activeSos) return;
    setError(null);
    try {
      const nextLat = Number((activeSos.lat + 0.0008).toFixed(5));
      const nextLng = Number((activeSos.lng + 0.0006).toFixed(5));
      const res = await api.updateSosLocation(activeSos.id, nextLat, nextLng);
      setActiveSos(res.sos);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update SOS location.');
    }
  };

  const handleEndSos = async (status: 'cancelled' | 'resolved') => {
    if (!activeSos) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.cancelSos(activeSos.id, status);
      setActiveSos(res.sos);
      onNotifyToast(
        status === 'resolved' ? 'SOS marked resolved' : 'SOS cancelled',
        'Live location sharing has stopped.',
        'success',
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not end SOS session.');
    } finally {
      setLoading(false);
    }
  };

  const handleAskHelpers = async () => {
    if (!activeSos) return;
    setError(null);
    try {
      const res = await api.createHelpRequest(activeSos.id);
      setHelpSentCount(res.recipients_count);
      onNotifyToast(
        'Nearby help request sent',
        `Approximate area shared with ${res.recipients_count} opted-in helper(s) within 2 km.`,
        'info',
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send help request.');
    }
  };

  const mins = Math.floor(countdownSec / 60);
  const secs = countdownSec % 60;

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      {/* Mandatory SOS Disclaimer */}
      <div className="bg-red-50 border border-red-300 rounded-xl p-4 flex items-start gap-3">
        <PhoneCall className="w-5 h-5 text-red-700 mt-0.5 shrink-0" />
        <div className="text-sm text-red-950">
          <span className="font-bold">Prototype — call 112 for real emergencies.</span>{' '}
          <span>
            SOS notifications and helper alerts are simulated in this demo and do not dispatch police, ambulance, or SMS gateways.
          </span>
        </div>
      </div>

      {error && (
        <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-xs text-red-800">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 space-y-5">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Emergency SOS</h1>
            <p className="text-sm text-slate-600 mt-1">
              Share your live location with trusted contacts for up to 15 minutes. Sharing stops automatically when the timer expires or when you mark yourself safe.
            </p>
          </div>

          {!currentUser && (
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 flex items-center justify-between gap-3">
              <span className="text-xs text-slate-700">
                Sign in (e.g., as Asha who has 2 trusted contacts) to test SOS.
              </span>
              <button
                type="button"
                onClick={onRequireLogin}
                className="px-3.5 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold cursor-pointer shrink-0"
              >
                Sign in
              </button>
            </div>
          )}

          {(!activeSos || activeSos.status !== 'active' || activeSos.expired) ? (
            <div className="space-y-4">
              {activeSos?.expired && activeSos.status === 'active' && (
                <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900">
                  Your previous SOS sharing window expired automatically.
                </div>
              )}

              <button
                type="button"
                disabled={loading}
                onClick={() => (currentUser ? setConfirmOpen(true) : onRequireLogin())}
                className="w-full min-h-[64px] px-6 py-4 rounded-xl bg-red-600 hover:bg-red-700 text-white text-lg font-bold tracking-tight flex items-center justify-center gap-3 cursor-pointer transition-colors disabled:opacity-50"
              >
                <AlertTriangle className="w-6 h-6" />
                <span>Start Emergency SOS</span>
              </button>

              {confirmOpen && (
                <div className="border border-red-200 bg-red-50/70 rounded-xl p-4 space-y-3">
                  <p className="text-sm font-semibold text-slate-900">
                    Confirm SOS live sharing for 15 minutes?
                  </p>
                  <p className="text-xs text-slate-700">
                    This notifies your {contacts.length} trusted contact(s) in the simulated demo panel and shares your coordinates until cancelled or expired.
                  </p>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={handleConfirmStart}
                      className="px-4 py-2.5 min-h-[44px] rounded-lg bg-red-600 text-white text-xs font-semibold hover:bg-red-700 cursor-pointer"
                    >
                      Yes, start SOS sharing
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmOpen(false)}
                      className="px-4 py-2.5 min-h-[44px] rounded-lg border border-slate-300 bg-white text-xs font-medium text-slate-700 cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4 border border-red-200 bg-red-50/40 rounded-xl p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold text-red-700">SOS SHARING ACTIVE</div>
                  <div className="text-2xl font-bold font-mono text-slate-900 tabular-nums mt-0.5">
                    {String(mins).padStart(2, '0')}:{String(secs).padStart(2, '0')} remaining
                  </div>
                </div>
                <span className="text-xs font-mono text-slate-600 tabular-nums">
                  {activeSos.lat.toFixed(4)}, {activeSos.lng.toFixed(4)}
                </span>
              </div>

              <div className="text-xs text-slate-700">
                Trusted contacts notified (simulated):{' '}
                {activeSos.notified_contacts.length > 0
                  ? activeSos.notified_contacts.map((c) => c.name).join(', ')
                  : 'No trusted contacts configured'}
              </div>

              <div className="flex flex-wrap gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={handleAskHelpers}
                  className="inline-flex items-center gap-2 px-4 py-2.5 min-h-[44px] rounded-lg bg-blue-700 text-white text-xs font-semibold hover:bg-blue-800 cursor-pointer"
                >
                  <HandHelping className="w-4 h-4" />
                  <span>Ask nearby opted-in helpers</span>
                </button>

                <button
                  type="button"
                  onClick={handleSimulateMove}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2.5 min-h-[44px] rounded-lg border border-slate-300 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  <MapPin className="w-4 h-4" />
                  <span>Simulate location ping</span>
                </button>
              </div>

              {helpSentCount !== null && (
                <p className="text-xs text-blue-800 font-medium">
                  Approximate area (~300 m) shared with {helpSentCount} opted-in helper(s) within 2 km.
                </p>
              )}

              <div className="pt-3 border-t border-red-200/70 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => handleEndSos('cancelled')}
                  className="inline-flex items-center gap-2 px-4 py-2.5 min-h-[44px] rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 cursor-pointer"
                >
                  <ShieldCheck className="w-4 h-4" />
                  <span>Cancel / I&apos;m safe</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleEndSos('resolved')}
                  className="px-4 py-2.5 min-h-[44px] rounded-lg border border-slate-300 bg-white text-xs font-medium text-slate-800 hover:bg-slate-50 cursor-pointer"
                >
                  Mark resolved
                </button>
              </div>
            </div>
          )}

          <div className="pt-2 border-t border-slate-100">
            <h2 className="text-xs font-semibold text-slate-700 mb-2">
              Your Trusted Contacts ({contacts.length})
            </h2>
            {contacts.length === 0 ? (
              <p className="text-xs text-slate-500">
                No trusted contacts saved yet. Add contacts in Account settings.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100 text-xs">
                {contacts.map((c) => (
                  <li key={c.id} className="py-1.5 flex items-center justify-between">
                    <span className="font-medium text-slate-800">{c.name}</span>
                    <span className="font-mono text-slate-500">{c.contact}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Simulated Trusted Contact Notification Panel */}
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">
              Trusted Contact Panel (Simulated)
            </h2>
            <span className="text-[11px] font-mono text-slate-500">Socket.IO live</span>
          </div>
          <p className="text-xs text-slate-500">
            Simulated delivery feed received by trusted contacts when SOS starts or updates coordinates.
          </p>

          {sosEvents.length === 0 ? (
            <div className="p-6 text-center bg-slate-50 rounded-lg border border-slate-100 text-xs text-slate-500">
              No SOS notifications triggered in this session yet.
            </div>
          ) : (
            <div className="space-y-2.5 max-h-[360px] overflow-y-auto">
              {sosEvents.map((ev) => (
                <div key={ev.sos_id} className="p-3 rounded-lg border border-red-200 bg-red-50/50 space-y-1">
                  <div className="text-xs font-semibold text-red-900">
                    SOS from {ev.user_display_name} · Session #{ev.sos_id}
                  </div>
                  <div className="text-xs font-mono text-slate-700 tabular-nums">
                    Live coords: {ev.lat.toFixed(4)}, {ev.lng.toFixed(4)}
                  </div>
                  <div className="text-[11px] text-slate-600">
                    Notified: {ev.notified_contacts.map((c) => c.name).join(', ') || 'None'}
                  </div>
                  <div className="text-[11px] text-slate-500 tabular-nums">
                    Expires {formatTimeStamp(ev.sharing_expires_at)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
