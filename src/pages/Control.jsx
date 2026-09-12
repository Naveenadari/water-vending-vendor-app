import React, { useEffect, useState } from 'react';
import { api } from '../api';
import { sendCommand } from '../socket';

export default function Control({ device, onBack, toast }) {
  const [detail, setDetail] = useState(null);
  const [activeValve, setActiveValve] = useState(0);   // 0 = Normal, 1 = Cooling
  const [calibratingSlot, setCalibratingSlot] = useState(null);
  const [editValues, setEditValues] = useState({});
  const [valveSettingsForm, setValveSettingsForm] = useState({});   // { [valve]: {pulses_per_rupee, trip_cost} }
  const [sharedSettingsForm, setSharedSettingsForm] = useState(null);   // {topup_amount, timeout_seconds, confirm_mode}

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const data = await api.getDevice(device.id);
    setDetail(data);
    setSharedSettingsForm(data.device_settings);
    const perValve = {};
    data.valves.forEach((v) => { perValve[v.valve] = { ...v.settings }; });
    setValveSettingsForm(perValve);
  }

  function savePresetManually(slotIndex) {
    const key = `${activeValve}-${slotIndex}`;
    const pulses = Number(editValues[key]);
    if (!pulses || pulses <= 0) {
      toast('Enter a pulse count first');
      return;
    }
    sendCommand(device.id, 'save_preset', { valve: activeValve, slot_index: slotIndex, pulses });
    toast(`${valveName()} P${slotIndex + 1} saved: ${pulses} pulses`);
    setTimeout(load, 1200);
  }

  function startCalibration(slotIndex) {
    sendCommand(device.id, 'start_calibration', { valve: activeValve, slot_index: slotIndex });
    setCalibratingSlot(slotIndex);
    toast(`Calibrating ${valveName()} P${slotIndex + 1} - fill the container, then tap Done`);
  }

  function finishCalibration() {
    sendCommand(device.id, 'finish_calibration', { valve: activeValve });
    setCalibratingSlot(null);
    toast('Calibration saved');
    setTimeout(load, 1500);
  }

  function cancelCalibration() {
    sendCommand(device.id, 'cancel_calibration', { valve: activeValve });
    setCalibratingSlot(null);
  }

  function saveValveSettings() {
    const s = valveSettingsForm[activeValve];
    sendCommand(device.id, 'save_settings', {
      valve: activeValve,
      settings: {
        pulses_per_rupee: Number(s.pulses_per_rupee),
        trip_cost: Number(s.trip_cost),
      },
    });
    toast(`${valveName()} settings sent to machine`);
  }

  function saveSharedSettings() {
    sendCommand(device.id, 'save_settings', {
      valve: activeValve,   // ignored by backend for shared fields, harmless
      settings: {
        timeout_seconds: Number(sharedSettingsForm.timeout_seconds),
        topup_amount: Number(sharedSettingsForm.topup_amount),
        confirm_mode: sharedSettingsForm.confirm_mode,
      },
    });
    toast('Device settings sent to machine');
  }

  function valveName() {
    return activeValve === 0 ? 'Normal' : 'Cooling';
  }

  if (!detail || !sharedSettingsForm) return <div className="screen"><p className="empty-state">Loading...</p></div>;

  const currentValve = detail.valves.find((v) => v.valve === activeValve);
  const currentSettings = valveSettingsForm[activeValve] || { pulses_per_rupee: '', trip_cost: '' };

  return (
    <div className="screen">
      <button className="back-link" onClick={onBack}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <path d="M15 6l-6 6 6 6" stroke="#8b97a8" strokeWidth="2" strokeLinecap="round" />
        </svg>
        {device.name}
      </button>

      {/* Valve tab selector */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {[0, 1].map((v) => (
          <button
            key={v}
            className={v === activeValve ? 'btn-primary' : 'btn-secondary'}
            style={{ flex: 1 }}
            onClick={() => { setActiveValve(v); setCalibratingSlot(null); }}
          >
            {VALVE_TAB_LABEL(v)}
          </button>
        ))}
      </div>

      <p className="section-title">{valveName()} Presets</p>
      {currentValve.presets.map((p) => {
        const key = `${activeValve}-${p.slot_index}`;
        return (
          <div className="list-row" key={key} style={{ flexDirection: 'column', alignItems: 'stretch' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
              <span className="list-row-title">P{p.slot_index + 1}</span>
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
                  value={editValues[key] || ''}
                  onChange={(e) => setEditValues({ ...editValues, [key]: e.target.value })}
                />
                <button className="btn-secondary" onClick={() => savePresetManually(p.slot_index)}>Save</button>
                <button className="btn-secondary" onClick={() => startCalibration(p.slot_index)}>Fill & Calibrate</button>
              </div>
            )}
          </div>
        );
      })}

      <p className="section-title" style={{ marginTop: 24 }}>{valveName()} Settings</p>

      <label className="field-label">Coin pulses / rupee</label>
      <input
        className="field"
        inputMode="numeric"
        value={currentSettings.pulses_per_rupee}
        onChange={(e) => setValveSettingsForm({
          ...valveSettingsForm,
          [activeValve]: { ...currentSettings, pulses_per_rupee: e.target.value },
        })}
      />

      <label className="field-label">Card trip cost (Rs)</label>
      <input
        className="field"
        inputMode="numeric"
        value={currentSettings.trip_cost}
        onChange={(e) => setValveSettingsForm({
          ...valveSettingsForm,
          [activeValve]: { ...currentSettings, trip_cost: e.target.value },
        })}
      />

      <button className="btn-primary" onClick={saveValveSettings}>Save {valveName()} settings</button>

      <p className="section-title" style={{ marginTop: 32 }}>Device Settings (shared - both taps)</p>

      <label className="field-label">Confirm mode (customer presses button before dispense)</label>
      <div className="toggle-row">
        <span className="list-row-sub">Off = dispenses immediately</span>
        <div
          className={`toggle ${sharedSettingsForm.confirm_mode ? 'on' : ''}`}
          onClick={() => setSharedSettingsForm({ ...sharedSettingsForm, confirm_mode: !sharedSettingsForm.confirm_mode })}
        >
          <div className="toggle-knob" />
        </div>
      </div>

      <label className="field-label">Mode-select timeout (seconds)</label>
      <input
        className="field"
        inputMode="numeric"
        value={sharedSettingsForm.timeout_seconds}
        onChange={(e) => setSharedSettingsForm({ ...sharedSettingsForm, timeout_seconds: e.target.value })}
      />

      <label className="field-label">Card top-up amount (Rs)</label>
      <input
        className="field"
        inputMode="numeric"
        value={sharedSettingsForm.topup_amount}
        onChange={(e) => setSharedSettingsForm({ ...sharedSettingsForm, topup_amount: e.target.value })}
      />

      <button className="btn-primary" onClick={saveSharedSettings}>Save device settings</button>
    </div>
  );
}

function VALVE_TAB_LABEL(v) {
  return v === 0 ? 'Normal' : 'Cooling';
}
