import React, { useEffect, useRef, useState } from 'react';

// =====================================================================
// INTEGRATION POINTS — adjust these two imports to match your project.
// Per earlier work, api.js and socket.js are already generic/valve-aware
// and need NO changes. Wire them in here:
// =====================================================================
import { api } from '../api';
import { getSocket, sendCommand } from '../socket';
import { isNativeApp, isNotificationAccessEnabled, openNotificationSettings, clearVendorCredentials, KNOWN_UPI_APPS, setWatchedApp, getWatchedApp } from '../vendorBridge';

// -----------------------------------------------------------------
// Constants
// -----------------------------------------------------------------
// pulses-per-liter is NOT a fixed constant - different physical flow
// sensors (1/2", 3/4", 1") deliver different pulses/liter. Each device
// has its own calibrated value (device_settings.pulses_per_liter),
// fetched below and passed into these converters. 240 here is only a
// fallback used for one render before the real value loads.
const pulsesToLiters = (p, ppl = 240) => Math.round((p / ppl) * 100) / 100;
const litersToPulses = (l, ppl = 240) => Math.round(l * ppl);

const VALVE_NORMAL = 0;
const VALVE_COOLING = 1;
const VALVE_NAME = { [VALVE_NORMAL]: 'Normal water', [VALVE_COOLING]: 'Cooling water' };

// sendCommand(deviceId, type, extra) is imported directly from ../socket -
// it already builds { device_id, type, ...extra } and emits 'command'.

function WaterJar({ id, pct, color }) {
  const clamped = Math.max(0, Math.min(100, pct));
  const h = 50 * (clamped / 100);
  const y = 56 - h;
  return (
    <svg viewBox="0 0 46 60" width="40" height="52" style={{ flexShrink: 0 }}>
      <defs>
        <clipPath id={`jarclip-${id}`}>
          <rect x="6" y="4" width="34" height="52" rx="7" />
        </clipPath>
      </defs>
      <rect x="14" y="0" width="18" height="6" rx="2" fill="#2C4A4E" />
      <g clipPath={`url(#jarclip-${id})`}>
        <rect x="6" y="4" width="34" height="52" fill="#132C30" />
        <rect x="6" y={y} width="34" height={h} fill={color} style={{ transition: 'y 0.4s linear, height 0.4s linear' }} />
      </g>
      <rect x="6" y="4" width="34" height="52" rx="7" fill="none" stroke="#3A5A5E" strokeWidth="2.5" />
    </svg>
  );
}

export default function VendorHome({ device: deviceProp, vendor, onBack, onLogout }) {
  const deviceId = deviceProp?.device_id || deviceProp?.id;
  const vendorId = vendor?.id;
  const vendorName = vendor?.name;
  const vendorPhone = vendor?.phone;

  const [device, setDevice] = useState(null);
  const [deviceSettings, setDeviceSettings] = useState(null); // shared: topup_amount, timeout_seconds
  const [valves, setValves] = useState({}); // { [valveNum]: { settings, presets } }
  const [online, setOnline] = useState(null); // null = connecting (unknown yet), true/false = confirmed
  const [statusByValve, setStatusByValve] = useState({}); // live device_status per valve

  const [activeMain, setActiveMain] = useState('dispense'); // dispense | settings | profile | help
  const [activeValve, setActiveValve] = useState(VALVE_NORMAL);

  const [setupMode, setSetupMode] = useState(false);
  const [liveMode, setLiveMode] = useState(false);
  const [calibratingKey, setCalibratingKey] = useState(null); // `${valve}-${slotIndex}` or null

  const [selectedCfg, setSelectedCfg] = useState(null);
  const [cfgValue, setCfgValue] = useState('');
  const [toast, setToast] = useState('');
  const [paymentMode, setPaymentMode] = useState('macrodroid');
  const [qrImageUrl, setQrImageUrl] = useState(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [qrModalOpen, setQrModalOpen] = useState(false);
  const [priceEdits, setPriceEdits] = useState({}); // { [valve]: { price, litres } }
  const [pulsesPerLiter, setPulsesPerLiter] = useState(240);
  const [calibTargetLiters, setCalibTargetLiters] = useState(20);
  const [flowCalibrating, setFlowCalibrating] = useState(false);
  const [notifAccessEnabled, setNotifAccessEnabled] = useState(null); // null = unknown/not native
  const [watchedAppPkg, setWatchedAppPkg] = useState(null);

  const toastTimer = useRef(null);
  const showToast = (msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 2200);
  };

  useEffect(() => {
    if (isNativeApp()) {
      isNotificationAccessEnabled().then(setNotifAccessEnabled);
      getWatchedApp().then(setWatchedAppPkg);
    }
  }, []);

  // ---------------- Initial load ----------------
  useEffect(() => {
    let cancelled = false;
    api.getDevice(deviceId).then((data) => {
      if (cancelled) return;
      setDevice(data.device);
      setDeviceSettings(data.device_settings);
      setOnline(!!data.device?.is_online);
      setPaymentMode(data.device?.payment_mode || 'macrodroid');
      const ppl = data.device_settings?.pulses_per_liter || 240;
      setPulsesPerLiter(ppl);
      const byValve = {};
      const priceInit = {};
      (data.valves || []).forEach((v) => {
        byValve[v.valve] = { settings: v.settings, presets: v.presets, qr_prices: v.qr_prices };
        const slotIndices = (v.presets || []).map((p) => p.slot_index).sort((a, b) => a - b);
        priceInit[v.valve] = {};
        slotIndices.forEach((slot) => {
          const existing = (v.qr_prices || []).find((q) => q.slot_index === slot);
          priceInit[v.valve][slot] = {
            price: existing?.price_rupees ?? '',
            litres: existing?.pulses ? pulsesToLiters(existing.pulses, ppl) : '',
          };
        });
      });
      setValves(byValve);
      setPriceEdits(priceInit);
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
        setPulsesPerLiter(data.device_settings?.pulses_per_liter || 240);
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
        setSetupMode(false); // auto-off: the save itself ends setup mode
        showToast(`Button ${slotIndex + 1} saved — setup mode is off now`);
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
    const pulses = litersToPulses(liters, pulsesPerLiter);
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
  const isUpiOnly = device?.payment_hardware === 'upi_only';
  const availableValves = Object.keys(valves).length > 0
    ? Object.keys(valves).map(Number).sort((a, b) => a - b)
    : [VALVE_NORMAL]; // fallback before data loads
  const singleTap = availableValves.length === 1;
  const cfgItems = [
    ...(isUpiOnly ? [] : [
      { key: 'recharge', label: 'Card recharge', unit: 'Rs', field: 'topup_amount', scope: 'shared',
        value: deviceSettings?.topup_amount, hint: 'Amount added per card top-up' },
      { key: 'master', label: 'Master card', scope: 'master', hint: 'Register the recharge card' },
      ...availableValves.flatMap((v) => [
        { key: `coin${v}`, label: `${VALVE_NAME[v]} coin rate`, unit: 'pulses/Rs', field: 'pulses_per_rupee', scope: 'valve', valve: v,
          value: valves[v]?.settings?.pulses_per_rupee },
        { key: `card${v}`, label: `${VALVE_NAME[v]} card rate`, unit: 'Rs/tap', field: 'trip_cost', scope: 'valve', valve: v,
          value: valves[v]?.settings?.trip_cost },
      ]),
    ]),
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

  // ---------------- Razorpay: payment mode, QR, pricing ----------------
  async function togglePaymentMode() {
    const next = paymentMode === 'razorpay' ? 'macrodroid' : 'razorpay';
    try {
      await api.setPaymentMode({ device_id: deviceId, vendor_id: vendorId, payment_mode: next });
      setPaymentMode(next);
      if (next === 'razorpay') loadQr();
    } catch (e) {
      showToast(e.message || 'Could not switch payment mode');
    }
  }

  async function loadQr() {
    setQrLoading(true);
    try {
      const result = await api.getRazorpayQr(deviceId, vendorId);
      setQrImageUrl(result.image_url);
    } catch (e) {
      showToast(e.message || 'Could not load QR code');
    } finally {
      setQrLoading(false);
    }
  }

  async function savePrice(valve, slotIndex) {
    const edit = priceEdits[valve]?.[slotIndex] || {};
    const price = Number(edit.price);
    const litres = Number(edit.litres);
    if (!price || price <= 0 || !litres || litres <= 0) {
      showToast('Enter both a price and litres first');
      return;
    }
    try {
      await api.setRazorpayPrice({ device_id: deviceId, vendor_id: vendorId, valve, slot_index: slotIndex, price_rupees: price, litres });
      showToast(`${VALVE_NAME[valve]} button ${slotIndex + 1}: ₹${price} for ${litres}L saved`);
    } catch (e) {
      showToast(e.message || 'Could not save price');
    }
  }

  function handleFlowCalibrate() {
    const target = Number(calibTargetLiters);
    if (flowCalibrating) {
      sendCommand(deviceId, 'finish_calibration', { valve: activeValve });
      setFlowCalibrating(false);
      showToast('Calibration saved - flow sensor is now accurate');
    } else {
      if (!target || target <= 0) { showToast('Enter a valid target first'); return; }
      sendCommand(deviceId, 'start_flow_calibration', { valve: activeValve, target_liters: target });
      setFlowCalibrating(true);
      showToast(`Fill exactly ${target}L, then tap again`);
    }
  }

  async function handleInstallClick() {
    const promptEvent = window.__pwaInstallPrompt;
    if (promptEvent) {
      promptEvent.prompt();
      await promptEvent.userChoice;
      window.__pwaInstallPrompt = null;
      return;
    }
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    showToast(isIOS
      ? 'Tap the Share icon, then "Add to Home Screen"'
      : 'Open browser menu (⋮) and tap "Install app" or "Add to Home Screen"');
  }

  // ---------------- Render helpers ----------------
  const s = styles;

  function renderValvePanel(valve) {
    const presets = valves[valve]?.presets || [];
    const slotIndices = presets.length > 0
      ? presets.map((p) => p.slot_index).sort((a, b) => a - b)
      : [0, 1]; // fallback before data loads
    const valveColor = valve === VALVE_COOLING ? '#2FC3FF' : '#0AEFC4';
    const valveColorText = valve === VALVE_COOLING ? '#052033' : '#06201B';
    return slotIndices.map((slotIndex) => {
      const preset = presets.find((p) => p.slot_index === slotIndex) || { pulses: 0 };
      const liters = pulsesToLiters(preset.pulses, pulsesPerLiter);
      const key = `${valve}-${slotIndex}`;
      const status = statusByValve[valve];
      const isThisOpen = status?.valve_open;
      const isCalibratingThis = calibratingKey === key;
      const pct = status?.target_pulses
        ? Math.min(100, Math.round((status.delivered_pulses / status.target_pulses) * 100))
        : 0;
      const liveLiters = pulsesToLiters(status?.delivered_pulses || 0, pulsesPerLiter);
      // while calibrating there's no fixed target, so the jar's visual fill
      // is just capped at a 3L reference for the graphic - the litre number
      // itself keeps counting correctly past that
      const calibPct = Math.min(100, (liveLiters / 3) * 100);
      const jarPct = isCalibratingThis ? calibPct : (isThisOpen ? pct : 0);

      let statusText = 'Ready';
      if (isCalibratingThis) statusText = 'Filling — watch the bottle...';
      else if (isThisOpen) statusText = 'Dispensing...';

      return (
        <div key={key} style={{ ...s.card, borderColor: valve === VALVE_COOLING ? '#2FC3FF' : s.card.borderColor }}>
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

          <div style={s.canRow}>
            <WaterJar id={key} pct={jarPct} color={valveColor} />
            <div style={s.canStatus}>
              <div style={s.dcSub}>{statusText}</div>
              {liveMode && (isThisOpen || isCalibratingThis) && (
                <div style={s.dcPct}>{liveLiters}L</div>
              )}
            </div>
          </div>

          <div
            style={{
              ...s.actionBtn,
              background: isCalibratingThis
                ? 'linear-gradient(135deg, #F7C15C, #E8A424)'
                : (valve === VALVE_COOLING
                    ? 'linear-gradient(135deg, #4FD6FF, #1B8FE0)'
                    : 'linear-gradient(135deg, #3CFFD6, #00C7A0)'),
              color: isCalibratingThis ? '#3A2A00' : valveColorText,
            }}
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
        <div style={s.headerLeft}>
          <div style={s.headerBadge}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M12 2C12 2 5 10.5 5 15a7 7 0 0014 0C19 10.5 12 2 12 2z" stroke="#4FD6FF" strokeWidth="1.8" />
            </svg>
          </div>
          <div>
            {onBack && <div style={s.backLink} onClick={onBack}>← Devices</div>}
            <div style={s.vendorName}>{vendorName || device?.vendor_name || 'Vendor'}</div>
            <div style={s.vendorSub}>Sol Electronics</div>
          </div>
        </div>
        <div style={{ ...s.statusPill, ...(online === false ? s.statusOffline : {}) }}>
          <span style={{ ...s.dot, background: online === true ? '#3CFFD6' : online === false ? '#E8615F' : '#6B8CAE' }} />
          {online === true ? 'System Online' : online === false ? 'Offline' : 'Connecting…'}
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
            {!singleTap && (
              <div style={s.tabs}>
                {availableValves.map((v) => (
                  <div key={v}
                    style={{ ...s.tab, ...(activeValve === v ? s.tabActive(v) : {}) }}
                    onClick={() => setActiveValve(v)}>
                    {VALVE_NAME[v]}
                  </div>
                ))}
              </div>
            )}
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

            <div style={s.settingsLabel}>Calibrate flow sensor</div>
            <div style={s.card}>
              <div style={s.cardTitle}>Which tap?</div>
              {!singleTap && (
                <div style={{ ...s.tabs, marginTop: 8 }}>
                  {availableValves.map((v) => (
                    <div key={v}
                      style={{ ...s.tab, ...(activeValve === v ? s.tabActive(v) : {}) }}
                      onClick={() => setActiveValve(v)}>
                      {VALVE_NAME[v]}
                    </div>
                  ))}
                </div>
              )}
              {singleTap && (
                <div style={{ fontSize: 13, color: '#6B8CAE', marginTop: 6 }}>{VALVE_NAME[availableValves[0]]}</div>
              )}
              <div style={{ ...s.cardTitle, marginTop: 14 }}>Fill exactly this much, then tap Start</div>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                {[1, 2, 5, 20].map((l) => (
                  <div key={l}
                    style={{ ...s.saveBtn, flex: 1,
                      background: Number(calibTargetLiters) === l ? '#0AEFC4' : 'rgba(79,214,255,0.18)',
                      color: Number(calibTargetLiters) === l ? '#06201B' : '#EAF6F3' }}
                    onClick={() => setCalibTargetLiters(l)}>
                    {l}L
                  </div>
                ))}
              </div>
              <input type="number" style={{ ...s.cfgInput, marginTop: 8, width: '100%', boxSizing: 'border-box' }}
                value={calibTargetLiters} onChange={(e) => setCalibTargetLiters(e.target.value)}
                placeholder="Or enter a custom litres" />
              <div style={{ ...s.actionBtn, marginTop: 10,
                background: flowCalibrating ? '#F2B84B' : '#0AEFC4', color: '#06201B' }}
                onClick={handleFlowCalibrate}>
                {flowCalibrating ? `Tap when exactly ${calibTargetLiters}L is reached` : 'Start calibration'}
              </div>
              <div style={{ fontSize: 11, color: '#6B8CAE', marginTop: 8 }}>
                Current: {pulsesPerLiter.toFixed ? pulsesPerLiter.toFixed(1) : pulsesPerLiter} pulses/liter
              </div>
            </div>

            <div style={s.settingsLabel}>Payment collection</div>
            <div style={s.toggleRow}>
              <div>
                <div style={s.toggleMain}>{paymentMode === 'razorpay' ? 'Razorpay (auto-dispense)' : 'UPI notification (auto-dispense)'}</div>
                <div style={s.toggleSub}>
                  {paymentMode === 'razorpay'
                    ? 'Customer scans your QR and pays - water dispenses automatically'
                    : 'Customer pays your dedicated UPI Business app directly - no button press needed, the amount alone triggers dispensing'}
                </div>
              </div>
              <div style={{ ...s.toggle, ...(paymentMode === 'razorpay' ? s.toggleOn : {}) }}
                onClick={togglePaymentMode}>
                <div style={{ ...s.toggleKnob, ...(paymentMode === 'razorpay' ? s.toggleKnobOn : {}) }} />
              </div>
            </div>

            {paymentMode === 'razorpay' && (
              <div style={s.qrCard}>
                {qrImageUrl ? (
                  <img src={qrImageUrl} alt="Payment QR" style={s.qrImage}
                    onClick={() => setQrModalOpen(true)} />
                ) : (
                  <div style={s.saveBtn} onClick={loadQr}>
                    {qrLoading ? 'Loading...' : 'Show my QR code'}
                  </div>
                )}
                {qrImageUrl && (
                  <div style={{ fontSize: 12, color: '#555', marginTop: 8 }}>Tap the QR to view full size, print, or download</div>
                )}
              </div>
            )}

            {(paymentMode === 'razorpay' || paymentMode === 'macrodroid') && (
              <>
                <div style={{ fontSize: 12, color: '#6B8CAE', margin: '4px 0 8px', lineHeight: 1.5 }}>
                  Set a fixed price for each button. When a customer pays exactly that
                  amount{paymentMode === 'razorpay' ? ' via your QR' : ' to your dedicated UPI app'}, that
                  much water dispenses automatically - no physical button press needed.
                </div>
                {availableValves.map((v) => {
                  const slotIndices = (valves[v]?.presets || []).map((p) => p.slot_index).sort((a, b) => a - b);
                  return (
                    <div key={v} style={s.card}>
                      <div style={s.cardTitle}>{VALVE_NAME[v]} - pay &amp; dispense prices</div>
                      {slotIndices.map((slot) => (
                        <div key={slot} style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
                          <span style={{ fontSize: 12, color: '#6B8CAE', width: 20 }}>{slot + 1}.</span>
                          <input type="number" placeholder="₹ price" style={s.cfgInput}
                            value={priceEdits[v]?.[slot]?.price ?? ''}
                            onChange={(e) => setPriceEdits((p) => ({
                              ...p, [v]: { ...p[v], [slot]: { ...p[v]?.[slot], price: e.target.value } },
                            }))} />
                          <input type="number" placeholder="Litres" style={s.cfgInput}
                            value={priceEdits[v]?.[slot]?.litres ?? ''}
                            onChange={(e) => setPriceEdits((p) => ({
                              ...p, [v]: { ...p[v], [slot]: { ...p[v]?.[slot], litres: e.target.value } },
                            }))} />
                          <div style={s.saveBtn} onClick={() => savePrice(v, slot)}>Save</div>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </>
            )}

            <div style={s.settingsLabel}>Configure a value</div>
            <div style={s.cfgList}>
              {cfgItems.map((item) => (
                <div key={item.key}
                  style={{ ...s.cfgRow, ...(selectedCfg === item.key ? s.cfgRowSelected : {}) }}
                  onClick={() => openCfg(item)}>
                  <span style={selectedCfg === item.key ? { color: '#0AEFC4' } : {}}>{item.label}</span>
                  <span style={{ ...s.cfgVal, ...(selectedCfg === item.key ? { color: '#0AEFC4' } : {}) }}>
                    {item.scope === 'master' ? '' : `${item.value ?? '—'} ${item.unit}`}
                  </span>
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
              <div style={{ fontSize: 12, color: '#6B8CAE' }}>{vendorPhone}</div>
              <div style={{ fontSize: 13, color: '#6B8CAE', marginTop: 10 }}>Machine ID: {device?.name}</div>
            </div>
            {!isNativeApp() && (
              <div style={{ ...s.helpCard, marginTop: 12 }}>
                <div style={s.helpTitle}>Download the app</div>
                <div style={s.helpSub}>Add Sol Electronics to your home screen for direct, already-logged-in access.</div>
                <div style={s.callBtn} onClick={handleInstallClick}>
                  Download app
                </div>
              </div>
            )}

            {isNativeApp() && (
              <div style={{ ...s.helpCard, marginTop: 12, textAlign: 'left' }}>
                <div style={s.helpTitle}>Automatic UPI payments</div>
                <div style={s.helpSub}>
                  Pick ONE UPI app to dedicate to this machine. Only payments received on that
                  app trigger dispensing - other apps are ignored, so nothing else clashes.
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  {KNOWN_UPI_APPS.map((app) => (
                    <div key={app.key}
                      style={{ ...s.saveBtn, flex: 1, textAlign: 'center',
                        background: watchedAppPkg === app.packageName ? '#0AEFC4' : 'rgba(79,214,255,0.18)',
                        color: watchedAppPkg === app.packageName ? '#06201B' : '#EAF6F3' }}
                      onClick={async () => {
                        await setWatchedApp(app.packageName);
                        setWatchedAppPkg(app.packageName);
                        showToast(`${app.label} selected - keep its dedicated amounts unused elsewhere`);
                      }}>
                      {app.label}
                    </div>
                  ))}
                </div>
                {watchedAppPkg && (
                  <div style={{ fontSize: 11, color: '#F2B84B', marginTop: 10, lineHeight: 1.5 }}>
                    ⚠️ Tell the vendor: the exact amounts set for this machine's buttons must never
                    be used for anything else on {KNOWN_UPI_APPS.find(a => a.packageName === watchedAppPkg)?.label} -
                    doing so will trigger an unwanted dispense.
                  </div>
                )}
                <div style={{ ...s.callBtn, marginTop: 12, background: notifAccessEnabled ? 'rgba(79,214,255,0.18)' : '#0AEFC4',
                  color: notifAccessEnabled ? '#6B8CAE' : '#06201B' }}
                  onClick={async () => {
                    await openNotificationSettings();
                    setTimeout(() => isNotificationAccessEnabled().then(setNotifAccessEnabled), 1500);
                  }}>
                  {notifAccessEnabled ? 'Notification access is on ✓' : 'Turn on notification access'}
                </div>
              </div>
            )}

            <div style={{ ...s.helpCard, marginTop: 12 }}>
              <div
                style={{ ...s.callBtn, background: 'transparent', border: '1px solid #E8615F', color: '#E8615F' }}
                onClick={async () => {
                  await clearVendorCredentials();
                  onLogout && onLogout();
                }}>
                Sign out
              </div>
            </div>
          </div>
        )}
      </div>

      <nav style={s.nav}>
        {[
          { key: 'dispense', label: 'Dispense', icon: '💧' },
          { key: 'settings', label: 'Settings', icon: '⚙️' },
          { key: 'profile', label: 'Profile', icon: '👤' },
          { key: 'help', label: 'Contact', icon: '☎️' },
        ].map((tab) => (
          <div key={tab.key}
            style={{ ...s.navItem, ...(activeMain === tab.key ? s.navItemActive : {}) }}
            onClick={() => setActiveMain(tab.key)}>
            <span style={{ fontSize: 15 }}>{tab.icon}</span>
            <span>{tab.label}</span>
          </div>
        ))}
      </nav>

      {toast && <div style={s.toast}>{toast}</div>}

      {qrModalOpen && (
        <div style={s.qrModalOverlay} onClick={() => setQrModalOpen(false)}>
          <div style={s.qrModalCard} onClick={(e) => e.stopPropagation()}>
            <img src={qrImageUrl} alt="Payment QR" style={s.qrModalImage} />
            <div style={s.qrModalHint}>Long-press the QR to save it, or use the buttons below</div>
            <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
              <a href={qrImageUrl} download="sol-electronics-payment-qr.png" target="_blank" rel="noreferrer"
                style={{ ...s.saveBtn, flex: 1, textDecoration: 'none', display: 'block', textAlign: 'center' }}>
                Download
              </a>
              <div style={{ ...s.saveBtn, flex: 1, background: '#EAF6F3', color: '#06201B' }}
                onClick={() => setQrModalOpen(false)}>
                Close
              </div>
            </div>
          </div>
        </div>
      )}
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
    background: 'radial-gradient(circle at 20% 0%, #132743 0%, #0A1220 45%, #060B14 100%)', color: '#EAF6F3',
    fontFamily: '-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif',
  },
  header: {
    flexShrink: 0, padding: '16px 20px', borderBottom: '1px solid rgba(79,214,255,0.15)',
    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
  },
  headerLeft: { display: 'flex', alignItems: 'center', gap: 10 },
  headerBadge: { width: 36, height: 36, borderRadius: '50%', display: 'flex', alignItems: 'center',
    justifyContent: 'center', background: 'rgba(79,214,255,0.12)', border: '1px solid rgba(79,214,255,0.35)',
    boxShadow: '0 0 14px rgba(79,214,255,0.35)' },
  vendorName: { fontSize: 18, fontWeight: 600 },
  vendorSub: { fontSize: 11, color: '#6B8CAE', marginTop: 1 },
  backLink: { fontSize: 12, color: '#6B8CAE', marginBottom: 4, cursor: 'pointer' },
  statusPill: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600,
    padding: '6px 12px', borderRadius: 20, background: 'rgba(60,255,214,0.10)', color: '#3CFFD6',
    border: '1px solid rgba(60,255,214,0.35)' },
  statusOffline: { background: 'rgba(232,97,95,0.10)', color: '#E8615F', border: '1px solid rgba(232,97,95,0.35)' },
  dot: { width: 7, height: 7, borderRadius: '50%' },

  homeGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 4 },
  homeCard: { background: 'linear-gradient(145deg, rgba(30,50,80,0.55), rgba(15,25,45,0.55))',
    border: '1px solid rgba(79,214,255,0.18)', borderRadius: 16, padding: '16px 14px',
    display: 'flex', flexDirection: 'column', gap: 10, cursor: 'pointer', position: 'relative' },
  homeIconBadge: { width: 46, height: 46, borderRadius: '50%', display: 'flex', alignItems: 'center',
    justifyContent: 'center', background: 'rgba(255,255,255,0.04)', border: '1px solid' },
  homeCardLabel: { fontSize: 14, fontWeight: 600 },
  homeCardChevron: { position: 'absolute', top: 14, right: 14, color: '#4F6B8A', fontSize: 16 },

  statsBar: { display: 'flex', marginTop: 18, background: 'rgba(20,32,54,0.6)',
    border: '1px solid rgba(79,214,255,0.15)', borderRadius: 14, padding: '12px 6px' },
  statItem: { flex: 1, textAlign: 'center', borderRight: '1px solid rgba(79,214,255,0.12)' },
  statLabel: { fontSize: 10, color: '#6B8CAE', marginBottom: 3 },
  statValue: { fontSize: 11, fontWeight: 600, color: '#EAF6F3' },
  sectionBackRow: { fontSize: 13, color: '#4FD6FF', cursor: 'pointer', marginBottom: 10, fontWeight: 500 },

  content: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' },
  scrollArea: { flex: 1, minHeight: 0, overflowY: 'auto', padding: '12px 18px' },

  setupBanner: { padding: '10px 12px', borderRadius: 12, background: 'rgba(79,214,255,0.12)',
    border: '1px solid #F2B84B', fontSize: 12, lineHeight: 1.4, marginBottom: 10 },

  tabs: { display: 'flex', gap: 8, marginBottom: 12 },
  tab: { flex: 1, padding: '9px 0', textAlign: 'center', borderRadius: 10, fontSize: 13,
    fontWeight: 500, cursor: 'pointer', border: '1px solid rgba(79,214,255,0.18)', color: '#6B8CAE', background: 'rgba(20,32,54,0.55)' },
  tabActive: (valve) => ({
    background: valve === VALVE_COOLING
      ? 'linear-gradient(135deg, #4FD6FF, #1B8FE0)'
      : 'linear-gradient(135deg, #3CFFD6, #00C7A0)',
    color: valve === VALVE_COOLING ? '#052033' : '#06201B', borderColor: 'transparent',
    boxShadow: valve === VALVE_COOLING ? '0 4px 14px rgba(47,195,255,0.35)' : '0 4px 14px rgba(10,239,196,0.35)',
  }),

  panel: { display: 'flex', flexDirection: 'column', gap: 10 },
  card: { border: '1px solid rgba(79,214,255,0.18)', borderRadius: 14, padding: '12px 14px', background: 'rgba(20,32,54,0.55)' },
  cardTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle: { fontSize: 14, fontWeight: 600 },
  volEdit: { display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, fontWeight: 600 },
  volInput: { width: 40, border: 'none', background: 'transparent', textAlign: 'right',
    fontSize: 13, fontWeight: 600, color: 'inherit' },
  volUnit: { fontSize: 11, color: '#6B8CAE' },

  canRow: { display: 'flex', alignItems: 'center', gap: 12, marginTop: 10 },
  canStatus: { flex: 1 },
  dcSub: { fontSize: 12, color: '#6B8CAE' },
  dcPct: { fontSize: 17, fontWeight: 700, marginTop: 2 },

  actionBtn: { marginTop: 10, textAlign: 'center', padding: '12px 0', borderRadius: 12, fontSize: 14,
    fontWeight: 700, cursor: 'pointer', boxShadow: '0 3px 10px rgba(0,0,0,0.25)', letterSpacing: 0.2 },

  toggleRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '10px 2px', borderBottom: '1px solid rgba(79,214,255,0.18)' },
  toggleMain: { fontSize: 13, fontWeight: 500 },
  toggleSub: { fontSize: 11, color: '#6B8CAE' },
  toggle: { width: 38, height: 22, borderRadius: 20, background: 'rgba(79,214,255,0.18)', position: 'relative', cursor: 'pointer' },
  toggleOn: { background: '#0AEFC4' },
  toggleKnob: { width: 16, height: 16, borderRadius: '50%', background: '#fff', position: 'absolute', top: 3, left: 3, transition: 'left 0.15s' },
  toggleKnobOn: { left: 19 },

  settingsLabel: { fontSize: 12, color: '#6B8CAE', margin: '14px 0 8px', fontWeight: 500 },
  cfgList: { borderRadius: 14, overflow: 'hidden', border: '1px solid rgba(79,214,255,0.18)' },
  cfgRow: { display: 'flex', justifyContent: 'space-between', padding: '10px 12px',
    borderBottom: '1px solid rgba(79,214,255,0.18)', cursor: 'pointer', background: 'rgba(20,32,54,0.55)', fontSize: 13 },
  cfgRowSelected: { background: 'rgba(35,193,163,0.16)', borderLeft: '3px solid #0AEFC4',
    paddingLeft: 11, fontWeight: 700 },
  cfgVal: { color: '#6B8CAE', fontSize: 12 },

  cfgEditor: { marginTop: 10, background: 'rgba(79,214,255,0.12)', borderRadius: 14, padding: '12px 14px' },
  cfgInput: { flex: 1, background: 'rgba(20,32,54,0.55)', border: '1px solid rgba(79,214,255,0.18)', borderRadius: 10,
    padding: '8px 10px', color: '#EAF6F3', fontSize: 13 },
  saveBtn: { padding: '8px 16px', borderRadius: 10, background: '#0AEFC4', color: '#06201B',
    fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' },
  masterNote: { fontSize: 12, color: '#6B8CAE', lineHeight: 1.4, marginBottom: 8 },

  helpCard: { background: 'rgba(20,32,54,0.55)', border: '1px solid rgba(79,214,255,0.18)', borderRadius: 14, padding: 16, textAlign: 'center' },
  qrCard: { background: '#fff', borderRadius: 14, padding: 16, textAlign: 'center', marginTop: 4, marginBottom: 12 },
  qrImage: { width: 180, height: 180, cursor: 'pointer' },
  qrModalOverlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 200,
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 },
  qrModalCard: { background: '#fff', borderRadius: 18, padding: 22, textAlign: 'center', width: '100%', maxWidth: 340 },
  qrModalImage: { width: '100%', maxWidth: 280, height: 'auto' },
  qrModalHint: { fontSize: 12, color: '#666', marginTop: 12 },
  helpTitle: { fontSize: 14, fontWeight: 600 },
  helpSub: { fontSize: 12, color: '#6B8CAE', marginTop: 4 },
  helpNumber: { fontSize: 17, fontWeight: 600, marginTop: 10 },
  callBtn: { display: 'block', marginTop: 12, padding: '10px 0', borderRadius: 10, background: '#0AEFC4',
    color: '#06201B', fontWeight: 600, fontSize: 13, textDecoration: 'none', cursor: 'pointer' },

  nav: { flexShrink: 0, display: 'flex', gap: 6, padding: '10px 10px', borderTop: '1px solid rgba(79,214,255,0.15)',
    background: 'rgba(10,18,32,0.6)' },
  navItem: { flex: 1, padding: '8px 0', textAlign: 'center', borderRadius: 12, fontSize: 11,
    fontWeight: 500, cursor: 'pointer', color: '#6B8CAE', display: 'flex', flexDirection: 'column',
    alignItems: 'center', gap: 3 },
  navItemActive: { background: 'rgba(79,214,255,0.12)', color: '#4FD6FF', boxShadow: '0 0 10px rgba(79,214,255,0.25)' },

  toast: { position: 'fixed', bottom: 70, left: '50%', transform: 'translateX(-50%)',
    background: '#EAF6F3', color: '#06201B', padding: '8px 16px', borderRadius: 10, fontSize: 12,
    fontWeight: 500, whiteSpace: 'nowrap', zIndex: 99 },
};
