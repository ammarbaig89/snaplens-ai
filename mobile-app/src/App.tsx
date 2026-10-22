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
  ink: "#19243A",
  muted: "#758096",
  canvas: "#F4F6FA",
  white: "#FFFFFF",
  navy: "#17233E",
  blue: "#4F68E8",
  blueDark: "#374EC5",
  blueTint: "#E9EDFF",
  teal: "#27A997",
  tealTint: "#E5F6F3",
  line: "#E5E9F1",
  soft: "#F8F9FC",
  amber: "#FFF4DF",
  amberInk: "#805719",
  red: "#B44246",
  redTint: "#FFF0EF",
};

type Tab = "home" | "diagnose" | "guide";
type DiagnosisStep = "photo" | "question" | "result";

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
  return { uri: asset.uri, name: fileName || `snaplens-photo.${safeExtension}`, mimeType, size: asset.fileSize ?? null };
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
}: {
  label: string;
  icon: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable accessibilityRole="tab" accessibilityState={{ selected }} onPress={onPress} style={styles.tabButton}>
      <View style={[styles.tabIconWrap, selected && styles.tabIconWrapSelected]}>
        <Text style={[styles.tabIcon, selected && styles.tabIconSelected]}>{icon}</Text>
      </View>
      <Text style={[styles.tabLabel, selected && styles.tabLabelSelected]}>{label}</Text>
    </Pressable>
  );
}

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>("home");
  const [diagnosisStep, setDiagnosisStep] = useState<DiagnosisStep>("photo");
  const [image, setImage] = useState<ImageSelection | null>(null);
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<DiagnosisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const beginDiagnosis = () => {
    setActiveTab("diagnose");
    setDiagnosisStep("photo");
    setError(null);
  };

  const chooseFromLibrary = async () => {
    setError(null);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Photo access needed", "Allow photo access to choose a troubleshooting image.");
      return;
    }
    const selection = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: true, quality: 0.85 });
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
    const capture = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], allowsEditing: true, quality: 0.85 });
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
      const diagnosis = await createDiagnosis(question, image);
      setResult(diagnosis);
      setDiagnosisStep("result");
    } catch (caught) {
      setError(caught instanceof DiagnosisApiError ? caught.message : "Something went wrong. Check your connection and try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const reset = () => {
    setImage(null);
    setQuestion("");
    setError(null);
    setResult(null);
    setDiagnosisStep("photo");
    setActiveTab("home");
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

  const imageSizeLabel = image?.size == null ? "Ready to analyze" : `${(image.size / (1024 * 1024)).toFixed(1)} MB photo`;
  const selectedPrompt = (value: string) => {
    setQuestion(value);
    setError(null);
  };

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.app}>
        <StatusBar barStyle="dark-content" backgroundColor={colors.canvas} />
        <View style={styles.topBar}>
          <View style={styles.brandIcon}><Text style={styles.brandIconText}>◎</Text></View>
          <View style={styles.brandCopy}>
            <Text style={styles.brandName}>SnapLens <Text style={styles.brandAI}>AI</Text></Text>
            <Text style={styles.brandCaption}>SEE IT. SOLVE IT.</Text>
          </View>
          <View style={styles.topBadge}><View style={styles.topBadgeDot} /><Text style={styles.topBadgeText}>READY</Text></View>
        </View>

        <View style={styles.screenContent}>
          {activeTab === "home" ? (
            <ScrollView contentContainerStyle={styles.pageContent} showsVerticalScrollIndicator={false}>
              <Text style={styles.greeting}>YOUR PERSONAL VISUAL ASSISTANT</Text>
              <Text style={styles.homeTitle}>What can we help{ "\n" }you figure out?</Text>
              <Text style={styles.homeIntro}>Get clear, practical guidance for the things you use every day.</Text>

              <View style={styles.homeHero}>
                <View style={styles.heroOrb}><Text style={styles.heroOrbText}>◎</Text></View>
                <View style={styles.heroTag}><Text style={styles.heroTagText}>SNAP  ·  ASK  ·  SOLVE</Text></View>
                <Text style={styles.homeHeroTitle}>Turn a confusing{ "\n" }moment into a clear next step.</Text>
                <Text style={styles.homeHeroBody}>Show us the device or error. We’ll help you understand what you’re seeing.</Text>
                <Pressable accessibilityRole="button" onPress={beginDiagnosis} style={({ pressed }) => [styles.heroCta, pressed && styles.buttonPressed]}>
                  <Text style={styles.heroCtaText}>Start a diagnosis</Text><Text style={styles.heroCtaArrow}>→</Text>
                </Pressable>
              </View>

              <View style={styles.sectionTitleRow}>
                <Text style={styles.sectionTitle}>How it works</Text>
                <Text style={styles.sectionMeta}>3 simple steps</Text>
              </View>
              <View style={styles.stepsCard}>
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
              </View>

              <Pressable accessibilityRole="button" onPress={() => setActiveTab("guide")} style={styles.tipCard}>
                <View style={styles.tipIcon}><Text style={styles.tipIconText}>✦</Text></View>
                <View style={styles.tipCopy}><Text style={styles.tipTitle}>Get better results</Text><Text style={styles.tipBody}>A few quick photo tips can make all the difference.</Text></View>
                <Text style={styles.homeStepArrow}>›</Text>
              </Pressable>
            </ScrollView>
          ) : null}

          {activeTab === "guide" ? (
            <ScrollView contentContainerStyle={styles.pageContent} showsVerticalScrollIndicator={false}>
              <Text style={styles.greeting}>SNAPLENS FIELD GUIDE</Text>
              <Text style={styles.pageTitle}>A little prep goes a long way.</Text>
              <Text style={styles.pageIntro}>Use these tips to help SnapLens understand what you’re seeing.</Text>

              <View style={styles.guideHero}><Text style={styles.guideHeroIcon}>◎</Text><Text style={styles.guideHeroTitle}>Make the important details easy to see.</Text><Text style={styles.guideHeroBody}>Good lighting and a steady photo help bring small labels and error codes into focus.</Text></View>

              <Text style={styles.sectionTitle}>Photo checklist</Text>
              <View style={styles.guideListCard}>
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
              </View>

              <View style={styles.questionTip}>
                <Text style={styles.questionTipLabel}>GOOD QUESTIONS ARE SPECIFIC</Text>
                <Text style={styles.questionTipText}>“What does this paper jam message mean?” gives us more to work with than “Help.”</Text>
              </View>
              <PrimaryButton label="Start a diagnosis" icon="＋" onPress={beginDiagnosis} />
            </ScrollView>
          ) : null}

          {activeTab === "diagnose" ? (
            <ScrollView contentContainerStyle={styles.pageContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <View style={styles.flowTopline}>
                <Pressable accessibilityRole="button" onPress={() => {
                  if (diagnosisStep === "question") setDiagnosisStep("photo");
                  else if (diagnosisStep === "result") setDiagnosisStep("question");
                  else setActiveTab("home");
                }} style={styles.backButton}><Text style={styles.backArrow}>‹</Text></Pressable>
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
                    <View style={styles.selectedPhotoCard}>
                      <Image source={{ uri: image.uri }} style={styles.selectedPreview} resizeMode="cover" accessibilityLabel="Selected troubleshooting photo" />
                      <View style={styles.selectedMeta}><View style={styles.selectedMetaCopy}><Text style={styles.selectedName} numberOfLines={1}>{image.name}</Text><Text style={styles.selectedSize}>{imageSizeLabel}</Text></View><Pressable accessibilityRole="button" onPress={() => { setImage(null); setResult(null); }}><Text style={styles.removeText}>Remove</Text></Pressable></View>
                    </View>
                  ) : (
                    <View style={styles.uploadCard}>
                      <View style={styles.uploadIcon}><Text style={styles.uploadIconText}>⌗</Text></View>
                      <Text style={styles.uploadTitle}>Your photo will appear here</Text>
                      <Text style={styles.uploadBody}>Keep the device and any error message in focus.</Text>
                      <View style={styles.formatPill}><Text style={styles.formatText}>JPG  ·  PNG  ·  WEBP  ·  MAX 10 MB</Text></View>
                    </View>
                  )}
                  <View style={styles.photoActions}>
                    <View style={styles.photoActionColumn}><PrimaryButton label="Take a photo" icon="◉" onPress={takePhoto} disabled={isLoading} /></View>
                    <View style={styles.photoActionColumn}><PrimaryButton label="Choose photo" icon="▧" onPress={chooseFromLibrary} secondary disabled={isLoading} /></View>
                  </View>
                  <View style={styles.helperCard}><Text style={styles.helperIcon}>✦</Text><Text style={styles.helperText}>Tip: move closer if the error code is small.</Text><Pressable accessibilityRole="button" onPress={() => setActiveTab("guide")}><Text style={styles.helperLink}>Photo tips</Text></Pressable></View>
                  <View style={styles.bottomAction}><PrimaryButton label="Continue to your question" icon="→" onPress={() => { setError(null); setDiagnosisStep("question"); }} disabled={!image} /></View>
                </View>
              ) : null}

              {diagnosisStep === "question" ? (
                <View>
                  <Text style={styles.flowDescription}>What would you like help understanding about this photo?</Text>
                  {image ? <Pressable accessibilityRole="button" onPress={() => setDiagnosisStep("photo")} style={styles.miniPhotoCard}><Image source={{ uri: image.uri }} style={styles.miniPreview} resizeMode="cover" /><View style={styles.miniPhotoCopy}><Text style={styles.miniPhotoLabel}>PHOTO ADDED</Text><Text style={styles.miniPhotoName} numberOfLines={1}>{image.name}</Text></View><Text style={styles.editLink}>Edit</Text></Pressable> : null}
                  <Text style={styles.inputLabel}>PICK A STARTING QUESTION</Text>
                  <View style={styles.promptRow}>
                    {["What does this mean?", "How can I fix it?"].map((prompt) => (
                      <Pressable key={prompt} accessibilityRole="button" onPress={() => { selectedPrompt(prompt); }} style={[styles.promptChip, question === prompt && styles.promptChipSelected]}><Text style={[styles.promptChipText, question === prompt && styles.promptChipTextSelected]}>{prompt}</Text></Pressable>
                    ))}
                  </View>
                  <View style={styles.inputCard}>
                    <Text style={styles.inputLabel}>YOUR QUESTION</Text>
                    <TextInput accessibilityLabel="Your troubleshooting question" editable={!isLoading} multiline maxLength={MAX_QUESTION_CHARS} onChangeText={(value) => { setQuestion(value); setError(null); }} placeholder="For example: What does this blinking red light mean?" placeholderTextColor="#929BAA" returnKeyType="default" style={styles.questionInput} textAlignVertical="top" value={question} />
                    <Text style={styles.charCount}>{question.length}/{MAX_QUESTION_CHARS.toLocaleString()}</Text>
                  </View>
                  {error ? <View accessibilityRole="alert" style={styles.errorBox}><Text style={styles.errorTitle}>We couldn’t complete that request</Text><Text style={styles.errorText}>{error}</Text><Pressable accessibilityRole="button" onPress={submit} style={styles.retryButton}><Text style={styles.retryText}>Try again</Text></Pressable></View> : null}
                  <View style={styles.bottomAction}><PrimaryButton label={isLoading ? "Looking at your photo…" : "Get troubleshooting help"} icon={isLoading ? undefined : "→"} busy={isLoading} onPress={submit} disabled={!image || !question.trim()} /></View>
                  <Text style={styles.privacyNote}>Your photo is used for this request and isn’t saved to conversation history.</Text>
                </View>
              ) : null}

              {diagnosisStep === "result" && result ? (
                <View>
                  <View style={styles.resultIntro}><View style={styles.resultIcon}><Text style={styles.resultIconText}>✓</Text></View><View style={styles.resultIntroCopy}><Text style={styles.resultEyebrow}>{result.status === "completed" ? "ANALYSIS COMPLETE" : "ONE MORE DETAIL"}</Text><Text style={styles.resultTitle}>{result.status === "completed" ? "Here’s what we found" : "Let’s narrow it down"}</Text></View></View>
                  <View style={styles.answerCard}><Text style={styles.answerLabel}>SNAPLENS GUIDANCE</Text><Text style={styles.answerText}>{result.answer}</Text></View>
                  {result.warnings.length > 0 ? <View style={styles.warningCard}><Text style={styles.warningHeading}>A note before you continue</Text>{result.warnings.map((warning, index) => <Text key={`${index}-${warning}`} style={styles.warningText}>•  {warning}</Text>)}</View> : null}
                  <View style={styles.sourcesHeader}><Text style={styles.sectionTitle}>Sources</Text><Text style={styles.sectionMeta}>{result.citations.length} references</Text></View>
                  {result.citations.length > 0 ? result.citations.map((citation) => (
                    <Pressable accessibilityRole="link" key={citation.source_id} onPress={() => void openSource(citation.url)} style={({ pressed }) => [styles.sourceCard, pressed && styles.sourcePressed]}>
                      <View style={styles.sourceIcon}><Text style={styles.sourceIconText}>↗</Text></View><View style={styles.sourceCopy}><Text style={styles.sourceTitle} numberOfLines={2}>{citation.title}</Text><Text style={styles.sourcePublisher} numberOfLines={1}>{citation.publisher || new URL(citation.url).hostname}</Text></View><Text style={styles.sourceChevron}>›</Text>
                    </Pressable>
                  )) : <View style={styles.noSources}><Text style={styles.noSourcesTitle}>No verified sources found</Text><Text style={styles.noSourcesText}>Treat this guidance as a starting point and check your device manual before repairs.</Text></View>}
                  <View style={styles.bottomAction}><PrimaryButton label="Start a new diagnosis" icon="＋" onPress={reset} /></View>
                </View>
              ) : null}
            </ScrollView>
          ) : null}
        </View>

        <View style={styles.tabBar}>
          <TabButton label="Home" icon="⌂" selected={activeTab === "home"} onPress={() => setActiveTab("home")} />
          <TabButton label="Diagnose" icon="＋" selected={activeTab === "diagnose"} onPress={beginDiagnosis} />
          <TabButton label="Guide" icon="✧" selected={activeTab === "guide"} onPress={() => setActiveTab("guide")} />
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  app: { flex: 1, backgroundColor: colors.canvas },
  topBar: { minHeight: 59, paddingHorizontal: 21, flexDirection: "row", alignItems: "center", backgroundColor: colors.canvas },
  brandIcon: { width: 40, height: 40, borderRadius: 14, backgroundColor: colors.navy, alignItems: "center", justifyContent: "center" },
  brandIconText: { color: colors.white, fontSize: 25, lineHeight: 30, fontWeight: "700" },
  brandCopy: { marginLeft: 10, flex: 1 },
  brandName: { color: colors.ink, fontWeight: "900", fontSize: 15, letterSpacing: -0.4 },
  brandAI: { color: colors.blue, fontWeight: "800" },
  brandCaption: { color: colors.muted, fontSize: 8, fontWeight: "800", letterSpacing: 1.5, marginTop: 3 },
  topBadge: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, borderRadius: 20, flexDirection: "row", alignItems: "center", paddingHorizontal: 10, paddingVertical: 7 },
  topBadgeDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.teal, marginRight: 6 },
  topBadgeText: { color: colors.navy, fontSize: 9, fontWeight: "900", letterSpacing: 0.8 },
  screenContent: { flex: 1 },
  pageContent: { paddingHorizontal: 20, paddingTop: 13, paddingBottom: 28, maxWidth: 720, width: "100%", alignSelf: "center" },
  greeting: { color: colors.blue, fontSize: 9, fontWeight: "900", letterSpacing: 1.55, marginTop: 6 },
  homeTitle: { color: colors.ink, fontSize: 29, lineHeight: 34, fontWeight: "900", letterSpacing: -1.1, marginTop: 9 },
  homeIntro: { color: colors.muted, fontSize: 13, lineHeight: 20, marginTop: 8, maxWidth: 310 },
  homeHero: { backgroundColor: colors.navy, borderRadius: 25, padding: 20, marginTop: 20, minHeight: 237, overflow: "hidden" },
  heroOrb: { position: "absolute", width: 170, height: 170, borderRadius: 85, right: -49, top: -65, backgroundColor: "#263761", borderWidth: 1, borderColor: "#344976", alignItems: "center", justifyContent: "center" },
  heroOrbText: { color: "#AAB8FC", fontSize: 84, fontWeight: "300", marginTop: 44, marginLeft: -42 },
  heroTag: { alignSelf: "flex-start", backgroundColor: "#29385B", borderRadius: 10, paddingHorizontal: 9, paddingVertical: 6 },
  heroTagText: { color: "#BEC8FF", fontSize: 8, fontWeight: "900", letterSpacing: 1.1 },
  homeHeroTitle: { color: colors.white, fontSize: 21, lineHeight: 26, fontWeight: "900", letterSpacing: -0.5, marginTop: 17 },
  homeHeroBody: { color: "#C5CDDC", fontSize: 11, lineHeight: 17, marginTop: 8, maxWidth: 235 },
  heroCta: { minHeight: 42, borderRadius: 13, paddingHorizontal: 13, marginTop: 17, backgroundColor: colors.blue, alignSelf: "flex-start", flexDirection: "row", alignItems: "center" },
  heroCtaText: { color: colors.white, fontSize: 11, fontWeight: "900" },
  heroCtaArrow: { color: colors.white, fontSize: 16, marginLeft: 13, marginTop: -2 },
  sectionTitleRow: { flexDirection: "row", alignItems: "baseline", marginTop: 24, marginBottom: 11 },
  sectionTitle: { color: colors.ink, flex: 1, fontSize: 15, fontWeight: "900", letterSpacing: -0.2 },
  sectionMeta: { color: colors.muted, fontSize: 10, fontWeight: "700" },
  stepsCard: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, borderRadius: 20, paddingHorizontal: 13 },
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
  tipCard: { backgroundColor: colors.white, borderRadius: 18, padding: 13, marginTop: 12, borderWidth: 1, borderColor: colors.line, flexDirection: "row", alignItems: "center" },
  tipIcon: { width: 32, height: 32, borderRadius: 11, backgroundColor: colors.amber, alignItems: "center", justifyContent: "center", marginRight: 10 },
  tipIconText: { color: "#C58622", fontSize: 16 },
  tipCopy: { flex: 1 },
  tipTitle: { color: colors.ink, fontSize: 10, fontWeight: "900" },
  tipBody: { color: colors.muted, fontSize: 9, lineHeight: 14, marginTop: 3 },
  pageTitle: { color: colors.ink, fontSize: 26, lineHeight: 31, fontWeight: "900", letterSpacing: -0.8, marginTop: 10 },
  pageIntro: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 8, marginBottom: 19 },
  guideHero: { borderRadius: 22, backgroundColor: colors.navy, padding: 19, marginBottom: 22 },
  guideHeroIcon: { color: "#AAB8FC", fontSize: 35, lineHeight: 42 },
  guideHeroTitle: { color: colors.white, fontSize: 16, lineHeight: 21, fontWeight: "900", marginTop: 12 },
  guideHeroBody: { color: "#C5CDDC", fontSize: 11, lineHeight: 17, marginTop: 7 },
  guideListCard: { borderRadius: 19, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 13, marginTop: 11, marginBottom: 15 },
  guideRow: { flexDirection: "row", alignItems: "center", minHeight: 64 },
  guideNumber: { width: 30, height: 30, borderRadius: 10, backgroundColor: colors.blueTint, alignItems: "center", justifyContent: "center", marginRight: 10 },
  guideNumberText: { color: colors.blueDark, fontSize: 8, fontWeight: "900" },
  guideText: { flex: 1 },
  guideTitle: { color: colors.ink, fontSize: 11, fontWeight: "800" },
  guideBody: { color: colors.muted, fontSize: 9, lineHeight: 14, marginTop: 4 },
  questionTip: { backgroundColor: colors.blueTint, borderRadius: 16, padding: 14, marginBottom: 14 },
  questionTipLabel: { color: colors.blueDark, fontSize: 8, fontWeight: "900", letterSpacing: 1.2 },
  questionTipText: { color: colors.ink, fontSize: 11, lineHeight: 17, marginTop: 7 },
  flowTopline: { flexDirection: "row", alignItems: "center", marginTop: 5 },
  backButton: { width: 36, height: 36, borderRadius: 13, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center", marginRight: 10 },
  backArrow: { color: colors.ink, fontSize: 25, lineHeight: 28, marginTop: -3 },
  flowTopCopy: { flex: 1 },
  flowEyebrow: { color: colors.blue, fontSize: 8, fontWeight: "900", letterSpacing: 1.25 },
  flowTitle: { color: colors.ink, fontSize: 15, fontWeight: "900", marginTop: 3 },
  flowCount: { color: colors.muted, fontSize: 9, fontWeight: "900", letterSpacing: 0.7 },
  progressTrack: { flexDirection: "row", gap: 5, marginTop: 15, marginBottom: 15 },
  progressSegment: { flex: 1, height: 4, borderRadius: 4, backgroundColor: "#E0E5EE" },
  progressActive: { backgroundColor: colors.blue },
  flowDescription: { color: colors.muted, fontSize: 12, lineHeight: 19, marginBottom: 14 },
  uploadCard: { minHeight: 190, borderRadius: 22, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, borderStyle: "dashed", alignItems: "center", justifyContent: "center", padding: 18 },
  uploadIcon: { width: 49, height: 49, borderRadius: 17, backgroundColor: colors.blueTint, alignItems: "center", justifyContent: "center", marginBottom: 11 },
  uploadIconText: { color: colors.blue, fontSize: 27, lineHeight: 31, fontWeight: "700" },
  uploadTitle: { color: colors.ink, fontSize: 13, fontWeight: "900" },
  uploadBody: { color: colors.muted, fontSize: 10, lineHeight: 15, textAlign: "center", marginTop: 5 },
  formatPill: { backgroundColor: colors.soft, borderRadius: 20, paddingHorizontal: 9, paddingVertical: 5, marginTop: 12 },
  formatText: { color: colors.muted, fontSize: 7, fontWeight: "900", letterSpacing: 0.7 },
  selectedPhotoCard: { overflow: "hidden", borderRadius: 21, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line },
  selectedPreview: { width: "100%", height: 205, backgroundColor: colors.soft },
  selectedMeta: { paddingHorizontal: 13, paddingVertical: 11, flexDirection: "row", alignItems: "center" },
  selectedMetaCopy: { flex: 1 },
  selectedName: { color: colors.ink, fontSize: 11, fontWeight: "800" },
  selectedSize: { color: colors.muted, fontSize: 9, marginTop: 3 },
  removeText: { color: colors.red, fontSize: 10, fontWeight: "800", paddingHorizontal: 7 },
  photoActions: { flexDirection: "row", gap: 9, marginTop: 10 },
  photoActionColumn: { flex: 1 },
  button: { minHeight: 48, borderRadius: 15, paddingHorizontal: 11, backgroundColor: colors.blue, flexDirection: "row", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.blue, gap: 7 },
  buttonSecondary: { backgroundColor: colors.white, borderColor: colors.line },
  buttonDisabled: { backgroundColor: "#B7C1D9", borderColor: "#B7C1D9" },
  buttonPressed: { opacity: 0.83, transform: [{ scale: 0.985 }] },
  buttonIcon: { color: colors.white, fontSize: 15, fontWeight: "800" },
  buttonIconSecondary: { color: colors.blue },
  buttonText: { color: colors.white, fontSize: 10, fontWeight: "900", textAlign: "center", flexShrink: 1 },
  buttonTextSecondary: { color: colors.ink },
  helperCard: { borderRadius: 13, backgroundColor: colors.tealTint, paddingHorizontal: 11, paddingVertical: 10, marginTop: 12, flexDirection: "row", alignItems: "center" },
  helperIcon: { color: colors.teal, fontSize: 13, marginRight: 7 },
  helperText: { flex: 1, color: colors.ink, fontSize: 9, lineHeight: 14 },
  helperLink: { color: colors.blueDark, fontSize: 9, fontWeight: "900", marginLeft: 5 },
  bottomAction: { marginTop: 17 },
  miniPhotoCard: { flexDirection: "row", alignItems: "center", backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, borderRadius: 15, padding: 7, marginBottom: 19 },
  miniPreview: { width: 48, height: 48, borderRadius: 10, backgroundColor: colors.soft },
  miniPhotoCopy: { flex: 1, marginLeft: 10 },
  miniPhotoLabel: { color: colors.teal, fontSize: 8, fontWeight: "900", letterSpacing: 0.9 },
  miniPhotoName: { color: colors.ink, fontSize: 10, fontWeight: "700", marginTop: 4 },
  editLink: { color: colors.blueDark, fontSize: 10, fontWeight: "900", paddingHorizontal: 9 },
  inputLabel: { color: colors.muted, fontSize: 8, fontWeight: "900", letterSpacing: 1.05, marginBottom: 8 },
  promptRow: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginBottom: 11 },
  promptChip: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, borderRadius: 20, paddingHorizontal: 11, paddingVertical: 8 },
  promptChipSelected: { backgroundColor: colors.blueTint, borderColor: "#C9D1FF" },
  promptChipText: { color: colors.navy, fontSize: 9, fontWeight: "800" },
  promptChipTextSelected: { color: colors.blueDark },
  inputCard: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, borderRadius: 18, paddingHorizontal: 13, paddingTop: 12, paddingBottom: 9 },
  questionInput: { minHeight: 100, color: colors.ink, fontSize: 14, lineHeight: 21, padding: 0 },
  charCount: { alignSelf: "flex-end", color: colors.muted, fontSize: 9, marginTop: 5 },
  errorBox: { backgroundColor: colors.redTint, borderColor: "#F1C9C7", borderWidth: 1, padding: 13, marginTop: 12, borderRadius: 15 },
  errorTitle: { color: colors.red, fontWeight: "900", fontSize: 11 },
  errorText: { color: "#753D40", fontSize: 10, lineHeight: 16, marginTop: 4 },
  retryButton: { alignSelf: "flex-start", paddingTop: 8 },
  retryText: { color: colors.red, fontSize: 10, fontWeight: "900", textDecorationLine: "underline" },
  privacyNote: { color: colors.muted, textAlign: "center", fontSize: 9, lineHeight: 14, marginTop: 9, paddingHorizontal: 13 },
  resultIntro: { flexDirection: "row", alignItems: "center", marginTop: 3, marginBottom: 14 },
  resultIcon: { width: 39, height: 39, borderRadius: 14, backgroundColor: colors.tealTint, alignItems: "center", justifyContent: "center", marginRight: 11 },
  resultIconText: { color: colors.teal, fontSize: 19, fontWeight: "900" },
  resultIntroCopy: { flex: 1 },
  resultEyebrow: { color: colors.teal, fontSize: 8, fontWeight: "900", letterSpacing: 1.2 },
  resultTitle: { color: colors.ink, fontSize: 15, fontWeight: "900", marginTop: 3 },
  answerCard: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, borderRadius: 19, padding: 15 },
  answerLabel: { color: colors.blue, fontSize: 8, fontWeight: "900", letterSpacing: 1.1, marginBottom: 8 },
  answerText: { color: colors.ink, fontSize: 13, lineHeight: 21 },
  warningCard: { backgroundColor: colors.amber, borderRadius: 15, padding: 13, marginTop: 10 },
  warningHeading: { color: colors.amberInk, fontSize: 10, fontWeight: "900", marginBottom: 6 },
  warningText: { color: colors.amberInk, fontSize: 10, lineHeight: 16, marginTop: 3 },
  sourcesHeader: { flexDirection: "row", alignItems: "center", marginTop: 20, marginBottom: 9 },
  sourceCard: { backgroundColor: colors.white, borderRadius: 15, borderWidth: 1, borderColor: colors.line, padding: 11, flexDirection: "row", alignItems: "center", marginBottom: 8 },
  sourcePressed: { backgroundColor: colors.soft },
  sourceIcon: { width: 31, height: 31, borderRadius: 10, backgroundColor: colors.blueTint, justifyContent: "center", alignItems: "center", marginRight: 9 },
  sourceIconText: { color: colors.blueDark, fontSize: 16, fontWeight: "900" },
  sourceCopy: { flex: 1, paddingRight: 5 },
  sourceTitle: { color: colors.ink, fontSize: 10, fontWeight: "800", lineHeight: 15 },
  sourcePublisher: { color: colors.muted, fontSize: 9, marginTop: 3 },
  sourceChevron: { color: colors.muted, fontSize: 21, marginLeft: 3 },
  noSources: { backgroundColor: colors.soft, borderRadius: 14, padding: 13 },
  noSourcesTitle: { color: colors.ink, fontSize: 10, fontWeight: "900" },
  noSourcesText: { color: colors.muted, fontSize: 9, lineHeight: 14, marginTop: 5 },
  tabBar: { height: 64, flexDirection: "row", alignItems: "center", justifyContent: "space-around", backgroundColor: colors.white, borderTopWidth: 1, borderTopColor: colors.line, paddingHorizontal: 14 },
  tabButton: { width: 76, alignItems: "center", justifyContent: "center", minHeight: 58 },
  tabIconWrap: { width: 31, height: 27, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  tabIconWrapSelected: { backgroundColor: colors.blueTint },
  tabIcon: { color: colors.muted, fontSize: 18, lineHeight: 22, fontWeight: "700" },
  tabIconSelected: { color: colors.blueDark },
  tabLabel: { color: colors.muted, fontSize: 7, fontWeight: "800", marginTop: 2 },
  tabLabelSelected: { color: colors.blueDark },
});
