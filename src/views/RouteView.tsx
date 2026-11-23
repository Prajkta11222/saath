import { AlertCircle, Compass, Navigation } from 'lucide-react';
import { useEffect, useState } from 'react';
import { PRESET_DESTINATIONS, PresetDestination, RouteResponse } from '../types/saath';
import { LeafletMap } from '../components/LeafletMap';
import { api } from '../lib/api';

interface RouteViewProps {
  origin: { lat: number; lng: number };
  onSelectIncident: (id: number) => void;
}

export function RouteView({ origin, onSelectIncident }: RouteViewProps) {
  const [presets, setPresets] = useState<PresetDestination[]>(PRESET_DESTINATIONS);
  const [selectedDest, setSelectedDest] = useState<{ lat: number; lng: number; name: string }>({
    lat: PRESET_DESTINATIONS[0].lat,
    lng: PRESET_DESTINATIONS[0].lng,
    name: PRESET_DESTINATIONS[0].name,
  });
  const [routeData, setRouteData] = useState<RouteResponse | null>(null);
  const [selectedRouteId, setSelectedRouteId] = useState<'A' | 'B' | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getPresetDestinations()
      .then((res) => {
        if (res.destinations.length > 0) setPresets(res.destinations);
      })
      .catch(() => {
        // Keep static fallback presets
      });
  }, []);

  const loadRoutes = async (destLat: number, destLng: number) => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getRoutes(origin.lat, origin.lng, destLat, destLng);
      setRouteData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to compute demo routes.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRoutes(selectedDest.lat, selectedDest.lng);
  }, [origin.lat, origin.lng, selectedDest.lat, selectedDest.lng]);

  return (
    <div className="space-y-5">
      <div className="border-b border-slate-200 pb-4 flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Incident-Aware Route Alternatives</h1>
          <p className="text-sm text-slate-600 mt-1">
            Compare a direct path against a detour avoiding fresh or aging reports within 200 m. Stale reports are excluded.
          </p>
        </div>
        <span className="text-xs font-mono text-slate-500">Demo Geometry · is_demo: true</span>
      </div>

      {/* Mandatory Honest-Limit Caveat */}
      <div className="bg-amber-50 border border-amber-300 rounded-xl p-3.5 flex items-center gap-3 text-xs sm:text-sm text-amber-950 font-medium">
        <AlertCircle className="w-4 h-4 text-amber-700 shrink-0" />
        <span>Demo routes based on community reports. Not a safety guarantee.</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        <div className="lg:col-span-5 space-y-4">
          {/* Preset Destinations */}
          <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Compass className="w-4 h-4 text-blue-700" />
              <span>Choose destination (or click map)</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-2">
              {presets.map((p) => {
                const active =
                  Math.abs(selectedDest.lat - p.lat) < 0.0001 &&
                  Math.abs(selectedDest.lng - p.lng) < 0.0001;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setSelectedDest({ lat: p.lat, lng: p.lng, name: p.name })}
                    className={`w-full text-left px-3.5 py-2.5 rounded-lg border transition-colors cursor-pointer ${
                      active
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-white text-slate-800 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <div className="text-sm font-medium">{p.name}</div>
                    <div className={`text-xs ${active ? 'text-slate-300' : 'text-slate-500'}`}>
                      {p.area}
                    </div>
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-slate-500 font-mono tabular-nums">
              Destination: {selectedDest.name} ({selectedDest.lat.toFixed(4)}, {selectedDest.lng.toFixed(4)})
            </p>
          </div>

          {/* Route Alternatives */}
          {error && (
            <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-xs text-red-800">
              {error}
            </div>
          )}

          {loading && (
            <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3 animate-pulse">
              <div className="h-5 w-1/2 bg-slate-200 rounded" />
              <div className="h-16 w-full bg-slate-100 rounded" />
            </div>
          )}

          {!loading && routeData && (
            <div className="space-y-3">
              {routeData.routes.map((route) => {
                const isSelected = selectedRouteId === route.id;
                const isB = route.id === 'B';
                return (
                  <div
                    key={route.id}
                    onClick={() => setSelectedRouteId(isSelected ? null : route.id)}
                    className={`bg-white rounded-xl border p-4 cursor-pointer transition-colors space-y-2 ${
                      isSelected
                        ? 'border-blue-700 ring-1 ring-blue-700'
                        : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <span
                          className={`w-3 h-1.5 rounded-full ${
                            isB ? 'bg-blue-700' : 'bg-amber-600'
                          }`}
                        />
                        <h2 className="text-sm font-semibold text-slate-900">{route.label}</h2>
                      </div>
                      <span className="text-xs font-mono text-slate-600 tabular-nums">
                        {route.distance_km.toFixed(2)} km · ~{route.estimated_minutes} min
                      </span>
                    </div>

                    <p className="text-xs text-slate-600">{route.summary}</p>

                    <div className="text-xs font-medium text-slate-800 tabular-nums flex items-center gap-2 pt-1">
                      <Navigation className="w-3.5 h-3.5 text-slate-500" />
                      <span>
                        Recent reports within 200 m: <strong>{route.incidents_near_route}</strong>
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="lg:col-span-7 space-y-3">
          <LeafletMap
            center={{
              lat: (origin.lat + selectedDest.lat) / 2,
              lng: (origin.lng + selectedDest.lng) / 2,
            }}
            zoom={14}
            incidents={routeData?.recent_incidents || []}
            originPin={{ lat: origin.lat, lng: origin.lng, label: 'Start' }}
            destPin={{ lat: selectedDest.lat, lng: selectedDest.lng, label: selectedDest.name }}
            routes={routeData?.routes || []}
            selectedRouteId={selectedRouteId}
            heightClass="h-[400px] lg:h-[520px]"
            onMapClick={(lat, lng) =>
              setSelectedDest({ lat, lng, name: 'Custom map destination' })
            }
            onSelectIncident={onSelectIncident}
          />
          <div className="flex flex-wrap items-center gap-5 text-xs text-slate-600 px-1">
            <span className="inline-flex items-center gap-2">
              <span className="w-5 border-t-2 border-dashed border-amber-700 inline-block" />
              <span>Route A (Direct)</span>
            </span>
            <span className="inline-flex items-center gap-2">
              <span className="w-5 border-t-2 border-blue-700 inline-block" />
              <span>Route B (Avoids recent reports)</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
