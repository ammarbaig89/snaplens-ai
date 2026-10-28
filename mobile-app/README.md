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

Install the mobile dependencies and create its local API URL file from this
folder in PowerShell:

```powershell
npm ci
if (!(Test-Path .env)) { Copy-Item .env.example .env }
```

Start all backend services in a separate PowerShell window from this folder:

```powershell
Set-Location ..
.\scripts\start-local.ps1
```

The launcher detects your PC's LAN address and writes it to `mobile-app/.env`
for a physical phone. For an emulator or simulator, edit that file and use the
matching address below. Keep the phone and PC on the same Wi-Fi, and allow
Gateway TCP port `8000` through Windows Firewall when prompted.

In another PowerShell window, start Expo from this folder:

```powershell
npm start -- --lan
```

Scan the QR code with Expo Go, press `a` for an Android emulator, or press `i`
for an available iOS simulator. A physical phone must use the PC's LAN IP;
`localhost` points to the phone itself. Android emulator uses
`http://10.0.2.2:8000`; the iOS simulator usually uses
`http://127.0.0.1:8000`. Port `8081` is Expo Metro, not the SnapLens Gateway;
use Gateway port `8000` for diagnosis and voice sessions.

## Providers and secrets

The mobile app must only know the API Gateway URL. Never add Gemini or Tavily
keys to this folder or to any `EXPO_PUBLIC_*` variable; Expo embeds public
variables in the client app. Keep provider keys in the repository root's
ignored `.env`, where only backend services read them. The image is uploaded to
the Gateway for this request and the mobile app does not save a server-side
copy.

For a live end-to-end diagnosis, keep `VISION_PROVIDER=gemini` and
`ANSWER_PROVIDER=gemini`, and set `RETRIEVAL_PROVIDER=tavily` in the ignored
repository-root `.env`. The Gemini and Tavily keys stay server-side in that file.
A recognizable device result can trigger one Tavily search; Gemini Vision and
answer synthesis also make model requests. Unrecognized images can skip search,
and a completed answer requires retrieved sources. The starter `.env.example`
remains in mock mode so a fresh clone does not make paid provider requests until
its owner explicitly enables them.

## Hands-free voice assistant

The app includes an app-wide Deepgram Voice Agent. From Home, tap **VOICE** or
open the navigation menu and choose **Voice assistant**. Grant microphone
permission and explicitly enable the session. You can ask it to navigate to an
app screen, change one of the appearance themes, take or choose a photo, request
a diagnosis, and open a numbered source from the visible result. Diagnosis
still runs through the existing Gateway, Orchestrator, Vision, and Retrieval
services.

Voice credentials stay on the backend. In the ignored repository-root `.env`,
set `DEEPGRAM_API_KEY` and `VOICE_ASSISTANT_ENABLED=true`, then restart the
Gateway. Keep `DEEPGRAM_API_KEY` out of this folder's `.env`, all
`EXPO_PUBLIC_*` variables, and source control. Deepgram's Voice Agent handles
speech recognition, conversation, and speech output. The managed LLM defaults
to `open_ai` with `gpt-4o-mini`, accessed through Deepgram; no OpenAI key is
needed in the mobile app. Your Deepgram account and enabled models determine
availability and charges.

The microphone stream stops when the user turns off or closes Voice Assistant.
SnapLens does not persist voice recordings. Voice sessions have server-side
concurrency and duration limits. Expo Go can load the app-side audio modules;
rebuild a native app if you change native permission configuration.
For a physical phone, point `EXPO_PUBLIC_API_BASE_URL` directly to the PC's
Gateway URL on port `8000` and allow that port through the PC firewall. Expo
Metro runs on port `8081`; it is not the Gateway and does not carry the voice
WebSocket connection.

## Checks

```powershell
npm run typecheck
npx expo-doctor
```

The current first milestone targets Android and iOS through Expo Go. Device
validation is required for camera permissions, network reachability, and the
full upload flow because simulators and physical devices have different camera
and LAN behavior.

Android uses `softwareKeyboardLayoutMode: "pan"` to avoid resizing the
diagnosis layout when the keyboard opens. This is a native Android setting:
Expo Go does not rebuild its Android host from this project's `app.json`, so
validate the layout change with a native development build. JavaScript UI
updates still load through Expo Go.
