import { Blob as ExpoBlob } from "expo-blob";
import { API_BASE_URL, MAX_IMAGE_BYTES, MAX_QUESTION_CHARS, SUPPORTED_IMAGE_TYPES } from "./config";
import type { ApiError, DiagnosisOverview, DiagnosisResult, ImageSelection } from "./types";

export class DiagnosisApiError extends Error {
  readonly requestId?: string;
  readonly status?: number;

  constructor(error: ApiError) {
    super(error.message);
    this.name = "DiagnosisApiError";
    this.requestId = error.requestId;
    this.status = error.status;
  }
}

export function validateDiagnosisInput(
  question: string,
  image: ImageSelection | null,
): string | null {
  const trimmedQuestion = question.trim();
  if (!image) return "Take a photo or choose one from your library first.";
  if (!trimmedQuestion) return "Add a question so SnapLens knows what to check.";
  if (trimmedQuestion.length > MAX_QUESTION_CHARS) {
    return `Keep your question under ${MAX_QUESTION_CHARS.toLocaleString()} characters.`;
  }
  if (!SUPPORTED_IMAGE_TYPES.has(image.mimeType.toLowerCase())) {
    return "Choose a JPEG, PNG, or WebP image.";
  }
  if (image.size !== null && image.size > MAX_IMAGE_BYTES) {
    return "This photo is larger than 10 MB. Choose a smaller image.";
  }
  return null;
}

function isDiagnosisOverview(value: unknown): value is DiagnosisOverview {
  if (!value || typeof value !== "object") return false;
  const overview = value as Partial<DiagnosisOverview>;
  const device = overview.device;
  return (
    (overview.result_status === "identified" || overview.result_status === "ambiguous" || overview.result_status === "unrecognized") &&
    Boolean(device && typeof device === "object") &&
    (typeof device?.category === "string" || device?.category === null) &&
    (typeof device?.brand === "string" || device?.brand === null) &&
    (typeof device?.model === "string" || device?.model === null) &&
    typeof device?.confidence === "number" &&
    Array.isArray(overview.observed_text) && overview.observed_text.every((item) => typeof item === "string") &&
    Array.isArray(overview.error_codes) && overview.error_codes.every((item) => typeof item === "string")
  );
}

function isDiagnosisResult(value: unknown): value is DiagnosisResult {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<DiagnosisResult>;
  return (
    typeof item.request_id === "string" &&
    typeof item.session_id === "string" &&
    (item.status === "completed" || item.status === "needs_clarification") &&
    (item.overview === undefined || item.overview === null || isDiagnosisOverview(item.overview)) &&
    typeof item.answer === "string" &&
    Array.isArray(item.citations) &&
    item.citations.every((citation) => {
      if (!citation || typeof citation !== "object") return false;
      const source = citation as DiagnosisResult["citations"][number];
      return (
        typeof source.source_id === "string" &&
        typeof source.title === "string" &&
        (typeof source.publisher === "string" || source.publisher === null) &&
        typeof source.snippet === "string" &&
        typeof source.score === "number" &&
        typeof source.retrieved_at === "string" &&
        safeCitationUrl(source.url) !== null
      );
    }) &&
    Array.isArray(item.warnings) &&
    item.warnings.every((warning) => typeof warning === "string")
  );
}

async function readError(response: Response): Promise<DiagnosisApiError> {
  let message = "SnapLens could not complete the diagnosis. Please try again.";
  let requestId: string | undefined;
  let errorCode: string | undefined;
  let hasServerMessage = false;
  try {
    const rawText = await response.text();
    console.error(`[SnapLens Gateway Error Status ${response.status}]:`, rawText);
    try {
      const payload = JSON.parse(rawText);
      const detail = payload?.error || payload?.detail;
      if (typeof detail === "string") {
        message = detail;
        hasServerMessage = true;
      } else if (typeof detail?.message === "string") {
        message = detail.message;
        hasServerMessage = true;
      }
      if (typeof detail?.code === "string") errorCode = detail.code;
      if (typeof payload?.error?.request_id === "string") requestId = payload.error.request_id;
    } catch {
      if (rawText) message = rawText;
    }
    if (response.status === 422) {
      message = "Check that your question and photo are valid, then try again.";
    }
  } catch {
    if (response.status === 413) message = "This photo is too large. Choose an image under 10 MB.";
    else if (response.status === 415) message = "Use a JPEG, PNG, or WebP photo.";
  }
  if ((response.status === 502 || response.status === 503) && (!hasServerMessage || errorCode?.startsWith("UPSTREAM_"))) {
    message = errorCode === "UPSTREAM_FAILURE"
      ? `The gateway was reached, but an internal diagnosis service failed. Check the backend terminal for request ID ${requestId || "shown in the error log"}.`
      : "The diagnosis service is temporarily unavailable. Try again shortly.";
  }
  if (response.status === 504 && !hasServerMessage) {
    message = "The diagnosis took too long. Check your connection and retry.";
  }
  return new DiagnosisApiError({ message, requestId, status: response.status });
}

export async function createDiagnosis(
  question: string,
  image: ImageSelection,
): Promise<DiagnosisResult> {
  const validationError = validateDiagnosisInput(question, image);
  if (validationError) throw new DiagnosisApiError({ message: validationError });

  const form = new FormData();
  form.append("question", question.trim());

  let imageBlob: unknown;
  if (image.base64) {
    const binary = atob(image.base64);
    const array = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      array[i] = binary.charCodeAt(i);
    }
    imageBlob = new ExpoBlob([array], { type: image.mimeType });
  } else {
    const imageResponse = await fetch(image.uri);
    const rawBlob = await imageResponse.blob();
    imageBlob = rawBlob.type ? rawBlob : new ExpoBlob([rawBlob], { type: image.mimeType });
  }

  const ext = image.mimeType === "image/png" ? "png" : image.mimeType === "image/webp" ? "webp" : "jpg";
  const fileName = (image.name && image.name.includes(".")) ? image.name : `photo.${ext}`;
  form.append("image", imageBlob as unknown as Blob, fileName);

  let response: Response;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 100_000);
  try {
    response = await fetch(`${API_BASE_URL}/v1/diagnoses`, {
      method: "POST",
      headers: { Accept: "application/json" },
      body: form,
      signal: controller.signal,
    });
  } catch (error) {
    console.error("[SnapLens API Error]:", error, "URL:", `${API_BASE_URL}/v1/diagnoses`);
    if (error instanceof Error && error.name === "AbortError") {
      throw new DiagnosisApiError({
        message: "The diagnosis took too long. Check your connection and retry.",
      });
    }
    const reason = error instanceof Error ? ` (${error.message})` : "";
    throw new DiagnosisApiError({
      message: `Could not reach the SnapLens Gateway at ${API_BASE_URL}${reason}. Check that the backend is running and the app's API address is correct.`,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) throw await readError(response);
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new DiagnosisApiError({ message: "The server returned an unreadable response." });
  }
  if (!isDiagnosisResult(body)) {
    throw new DiagnosisApiError({ message: "The server response did not match the diagnosis format." });
  }
  return body;
}

export function safeCitationUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}
