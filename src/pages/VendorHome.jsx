import React, { useEffect, useRef, useState } from 'react';

// =====================================================================
// INTEGRATION POINTS — adjust these two imports to match your project.
// Per earlier work, api.js and socket.js are already generic/valve-aware
// and need NO changes. Wire them in here:
// =====================================================================
import { api } from '../api';
import { getSocket, sendCommand } from '../socket';

// -----------------------------------------------------------------
// Constants (must match firmware: #define PULSES_PER_LITER 240.0)
// -----------------------------------------------------------------
const PULSES_PER_LITER = 240;
const pulsesToLiters = (p) => Math.round((p / PULSES_PER_LITER) * 100) / 100;
const litersToPulses = (l) => Math.round(l * PULSES_PER_LITER);

const VALVE_NORMAL = 0;
const VALVE_COOLING = 1;
const VALVE_NAME = { [VALVE_NORMAL]: 'Normal water', [VALVE_COOLING]: 'Cooling water' };

// sendCommand(deviceId, type, extra) is imported directly from ../socket -
// it already builds { device_id, type, ...extra } and emits 'command'.

export default function VendorHome({ device: deviceProp, vendor, onBack }) {
  const deviceId = deviceProp?.device_id || deviceProp?.id;
  const vendorName = vendor?.name;
  const vendorPhone = vendor?.phone;

  const [device, setDevice] = useState(null);
  const [deviceSettings, setDeviceSettings] = useState(null); // shared: topup_amount, timeout_seconds
  const [valves, setValves] = useState({}); // { [valveNum]: { settings, presets } }
  const [online, setOnline] = useState(false);
  const [statusByValve, setStatusByValve] = useState({}); // live device_status per valve

  const [activeMain, setActiveMain] = useState('dispense'); // dispense | settings | help | profile
  const [activeValve, setActiveValve] = useState(VALVE_NORMAL);

  const [setupMode, setSetupMode] = useState(false);
  const [liveMode, setLiveMode] = useState(false);
  const [calibratingKey, setCalibratingKey] = useState(null); // `${valve}-${slotIndex}` or null

  const [selectedCfg, setSelectedCfg] = useState(null);
  const [cfgValue, setCfgValue] = useState('');
  const [toast, setToast] = useState('');

  const toastTimer = useRef(null);
  const showToast = (msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 2200);
  };

  // ---------------- Initial load ----------------
  useEffect(() => {
    let cancelled = false;
    api.getDevice(deviceId).then((data) => {
      if (cancelled) return;
      setDevice(data.device);
      setDeviceSettings(data.device_settings);
      setOnline(!!data.device?.is_online);
      const byValve = {};
      (data.valves || []).forEach((v) => {
        byValve[v.valve] = { settings: v.settings, presets: v.presets };
      });
      setValves(byValve);
    });
    return () => { cancelled = true; };
  }, [deviceId]);

  // ---------------- Socket wiring ----------------
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return; // App.jsx connects the socket on login; should already exist here

    const onStatus = (msg) => {
      if (msg.device_id !== deviceId) return;
      setStatusByValve((prev) => ({ ...prev, [msg.valve]: msg }));
    };
    const onOnline = (msg) => { if (msg.device_id === deviceId) setOnline(true); };
    const onOffline = (msg) => { if (msg.device_id === deviceId) setOnline(false); };
    const onTransaction = (msg) => {
      if (msg.device_id !== deviceId) return;
      showToast(
        `${VALVE_NAME[msg.valve]}: ${msg.source} ${msg.status === 'completed' ? 'complete' : msg.status}`
      );
    };
    const onSettingsSynced = (msg) => {
      if (msg.device_id !== deviceId) return;
      // firmware just confirmed a save — refetch to pick up the new numbers
      api.getDevice(deviceId).then((data) => {
        setDeviceSettings(data.device_settings);
        const byValve = {};
        (data.valves || []).forEach((v) => { byValve[v.valve] = { settings: v.settings, presets: v.presets }; });
        setValves(byValve);
      });
    };

    socket.on('device_status', onStatus);
    socket.on('device_online', onOnline);
    socket.on('device_offline', onOffline);
    socket.on('new_transaction', onTransaction);
    socket.on('settings_synced', onSettingsSynced);

    return () => {
      socket.off('device_status', onStatus);
      socket.off('device_online', onOnline);
      socket.off('device_offline', onOffline);
      socket.off('new_transaction', onTransaction);
      socket.off('settings_synced', onSettingsSynced);
    };
  }, [deviceId]);

  // ---------------- Dispense / calibration ----------------
  function handlePresetTap(valve, slotIndex) {
    const key = `${valve}-${slotIndex}`;
    const preset = valves[valve]?.presets?.find((p) => p.slot_index === slotIndex);

    if (setupMode) {
      if (calibratingKey === key) {
        sendCommand(deviceId, 'finish_calibration', { valve });
        setCalibratingKey(null);
        showToast(`Button ${slotIndex + 1} saved`);
      } else {
        sendCommand(deviceId, 'start_calibration', { valve, slot_index: slotIndex });
        setCalibratingKey(key);
        showToast('Filling — watch the bottle, tap again to save');
      }
      return;
    }

    const status = statusByValve[valve];
    if (status?.valve_open) {
      sendCommand(deviceId, 'stop', { valve });
      return;
    }
    sendCommand(deviceId, 'dispense', { valve, pulses: preset?.pulses || 0 });
  }

  function handleLitersEdit(valve, slotIndex, liters) {
    const pulses = litersToPulses(liters);
    sendCommand(deviceId, 'save_preset', { valve, slot_index: slotIndex, pulses });
    setValves((prev) => {
      const next = { ...prev };
      const presets = (next[valve]?.presets || []).map((p) =>
        p.slot_index === slotIndex ? { ...p, pulses } : p
      );
      next[valve] = { ...next[valve], presets };
      return next;
    });
  }

  // ---------------- Settings list ----------------
  const cfgItems = [
    { key: 'recharge', label: 'Card recharge', unit: 'Rs', field: 'topup_amount', scope: 'shared',
      value: deviceSettings?.topup_amount, hint: 'Amount added per card top-up' },
    { key: 'master', label: 'Master card', scope: 'master', hint: 'Register the recharge card' },
    { key: 'coinNormal', label: 'Normal coin rate', unit: 'pulses/Rs', field: 'pulses_per_rupee', scope: 'valve', valve: VALVE_NORMAL,
      value: valves[VALVE_NORMAL]?.settings?.pulses_per_rupee },
    { key: 'coinCooling', label: 'Cool coin rate', unit: 'pulses/Rs', field: 'pulses_per_rupee', scope: 'valve', valve: VALVE_COOLING,
      value: valves[VALVE_COOLING]?.settings?.pulses_per_rupee },
    { key: 'cardNormal', label: 'Normal card rate', unit: 'Rs/tap', field: 'trip_cost', scope: 'valve', valve: VALVE_NORMAL,
      value: valves[VALVE_NORMAL]?.settings?.trip_cost },
    { key: 'cardCooling', label: 'Cool card rate', unit: 'Rs/tap', field: 'trip_cost', scope: 'valve', valve: VALVE_COOLING,
      value: valves[VALVE_COOLING]?.settings?.trip_cost },
    { key: 'timeout', label: 'Timeout', unit: 'sec', field: 'timeout_seconds', scope: 'shared',
      value: deviceSettings?.timeout_seconds, hint: 'Seconds to pay after choosing a tap' },
  ];

  function openCfg(item) {
    setSelectedCfg(item.key);
    setCfgValue(item.value ?? '');
  }

  function saveCfg() {
    const item = cfgItems.find((c) => c.key === selectedCfg);
    if (!item) return;

    if (item.scope === 'master') {
      // NOTE: 'register_master' is not yet in the firmware's command list —
      // add a handler for it (arms registerMasterMode, same as the old
      // Blynk CFG_MASTER flow) before wiring this button live.
      sendCommand(deviceId, 'register_master', { valve: activeValve });
      showToast('Waiting for card tap on the machine...');
      setSelectedCfg(null);
      return;
    }

    const val = Number(cfgValue);
    if (!val || val <= 0) { showToast('Enter a valid number first'); return; }

    if (item.scope === 'shared') {
      sendCommand(deviceId, 'save_settings', { valve: VALVE_NORMAL, settings: { [item.field]: val } });
    } else {
      sendCommand(deviceId, 'save_settings', { valve: item.valve, settings: { [item.field]: val } });
    }
    showToast(`${item.label}: ${val} ${item.unit} saved`);
    setSelectedCfg(null);
  }

  // ---------------- Render helpers ----------------
  const s = styles;

  function renderValvePanel(valve) {
    const presets = valves[valve]?.presets || [];
    return [0, 1].map((slotIndex) => {
      const preset = presets.find((p) => p.slot_index === slotIndex) || { pulses: 0 };
      const liters = pulsesToLiters(preset.pulses);
      const key = `${valve}-${slotIndex}`;
      const status = statusByValve[valve];
      const isThisOpen = status?.valve_open;
      const isCalibratingThis = calibratingKey === key;
      const pct = status?.target_pulses
        ? Math.min(100, Math.round((status.delivered_pulses / status.target_pulses) * 100))
        : 0;
      const liveLiters = pulsesToLiters(status?.delivered_pulses || 0);

      return (
        <div key={key} style={{ ...s.card, borderColor: valve === VALVE_COOLING ? '#4FA9E8' : s.card.borderColor }}>
          <div style={s.cardTop}>
            <span style={s.cardTitle}>Button {slotIndex + 1}</span>
            {!setupMode && (
              <span style={s.volEdit}>
                <input
                  type="number" step="0.5" min="0.5" defaultValue={liters}
                  style={s.volInput}
                  onBlur={(e) => handleLitersEdit(valve, slotIndex, parseFloat(e.target.value) || liters)}
                />
                <span style={s.volUnit}>L</span>
              </span>
            )}
            {setupMode && <span style={s.volUnit}>{liters} L saved</span>}
          </div>

          <div style={s.fillTrack}>
            <div style={{ ...s.fillBar, width: `${isThisOpen ? pct : 0}%`,
              background: valve === VALVE_COOLING ? '#4FA9E8' : '#23C1A3' }} />
          </div>
          {liveMode && isThisOpen && (
            <div style={s.liveText}>{liveLiters}L delivered</div>
          )}

          <div
            style={{ ...s.actionBtn, ...(isCalibratingThis ? s.actionBtnCalib : {}) }}
            onClick={() => handlePresetTap(valve, slotIndex)}
          >
            {setupMode
              ? (isCalibratingThis ? 'Tap to stop & save' : 'Tap to start filling')
              : (isThisOpen ? 'Stop' : `Dispense ${liters}L`)}
          </div>
        </div>
      );
    });
  }

  return (
    <div style={s.phone}>
      <header style={s.header}>
        <div>
          {onBack && <div style={s.backLink} onClick={onBack}>← Devices</div>}
          <div style={s.vendorName}>{vendorName || device?.vendor_name || 'Vendor'}</div>
        </div>
        <div style={{ ...s.statusPill, ...(online ? {} : s.statusOffline) }}>
          <span style={{ ...s.dot, background: online ? '#23C1A3' : '#E8615F' }} />
          {online ? 'Online' : 'Offline'}
        </div>
      </header>

      <div style={s.content}>
        {activeMain === 'dispense' && (
          <div style={s.scrollArea}>
            {setupMode && (
              <div style={s.setupBanner}>
                <b>Setup mode is ON.</b> Place a bottle under the tap, tap a button to start filling,
                tap the same button again when the bottle has the amount you want.
              </div>
            )}
            <div style={s.tabs}>
              {[VALVE_NORMAL, VALVE_COOLING].map((v) => (
                <div key={v}
                  style={{ ...s.tab, ...(activeValve === v ? s.tabActive(v) : {}) }}
                  onClick={() => setActiveValve(v)}>
                  {VALVE_NAME[v]}
                </div>
              ))}
            </div>
            <div style={s.panel}>{renderValvePanel(activeValve)}</div>
          </div>
        )}

        {activeMain === 'settings' && (
          <div style={s.scrollArea}>
            <div style={s.toggleRow}>
              <div>
                <div style={s.toggleMain}>Setup mode</div>
                <div style={s.toggleSub}>Measure exact button volumes by filling a bottle</div>
              </div>
              <div style={{ ...s.toggle, ...(setupMode ? s.toggleOn : {}) }}
                onClick={() => setSetupMode((v) => !v)}>
                <div style={{ ...s.toggleKnob, ...(setupMode ? s.toggleKnobOn : {}) }} />
              </div>
            </div>
            <div style={s.toggleRow}>
              <div>
                <div style={s.toggleMain}>Live mode</div>
                <div style={s.toggleSub}>Show live litres while dispensing</div>
              </div>
              <div style={{ ...s.toggle, ...(liveMode ? s.toggleOn : {}) }}
                onClick={() => setLiveMode((v) => !v)}>
                <div style={{ ...s.toggleKnob, ...(liveMode ? s.toggleKnobOn : {}) }} />
              </div>
            </div>

            <div style={s.settingsLabel}>Configure a value</div>
            <div style={s.cfgList}>
              {cfgItems.map((item) => (
                <div key={item.key}
                  style={{ ...s.cfgRow, ...(selectedCfg === item.key ? s.cfgRowSelected : {}) }}
                  onClick={() => openCfg(item)}>
                  <span>{item.label}</span>
                  <span style={s.cfgVal}>{item.scope === 'master' ? '' : `${item.value ?? '—'} ${item.unit}`}</span>
                </div>
              ))}
            </div>

            {selectedCfg && (
              <div style={s.cfgEditor}>
                {selectedCfg === 'master' ? (
                  <>
                    <div style={s.masterNote}>
                      Tap Save, then hold the master RFID card near the reader on the machine within 10 seconds.
                    </div>
                    <div style={s.saveBtn} onClick={saveCfg}>Save &amp; wait for card</div>
                  </>
                ) : (
                  <div style={{ display: 'flex', gap: 10 }}>
                    <input type="number" style={s.cfgInput} value={cfgValue}
                      onChange={(e) => setCfgValue(e.target.value)} placeholder="Enter value" />
                    <div style={s.saveBtn} onClick={saveCfg}>Save</div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {activeMain === 'help' && (
          <div style={s.scrollArea}>
            <div style={s.helpCard}>
              <div style={s.helpTitle}>Need help?</div>
              <div style={s.helpSub}>Call Sol Electronics customer care for any complaint or machine issue.</div>
              <div style={s.helpNumber}>+91 98765 43210</div>
              <a style={s.callBtn} href="tel:+919876543210">Call now</a>
            </div>
          </div>
        )}

        {activeMain === 'profile' && (
          <div style={s.scrollArea}>
            <div style={{ ...s.helpCard, textAlign: 'left' }}>
              <div style={{ fontWeight: 600, fontSize: 16 }}>{vendorName}</div>
              <div style={{ fontSize: 12, color: '#8FB3AE' }}>{vendorPhone}</div>
              <div style={{ fontSize: 13, color: '#8FB3AE', marginTop: 10 }}>Machine ID: {device?.name}</div>
            </div>
            <div style={{ ...s.helpCard, marginTop: 12 }}>
              <div style={s.helpTitle}>Download the app</div>
              <div style={s.helpSub}>Add Sol Electronics to your home screen for direct, already-logged-in access.</div>
              <div style={s.callBtn} onClick={() => showToast('Follow your browser\'s "Add to Home Screen" prompt')}>
                Download app
              </div>
            </div>
          </div>
        )}
      </div>

      <nav style={s.nav}>
        {['dispense', 'settings', 'help', 'profile'].map((tab) => (
          <div key={tab} style={{ ...s.navItem, ...(activeMain === tab ? s.navItemActive : {}) }}
            onClick={() => setActiveMain(tab)}>
            {tab[0].toUpperCase() + tab.slice(1)}
          </div>
        ))}
      </nav>

      {toast && <div style={s.toast}>{toast}</div>}
    </div>
  );
}

// =====================================================================
// Styles — fit-to-screen: the outer .phone is locked to 100dvh with no
// body scroll; only the active tab's content area scrolls internally,
// and only if it genuinely overflows (it won't on a typical phone with
// this amount of content).
// =====================================================================
const styles = {
  phone: {
    height: '100dvh', width: '100%', maxWidth: 480, margin: '0 auto',
    display: 'flex', flexDirection: 'column', overflow: 'hidden',
    background: 'linear-gradient(180deg,#0F262A,#0B1E22 40%)', color: '#EAF6F3',
    fontFamily: '-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif',
  },
  header: {
    flexShrink: 0, padding: '16px 20px', borderBottom: '1px solid #1F3E42',
    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
  },
  vendorName: { fontSize: 18, fontWeight: 600 },
  backLink: { fontSize: 12, color: '#8FB3AE', marginBottom: 4, cursor: 'pointer' },
  statusPill: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 500,
    padding: '5px 10px', borderRadius: 20, background: 'rgba(35,193,163,0.12)', color: '#23C1A3' },
  statusOffline: { background: 'rgba(232,97,95,0.12)', color: '#E8615F' },
  dot: { width: 7, height: 7, borderRadius: '50%' },

  content: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' },
  scrollArea: { flex: 1, minHeight: 0, overflowY: 'auto', padding: '12px 18px' },

  setupBanner: { padding: '10px 12px', borderRadius: 12, background: '#163338',
    border: '1px solid #F2B84B', fontSize: 12, lineHeight: 1.4, marginBottom: 10 },

  tabs: { display: 'flex', gap: 8, marginBottom: 12 },
  tab: { flex: 1, padding: '9px 0', textAlign: 'center', borderRadius: 10, fontSize: 13,
    fontWeight: 500, cursor: 'pointer', border: '1px solid #1F3E42', color: '#8FB3AE', background: '#11292E' },
  tabActive: (valve) => ({
    background: valve === VALVE_COOLING ? '#4FA9E8' : '#23C1A3',
    color: valve === VALVE_COOLING ? '#052033' : '#06201B', borderColor: 'transparent',
  }),

  panel: { display: 'flex', flexDirection: 'column', gap: 10 },
  card: { border: '1px solid #1F3E42', borderRadius: 14, padding: '12px 14px', background: '#11292E' },
  cardTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle: { fontSize: 14, fontWeight: 600 },
  volEdit: { display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, fontWeight: 600 },
  volInput: { width: 40, border: 'none', background: 'transparent', textAlign: 'right',
    fontSize: 13, fontWeight: 600, color: 'inherit' },
  volUnit: { fontSize: 11, color: '#8FB3AE' },

  fillTrack: { height: 5, background: '#163338', borderRadius: 4, marginTop: 8, overflow: 'hidden' },
  fillBar: { height: '100%', borderRadius: 4, transition: 'width 0.4s linear' },
  liveText: { fontSize: 11, color: '#8FB3AE', marginTop: 4 },

  actionBtn: { marginTop: 8, textAlign: 'center', padding: '8px 0', borderRadius: 10, fontSize: 13,
    fontWeight: 500, cursor: 'pointer', background: 'rgba(35,193,163,0.12)', color: '#23C1A3' },
  actionBtnCalib: { background: 'rgba(242,184,75,0.14)', color: '#F2B84B' },

  toggleRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '10px 2px', borderBottom: '1px solid #1F3E42' },
  toggleMain: { fontSize: 13, fontWeight: 500 },
  toggleSub: { fontSize: 11, color: '#8FB3AE' },
  toggle: { width: 38, height: 22, borderRadius: 20, background: '#1F3E42', position: 'relative', cursor: 'pointer' },
  toggleOn: { background: '#23C1A3' },
  toggleKnob: { width: 16, height: 16, borderRadius: '50%', background: '#fff', position: 'absolute', top: 3, left: 3, transition: 'left 0.15s' },
  toggleKnobOn: { left: 19 },

  settingsLabel: { fontSize: 12, color: '#8FB3AE', margin: '14px 0 8px', fontWeight: 500 },
  cfgList: { borderRadius: 14, overflow: 'hidden', border: '1px solid #1F3E42' },
  cfgRow: { display: 'flex', justifyContent: 'space-between', padding: '10px 12px',
    borderBottom: '1px solid #1F3E42', cursor: 'pointer', background: '#11292E', fontSize: 13 },
  cfgRowSelected: { background: '#163338' },
  cfgVal: { color: '#8FB3AE', fontSize: 12 },

  cfgEditor: { marginTop: 10, background: '#163338', borderRadius: 14, padding: '12px 14px' },
  cfgInput: { flex: 1, background: '#11292E', border: '1px solid #1F3E42', borderRadius: 10,
    padding: '8px 10px', color: '#EAF6F3', fontSize: 13 },
  saveBtn: { padding: '8px 16px', borderRadius: 10, background: '#23C1A3', color: '#06201B',
    fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' },
  masterNote: { fontSize: 12, color: '#8FB3AE', lineHeight: 1.4, marginBottom: 8 },

  helpCard: { background: '#11292E', border: '1px solid #1F3E42', borderRadius: 14, padding: 16, textAlign: 'center' },
  helpTitle: { fontSize: 14, fontWeight: 600 },
  helpSub: { fontSize: 12, color: '#8FB3AE', marginTop: 4 },
  helpNumber: { fontSize: 17, fontWeight: 600, marginTop: 10 },
  callBtn: { display: 'block', marginTop: 12, padding: '10px 0', borderRadius: 10, background: '#23C1A3',
    color: '#06201B', fontWeight: 600, fontSize: 13, textDecoration: 'none', cursor: 'pointer' },

  nav: { flexShrink: 0, display: 'flex', gap: 8, padding: '8px 10px', borderTop: '1px solid #1F3E42' },
  navItem: { flex: 1, padding: '8px 0', textAlign: 'center', borderRadius: 10, fontSize: 12,
    fontWeight: 500, cursor: 'pointer', color: '#8FB3AE', background: 'transparent', border: '1px solid #1F3E42' },
  navItemActive: { background: '#163338', color: '#EAF6F3' },

  toast: { position: 'fixed', bottom: 70, left: '50%', transform: 'translateX(-50%)',
    background: '#EAF6F3', color: '#06201B', padding: '8px 16px', borderRadius: 10, fontSize: 12,
    fontWeight: 500, whiteSpace: 'nowrap', zIndex: 99 },
};
