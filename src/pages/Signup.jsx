import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api';

// -----------------------------------------------------------------
// QR scanning uses jsQR loaded from a CDN <script> tag - add this once
// to public/index.html, inside <head> or before </body>:
//   <script src="https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js"></script>
// This avoids an npm install; jsQR becomes available as window.jsQR.
// -----------------------------------------------------------------

export default function Signup({ onSignedUp, onGoLogin }) {
  const [step, setStep] = useState('form'); // form | splash | wifi
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [claimCode, setClaimCode] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [pendingVendor, setPendingVendor] = useState(null);
  const [barStarted, setBarStarted] = useState(false);

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);

  // ---------------- QR scan ----------------
  async function startScan() {
    setError('');
    if (!window.jsQR) {
      setError('QR scanner not loaded - enter the code manually below instead.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      streamRef.current = stream;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      setScanning(true);
      tick();
    } catch (e) {
      setError('Could not open camera - enter the code manually below instead.');
    }
  }

  function stopScan() {
    setScanning(false);
    cancelAnimationFrame(rafRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }

  function tick() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState !== video.HAVE_ENOUGH_DATA) {
      rafRef.current = requestAnimationFrame(tick);
      return;
    }
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = window.jsQR(imageData.data, canvas.width, canvas.height);
    if (code && code.data) {
      setClaimCode(code.data.trim());
      stopScan();
      return;
    }
    rafRef.current = requestAnimationFrame(tick);
  }

  useEffect(() => stopScan, []);

  useEffect(() => {
    if (step === 'splash') {
      setBarStarted(false);
      requestAnimationFrame(() => requestAnimationFrame(() => setBarStarted(true)));
    }
  }, [step]);

  // ---------------- Submit ----------------
  async function handleSubmit() {
    setError('');
    if (!name.trim() || !phone.trim() || !pin.trim() || !claimCode.trim()) {
      setError('Fill all fields first');
      return;
    }
    setSubmitting(true);
    try {
      const result = await api.signup({
        name: name.trim(), phone: phone.trim(), pin: pin.trim(), claim_code: claimCode.trim(),
      });
      setPendingVendor(result.vendor);
      setStep('splash');
      setTimeout(() => setStep('wifi'), 12000);
    } catch (e) {
      setError(e.message || 'Sign up failed - check the machine code and try again');
    } finally {
      setSubmitting(false);
    }
  }

  function finishToApp() {
    localStorage.setItem('vendor', JSON.stringify(pendingVendor));
    onSignedUp(pendingVendor);
  }

  // ---------------- Screens ----------------
  if (step === 'splash') {
    return (
      <div style={s.splashWrap}>
        <div style={s.splashLogoWrap}>
          <img src="/logo.png" alt="Sol Electronics" style={s.splashLogo} />
        </div>
        <div style={s.splashTag}>Linking your machine...</div>
        <div style={s.splashBarTrack}><div style={{ ...s.splashBarFill, width: barStarted ? '100%' : '0%' }} /></div>
      </div>
    );
  }

  if (step === 'wifi') {
    return (
      <div style={s.wrap}>
        <div style={s.logoSmallWrap}><img src="/logo.png" alt="" style={s.logoSmall} /></div>
        <div style={s.title}>One last step - connect your machine to WiFi</div>
        <div style={s.wifiCard}>
          <div style={s.wifiStep}><b>1.</b> On your phone, open WiFi settings and connect to the network named <b>"Sol Electronics"</b> (it comes from your machine).</div>
          <div style={s.wifiStep}><b>2.</b> A page will open automatically - enter your shop's WiFi name and password there.</div>
          <div style={s.wifiStep}><b>3.</b> The machine will restart and connect to the internet. This app will show it as <b>Online</b> once it's connected.</div>
        </div>
        <div style={s.primaryBtn} onClick={finishToApp}>Done - open the app</div>
      </div>
    );
  }

  // ---------------- Form ----------------
  return (
    <div style={s.wrap}>
      <div style={s.logoSmallWrap}><img src="/logo.png" alt="" style={s.logoSmall} /></div>
      <div style={s.tag}>Vendor sign up</div>

      <div style={s.fieldLabel}>Your name</div>
      <input style={s.field} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ramesh Kumar" />

      <div style={s.fieldLabel}>Phone number</div>
      <input style={s.field} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="10-digit mobile number" />

      <div style={s.fieldLabel}>Set a 4-digit PIN</div>
      <input style={s.field} value={pin} onChange={(e) => setPin(e.target.value)} placeholder="e.g. 1234" maxLength={4} />

      <div style={s.fieldLabel}>Machine code</div>
      <input style={s.field} value={claimCode} onChange={(e) => setClaimCode(e.target.value.toUpperCase())}
        placeholder="Printed on your machine's sticker" />
      <div style={s.scanRow} onClick={scanning ? stopScan : startScan}>
        {scanning ? 'Stop scanning' : '📷 Scan the QR code instead'}
      </div>

      {scanning && (
        <div style={s.scanBox}>
          <video ref={videoRef} style={s.video} muted playsInline />
          <canvas ref={canvasRef} style={{ display: 'none' }} />
        </div>
      )}

      {error && <div style={s.error}>{error}</div>}

      <div style={s.note}>This code is unique to the machine you were given. Entering it links this app to that machine only.</div>
      <div style={{ ...s.primaryBtn, opacity: submitting ? 0.6 : 1 }} onClick={submitting ? undefined : handleSubmit}>
        {submitting ? 'Setting up...' : 'Complete sign up'}
      </div>

      {onGoLogin && <div style={s.loginLink} onClick={onGoLogin}>Already have an account? Log in</div>}
    </div>
  );
}

const s = {
  wrap: { minHeight: '100dvh', maxWidth: 480, margin: '0 auto', padding: '40px 26px',
    background: '#0B1E22', color: '#EAF6F3', fontFamily: '-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif',
    display: 'flex', flexDirection: 'column' },
  logoSmallWrap: { textAlign: 'center', marginBottom: 10 },
  logoSmall: { width: 90, height: 90, objectFit: 'contain' },
  tag: { textAlign: 'center', fontSize: 13, color: '#8FB3AE', marginBottom: 24 },
  title: { textAlign: 'center', fontSize: 15, fontWeight: 600, marginBottom: 18, lineHeight: 1.4 },
  fieldLabel: { fontSize: 13, color: '#8FB3AE', margin: '14px 0 6px' },
  field: { width: '100%', background: '#11292E', border: '1px solid #1F3E42', borderRadius: 12,
    padding: '12px 14px', color: '#EAF6F3', fontSize: 15, boxSizing: 'border-box' },
  scanRow: { marginTop: 8, fontSize: 13, color: '#23C1A3', cursor: 'pointer', fontWeight: 500 },
  scanBox: { marginTop: 10, borderRadius: 14, overflow: 'hidden', border: '1px solid #1F3E42' },
  video: { width: '100%', display: 'block' },
  error: { marginTop: 12, fontSize: 12, color: '#E8615F' },
  note: { fontSize: 12, color: '#8FB3AE', marginTop: 14, lineHeight: 1.5 },
  primaryBtn: { marginTop: 22, textAlign: 'center', padding: '13px 0', borderRadius: 12,
    background: '#23C1A3', color: '#06201B', fontWeight: 700, fontSize: 15, cursor: 'pointer' },
  loginLink: { marginTop: 16, textAlign: 'center', fontSize: 13, color: '#8FB3AE', cursor: 'pointer' },

  splashWrap: { minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center',
    justifyContent: 'center', background: '#F7F8FA' },
  splashLogoWrap: { width: 200, height: 200, animation: 'none' },
  splashLogo: { width: '100%', height: '100%', objectFit: 'contain' },
  splashTag: { fontSize: 13, color: '#56606A', marginTop: 22 },
  splashBarTrack: { width: 200, height: 4, borderRadius: 4, background: '#E2E6EA', marginTop: 16, overflow: 'hidden' },
  splashBarFill: { height: '100%', borderRadius: 4, background: '#F2932E', transition: 'width 11.5s linear' },

  wifiCard: { background: '#11292E', border: '1px solid #1F3E42', borderRadius: 14, padding: 16, marginTop: 4 },
  wifiStep: { fontSize: 13, lineHeight: 1.6, marginBottom: 10, color: '#EAF6F3' },
};
