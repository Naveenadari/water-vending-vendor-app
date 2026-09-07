import { io } from 'socket.io-client';
import { API_BASE } from './api';

let socket = null;

export function connectSocket(vendorId) {
  if (socket) return socket;
  socket = io(`${API_BASE}/app`, {
    path: '/socket.io',
    query: { vendor_id: vendorId },
    transports: ['websocket'],
  });
  return socket;
}

export function getSocket() {
  return socket;
}

export function sendCommand(deviceId, type, extra = {}) {
  if (!socket) return;
  socket.emit('command', { device_id: deviceId, type, ...extra });
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
