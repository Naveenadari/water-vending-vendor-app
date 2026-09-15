import { registerPlugin, Capacitor } from '@capacitor/core';

const VendorBridge = registerPlugin('VendorBridge');

export const isNativeApp = () => Capacitor.isNativePlatform();

export async function saveVendorCredentials(phone, pin) {
  if (!isNativeApp()) return; // browser/PWA - notification listening isn't possible anyway
  try {
    await VendorBridge.saveCredentials({ phone, pin });
  } catch (e) {
    console.warn('saveVendorCredentials failed', e);
  }
}

export async function clearVendorCredentials() {
  if (!isNativeApp()) return;
  try {
    await VendorBridge.clearCredentials();
  } catch (e) {
    console.warn('clearVendorCredentials failed', e);
  }
}

export async function openNotificationSettings() {
  if (!isNativeApp()) return;
  try {
    await VendorBridge.openNotificationSettings();
  } catch (e) {
    console.warn('openNotificationSettings failed', e);
  }
}

export async function isNotificationAccessEnabled() {
  if (!isNativeApp()) return false;
  try {
    const result = await VendorBridge.isNotificationAccessEnabled();
    return !!result?.enabled;
  } catch (e) {
    console.warn('isNotificationAccessEnabled failed', e);
    return false;
  }
}

export const KNOWN_UPI_APPS = [
  { key: 'gpay_business', label: 'Google Pay for Business', packageName: 'com.google.android.apps.nbu.paisa.merchant' },
  { key: 'phonepe_business', label: 'PhonePe Business', packageName: 'com.phonepe.app.business' },
  { key: 'paytm_business', label: 'Paytm for Business', packageName: 'com.paytm.business' },
  { key: 'bharatpe', label: 'BharatPe', packageName: 'com.bharatpe.app' },
];

export async function setWatchedApp(packageName) {
  if (!isNativeApp()) return;
  try {
    await VendorBridge.setWatchedApp({ packageName });
  } catch (e) {
    console.warn('setWatchedApp failed', e);
  }
}

export async function getWatchedApp() {
  if (!isNativeApp()) return null;
  try {
    const result = await VendorBridge.getWatchedApp();
    return result?.packageName || null;
  } catch (e) {
    console.warn('getWatchedApp failed', e);
    return null;
  }
}
