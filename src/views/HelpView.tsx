import { HandHelping, PhoneCall, RefreshCw, ShieldAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { PublicHelpRequest, UserProfile } from '../types/saath';
import { api } from '../lib/api';
import { formatRelativeTime } from '../lib/format';

interface HelpViewProps {
  currentUser: UserProfile | null;
  currentLocation: { lat: number; lng: number };
  liveHelpRequests: PublicHelpRequest[];
  onToggleHelpOptIn: (optIn: boolean) => Promise<void>;
  onRequireLogin: () => void;
  onNotifyToast: (title: string, message: string, tone: 'info' | 'warning' | 'success' | 'error') => void;
}

export function HelpView({
  currentUser,
  currentLocation,
  liveHelpRequests,
  onToggleHelpOptIn,
  onRequireLogin,
  onNotifyToast,
}: HelpViewProps) {
  const [requests, setRequests] = useState<PublicHelpRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [respondedIds, setRespondedIds] = useState<Record<number, string>>({});

  const loadNearby = async () => {
    if (!currentUser) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.getNearbyHelpRequests(currentLocation.lat, currentLocation.lng);
      setRequests(res.requests);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load help requests.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadNearby();
  }, [currentUser?.id, currentUser?.help_opt_in, liveHelpRequests.length]);

  const handleRespond = async (id: number, action: 'called_112' | 'dismissed') => {
    try {
      await api.respondHelpRequest(id, action);
      setRespondedIds((prev) => ({ ...prev, [id]: action }));
      onNotifyToast(
        action === 'called_112' ? 'Response recorded' : 'Request dismissed',
        action === 'called_112'
          ? 'Thank you for contacting emergency services first.'
          : 'This request has been hidden from your view.',
        'success',
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit response.');
    }
  };

  // Merge REST requests + live socket requests idempotently
  const merged = [...requests];
  for (const live of liveHelpRequests) {
    if (!merged.some((r) => r.id === live.id)) {
      merged.unshift(live);
    }
  }
  const visible = merged.filter((r) => respondedIds[r.id] !== 'dismissed');

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <div className="border-b border-slate-200 pb-4 flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Opt-In Nearby Help Network</h1>
          <p className="text-sm text-slate-600 mt-1">
            Opt-in helpers within 2 km receive approximate-area requests (~300 m) with zero personal identity exposed.
          </p>
        </div>
        {currentUser && (
          <button
            type="button"
            onClick={loadNearby}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer self-start sm:self-auto"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        )}
      </div>

      {/* Mandatory Safe-Distance Guidance */}
      <div className="bg-amber-50 border border-amber-300 rounded-xl p-4 flex items-start gap-3">
        <ShieldAlert className="w-5 h-5 text-amber-700 mt-0.5 shrink-0" />
        <div className="text-xs sm:text-sm text-amber-950 leading-relaxed">
          <span className="font-semibold">Safety rule for helpers: </span>
          Call emergency services first (112). Assist only from a safe distance. Do not confront anyone or enter unsafe places.
        </div>
      </div>

      {!currentUser ? (
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center space-y-3">
          <p className="text-sm font-medium text-slate-800">
            Sign in to opt in as a nearby community helper.
          </p>
          <button
            type="button"
            onClick={onRequireLogin}
            className="px-4 py-2.5 text-xs font-semibold bg-slate-900 text-white rounded-lg hover:bg-slate-800 cursor-pointer"
          >
            Sign in (Demo)
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-slate-900">
                Receive approximate-area help requests (within 2 km)
              </div>
              <div className="text-xs text-slate-500 mt-0.5">
                Signed in as {currentUser.display_name}. You can turn this off at any time.
              </div>
            </div>
            <label className="inline-flex items-center gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={currentUser.help_opt_in}
                onChange={(e) => onToggleHelpOptIn(e.target.checked)}
                className="w-5 h-5 rounded border-slate-300 text-blue-700"
              />
              <span className="text-sm font-semibold text-slate-900">
                {currentUser.help_opt_in ? 'Opted in' : 'Opted out'}
              </span>
            </label>
          </div>

          {error && (
            <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-xs text-red-800">
              {error}
            </div>
          )}

          {!currentUser.help_opt_in ? (
            <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-600">
              You are currently opted out of nearby help requests. Toggle the switch above if you wish to participate.
            </div>
          ) : loading ? (
            <div className="bg-white border border-slate-200 rounded-xl p-6 animate-pulse space-y-3">
              <div className="h-4 w-1/3 bg-slate-200 rounded" />
              <div className="h-12 w-full bg-slate-100 rounded" />
            </div>
          ) : visible.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-8 text-center space-y-2">
              <HandHelping className="w-7 h-7 text-slate-400 mx-auto" />
              <p className="text-sm font-medium text-slate-800">
                No nearby helpers needed right now.
              </p>
              <p className="text-xs text-slate-500">
                For any real emergency, call 112 immediately.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {visible.map((req) => (
                <article
                  key={req.id}
                  className="bg-white border border-slate-200 rounded-xl p-5 space-y-3"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <h2 className="text-base font-semibold text-slate-900">
                      Someone nearby has requested help (approx. area)
                    </h2>
                    <span className="text-xs font-mono text-slate-500 tabular-nums">
                      {req.distance_km !== undefined ? `${req.distance_km.toFixed(1)} km away · ` : ''}
                      {formatRelativeTime(req.created_at)}
                    </span>
                  </div>

                  <div className="text-xs font-mono text-slate-600 tabular-nums">
                    Approximate coordinates (~300 m): {req.approx_lat.toFixed(4)}, {req.approx_lng.toFixed(4)} · Identity hidden for privacy
                  </div>

                  <p className="text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-lg p-3">
                    {req.guidance}
                  </p>

                  {respondedIds[req.id] === 'called_112' ? (
                    <div className="text-xs font-semibold text-emerald-700">
                      Recorded: You contacted emergency services (112).
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2.5 pt-1">
                      <button
                        type="button"
                        onClick={() => handleRespond(req.id, 'called_112')}
                        className="inline-flex items-center gap-1.5 px-4 py-2 min-h-[40px] rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 cursor-pointer"
                      >
                        <PhoneCall className="w-3.5 h-3.5" />
                        <span>I&apos;ve contacted emergency services</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRespond(req.id, 'dismissed')}
                        className="px-4 py-2 min-h-[40px] rounded-lg border border-slate-300 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
                      >
                        Dismiss
                      </button>
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
