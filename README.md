# Water Vending - Vendor App

A dark, mobile-first web dashboard for controlling and monitoring your water
vending machines. Talks to the `water-vending-backend` over REST + WebSocket
(Socket.IO).

## Local development

```bash
npm install
npm run dev
```

By default it points at `https://water-vending-backend.onrender.com`. To point
at a different backend (e.g. while testing locally), create a `.env` file:

```
VITE_API_URL=https://your-backend-url
```

## Deploy to Render (as a Static Site)

1. Push this folder to a GitHub repo (same drag-and-drop upload method used
   for the backend).
2. On Render: **New +** -> **Static Site** -> connect the repo.
   - Build command: `npm install && npm run build`
   - Publish directory: `dist`
3. Deploy. Render gives you a URL like `https://your-app.onrender.com` -
   open that on your phone.
4. Optional: on your phone, open the URL in Chrome -> menu -> "Add to Home
   screen" so it behaves like an installed app (full screen, its own icon).

## Logging in

Log in with the vendor `phone` and `admin_pin` that were used when the vendor
was created via the backend's `/api/vendors` endpoint (the PowerShell command
you ran earlier - phone `9999999999`, PIN `1234` for the test vendor).

## What each screen does

- **Home** - lists your machines, tap one to open its live dashboard.
- **Live** (water drop icon) - live flow rate, valve status, one-tap preset
  dispense, stop button.
- **Control** - edit presets (type a pulse count, or "Fill & Calibrate" to
  measure by actually filling a container), and machine settings (confirm
  mode, timeout, coin rate, card top-up/trip cost).
- **Analytics** - recent transactions and revenue for the selected machine.
- **Profile** - shows the signed-in vendor, sign out.

## Notes

- The app needs your ESP32 machine to be online (connected to the backend)
  for commands like "Dispense" or "Save settings" to actually reach the
  hardware. If the machine is offline, commands are silently dropped for now
  (a "command_failed" event is emitted but not yet shown in the UI - a good
  next improvement).
- This is a first working version. Natural next additions: multi-device
  support in Control/Analytics without needing to go back to Home each time,
  push notifications for low balance / offline machines, and a proper
  "device offline" banner.
