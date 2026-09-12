import React, { useEffect, useState } from 'react';
import { api } from '../api';
import { getSocket, sendCommand } from '../socket';

const VALVE_NAMES = ['Normal', 'Cooling'];
const EMPTY_LIVE = { flow_lpm: 0, valve_open: false, delivered_pulses: 0, target_pulses: 0 };

export default function Device({ device, onBack, toast }) {
  const [detail, setDetail] = useState(null);
  const [liveByValve, setLiveByValve] = useState({ 0: EMPTY_LIVE, 1: EMPTY_LIVE });
  const [online, setOnline] = useState(device.is_online);

  useEffect(() => {
    load();
    const socket = getSocket();
    if (!socket) return;

    function onStatus(payload) {
      if (payload.device_id !== device.id) return;
      const v = payload.valve === 1 ? 1 : 0;
      setLiveByValve((prev) => ({ ...prev, [v]: payload }));
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

  function dispensePreset(valve, preset) {
    if (!preset.pulses || preset.pulses <= 0) {
      toast('This preset has no pulses set yet - configure it in Control');
      return;
    }
    sendCommand(device.id, 'dispense', { valve, pulses: preset.pulses });
    toast(`Dispensing ${VALVE_NAMES[valve]} P${preset.slot_index + 1}...`);
  }

  function stopValve(valve) {
    sendCommand(device.id, 'stop', { valve });
    toast(`${VALVE_NAMES[valve]} stop sent`);
  }

  const valves = detail?.valves || [];
  const recentTxns = detail?.recent_transactions || [];

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

      {[0, 1].map((v) => {
        const live = liveByValve[v] || EMPTY_LIVE;
        const liters = (live.delivered_pulses / 240).toFixed(2);
        const valveData = valves.find((x) => x.valve === v);
        const presets = valveData?.presets || [];

        return (
          <div key={v} style={{ marginBottom: 28 }}>
            <p className="section-title">{VALVE_NAMES[v]}</p>

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

            <div className="preset-row">
              {presets.map((p) => (
                <div className="preset-chip" key={p.slot_index} onClick={() => dispensePreset(v, p)}>
                  <div className="preset-chip-label">P{p.slot_index + 1}</div>
                  <div className="preset-chip-value">{p.pulses || '—'}</div>
                </div>
              ))}
            </div>

            <div className="action-grid" style={{ marginTop: 10 }}>
              <div className="action-btn" onClick={() => presets[0] && dispensePreset(v, presets[0])}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <path d="M12 2C12 2 5 10.5 5 15a7 7 0 0014 0C19 10.5 12 2 12 2z" stroke="#2fb6c4" strokeWidth="1.6" />
                </svg>
                <span className="action-label">Dispense P1</span>
              </div>
              <div className="action-btn danger" onClick={() => stopValve(v)}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <rect x="6" y="6" width="12" height="12" rx="2" stroke="#f16063" strokeWidth="1.6" />
                </svg>
                <span className="action-label">Stop / Close</span>
              </div>
            </div>
          </div>
        );
      })}

      <p className="section-title">Recent transactions</p>
      <div className="stat-box" style={{ marginBottom: 8 }}>
        <div className="stat-value">{recentTxns.length}</div>
        <div className="stat-label">Last 20 events (both taps)</div>
      </div>
      {recentTxns.map((t) => (
        <div className="list-row" key={t.id}>
          <span className="list-row-title">{VALVE_NAMES[t.valve] || 'Normal'} · {t.source}</span>
          <span className="list-row-sub">{t.pulses}p · {t.status}</span>
        </div>
      ))}
    </div>
  );
}
