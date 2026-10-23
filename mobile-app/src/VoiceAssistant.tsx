import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { BlurView } from "expo-blur";
import {
  createAudioPlayer,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioStream,
} from "expo-audio";
import * as FileSystem from "expo-file-system/legacy";

export type VoiceScreen = "home" | "diagnose" | "activity" | "guide" | "settings" | "about";
export type VoiceTheme = "light" | "ocean" | "graphite" | "signal" | "violet" | "arctic";
export type VoiceColors = {
  ink: string;
  muted: string;
  blue: string;
  blueDark: string;
  teal: string;
  line: string;
  glassSurface: string;
  glassBorder: string;
  glassFeature: string;
  white: string;
  red: string;
  redTint: string;
};

type Message = { role: "user" | "assistant"; content: string };
type VoiceFunction = { id: string; name: string; arguments: string; client_side?: boolean };

type Props = {
  visible: boolean;
  apiBaseUrl: string;
  currentScreen: VoiceScreen;
  currentTheme: VoiceTheme;
  currentQuestion: string;
  hasPhoto: boolean;
  hasDiagnosis: boolean;
  colors: VoiceColors;
  onClose: () => void;
  onNavigate: (screen: VoiceScreen) => void;
  onStartNewDiagnosis: () => void;
  onCheckGateway: () => Promise<boolean>;
  onSetTheme: (theme: VoiceTheme) => void;
  onTakePhoto: () => Promise<boolean>;
  onChoosePhoto: () => Promise<boolean>;
  onRunDiagnosis: (question: string) => Promise<string>;
  onOpenSource: (number: number) => Promise<boolean>;
};

function toSocketUrl(baseUrl: string): string {
  return `${baseUrl.replace(/^http/i, "ws")}/v1/voice/session`;
}

function asBytes(value: ArrayBuffer): Uint8Array {
  return new Uint8Array(value);
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const merged = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

function makeWave(pcm: Uint8Array, sampleRate: number): Uint8Array {
  const wave = new Uint8Array(44 + pcm.length);
  const view = new DataView(wave.buffer);
  const write = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) wave[offset + i] = value.charCodeAt(i);
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + pcm.length, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, pcm.length, true);
  wave.set(pcm, 44);
  return wave;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function friendlyError(event: unknown): string {
  const message = event instanceof Error ? event.message : "";
  return message.toLowerCase().includes("network")
    ? "Could not reach the voice service. Check that the Gateway is running and reachable from your phone."
    : "The voice session ended unexpectedly. Check the Gateway and Deepgram settings, then try again.";
}

export default function VoiceAssistant(props: Props) {
  const {
    visible, apiBaseUrl, currentScreen, currentTheme, hasPhoto, hasDiagnosis,
    colors, onClose, onNavigate, onSetTheme, onTakePhoto, onChoosePhoto,
    onRunDiagnosis, onOpenSource,
  } = props;
  const propsRef = useRef(props);
  propsRef.current = props;
  const socketRef = useRef<WebSocket | null>(null);
  const playerRef = useRef<ReturnType<typeof createAudioPlayer> | null>(null);
  const playerSubscriptionRef = useRef<{ remove: () => void } | null>(null);
  const playbackFileRef = useRef<string | null>(null);
  const audioChunksRef = useRef<Uint8Array[]>([]);
  const cancelledCallsRef = useRef<Set<string>>(new Set());
  const endAfterReplyRef = useRef(false);
  const closingRef = useRef(false);
  const [status, setStatus] = useState<"off" | "connecting" | "listening" | "thinking" | "speaking">("off");
  const [messages, setMessages] = useState<Message[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const { stream } = useAudioStream({
    sampleRate: 16000,
    channels: 1,
    encoding: "int16",
    onBuffer: (buffer) => {
      const socket = socketRef.current;
      if (socket?.readyState === WebSocket.OPEN) socket.send(buffer.data);
    },
  });

  const addMessage = (message: Message) => {
    if (!message.content.trim()) return;
    setMessages((current) => [...current, message].slice(-12));
  };

  const stopPlayback = () => {
    playerSubscriptionRef.current?.remove();
    playerSubscriptionRef.current = null;
    playerRef.current?.remove();
    playerRef.current = null;
    if (playbackFileRef.current) {
      void FileSystem.deleteAsync(playbackFileRef.current, { idempotent: true }).catch(() => undefined);
      playbackFileRef.current = null;
    }
  };

  const playReply = async () => {
    const pcm = concatBytes(audioChunksRef.current);
    audioChunksRef.current = [];
    if (pcm.length < 2 || !FileSystem.cacheDirectory) {
      if (endAfterReplyRef.current) setTimeout(() => stopSession(), 1500);
      return;
    }
    stopPlayback();
    const fileUri = `${FileSystem.cacheDirectory}snaplens-voice-${Date.now()}.wav`;
    await FileSystem.writeAsStringAsync(fileUri, bytesToBase64(makeWave(pcm, 24000)), { encoding: "base64" });
    playbackFileRef.current = fileUri;
    const player = createAudioPlayer(fileUri);
    playerRef.current = player;
    playerSubscriptionRef.current = player.addListener("playbackStatusUpdate", (playback) => {
      if (playback.didJustFinish) {
        stopPlayback();
        if (endAfterReplyRef.current) {
          endAfterReplyRef.current = false;
          stopSession();
          return;
        }
        setStatus(socketRef.current?.readyState === WebSocket.OPEN ? "listening" : "off");
      }
    });
    setStatus("speaking");
    player.play();
  };

  const sendProviderMessage = (message: object) => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  };

  const handleFunction = async (call: VoiceFunction) => {
    if (cancelledCallsRef.current.has(call.id)) return;
    const currentProps = propsRef.current;
    let result: string;
    try {
      const args = JSON.parse(call.arguments || "{}") as Record<string, unknown>;
      switch (call.name) {
        case "navigate_to_screen": {
          const screen = args.screen;
          if (!["home", "diagnose", "activity", "guide", "settings", "about"].includes(String(screen))) {
            result = "That screen is not available.";
            break;
          }
          currentProps.onNavigate(screen as VoiceScreen);
          result = `Opened the ${String(screen)} screen.`;
          break;
        }
        case "start_new_diagnosis":
          currentProps.onStartNewDiagnosis();
          result = "Started a fresh diagnosis. The previous photo, question, and result were cleared.";
          break;
        case "check_gateway_connection":
          result = await currentProps.onCheckGateway()
            ? "The SnapLens Gateway is reachable."
            : "SnapLens could not reach the Gateway. Check the server and the phone's API address.";
          break;
        case "set_appearance_theme": {
          const theme = args.theme;
          if (!["light", "ocean", "graphite", "signal", "violet", "arctic"].includes(String(theme))) {
            result = "That theme is not available.";
            break;
          }
          currentProps.onSetTheme(theme as VoiceTheme);
          result = `Changed the appearance theme to ${String(theme)}.`;
          break;
        }
        case "take_troubleshooting_photo":
          result = await currentProps.onTakePhoto()
            ? "A photo is now selected. Ask the user what they want to know about it, or proceed with their pending diagnosis request."
            : "The camera was closed without selecting a photo.";
          break;
        case "choose_troubleshooting_photo":
          result = await currentProps.onChoosePhoto()
            ? "A photo is now selected. Ask the user what they want to know about it, or proceed with their pending diagnosis request."
            : "No photo was selected from the library.";
          break;
        case "run_photo_diagnosis":
          if (!currentProps.hasPhoto) {
            result = "No photo is selected. Ask the user to take or choose a photo, then retry the diagnosis.";
          } else {
            result = await currentProps.onRunDiagnosis(String(args.question || "What is wrong in this photo?"));
          }
          break;
        case "open_diagnosis_source": {
          const number = Number(args.source_number);
          result = !currentProps.hasDiagnosis
            ? "There is no diagnosis result with sources open yet."
            : (await currentProps.onOpenSource(number)) ? `Opened source ${number}.` : `Source ${number} is unavailable.`;
          break;
        }
        case "end_voice_assistant":
          endAfterReplyRef.current = true;
          result = "I'll turn off voice mode after this short goodbye.";
          break;
        default:
          result = "That action is not enabled in SnapLens.";
      }
    } catch {
      result = "SnapLens could not complete that action. Tell the user what happened and offer to try again.";
    }
    if (!cancelledCallsRef.current.has(call.id)) {
      sendProviderMessage({ type: "FunctionCallResponse", id: call.id, name: call.name, content: result });
    }
  };

  const startSession = async () => {
    if (isStarting || socketRef.current) return;
    if (new URL(apiBaseUrl).port === "8081") {
      setError("Voice uses a WebSocket and needs the SnapLens Gateway address on port 8000. The Expo port 8081 proxy only forwards diagnosis HTTP requests.");
      return;
    }
    setIsStarting(true);
    setError(null);
    closingRef.current = false;
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        setError("Microphone permission is needed to speak with SnapLens.");
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true, interruptionMode: "doNotMix" });
      setStatus("connecting");
      const socket = new WebSocket(toSocketUrl(apiBaseUrl));
      (socket as WebSocket & { binaryType: string }).binaryType = "arraybuffer";
      socketRef.current = socket;
      socket.onmessage = async (event) => {
        if (typeof event.data !== "string") {
          try {
            if (event.data instanceof ArrayBuffer) audioChunksRef.current.push(asBytes(event.data));
            else if (typeof Blob !== "undefined" && event.data instanceof Blob) audioChunksRef.current.push(asBytes(await event.data.arrayBuffer()));
          } catch {
            setError("SnapLens received an unreadable voice response.");
          }
          return;
        }
        let message: Record<string, unknown>;
        try {
          message = JSON.parse(event.data) as Record<string, unknown>;
        } catch {
          return;
        }
        if (message.type === "SettingsApplied") {
          await stream.start();
          setStatus("listening");
          sendProviderMessage({
            type: "InjectUserMessage",
            content: `SnapLens app context: current screen is ${propsRef.current.currentScreen}; current appearance theme is ${propsRef.current.currentTheme}; photo selected is ${propsRef.current.hasPhoto ? "yes" : "no"}; diagnosis result available is ${propsRef.current.hasDiagnosis ? "yes" : "no"}; current diagnosis question is ${propsRef.current.currentQuestion || "none"}. The user is now speaking to you inside the SnapLens mobile app.`,
          });
        } else if (message.type === "ConversationText") {
          const role = message.role === "user" ? "user" : "assistant";
          addMessage({ role, content: String(message.content || "") });
          if (role === "assistant" && String(message.content || "").trim()) setStatus("thinking");
        } else if (message.type === "AgentThinking") {
          setStatus("thinking");
        } else if (message.type === "AgentStartedSpeaking") {
          setStatus("speaking");
        } else if (message.type === "AgentAudioDone") {
          try {
            await playReply();
          } catch {
            setError("SnapLens could not play the voice response. The text transcript is still available.");
            setStatus("listening");
          }
        } else if (message.type === "UserStartedSpeaking") {
          stopPlayback();
          setStatus("listening");
        } else if (message.type === "FunctionCallRequest" && Array.isArray(message.functions)) {
          const calls = message.functions as VoiceFunction[];
          for (const call of calls) {
            if (call.client_side) await handleFunction(call);
          }
        } else if (message.type === "FunctionCallCancelled" && Array.isArray(message.functions)) {
          for (const call of message.functions as Array<{ id: string }>) cancelledCallsRef.current.add(call.id);
        } else if (message.type === "GatewayError") {
          setError(String(message.message || "The Gateway could not start a voice session."));
        } else if (message.type === "Error") {
          setError("The voice provider could not complete that turn. Try speaking again.");
          setStatus("listening");
        } else if (message.type === "Warning") {
          setError(String(message.description || "The voice connection reported a temporary issue."));
        }
      };
      socket.onerror = (event) => {
        setError(friendlyError(event));
      };
      socket.onclose = (event) => {
        socketRef.current = null;
        void stream.stop();
        setStatus("off");
        if (!closingRef.current && !error && event.code !== 1000) {
          setError(event.reason || "Voice session disconnected. Check that the Gateway has a Deepgram key and voice mode is enabled.");
        }
      };
    } catch {
      setError("SnapLens could not start microphone access. Check the app's microphone permission and try again.");
      socketRef.current?.close();
      socketRef.current = null;
      setStatus("off");
    } finally {
      setIsStarting(false);
    }
  };

  const stopSession = () => {
    closingRef.current = true;
    endAfterReplyRef.current = false;
    void stream.stop();
    stopPlayback();
    audioChunksRef.current = [];
    const socket = socketRef.current;
    socketRef.current = null;
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, "User ended the voice session.");
    setStatus("off");
  };

  useEffect(() => () => {
    closingRef.current = true;
    void stream.stop();
    stopPlayback();
    socketRef.current?.close();
  }, [stream]);

  const close = () => {
    stopSession();
    onClose();
  };

  const statusLabel = status === "off" ? "VOICE ASSISTANT OFF"
    : status === "connecting" ? "CONNECTING TO DEEPGRAM"
      : status === "thinking" ? "THINKING"
        : status === "speaking" ? "SPEAKING · YOU CAN INTERRUPT"
          : "LISTENING · SAY A COMMAND";

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={close}>
      <View style={styles.overlay}>
        <View style={[styles.panel, { backgroundColor: colors.glassSurface, borderColor: colors.glassBorder }]}>
          <BlurView tint="light" intensity={54} style={StyleSheet.absoluteFill} />
          <View style={[styles.header, { borderBottomColor: colors.line }]}>
            <View style={styles.headerCopy}>
              <Text style={[styles.eyebrow, { color: colors.teal }]}>SNAPLENS · VOICE MODE</Text>
              <Text style={[styles.title, { color: colors.ink }]}>Your app assistant</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Close voice assistant" onPress={close} style={[styles.close, { borderColor: colors.line }]}>
              <Text style={[styles.closeText, { color: colors.ink }]}>×</Text>
            </Pressable>
          </View>

          <View style={styles.statusRow}>
            <View style={[styles.statusDot, { backgroundColor: status === "off" ? colors.muted : status === "thinking" ? colors.blue : colors.teal }]} />
            <Text style={[styles.statusText, { color: colors.muted }]}>{statusLabel}</Text>
            {status === "connecting" || status === "thinking" ? <ActivityIndicator size="small" color={colors.blue} /> : null}
          </View>

          <ScrollView style={styles.transcript} contentContainerStyle={styles.transcriptContent} showsVerticalScrollIndicator={false}>
            {messages.length === 0 ? (
              <View style={[styles.welcome, { borderColor: colors.line }]}>
                <Text style={[styles.welcomeTitle, { color: colors.ink }]}>Tell SnapLens what to do</Text>
              <Text style={[styles.welcomeBody, { color: colors.muted }]}>Try “open the guide,” “start a new diagnosis,” “change my theme to Ocean,” or “check the Gateway.”</Text>
              </View>
            ) : messages.map((message, index) => (
              <View key={`${index}-${message.role}`} style={[styles.message, message.role === "user" ? styles.userMessage : styles.assistantMessage, { borderColor: colors.line, backgroundColor: message.role === "user" ? `${colors.blue}16` : colors.glassSurface }]}>
                <Text style={[styles.messageRole, { color: message.role === "user" ? colors.blueDark : colors.teal }]}>{message.role === "user" ? "YOU" : "SNAPLENS"}</Text>
                <Text style={[styles.messageBody, { color: colors.ink }]}>{message.content}</Text>
              </View>
            ))}
            {error ? <View style={[styles.errorCard, { borderColor: colors.red, backgroundColor: colors.redTint }]}><Text style={[styles.errorText, { color: colors.red }]}>{error}</Text></View> : null}
          </ScrollView>

          <View style={styles.actions}>
            {status === "off" ? (
              <Pressable accessibilityRole="button" disabled={isStarting} onPress={() => void startSession()} style={[styles.primaryButton, { backgroundColor: colors.blue }, isStarting && styles.disabled]}>
                {isStarting ? <ActivityIndicator color={colors.white} /> : <Text style={styles.primaryIcon}>◎</Text>}
                <Text style={styles.primaryLabel}>{isStarting ? "Starting voice…" : "Enable voice assistant"}</Text>
              </Pressable>
            ) : (
              <Pressable accessibilityRole="button" onPress={stopSession} style={[styles.stopButton, { borderColor: colors.line, backgroundColor: colors.glassSurface }]}>
                <View style={[styles.stopSquare, { backgroundColor: colors.red }]} />
                <Text style={[styles.stopLabel, { color: colors.ink }]}>Turn off assistant</Text>
              </Pressable>
            )}
            <Text style={[styles.privacy, { color: colors.muted }]}>Microphone streams only while voice mode is on. SnapLens does not save voice recordings.</Text>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(13,25,43,0.42)", justifyContent: "flex-end" },
  panel: { maxHeight: "92%", minHeight: "72%", borderTopLeftRadius: 28, borderTopRightRadius: 28, borderWidth: 1, overflow: "hidden", paddingBottom: 22 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 22, paddingTop: 24, paddingBottom: 17, borderBottomWidth: StyleSheet.hairlineWidth },
  headerCopy: { gap: 4 },
  eyebrow: { fontSize: 10, letterSpacing: 1.6, fontWeight: "800" },
  title: { fontSize: 22, fontWeight: "800" },
  close: { width: 40, height: 40, borderRadius: 14, borderWidth: 1, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.45)" },
  closeText: { fontSize: 27, lineHeight: 29 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 22, paddingVertical: 13 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { flex: 1, fontSize: 10, fontWeight: "800", letterSpacing: 1.1 },
  transcript: { flex: 1, paddingHorizontal: 18 },
  transcriptContent: { paddingVertical: 8, gap: 10 },
  welcome: { borderWidth: 1, borderRadius: 18, padding: 18, marginTop: 8, backgroundColor: "rgba(255,255,255,0.32)" },
  welcomeTitle: { fontSize: 16, fontWeight: "800" },
  welcomeBody: { marginTop: 8, fontSize: 13, lineHeight: 20 },
  message: { maxWidth: "92%", borderWidth: 1, borderRadius: 18, paddingVertical: 11, paddingHorizontal: 13 },
  userMessage: { alignSelf: "flex-end", borderBottomRightRadius: 6 },
  assistantMessage: { alignSelf: "flex-start", borderBottomLeftRadius: 6 },
  messageRole: { fontSize: 9, fontWeight: "900", letterSpacing: 1, marginBottom: 5 },
  messageBody: { fontSize: 13, lineHeight: 19 },
  errorCard: { borderWidth: 1, borderRadius: 14, padding: 12 },
  errorText: { fontSize: 12, lineHeight: 18 },
  actions: { paddingHorizontal: 20, paddingTop: 12, gap: 11 },
  primaryButton: { minHeight: 56, borderRadius: 18, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 10 },
  primaryIcon: { color: "white", fontSize: 21, fontWeight: "900" },
  primaryLabel: { color: "white", fontSize: 14, fontWeight: "800" },
  disabled: { opacity: 0.65 },
  stopButton: { minHeight: 54, borderRadius: 17, borderWidth: 1, flexDirection: "row", gap: 10, alignItems: "center", justifyContent: "center" },
  stopSquare: { width: 11, height: 11, borderRadius: 3 },
  stopLabel: { fontSize: 13, fontWeight: "800" },
  privacy: { textAlign: "center", fontSize: 10, lineHeight: 16, paddingHorizontal: 14 },
});
