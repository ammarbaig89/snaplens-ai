import { API_BASE_URL, MAX_IMAGE_BYTES, MAX_QUESTION_CHARS, SUPPORTED_IMAGE_TYPES } from "./config";
import type { ApiError, DiagnosisResult, ImageSelection } from "./types";

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

function isDiagnosisResult(value: unknown): value is DiagnosisResult {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<DiagnosisResult>;
  return (
    typeof item.request_id === "string" &&
    typeof item.session_id === "string" &&
    (item.status === "completed" || item.status === "needs_clarification") &&
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
  try {
    const payload = await response.json();
    const detail = payload?.error;
    if (typeof detail?.message === "string") message = detail.message;
    if (typeof detail?.request_id === "string") requestId = detail.request_id;
    if (response.status === 422) {
      message = "Check that your question and photo are valid, then try again.";
    }
  } catch {
    if (response.status === 413) message = "This photo is too large. Choose an image under 10 MB.";
    else if (response.status === 415) message = "Use a JPEG, PNG, or WebP photo.";
  }
  if (response.status === 502 || response.status === 503) {
    message = "The diagnosis service is temporarily unavailable. Try again shortly.";
  }
  if (response.status === 504) {
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
  form.append(
    "image",
    {
      uri: image.uri,
      name: image.name,
      type: image.mimeType,
    } as unknown as Blob,
  );

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
    if (error instanceof Error && error.name === "AbortError") {
      throw new DiagnosisApiError({
        message: "The diagnosis took too long. Check your connection and retry.",
      });
    }
    throw new DiagnosisApiError({
      message: `Could not reach the SnapLens Gateway at ${API_BASE_URL}. Check that the backend is running and the app's API address is correct.`,
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
