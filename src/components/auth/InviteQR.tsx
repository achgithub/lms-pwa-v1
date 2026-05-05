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

  const targetRole = isAdmin ? 'Manager' : isManager ? 'Player' : null;
  if (!targetRole) return null;

  async function generate() {
    setBusy(true);
    setError('');
    setInvite(null);
    setQrSvg('');
    try {
      const result = await api.post<InviteResult>('/auth/invite', {});
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

  return (
    <div>
      {!invite ? (
        <>
          {error && <div className="alert alert-error" style={{ marginBottom: 12 }}>{error}</div>}
          <button className="btn btn-primary" onClick={generate} disabled={busy}>
            {busy ? <><span className="spinner" /> Generating…</> : `Invite ${targetRole}`}
          </button>
        </>
      ) : (
        <div style={{ textAlign: 'center' }}>
          <div
            style={{ display: 'inline-block', background: '#fff', padding: 12, borderRadius: 8 }}
            dangerouslySetInnerHTML={{ __html: qrSvg }}
          />
          <p style={{ marginTop: 8, fontSize: 13, color: 'var(--text-muted)' }}>
            {targetRole} invite · expires {new Date(invite.expiresAt).toLocaleTimeString()}
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
