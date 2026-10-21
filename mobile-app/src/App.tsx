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
  ink: "#172222",
  muted: "#617270",
  paper: "#F4F7F3",
  white: "#FFFFFF",
  green: "#176B57",
  greenDark: "#104F42",
  mint: "#E2F0E9",
  line: "#DDE6E0",
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
  onPress,
  disabled = false,
  secondary = false,
}: {
  label: string;
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
      <Text style={[styles.actionText, secondary && styles.secondaryActionText]}>{label}</Text>
    </Pressable>
  );
}

export default function App() {
  const [image, setImage] = useState<ImageSelection | null>(null);
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<DiagnosisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

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
          <View style={styles.brandMark}><Text style={styles.brandGlyph}>S</Text></View>
          <View style={styles.brandCopy}>
            <Text style={styles.brandName}>SNAPLENS <Text style={styles.brandAI}>AI</Text></Text>
            <Text style={styles.brandCaption}>VISUAL TROUBLESHOOTING</Text>
          </View>
          <View style={styles.onlinePill}><View style={styles.onlineDot} /><Text style={styles.onlineText}>READY</Text></View>
        </View>

        <View style={styles.hero}>
          <Text style={styles.eyebrow}>A CLEARER WAY TO FIX THINGS</Text>
          <Text style={styles.title}>Show us what’s{ "\n" }going on.</Text>
          <Text style={styles.subtitle}>Take a photo, ask your question, and get practical guidance with sources you can check.</Text>
        </View>

        <View style={styles.stepHeading}>
          <View style={styles.stepNumber}><Text style={styles.stepNumberText}>01</Text></View>
          <View style={styles.stepCopy}>
            <Text style={styles.stepTitle}>Add a photo</Text>
            <Text style={styles.stepHint}>A label, error code, or the whole device works.</Text>
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
            <View style={styles.cameraIcon}><Text style={styles.cameraGlyph}>⌁</Text></View>
            <Text style={styles.placeholderTitle}>Your photo goes here</Text>
            <Text style={styles.placeholderText}>Keep the device and any error message in focus.</Text>
          </View>
        )}

        <View style={styles.photoActions}>
          <View style={styles.actionColumn}><ActionButton label="Take a photo" onPress={takePhoto} disabled={isLoading} /></View>
          <View style={styles.actionColumn}><ActionButton label="Choose photo" onPress={chooseFromLibrary} secondary disabled={isLoading} /></View>
        </View>

        <View style={[styles.stepHeading, styles.questionHeading]}>
          <View style={styles.stepNumber}><Text style={styles.stepNumberText}>02</Text></View>
          <View style={styles.stepCopy}>
            <Text style={styles.stepTitle}>What do you want to know?</Text>
            <Text style={styles.stepHint}>A specific question helps us find the right guidance.</Text>
          </View>
        </View>

        <View style={styles.inputCard}>
          <TextInput
            accessibilityLabel="Your troubleshooting question"
            editable={!isLoading}
            multiline
            maxLength={MAX_QUESTION_CHARS}
            onChangeText={(value) => { setQuestion(value); setResult(null); setError(null); }}
            placeholder="For example: What does this blinking red light mean?"
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
  scrollContent: { paddingHorizontal: 22, paddingTop: 18, paddingBottom: 42, maxWidth: 720, width: "100%", alignSelf: "center" },
  header: { flexDirection: "row", alignItems: "center", minHeight: 54 },
  brandMark: { width: 42, height: 42, borderRadius: 14, backgroundColor: colors.green, alignItems: "center", justifyContent: "center" },
  brandGlyph: { color: colors.white, fontSize: 24, fontWeight: "800", fontStyle: "italic" },
  brandCopy: { marginLeft: 11, flex: 1 },
  brandName: { color: colors.ink, fontWeight: "900", letterSpacing: 1.2, fontSize: 15 },
  brandAI: { color: colors.green, fontWeight: "700" },
  brandCaption: { color: colors.muted, fontSize: 9, letterSpacing: 1.55, marginTop: 3 },
  onlinePill: { flexDirection: "row", alignItems: "center", paddingHorizontal: 10, paddingVertical: 7, borderRadius: 20, backgroundColor: colors.mint },
  onlineDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.green, marginRight: 6 },
  onlineText: { color: colors.greenDark, fontSize: 9, fontWeight: "800", letterSpacing: 1 },
  hero: { paddingTop: 38, paddingBottom: 26 },
  eyebrow: { color: colors.green, fontSize: 10, fontWeight: "800", letterSpacing: 2.1, marginBottom: 12 },
  title: { fontSize: 39, lineHeight: 43, fontWeight: "800", color: colors.ink, letterSpacing: -1.6 },
  subtitle: { marginTop: 13, color: colors.muted, fontSize: 15, lineHeight: 23, maxWidth: 540 },
  stepHeading: { flexDirection: "row", alignItems: "center", marginBottom: 13 },
  stepNumber: { width: 34, height: 34, borderRadius: 11, backgroundColor: colors.mint, alignItems: "center", justifyContent: "center", marginRight: 11 },
  stepNumberText: { color: colors.green, fontSize: 11, fontWeight: "800", letterSpacing: 0.5 },
  stepCopy: { flex: 1 },
  stepTitle: { color: colors.ink, fontSize: 15, fontWeight: "800" },
  stepHint: { color: colors.muted, fontSize: 11, lineHeight: 16, marginTop: 2 },
  photoPlaceholder: { minHeight: 174, borderWidth: 1, borderStyle: "dashed", borderColor: "#B8CBC0", borderRadius: 18, backgroundColor: "#EDF3EE", alignItems: "center", justifyContent: "center", padding: 20 },
  cameraIcon: { width: 43, height: 43, borderRadius: 15, backgroundColor: colors.white, alignItems: "center", justifyContent: "center", marginBottom: 11 },
  cameraGlyph: { color: colors.green, fontSize: 28, lineHeight: 32, fontWeight: "700" },
  placeholderTitle: { color: colors.ink, fontWeight: "800", fontSize: 14 },
  placeholderText: { color: colors.muted, fontSize: 11, marginTop: 5, textAlign: "center" },
  photoCard: { borderRadius: 18, overflow: "hidden", backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line },
  preview: { width: "100%", height: 215, backgroundColor: "#E8ECE8" },
  photoMeta: { paddingHorizontal: 14, paddingVertical: 11, flexDirection: "row", alignItems: "center" },
  photoMetaCopy: { flex: 1 },
  photoName: { color: colors.ink, fontSize: 12, fontWeight: "700" },
  photoSize: { color: colors.muted, marginTop: 3, fontSize: 10 },
  removeButton: { paddingHorizontal: 10, paddingVertical: 7 },
  removeText: { color: colors.red, fontSize: 11, fontWeight: "700" },
  photoActions: { flexDirection: "row", gap: 10, marginTop: 11 },
  actionColumn: { flex: 1 },
  actionButton: { minHeight: 45, borderRadius: 13, backgroundColor: colors.green, alignItems: "center", justifyContent: "center", paddingHorizontal: 10, borderWidth: 1, borderColor: colors.green },
  secondaryButton: { backgroundColor: colors.white, borderColor: colors.line },
  disabledButton: { opacity: 0.5 },
  pressedButton: { opacity: 0.82, transform: [{ scale: 0.985 }] },
  actionText: { color: colors.white, fontSize: 12, fontWeight: "800" },
  secondaryActionText: { color: colors.ink },
  questionHeading: { marginTop: 28 },
  inputCard: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, borderRadius: 16, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 8 },
  questionInput: { minHeight: 92, color: colors.ink, fontSize: 14, lineHeight: 21, padding: 0 },
  charCount: { alignSelf: "flex-end", color: colors.muted, fontSize: 10, marginTop: 4 },
  errorBox: { backgroundColor: "#FDEAE7", borderColor: "#F1C5BE", borderWidth: 1, padding: 13, marginTop: 13, borderRadius: 13 },
  errorTitle: { color: colors.red, fontWeight: "800", fontSize: 12 },
  errorText: { color: "#713A36", fontSize: 12, lineHeight: 18, marginTop: 4 },
  retryButton: { alignSelf: "flex-start", paddingTop: 8 },
  retryText: { color: colors.red, fontSize: 12, fontWeight: "800", textDecorationLine: "underline" },
  submitButton: { marginTop: 15, minHeight: 54, paddingHorizontal: 17, backgroundColor: colors.green, borderRadius: 15, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9 },
  submitDisabled: { backgroundColor: "#A4B8AE" },
  submitPressed: { backgroundColor: colors.greenDark },
  submitText: { color: colors.white, fontSize: 14, fontWeight: "800" },
  submitArrow: { color: colors.white, fontSize: 21, marginLeft: 4, marginTop: -2 },
  privacyNote: { color: colors.muted, textAlign: "center", fontSize: 10, lineHeight: 16, marginTop: 10, paddingHorizontal: 16 },
  resultSection: { marginTop: 31 },
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
