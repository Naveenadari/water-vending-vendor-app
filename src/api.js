export const API_BASE =
  import.meta.env.VITE_API_URL || 'https://water-vending-backend.onrender.com';

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const api = {
  login: (phone, pin) =>
    request('/api/vendors/login', { method: 'POST', body: JSON.stringify({ phone, pin }) }),

  listDevices: (vendorId) => request(`/api/devices/vendor/${vendorId}`),

  getDevice: (deviceId) => request(`/api/devices/${deviceId}`),
};
