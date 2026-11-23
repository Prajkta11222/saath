import { AlertTriangle, Bell, Compass, HandHelping, MapPin, Shield, X } from 'lucide-react';

export type AppScreen =
  | 'map'
  | 'report'
  | 'detail'
  | 'routes'
  | 'sos'
  | 'help'
  | 'operator'
  | 'login';

export interface ToastNotice {
  id: string;
  title: string;
  message: string;
  tone: 'info' | 'warning' | 'success' | 'error';
}

interface NavbarProps {
  activeScreen: AppScreen;
  onNavigate: (screen: AppScreen) => void;
}

export function Navbar({ activeScreen, onNavigate }: NavbarProps) {
  const navItems: Array<{ id: AppScreen; label: string }> = [
    { id: 'map', label: 'Map' },
    { id: 'routes', label: 'Routes' },
    { id: 'sos', label: 'SOS' },
    { id: 'help', label: 'Help' },
    { id: 'operator', label: 'Console' },
  ];

  const isNavActive = (id: AppScreen) =>
    activeScreen === id || (id === 'map' && activeScreen === 'detail');

  return (
    <>
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-sm border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-8">
          {/* Zone 1: Brand wordmark only */}
          <button
            type="button"
            onClick={() => onNavigate('map')}
            className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 cursor-pointer"
          >
            SAATH
          </button>

          {/* Zone 2: 5 concise single-line nav links */}
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600" aria-label="Primary">
            {navItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.id)}
                className={`py-1.5 border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  isNavActive(item.id)
                    ? item.id === 'sos'
                      ? 'border-red-600 text-red-700 font-semibold'
                      : 'border-blue-700 text-slate-900 font-semibold'
                    : 'border-transparent hover:text-slate-900 hover:border-slate-300'
                }`}
              >
                {item.label}
              </button>
            ))}
          </nav>

          {/* Zone 3: 1 primary action */}
          <div className="flex items-center shrink-0">
            <button
              type="button"
              onClick={() => onNavigate('report')}
              className="px-4 py-2 min-h-[40px] text-sm font-medium bg-blue-700 text-white rounded-lg hover:bg-blue-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Report Incident
            </button>
          </div>
        </div>
      </header>

      {/* Mobile Bottom Thumb-Zone Navigation (compact height <= 15% cap) */}
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 z-30 bg-white/95 backdrop-blur-md border-t border-slate-200 h-14 grid grid-cols-5 items-center"
        aria-label="Mobile navigation"
      >
        <button
          type="button"
          onClick={() => onNavigate('map')}
          className={`flex flex-col items-center justify-center min-h-[44px] text-[11px] font-medium whitespace-nowrap ${
            isNavActive('map') ? 'text-blue-700 font-semibold' : 'text-slate-600'
          }`}
        >
          <MapPin className="w-4 h-4 mb-0.5" />
          <span>Map</span>
        </button>
        <button
          type="button"
          onClick={() => onNavigate('routes')}
          className={`flex flex-col items-center justify-center min-h-[44px] text-[11px] font-medium whitespace-nowrap ${
            activeScreen === 'routes' ? 'text-blue-700 font-semibold' : 'text-slate-600'
          }`}
        >
          <Compass className="w-4 h-4 mb-0.5" />
          <span>Routes</span>
        </button>
        <button
          type="button"
          onClick={() => onNavigate('sos')}
          className={`flex flex-col items-center justify-center min-h-[44px] text-[11px] font-semibold whitespace-nowrap ${
            activeScreen === 'sos' ? 'text-red-700' : 'text-red-600'
          }`}
        >
          <AlertTriangle className="w-4 h-4 mb-0.5" />
          <span>SOS</span>
        </button>
        <button
          type="button"
          onClick={() => onNavigate('help')}
          className={`flex flex-col items-center justify-center min-h-[44px] text-[11px] font-medium whitespace-nowrap ${
            activeScreen === 'help' ? 'text-blue-700 font-semibold' : 'text-slate-600'
          }`}
        >
          <HandHelping className="w-4 h-4 mb-0.5" />
          <span>Help</span>
        </button>
        <button
          type="button"
          onClick={() => onNavigate('operator')}
          className={`flex flex-col items-center justify-center min-h-[44px] text-[11px] font-medium whitespace-nowrap ${
            activeScreen === 'operator' || activeScreen === 'login'
              ? 'text-blue-700 font-semibold'
              : 'text-slate-600'
          }`}
        >
          <Shield className="w-4 h-4 mb-0.5" />
          <span>Console</span>
        </button>
      </nav>
    </>
  );
}

export function ToastStack({
  toasts,
  onDismiss,
}: {
  toasts: ToastNotice[];
  onDismiss: (id: string) => void;
}) {
  if (toasts.length === 0) return null;
  return (
    <div
      className="fixed top-16 right-4 z-40 w-[min(380px,calc(100vw-2rem))] space-y-2"
      aria-live="polite"
    >
      {toasts.map((t) => {
        const toneBorder =
          t.tone === 'error'
            ? 'border-red-300 bg-red-50 text-red-900'
            : t.tone === 'warning'
              ? 'border-amber-300 bg-amber-50 text-amber-950'
              : t.tone === 'success'
                ? 'border-emerald-300 bg-emerald-50 text-emerald-950'
                : 'border-blue-300 bg-white text-slate-900';
        return (
          <div
            key={t.id}
            className={`rounded-xl border p-3.5 shadow-sm flex items-start gap-3 ${toneBorder}`}
          >
            <Bell className="w-4 h-4 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold">{t.title}</div>
              <p className="text-xs mt-0.5 leading-relaxed opacity-90">{t.message}</p>
            </div>
            <button
              type="button"
              onClick={() => onDismiss(t.id)}
              className="p-1 rounded hover:bg-black/5 cursor-pointer"
              aria-label="Dismiss notification"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
