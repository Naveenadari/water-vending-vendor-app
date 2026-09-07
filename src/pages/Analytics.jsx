import React, { useEffect, useState } from 'react';
import { api } from '../api';

export default function Analytics({ device, onBack }) {
  const [detail, setDetail] = useState(null);

  useEffect(() => {
    load();
    const interval = setInterval(load, 8000);
    return () => clearInterval(interval);
  }, []);

  async function load() {
    const data = await api.getDevice(device.id);
    setDetail(data);
  }

  if (!detail) return <div className="screen"><p className="empty-state">Loading...</p></div>;

  const txns = detail.recent_transactions || [];
  const totalRevenue = txns
    .filter((t) => t.status === 'completed' && t.amount_rupees)
    .reduce((sum, t) => sum + Number(t.amount_rupees), 0);

  return (
    <div className="screen">
      <button className="back-link" onClick={onBack}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <path d="M15 6l-6 6 6 6" stroke="#8b97a8" strokeWidth="2" strokeLinecap="round" />
        </svg>
        {device.name}
      </button>

      <p className="section-title">Recent activity</p>

      <div className="stat-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <div className="stat-box">
          <div className="stat-value">Rs{totalRevenue}</div>
          <div className="stat-label">Revenue (recent)</div>
        </div>
        <div className="stat-box">
          <div className="stat-value">{txns.length}</div>
          <div className="stat-label">Transactions</div>
        </div>
      </div>

      {txns.length === 0 && <p className="empty-state">No transactions yet.</p>}

      {txns.map((t) => (
        <div className="list-row" key={t.id}>
          <div>
            <p className="list-row-title" style={{ textTransform: 'capitalize' }}>{t.source}</p>
            <p className="list-row-sub">
              {t.pulses ? `${t.pulses} pulses` : ''}
              {t.amount_rupees ? ` · Rs${t.amount_rupees}` : ''}
              {' · '}
              {new Date(t.created_at).toLocaleString()}
            </p>
          </div>
          <span className={`pill ${t.status}`}>{t.status}</span>
        </div>
      ))}
    </div>
  );
}
