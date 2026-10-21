const defaultGatewayUrl = "http://10.0.2.2:8000";

/** Public client configuration only. Provider credentials stay on the backend. */
export const API_BASE_URL = (
  process.env.EXPO_PUBLIC_API_BASE_URL || defaultGatewayUrl
).replace(/\/$/, "");

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_QUESTION_CHARS = 2000;
export const SUPPORTED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);
