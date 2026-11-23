import L from 'leaflet';
import { useEffect, useRef } from 'react';
import { CATEGORY_LABELS, PublicIncident, RouteAlternative } from '../types/saath';
import { formatRelativeTime, getFreshnessLabel, getMarkerColor } from '../lib/format';

interface LeafletMapProps {
  center: { lat: number; lng: number };
  zoom?: number;
  incidents?: PublicIncident[];
  pickedLocation?: { lat: number; lng: number } | null;
  originPin?: { lat: number; lng: number; label?: string } | null;
  destPin?: { lat: number; lng: number; label?: string } | null;
  routes?: RouteAlternative[];
  selectedRouteId?: 'A' | 'B' | null;
  userPin?: { lat: number; lng: number } | null;
  heightClass?: string;
  onMapClick?: (lat: number, lng: number) => void;
  onSelectIncident?: (id: number) => void;
  onConfirmIncident?: (id: number) => void;
}

export function LeafletMap({
  center,
  zoom = 14,
  incidents = [],
  pickedLocation = null,
  originPin = null,
  destPin = null,
  routes = [],
  selectedRouteId = null,
  userPin = null,
  heightClass = 'h-[420px] lg:h-[560px]',
  onMapClick,
  onSelectIncident,
  onConfirmIncident,
}: LeafletMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerGroupRef = useRef<L.LayerGroup | null>(null);
  const onMapClickRef = useRef(onMapClick);
  const onSelectRef = useRef(onSelectIncident);
  const onConfirmRef = useRef(onConfirmIncident);

  onMapClickRef.current = onMapClick;
  onSelectRef.current = onSelectIncident;
  onConfirmRef.current = onConfirmIncident;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [center.lat, center.lng],
      zoom,
      zoomControl: true,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);

    const group = L.layerGroup().addTo(map);
    mapRef.current = map;
    layerGroupRef.current = group;

    map.on('click', (e: L.LeafletMouseEvent) => {
      if (onMapClickRef.current) {
        onMapClickRef.current(
          Number(e.latlng.lat.toFixed(5)),
          Number(e.latlng.lng.toFixed(5)),
        );
      }
    });

    return () => {
      map.remove();
      mapRef.current = null;
      layerGroupRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (mapRef.current) {
      mapRef.current.setView([center.lat, center.lng], mapRef.current.getZoom(), {
        animate: true,
      });
    }
  }, [center.lat, center.lng]);

  useEffect(() => {
    const group = layerGroupRef.current;
    if (!group) return;
    group.clearLayers();

    // Draw routes (Route A direct, Route B avoidance)
    const boundsPoints: L.LatLngExpression[] = [];
    for (const route of routes) {
      const isB = route.id === 'B';
      const isSelected = selectedRouteId === null || selectedRouteId === route.id;
      for (const pt of route.polyline) {
        boundsPoints.push(pt);
      }
      L.polyline(route.polyline, {
        color: isB ? '#1d4ed8' : '#b45309',
        weight: isSelected ? 5 : 3,
        opacity: isSelected ? 0.9 : 0.45,
        dashArray: isB ? undefined : '8 6',
      }).addTo(group);
    }

    if (routes.length > 0 && boundsPoints.length >= 2 && mapRef.current) {
      mapRef.current.fitBounds(L.latLngBounds(boundsPoints), { padding: [36, 36], maxZoom: 15 });
    }

    // Draw user location indicator
    if (userPin) {
      L.circleMarker([userPin.lat, userPin.lng], {
        radius: 7,
        color: '#0f172a',
        weight: 2,
        fillColor: '#0ea5e9',
        fillOpacity: 1,
      })
        .bindTooltip('Your location')
        .addTo(group);
    }

    // Draw origin & destination pins for Route View
    if (originPin) {
      L.circleMarker([originPin.lat, originPin.lng], {
        radius: 8,
        color: '#ffffff',
        weight: 2,
        fillColor: '#0f172a',
        fillOpacity: 1,
      })
        .bindTooltip(originPin.label || 'Start')
        .addTo(group);
    }

    if (destPin) {
      L.circleMarker([destPin.lat, destPin.lng], {
        radius: 8,
        color: '#ffffff',
        weight: 2,
        fillColor: '#15803d',
        fillOpacity: 1,
      })
        .bindTooltip(destPin.label || 'Destination')
        .addTo(group);
    }

    // Draw picked location pin for Report form
    if (pickedLocation) {
      L.circleMarker([pickedLocation.lat, pickedLocation.lng], {
        radius: 9,
        color: '#ffffff',
        weight: 3,
        fillColor: '#dc2626',
        fillOpacity: 1,
      })
        .bindTooltip('Selected report pin')
        .addTo(group);
    }

    // Draw incident pins with XSS-safe DOM popup nodes
    for (const inc of incidents) {
      const color = getMarkerColor(inc.category, inc.freshness);
      if (inc.sensitive) {
        L.circle([inc.lat, inc.lng], {
          radius: 450,
          color,
          weight: 1,
          fillColor: color,
          fillOpacity: 0.08,
        }).addTo(group);
      }

      const marker = L.circleMarker([inc.lat, inc.lng], {
        radius: inc.freshness === 'stale' ? 6 : 8,
        color: '#ffffff',
        weight: 2,
        fillColor: color,
        fillOpacity: inc.freshness === 'stale' ? 0.55 : 0.95,
      });

      const popupEl = document.createElement('div');
      popupEl.className = 'min-w-[210px] space-y-2 text-slate-900';

      const title = document.createElement('div');
      title.className = 'text-sm font-semibold text-slate-900';
      title.textContent = CATEGORY_LABELS[inc.category] || inc.category;

      const meta = document.createElement('div');
      meta.className = 'text-xs text-slate-600';
      const distText = inc.distance_km !== undefined ? `${inc.distance_km.toFixed(1)} km · ` : '';
      meta.textContent = `${distText}${formatRelativeTime(inc.reported_at)} · ${inc.status_label} · ${getFreshnessLabel(inc.freshness)}`;

      const desc = document.createElement('p');
      desc.className = 'text-xs text-slate-700 leading-relaxed';
      desc.textContent = inc.ai_summary || inc.description;

      const actions = document.createElement('div');
      actions.className = 'flex items-center gap-2 pt-1';

      if (onSelectRef.current) {
        const viewBtn = document.createElement('button');
        viewBtn.type = 'button';
        viewBtn.className =
          'px-2.5 py-1.5 text-xs font-medium bg-slate-900 text-white rounded-md hover:bg-slate-800 cursor-pointer';
        viewBtn.textContent = 'View details';
        viewBtn.addEventListener('click', () => onSelectRef.current?.(inc.id));
        actions.appendChild(viewBtn);
      }

      if (onConfirmRef.current && inc.status !== 'resolved' && inc.status !== 'dismissed') {
        const confirmBtn = document.createElement('button');
        confirmBtn.type = 'button';
        confirmBtn.className =
          'px-2.5 py-1.5 text-xs font-medium border border-slate-300 bg-white text-slate-800 rounded-md hover:bg-slate-50 cursor-pointer';
        confirmBtn.textContent = `Confirm (${inc.confirmations_count})`;
        confirmBtn.addEventListener('click', () => onConfirmRef.current?.(inc.id));
        actions.appendChild(confirmBtn);
      }

      popupEl.appendChild(title);
      popupEl.appendChild(meta);
      popupEl.appendChild(desc);
      if (actions.childElementCount > 0) {
        popupEl.appendChild(actions);
      }

      marker.bindPopup(popupEl);
      marker.addTo(group);
    }
  }, [incidents, pickedLocation, originPin, destPin, routes, selectedRouteId, userPin]);

  return (
    <div
      ref={containerRef}
      className={`w-full ${heightClass} rounded-xl border border-slate-200 bg-slate-100 overflow-hidden`}
      aria-label="Interactive incident map"
    />
  );
}
