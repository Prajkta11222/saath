import { ArrowLeft, CheckCircle2, Clock, ShieldAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { CATEGORY_LABELS, PublicIncident } from '../types/saath';
import { LeafletMap } from '../components/LeafletMap';
import {
  formatRelativeTime,
  formatTimeStamp,
  getFreshnessLabel,
  getStatusTextClass,
  isDisplayableImageUrl,
} from '../lib/format';

interface IncidentDetailViewProps {
  incident: PublicIncident | null;
  loading: boolean;
  error: string | null;
  onBack: () => void;
  onConfirm: (id: number) => Promise<void>;
}

export function IncidentDetailView({
  incident,
  loading,
  error,
  onBack,
  onConfirm,
}: IncidentDetailViewProps) {
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    setImageFailed(false);
  }, [incident?.id, incident?.evidence_url]);

  const handleConfirm = async () => {
    if (!incident) return;
    setConfirmError(null);
    setConfirming(true);
    try {
      await onConfirm(incident.id);
    } catch (err) {
      setConfirmError(err instanceof Error ? err.message : 'Could not confirm report.');
    } finally {
      setConfirming(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-700 hover:text-slate-900 cursor-pointer"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>Back to map</span>
      </button>

      {loading && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-3 animate-pulse">
          <div className="h-6 w-1/3 bg-slate-200 rounded" />
          <div className="h-4 w-2/3 bg-slate-100 rounded" />
          <div className="h-48 w-full bg-slate-100 rounded" />
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-800">
          {error}
        </div>
      )}

      {!loading && incident && (
        <div className="space-y-5">
          <div className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 border-b border-slate-100 pb-4">
              <div>
                <div className="text-xs text-slate-500 tabular-nums">
                  Report #{incident.id} · {formatRelativeTime(incident.reported_at)} ·{' '}
                  {getFreshnessLabel(incident.freshness)}
                </div>
                <h1 className="text-2xl font-bold text-slate-900 mt-1">
                  {CATEGORY_LABELS[incident.category] || incident.category}
                </h1>
                {incident.location_label && (
                  <p className="text-sm text-slate-600 mt-0.5">{incident.location_label}</p>
                )}
              </div>

              <div className="text-left sm:text-right space-y-1">
                <div className={`text-sm ${getStatusTextClass(incident.status)}`}>
                  Status: {incident.status_label}
                </div>
                <div className="text-xs text-slate-500 tabular-nums">
                  {incident.confirmations_count} community confirmation(s)
                </div>
              </div>
            </div>

            {incident.ai_summary && (
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3.5">
                <div className="text-xs font-semibold text-slate-700">Neutral Summary</div>
                <p className="text-sm text-slate-900 mt-1 leading-relaxed">{incident.ai_summary}</p>
              </div>
            )}

            <div>
              <h2 className="text-xs font-semibold text-slate-600 mb-1">Reported Details</h2>
              <p className="text-sm text-slate-800 leading-relaxed">{incident.description}</p>
            </div>

            {incident.location_approximate && (
              <p className="text-xs text-slate-600">
                Sensitive report protection: public coordinates are rounded to ~500 m.
              </p>
            )}

            {incident.safety_guidance && (
              <div className="bg-blue-50/70 border border-blue-200 rounded-lg p-3.5 flex items-start gap-2.5">
                <ShieldAlert className="w-4 h-4 text-blue-700 mt-0.5 shrink-0" />
                <div className="text-xs text-slate-800 leading-relaxed">
                  <span className="font-semibold">Safety guidance: </span>
                  {incident.safety_guidance}
                </div>
              </div>
            )}

            {isDisplayableImageUrl(incident.evidence_url) && !imageFailed && (
              <div>
                <div className="text-xs font-semibold text-slate-600 mb-1.5">Attached Evidence</div>
                <img
                  src={incident.evidence_url!}
                  alt={`Evidence for incident ${incident.id}`}
                  referrerPolicy="no-referrer"
                  onError={() => setImageFailed(true)}
                  className="max-h-72 rounded-lg border border-slate-200 object-cover"
                />
              </div>
            )}

            {confirmError && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">
                {confirmError}
              </div>
            )}

            <div className="pt-2 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100">
              <div className="text-xs text-slate-500 font-mono tabular-nums">
                Observed {formatTimeStamp(incident.occurred_at)} · Reported{' '}
                {formatTimeStamp(incident.reported_at)}
              </div>

              {incident.status !== 'resolved' && incident.status !== 'dismissed' && (
                <button
                  type="button"
                  disabled={confirming}
                  onClick={handleConfirm}
                  className="inline-flex items-center gap-2 px-4 py-2 min-h-[40px] rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>
                    {confirming
                      ? 'Confirming...'
                      : `Confirm this report (${incident.confirmations_count})`}
                  </span>
                </button>
              )}
            </div>
          </div>

          {/* Public Transparency Status Timeline (Track 1 hook) */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-slate-600" />
                <h2 className="text-base font-semibold text-slate-900">
                  Public Status Timeline
                </h2>
              </div>
              <p className="text-xs text-slate-500">
                Every verification and operator status change is recorded with a UTC timestamp. Updates appear live.
              </p>

              <ol className="space-y-3 border-l border-slate-200 ml-2 pl-4">
                {(incident.timeline || []).map((entry) => (
                  <li key={`${entry.id}-${entry.created_at}`} className="space-y-0.5">
                    <div className="text-sm font-medium text-slate-900">{entry.label}</div>
                    {typeof entry.detail?.note === 'string' && entry.detail.note && (
                      <div className="text-xs text-slate-600">{entry.detail.note}</div>
                    )}
                    <div className="text-xs font-mono text-slate-500 tabular-nums">
                      {formatTimeStamp(entry.created_at)}
                    </div>
                  </li>
                ))}
              </ol>
            </div>

            <div className="lg:col-span-6">
              <LeafletMap
                center={{ lat: incident.lat, lng: incident.lng }}
                zoom={15}
                incidents={[incident]}
                heightClass="h-[280px]"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
