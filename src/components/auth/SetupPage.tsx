import { useState } from 'react';
import { api } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import type { AuthUser } from '../../types';

export default function SetupPage() {
  const { login } = useAuth();
  const [name, setName] = useState('');
  const [passcode, setPasscode] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (passcode.length < 4)  { setError('Passcode must be at least 4 characters'); return; }
    if (passcode !== confirm)  { setError('Passcodes do not match'); return; }
    setBusy(true);
    setError('');
    try {
      const res = await api.post<{ token: string; user: AuthUser }>('/auth/setup', { name: name.trim(), passcode });
      login(res.token, res.user);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="app-logo" style={{ fontSize: '2rem', marginBottom: 16 }}>
          Last<span style={{ color: 'var(--indigo)' }}>Man</span>
        </div>
        <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 24 }}>
          First run — create your admin account.
        </p>

        {error && <div className="alert alert-error" style={{ marginBottom: 16 }}>{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Your name</label>
            <input
              type="text" autoComplete="name"
              value={name} onChange={e => setName(e.target.value)}
              placeholder="Andrew" required
            />
          </div>
          <div className="form-group">
            <label>Passcode</label>
            <input
              type="password" autoComplete="new-password"
              value={passcode} onChange={e => setPasscode(e.target.value)}
              placeholder="Min. 4 characters" required
            />
          </div>
          <div className="form-group">
            <label>Confirm passcode</label>
            <input
              type="password" autoComplete="new-password"
              value={confirm} onChange={e => setConfirm(e.target.value)}
              placeholder="Repeat passcode" required
            />
          </div>
          <button type="submit" className="btn btn-primary btn-full" disabled={busy || !name.trim() || !passcode || !confirm}>
            {busy ? <><span className="spinner" /> Creating…</> : 'Create Admin Account'}
          </button>
        </form>
      </div>
    </div>
  );
}
