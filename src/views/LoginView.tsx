import { LogOut, Plus, Trash2, UserCheck } from 'lucide-react';
import { FormEvent, useEffect, useState } from 'react';
import { TrustedContact, UserProfile, UserRole } from '../types/saath';
import { api } from '../lib/api';

interface LoginViewProps {
  currentUser: UserProfile | null;
  initialRole?: UserRole;
  onLoginSuccess: (token: string, user: UserProfile) => void;
  onLogout: () => Promise<void>;
  onUpdateProfile: (patch: Partial<UserProfile>) => Promise<void>;
}

const DEMO_CITIZENS = ['Asha', 'Ravi', 'Meera', 'Karan'];

export function LoginView({
  currentUser,
  initialRole = 'citizen',
  onLoginSuccess,
  onLogout,
  onUpdateProfile,
}: LoginViewProps) {
  const [displayName, setDisplayName] = useState(
    initialRole === 'operator' ? 'operator1' : 'Asha',
  );
  const [role, setRole] = useState<UserRole>(initialRole);
  const [password, setPassword] = useState('');
  const [operatorMode, setOperatorMode] = useState<'env' | 'claimed' | 'unclaimed'>('env');
  const [claimPasscode, setClaimPasscode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [contacts, setContacts] = useState<TrustedContact[]>([]);
  const [newContactName, setNewContactName] = useState('');
  const [newContactPhone, setNewContactPhone] = useState('');

  useEffect(() => {
    api
      .operatorStatus()
      .then((res) => setOperatorMode(res.mode))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (currentUser) {
      api
        .getContacts()
        .then((res) => setContacts(res.contacts))
        .catch(() => {});
    } else {
      setContacts([]);
    }
  }, [currentUser?.id]);

  const handleClaimPasscode = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.claimOperator(claimPasscode);
      setOperatorMode('claimed');
      setPassword(claimPasscode);
      setClaimPasscode('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save operator passcode.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await api.demoLogin({
        display_name: displayName.trim(),
        role,
        password: role === 'operator' ? password : undefined,
      });
      onLoginSuccess(res.token, res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleAddContact = async (e: FormEvent) => {
    e.preventDefault();
    if (!newContactName.trim() || !newContactPhone.trim()) return;
    try {
      const added = await api.addContact(newContactName.trim(), newContactPhone.trim());
      setContacts((prev) => [...prev, added]);
      setNewContactName('');
      setNewContactPhone('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to add contact.');
    }
  };

  const handleDeleteContact = async (id: number) => {
    try {
      await api.deleteContact(id);
      setContacts((prev) => prev.filter((c) => c.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to remove contact.');
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="border-b border-slate-200 pb-4">
        <h1 className="text-2xl font-bold text-slate-900">Account &amp; Demo Sign-In</h1>
        <p className="text-sm text-slate-600 mt-1">
          Demo-grade session authentication for citizen reporting, alerts, SOS, and operator review. Operator access is verified server-side.
        </p>
      </div>

      {error && (
        <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-xs text-red-800">
          {error}
        </div>
      )}

      {currentUser && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
            <div className="flex items-center gap-2.5">
              <UserCheck className="w-5 h-5 text-blue-700" />
              <div>
                <div className="text-base font-bold text-slate-900">{currentUser.display_name}</div>
                <div className="text-xs text-slate-500">Role: {currentUser.role}</div>
              </div>
            </div>
            <button
              type="button"
              onClick={onLogout}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-300 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer self-start"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign out</span>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={currentUser.alerts_opt_in}
                onChange={(e) => onUpdateProfile({ alerts_opt_in: e.target.checked })}
                className="w-4 h-4 rounded border-slate-300 text-blue-700"
              />
              <span>Receive nearby incident alerts</span>
            </label>

            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={currentUser.help_opt_in}
                onChange={(e) => onUpdateProfile({ help_opt_in: e.target.checked })}
                className="w-4 h-4 rounded border-slate-300 text-blue-700"
              />
              <span>Opt in to nearby help network (2 km)</span>
            </label>
          </div>

          <div className="pt-2 border-t border-slate-100 space-y-3">
            <h2 className="text-sm font-semibold text-slate-900">Trusted Contacts (for SOS)</h2>
            {contacts.length > 0 && (
              <ul className="divide-y divide-slate-100 text-xs">
                {contacts.map((c) => (
                  <li key={c.id} className="py-2 flex items-center justify-between gap-3">
                    <span>
                      <strong>{c.name}</strong> · <span className="font-mono text-slate-600">{c.contact}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => handleDeleteContact(c.id)}
                      className="p-1.5 text-slate-500 hover:text-red-700 cursor-pointer"
                      aria-label={`Remove ${c.name}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <form onSubmit={handleAddContact} className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={newContactName}
                onChange={(e) => setNewContactName(e.target.value)}
                placeholder="Contact name"
                className="flex-1 h-9 px-3 rounded-lg border border-slate-300 text-xs"
              />
              <input
                type="text"
                value={newContactPhone}
                onChange={(e) => setNewContactPhone(e.target.value)}
                placeholder="Phone or email"
                className="flex-1 h-9 px-3 rounded-lg border border-slate-300 text-xs"
              />
              <button
                type="submit"
                className="inline-flex items-center justify-center gap-1 px-3.5 h-9 rounded-lg bg-slate-900 text-white text-xs font-semibold cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add</span>
              </button>
            </form>
          </div>
        </div>
      )}

      {/* First-Run Operator Passcode Claim (only when env secret is unset & unclaimed) */}
      {role === 'operator' && operatorMode === 'unclaimed' && (
        <form
          onSubmit={handleClaimPasscode}
          className="bg-amber-50 border border-amber-300 rounded-xl p-5 space-y-3"
        >
          <h2 className="text-sm font-bold text-amber-950">
            First-Run Operator Passcode Setup
          </h2>
          <p className="text-xs text-amber-900 leading-relaxed">
            No <code>OPERATOR_PASSWORD</code> environment secret is configured yet. Set an initial operator passcode below (stored hashed on the server) to unlock Operator Console access.
          </p>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="password"
              value={claimPasscode}
              onChange={(e) => setClaimPasscode(e.target.value)}
              placeholder="Create operator passcode (min 4 chars)"
              minLength={4}
              required
              className="flex-1 h-10 px-3 rounded-lg border border-amber-300 bg-white text-sm"
            />
            <button
              type="submit"
              disabled={submitting}
              className="px-4 h-10 rounded-lg bg-slate-900 text-white text-xs font-semibold cursor-pointer"
            >
              Save passcode
            </button>
          </div>
        </form>
      )}

      {/* Sign In Form */}
      <form onSubmit={handleLogin} className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <h2 className="text-base font-semibold text-slate-900">
          {currentUser ? 'Switch Demo Account' : 'Sign In'}
        </h2>

        <div className="flex gap-2">
          {(['citizen', 'operator'] as UserRole[]).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => {
                setRole(r);
                setDisplayName(r === 'operator' ? 'operator1' : 'Asha');
                setError(null);
              }}
              className={`px-4 py-2 rounded-lg text-xs font-semibold border cursor-pointer ${
                role === r
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
              }`}
            >
              {r === 'citizen' ? 'Citizen' : 'Operator'}
            </button>
          ))}
        </div>

        {role === 'citizen' && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-slate-500">Quick demo citizens:</span>
            {DEMO_CITIZENS.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => setDisplayName(name)}
                className={`px-2.5 py-1 rounded border cursor-pointer ${
                  displayName === name
                    ? 'bg-blue-700 text-white border-blue-700'
                    : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                }`}
              >
                {name}
              </button>
            ))}
          </div>
        )}

        <div>
          <label htmlFor="login-name" className="block text-xs font-semibold text-slate-700 mb-1.5">
            Display name
          </label>
          <input
            id="login-name"
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
            maxLength={60}
            className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm"
          />
        </div>

        {role === 'operator' && (
          <div>
            <label htmlFor="login-password" className="block text-xs font-semibold text-slate-700 mb-1.5">
              Operator passcode
            </label>
            <input
              id="login-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              placeholder="Enter operator passcode"
              className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm"
            />
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="px-5 py-2.5 min-h-[44px] rounded-lg bg-blue-700 text-white text-sm font-semibold hover:bg-blue-800 cursor-pointer disabled:opacity-50"
        >
          {submitting ? 'Signing in...' : `Continue as ${role}`}
        </button>
      </form>
    </div>
  );
}
