import React, { useEffect, useState, useCallback } from 'react';
import Login from './pages/Login';
import Home from './pages/Home';
import Device from './pages/Device';
import Control from './pages/Control';
import Analytics from './pages/Analytics';
import { connectSocket, disconnectSocket } from './socket';

function WaterIcon({ color = '#57626f' }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path d="M12 2C12 2 5 10.5 5 15a7 7 0 0014 0C19 10.5 12 2 12 2z" stroke={color} strokeWidth="1.8" />
    </svg>
  );
}

export default function App() {
  const [vendor, setVendor] = useState(() => {
    const saved = localStorage.getItem('vendor');
    return saved ? JSON.parse(saved) : null;
  });
  const [screen, setScreen] = useState('home');
  const [currentDevice, setCurrentDevice] = useState(null);
  const [toastMsg, setToastMsg] = useState('');

  useEffect(() => {
    if (vendor) connectSocket(vendor.id);
    return () => disconnectSocket();
  }, [vendor]);

  const toast = useCallback((msg) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(''), 2500);
  }, []);

  function handleLogout() {
    localStorage.removeItem('vendor');
    disconnectSocket();
    setVendor(null);
    setCurrentDevice(null);
    setScreen('home');
  }

  function selectDevice(device) {
    setCurrentDevice(device);
    setScreen('dashboard');
  }

  if (!vendor) {
    return <Login onLoggedIn={setVendor} />;
  }

  return (
    <div className="app-shell">
      {screen === 'home' && <Home vendor={vendor} onSelectDevice={selectDevice} />}

      {screen === 'dashboard' && currentDevice && (
        <Device device={currentDevice} onBack={() => setScreen('home')} toast={toast} />
      )}

      {screen === 'control' && currentDevice && (
        <Control device={currentDevice} onBack={() => setScreen('dashboard')} toast={toast} />
      )}

      {screen === 'analytics' && currentDevice && (
        <Analytics device={currentDevice} onBack={() => setScreen('dashboard')} />
      )}

      {screen === 'profile' && (
        <div className="screen">
          <p className="section-title">Profile</p>
          <div className="list-row">
            <div>
              <p className="list-row-title">{vendor.name}</p>
              <p className="list-row-sub">{vendor.phone}</p>
            </div>
          </div>
          <button className="btn-secondary" style={{ marginTop: 16 }} onClick={handleLogout}>
            Sign out
          </button>
        </div>
      )}

      {toastMsg && <div className="toast">{toastMsg}</div>}

      <nav className="bottom-nav">
        <button className={`nav-item ${screen === 'home' ? 'active' : ''}`} onClick={() => setScreen('home')}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M4 11l8-7 8 7v9a1 1 0 01-1 1h-4v-6H9v6H5a1 1 0 01-1-1v-9z" stroke={screen === 'home' ? '#2fb6c4' : '#57626f'} strokeWidth="1.6" />
          </svg>
          Home
        </button>
        <button
          className={`nav-item ${screen === 'analytics' ? 'active' : ''}`}
          onClick={() => currentDevice && setScreen('analytics')}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M5 20V10M12 20V4M19 20v-7" stroke={screen === 'analytics' ? '#2fb6c4' : '#57626f'} strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          Analytics
        </button>
        <button
          className={`nav-item ${screen === 'dashboard' ? 'active' : ''}`}
          onClick={() => currentDevice && setScreen('dashboard')}
        >
          <WaterIcon color={screen === 'dashboard' ? '#2fb6c4' : '#57626f'} />
          Live
        </button>
        <button
          className={`nav-item ${screen === 'control' ? 'active' : ''}`}
          onClick={() => currentDevice && setScreen('control')}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M4 6h16M4 12h16M4 18h16" stroke={screen === 'control' ? '#2fb6c4' : '#57626f'} strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          Control
        </button>
        <button className={`nav-item ${screen === 'profile' ? 'active' : ''}`} onClick={() => setScreen('profile')}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="8" r="3.2" stroke={screen === 'profile' ? '#2fb6c4' : '#57626f'} strokeWidth="1.6" />
            <path d="M5 20c1.2-3.5 4-5.3 7-5.3s5.8 1.8 7 5.3" stroke={screen === 'profile' ? '#2fb6c4' : '#57626f'} strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          Profile
        </button>
      </nav>
    </div>
  );
}
