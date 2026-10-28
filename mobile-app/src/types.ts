export type DiagnosisCitation = {
  source_id: string;
  url: string;
  title: string;
  publisher: string | null;
  snippet: string;
  score: number;
  retrieved_at: string;
};

export type DiagnosisOverview = {
  result_status: "identified" | "ambiguous" | "unrecognized";
  device: {
    category: string | null;
    brand: string | null;
    model: string | null;
    confidence: number;
  };
  observed_text: string[];
  error_codes: string[];
};

export type DiagnosisResult = {
  request_id: string;
  session_id: string;
  status: "completed" | "needs_clarification";
  overview?: DiagnosisOverview | null;
  answer: string;
  citations: DiagnosisCitation[];
  warnings: string[];
};

export type ImageSelection = {
  uri: string;
  name: string;
  mimeType: string;
  size: number | null;
  base64?: string | null;
};

export type ApiError = {
  message: string;
  requestId?: string;
  status?: number;
};
