import React, { useEffect, useState } from 'react';
import { api } from '../api';
import { getSocket, sendCommand } from '../socket';

export default function Device({ device, onBack, toast }) {
  const [detail, setDetail] = useState(null);
  const [live, setLive] = useState({ flow_lpm: 0, valve_open: false, delivered_pulses: 0, target_pulses: 0 });
  const [online, setOnline] = useState(device.is_online);

  useEffect(() => {
    load();
    const socket = getSocket();
    if (!socket) return;

    function onStatus(payload) {
      if (payload.device_id !== device.id) return;
      setLive(payload);
    }
    function onOnline(payload) {
      if (payload.device_id === device.id) setOnline(true);
    }
    function onOffline(payload) {
      if (payload.device_id === device.id) setOnline(false);
    }
    function onTx(payload) {
      if (payload.device_id === device.id) load();
    }

    socket.on('device_status', onStatus);
    socket.on('device_online', onOnline);
    socket.on('device_offline', onOffline);
    socket.on('new_transaction', onTx);
    socket.on('payment_matched', onTx);

    return () => {
      socket.off('device_status', onStatus);
      socket.off('device_online', onOnline);
      socket.off('device_offline', onOffline);
      socket.off('new_transaction', onTx);
      socket.off('payment_matched', onTx);
    };
  }, [device.id]);

  async function load() {
    try {
      const data = await api.getDevice(device.id);
      setDetail(data);
    } catch (err) {
      console.error(err);
    }
  }

  function dispensePreset(preset) {
    if (!preset.pulses || preset.pulses <= 0) {
      toast('This preset has no pulses set yet - configure it in Control');
      return;
    }
    sendCommand(device.id, 'dispense', { pulses: preset.pulses, source: 'app' });
    toast(`Dispensing ${preset.pulses} pulses...`);
  }

  function stopValve() {
    sendCommand(device.id, 'stop');
    toast('Stop sent');
  }

  const liters = (live.delivered_pulses / 240).toFixed(2);
  const presets = detail?.presets || [];

  return (
    <div className="screen">
      <button className="back-link" onClick={onBack}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <path d="M15 6l-6 6 6 6" stroke="#8b97a8" strokeWidth="2" strokeLinecap="round" />
        </svg>
        Machines
      </button>

      <div className="header-row">
        <div>
          <p className="greeting-label">
            <span className={`status-dot ${online ? 'online' : 'offline'}`} />
            {online ? 'Online' : 'Offline'}
          </p>
          <p className="greeting-name">{device.name}</p>
        </div>
      </div>

      <div className="meter-card">
        <div className="meter-top">
          <span className="meter-label">Live Flow</span>
          <span className={`valve-badge ${live.valve_open ? 'open' : 'closed'}`}>
            <span className={`status-dot ${live.valve_open ? 'online' : 'offline'}`} />
            {live.valve_open ? 'Valve Open' : 'Valve Closed'}
          </span>
        </div>
        <div className="meter-value-row">
          <span className="meter-value">{live.flow_lpm ? live.flow_lpm.toFixed(1) : '0.0'}</span>
          <span className="meter-unit">L/min</span>
        </div>
        <p className="meter-sub">{live.valve_open ? `${liters} L delivered` : 'Idle'}</p>
      </div>

      <div className="stat-grid">
        <div className="stat-box">
          <div className="stat-value">{liters}</div>
          <div className="stat-label">Liters (session)</div>
        </div>
        <div className="stat-box">
          <div className="stat-value">{live.delivered_pulses}</div>
          <div className="stat-label">Pulses</div>
        </div>
        <div className="stat-box">
          <div className="stat-value">{detail?.recent_transactions?.length || 0}</div>
          <div className="stat-label">Recent txns</div>
        </div>
      </div>

      <p className="section-title">Presets</p>
      <div className="preset-row">
        {presets.map((p) => (
          <div className="preset-chip" key={p.id} onClick={() => dispensePreset(p)}>
            <div className="preset-chip-label">V{p.slot_index + 1}</div>
            <div className="preset-chip-value">{p.pulses || '—'}</div>
          </div>
        ))}
      </div>

      <p className="section-title">Quick actions</p>
      <div className="action-grid">
        <div className="action-btn" onClick={() => presets[0] && dispensePreset(presets[0])}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M12 2C12 2 5 10.5 5 15a7 7 0 0014 0C19 10.5 12 2 12 2z" stroke="#2fb6c4" strokeWidth="1.6" />
          </svg>
          <span className="action-label">Dispense V1</span>
        </div>
        <div className="action-btn danger" onClick={stopValve}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <rect x="6" y="6" width="12" height="12" rx="2" stroke="#f16063" strokeWidth="1.6" />
          </svg>
          <span className="action-label">Stop / Close</span>
        </div>
      </div>
    </div>
  );
}
