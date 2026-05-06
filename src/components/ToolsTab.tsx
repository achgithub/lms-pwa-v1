import { useRef, useState } from 'react';
import { exportData, importData } from '../db';
import { api } from '../api/client';
import { useAuth } from '../contexts/AuthContext';

export default function ToolsTab() {
  const { isAdmin } = useAuth();
  const [status, setStatus] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [groups, setGroups] = useState<{ id: number; name: string }[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<number | ''>('');
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [importing2, setImporting2] = useState(false);

  async function loadGroups() {
    setLoadingGroups(true);
    try {
      const data = await api.get<{ id: number; name: string }[]>('/groups');
      setGroups(data);
      if (data.length > 0) setSelectedGroupId(data[0].id);
    } catch (e) {
      showStatus('error', `Failed to load groups: ${String(e)}`);
    } finally {
      setLoadingGroups(false);
    }
  }

  async function handleImportTeams() {
    if (!selectedGroupId) return;
    setImporting2(true);
    try {
      const res = await api.post<{ imported: number }>('/admin/import-teams', { groupId: selectedGroupId });
      showStatus('success', `Imported ${res.imported} teams into group`);
    } catch (e) {
      showStatus('error', `Import failed: ${String(e)}`);
    } finally {
      setImporting2(false);
    }
  }

  function showStatus(type: 'success' | 'error', msg: string) {
    setStatus({ type, msg });
    setTimeout(() => setStatus(null), 4000);
  }

  // ── Export ────────────────────────────────────────────────────────────────

  async function handleExport() {
    setExporting(true);
    try {
      const data = await exportData();
      const json = JSON.stringify(data, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const filename = `lms-backup-${new Date().toISOString().slice(0, 10)}.json`;
      const file = new File([blob], filename, { type: 'application/json' });

      // iOS Safari: Web Share API with file attachment
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'LMS Backup' });
      } else {
        // Desktop / other browsers: trigger a download
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
        showStatus('success', `Exported as ${filename}`);
      }
    } catch (e) {
      // navigator.share throws AbortError when the user dismisses the sheet — not an error
      if (e instanceof Error && e.name !== 'AbortError') {
        showStatus('error', String(e));
      }
    } finally {
      setExporting(false);
    }
  }

  // ── Import ────────────────────────────────────────────────────────────────

  function handleImportClick() {
    fileInputRef.current?.click();
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    // Reset input so the same file can be re-selected after an error
    e.target.value = '';

    if (!confirm(`Replace ALL current data with the contents of "${file.name}"?\n\nThis cannot be undone.`)) return;

    setImporting(true);
    try {
      const text = await file.text();
      await importData(text);
      showStatus('success', 'Data restored successfully — reload tabs to see the changes.');
    } catch (e) {
      showStatus('error', `Import failed: ${String(e)}`);
    } finally {
      setImporting(false);
    }
  }

  return (
    <div>
      <div className="card">
        <h2 className="card-title">Backup &amp; Restore</h2>
        <p className="text-muted" style={{ marginBottom: 20 }}>
          All data lives in your browser's IndexedDB. Use these tools to back up before
          clearing site data, or to move data between devices.
        </p>

        {status && (
          <div className={`alert alert-${status.type === 'success' ? 'success' : 'error'}`} style={{ marginBottom: 16 }}>
            {status.msg}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Export */}
          <div style={{ padding: 16, border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
            <div className="section-header" style={{ marginBottom: 8 }}>
              <div>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>Export data</div>
                <div className="text-muted">
                  Saves a JSON backup of all groups, teams, players, games, rounds and picks.
                  On iOS the system share sheet will open so you can save to Files or send elsewhere.
                </div>
              </div>
            </div>
            <button
              className="btn btn-primary"
              onClick={handleExport}
              disabled={exporting}
            >
              {exporting ? <><span className="spinner" /> Exporting…</> : 'Export Backup'}
            </button>
          </div>

          {/* Import */}
          <div style={{ padding: 16, border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
            <div className="section-header" style={{ marginBottom: 8 }}>
              <div>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>Restore from backup</div>
                <div className="text-muted">
                  Select a <code>.json</code> file exported from this app.{' '}
                  <strong style={{ color: 'var(--danger)' }}>All current data will be replaced.</strong>
                </div>
              </div>
            </div>
            <button
              className="btn btn-secondary"
              onClick={handleImportClick}
              disabled={importing}
            >
              {importing ? <><span className="spinner" /> Restoring…</> : 'Restore from File'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              style={{ display: 'none' }}
              onChange={handleFileSelected}
            />
          </div>
        </div>
      </div>

      {isAdmin && (
        <div className="card" style={{ marginTop: 16 }}>
          <h2 className="card-title">Import PL Teams</h2>
          <p className="text-muted" style={{ marginBottom: 16 }}>
            One-off import of Premier League teams from football-data.org into a group.
          </p>
          {status && (
            <div className={`alert alert-${status.type === 'success' ? 'success' : 'error'}`} style={{ marginBottom: 16 }}>
              {status.msg}
            </div>
          )}
          {groups.length === 0 ? (
            <button className="btn btn-secondary" onClick={loadGroups} disabled={loadingGroups}>
              {loadingGroups ? <><span className="spinner" /> Loading…</> : 'Load Groups'}
            </button>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <select
                className="input"
                value={selectedGroupId}
                onChange={e => setSelectedGroupId(Number(e.target.value))}
              >
                {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
              <button className="btn btn-primary" onClick={handleImportTeams} disabled={importing2}>
                {importing2 ? <><span className="spinner" /> Importing…</> : 'Import PL Teams'}
              </button>
            </div>
          )}
        </div>
      )}

      <div className="card" style={{ marginTop: 16 }}>
        <h2 className="card-title">About</h2>
        <div style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.8 }}>
          <div>All data is stored locally in IndexedDB — nothing is sent to a server.</div>
          <div>Access is controlled externally by Cloudflare Access.</div>
          <div style={{ marginTop: 8 }}>
            Export regularly to avoid data loss if your browser storage is cleared.
          </div>
        </div>
      </div>
    </div>
  );
}
