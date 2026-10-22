import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Keyboard,
  Linking,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { createDiagnosis, DiagnosisApiError, safeCitationUrl, validateDiagnosisInput } from "./api";
import { MAX_IMAGE_BYTES, MAX_QUESTION_CHARS, SUPPORTED_IMAGE_TYPES } from "./config";
import type { DiagnosisResult, ImageSelection } from "./types";

const colors = {
  ink: "#152622",
  muted: "#647570",
  paper: "#F3F6F1",
  white: "#FFFFFF",
  green: "#176B52",
  greenDark: "#103F34",
  mint: "#E1EFE7",
  line: "#DCE5DE",
  soft: "#EBF1EC",
  amber: "#FFF1D8",
  amberInk: "#80551A",
  red: "#A33731",
};

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
  };
}

function ActionButton({
  label,
  hint,
  icon,
  onPress,
  disabled = false,
  secondary = false,
}: {
  label: string;
  hint: string;
  icon: string;
  onPress: () => void;
  disabled?: boolean;
  secondary?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionButton,
        secondary && styles.secondaryButton,
        disabled && styles.disabledButton,
        pressed && !disabled && styles.pressedButton,
      ]}
    >
      <View style={styles.actionIcon}><Text style={[styles.actionIconText, secondary && styles.secondaryActionIconText]}>{icon}</Text></View>
      <View style={styles.actionCopy}>
        <Text style={[styles.actionText, secondary && styles.secondaryActionText]}>{label}</Text>
        <Text style={[styles.actionHint, secondary && styles.secondaryActionHint]}>{hint}</Text>
      </View>
      <Text style={[styles.actionChevron, secondary && styles.secondaryActionChevron]}>›</Text>
    </Pressable>
  );
}

export default function App() {
  const [image, setImage] = useState<ImageSelection | null>(null);
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<DiagnosisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const questionPrompts = ["What does this mean?", "How can I fix it?"];

  const chooseFromLibrary = async () => {
    setError(null);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Photo access needed", "Allow photo access to choose a troubleshooting image.");
      return;
    }
    const selection = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      quality: 0.85,
    });
    if (!selection.canceled && selection.assets[0]) {
      const next = friendlyImage(selection.assets[0]);
      if (next) {
        setImage(next);
        setResult(null);
      }
    }
  };

  const takePhoto = async () => {
    setError(null);
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Camera access needed", "Allow camera access to take a troubleshooting photo.");
      return;
    }
    const capture = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      quality: 0.85,
    });
    if (!capture.canceled && capture.assets[0]) {
      const next = friendlyImage(capture.assets[0]);
      if (next) {
        setImage(next);
        setResult(null);
      }
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
      setResult(await createDiagnosis(question, image));
    } catch (caught) {
      const message = caught instanceof DiagnosisApiError
        ? caught.message
        : "Something went wrong. Check your connection and try again.";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  const reset = () => {
    setImage(null);
    setQuestion("");
    setError(null);
    setResult(null);
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

  const canSubmit = Boolean(image && question.trim() && !isLoading);
  const imageSizeLabel = image?.size == null
    ? "Image ready"
    : `${(image.size / (1024 * 1024)).toFixed(1)} MB photo`;

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.app}>
        <StatusBar barStyle="dark-content" backgroundColor={colors.paper} />
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
        <View style={styles.header}>
          <View style={styles.brandMark}><Text style={styles.brandGlyph}>⌕</Text></View>
          <View style={styles.brandCopy}>
            <Text style={styles.brandName}>SNAPLENS <Text style={styles.brandAI}>AI</Text></Text>
            <Text style={styles.brandCaption}>VISUAL TROUBLESHOOTING</Text>
          </View>
          <View style={styles.onlinePill}><View style={styles.onlineDot} /><Text style={styles.onlineText}>PHOTO GUIDE</Text></View>
        </View>

        <View style={styles.hero}>
          <View style={styles.heroGlow} />
          <View style={styles.heroTopline}><View style={styles.heroSpark}><Text style={styles.heroSparkText}>✦</Text></View><Text style={styles.eyebrow}>YOUR EVERYDAY REPAIR GUIDE</Text></View>
          <Text style={styles.title}>See it.{"\n"}Understand it.</Text>
          <Text style={styles.subtitle}>A photo and a good question are all you need to get started.</Text>
          <View style={styles.heroFooter}><View style={styles.heroFooterLine} /><Text style={styles.heroFooterText}>PHOTO  <Text style={styles.heroFooterArrow}>→</Text>  PRACTICAL GUIDANCE</Text></View>
        </View>

        <View style={styles.stepHeading}>
          <View style={styles.stepNumber}><Text style={styles.stepNumberText}>01</Text></View>
          <View style={styles.stepCopy}>
            <Text style={styles.stepTitle}>Show us the issue</Text>
            <Text style={styles.stepHint}>Capture an error message, label, or device.</Text>
          </View>
        </View>

        {image ? (
          <View style={styles.photoCard}>
            <Image source={{ uri: image.uri }} style={styles.preview} resizeMode="cover" accessibilityLabel="Selected troubleshooting photo" />
            <View style={styles.photoMeta}>
              <View style={styles.photoMetaCopy}>
                <Text style={styles.photoName} numberOfLines={1}>{image.name}</Text>
                <Text style={styles.photoSize}>{imageSizeLabel}</Text>
              </View>
              <Pressable accessibilityRole="button" onPress={() => { setImage(null); setResult(null); setError(null); }} style={styles.removeButton}>
                <Text style={styles.removeText}>Remove</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <View style={styles.photoPlaceholder}>
            <View style={styles.cameraIcon}><Text style={styles.cameraGlyph}>⌗</Text></View>
            <Text style={styles.placeholderTitle}>Add a photo to get started</Text>
            <Text style={styles.placeholderText}>Keep the device and any error message in focus.</Text>
            <View style={styles.formatPill}><Text style={styles.formatText}>JPG  ·  PNG  ·  WEBP  ·  UP TO 10 MB</Text></View>
          </View>
        )}

        <View style={styles.photoActions}>
          <View style={styles.actionColumn}><ActionButton label="Take a photo" hint="Use your camera" icon="◉" onPress={takePhoto} disabled={isLoading} /></View>
          <View style={styles.actionColumn}><ActionButton label="Choose photo" hint="From your gallery" icon="▧" onPress={chooseFromLibrary} secondary disabled={isLoading} /></View>
        </View>

        <View style={[styles.stepHeading, styles.questionHeading]}>
          <View style={styles.stepNumber}><Text style={styles.stepNumberText}>02</Text></View>
          <View style={styles.stepCopy}>
            <Text style={styles.stepTitle}>What would you like to know?</Text>
            <Text style={styles.stepHint}>Add a question so we can focus the guidance.</Text>
          </View>
        </View>

        <View style={styles.promptRow}>
          {questionPrompts.map((prompt) => (
            <Pressable key={prompt} accessibilityRole="button" onPress={() => { setQuestion(prompt); setResult(null); setError(null); }} style={({ pressed }) => [styles.promptChip, pressed && styles.promptChipPressed]}>
              <Text style={styles.promptChipText}>{prompt}</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.inputCard}>
          <Text style={styles.inputLabel}>YOUR QUESTION</Text>
          <TextInput
            accessibilityLabel="Your troubleshooting question"
            editable={!isLoading}
            multiline
            maxLength={MAX_QUESTION_CHARS}
            onChangeText={(value) => { setQuestion(value); setResult(null); setError(null); }}
            placeholder="Describe what you’re seeing…"
            placeholderTextColor="#87948F"
            returnKeyType="default"
            style={styles.questionInput}
            textAlignVertical="top"
            value={question}
          />
          <Text style={styles.charCount}>{question.length}/{MAX_QUESTION_CHARS.toLocaleString()}</Text>
        </View>

        {error ? (
          <View accessibilityRole="alert" style={styles.errorBox}>
            <Text style={styles.errorTitle}>Let’s try that again</Text>
            <Text style={styles.errorText}>{error}</Text>
            {!isLoading && image && question.trim() ? (
              <Pressable accessibilityRole="button" onPress={submit} style={styles.retryButton}>
                <Text style={styles.retryText}>Retry request</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: !canSubmit, busy: isLoading }}
          disabled={!canSubmit}
          onPress={submit}
          style={({ pressed }) => [styles.submitButton, !canSubmit && styles.submitDisabled, pressed && canSubmit && styles.submitPressed]}
        >
          {isLoading ? (
            <><ActivityIndicator color={colors.white} /><Text style={styles.submitText}>Checking your photo…</Text></>
          ) : (
            <><Text style={styles.submitText}>Get troubleshooting help</Text><Text style={styles.submitArrow}>→</Text></>
          )}
        </Pressable>
        <Text style={styles.privacyNote}>Your photo is used for this request and isn’t saved to conversation history.</Text>

        {result ? (
          <View style={styles.resultSection}>
            <View style={styles.resultHeading}>
              <View style={styles.resultCheck}><Text style={styles.resultCheckText}>✓</Text></View>
              <View style={styles.stepCopy}>
                <Text style={styles.resultEyebrow}>{result.status === "completed" ? "YOUR GUIDANCE" : "A LITTLE MORE INFO"}</Text>
                <Text style={styles.resultTitle}>{result.status === "completed" ? "Here’s what we found" : "Let’s narrow it down"}</Text>
              </View>
            </View>
            <View style={styles.answerCard}>
              <Text style={styles.answerText}>{result.answer}</Text>
            </View>

            {result.warnings.length > 0 ? (
              <View style={styles.warningCard}>
                <Text style={styles.warningHeading}>A note before you continue</Text>
                {result.warnings.map((warning, index) => <Text key={`${index}-${warning}`} style={styles.warningText}>•  {warning}</Text>)}
              </View>
            ) : null}

            {result.citations.length > 0 ? (
              <View style={styles.sourcesSection}>
                <View style={styles.sourcesHeading}>
                  <Text style={styles.sourcesTitle}>Sources</Text>
                  <Text style={styles.sourcesCount}>{result.citations.length} references</Text>
                </View>
                {result.citations.map((citation) => (
                  <Pressable
                    accessibilityRole="link"
                    key={citation.source_id}
                    onPress={() => void openSource(citation.url)}
                    style={({ pressed }) => [styles.sourceCard, pressed && styles.sourcePressed]}
                  >
                    <View style={styles.sourceIcon}><Text style={styles.sourceIconText}>↗</Text></View>
                    <View style={styles.sourceCopy}>
                      <Text style={styles.sourceTitle} numberOfLines={2}>{citation.title}</Text>
                      <Text style={styles.sourcePublisher} numberOfLines={1}>{citation.publisher || new URL(citation.url).hostname}</Text>
                    </View>
                    <Text style={styles.sourceChevron}>›</Text>
                  </Pressable>
                ))}
              </View>
            ) : (
              <View style={styles.noSources}><Text style={styles.noSourcesText}>No verified sources were available, so the app won’t show repair steps as confirmed.</Text></View>
            )}

            <Pressable accessibilityRole="button" onPress={reset} style={styles.newCheckButton}>
              <Text style={styles.newCheckText}>Start another check</Text>
            </Pressable>
          </View>
        ) : null}

        <View style={styles.footer}>
          <View style={styles.footerRule} />
          <Text style={styles.footerBrand}>SNAPLENS AI</Text>
          <Text style={styles.footerText}>Thoughtful help for the things you use every day.</Text>
        </View>
        </ScrollView>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  app: { flex: 1, backgroundColor: colors.paper },
  scrollContent: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 42, maxWidth: 720, width: "100%", alignSelf: "center" },
  header: { flexDirection: "row", alignItems: "center", minHeight: 52, marginBottom: 5 },
  brandMark: { width: 40, height: 40, borderRadius: 14, backgroundColor: colors.greenDark, alignItems: "center", justifyContent: "center" },
  brandGlyph: { color: colors.white, fontSize: 26, lineHeight: 30, fontWeight: "700" },
  brandCopy: { marginLeft: 10, flex: 1 },
  brandName: { color: colors.ink, fontWeight: "900", letterSpacing: 1.1, fontSize: 14 },
  brandAI: { color: colors.green, fontWeight: "700" },
  brandCaption: { color: colors.muted, fontSize: 8, letterSpacing: 1.35, marginTop: 3 },
  onlinePill: { flexDirection: "row", alignItems: "center", paddingHorizontal: 10, paddingVertical: 7, borderRadius: 20, backgroundColor: colors.mint },
  onlineDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.green, marginRight: 6 },
  onlineText: { color: colors.greenDark, fontSize: 8, fontWeight: "800", letterSpacing: 0.85 },
  hero: { backgroundColor: colors.greenDark, paddingHorizontal: 22, paddingTop: 21, paddingBottom: 18, borderRadius: 25, overflow: "hidden", marginTop: 9, marginBottom: 27, minHeight: 214 },
  heroGlow: { position: "absolute", width: 190, height: 190, borderRadius: 95, backgroundColor: "#1A5747", right: -78, top: -72, borderWidth: 1, borderColor: "#286451" },
  heroTopline: { flexDirection: "row", alignItems: "center", marginBottom: 15 },
  heroSpark: { width: 21, height: 21, borderRadius: 8, backgroundColor: "#2B6B55", alignItems: "center", justifyContent: "center", marginRight: 8 },
  heroSparkText: { color: "#D3E9D9", fontSize: 12, fontWeight: "700" },
  eyebrow: { color: "#C2D9CB", fontSize: 8, fontWeight: "800", letterSpacing: 1.45 },
  title: { fontSize: 34, lineHeight: 37, fontWeight: "800", color: colors.white, letterSpacing: -1.15 },
  subtitle: { marginTop: 9, color: "#D4E4DB", fontSize: 12, lineHeight: 18, maxWidth: 290 },
  heroFooter: { flexDirection: "row", alignItems: "center", marginTop: 17 },
  heroFooterLine: { height: 1, width: 24, backgroundColor: "#8AB49C", marginRight: 9 },
  heroFooterText: { color: "#C8DED0", fontSize: 8, fontWeight: "800", letterSpacing: 1.15 },
  heroFooterArrow: { color: "#95C4A6" },
  stepHeading: { flexDirection: "row", alignItems: "center", marginBottom: 12 },
  stepNumber: { width: 35, height: 35, borderRadius: 12, backgroundColor: colors.mint, alignItems: "center", justifyContent: "center", marginRight: 11 },
  stepNumberText: { color: colors.green, fontSize: 10, fontWeight: "900", letterSpacing: 0.6 },
  stepCopy: { flex: 1 },
  stepTitle: { color: colors.ink, fontSize: 14, fontWeight: "800", letterSpacing: -0.15 },
  stepHint: { color: colors.muted, fontSize: 10, lineHeight: 15, marginTop: 3 },
  photoPlaceholder: { minHeight: 168, borderWidth: 1, borderStyle: "dashed", borderColor: "#B8CBC0", borderRadius: 21, backgroundColor: "#EDF3EE", alignItems: "center", justifyContent: "center", padding: 18 },
  cameraIcon: { width: 43, height: 43, borderRadius: 15, backgroundColor: colors.white, alignItems: "center", justifyContent: "center", marginBottom: 10, borderWidth: 1, borderColor: "#E5ECE6" },
  cameraGlyph: { color: colors.green, fontSize: 25, lineHeight: 30, fontWeight: "700" },
  placeholderTitle: { color: colors.ink, fontWeight: "800", fontSize: 13 },
  placeholderText: { color: colors.muted, fontSize: 10, lineHeight: 15, marginTop: 5, textAlign: "center" },
  formatPill: { backgroundColor: "#E3ECE5", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5, marginTop: 11 },
  formatText: { color: colors.muted, fontSize: 7, fontWeight: "800", letterSpacing: 0.8 },
  photoCard: { borderRadius: 21, overflow: "hidden", backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, shadowColor: "#253C30", shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 2 },
  preview: { width: "100%", height: 220, backgroundColor: "#E8ECE8" },
  photoMeta: { paddingHorizontal: 14, paddingVertical: 12, flexDirection: "row", alignItems: "center" },
  photoMetaCopy: { flex: 1 },
  photoName: { color: colors.ink, fontSize: 12, fontWeight: "700" },
  photoSize: { color: colors.muted, marginTop: 3, fontSize: 10 },
  removeButton: { paddingHorizontal: 10, paddingVertical: 7 },
  removeText: { color: colors.red, fontSize: 11, fontWeight: "700" },
  photoActions: { flexDirection: "row", gap: 10, marginTop: 10 },
  actionColumn: { flex: 1 },
  actionButton: { minHeight: 59, borderRadius: 16, backgroundColor: colors.green, alignItems: "center", justifyContent: "center", paddingHorizontal: 9, borderWidth: 1, borderColor: colors.green, flexDirection: "row" },
  secondaryButton: { backgroundColor: colors.white, borderColor: colors.line },
  disabledButton: { opacity: 0.5 },
  pressedButton: { opacity: 0.82, transform: [{ scale: 0.985 }] },
  actionIcon: { width: 31, height: 31, borderRadius: 11, backgroundColor: "#2B7A61", alignItems: "center", justifyContent: "center", marginRight: 8 },
  actionIconText: { color: colors.white, fontSize: 17, fontWeight: "700" },
  secondaryActionIconText: { color: colors.green },
  actionCopy: { flex: 1 },
  actionText: { color: colors.white, fontSize: 10, fontWeight: "800" },
  secondaryActionText: { color: colors.ink },
  actionHint: { color: "#D9E9E0", fontSize: 8, marginTop: 3 },
  secondaryActionHint: { color: colors.muted },
  actionChevron: { color: "#D9E9E0", fontSize: 20, marginLeft: 2 },
  secondaryActionChevron: { color: colors.muted },
  questionHeading: { marginTop: 27 },
  promptRow: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginBottom: 10 },
  promptChip: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, borderRadius: 20, paddingHorizontal: 11, paddingVertical: 7 },
  promptChipPressed: { backgroundColor: colors.mint, borderColor: "#BFD5C7" },
  promptChipText: { color: colors.greenDark, fontSize: 9, fontWeight: "700" },
  inputCard: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, borderRadius: 18, paddingHorizontal: 14, paddingTop: 11, paddingBottom: 8 },
  inputLabel: { color: colors.muted, fontSize: 8, fontWeight: "800", letterSpacing: 1.1, marginBottom: 7 },
  questionInput: { minHeight: 75, color: colors.ink, fontSize: 13, lineHeight: 20, padding: 0 },
  charCount: { alignSelf: "flex-end", color: colors.muted, fontSize: 9, marginTop: 4 },
  errorBox: { backgroundColor: "#FDEAE7", borderColor: "#F1C5BE", borderWidth: 1, padding: 14, marginTop: 13, borderRadius: 16 },
  errorTitle: { color: colors.red, fontWeight: "800", fontSize: 12 },
  errorText: { color: "#713A36", fontSize: 12, lineHeight: 18, marginTop: 4 },
  retryButton: { alignSelf: "flex-start", paddingTop: 8 },
  retryText: { color: colors.red, fontSize: 12, fontWeight: "800", textDecorationLine: "underline" },
  submitButton: { marginTop: 14, minHeight: 56, paddingHorizontal: 17, backgroundColor: colors.green, borderRadius: 17, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9, shadowColor: colors.greenDark, shadowOpacity: 0.18, shadowRadius: 9, shadowOffset: { width: 0, height: 5 }, elevation: 3 },
  submitDisabled: { backgroundColor: "#A4B8AE" },
  submitPressed: { backgroundColor: colors.greenDark },
  submitText: { color: colors.white, fontSize: 13, fontWeight: "800", letterSpacing: 0.1 },
  submitArrow: { color: colors.white, fontSize: 21, marginLeft: 4, marginTop: -2 },
  privacyNote: { color: colors.muted, textAlign: "center", fontSize: 10, lineHeight: 16, marginTop: 10, paddingHorizontal: 16 },
  resultSection: { marginTop: 29, backgroundColor: colors.soft, borderRadius: 23, padding: 14 },
  resultHeading: { flexDirection: "row", alignItems: "center", marginBottom: 14 },
  resultCheck: { width: 36, height: 36, borderRadius: 12, backgroundColor: colors.green, justifyContent: "center", alignItems: "center", marginRight: 11 },
  resultCheckText: { color: colors.white, fontSize: 18, fontWeight: "800" },
  resultEyebrow: { color: colors.green, fontSize: 9, fontWeight: "800", letterSpacing: 1.6 },
  resultTitle: { color: colors.ink, fontSize: 18, fontWeight: "800", marginTop: 3 },
  answerCard: { backgroundColor: colors.white, borderRadius: 17, padding: 17, borderWidth: 1, borderColor: colors.line },
  answerText: { color: colors.ink, fontSize: 14, lineHeight: 22 },
  warningCard: { backgroundColor: colors.amber, borderRadius: 14, padding: 14, marginTop: 11 },
  warningHeading: { color: colors.amberInk, fontSize: 12, fontWeight: "800", marginBottom: 6 },
  warningText: { color: colors.amberInk, fontSize: 12, lineHeight: 18, marginTop: 3 },
  sourcesSection: { marginTop: 21 },
  sourcesHeading: { flexDirection: "row", alignItems: "baseline", marginBottom: 10 },
  sourcesTitle: { color: colors.ink, fontSize: 16, fontWeight: "800", flex: 1 },
  sourcesCount: { color: colors.muted, fontSize: 10 },
  sourceCard: { backgroundColor: colors.white, borderRadius: 14, borderWidth: 1, borderColor: colors.line, padding: 12, flexDirection: "row", alignItems: "center", marginBottom: 8 },
  sourcePressed: { backgroundColor: "#F0F6F1" },
  sourceIcon: { width: 34, height: 34, borderRadius: 11, backgroundColor: colors.mint, justifyContent: "center", alignItems: "center", marginRight: 10 },
  sourceIconText: { color: colors.green, fontSize: 18, fontWeight: "800" },
  sourceCopy: { flex: 1, paddingRight: 5 },
  sourceTitle: { color: colors.ink, fontSize: 12, fontWeight: "700", lineHeight: 17 },
  sourcePublisher: { color: colors.muted, fontSize: 10, marginTop: 3 },
  sourceChevron: { color: colors.muted, fontSize: 23, marginLeft: 3 },
  noSources: { backgroundColor: "#EDF3EE", borderRadius: 13, padding: 13, marginTop: 12 },
  noSourcesText: { color: colors.muted, fontSize: 11, lineHeight: 17 },
  newCheckButton: { alignItems: "center", paddingVertical: 15, marginTop: 9 },
  newCheckText: { color: colors.green, fontSize: 13, fontWeight: "800" },
  footer: { alignItems: "center", paddingTop: 27 },
  footerRule: { height: 1, backgroundColor: colors.line, alignSelf: "stretch", marginBottom: 17 },
  footerBrand: { color: colors.green, fontSize: 9, fontWeight: "900", letterSpacing: 2 },
  footerText: { color: colors.muted, fontSize: 10, marginTop: 5 },
});
