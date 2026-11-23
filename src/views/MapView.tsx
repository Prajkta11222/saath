import { CheckCircle2, LocateFixed, RefreshCw, SlidersHorizontal, UserCheck } from 'lucide-react';
import {
  CATEGORIES,
  CATEGORY_LABELS,
  PublicIncident,
  STATUSES,
  STATUS_LABELS,
  UserProfile,
} from '../types/saath';
import { LeafletMap } from '../components/LeafletMap';
import {
  formatRelativeTime,
  getFreshnessLabel,
  getMarkerColor,
  getStatusTextClass,
} from '../lib/format';
import { AppScreen } from '../components/Navbar';

interface MapViewProps {
  center: { lat: number; lng: number };
  userLocation: { lat: number; lng: number } | null;
  incidents: PublicIncident[];
  loading: boolean;
  error: string | null;
  categoryFilter: string;
  statusFilter: string;
  radiusKm: number;
  includeStale: boolean;
  currentUser: UserProfile | null;
  onChangeCategory: (v: string) => void;
  onChangeStatus: (v: string) => void;
  onChangeRadius: (v: number) => void;
  onChangeIncludeStale: (v: boolean) => void;
  onLocateMe: () => void;
  onRefresh: () => void;
  onSelectIncident: (id: number) => void;
  onConfirmIncident: (id: number) => void;
  onToggleAlertOptIn: (optIn: boolean) => void;
  onChangeAlertRadius: (radius: number) => void;
  onNavigate: (screen: AppScreen) => void;
}

export function MapView({
  center,
  userLocation,
  incidents,
  loading,
  error,
  categoryFilter,
  statusFilter,
  radiusKm,
  includeStale,
  currentUser,
  onChangeCategory,
  onChangeStatus,
  onChangeRadius,
  onChangeIncludeStale,
  onLocateMe,
  onRefresh,
  onSelectIncident,
  onConfirmIncident,
  onToggleAlertOptIn,
  onChangeAlertRadius,
  onNavigate,
}: MapViewProps) {
  return (
    <div className="space-y-5">
      {/* Workspace Header & Session Strip */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
            Nearby Civic &amp; Safety Reports
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Community reports with transparent verification status and freshness windows. Reports are unverified unless marked Reviewed.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {currentUser ? (
            <button
              type="button"
              onClick={() => onNavigate('login')}
              className="inline-flex items-center gap-2 px-3 py-2 min-h-[40px] rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-800 hover:bg-slate-50 cursor-pointer whitespace-nowrap"
            >
              <UserCheck className="w-4 h-4 text-blue-700" />
              <span>
                {currentUser.display_name} · {currentUser.role}
              </span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onNavigate('login')}
              className="inline-flex items-center gap-2 px-3 py-2 min-h-[40px] rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-900 hover:bg-slate-50 cursor-pointer whitespace-nowrap"
            >
              Sign in (Demo)
            </button>
          )}
          <button
            type="button"
            onClick={onLocateMe}
            className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[40px] rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer whitespace-nowrap"
          >
            <LocateFixed className="w-4 h-4" />
            <span>Use my location</span>
          </button>
          <button
            type="button"
            onClick={() => onNavigate('sos')}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 min-h-[40px] rounded-lg bg-red-600 text-white text-xs font-semibold hover:bg-red-700 cursor-pointer whitespace-nowrap"
          >
            Emergency SOS
          </button>
        </div>
      </div>

      {/* Filter & Alert Settings Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
          <div>
            <label htmlFor="filter-category" className="block text-xs font-medium text-slate-600 mb-1">
              Category
            </label>
            <select
              id="filter-category"
              value={categoryFilter}
              onChange={(e) => onChangeCategory(e.target.value)}
              className="w-full h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm text-slate-900"
            >
              <option value="">All categories</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="filter-status" className="block text-xs font-medium text-slate-600 mb-1">
              Status
            </label>
            <select
              id="filter-status"
              value={statusFilter}
              onChange={(e) => onChangeStatus(e.target.value)}
              className="w-full h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm text-slate-900"
            >
              <option value="">All statuses</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="filter-radius" className="block text-xs font-medium text-slate-600 mb-1">
              Search radius
            </label>
            <select
              id="filter-radius"
              value={radiusKm}
              onChange={(e) => onChangeRadius(Number(e.target.value))}
              className="w-full h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm text-slate-900 tabular-nums"
            >
              <option value={1}>1 km</option>
              <option value={2}>2 km</option>
              <option value={5}>5 km</option>
              <option value={10}>10 km</option>
            </select>
          </div>

          <div className="flex items-center h-10">
            <label className="inline-flex items-center gap-2 text-sm text-slate-700 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={includeStale}
                onChange={(e) => onChangeIncludeStale(e.target.checked)}
                className="w-4 h-4 rounded border-slate-300 text-blue-700"
              />
              <span>Include stale reports</span>
            </label>
          </div>

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onRefresh}
              className="inline-flex items-center gap-1.5 px-3 h-10 rounded-lg border border-slate-200 bg-slate-50 text-xs font-medium text-slate-700 hover:bg-slate-100 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
          </div>
        </div>

        {/* Nearby Alert Opt-In Row */}
        <div className="pt-3 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-slate-700">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="w-4 h-4 text-slate-500 shrink-0" />
            {currentUser ? (
              <span>
                Nearby alerts for <strong>{currentUser.display_name}</strong>:
              </span>
            ) : (
              <span>Sign in to enable live opt-in nearby alerts within your chosen radius.</span>
            )}
          </div>

          {currentUser ? (
            <div className="flex flex-wrap items-center gap-4">
              <label className="inline-flex items-center gap-2 font-medium cursor-pointer">
                <input
                  type="checkbox"
                  checked={currentUser.alerts_opt_in}
                  onChange={(e) => onToggleAlertOptIn(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 text-blue-700"
                />
                <span>Receive opt-in nearby alerts</span>
              </label>

              <div className="flex items-center gap-1.5">
                <span className="text-slate-500">Alert radius:</span>
                {[1, 2, 5].map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => onChangeAlertRadius(r)}
                    className={`px-2.5 py-1 rounded-md border text-xs font-medium tabular-nums cursor-pointer ${
                      currentUser.alert_radius_km === r
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    {r} km
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => onNavigate('login')}
              className="text-blue-700 font-semibold hover:underline cursor-pointer self-start sm:self-auto"
            >
              Sign in to configure alerts
            </button>
          )}
        </div>
      </div>

      {/* Main Split: Interactive Map + Nearby Reports Feed */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        <div className="lg:col-span-7 space-y-3">
          <LeafletMap
            center={center}
            incidents={incidents}
            userPin={userLocation}
            onSelectIncident={onSelectIncident}
            onConfirmIncident={onConfirmIncident}
          />

          {/* Clean Legend (unboxed text, zero pill clutter) */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-600 px-1">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-red-600 inline-block" />
              <span>Accident / Fire / Medical</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-600 inline-block" />
              <span>Road / Water / Streetlight</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-blue-700 inline-block" />
              <span>Suspicious / Theft / Harassment</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-slate-400 inline-block" />
              <span>Stale (excluded from alerts/routes)</span>
            </span>
          </div>
        </div>

        {/* Feed Column */}
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">
              Reports within {radiusKm} km
            </h2>
            <span className="text-xs font-mono text-slate-500 tabular-nums">
              {incidents.length} shown
            </span>
          </div>

          {error && (
            <div className="p-4 bg-red-50 border-b border-red-200 text-xs text-red-800 flex items-center justify-between gap-3">
              <span>{error}</span>
              <button
                type="button"
                onClick={onRefresh}
                className="font-semibold underline cursor-pointer shrink-0"
              >
                Retry
              </button>
            </div>
          )}

          {loading ? (
            <div className="divide-y divide-slate-100">
              {[1, 2, 3, 4].map((n) => (
                <div key={n} className="p-4 space-y-2 animate-pulse">
                  <div className="h-4 w-2/5 bg-slate-200 rounded" />
                  <div className="h-3 w-4/5 bg-slate-100 rounded" />
                  <div className="h-3 w-1/3 bg-slate-100 rounded" />
                </div>
              ))}
            </div>
          ) : incidents.length === 0 ? (
            <div className="p-8 text-center space-y-3">
              <p className="text-sm font-medium text-slate-800">
                No reports match these filters within {radiusKm} km.
              </p>
              <p className="text-xs text-slate-500">
                Try increasing the radius, including stale reports, or submit a new civic report.
              </p>
              <button
                type="button"
                onClick={() => onNavigate('report')}
                className="px-4 py-2 text-xs font-semibold bg-blue-700 text-white rounded-lg hover:bg-blue-800 cursor-pointer"
              >
                Report an incident
              </button>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 max-h-[540px] overflow-y-auto">
              {incidents.map((inc) => (
                <article key={inc.id} className="p-4 hover:bg-slate-50/80 transition-colors space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <button
                        type="button"
                        onClick={() => onSelectIncident(inc.id)}
                        className="text-sm font-semibold text-slate-900 hover:text-blue-700 text-left cursor-pointer"
                      >
                        {CATEGORY_LABELS[inc.category] || inc.category}
                      </button>
                      <div className="text-xs text-slate-500 mt-0.5 tabular-nums flex flex-wrap items-center gap-x-1.5">
                        {inc.distance_km !== undefined && <span>{inc.distance_km.toFixed(1)} km</span>}
                        {inc.distance_km !== undefined && <span aria-hidden="true">·</span>}
                        <span>{formatRelativeTime(inc.reported_at)}</span>
                        <span aria-hidden="true">·</span>
                        <span className={getStatusTextClass(inc.status)}>{inc.status_label}</span>
                        <span aria-hidden="true">·</span>
                        <span>{getFreshnessLabel(inc.freshness)}</span>
                      </div>
                    </div>
                    <span
                      className="w-2.5 h-2.5 rounded-full mt-1.5 shrink-0"
                      style={{ backgroundColor: getMarkerColor(inc.category, inc.freshness) }}
                      aria-hidden="true"
                    />
                  </div>

                  <p className="text-xs text-slate-700 leading-relaxed">
                    {inc.ai_summary || inc.description}
                  </p>

                  {inc.sensitive && (
                    <p className="text-[11px] text-slate-500">
                      Sensitive report · approximate area shown (~500 m)
                    </p>
                  )}

                  <div className="flex items-center gap-3 pt-1">
                    <button
                      type="button"
                      onClick={() => onSelectIncident(inc.id)}
                      className="text-xs font-semibold text-blue-700 hover:underline cursor-pointer"
                    >
                      View details &amp; timeline
                    </button>
                    {inc.status !== 'resolved' && inc.status !== 'dismissed' && (
                      <button
                        type="button"
                        onClick={() => onConfirmIncident(inc.id)}
                        className="inline-flex items-center gap-1 text-xs font-medium text-slate-700 hover:text-slate-900 cursor-pointer"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5 text-slate-500" />
                        <span className="tabular-nums">Confirm ({inc.confirmations_count})</span>
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
