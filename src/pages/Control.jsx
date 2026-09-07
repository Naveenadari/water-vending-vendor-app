import React, { useEffect, useState } from 'react';
import { api } from '../api';
import { sendCommand } from '../socket';

export default function Control({ device, onBack, toast }) {
  const [detail, setDetail] = useState(null);
  const [calibratingSlot, setCalibratingSlot] = useState(null);
  const [editValues, setEditValues] = useState({});
  const [settingsForm, setSettingsForm] = useState(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const data = await api.getDevice(device.id);
    setDetail(data);
    setSettingsForm(data.settings);
  }

  function savePresetManually(slotIndex) {
    const pulses = Number(editValues[slotIndex]);
    if (!pulses || pulses <= 0) {
      toast('Enter a pulse count first');
      return;
    }
    sendCommand(device.id, 'save_preset', { slot_index: slotIndex, pulses });
    toast(`V${slotIndex + 1} saved: ${pulses} pulses`);
    setTimeout(load, 1200);
  }

  function startCalibration(slotIndex) {
    sendCommand(device.id, 'start_calibration', { slot_index: slotIndex });
    setCalibratingSlot(slotIndex);
    toast(`Calibrating V${slotIndex + 1} - fill the container, then tap Done`);
  }

  function finishCalibration() {
    sendCommand(device.id, 'finish_calibration');
    setCalibratingSlot(null);
    toast('Calibration saved');
    setTimeout(load, 1500);
  }

  function cancelCalibration() {
    sendCommand(device.id, 'cancel_calibration');
    setCalibratingSlot(null);
  }

  function saveSettings() {
    sendCommand(device.id, 'save_settings', {
      timeout_seconds: Number(settingsForm.timeout_seconds),
      pulses_per_rupee: Number(settingsForm.pulses_per_rupee),
      topup_amount: Number(settingsForm.topup_amount),
      trip_cost: Number(settingsForm.trip_cost),
      confirm_mode: settingsForm.confirm_mode,
    });
    toast('Settings sent to machine');
  }

  if (!detail) return <div className="screen"><p className="empty-state">Loading...</p></div>;

  return (
    <div className="screen">
      <button className="back-link" onClick={onBack}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <path d="M15 6l-6 6 6 6" stroke="#8b97a8" strokeWidth="2" strokeLinecap="round" />
        </svg>
        {device.name}
      </button>

      <p className="section-title">Presets</p>
      {detail.presets.map((p) => (
        <div className="list-row" key={p.id} style={{ flexDirection: 'column', alignItems: 'stretch' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
            <span className="list-row-title">V{p.slot_index + 1}</span>
            <span className="list-row-sub">{p.pulses} pulses</span>
          </div>
          {calibratingSlot === p.slot_index ? (
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn-primary" style={{ flex: 1 }} onClick={finishCalibration}>Done - Save</button>
              <button className="btn-secondary" style={{ flex: 1 }} onClick={cancelCalibration}>Cancel</button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                className="field"
                style={{ margin: 0, flex: 1 }}
                placeholder="pulses"
                inputMode="numeric"
                value={editValues[p.slot_index] || ''}
                onChange={(e) => setEditValues({ ...editValues, [p.slot_index]: e.target.value })}
              />
              <button className="btn-secondary" onClick={() => savePresetManually(p.slot_index)}>Save</button>
              <button className="btn-secondary" onClick={() => startCalibration(p.slot_index)}>Fill & Calibrate</button>
            </div>
          )}
        </div>
      ))}

      <p className="section-title" style={{ marginTop: 24 }}>Settings</p>

      <label className="field-label">Confirm mode (customer presses button before dispense)</label>
      <div className="toggle-row">
        <span className="list-row-sub">Off = dispenses immediately</span>
        <div
          className={`toggle ${settingsForm.confirm_mode ? 'on' : ''}`}
          onClick={() => setSettingsForm({ ...settingsForm, confirm_mode: !settingsForm.confirm_mode })}
        >
          <div className="toggle-knob" />
        </div>
      </div>

      <label className="field-label">Timeout (seconds)</label>
      <input
        className="field"
        inputMode="numeric"
        value={settingsForm.timeout_seconds}
        onChange={(e) => setSettingsForm({ ...settingsForm, timeout_seconds: e.target.value })}
      />

      <label className="field-label">Coin pulses / rupee</label>
      <input
        className="field"
        inputMode="numeric"
        value={settingsForm.pulses_per_rupee}
        onChange={(e) => setSettingsForm({ ...settingsForm, pulses_per_rupee: e.target.value })}
      />

      <label className="field-label">Card top-up amount (Rs)</label>
      <input
        className="field"
        inputMode="numeric"
        value={settingsForm.topup_amount}
        onChange={(e) => setSettingsForm({ ...settingsForm, topup_amount: e.target.value })}
      />

      <label className="field-label">Card trip cost (Rs)</label>
      <input
        className="field"
        inputMode="numeric"
        value={settingsForm.trip_cost}
        onChange={(e) => setSettingsForm({ ...settingsForm, trip_cost: e.target.value })}
      />

      <button className="btn-primary" onClick={saveSettings}>Save settings to machine</button>
    </div>
  );
}
