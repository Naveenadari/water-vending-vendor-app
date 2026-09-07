import React, { useEffect, useState } from 'react';
import { api } from '../api';

export default function Home({ vendor, onSelectDevice }) {
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
    const interval = setInterval(load, 10000);
    return () => clearInterval(interval);
  }, []);

  async function load() {
    try {
      const list = await api.listDevices(vendor.id);
      setDevices(list);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="screen">
      <div className="header-row">
        <div>
          <p className="greeting-label">Good day</p>
          <p className="greeting-name">{vendor.name}</p>
        </div>
      </div>

      <p className="section-title">Your machines</p>

      {loading && <p className="empty-state">Loading...</p>}

      {!loading && devices.length === 0 && (
        <p className="empty-state">
          No machines linked yet. Machines appear here once provisioned.
        </p>
      )}

      {devices.map((d) => (
        <div className="device-card" key={d.id} onClick={() => onSelectDevice(d)}>
          <div>
            <p className="device-name">{d.name}</p>
            <span className="device-status-text">
              <span className={`status-dot ${d.is_online ? 'online' : 'offline'}`} />
              {d.is_online ? 'Online' : 'Offline'}
            </span>
          </div>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M9 6l6 6-6 6" stroke="#57626f" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </div>
      ))}
    </div>
  );
}
