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

For a physical Android phone when Windows Firewall blocks Gateway port `8000`,
use the local Metro proxy instead: set `EXPO_PUBLIC_API_BASE_URL` in
`mobile-app/.env` to `http://<PC-LAN-IP>:8081`. Metro forwards diagnosis and
health requests to the Gateway on the PC. Keep Expo running in LAN mode while
testing. This proxy is for local development and is not used by production
builds.

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
Gateway URL on port `8000` and allow that port through the PC firewall. The
optional Expo Metro proxy on port `8081` only forwards HTTP diagnosis calls;
it cannot carry the voice WebSocket connection.

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
