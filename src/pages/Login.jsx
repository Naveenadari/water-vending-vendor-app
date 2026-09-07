import React, { useState } from 'react';
import { api } from '../api';

export default function Login({ onLoggedIn }) {
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const vendor = await api.login(phone.trim(), pin.trim());
      localStorage.setItem('vendor', JSON.stringify(vendor));
      onLoggedIn(vendor);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-screen">
      <div className="login-mark">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
          <path
            d="M12 2C12 2 5 10.5 5 15a7 7 0 0014 0C19 10.5 12 2 12 2z"
            stroke="#2fb6c4"
            strokeWidth="1.6"
          />
        </svg>
      </div>
      <h1 className="login-title">Sol Electronics</h1>
      <p className="login-sub">Sign in to manage your machines</p>

      <form onSubmit={handleSubmit}>
        <label className="field-label">Phone number</label>
        <input
          className="field"
          type="tel"
          inputMode="numeric"
          placeholder="9999999999"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          required
        />
        <label className="field-label">PIN</label>
        <input
          className="field"
          type="password"
          inputMode="numeric"
          placeholder="4-digit PIN"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          required
        />
        {error && <p className="error-text">{error}</p>}
        <button className="btn-primary" type="submit" disabled={loading}>
          {loading ? 'Signing in...' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
