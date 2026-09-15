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
