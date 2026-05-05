import { useState } from 'react';
import { api } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import type { AuthUser } from '../../types';

export default function LoginPage() {
  const { login } = useAuth();
  const [name, setName] = useState('');
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await api.post<{ token: string; user: AuthUser }>('/auth/login', { name: name.trim(), passcode });
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
        <div className="app-logo" style={{ fontSize: '2rem', marginBottom: 8 }}>LMS</div>
        <h1 style={{ fontSize: '1.2rem', marginBottom: 24 }}>Last Man Standing</h1>

        {error && <div className="alert alert-error" style={{ marginBottom: 16 }}>{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Name</label>
            <input
              type="text" autoComplete="username"
              value={name} onChange={e => setName(e.target.value)}
              placeholder="Your name" required
            />
          </div>
          <div className="form-group">
            <label>Passcode</label>
            <input
              type="password" autoComplete="current-password"
              value={passcode} onChange={e => setPasscode(e.target.value)}
              placeholder="••••" required
            />
          </div>
          <button type="submit" className="btn btn-primary btn-full" disabled={busy || !name.trim() || !passcode}>
            {busy ? <><span className="spinner" /> Signing in…</> : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}
