import { ArrowLeft, LocateFixed, Upload } from 'lucide-react';
import { ChangeEvent, FormEvent, useState } from 'react';
import {
  CATEGORIES,
  CATEGORY_LABELS,
  IncidentCategory,
  PublicIncident,
  UserProfile,
} from '../types/saath';
import { LeafletMap } from '../components/LeafletMap';
import { api, ApiError } from '../lib/api';

interface ReportViewProps {
  defaultCenter: { lat: number; lng: number };
  currentUser: UserProfile | null;
  onBack: () => void;
  onRequireLogin: () => void;
  onCreated: (incident: PublicIncident) => void;
}

export function ReportView({
  defaultCenter,
  currentUser,
  onBack,
  onRequireLogin,
  onCreated,
}: ReportViewProps) {
  const [category, setCategory] = useState<IncidentCategory>('road_hazard');
  const [description, setDescription] = useState('');
  const [locationLabel, setLocationLabel] = useState('');
  const [lat, setLat] = useState(defaultCenter.lat);
  const [lng, setLng] = useState(defaultCenter.lng);
  const [occurredAt, setOccurredAt] = useState(() => {
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    return now.toISOString().slice(0, 16);
  });
  const [sensitive, setSensitive] = useState(false);
  const [evidenceUrl, setEvidenceUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [geoMessage, setGeoMessage] = useState<string | null>(null);

  const handleLocateMe = () => {
    setGeoMessage(null);
    if (!navigator.geolocation) {
      setGeoMessage('Geolocation is unavailable in this browser. Click the map to set a pin.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(Number(pos.coords.latitude.toFixed(5)));
        setLng(Number(pos.coords.longitude.toFixed(5)));
        setGeoMessage('Pin moved to your current location.');
      },
      () => {
        setGeoMessage('Location permission denied. Defaulting to city center — click map to adjust.');
      },
      { timeout: 6000 },
    );
  };

  const handleFileUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);

    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      setError('Only JPG and PNG images are permitted.');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setError('Image must be 2 MB or smaller.');
      return;
    }

    setUploading(true);
    try {
      const res = await api.uploadEvidence(file);
      setEvidenceUrl(res.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload image.');
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!currentUser) {
      onRequireLogin();
      return;
    }

    const trimmed = description.trim();
    if (trimmed.length < 10 || trimmed.length > 500) {
      setError('Please enter a factual description between 10 and 500 characters.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await api.createIncident({
        category,
        description: trimmed,
        lat,
        lng,
        location_label: locationLabel.trim() || undefined,
        occurred_at: occurredAt ? new Date(occurredAt).toISOString() : undefined,
        evidence_url: evidenceUrl.trim() || undefined,
        sensitive,
      });
      onCreated(res.incident);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onRequireLogin();
        return;
      }
      setError(err instanceof Error ? err.message : 'Unable to submit report.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <div className="flex items-center justify-between gap-4">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-700 hover:text-slate-900 cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to map</span>
        </button>
      </div>

      <div className="border-b border-slate-200 pb-4">
        <h1 className="text-2xl font-bold text-slate-900">Report a Local Incident</h1>
        <p className="text-sm text-slate-600 mt-1">
          Reports start as Unverified. AI assists with neutral categorization and summary; human operators make verification decisions.
        </p>
      </div>

      {!currentUser && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <p className="text-sm text-amber-950">
            Please sign in with a demo citizen name before submitting a report.
          </p>
          <button
            type="button"
            onClick={onRequireLogin}
            className="px-4 py-2 text-xs font-semibold bg-slate-900 text-white rounded-lg hover:bg-slate-800 cursor-pointer shrink-0"
          >
            Sign in now
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <form
          onSubmit={handleSubmit}
          className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-5 space-y-4"
        >
          {error && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800" role="alert">
              {error}
            </div>
          )}

          <div>
            <label htmlFor="report-category" className="block text-xs font-semibold text-slate-700 mb-1.5">
              Category
            </label>
            <select
              id="report-category"
              value={category}
              onChange={(e) => setCategory(e.target.value as IncidentCategory)}
              className="w-full h-11 px-3 rounded-lg border border-slate-300 bg-white text-sm text-slate-900"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label htmlFor="report-description" className="text-xs font-semibold text-slate-700">
                Factual description (10–500 characters)
              </label>
              <span className="text-xs font-mono text-slate-500 tabular-nums">
                {description.trim().length}/500
              </span>
            </div>
            <textarea
              id="report-description"
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe what happened, visible hazards, or landmark without personal names."
              className="w-full p-3 rounded-lg border border-slate-300 bg-white text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
              required
              minLength={10}
              maxLength={500}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="report-label" className="block text-xs font-semibold text-slate-700 mb-1.5">
                Landmark / area note (optional)
              </label>
              <input
                id="report-label"
                type="text"
                value={locationLabel}
                onChange={(e) => setLocationLabel(e.target.value)}
                placeholder="e.g., Near Variety Square"
                maxLength={120}
                className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm"
              />
            </div>

            <div>
              <label htmlFor="report-time" className="block text-xs font-semibold text-slate-700 mb-1.5">
                Time observed
              </label>
              <input
                id="report-time"
                type="datetime-local"
                value={occurredAt}
                onChange={(e) => setOccurredAt(e.target.value)}
                className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm tabular-nums"
              />
            </div>
          </div>

          <div className="space-y-2 pt-1">
            <label className="block text-xs font-semibold text-slate-700">
              Optional photo evidence (JPG/PNG max 2 MB, or image URL)
            </label>
            <div className="flex flex-col sm:flex-row gap-2">
              <label className="inline-flex items-center justify-center gap-2 px-3.5 h-10 rounded-lg border border-slate-300 bg-slate-50 text-xs font-medium text-slate-800 hover:bg-slate-100 cursor-pointer shrink-0">
                <Upload className="w-4 h-4" />
                <span>{uploading ? 'Uploading...' : 'Upload JPG/PNG'}</span>
                <input
                  type="file"
                  accept="image/jpeg,image/png"
                  onChange={handleFileUpload}
                  className="hidden"
                  disabled={uploading}
                />
              </label>
              <input
                type="text"
                value={evidenceUrl}
                onChange={(e) => setEvidenceUrl(e.target.value)}
                placeholder="https://... or uploaded /uploads/ path"
                className="flex-1 h-10 px-3 rounded-lg border border-slate-300 text-sm"
              />
            </div>
          </div>

          <div className="pt-1">
            <label className="flex items-start gap-2.5 text-sm text-slate-800 cursor-pointer">
              <input
                type="checkbox"
                checked={sensitive}
                onChange={(e) => setSensitive(e.target.checked)}
                className="w-4 h-4 mt-0.5 rounded border-slate-300 text-blue-700"
              />
              <span>
                <span className="font-semibold block text-xs">Mark as sensitive incident</span>
                <span className="text-xs text-slate-500">
                  Public map and APIs will round coordinates to ~500 m; exact location stays operator-only.
                </span>
              </span>
            </label>
          </div>

          <div className="pt-2 flex items-center justify-between gap-3">
            <span className="text-xs font-mono text-slate-500 tabular-nums">
              Pin: {lat.toFixed(4)}, {lng.toFixed(4)}
            </span>
            <button
              type="submit"
              disabled={submitting || uploading}
              className="px-5 py-2.5 min-h-[44px] rounded-lg bg-blue-700 text-white text-sm font-semibold hover:bg-blue-800 disabled:opacity-50 cursor-pointer"
            >
              {submitting ? 'Submitting & running AI triage...' : 'Submit report'}
            </button>
          </div>
        </form>

        <div className="lg:col-span-6 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-slate-700">
              Click anywhere on the map to adjust the incident pin
            </span>
            <button
              type="button"
              onClick={handleLocateMe}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              <LocateFixed className="w-3.5 h-3.5" />
              <span>Use my location</span>
            </button>
          </div>
          {geoMessage && <p className="text-xs text-slate-600">{geoMessage}</p>}
          <LeafletMap
            center={{ lat, lng }}
            zoom={15}
            pickedLocation={{ lat, lng }}
            heightClass="h-[360px] lg:h-[480px]"
            onMapClick={(nextLat, nextLng) => {
              setLat(nextLat);
              setLng(nextLng);
            }}
          />
        </div>
      </div>
    </div>
  );
}
