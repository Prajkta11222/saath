import { Camera, RefreshCw, RotateCcw, Smartphone, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  AuditLogEntry,
  CATEGORY_LABELS,
  CameraReference,
  DemoPhoneState,
  IncidentStatus,
  OperatorIncident,
  UserProfile,
  VALID_STATUS_TRANSITIONS,
} from '../types/saath';
import { api } from '../lib/api';
import {
  formatRelativeTime,
  formatTimeStamp,
  getFreshnessLabel,
  getPriorityTextClass,
  getStatusTextClass,
  isDisplayableImageUrl,
} from '../lib/format';
import { DispatchedAlertPayload } from '../../server/services/alerts';

interface OperatorViewProps {
  currentUser: UserProfile | null;
  demoPhoneAlerts: Record<number, DispatchedAlertPayload>;
  liveRefreshTick: number;
  onRequireOperatorLogin: () => void;
  onDemoResetDone: () => void;
  onNotifyToast: (title: string, message: string, tone: 'info' | 'warning' | 'success' | 'error') => void;
}

function SimulatedCameraCanvas({ cameraName }: { cameraName: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let frame = 0;
    let rafId = 0;
    const draw = () => {
      frame += 1;
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Synthetic road grid
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(0, 95, canvas.width, 70);
      ctx.strokeStyle = '#64748b';
      ctx.setLineDash([12, 10]);
      ctx.beginPath();
      ctx.moveTo(0, 130);
      ctx.lineTo(canvas.width, 130);
      ctx.stroke();
      ctx.setLineDash([]);

      // Moving synthetic vehicle rectangles (no face recognition, purely abstract simulation)
      const x1 = (frame * 2.2) % (canvas.width + 60) - 40;
      const x2 = canvas.width - ((frame * 1.6) % (canvas.width + 60)) + 20;
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(x1, 106, 36, 16);
      ctx.fillStyle = '#f59e0b';
      ctx.fillRect(x2, 138, 32, 16);

      ctx.fillStyle = '#e2e8f0';
      ctx.font = '12px monospace';
      ctx.fillText(`SYNTHETIC TRAFFIC SIM · ${cameraName}`, 12, 22);
      ctx.fillText(new Date().toISOString(), 12, canvas.height - 12);

      rafId = requestAnimationFrame(draw);
    };
    rafId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafId);
  }, [cameraName]);

  return (
    <canvas
      ref={canvasRef}
      width={480}
      height={240}
      className="w-full rounded-lg border border-slate-700 bg-slate-900"
    />
  );
}

export function OperatorView({
  currentUser,
  demoPhoneAlerts,
  liveRefreshTick,
  onRequireOperatorLogin,
  onDemoResetDone,
  onNotifyToast,
}: OperatorViewProps) {
  const [incidents, setIncidents] = useState<OperatorIncident[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [cameras, setCameras] = useState<CameraReference[]>([]);
  const [demoPhones, setDemoPhones] = useState<DemoPhoneState[]>([]);
  const [activeCamera, setActiveCamera] = useState<(CameraReference & { banner: string }) | null>(null);
  const [statusNote, setStatusNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [resetting, setResetting] = useState(false);

  const isOperator = currentUser?.role === 'operator';

  const loadConsoleData = async () => {
    api
      .getDemoPhones()
      .then((res) => setDemoPhones(res.phones))
      .catch(() => {});

    if (!isOperator) return;
    setLoading(true);
    setError(null);
    try {
      const [incRes, auditRes] = await Promise.all([
        api.getOperatorIncidents(),
        api.getOperatorAudit(),
      ]);
      setIncidents(incRes.incidents);
      setAuditLogs(auditRes.logs);
      const validSelected = incRes.incidents.some((i) => i.id === selectedId) ? selectedId : null;
      const firstId = validSelected ?? incRes.incidents[0]?.id ?? null;
      setSelectedId(firstId);
      const selected = incRes.incidents.find((i) => i.id === firstId) || incRes.incidents[0];
      const camRes = await api.getOperatorCameras(selected?.exact_lat, selected?.exact_lng);
      setCameras(camRes.cameras);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load operator console.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadConsoleData();
  }, [isOperator, liveRefreshTick]);

  const selectedIncident = incidents.find((i) => i.id === selectedId) || null;

  useEffect(() => {
    if (!isOperator || !selectedIncident) return;
    api
      .getOperatorCameras(selectedIncident.exact_lat, selectedIncident.exact_lng)
      .then((res) => setCameras(res.cameras))
      .catch(() => {});
  }, [selectedIncident?.id, isOperator]);

  const handleStatusChange = async (nextStatus: IncidentStatus) => {
    if (!selectedIncident) return;
    setUpdatingStatus(true);
    setError(null);
    try {
      await api.updateIncidentStatus(selectedIncident.id, nextStatus, statusNote.trim() || undefined);
      setStatusNote('');
      await loadConsoleData();
      onNotifyToast(
        `Incident #${selectedIncident.id} updated`,
        `Status changed to ${nextStatus} and written to the public audit timeline.`,
        'success',
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update status.');
    } finally {
      setUpdatingStatus(false);
    }
  };

  const handleOpenCamera = async (camId: number) => {
    try {
      const res = await api.openCameraFeed(camId, selectedIncident?.id);
      setActiveCamera(res.camera);
      const auditRes = await api.getOperatorAudit();
      setAuditLogs(auditRes.logs);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open mock camera feed.');
    }
  };

  const handleDemoReset = async () => {
    setResetting(true);
    setError(null);
    try {
      await api.resetDemo();
      await loadConsoleData();
      onDemoResetDone();
      onNotifyToast('Demo data reset', 'Seeded Nagpur incidents, users, and cameras restored.', 'info');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset demo data.');
    } finally {
      setResetting(false);
    }
  };

  const filteredQueue = statusFilter
    ? incidents.filter((i) => i.status === statusFilter)
    : incidents;

  const allowedTransitions = selectedIncident
    ? VALID_STATUS_TRANSITIONS[selectedIncident.status]
    : [];

  return (
    <div className="space-y-6">
      {/* Demo Phones Panel — visible for hackathon multi-tab/phone demonstration */}
      <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Smartphone className="w-4 h-4 text-blue-700" />
            <h2 className="text-base font-semibold text-slate-900">
              Demo Phones Panel (Simulated Multi-Device Alert Delivery)
            </h2>
          </div>
          <span className="text-xs text-slate-500">
            Opted-in phones within radius light up in real time when a report is submitted (reporter excluded).
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {demoPhones.map((phone) => {
            const recentAlert = demoPhoneAlerts[phone.id];
            return (
              <div
                key={phone.id}
                className={`rounded-xl border p-3.5 transition-colors ${
                  recentAlert
                    ? 'border-blue-600 bg-blue-50/70'
                    : 'border-slate-200 bg-slate-50/50'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-slate-900">{phone.display_name}</span>
                  <span className="text-[11px] font-mono text-slate-500 tabular-nums">
                    {phone.distance_from_center_km.toFixed(1)} km from center
                  </span>
                </div>
                <div className="text-xs text-slate-600 mt-1 tabular-nums">
                  Alerts: {phone.alerts_opt_in ? `On (${phone.alert_radius_km} km)` : 'Off'} · Helper:{' '}
                  {phone.help_opt_in ? 'Yes' : 'No'}
                </div>
                {recentAlert ? (
                  <div className="mt-2 pt-2 border-t border-blue-200 text-xs text-blue-950 font-medium">
                    {recentAlert.message}
                  </div>
                ) : (
                  <div className="mt-2 pt-2 border-t border-slate-200/70 text-[11px] text-slate-500">
                    Waiting for nearby alert...
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {!isOperator ? (
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center space-y-3">
          <h1 className="text-xl font-bold text-slate-900">Operator Console (Authorized Role Only)</h1>
          <p className="text-sm text-slate-600 max-w-lg mx-auto">
            Review incoming reports, inspect AI triage suggestions, update verification statuses with audit trails, and view simulated camera references.
          </p>
          <button
            type="button"
            onClick={onRequireOperatorLogin}
            className="px-5 py-2.5 min-h-[44px] rounded-lg bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 cursor-pointer"
          >
            Sign in as Operator
          </button>
        </div>
      ) : (
        <>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 pb-4">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Operator Console</h1>
              <p className="text-sm text-slate-600 mt-0.5">
                Signed in as <strong>{currentUser.display_name}</strong>. Every status change and mock camera open is audit-logged.
              </p>
            </div>
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={loadConsoleData}
                className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[40px] rounded-lg border border-slate-300 bg-white text-xs font-medium text-slate-800 hover:bg-slate-50 cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                <span>Refresh</span>
              </button>
              <button
                type="button"
                disabled={resetting}
                onClick={handleDemoReset}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 min-h-[40px] rounded-lg border border-red-300 bg-red-50 text-xs font-semibold text-red-800 hover:bg-red-100 cursor-pointer disabled:opacity-50"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>{resetting ? 'Resetting...' : 'Reset demo data'}</span>
              </button>
            </div>
          </div>

          {error && (
            <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-xs text-red-800">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            {/* Queue Table */}
            <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-slate-900">
                  Triage Queue (AI Priority + Recency)
                </h2>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="h-8 px-2 rounded border border-slate-300 text-xs bg-white"
                  aria-label="Filter operator queue by status"
                >
                  <option value="">All statuses</option>
                  <option value="pending">Unverified</option>
                  <option value="community_confirmed">Community-confirmed</option>
                  <option value="reviewed">Reviewed</option>
                  <option value="resolved">Resolved</option>
                  <option value="dismissed">Dismissed</option>
                </select>
              </div>

              <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                    <tr>
                      <th className="px-3 py-2.5 font-semibold">ID</th>
                      <th className="px-3 py-2.5 font-semibold">Category</th>
                      <th className="px-3 py-2.5 font-semibold">AI Priority</th>
                      <th className="px-3 py-2.5 font-semibold">Status</th>
                      <th className="px-3 py-2.5 font-semibold text-right">Reported</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredQueue.map((inc) => (
                      <tr
                        key={inc.id}
                        onClick={() => setSelectedId(inc.id)}
                        className={`cursor-pointer transition-colors ${
                          selectedId === inc.id ? 'bg-blue-50/70' : 'hover:bg-slate-50'
                        }`}
                      >
                        <td className="px-3 py-2.5 font-mono tabular-nums text-slate-600">
                          #{inc.id}
                        </td>
                        <td className="px-3 py-2.5 font-medium text-slate-900">
                          {CATEGORY_LABELS[inc.category]}
                        </td>
                        <td className={`px-3 py-2.5 ${getPriorityTextClass(inc.ai_priority)}`}>
                          {inc.ai_priority || 'low'}
                        </td>
                        <td className={`px-3 py-2.5 ${getStatusTextClass(inc.status)}`}>
                          {inc.status_label}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-500">
                          {formatRelativeTime(inc.reported_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Selected Incident Detail & AI Suggestion Block */}
            <div className="lg:col-span-6 space-y-4">
              {selectedIncident ? (
                <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
                  <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
                    <div>
                      <div className="text-xs font-mono text-slate-500 tabular-nums">
                        Incident #{selectedIncident.id} · {getFreshnessLabel(selectedIncident.freshness)} ·{' '}
                        {selectedIncident.confirmations_count} confirm(s)
                      </div>
                      <h2 className="text-lg font-bold text-slate-900 mt-0.5">
                        {CATEGORY_LABELS[selectedIncident.category]}
                      </h2>
                      <div className="text-xs font-mono text-slate-500 tabular-nums mt-0.5">
                        Exact coords: {selectedIncident.exact_lat.toFixed(4)},{' '}
                        {selectedIncident.exact_lng.toFixed(4)}
                        {selectedIncident.sensitive ? ' (Sensitive — public rounded)' : ''}
                      </div>
                    </div>
                    <span className={`text-xs ${getStatusTextClass(selectedIncident.status)}`}>
                      {selectedIncident.status_label}
                    </span>
                  </div>

                  <p className="text-sm text-slate-800 leading-relaxed">
                    {selectedIncident.description}
                  </p>

                  {isDisplayableImageUrl(selectedIncident.evidence_url) && (
                    <div>
                      <div className="text-xs font-semibold text-slate-600 mb-1">Attached Evidence</div>
                      <img
                        src={selectedIncident.evidence_url!}
                        alt={`Evidence for incident ${selectedIncident.id}`}
                        referrerPolicy="no-referrer"
                        className="max-h-44 rounded-lg border border-slate-200 object-cover"
                      />
                    </div>
                  )}

                  {/* AI Advisory Block */}
                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-3.5 space-y-2">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-semibold text-slate-900">
                        AI suggestion — operator decides
                      </span>
                      <span className="font-mono text-slate-500">
                        Source: {selectedIncident.ai_source || 'rules'} · Conf:{' '}
                        {selectedIncident.ai_confidence ?? 0.7}
                      </span>
                    </div>
                    <div className="text-xs text-slate-700 space-y-1">
                      <div>
                        <span className="font-semibold">Suggested category/priority: </span>
                        {selectedIncident.ai_category} /{' '}
                        <span className={getPriorityTextClass(selectedIncident.ai_priority)}>
                          {selectedIncident.ai_priority}
                        </span>
                      </div>
                      <div>
                        <span className="font-semibold">Neutral summary: </span>
                        {selectedIncident.ai_summary}
                      </div>
                      <div>
                        <span className="font-semibold">Recommended triage: </span>
                        {selectedIncident.ai_triage}
                      </div>
                      {selectedIncident.ai_flags.length > 0 && (
                        <div>
                          <span className="font-semibold">Flags: </span>
                          <span className="font-mono text-amber-800">
                            {selectedIncident.ai_flags.join(', ')}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Operator Status Actions */}
                  <div className="space-y-2.5 pt-1">
                    <input
                      type="text"
                      value={statusNote}
                      onChange={(e) => setStatusNote(e.target.value)}
                      placeholder="Optional audit note (visible in public timeline)"
                      maxLength={240}
                      className="w-full h-9 px-3 rounded-lg border border-slate-300 text-xs"
                    />
                    <div className="flex flex-wrap gap-2">
                      {(['reviewed', 'resolved', 'dismissed'] as IncidentStatus[]).map((st) => {
                        const allowed = allowedTransitions.includes(st);
                        return (
                          <button
                            key={st}
                            type="button"
                            disabled={!allowed || updatingStatus}
                            onClick={() => handleStatusChange(st)}
                            className={`px-3.5 py-2 min-h-[38px] rounded-lg text-xs font-semibold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                              st === 'reviewed'
                                ? 'bg-blue-700 text-white hover:bg-blue-800'
                                : st === 'resolved'
                                  ? 'bg-emerald-700 text-white hover:bg-emerald-800'
                                  : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                            }`}
                          >
                            Mark {st}
                          </button>
                        );
                      })}
                    </div>
                    {allowedTransitions.length === 0 && (
                      <p className="text-xs text-slate-500">
                        This report is in a final status ({selectedIncident.status}).
                      </p>
                    )}
                  </div>
                </div>
              ) : (
                <div className="bg-white border border-slate-200 rounded-xl p-6 text-sm text-slate-500">
                  Select an incident from the queue to inspect AI triage and update status.
                </div>
              )}

              {/* Mock CCTV Panel */}
              <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Camera className="w-4 h-4 text-slate-700" />
                    <h2 className="text-sm font-semibold text-slate-900">
                      Mock CCTV References (No Face Recognition)
                    </h2>
                  </div>
                  <span className="text-[11px] font-mono text-slate-500">Audit-logged</span>
                </div>

                <div className="divide-y divide-slate-100">
                  {cameras.map((cam) => (
                    <div key={cam.id} className="py-2.5 flex items-center justify-between gap-3">
                      <div>
                        <div className="text-xs font-semibold text-slate-800">{cam.name}</div>
                        <div className="text-[11px] font-mono text-slate-500 tabular-nums">
                          {cam.distance_km !== undefined ? `${cam.distance_km.toFixed(2)} km away · ` : ''}
                          {cam.lat.toFixed(4)}, {cam.lng.toFixed(4)}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleOpenCamera(cam.id)}
                        className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-medium text-slate-800 hover:bg-slate-50 cursor-pointer shrink-0"
                      >
                        Open feed
                      </button>
                    </div>
                  ))}
                </div>

                {activeCamera && (
                  <div className="mt-3 p-3.5 rounded-xl border border-slate-800 bg-slate-950 text-white space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-amber-300">
                        {activeCamera.banner}
                      </span>
                      <button
                        type="button"
                        onClick={() => setActiveCamera(null)}
                        className="p-1 rounded hover:bg-white/10 cursor-pointer"
                        aria-label="Close simulated feed"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    <SimulatedCameraCanvas cameraName={activeCamera.name} />
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Audit Trail Table */}
          <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">Operator &amp; System Audit Trail</h2>
              <span className="text-xs font-mono text-slate-500 tabular-nums">
                {auditLogs.length} entries
              </span>
            </div>
            <div className="overflow-x-auto max-h-[300px] overflow-y-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Timestamp</th>
                    <th className="px-3 py-2 font-semibold">Actor</th>
                    <th className="px-3 py-2 font-semibold">Action</th>
                    <th className="px-3 py-2 font-semibold">Target</th>
                    <th className="px-3 py-2 font-semibold">Detail</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {auditLogs.map((log) => (
                    <tr key={log.id}>
                      <td className="px-3 py-2 font-mono tabular-nums text-slate-500 whitespace-nowrap">
                        {formatTimeStamp(log.created_at)}
                      </td>
                      <td className="px-3 py-2 font-medium text-slate-800">{log.actor_name}</td>
                      <td className="px-3 py-2 font-mono text-slate-700">{log.action}</td>
                      <td className="px-3 py-2 font-mono text-slate-600">
                        {log.entity_type}
                        {log.entity_id ? ` #${log.entity_id}` : ''}
                      </td>
                      <td className="px-3 py-2 text-slate-600">{JSON.stringify(log.detail)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
