import { useState } from 'react';
import { api } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';

interface InviteResult {
  token: string;
  inviteUrl: string;
  role: string;
  expiresAt: string;
}

export default function InviteQR() {
  const { isAdmin, isManager } = useAuth();
  const [invite, setInvite] = useState<InviteResult | null>(null);
  const [qrSvg, setQrSvg] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!isAdmin && !isManager) return null;

  async function generate(role: 'manager' | 'player') {
    setBusy(true);
    setError('');
    setInvite(null);
    setQrSvg('');
    try {
      const result = await api.post<InviteResult>('/auth/invite', { role });
      setInvite(result);
      const QRCode = await import('qrcode');
      const svg = await QRCode.toString(result.inviteUrl, { type: 'svg', width: 220, margin: 2 });
      setQrSvg(svg);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setInvite(null);
    setQrSvg('');
  }

  const roleLabel = invite?.role === 'player' ? 'Player' : 'Manager';

  return (
    <div>
      {!invite ? (
        <>
          {error && <div className="alert alert-error" style={{ marginBottom: 12 }}>{error}</div>}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {isAdmin && (
              <button className="btn btn-primary" onClick={() => generate('manager')} disabled={busy}>
                {busy ? <><span className="spinner" /> Generating…</> : 'Invite Manager'}
              </button>
            )}
            <button className="btn btn-primary" onClick={() => generate('player')} disabled={busy}>
              {busy ? <><span className="spinner" /> Generating…</> : 'Invite Player'}
            </button>
          </div>
        </>
      ) : (
        <div style={{ textAlign: 'center' }}>
          <div
            style={{ display: 'inline-block', background: '#fff', padding: 12, borderRadius: 8 }}
            dangerouslySetInnerHTML={{ __html: qrSvg }}
          />
          <p style={{ marginTop: 8, fontSize: 13, color: 'var(--text-muted)' }}>
            {roleLabel} invite · expires {new Date(invite.expiresAt).toLocaleTimeString()}
          </p>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', wordBreak: 'break-all', marginTop: 4 }}>
            {invite.inviteUrl}
          </p>
          <button className="btn btn-ghost btn-sm" style={{ marginTop: 12 }} onClick={reset}>
            Generate another
          </button>
        </div>
      )}
    </div>
  );
}
