# SnapLens mobile app

The first Expo / React Native app for the SnapLens photo troubleshooting flow.
It captures or selects a photo, accepts a question, sends both to the API
Gateway, and displays the answer, safety notes, and source links.

## Prerequisites

- Node.js 22.13 or newer (Expo SDK 57 requirement).
- The SnapLens Gateway and its backend services running on your development PC.
- Expo Go on a physical phone, or an Android emulator. iOS builds require macOS
  and Xcode; an iOS simulator cannot take a real camera photo, so use its photo
  library or a physical iPhone for camera testing.

## Install and start

From this folder in PowerShell:

```powershell
npm install
Copy-Item .env.example .env
# Edit .env and set EXPO_PUBLIC_API_BASE_URL for your environment.
npm start
```

Press `a` to open an Android emulator, `i` for an available iOS simulator, or
scan the QR code with Expo Go on a phone. For a phone, set the URL in `.env` to
the development PC's LAN IP and port `8000`, for example
`http://192.168.1.20:8000`. The phone and PC must be on the same network, and
the Gateway must listen on a reachable interface. Do not use `localhost` from a
physical phone: it points to the phone itself. Android emulator uses
`http://10.0.2.2:8000`; the iOS simulator usually uses
`http://127.0.0.1:8000`.

For LAN use, start the Gateway so it listens on all interfaces:

```powershell
..\.venv\Scripts\python.exe -m uvicorn services.api-gateway.main:app --host 0.0.0.0 --port 8000
```

Also start the Orchestrator, Vision, and Retrieval services in separate
terminals using their documented local commands. Keep the provider defaults in
mock mode while building the UI; no API credits are used in mock mode.

## Providers and secrets

The mobile app must only know the API Gateway URL. Never add Gemini or Tavily
keys to this folder or to any `EXPO_PUBLIC_*` variable; Expo embeds public
variables in the client app. Keep provider keys in the repository root's
ignored `.env`, where only backend services read them. The image is uploaded to
the Gateway for this request and the mobile app does not save a server-side
copy.

To deliberately test the Gemini integration, configure the root `.env` with
`VISION_PROVIDER=gemini`, `ANSWER_PROVIDER=gemini`, and the Gemini key. Set
`RETRIEVAL_PROVIDER=mock` to avoid Tavily usage while testing. A completed
answer requires retrieved sources; with mock Retrieval, the app should show a
clarification response when no sources are available.

## Checks

```powershell
npm run typecheck
npx expo-doctor
```

The current first milestone targets Android and iOS through Expo Go. Device
validation is required for camera permissions, network reachability, and the
full upload flow because simulators and physical devices have different camera
and LAN behavior.
