# ◈ CaseVault — PI Case Management

Professional private investigation case management PWA with GPS tracking, evidence recording, AI analysis, invoicing, chain of custody, and multi-agent support.

## Features

- **Case Management** — Create, track, and manage investigations with full status workflow
- **Client Management** — Individual and firm/attorney profiles with multi-case relationships
- **GPS Mileage Tracking** — Real-time GPS tracking with auto-distance calculation
- **Audio/Video Evidence Recording** — Record and store evidence with integrity hashing
- **Expense Tracking** — Hotels, meals, fuel, fees with billable/non-billable categorization
- **Invoicing** — Auto-generated from tracked time, mileage, and expenses with rate cascade
- **Chain of Custody** — Cryptographic hash-chained audit trail for evidence admissibility
- **Multi-Agent Support** — Agency mode with role-based access (Owner, Admin, Investigator, Viewer)
- **Rate Cascade** — Agency defaults → Client rates → Per-case overrides
- **Offline-Ready PWA** — Install on iPhone/Android, works without internet
- **Persistent Storage** — All data saved locally on your device

## Quick Start (Local Development)

```bash
npm install
npm run dev
```

Open `http://localhost:5173/casevault/` in your browser.

## Deploy to GitHub Pages

1. Create a new repo on GitHub named `casevault`
2. Push this code to the `main` branch:

```bash
git init
git add .
git commit -m "Initial CaseVault deployment"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/casevault.git
git push -u origin main
```

3. In your repo's **Settings → Pages**, set Source to **GitHub Actions**
4. The workflow will auto-build and deploy on every push
5. Your app will be at: `https://YOUR_USERNAME.github.io/casevault/`

## Install on Your Phone

1. Open the URL on your phone's browser (Safari for iPhone, Chrome for Android)
2. **iPhone**: Tap the share button → "Add to Home Screen"
3. **Android**: Tap the menu → "Install app" or "Add to Home Screen"
4. The app will appear on your home screen with the CaseVault icon
5. It runs full-screen like a native app

## Data Storage

All data is stored in your browser's localStorage on each device. Data does **not** sync between devices. For a production deployment with multi-device sync, you would need a backend database.

## License

Private use.
