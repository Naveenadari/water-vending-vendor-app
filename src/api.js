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

  signup: (payload) =>
    request('/api/vendors/signup', { method: 'POST', body: JSON.stringify(payload) }),

  listDevices: (vendorId) => request(`/api/devices/vendor/${vendorId}`),

  getDevice: (deviceId) => request(`/api/devices/${deviceId}`),

  getRazorpayQr: (device_id, vendor_id) =>
    request('/api/razorpay/qr', { method: 'POST', body: JSON.stringify({ device_id, vendor_id }) }),

  setRazorpayPrice: (payload) =>
    request('/api/razorpay/price', { method: 'POST', body: JSON.stringify(payload) }),

  setPaymentMode: (payload) =>
    request('/api/razorpay/payment-mode', { method: 'POST', body: JSON.stringify(payload) }),
};
