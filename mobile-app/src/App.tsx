import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import {
  Animated,
  ActivityIndicator,
  Alert,
  BackHandler,
  Easing,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  LogBox,
  Pressable,
  Platform,
  ScrollView,
  Share,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ViewStyle,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { BlurTargetView, BlurView } from "expo-blur";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { createDiagnosis, DiagnosisApiError, safeCitationUrl, validateDiagnosisInput } from "./api";
import { API_BASE_URL } from "./config";
import { MAX_IMAGE_BYTES, MAX_QUESTION_CHARS, SUPPORTED_IMAGE_TYPES } from "./config";
import type { DiagnosisResult, ImageSelection } from "./types";
import VoiceAssistant, { type VoiceScreen, type VoiceTheme } from "./VoiceAssistant";
import VoiceMicIcon from "./VoiceMicIcon";

LogBox.ignoreLogs([
  "Response.blob() is using React Native's Blob",
]);

const lightColors = {
  ink: "#17243B",
  muted: "#6F7F96",
  background: "#EAF0F8",
  canvas: "#EAF0F8",
  white: "#FFFFFF",
  navy: "#14233D",
  blue: "#3568D4",
  blueDark: "#234C9F",
  blueTint: "rgba(53,104,212,0.11)",
  teal: "#08AFC0",
  tealTint: "rgba(8,175,192,0.10)",
  line: "#DCE5EF",
  soft: "#E4ECF5",
  amber: "#FFF2D8",
  amberInk: "#805719",
  red: "#B44246",
  redTint: "#FFF0EF",
  glassSurface: "rgba(255,255,255,0.40)",
  glassBorder: "rgba(255,255,255,0.9)",
  glassFeature: "rgba(20,35,61,0.72)",
  glassFeatureBorder: "rgba(55,104,216,0.34)",
};

type ThemeId = "light" | "ocean" | "graphite" | "signal" | "violet" | "arctic";
type ThemeColors = typeof lightColors;
type ThemeOption = { id: ThemeId; name: string; description: string; colors: ThemeColors };

const themeOptions: ThemeOption[] = [
  { id: "light", name: "Light", description: "Cool blue glass", colors: lightColors },
  {
    id: "ocean", name: "Ocean", description: "Deep blue + aqua",
    colors: { ...lightColors, ink: "#173044", muted: "#668093", background: "#EAF3F8", canvas: "#EAF3F8", navy: "#12334B", blue: "#1475A8", blueDark: "#125B83", blueTint: "rgba(20,117,168,0.12)", teal: "#00A6A6", tealTint: "rgba(0,166,166,0.11)", line: "#D4E4EC", soft: "#DFEBF1", glassFeatureBorder: "rgba(20,117,168,0.34)" },
  },
  {
    id: "graphite", name: "Graphite", description: "Slate + signal teal",
    colors: { ...lightColors, ink: "#202E3D", muted: "#6C7D8E", background: "#E9EEF3", canvas: "#E9EEF3", navy: "#20364C", blue: "#426C91", blueDark: "#345775", blueTint: "rgba(66,108,145,0.12)", teal: "#138F91", tealTint: "rgba(19,143,145,0.11)", line: "#D6DFE7", soft: "#E1E8EE", glassFeatureBorder: "rgba(66,108,145,0.34)" },
  },
  {
    id: "signal", name: "Signal", description: "Steel blue + amber",
    colors: { ...lightColors, ink: "#2D302F", muted: "#77766F", background: "#F1F0E9", canvas: "#F1F0E9", navy: "#29333B", blue: "#32678B", blueDark: "#28516E", blueTint: "rgba(50,103,139,0.12)", teal: "#188D83", tealTint: "rgba(24,141,131,0.11)", line: "#E0DED2", soft: "#E8E6DC", amber: "#FFF0CC", amberInk: "#79551A", glassFeatureBorder: "rgba(50,103,139,0.34)" },
  },
  {
    id: "violet", name: "Violet", description: "Indigo + cool cyan",
    colors: { ...lightColors, ink: "#282941", muted: "#74758F", background: "#F0F0F8", canvas: "#F0F0F8", navy: "#292B4B", blue: "#575BC1", blueDark: "#45489B", blueTint: "rgba(87,91,193,0.12)", teal: "#168E9A", tealTint: "rgba(22,142,154,0.11)", line: "#DEDFEE", soft: "#E7E8F2", glassFeatureBorder: "rgba(87,91,193,0.34)" },
  },
  {
    id: "arctic", name: "Arctic", description: "Glacier + teal",
    colors: { ...lightColors, ink: "#19373D", muted: "#6B858A", background: "#EAF4F3", canvas: "#EAF4F3", navy: "#153A42", blue: "#167C8C", blueDark: "#126372", blueTint: "rgba(22,124,140,0.12)", teal: "#08A4A2", tealTint: "rgba(8,164,162,0.11)", line: "#D4E7E4", soft: "#E0EFED", glassFeatureBorder: "rgba(22,124,140,0.34)" },
  },
];

type Tab = "home" | "diagnose" | "activity" | "guide" | "settings" | "about";
type DiagnosisStep = "photo" | "question" | "result";
const GlassBlurTargetContext = createContext<RefObject<View | null> | null>(null);
type ThemeContextValue = { colors: ThemeColors; styles: ReturnType<typeof createStyles> };
const ThemeContext = createContext<ThemeContextValue | null>(null);

function useAppTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("SnapLens theme context is missing");
  return value;
}

function GlassBlur({ style, intensity = 42 }: { style: ViewStyle; intensity?: number }) {
  const blurTarget = useContext(GlassBlurTargetContext);
  const androidBlurProps = Platform.OS === "android" ? { blurTarget: blurTarget ?? undefined, blurMethod: "dimezisBlurViewSdk31Plus" as const } : {};
  return <BlurView {...androidBlurProps} tint="light" intensity={intensity} style={style} />;
}

function GlassSurface({ children, style, tone = "light" }: { children: ReactNode; style: ViewStyle; tone?: "light" | "feature" }) {
  const { colors, styles } = useAppTheme();
  const blurTarget = useContext(GlassBlurTargetContext);
  const flattened = style;
  const {
    margin, marginHorizontal, marginVertical, marginTop, marginRight, marginBottom, marginLeft,
    shadowColor: _shadowColor, shadowOpacity: _shadowOpacity, shadowRadius: _shadowRadius, shadowOffset: _shadowOffset, elevation: _elevation,
    overflow: _overflow, backgroundColor: _backgroundColor, borderColor: _borderColor, borderWidth: _borderWidth,
    ...surfaceStyle
  } = flattened;
  const radius = surfaceStyle.borderRadius ?? 0;
  const androidBlurProps = Platform.OS === "android" ? { blurTarget: blurTarget ?? undefined, blurMethod: "dimezisBlurViewSdk31Plus" as const } : {};
  return (
    <View style={[styles.glassShell, { margin, marginHorizontal, marginVertical, marginTop, marginRight, marginBottom, marginLeft, borderRadius: radius, width: surfaceStyle.width, maxWidth: surfaceStyle.maxWidth, alignSelf: surfaceStyle.alignSelf, flex: surfaceStyle.flex, flexGrow: surfaceStyle.flexGrow, flexShrink: surfaceStyle.flexShrink }]}>
      <View style={[surfaceStyle, { margin: 0, marginHorizontal: 0, marginVertical: 0, marginTop: 0, marginRight: 0, marginBottom: 0, marginLeft: 0, backgroundColor: tone === "feature" ? colors.glassFeature : colors.glassSurface, borderColor: tone === "feature" ? colors.glassFeatureBorder : colors.glassBorder, borderWidth: 1, overflow: "hidden", borderRadius: radius }]}>
        <BlurView {...androidBlurProps} tint={tone === "feature" ? "dark" : "light"} intensity={tone === "feature" ? 32 : 48} style={StyleSheet.absoluteFill} />
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.glassShine, { borderRadius: radius }]} />
        {children}
      </View>
    </View>
  );
}

function friendlyImage(asset: ImagePicker.ImagePickerAsset): ImageSelection | null {
  const fileName = asset.fileName || asset.uri.split("/").pop() || "";
  const extension = fileName.split(".").pop()?.toLowerCase();
  const mimeType = (asset.mimeType?.toLowerCase() || ({
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
  } as Record<string, string>)[extension || ""] || "").replace("image/jpg", "image/jpeg");
  if (!SUPPORTED_IMAGE_TYPES.has(mimeType)) {
    Alert.alert("Unsupported photo", "Choose a JPEG, PNG, or WebP image.");
    return null;
  }
  if (asset.fileSize != null && asset.fileSize > MAX_IMAGE_BYTES) {
    Alert.alert("Photo is too large", "Choose an image smaller than 10 MB.");
    return null;
  }
  const safeExtension = mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
  return {
    uri: asset.uri,
    name: fileName || `snaplens-photo.${safeExtension}`,
    mimeType,
    size: asset.fileSize ?? null,
    base64: asset.base64 ?? null,
  };
}

function sourceHost(value: string): string {
  const safeUrl = safeCitationUrl(value);
  return safeUrl ? safeUrl.replace(/^https?:\/\//i, "").split("/")[0] : "Verified source";
}

function formatAnswerText(text: string, citations: DiagnosisResult["citations"]): string {
  if (!text) return "";
  // Map citations to 1-based index by their source_id
  const idMap = new Map<string, number>();
  citations.forEach((c, idx) => {
    idMap.set(c.source_id.toLowerCase(), idx + 1);
  });

  // Match UUID citation groups inside brackets e.g. [902a7988-987c-..., bbb1a22e-...]
  const uuidRegex = /\[\s*([0-9a-fA-F-]{36}(?:\s*,\s*[0-9a-fA-F-]{36})*)\s*\]/g;

  let cleaned = text.replace(uuidRegex, (_match, group: string) => {
    const rawIds = group.split(",").map((s) => s.trim().toLowerCase());
    const numbers = rawIds
      .map((id) => idMap.get(id))
      .filter((n): n is number => n !== undefined);

    if (numbers.length === 0) {
      return "";
    }
    const unique = Array.from(new Set(numbers)).sort((a, b) => a - b);
    return ` [${unique.join(", ")}]`;
  });

  cleaned = cleaned.replace(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g, "");
  return cleaned.replace(/\[\s*\]/g, "").replace(/ {2,}/g, " ").trim();
}

interface GuidanceStep {
  id: string;
  stepNumber: number;
  text: string;
}

interface ParsedGuidance {
  intro: string | null;
  steps: GuidanceStep[];
  conclusion: string | null;
}

function parseGuidanceContent(rawText: string, citations: DiagnosisResult["citations"]): ParsedGuidance {
  const cleaned = formatAnswerText(rawText, citations);
  if (!cleaned) return { intro: null, steps: [], conclusion: null };

  const lines = cleaned.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  const steps: GuidanceStep[] = [];
  const introLines: string[] = [];
  const conclusionLines: string[] = [];

  // Match numbered bullet lines like "1. ", "1) ", "Step 1: "
  const stepPattern = /^(?:(?:Step\s+)?(\d+)[\.\)]\s*|\-\s+)(.+)$/i;

  let hasStartedSteps = false;

  for (const line of lines) {
    const match = line.match(stepPattern);
    if (match) {
      hasStartedSteps = true;
      const num = match[1] ? parseInt(match[1], 10) : steps.length + 1;
      const body = match[2].trim();
      steps.push({
        id: `step-${steps.length + 1}`,
        stepNumber: isNaN(num) ? steps.length + 1 : num,
        text: body,
      });
    } else if (!hasStartedSteps) {
      introLines.push(line);
    } else {
      conclusionLines.push(line);
    }
  }

  // If no numbered steps were detected, treat the entire text as intro
  if (steps.length === 0) {
    return {
      intro: cleaned,
      steps: [],
      conclusion: null,
    };
  }

  return {
    intro: introLines.length > 0 ? introLines.join(" ") : null,
    steps,
    conclusion: conclusionLines.length > 0 ? conclusionLines.join(" ") : null,
  };
}

function PrimaryButton({
  label,
  onPress,
  disabled = false,
  busy = false,
  secondary = false,
  icon,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  secondary?: boolean;
  icon?: string;
}) {
  const { colors, styles } = useAppTheme();
  const useGlass = secondary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled, busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        secondary && styles.buttonSecondary,
        disabled && styles.buttonDisabled,
        pressed && !disabled && !busy && styles.buttonPressed,
      ]}
    >
      {useGlass ? <GlassBlur style={StyleSheet.absoluteFill} intensity={42} /> : null}
      {busy ? <ActivityIndicator color={colors.white} /> : icon ? <Text style={[styles.buttonIcon, secondary && styles.buttonIconSecondary]}>{icon}</Text> : null}
      <Text style={[styles.buttonText, secondary && styles.buttonTextSecondary]}>{label}</Text>
    </Pressable>
  );
}

function TabButton({
  label,
  icon,
  selected,
  onPress,
  prominent = false,
  disabled = false,
}: {
  label: string;
  icon: string;
  selected: boolean;
  onPress: () => void;
  prominent?: boolean;
  disabled?: boolean;
}) {
  const { styles } = useAppTheme();
  return (
    <Pressable accessibilityRole="tab" accessibilityState={{ selected, disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.tabButton, prominent && styles.tabButtonProminent, disabled && styles.tabButtonDisabled, pressed && styles.tabButtonPressed]}>
      <View style={[styles.tabIconWrap, selected && styles.tabIconWrapSelected, prominent && styles.tabIconProminent, prominent && selected && styles.tabIconProminentSelected]}>
        <Text style={[styles.tabIcon, selected && styles.tabIconSelected, prominent && styles.tabIconProminentText]}>{icon}</Text>
      </View>
      <Text style={[styles.tabLabel, selected && styles.tabLabelSelected]}>{label}</Text>
    </Pressable>
  );
}

export default function App() {
  const [themeId, setThemeId] = useState<ThemeId>("light");
  const theme = themeOptions.find((option) => option.id === themeId) ?? themeOptions[0];
  const colors = theme.colors;
  const styles = useMemo(() => createStyles(colors), [colors]);
  const themeContextValue = useMemo(() => ({ colors, styles }), [colors, styles]);
  const [activeTab, setActiveTab] = useState<Tab>("home");
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [diagnosisStep, setDiagnosisStep] = useState<DiagnosisStep>("photo");
  const [image, setImage] = useState<ImageSelection | null>(null);
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<DiagnosisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isPickingPhoto, setIsPickingPhoto] = useState(false);
  const [isQuestionFocused, setIsQuestionFocused] = useState(false);
  const questionInputRef = useRef<TextInput>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [completedStepIds, setCompletedStepIds] = useState<Record<string, boolean>>({});
  const [gatewayStatus, setGatewayStatus] = useState<"unchecked" | "checking" | "online" | "offline">("unchecked");
  const drawerProgress = useRef(new Animated.Value(0)).current;
  const screenOffset = useRef(new Animated.Value(0)).current;
  const blurTargetRef = useRef<View>(null);

  useEffect(() => {
    Animated.timing(drawerProgress, {
      toValue: drawerOpen ? 1 : 0,
      duration: drawerOpen ? 240 : 190,
      easing: drawerOpen ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [drawerOpen, drawerProgress]);

  useEffect(() => {
    if (!drawerOpen) return;
    const backSubscription = BackHandler.addEventListener("hardwareBackPress", () => {
      setDrawerOpen(false);
      return true;
    });
    return () => backSubscription.remove();
  }, [drawerOpen]);

  useEffect(() => {
    screenOffset.setValue(10);
    const transition = Animated.timing(screenOffset, { toValue: 0, duration: 180, easing: Easing.out(Easing.cubic), useNativeDriver: true });
    transition.start();
    return () => transition.stop();
  }, [activeTab, diagnosisStep, screenOffset]);

  const beginDiagnosis = () => {
    setActiveTab("diagnose");
    setError(null);
  };

  const navigateTo = (tab: Tab) => {
    Keyboard.dismiss();
    if (tab === "diagnose") {
      startNewDiagnosis();
    } else {
      setActiveTab(tab);
    }
    setDrawerOpen(false);
  };

  const checkGateway = async (): Promise<boolean> => {
    setGatewayStatus("checking");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(`${API_BASE_URL}/health/live`, { signal: controller.signal });
      const online = response.ok;
      setGatewayStatus(online ? "online" : "offline");
      return online;
    } catch {
      setGatewayStatus("offline");
      return false;
    } finally {
      clearTimeout(timeout);
    }
  };

  const startNewDiagnosis = () => {
    setImage(null);
    setQuestion("");
    setResult(null);
    setError(null);
    setCompletedStepIds({});
    setDiagnosisStep("photo");
    setActiveTab("diagnose");
  };

  const toggleStep = (stepId: string) => {
    setCompletedStepIds((prev) => ({ ...prev, [stepId]: !prev[stepId] }));
  };

  const shareGuidance = async () => {
    if (!result) return;
    try {
      const guidance = parseGuidanceContent(result.answer, result.citations);
      const textToShare = [
        "SnapLens AI Troubleshooting Guidance",
        guidance.intro ? `\nOverview:\n${guidance.intro}` : "",
        guidance.steps.length > 0 ? `\nSteps:\n${guidance.steps.map((s) => `${s.stepNumber}. ${s.text}`).join("\n")}` : `\n${result.answer}`,
        guidance.conclusion ? `\n\nNotes: ${guidance.conclusion}` : "",
        result.citations.length > 0 ? `\n\nSources:\n${result.citations.map((c, i) => `[${i + 1}] ${c.title} (${c.url})`).join("\n")}` : "",
      ].filter(Boolean).join("\n");
      await Share.share({
        message: textToShare,
        title: "SnapLens Troubleshooting Steps",
      });
    } catch {
      // User cancelled or dismissed share
    }
  };

  const chooseFromLibrary = async (): Promise<boolean> => {
    if (isPickingPhoto || isLoading) return false;
    setError(null);
    setIsPickingPhoto(true);
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert("Photo access needed", "Allow photo access to choose a troubleshooting image.");
        return false;
      }
      const selection = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        quality: 0.85,
        base64: true,
      });
      if (!selection.canceled && selection.assets[0]) {
        const next = friendlyImage(selection.assets[0]);
        if (next) {
          setImage(next);
          setResult(null);
          setDiagnosisStep("question");
          setActiveTab("diagnose");
          return true;
        }
      }
      return false;
    } catch {
      Alert.alert("Could not open your photos", "Please try again or use the camera instead.");
      return false;
    } finally {
      setIsPickingPhoto(false);
    }
  };

  const takePhoto = async (): Promise<boolean> => {
    if (isPickingPhoto || isLoading) return false;
    setError(null);
    setIsPickingPhoto(true);
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        Alert.alert("Camera access needed", "Allow camera access to take a troubleshooting photo.");
        return false;
      }
      const capture = await ImagePicker.launchCameraAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        quality: 0.85,
        base64: true,
      });
      if (!capture.canceled && capture.assets[0]) {
        const next = friendlyImage(capture.assets[0]);
        if (next) {
          setImage(next);
          setResult(null);
          setDiagnosisStep("question");
          setActiveTab("diagnose");
          return true;
        }
      }
      return false;
    } catch {
      Alert.alert("Could not open your camera", "Please check camera access and try again.");
      return false;
    } finally {
      setIsPickingPhoto(false);
    }
  };

  const submit = async () => {
    Keyboard.dismiss();
    const validationError = validateDiagnosisInput(question, image);
    if (validationError) {
      setError(validationError);
      return;
    }
    if (!image) return;
    setIsLoading(true);
    setError(null);
    setResult(null);
    try {
      const diagnosis = await createDiagnosis(question, image);
      setResult(diagnosis);
      setDiagnosisStep("result");
    } catch (caught) {
      console.error("[SnapLens Submit Caught]:", caught);
      const detail = caught instanceof Error ? caught.message : String(caught);
      setError(detail || "Something went wrong. Check your connection and try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const openSource = async (value: string) => {
    const url = safeCitationUrl(value);
    if (!url) {
      Alert.alert("Link unavailable", "This source link is not a valid web address.");
      return;
    }
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert("Could not open source", "Try opening this source from your browser.");
    }
  };

  const runVoiceDiagnosis = async (voiceQuestion: string): Promise<string> => {
    setActiveTab("diagnose");
    setDiagnosisStep("question");
    setQuestion(voiceQuestion);
    const validationError = validateDiagnosisInput(voiceQuestion, image);
    if (validationError || !image) {
      const message = validationError || "Choose a photo before starting a diagnosis.";
      setError(message);
      return message;
    }
    setIsLoading(true);
    setError(null);
    setResult(null);
    try {
      const diagnosis = await createDiagnosis(voiceQuestion, image);
      setResult(diagnosis);
      setDiagnosisStep("result");
      return `${diagnosis.answer}${diagnosis.citations.length ? ` The result includes ${diagnosis.citations.length} cited sources on screen.` : ""}`;
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "The diagnosis request failed. Check the Gateway and try again.";
      setError(message);
      return `SnapLens could not complete the diagnosis: ${message}`;
    } finally {
      setIsLoading(false);
    }
  };

  const openVoiceSource = async (sourceNumber: number): Promise<boolean> => {
    const citation = result?.citations[sourceNumber - 1];
    if (!citation) return false;
    const url = safeCitationUrl(citation.url);
    if (!url) return false;
    try {
      await Linking.openURL(url);
      return true;
    } catch {
      return false;
    }
  };

  const imageSizeLabel = image?.size == null ? "Ready to analyze" : `${(image.size / (1024 * 1024)).toFixed(1)} MB photo`;
  const selectedPrompt = (value: string) => {
    setQuestion(value);
    setError(null);
  };

  return (
    <ThemeContext.Provider value={themeContextValue}>
    <SafeAreaProvider>
      <SafeAreaView style={styles.app}>
        <GlassBlurTargetContext.Provider value={blurTargetRef}>
        <StatusBar barStyle="dark-content" backgroundColor={colors.background} />
        <BlurTargetView ref={blurTargetRef} pointerEvents="none" style={styles.blurTarget}>
          <View style={styles.ambientLayer}>
            <View style={styles.ambientBlue} />
            <View style={styles.ambientTeal} />
            <View style={styles.ambientSlate} />
          </View>
        </BlurTargetView>
        <KeyboardAvoidingView style={styles.appContent} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.topBar}>
          <Pressable accessibilityRole="button" accessibilityLabel="Open navigation menu" onPress={() => setDrawerOpen(true)} style={styles.menuButton}>
            <GlassBlur style={StyleSheet.absoluteFill} intensity={40} />
            
            <View style={styles.menuLine} /><View style={styles.menuLine} /><View style={[styles.menuLine, styles.menuLineShort]} />
          </Pressable>
          <View style={styles.brandIcon}><Text style={styles.brandIconText}>◎</Text></View>
          <View style={styles.brandCopy}>
            <Text style={styles.brandName}>SnapLens <Text style={styles.brandAI}>AI</Text></Text>
            <Text style={styles.brandCaption}>SEE IT. SOLVE IT.</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open voice assistant"
            accessibilityHint="Starts the hands-free SnapLens assistant"
            onPress={() => setVoiceOpen(true)}
            style={({ pressed }) => [styles.topMicButton, pressed && styles.buttonPressed]}
          >
            <VoiceMicIcon color={colors.blueDark} size={21} />
          </Pressable>
        </View>

        <Animated.View style={[styles.screenContent, { transform: [{ translateY: screenOffset }] }]}>
          {activeTab === "home" ? (
            <ScrollView contentContainerStyle={styles.pageContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <Text style={styles.greeting}>YOUR PERSONAL VISUAL ASSISTANT</Text>
              <Text style={styles.homeTitle}>What can we help{ "\n" }you figure out?</Text>
              <Text style={styles.homeIntro}>Get clear, practical guidance for the things you use every day.</Text>

              <GlassSurface style={styles.homeHero}>
                <View style={styles.heroTag}><Text style={styles.heroTagText}>SNAP  ·  ASK  ·  SOLVE</Text></View>
                <Text style={styles.homeHeroTitle}>Turn a confusing{ "\n" }moment into a clear next step.</Text>
                <Text style={styles.homeHeroBody}>Show us the device or error. We’ll help you understand what you’re seeing.</Text>
                <Pressable accessibilityRole="button" onPress={startNewDiagnosis} style={({ pressed }) => [styles.heroCta, pressed && styles.buttonPressed]}>
                  <Text style={styles.heroCtaText}>Start a diagnosis</Text>
                </Pressable>
              </GlassSurface>
              <Pressable accessibilityRole="button" onPress={() => setVoiceOpen(true)} style={styles.voiceHomeCta}>
                <GlassBlur style={StyleSheet.absoluteFill} intensity={30} />
                <Text style={styles.voiceHomeIcon}>◎</Text>
                <View style={styles.voiceHomeCopy}><Text style={styles.voiceHomeTitle}>Use SnapLens hands-free</Text><Text style={styles.voiceHomeHint}>Ask questions and control the app by voice</Text></View>
                <Text style={styles.voiceHomeArrow}>›</Text>
              </Pressable>

              <View style={styles.sectionTitleRow}>
                <Text style={styles.sectionTitle}>How it works</Text>
                <Text style={styles.sectionMeta}>3 simple steps</Text>
              </View>
              <GlassSurface style={styles.stepsCard}>
                <View style={styles.homeStep}>
                  <View style={[styles.homeStepIcon, styles.homeStepBlue]}><Text style={styles.homeStepIconText}>01</Text></View>
                  <View style={styles.homeStepCopy}><Text style={styles.homeStepTitle}>Take a clear photo</Text><Text style={styles.homeStepHint}>Capture the device or error message.</Text></View>
                  <Text style={styles.homeStepArrow}>›</Text>
                </View>
                <View style={styles.stepDivider} />
                <View style={styles.homeStep}>
                  <View style={[styles.homeStepIcon, styles.homeStepMint]}><Text style={styles.homeStepIconText}>02</Text></View>
                  <View style={styles.homeStepCopy}><Text style={styles.homeStepTitle}>Ask your question</Text><Text style={styles.homeStepHint}>Tell us what you want to understand.</Text></View>
                  <Text style={styles.homeStepArrow}>›</Text>
                </View>
                <View style={styles.stepDivider} />
                <View style={styles.homeStep}>
                  <View style={[styles.homeStepIcon, styles.homeStepGold]}><Text style={styles.homeStepIconText}>03</Text></View>
                  <View style={styles.homeStepCopy}><Text style={styles.homeStepTitle}>Explore the guidance</Text><Text style={styles.homeStepHint}>Review the answer and its sources.</Text></View>
                  <Text style={styles.homeStepArrow}>›</Text>
                </View>
              </GlassSurface>

              <Pressable accessibilityRole="button" onPress={() => setActiveTab("guide")} style={({ pressed }) => [styles.tipCardPressable, pressed && styles.cardPressed]}>
                <GlassSurface style={styles.tipCard}>
                  <View style={styles.tipIcon}><Text style={styles.tipIconText}>✦</Text></View>
                  <View style={styles.tipCopy}><Text style={styles.tipTitle}>Get better results</Text><Text style={styles.tipBody}>A few quick photo tips can make all the difference.</Text></View>
                  <Text style={styles.homeStepArrow}>›</Text>
                </GlassSurface>
              </Pressable>
            </ScrollView>
          ) : null}

          {activeTab === "guide" ? (
            <ScrollView contentContainerStyle={styles.pageContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <Text style={styles.greeting}>SNAPLENS FIELD GUIDE</Text>
              <Text style={styles.pageTitle}>A little prep goes a long way.</Text>
              <Text style={styles.pageIntro}>Use these tips to help SnapLens understand what you’re seeing.</Text>

              <GlassSurface style={styles.guideHero}><Text style={styles.guideHeroIcon}>◎</Text><Text style={styles.guideHeroTitle}>Make the important details easy to see.</Text><Text style={styles.guideHeroBody}>Good lighting and a steady photo help bring small labels and error codes into focus.</Text></GlassSurface>

              <Text style={styles.sectionTitle}>Photo checklist</Text>
              <GlassSurface style={styles.guideListCard}>
                {[
                  ["01", "Get close enough", "Keep the device and its screen in the frame."],
                  ["02", "Avoid glare", "Move to a brighter spot without harsh reflections."],
                  ["03", "Show the whole message", "Include all words, numbers, and indicator lights."],
                  ["04", "Keep it steady", "Pause for a moment so text stays sharp."],
                ].map(([number, title, description], index) => (
                  <View key={number}>
                    <View style={styles.guideRow}><View style={styles.guideNumber}><Text style={styles.guideNumberText}>{number}</Text></View><View style={styles.guideText}><Text style={styles.guideTitle}>{title}</Text><Text style={styles.guideBody}>{description}</Text></View></View>
                    {index < 3 ? <View style={styles.stepDivider} /> : null}
                  </View>
                ))}
              </GlassSurface>

              <GlassSurface style={styles.questionTip}>
                <Text style={styles.questionTipLabel}>GOOD QUESTIONS ARE SPECIFIC</Text>
                <Text style={styles.questionTipText}>“What does this paper jam message mean?” gives us more to work with than “Help.”</Text>
              </GlassSurface>
              <PrimaryButton label="Start a diagnosis" icon="＋" onPress={startNewDiagnosis} />
            </ScrollView>
          ) : null}

          {activeTab === "activity" ? (
            <ScrollView contentContainerStyle={styles.pageContent} showsVerticalScrollIndicator={false}>
              <Text style={styles.greeting}>YOUR SESSION</Text>
              <Text style={styles.pageTitle}>Recent activity</Text>
              <Text style={styles.pageIntro}>See the latest result from this app session. SnapLens doesn’t save a diagnosis history yet.</Text>
              {result ? (
                <Pressable accessibilityRole="button" onPress={() => { setDiagnosisStep("result"); setActiveTab("diagnose"); }} style={({ pressed }) => [styles.activityCardPressable, pressed && styles.cardPressed]}>
                  <GlassSurface style={styles.activityCard}>
                  <View style={styles.activityCardTop}><View style={styles.activityIcon}><Text style={styles.activityIconText}>✓</Text></View><View style={styles.activityCardHeading}><Text style={styles.activityCardTitle}>Latest diagnosis</Text><Text style={styles.activityCardMeta}>{result.status === "completed" ? "Guidance ready" : "More detail needed"}</Text></View><Text style={styles.homeStepArrow}>›</Text></View>
                  <Text style={styles.activityQuestion} numberOfLines={2}>{question || "Photo troubleshooting"}</Text>
                  <Text style={styles.activityAnswer} numberOfLines={3}>{result.answer}</Text>
                  <Text style={styles.activityLink}>View result  →</Text>
                  </GlassSurface>
                </Pressable>
              ) : (
                <GlassSurface style={styles.emptyStateCard}>
                  <View style={styles.emptyStateIcon}><Text style={styles.emptyStateIconText}>◷</Text></View>
                  <Text style={styles.emptyStateTitle}>Nothing here yet</Text>
                  <Text style={styles.emptyStateBody}>Complete a diagnosis and its latest result will appear here while the app is open.</Text>
                  <Text style={styles.emptyStateFootnote}>Saved history is planned for a later phase.</Text>
                </GlassSurface>
              )}
              <View style={styles.bottomAction}><PrimaryButton label="Start a diagnosis" icon="＋" onPress={startNewDiagnosis} /></View>
            </ScrollView>
          ) : null}

          {activeTab === "settings" ? (
            <ScrollView contentContainerStyle={styles.pageContent} showsVerticalScrollIndicator={false}>
              <Text style={styles.greeting}>PREFERENCES</Text>
              <Text style={styles.pageTitle}>Settings</Text>
              <Text style={styles.pageIntro}>Connection and privacy details for this SnapLens preview.</Text>

              <GlassSurface style={styles.settingsCard}>
                <Text style={styles.settingsEyebrow}>CONNECTION</Text>
                <View style={styles.settingsRow}>
                  <View style={styles.settingsIcon}><Text style={styles.settingsIconText}>↗</Text></View>
                  <View style={styles.settingsCopy}><Text style={styles.settingsTitle}>{gatewayStatus === "online" ? "Gateway is reachable" : gatewayStatus === "offline" ? "Gateway is not reachable" : "SnapLens Gateway"}</Text><Text style={styles.settingsBody} numberOfLines={2}>{API_BASE_URL}</Text></View>
                  <View style={[styles.statusDot, gatewayStatus === "online" && styles.statusDotOnline, gatewayStatus === "offline" && styles.statusDotOffline]} />
                </View>
                <PrimaryButton label={gatewayStatus === "checking" ? "Checking connection…" : "Check connection"} secondary busy={gatewayStatus === "checking"} onPress={() => void checkGateway()} />
                <Text style={styles.settingsHint}>This checks the Gateway health endpoint and does not use AI credits.</Text>
              </GlassSurface>

              <GlassSurface style={styles.settingsCard}>
                <Text style={styles.settingsEyebrow}>PHOTO PRIVACY</Text>
                <View style={styles.settingsRow}><View style={[styles.settingsIcon, styles.settingsIconMint]}><Text style={styles.settingsIconText}>◎</Text></View><View style={styles.settingsCopy}><Text style={styles.settingsTitle}>Used for this request</Text><Text style={styles.settingsBody}>Your selected photo is sent for analysis and isn’t saved to conversation history.</Text></View></View>
              </GlassSurface>

              <GlassSurface style={styles.settingsCard}>
                <Text style={styles.settingsEyebrow}>APPEARANCE</Text>
                <View style={styles.settingsRow}><View style={[styles.settingsIcon, styles.settingsIconSteel]}><Text style={styles.settingsIconText}>✧</Text></View><View style={styles.settingsCopy}><Text style={styles.settingsTitle}>Glass interface</Text><Text style={styles.settingsBody}>Choose a color mood; the glass surfaces and controls update across the app.</Text></View><Text style={styles.settingsValue}>{theme.name.toUpperCase()}</Text></View>
                <View style={styles.themeGrid}>
                  {themeOptions.map((option) => {
                    const selected = option.id === themeId;
                    return (
                      <Pressable
                        key={option.id}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        onPress={() => setThemeId(option.id)}
                        style={[styles.themeOption, selected && styles.themeOptionSelected]}
                      >
                        <View style={[styles.themeSwatch, { backgroundColor: option.colors.background, borderColor: option.colors.line }]}>
                          <View style={[styles.themeSwatchAccent, { backgroundColor: option.colors.blue }]} />
                          <View style={[styles.themeSwatchDot, { backgroundColor: option.colors.teal }]} />
                          <View style={[styles.themeSwatchGlass, { borderColor: option.colors.glassBorder }]} />
                        </View>
                        <View style={styles.themeOptionCopy}>
                          <Text style={[styles.themeOptionName, selected && styles.themeOptionNameSelected]}>{option.name}</Text>
                          <Text style={styles.themeOptionDescription}>{option.description}</Text>
                        </View>
                        {selected ? <View style={styles.themeCheck}><Text style={styles.themeCheckText}>✓</Text></View> : null}
                      </Pressable>
                    );
                  })}
                </View>
              </GlassSurface>
            </ScrollView>
          ) : null}

          {activeTab === "about" ? (
            <ScrollView contentContainerStyle={styles.pageContent} showsVerticalScrollIndicator={false}>
              <Text style={styles.greeting}>ABOUT THE PROJECT</Text>
              <Text style={styles.pageTitle}>SnapLens AI</Text>
              <Text style={styles.pageIntro}>See it. Solve it. Understand what your device is trying to tell you.</Text>

              <GlassSurface style={styles.aboutHero}>
                <View style={styles.aboutMark}><Text style={styles.aboutMarkText}>◎</Text></View>
                <Text style={styles.aboutHeroTitle}>Clear help starts with what you can see.</Text>
                <Text style={styles.aboutHeroBody}>SnapLens combines a photo, your question, and supporting sources to make everyday troubleshooting easier to follow.</Text>
              </GlassSurface>

              <Text style={styles.sectionTitle}>How a diagnosis works</Text>
              <GlassSurface style={styles.stepsCard}>
                {[["01", "Vision", "Reads the visible device and message."], ["02", "Research", "Finds relevant support information."], ["03", "Guidance", "Returns practical steps with sources."]].map(([number, title, description], index) => (
                  <View key={number}>
                    <View style={styles.homeStep}><View style={[styles.homeStepIcon, index === 1 ? styles.homeStepMint : styles.homeStepBlue]}><Text style={styles.homeStepIconText}>{number}</Text></View><View style={styles.homeStepCopy}><Text style={styles.homeStepTitle}>{title}</Text><Text style={styles.homeStepHint}>{description}</Text></View></View>
                    {index < 2 ? <View style={styles.stepDivider} /> : null}
                  </View>
                ))}
              </GlassSurface>

              <GlassSurface style={styles.questionTip}><Text style={styles.questionTipLabel}>EARLY PREVIEW</Text><Text style={styles.questionTipText}>AI guidance can be incomplete. Check important repairs against your device manual and a qualified technician.</Text></GlassSurface>
            </ScrollView>
          ) : null}

          {activeTab === "diagnose" ? (
            <ScrollView contentContainerStyle={styles.pageContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <View style={styles.flowTopline}>
          <Pressable accessibilityRole="button" onPress={() => {
                  if (diagnosisStep === "question") setDiagnosisStep("photo");
                  else if (diagnosisStep === "result") setDiagnosisStep("question");
                  else setActiveTab("home");
                }} style={styles.backButton}><GlassBlur style={StyleSheet.absoluteFill} intensity={42} /><Text style={styles.backArrow}>‹</Text></Pressable>
                <View style={styles.flowTopCopy}><Text style={styles.flowEyebrow}>NEW DIAGNOSIS</Text><Text style={styles.flowTitle}>{diagnosisStep === "photo" ? "Add a photo" : diagnosisStep === "question" ? "Tell us more" : "Your guidance"}</Text></View>
                <Text style={styles.flowCount}>{diagnosisStep === "photo" ? "01" : diagnosisStep === "question" ? "02" : "03"} / 03</Text>
              </View>
              <View style={styles.progressTrack}>
                <View style={[styles.progressSegment, styles.progressActive]} />
                <View style={[styles.progressSegment, diagnosisStep !== "photo" && styles.progressActive]} />
                <View style={[styles.progressSegment, diagnosisStep === "result" && styles.progressActive]} />
              </View>

              {diagnosisStep === "photo" ? (
                <View>
                  <Text style={styles.flowDescription}>Start with a clear photo of the device, label, or error you’re seeing.</Text>
                  {image ? (
                    <GlassSurface style={styles.selectedPhotoCard}>
                      <Image source={{ uri: image.uri }} style={styles.selectedPreview} resizeMode="cover" accessibilityLabel="Selected troubleshooting photo" />
                      <View style={styles.selectedMeta}><View style={styles.selectedMetaCopy}><Text style={styles.selectedName} numberOfLines={1}>{image.name}</Text><Text style={styles.selectedSize}>{imageSizeLabel}</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Remove selected photo" onPress={() => { setImage(null); setResult(null); }} style={styles.removeAction}><Text style={styles.removeText}>Remove</Text></Pressable></View>
                    </GlassSurface>
                  ) : (
                    <GlassSurface style={styles.uploadCard}>
                      <View style={styles.uploadIcon}><Text style={styles.uploadIconText}>⌗</Text></View>
                      <Text style={styles.uploadTitle}>Your photo will appear here</Text>
                      <Text style={styles.uploadBody}>Keep the device and any error message in focus.</Text>
                      <View style={styles.formatPill}><Text style={styles.formatText}>JPG  ·  PNG  ·  WEBP  ·  MAX 10 MB</Text></View>
                    </GlassSurface>
                  )}
                  <View style={styles.photoActions}>
                    <View style={styles.photoActionColumn}><PrimaryButton label="Take a photo" icon="◉" onPress={takePhoto} busy={isPickingPhoto} disabled={isLoading} /></View>
                    <View style={styles.photoActionColumn}><PrimaryButton label="Choose photo" icon="▧" onPress={chooseFromLibrary} secondary busy={isPickingPhoto} disabled={isLoading} /></View>
                  </View>
                  <GlassSurface style={styles.helperCard}><Text style={styles.helperIcon}>✦</Text><Text style={styles.helperText}>Tip: move closer if the error code is small.</Text><Pressable accessibilityRole="button" onPress={() => setActiveTab("guide")}><Text style={styles.helperLink}>Photo tips</Text></Pressable></GlassSurface>
                  <View style={styles.bottomAction}><PrimaryButton label="Continue to your question" onPress={() => { setError(null); setDiagnosisStep("question"); }} disabled={!image} /></View>
                </View>
              ) : null}

              {diagnosisStep === "question" ? (
                <View>
                  <Text style={styles.flowDescription}>What would you like help understanding about this photo?</Text>
                  {image ? <Pressable accessibilityRole="button" onPress={() => setDiagnosisStep("photo")} style={styles.miniPhotoCard}><Image source={{ uri: image.uri }} style={styles.miniPreview} resizeMode="cover" /><View style={styles.miniPhotoCopy}><Text style={styles.miniPhotoLabel}>PHOTO ADDED</Text><Text style={styles.miniPhotoName} numberOfLines={1}>{image.name}</Text></View><Text style={styles.editLink}>Edit</Text></Pressable> : null}
                  <Text style={styles.inputLabel}>PICK A STARTING QUESTION</Text>
                  <View style={styles.promptRow}>
                    {["What does this mean?", "How can I fix it?", "Is it safe to keep using?", "What should I check first?"].map((prompt) => (
                      <Pressable key={prompt} accessibilityRole="button" accessibilityState={{ selected: question === prompt }} onPress={() => { selectedPrompt(prompt); }} style={[styles.promptChip, question === prompt && styles.promptChipSelected]}><GlassBlur style={StyleSheet.absoluteFill} intensity={35} /><Text style={[styles.promptChipText, question === prompt && styles.promptChipTextSelected]}>{prompt}</Text></Pressable>
                    ))}
                  </View>
                  <Pressable
                    onPress={() => questionInputRef.current?.focus()}
                    style={[styles.inputCard, isQuestionFocused && styles.inputCardFocused]}
                  >
                    <GlassBlur style={StyleSheet.absoluteFill} intensity={38} />
                    <View pointerEvents="none" style={styles.inputCardTint} />
                    <Text style={styles.inputLabel}>YOUR QUESTION</Text>
                    <TextInput
                      ref={questionInputRef}
                      accessibilityLabel="Your troubleshooting question"
                      editable={!isLoading}
                      autoCapitalize="sentences"
                      autoCorrect
                      multiline
                      numberOfLines={5}
                      maxLength={MAX_QUESTION_CHARS}
                      onFocus={() => setIsQuestionFocused(true)}
                      onBlur={() => setIsQuestionFocused(false)}
                      onChangeText={(value) => { setQuestion(value); setError(null); }}
                      placeholder="For example: What does this blinking red light mean?"
                      placeholderTextColor="#929BAA"
                      returnKeyType="default"
                      underlineColorAndroid="transparent"
                      style={styles.questionInput}
                      textAlignVertical="top"
                      value={question}
                    />
                    <Text style={styles.charCount}>{question.length}/{MAX_QUESTION_CHARS.toLocaleString()}</Text>
                  </Pressable>
                  {error ? <View accessibilityRole="alert" style={styles.errorBox}><Text style={styles.errorTitle}>We couldn’t complete that request</Text><Text style={styles.errorText}>{error}</Text><Pressable accessibilityRole="button" onPress={submit} style={styles.retryButton}><Text style={styles.retryText}>Try again</Text></Pressable></View> : null}
                  <View style={styles.bottomAction}><PrimaryButton label={isLoading ? "Looking at your photo…" : "Get troubleshooting help"} busy={isLoading} onPress={submit} disabled={!image || !question.trim()} /></View>
                  <Text style={styles.privacyNote}>Your photo is used for this request and isn’t saved to conversation history.</Text>
                </View>
              ) : null}

              {diagnosisStep === "result" && result ? (() => {
                const guidance = parseGuidanceContent(result.answer, result.citations);
                const hasSteps = guidance.steps.length > 0;
                const completedCount = guidance.steps.filter((s) => completedStepIds[s.id]).length;

                return (
                  <View>
                    <View style={styles.resultIntro}>
                      <View style={styles.resultIcon}><Text style={styles.resultIconText}>✓</Text></View>
                      <View style={styles.resultIntroCopy}>
                        <Text style={styles.resultEyebrow}>{result.status === "completed" ? "ANALYSIS COMPLETE" : "ONE MORE DETAIL"}</Text>
                        <Text style={styles.resultTitle}>{result.status === "completed" ? "Here’s what we found" : "Let’s narrow it down"}</Text>
                      </View>
                      <Pressable accessibilityRole="button" accessibilityLabel="Share guidance" onPress={shareGuidance} style={styles.shareIconButton}>
                        <GlassBlur style={StyleSheet.absoluteFill} intensity={36} />
                        <Text style={styles.shareIconText}>↗</Text>
                      </Pressable>
                    </View>

                    {image ? (
                      <GlassSurface style={styles.resultContextCard}>
                        <Image source={{ uri: image.uri }} style={styles.resultThumbnail} resizeMode="cover" accessibilityLabel="Photo used for this diagnosis" />
                        <View style={styles.resultContextCopy}>
                          <Text style={styles.resultContextLabel}>YOUR QUESTION</Text>
                          <Text style={styles.resultQuestion} numberOfLines={2}>{question}</Text>
                        </View>
                      </GlassSurface>
                    ) : null}

                    {result.warnings.length > 0 ? (
                      <View style={styles.warningCard}>
                        <View style={styles.warningHeaderRow}>
                          <Text style={styles.warningAlertIcon}>⚠</Text>
                          <Text style={styles.warningHeading}>Safety & Pre-Checks</Text>
                        </View>
                        {result.warnings.map((warning, index) => (
                          <Text key={`${index}-${warning}`} style={styles.warningText}>•  {warning}</Text>
                        ))}
                      </View>
                    ) : null}

                    {guidance.intro ? (
                      <GlassSurface style={styles.introSummaryCard}>
                        <Text style={styles.introSummaryLabel}>OVERVIEW</Text>
                        <Text style={styles.introSummaryText}>{guidance.intro}</Text>
                      </GlassSurface>
                    ) : null}

                    {hasSteps ? (
                      <View style={styles.stepsSection}>
                        <View style={styles.stepsHeaderRow}>
                          <Text style={styles.stepsSectionTitle}>Troubleshooting Steps</Text>
                          <Text style={styles.stepsProgressLabel}>{completedCount}/{guidance.steps.length} done</Text>
                        </View>

                        {guidance.steps.map((step) => {
                          const isDone = Boolean(completedStepIds[step.id]);
                          return (
                            <Pressable
                              key={step.id}
                              accessibilityRole="checkbox"
                              accessibilityState={{ checked: isDone }}
                              onPress={() => toggleStep(step.id)}
                              style={({ pressed }) => [
                                styles.stepCard,
                                isDone && styles.stepCardDone,
                                pressed && styles.stepCardPressed,
                              ]}
                            >
                              <GlassBlur style={StyleSheet.absoluteFill} intensity={32} />
                              <View style={[styles.stepCheckbox, isDone && styles.stepCheckboxDone]}>
                                <Text style={[styles.stepCheckboxText, isDone && styles.stepCheckboxTextDone]}>
                                  {isDone ? "✓" : String(step.stepNumber)}
                                </Text>
                              </View>
                              <View style={styles.stepContent}>
                                <Text style={[styles.stepInstructionText, isDone && styles.stepInstructionDone]}>
                                  {step.text}
                                </Text>
                              </View>
                            </Pressable>
                          );
                        })}
                      </View>
                    ) : (
                      <GlassSurface style={styles.answerCard}>
                        <Text style={styles.answerLabel}>SNAPLENS GUIDANCE</Text>
                        <Text style={styles.answerText}>{formatAnswerText(result.answer, result.citations)}</Text>
                      </GlassSurface>
                    )}

                    {guidance.conclusion ? (
                      <GlassSurface style={styles.conclusionCard}>
                        <Text style={styles.conclusionText}>{guidance.conclusion}</Text>
                      </GlassSurface>
                    ) : null}

                    <View style={styles.sourcesHeader}>
                      <Text style={styles.sectionTitle}>Sources</Text>
                      <Text style={styles.sectionMeta}>{result.citations.length} references</Text>
                    </View>

                    {result.citations.length > 0 ? result.citations.map((citation, index) => (
                      <Pressable accessibilityRole="link" key={citation.source_id} onPress={() => void openSource(citation.url)} style={({ pressed }) => [styles.sourceCard, pressed && styles.sourcePressed]}>
                        <GlassBlur style={StyleSheet.absoluteFill} intensity={38} />
                        <View style={styles.sourceIndexBadge}><Text style={styles.sourceIndexBadgeText}>[{index + 1}]</Text></View>
                        <View style={styles.sourceCopy}>
                          <Text style={styles.sourceTitle} numberOfLines={2}>{citation.title}</Text>
                          <Text style={styles.sourcePublisher} numberOfLines={1}>{citation.publisher || sourceHost(citation.url)}</Text>
                          {citation.snippet ? <Text style={styles.sourceSnippet} numberOfLines={2}>{citation.snippet}</Text> : null}
                        </View>
                        <Text style={styles.sourceChevron}>›</Text>
                      </Pressable>
                    )) : (
                      <View style={styles.noSources}>
                        <Text style={styles.noSourcesTitle}>No verified sources found</Text>
                        <Text style={styles.noSourcesText}>Treat this guidance as a starting point and check your device manual before repairs.</Text>
                      </View>
                    )}

                    <View style={styles.bottomActionRow}>
                      <View style={styles.bottomActionFlex}>
                        <PrimaryButton label="Start new diagnosis" icon="＋" onPress={startNewDiagnosis} />
                      </View>
                      <Pressable accessibilityRole="button" accessibilityLabel="Share guidance" onPress={shareGuidance} style={styles.shareBottomButton}>
                        <GlassBlur style={StyleSheet.absoluteFill} intensity={38} />
                        <Text style={styles.shareBottomIcon}>↗</Text>
                        <Text style={styles.shareBottomText}>Share</Text>
                      </Pressable>
                    </View>
                  </View>
                );
              })() : null}
            </ScrollView>
          ) : null}
        </Animated.View>

        <View style={styles.tabBar}>
          <GlassBlur style={StyleSheet.absoluteFill} intensity={42} />
          <View pointerEvents="none" style={styles.tabBarTint} />
          <TabButton label="Home" icon="⌂" selected={activeTab === "home"} onPress={() => setActiveTab("home")} disabled={isLoading || isPickingPhoto} />
          <TabButton label="Diagnose" icon="＋" selected={activeTab === "diagnose"} onPress={beginDiagnosis} prominent disabled={isLoading || isPickingPhoto} />
          <TabButton label="Guide" icon="✧" selected={activeTab === "guide"} onPress={() => setActiveTab("guide")} disabled={isLoading || isPickingPhoto} />
        </View>
        </KeyboardAvoidingView>

        <Animated.View pointerEvents={drawerOpen ? "auto" : "none"} style={[styles.drawerLayer, { opacity: drawerProgress }]}>
          <Pressable accessibilityRole="button" accessibilityLabel="Close navigation menu" onPress={() => setDrawerOpen(false)} style={styles.drawerScrim} />
          <Animated.View style={[styles.drawerPanel, { transform: [{ translateX: drawerProgress.interpolate({ inputRange: [0, 1], outputRange: [-330, 0] }) }] }]}>
            <GlassBlur style={styles.drawerBlur} intensity={58} />
            <View pointerEvents="none" style={styles.drawerTint} />
            
            <View style={styles.drawerHeader}>
              <View style={styles.drawerBrandMark}><Text style={styles.drawerBrandMarkText}>◎</Text></View>
              <View style={styles.drawerBrandCopy}><Text style={styles.drawerBrandName}>SnapLens <Text style={styles.brandAI}>AI</Text></Text><Text style={styles.drawerBrandCaption}>YOUR VISUAL ASSISTANT</Text></View>
              <Pressable accessibilityRole="button" accessibilityLabel="Close navigation menu" onPress={() => setDrawerOpen(false)} style={styles.drawerClose}><GlassBlur style={StyleSheet.absoluteFill} intensity={34} /><Text style={styles.drawerCloseText}>×</Text></Pressable>
            </View>

            <ScrollView style={styles.drawerScroll} contentContainerStyle={styles.drawerContent} showsVerticalScrollIndicator={false}>
              <Text style={styles.drawerSectionLabel}>WORKSPACE</Text>
              {([
                ["home", "⌂", "Home", "Your dashboard"],
                ["diagnose", "＋", "New diagnosis", "Capture · ask · solve"],
                ["activity", "◷", "Recent activity", "This session"],
                ["guide", "✧", "Field guide", "Photo and question tips"],
              ] as [Tab, string, string, string][]).map(([tab, icon, label, hint]) => (
                <Pressable key={tab} accessibilityRole="button" accessibilityState={{ selected: activeTab === tab }} onPress={() => navigateTo(tab)} style={({ pressed }) => [styles.drawerItem, activeTab === tab && styles.drawerItemSelected, pressed && styles.drawerItemPressed]}>
                  <GlassBlur style={StyleSheet.absoluteFill} intensity={26} />
                  <View style={[styles.drawerItemIcon, activeTab === tab && styles.drawerItemIconSelected]}><Text style={[styles.drawerItemIconText, activeTab === tab && styles.drawerItemIconTextSelected]}>{icon}</Text></View>
                  <View style={styles.drawerItemCopy}><Text style={[styles.drawerItemTitle, activeTab === tab && styles.drawerItemTitleSelected]}>{label}</Text><Text style={styles.drawerItemHint}>{hint}</Text></View>
                  {activeTab === tab ? <View style={styles.drawerActiveMark} /> : null}
                </Pressable>
              ))}

              <Text style={[styles.drawerSectionLabel, styles.drawerSectionSpaced]}>APP</Text>
              <Pressable accessibilityRole="button" onPress={() => { setDrawerOpen(false); setVoiceOpen(true); }} style={({ pressed }) => [styles.drawerItem, pressed && styles.drawerItemPressed]}>
                <GlassBlur style={StyleSheet.absoluteFill} intensity={26} />
                <View style={styles.drawerItemIcon}><Text style={styles.drawerItemIconText}>◎</Text></View>
                <View style={styles.drawerItemCopy}><Text style={styles.drawerItemTitle}>Voice assistant</Text><Text style={styles.drawerItemHint}>Hands-free app control</Text></View>
              </Pressable>
              {([
                ["settings", "⚙", "Settings", "Connection and privacy"],
                ["about", "ⓘ", "About SnapLens", "Project information"],
              ] as [Tab, string, string, string][]).map(([tab, icon, label, hint]) => (
                <Pressable key={tab} accessibilityRole="button" accessibilityState={{ selected: activeTab === tab }} onPress={() => navigateTo(tab)} style={({ pressed }) => [styles.drawerItem, activeTab === tab && styles.drawerItemSelected, pressed && styles.drawerItemPressed]}>
                  <GlassBlur style={StyleSheet.absoluteFill} intensity={26} />
                  <View style={[styles.drawerItemIcon, activeTab === tab && styles.drawerItemIconSelected]}><Text style={[styles.drawerItemIconText, activeTab === tab && styles.drawerItemIconTextSelected]}>{icon}</Text></View>
                  <View style={styles.drawerItemCopy}><Text style={[styles.drawerItemTitle, activeTab === tab && styles.drawerItemTitleSelected]}>{label}</Text><Text style={styles.drawerItemHint}>{hint}</Text></View>
                  {activeTab === tab ? <View style={styles.drawerActiveMark} /> : null}
                </Pressable>
              ))}
            </ScrollView>

            <GlassSurface style={styles.drawerFooter}><View style={styles.drawerFooterDot} /><View style={styles.drawerFooterCopy}><Text style={styles.drawerFooterTitle}>Photo-first troubleshooting</Text><Text style={styles.drawerFooterHint}>Simple guidance, with sources.</Text></View></GlassSurface>
          </Animated.View>
        </Animated.View>
        {isLoading ? (
          <View style={styles.loadingOverlay} accessibilityViewIsModal>
            <View style={styles.loadingScrim} />
            <GlassSurface style={styles.loadingCard}>
              <View style={styles.loadingIcon}><ActivityIndicator size="large" color={colors.blue} /></View>
              <Text style={styles.loadingEyebrow}>SNAPLENS IS WORKING</Text>
              <Text style={styles.loadingTitle}>Analyzing your photo</Text>
              <Text style={styles.loadingBody}>We’re checking the visible details and preparing troubleshooting guidance.</Text>
              <Text style={styles.loadingHint}>This can take a few seconds.</Text>
            </GlassSurface>
          </View>
        ) : null}
        {voiceOpen ? (
          <VoiceAssistant
            visible={voiceOpen}
            apiBaseUrl={API_BASE_URL}
            currentScreen={activeTab as VoiceScreen}
            currentTheme={themeId as VoiceTheme}
            currentQuestion={question}
            hasPhoto={Boolean(image)}
            hasDiagnosis={Boolean(result)}
            colors={colors}
            onClose={() => setVoiceOpen(false)}
            onNavigate={(screen) => setActiveTab(screen as Tab)}
            onStartNewDiagnosis={startNewDiagnosis}
            onCheckGateway={checkGateway}
            onSetTheme={(selectedTheme) => setThemeId(selectedTheme as ThemeId)}
            onTakePhoto={takePhoto}
            onChoosePhoto={chooseFromLibrary}
            onRunDiagnosis={runVoiceDiagnosis}
            onOpenSource={openVoiceSource}
          />
        ) : null}
        </GlassBlurTargetContext.Provider>
      </SafeAreaView>
    </SafeAreaProvider>
    </ThemeContext.Provider>
  );
}

function createStyles(colors: ThemeColors) {
return StyleSheet.create({
  ambientLayer: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, overflow: "hidden" },
  blurTarget: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 },
  ambientBlue: { position: "absolute", width: 310, height: 310, borderRadius: 155, top: 55, right: -175, backgroundColor: colors.blueTint },
  ambientTeal: { position: "absolute", width: 285, height: 285, borderRadius: 143, top: 360, left: -185, backgroundColor: colors.tealTint },
  ambientSlate: { position: "absolute", width: 260, height: 260, borderRadius: 130, bottom: 80, right: -150, backgroundColor: colors.blueTint },
  app: { flex: 1, backgroundColor: colors.background },
  appContent: { flex: 1, zIndex: 1 },
  glassShell: { overflow: "visible", backgroundColor: "transparent", shadowColor: colors.navy, shadowOpacity: 0.15, shadowRadius: 14, shadowOffset: { width: 0, height: 7 }, elevation: 4 },
  glassShine: { backgroundColor: "rgba(255,255,255,0.045)", borderTopWidth: 1, borderLeftWidth: 1, borderTopColor: "rgba(255,255,255,0.94)", borderLeftColor: "rgba(255,255,255,0.72)" },
  topBar: { minHeight: 59, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", backgroundColor: colors.background },
  menuButton: { width: 38, height: 38, borderRadius: 13, marginRight: 8, alignItems: "center", justifyContent: "center", backgroundColor: colors.glassSurface, borderWidth: 1, borderColor: colors.glassBorder, overflow: "hidden" },
  menuLine: { width: 15, height: 2, borderRadius: 2, backgroundColor: colors.navy, marginVertical: 1.5 },
  menuLineShort: { width: 10, alignSelf: "flex-start", marginLeft: 10 },
  brandCopy: { marginLeft: 10, flex: 1 },
  brandName: { color: colors.ink, fontWeight: "900", fontSize: 16, letterSpacing: -0.4 },
  brandAI: { color: colors.blue, fontWeight: "800" },
  brandCaption: { color: colors.muted, fontSize: 9, fontWeight: "800", letterSpacing: 1.5, marginTop: 3 },
  brandIcon: { width: 40, height: 40, borderRadius: 14, backgroundColor: colors.blue, alignItems: "center", justifyContent: "center", shadowColor: colors.blueDark, shadowOpacity: 0.2, shadowRadius: 5, shadowOffset: { width: 2, height: 3 }, elevation: 3 },
  brandIconText: { color: colors.white, fontSize: 25, lineHeight: 30, fontWeight: "700" },
  topMicButton: { width: 42, height: 42, borderRadius: 15, backgroundColor: colors.glassSurface, borderWidth: 1, borderColor: colors.glassBorder, alignItems: "center", justifyContent: "center", shadowColor: colors.navy, shadowOpacity: 0.08, shadowRadius: 7, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  screenContent: { flex: 1 },
  pageContent: { paddingHorizontal: 20, paddingTop: 13, paddingBottom: 28, maxWidth: 720, width: "100%", alignSelf: "center" },
  greeting: { color: colors.blue, fontSize: 9, fontWeight: "900", letterSpacing: 1.55, marginTop: 6 },
  homeTitle: { color: colors.ink, fontSize: 29, lineHeight: 34, fontWeight: "900", letterSpacing: -0.9, marginTop: 10 },
  homeIntro: { color: colors.muted, fontSize: 13, lineHeight: 20, marginTop: 8, maxWidth: 320 },
  voiceHomeCta: { minHeight: 72, borderWidth: 1, borderColor: colors.glassBorder, borderRadius: 18, backgroundColor: colors.glassSurface, flexDirection: "row", alignItems: "center", paddingHorizontal: 14, marginTop: 13, overflow: "hidden", shadowColor: colors.navy, shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  voiceHomeIcon: { width: 40, height: 40, borderRadius: 14, backgroundColor: colors.blueTint, color: colors.blueDark, textAlign: "center", textAlignVertical: "center", fontSize: 25, fontWeight: "800", overflow: "hidden" },
  voiceHomeCopy: { flex: 1, marginLeft: 12 },
  voiceHomeTitle: { color: colors.ink, fontSize: 12, fontWeight: "900" },
  voiceHomeHint: { color: colors.muted, fontSize: 9, marginTop: 4 },
  voiceHomeArrow: { color: colors.blueDark, fontSize: 24, marginLeft: 8 },
  homeHero: { backgroundColor: colors.canvas, borderWidth: 1, borderColor: colors.line, borderRadius: 22, padding: 20, marginTop: 20, minHeight: 237 },
  heroTag: { alignSelf: "flex-start", backgroundColor: colors.glassSurface, borderWidth: 1, borderColor: colors.line, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7 },
  heroTagText: { color: colors.blueDark, fontSize: 8, fontWeight: "900", letterSpacing: 1.05 },
  homeHeroTitle: { color: colors.ink, fontSize: 21, lineHeight: 26, fontWeight: "900", letterSpacing: -0.4, marginTop: 17 },
  homeHeroBody: { color: colors.muted, fontSize: 11, lineHeight: 17, marginTop: 8, maxWidth: 280 },
  heroCta: { minHeight: 42, borderRadius: 13, paddingHorizontal: 13, marginTop: 16, backgroundColor: colors.blue, alignSelf: "flex-start", flexDirection: "row", alignItems: "center" },
  heroCtaText: { color: colors.white, fontSize: 12, fontWeight: "900" },
  sectionTitleRow: { flexDirection: "row", alignItems: "baseline", marginTop: 24, marginBottom: 11 },
  sectionTitle: { color: colors.ink, flex: 1, fontSize: 15, fontWeight: "900", letterSpacing: -0.2 },
  sectionMeta: { color: colors.muted, fontSize: 10, fontWeight: "700" },
  stepsCard: { backgroundColor: colors.canvas, borderWidth: 1, borderColor: colors.line, borderRadius: 20, paddingHorizontal: 13 },
  homeStep: { minHeight: 63, flexDirection: "row", alignItems: "center" },
  homeStepIcon: { width: 34, height: 34, borderRadius: 12, alignItems: "center", justifyContent: "center", marginRight: 11 },
  homeStepBlue: { backgroundColor: colors.blueTint },
  homeStepMint: { backgroundColor: colors.tealTint },
  homeStepGold: { backgroundColor: colors.amber },
  homeStepIconText: { color: colors.navy, fontSize: 9, fontWeight: "900" },
  homeStepCopy: { flex: 1 },
  homeStepTitle: { color: colors.ink, fontSize: 11, fontWeight: "800" },
  homeStepHint: { color: colors.muted, fontSize: 9, marginTop: 4 },
  homeStepArrow: { color: "#A4ADBC", fontSize: 23, marginLeft: 8 },
  stepDivider: { height: 1, backgroundColor: colors.line, marginLeft: 45 },
  tipCardPressable: { borderRadius: 18, marginTop: 12 },
  tipCard: { backgroundColor: colors.canvas, borderRadius: 18, padding: 13, borderWidth: 1, borderColor: colors.line, flexDirection: "row", alignItems: "center" },
  tipIcon: { width: 32, height: 32, borderRadius: 11, backgroundColor: colors.amber, alignItems: "center", justifyContent: "center", marginRight: 10 },
  tipIconText: { color: colors.blueDark, fontSize: 16 },
  tipCopy: { flex: 1 },
  tipTitle: { color: colors.ink, fontSize: 12, fontWeight: "900" },
  tipBody: { color: colors.muted, fontSize: 10, lineHeight: 15, marginTop: 4 },
  pageTitle: { color: colors.ink, fontSize: 28, lineHeight: 34, fontWeight: "900", letterSpacing: -0.8, marginTop: 10 },
  pageIntro: { color: colors.muted, fontSize: 13, lineHeight: 20, marginTop: 9, marginBottom: 21 },
  guideHero: { borderRadius: 22, backgroundColor: colors.canvas, borderWidth: 1, borderColor: colors.line, padding: 19, marginBottom: 22 },
  guideHeroIcon: { color: colors.blue, fontSize: 35, lineHeight: 42 },
  guideHeroTitle: { color: colors.ink, fontSize: 16, lineHeight: 21, fontWeight: "900", marginTop: 12 },
  guideHeroBody: { color: colors.muted, fontSize: 11, lineHeight: 17, marginTop: 7 },
  guideListCard: { borderRadius: 19, backgroundColor: colors.canvas, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 13, marginTop: 11, marginBottom: 15 },
  guideRow: { flexDirection: "row", alignItems: "center", minHeight: 64 },
  guideNumber: { width: 30, height: 30, borderRadius: 10, backgroundColor: colors.blueTint, alignItems: "center", justifyContent: "center", marginRight: 10 },
  guideNumberText: { color: colors.blueDark, fontSize: 8, fontWeight: "900" },
  guideText: { flex: 1 },
  guideTitle: { color: colors.ink, fontSize: 12, fontWeight: "800" },
  guideBody: { color: colors.muted, fontSize: 10, lineHeight: 15, marginTop: 4 },
  questionTip: { backgroundColor: colors.canvas, borderColor: colors.line, borderWidth: 1, borderRadius: 16, padding: 14, marginBottom: 14 },
  questionTipLabel: { color: colors.blueDark, fontSize: 8, fontWeight: "900", letterSpacing: 1.2 },
  questionTipText: { color: colors.ink, fontSize: 11, lineHeight: 17, marginTop: 7 },
  flowTopline: { flexDirection: "row", alignItems: "center", marginTop: 5 },
  backButton: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.glassSurface, borderWidth: 1, borderColor: colors.glassBorder, alignItems: "center", justifyContent: "center", marginRight: 10, overflow: "hidden" },
  backArrow: { color: colors.ink, fontSize: 25, lineHeight: 28, marginTop: -3 },
  flowTopCopy: { flex: 1 },
  flowEyebrow: { color: colors.blueDark, fontSize: 8, fontWeight: "900", letterSpacing: 1.25 },
  flowTitle: { color: colors.ink, fontSize: 16, fontWeight: "900", marginTop: 3 },
  flowCount: { color: colors.muted, fontSize: 9, fontWeight: "900", letterSpacing: 0.7 },
  progressTrack: { flexDirection: "row", gap: 5, marginTop: 15, marginBottom: 15 },
  progressSegment: { flex: 1, height: 5, borderRadius: 4, backgroundColor: colors.line, shadowColor: colors.white, shadowOpacity: 0.7, shadowRadius: 2, shadowOffset: { width: -1, height: -1 } },
  progressActive: { backgroundColor: colors.blue },
  flowDescription: { color: colors.muted, fontSize: 13, lineHeight: 20, marginBottom: 16 },
  uploadCard: { minHeight: 190, borderRadius: 22, backgroundColor: colors.canvas, borderWidth: 1, borderColor: colors.line, borderStyle: "dashed", alignItems: "center", justifyContent: "center", padding: 18 },
  uploadIcon: { width: 49, height: 49, borderRadius: 17, backgroundColor: colors.blueTint, alignItems: "center", justifyContent: "center", marginBottom: 11 },
  uploadIconText: { color: colors.blue, fontSize: 27, lineHeight: 31, fontWeight: "700" },
  uploadTitle: { color: colors.ink, fontSize: 14, fontWeight: "900" },
  uploadBody: { color: colors.muted, fontSize: 11, lineHeight: 16, textAlign: "center", marginTop: 6 },
  formatPill: { backgroundColor: colors.glassSurface, borderWidth: 1, borderColor: colors.glassBorder, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 6, marginTop: 12 },
  formatText: { color: colors.muted, fontSize: 7, fontWeight: "900", letterSpacing: 0.7 },
  selectedPhotoCard: { borderRadius: 21, backgroundColor: colors.canvas, borderWidth: 1, borderColor: colors.line },
  selectedPreview: { width: "100%", height: 205, backgroundColor: colors.soft },
  selectedMeta: { paddingHorizontal: 13, paddingVertical: 11, flexDirection: "row", alignItems: "center" },
  selectedMetaCopy: { flex: 1 },
  selectedName: { color: colors.ink, fontSize: 11, fontWeight: "800" },
  selectedSize: { color: colors.muted, fontSize: 9, marginTop: 3 },
  removeAction: { minWidth: 54, minHeight: 44, alignItems: "center", justifyContent: "center", marginRight: -6 },
  removeText: { color: colors.red, fontSize: 10, fontWeight: "800", paddingHorizontal: 7 },
  photoActions: { flexDirection: "row", gap: 9, marginTop: 10 },
  photoActionColumn: { flex: 1 },
  button: { minHeight: 50, borderRadius: 14, paddingHorizontal: 13, backgroundColor: colors.blue, flexDirection: "row", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.blueDark, gap: 8, shadowColor: colors.blueDark, shadowOpacity: 0.18, shadowRadius: 6, shadowOffset: { width: 0, height: 3 }, elevation: 3, overflow: "hidden" },
  buttonSecondary: { backgroundColor: colors.glassSurface, borderColor: colors.glassBorder, shadowColor: colors.navy, shadowOpacity: 0.1, shadowRadius: 6, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  buttonDisabled: { backgroundColor: colors.muted, borderColor: colors.muted, shadowOpacity: 0.08, elevation: 1 },
  buttonPressed: { opacity: 0.83, transform: [{ scale: 0.985 }] },
  buttonIcon: { color: colors.white, fontSize: 15, fontWeight: "800" },
  buttonIconSecondary: { color: colors.blue },
  buttonText: { color: colors.white, fontSize: 12, fontWeight: "900", textAlign: "center", flexShrink: 1 },
  buttonTextSecondary: { color: colors.ink },
  helperCard: { borderRadius: 13, backgroundColor: colors.canvas, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 11, paddingVertical: 10, marginTop: 12, flexDirection: "row", alignItems: "center" },
  helperIcon: { color: colors.teal, fontSize: 13, marginRight: 7 },
  helperText: { flex: 1, color: colors.ink, fontSize: 9, lineHeight: 14 },
  helperLink: { color: colors.blueDark, fontSize: 9, fontWeight: "900", marginLeft: 5 },
  bottomAction: { marginTop: 17 },
  miniPhotoCard: { flexDirection: "row", alignItems: "center", backgroundColor: colors.canvas, borderWidth: 1, borderColor: colors.line, borderRadius: 15, padding: 7, marginBottom: 19, shadowColor: colors.navy, shadowOpacity: 0.16, shadowRadius: 8, shadowOffset: { width: 4, height: 4 }, elevation: 2 },
  miniPreview: { width: 48, height: 48, borderRadius: 10, backgroundColor: colors.soft },
  miniPhotoCopy: { flex: 1, marginLeft: 10 },
  miniPhotoLabel: { color: colors.teal, fontSize: 8, fontWeight: "900", letterSpacing: 0.9 },
  miniPhotoName: { color: colors.ink, fontSize: 10, fontWeight: "700", marginTop: 4 },
  editLink: { color: colors.blueDark, fontSize: 10, fontWeight: "900", paddingHorizontal: 9 },
  inputLabel: { color: colors.muted, fontSize: 8, fontWeight: "900", letterSpacing: 1.05, marginBottom: 8 },
  promptRow: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginBottom: 11 },
  promptChip: { minHeight: 44, justifyContent: "center", backgroundColor: colors.glassSurface, borderWidth: 1, borderColor: colors.glassBorder, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10, overflow: "hidden" },
  promptChipSelected: { backgroundColor: colors.blueTint, borderColor: colors.blue },
  promptChipText: { color: colors.navy, fontSize: 9, fontWeight: "800" },
  promptChipTextSelected: { color: colors.blueDark },
  inputCard: { backgroundColor: colors.glassSurface, borderWidth: 1, borderColor: colors.glassBorder, borderRadius: 16, paddingHorizontal: 13, paddingTop: 12, paddingBottom: 9, overflow: "hidden", shadowColor: colors.navy, shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 1 },
  inputCardTint: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: colors.glassSurface },
  inputCardFocused: { borderColor: colors.blue, shadowColor: colors.blue, shadowOpacity: 0.22, shadowRadius: 9, shadowOffset: { width: 0, height: 0 }, elevation: 2 },
  questionInput: { minHeight: 140, width: "100%", color: colors.ink, backgroundColor: "transparent", fontSize: 16, lineHeight: 23, padding: 8, textAlignVertical: "top" },
  charCount: { alignSelf: "flex-end", color: colors.muted, fontSize: 9, marginTop: 5 },
  errorBox: { backgroundColor: colors.redTint, borderColor: "#F1C9C7", borderWidth: 1, padding: 13, marginTop: 12, borderRadius: 15 },
  errorTitle: { color: colors.red, fontWeight: "900", fontSize: 11 },
  errorText: { color: "#753D40", fontSize: 10, lineHeight: 16, marginTop: 4 },
  retryButton: { alignSelf: "flex-start", paddingTop: 8 },
  retryText: { color: colors.red, fontSize: 10, fontWeight: "900", textDecorationLine: "underline" },
  privacyNote: { color: colors.muted, textAlign: "center", fontSize: 9, lineHeight: 14, marginTop: 9, paddingHorizontal: 13 },
  resultIntro: { flexDirection: "row", alignItems: "center", marginTop: 4, marginBottom: 14 },
  resultIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: colors.tealTint, alignItems: "center", justifyContent: "center", marginRight: 11 },
  resultIconText: { color: colors.teal, fontSize: 20, fontWeight: "900" },
  resultIntroCopy: { flex: 1 },
  resultEyebrow: { color: colors.teal, fontSize: 9, fontWeight: "900", letterSpacing: 1.2 },
  resultTitle: { color: colors.ink, fontSize: 17, fontWeight: "900", marginTop: 3 },
  shareIconButton: { width: 38, height: 38, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.40)", borderWidth: 1, borderColor: "rgba(255,255,255,0.92)", alignItems: "center", justifyContent: "center", overflow: "hidden" },
  shareIconText: { color: colors.blueDark, fontSize: 17, fontWeight: "900" },
  resultContextCard: { flexDirection: "row", alignItems: "center", backgroundColor: colors.canvas, borderWidth: 1, borderColor: colors.line, borderRadius: 16, padding: 9, marginBottom: 13 },
  resultThumbnail: { width: 52, height: 52, borderRadius: 11, backgroundColor: colors.soft },
  resultContextCopy: { flex: 1, marginLeft: 11 },
  resultContextLabel: { color: colors.muted, fontSize: 8, fontWeight: "900", letterSpacing: 0.9 },
  resultQuestion: { color: colors.ink, fontSize: 12, lineHeight: 17, fontWeight: "700", marginTop: 3 },
  warningCard: { backgroundColor: "#FFF7E6", borderWidth: 1, borderColor: "#FFE0A3", borderRadius: 16, padding: 14, marginBottom: 14, shadowColor: "#D48B12", shadowOpacity: 0.08, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  warningHeaderRow: { flexDirection: "row", alignItems: "center", marginBottom: 7 },
  warningAlertIcon: { color: "#D48B12", fontSize: 15, marginRight: 6, fontWeight: "900" },
  warningHeading: { color: "#8A5408", fontSize: 11, fontWeight: "900", letterSpacing: 0.5 },
  warningText: { color: "#543810", fontSize: 12, lineHeight: 18, marginTop: 4, fontWeight: "500" },
  introSummaryCard: { backgroundColor: colors.canvas, borderWidth: 1, borderColor: colors.line, borderRadius: 16, padding: 15, marginBottom: 14 },
  introSummaryLabel: { color: colors.blueDark, fontSize: 9, fontWeight: "900", letterSpacing: 1.1, marginBottom: 6 },
  introSummaryText: { color: colors.ink, fontSize: 15, lineHeight: 23, fontWeight: "600" },
  stepsSection: { marginTop: 4, marginBottom: 14 },
  stepsHeaderRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", marginBottom: 10, paddingHorizontal: 2 },
  stepsSectionTitle: { color: colors.ink, fontSize: 15, fontWeight: "900", letterSpacing: -0.2 },
  stepsProgressLabel: { color: colors.blueDark, fontSize: 11, fontWeight: "800" },
  stepCard: { backgroundColor: colors.glassSurface, borderWidth: 1, borderColor: colors.glassBorder, borderRadius: 16, padding: 14, flexDirection: "row", alignItems: "flex-start", marginBottom: 10, shadowColor: colors.navy, shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2, overflow: "hidden" },
  stepCardDone: { backgroundColor: colors.tealTint, borderColor: colors.teal },
  stepCardPressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
  stepCheckbox: { width: 32, height: 32, borderRadius: 10, backgroundColor: colors.blueTint, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center", marginRight: 12, marginTop: 1 },
  stepCheckboxDone: { backgroundColor: colors.teal, borderColor: colors.teal },
  stepCheckboxText: { color: colors.blueDark, fontSize: 13, fontWeight: "900" },
  stepCheckboxTextDone: { color: colors.white, fontSize: 15, fontWeight: "900" },
  stepContent: { flex: 1 },
  stepInstructionText: { color: colors.ink, fontSize: 15, lineHeight: 23, fontWeight: "500" },
  stepInstructionDone: { color: colors.muted, textDecorationLine: "line-through" },
  conclusionCard: { backgroundColor: colors.canvas, borderWidth: 1, borderColor: colors.line, borderRadius: 16, padding: 14, marginBottom: 14 },
  conclusionText: { color: colors.ink, fontSize: 13, lineHeight: 20, fontStyle: "italic" },
  answerCard: { backgroundColor: colors.canvas, borderWidth: 1, borderColor: colors.line, borderRadius: 19, padding: 16, marginBottom: 14 },
  answerLabel: { color: colors.blue, fontSize: 9, fontWeight: "900", letterSpacing: 1.1, marginBottom: 8 },
  answerText: { color: colors.ink, fontSize: 15, lineHeight: 24, fontWeight: "500" },
  sourcesHeader: { flexDirection: "row", alignItems: "center", marginTop: 10, marginBottom: 9 },
  sourceCard: { backgroundColor: colors.glassSurface, borderRadius: 16, borderWidth: 1, borderColor: colors.glassBorder, padding: 13, flexDirection: "row", alignItems: "center", marginBottom: 9, shadowColor: colors.navy, shadowOpacity: 0.1, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 2, overflow: "hidden" },
  sourcePressed: { backgroundColor: colors.soft },
  sourceIndexBadge: { width: 34, height: 34, borderRadius: 11, backgroundColor: colors.blueTint, justifyContent: "center", alignItems: "center", marginRight: 10 },
  sourceIndexBadgeText: { color: colors.blueDark, fontSize: 13, fontWeight: "900" },
  sourceIcon: { width: 31, height: 31, borderRadius: 10, backgroundColor: colors.blueTint, justifyContent: "center", alignItems: "center", marginRight: 9 },
  sourceIconText: { color: colors.blueDark, fontSize: 16, fontWeight: "900" },
  sourceCopy: { flex: 1, paddingRight: 5 },
  sourceTitle: { color: colors.ink, fontSize: 12, fontWeight: "800", lineHeight: 17 },
  sourcePublisher: { color: colors.muted, fontSize: 10, marginTop: 4 },
  sourceSnippet: { color: colors.muted, fontSize: 11, lineHeight: 16, marginTop: 6 },
  sourceChevron: { color: colors.muted, fontSize: 21, marginLeft: 3 },
  noSources: { backgroundColor: colors.soft, borderRadius: 14, padding: 14 },
  noSourcesTitle: { color: colors.ink, fontSize: 11, fontWeight: "900" },
  noSourcesText: { color: colors.muted, fontSize: 10, lineHeight: 15, marginTop: 5 },
  bottomActionRow: { flexDirection: "row", gap: 10, marginTop: 18, alignItems: "center" },
  bottomActionFlex: { flex: 1 },
  shareBottomButton: { minHeight: 50, paddingHorizontal: 16, borderRadius: 14, backgroundColor: "rgba(255,255,255,0.40)", borderWidth: 1, borderColor: "rgba(255,255,255,0.94)", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, overflow: "hidden", shadowColor: "#29466B", shadowOpacity: 0.08, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  shareBottomIcon: { color: colors.blueDark, fontSize: 16, fontWeight: "900" },
  shareBottomText: { color: colors.ink, fontSize: 12, fontWeight: "900" },
  tabBar: { height: 72, position: "relative", flexDirection: "row", alignItems: "center", justifyContent: "space-around", backgroundColor: colors.glassSurface, borderTopWidth: 1, borderTopColor: colors.glassBorder, paddingHorizontal: 14, overflow: "hidden", shadowColor: colors.navy, shadowOpacity: 0.12, shadowRadius: 12, shadowOffset: { width: 0, height: -4 }, elevation: 6 },
  tabBarTint: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: colors.glassSurface },
  tabButton: { width: 76, alignItems: "center", justifyContent: "center", minHeight: 58 },
  tabButtonProminent: { marginTop: -9 },
  tabButtonDisabled: { opacity: 0.45 },
  tabButtonPressed: { opacity: 0.78, transform: [{ scale: 0.96 }] },
  tabIconWrap: { width: 40, height: 30, alignItems: "center", justifyContent: "center" },
  tabIconWrapSelected: { backgroundColor: "transparent" },
  tabIconProminent: { width: 43, height: 43, borderRadius: 15, backgroundColor: colors.blue, shadowColor: colors.blueDark, shadowOpacity: 0.2, shadowRadius: 6, shadowOffset: { width: 0, height: 3 }, elevation: 4 },
  tabIconProminentSelected: { backgroundColor: colors.blueDark },
  tabIconProminentText: { color: colors.white, fontSize: 23, lineHeight: 27 },
  tabIcon: { color: colors.muted, fontSize: 18, lineHeight: 22, fontWeight: "700" },
  tabIconSelected: { color: colors.blueDark },
  tabLabel: { color: colors.muted, fontSize: 8, fontWeight: "800", marginTop: 2 },
  tabLabelSelected: { color: colors.blueDark },
  drawerLayer: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, zIndex: 30, elevation: 30, flexDirection: "row" },
  drawerScrim: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: "rgba(19,30,53,0.30)" },
  drawerPanel: { width: 320, maxWidth: "88%", height: "100%", paddingTop: 12, paddingHorizontal: 14, paddingBottom: 12, backgroundColor: colors.glassSurface, borderRightWidth: 1, borderRightColor: colors.glassBorder, shadowColor: colors.navy, shadowOpacity: 0.18, shadowRadius: 16, shadowOffset: { width: 7, height: 0 }, elevation: 9 },
  drawerBlur: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 },
  drawerTint: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: "rgba(255,255,255,0.28)" },
  drawerHeader: { minHeight: 58, flexDirection: "row", alignItems: "center", paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: "rgba(113,129,152,0.2)" },
  drawerBrandMark: { width: 42, height: 42, borderRadius: 15, backgroundColor: colors.blue, alignItems: "center", justifyContent: "center", shadowColor: colors.blueDark, shadowOpacity: 0.2, shadowRadius: 5, shadowOffset: { width: 2, height: 3 }, elevation: 3 },
  drawerBrandMarkText: { color: colors.white, fontSize: 26, fontWeight: "700" },
  drawerBrandCopy: { flex: 1, marginLeft: 10 },
  drawerBrandName: { color: colors.ink, fontSize: 14, fontWeight: "900" },
  drawerBrandCaption: { color: colors.muted, fontSize: 7, letterSpacing: 1.15, fontWeight: "800", marginTop: 4 },
  drawerClose: { width: 36, height: 36, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.28)", borderWidth: 1, borderColor: "rgba(255,255,255,0.88)", alignItems: "center", justifyContent: "center", overflow: "hidden" },
  drawerCloseText: { color: colors.muted, fontSize: 23, lineHeight: 26, marginTop: -2 },
  drawerScroll: { flex: 1 },
  drawerContent: { paddingTop: 22, paddingBottom: 14 },
  drawerSectionLabel: { color: "#718198", fontSize: 8, letterSpacing: 1.5, fontWeight: "900", marginBottom: 9, marginLeft: 8 },
  drawerSectionSpaced: { marginTop: 23 },
  drawerItem: { minHeight: 60, borderRadius: 15, borderWidth: 1, borderColor: colors.glassBorder, flexDirection: "row", alignItems: "center", paddingHorizontal: 8, marginBottom: 5, overflow: "hidden", backgroundColor: colors.glassSurface },
  drawerItemSelected: { backgroundColor: colors.blueTint, borderColor: colors.blue },
  drawerItemPressed: { opacity: 0.78 },
  drawerItemIcon: { width: 38, height: 38, borderRadius: 13, backgroundColor: colors.canvas, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center", marginRight: 11, shadowColor: colors.navy, shadowOpacity: 0.16, shadowRadius: 5, shadowOffset: { width: 2, height: 2 }, elevation: 2 },
  drawerItemIconSelected: { backgroundColor: colors.blueTint, borderColor: colors.line },
  drawerItemIconText: { color: colors.muted, fontSize: 18, fontWeight: "700" },
  drawerItemIconTextSelected: { color: colors.blueDark },
  drawerItemCopy: { flex: 1 },
  drawerItemTitle: { color: colors.ink, fontSize: 11, fontWeight: "800" },
  drawerItemTitleSelected: { color: colors.blueDark },
  drawerItemHint: { color: colors.muted, fontSize: 8, marginTop: 4 },
  drawerActiveMark: { width: 5, height: 22, borderRadius: 4, backgroundColor: colors.blue, marginLeft: 5 },
  drawerFooter: { minHeight: 62, borderRadius: 16, backgroundColor: colors.canvas, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 12, flexDirection: "row", alignItems: "center" },
  drawerFooterDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.teal, marginRight: 9 },
  drawerFooterCopy: { flex: 1 },
  drawerFooterTitle: { color: colors.ink, fontSize: 9, fontWeight: "800" },
  drawerFooterHint: { color: colors.muted, fontSize: 8, marginTop: 4 },
  loadingOverlay: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, zIndex: 50, elevation: 50, alignItems: "center", justifyContent: "center", padding: 26 },
  loadingScrim: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: "rgba(20,35,61,0.30)" },
  loadingCard: { width: "100%", maxWidth: 340, alignItems: "center", paddingHorizontal: 25, paddingTop: 25, paddingBottom: 21, borderRadius: 23 },
  loadingIcon: { width: 58, height: 58, borderRadius: 20, backgroundColor: colors.blueTint, alignItems: "center", justifyContent: "center", marginBottom: 16 },
  loadingEyebrow: { color: colors.teal, fontSize: 8, fontWeight: "900", letterSpacing: 1.4 },
  loadingTitle: { color: colors.ink, fontSize: 17, fontWeight: "900", marginTop: 7, textAlign: "center" },
  loadingBody: { color: colors.muted, fontSize: 10, lineHeight: 16, marginTop: 7, textAlign: "center" },
  loadingHint: { color: colors.muted, fontSize: 8, marginTop: 11 },
  cardPressed: { opacity: 0.82 },
  activityCardPressable: { borderRadius: 20 },
  activityCard: { borderRadius: 20, padding: 15, backgroundColor: colors.canvas, borderWidth: 1, borderColor: colors.line },
  activityCardTop: { flexDirection: "row", alignItems: "center" },
  activityIcon: { width: 34, height: 34, borderRadius: 12, backgroundColor: colors.tealTint, alignItems: "center", justifyContent: "center", marginRight: 10 },
  activityIconText: { color: colors.teal, fontSize: 17, fontWeight: "900" },
  activityCardHeading: { flex: 1 },
  activityCardTitle: { color: colors.ink, fontSize: 11, fontWeight: "900" },
  activityCardMeta: { color: colors.teal, fontSize: 8, fontWeight: "800", marginTop: 3 },
  activityQuestion: { color: colors.ink, fontSize: 12, fontWeight: "800", lineHeight: 18, marginTop: 13 },
  activityAnswer: { color: colors.muted, fontSize: 10, lineHeight: 16, marginTop: 6 },
  activityLink: { color: colors.blueDark, fontSize: 9, fontWeight: "900", marginTop: 13 },
  emptyStateCard: { minHeight: 235, borderRadius: 22, padding: 20, alignItems: "center", justifyContent: "center", backgroundColor: colors.canvas, borderWidth: 1, borderColor: colors.line },
  emptyStateIcon: { width: 54, height: 54, borderRadius: 19, backgroundColor: colors.blueTint, alignItems: "center", justifyContent: "center", marginBottom: 13 },
  emptyStateIconText: { color: colors.blueDark, fontSize: 27 },
  emptyStateTitle: { color: colors.ink, fontSize: 14, fontWeight: "900" },
  emptyStateBody: { color: colors.muted, fontSize: 10, lineHeight: 16, textAlign: "center", marginTop: 7, maxWidth: 260 },
  emptyStateFootnote: { color: colors.blueDark, fontSize: 8, fontWeight: "800", marginTop: 12 },
  settingsCard: { borderRadius: 19, padding: 14, marginBottom: 12, backgroundColor: colors.canvas, borderWidth: 1, borderColor: colors.line },
  themeGrid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 9, marginTop: 3 },
  themeOption: { width: "48.5%", minHeight: 70, flexDirection: "row", alignItems: "center", padding: 7, borderRadius: 14, borderWidth: 1, borderColor: colors.glassBorder, backgroundColor: colors.glassSurface, overflow: "hidden" },
  themeOptionSelected: { borderColor: colors.blue, backgroundColor: colors.blueTint },
  themeSwatch: { width: 36, height: 42, borderRadius: 10, borderWidth: 1, overflow: "hidden", justifyContent: "center", paddingLeft: 6 },
  themeSwatchAccent: { width: 17, height: 17, borderRadius: 6 },
  themeSwatchDot: { position: "absolute", width: 8, height: 8, borderRadius: 4, right: 5, top: 7 },
  themeSwatchGlass: { position: "absolute", width: 18, height: 14, borderRadius: 5, right: 4, bottom: 5, borderWidth: 1, backgroundColor: "rgba(255,255,255,0.48)" },
  themeOptionCopy: { flex: 1, marginLeft: 7 },
  themeOptionName: { color: colors.ink, fontSize: 9, fontWeight: "900" },
  themeOptionNameSelected: { color: colors.blueDark },
  themeOptionDescription: { color: colors.muted, fontSize: 7, lineHeight: 10, marginTop: 3 },
  themeCheck: { width: 15, height: 15, borderRadius: 8, backgroundColor: colors.blue, alignItems: "center", justifyContent: "center", marginLeft: 3 },
  themeCheckText: { color: colors.white, fontSize: 9, lineHeight: 12, fontWeight: "900" },
  settingsEyebrow: { color: colors.muted, fontSize: 8, fontWeight: "900", letterSpacing: 1.2, marginBottom: 11 },
  settingsRow: { minHeight: 52, flexDirection: "row", alignItems: "center", marginBottom: 12 },
  settingsIcon: { width: 36, height: 36, borderRadius: 13, backgroundColor: colors.blueTint, alignItems: "center", justifyContent: "center", marginRight: 10 },
  settingsIconMint: { backgroundColor: colors.tealTint },
  settingsIconSteel: { backgroundColor: "#E2EAF4" },
  settingsIconText: { color: colors.blueDark, fontSize: 17, fontWeight: "800" },
  settingsCopy: { flex: 1 },
  settingsTitle: { color: colors.ink, fontSize: 10, fontWeight: "900" },
  settingsBody: { color: colors.muted, fontSize: 8, lineHeight: 13, marginTop: 4 },
  settingsHint: { color: colors.muted, fontSize: 8, lineHeight: 13, marginTop: 8 },
  settingsValue: { color: colors.blueDark, fontSize: 8, letterSpacing: 0.8, fontWeight: "900" },
  statusDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: "#C3CAD6", marginLeft: 8 },
  statusDotOnline: { backgroundColor: colors.teal },
  statusDotOffline: { backgroundColor: colors.red },
  aboutHero: { borderRadius: 23, padding: 19, marginBottom: 22, backgroundColor: colors.canvas, borderWidth: 1, borderColor: colors.line },
  aboutMark: { width: 49, height: 49, borderRadius: 17, backgroundColor: colors.navy, alignItems: "center", justifyContent: "center" },
  aboutMarkText: { color: colors.white, fontSize: 30, fontWeight: "700" },
  aboutHeroTitle: { color: colors.ink, fontSize: 16, lineHeight: 22, fontWeight: "900", marginTop: 14 },
  aboutHeroBody: { color: colors.muted, fontSize: 10, lineHeight: 16, marginTop: 7 },
});
}
