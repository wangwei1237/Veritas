export enum CheckStatus {
  ACCURATE = "ACCURATE",
  PARAPHRASED = "PARAPHRASED",
  MISATTRIBUTED = "MISATTRIBUTED",
  UNVERIFIABLE = "UNVERIFIABLE",
}

export interface VerificationItem {
  location: string;
  quote_text: string;
  claimed_source: string;
  status: CheckStatus;
  notes: string;
}

export interface AnalysisStats {
  accurate: number;
  paraphrased: number;
  misattributed: number;
  unverifiable: number;
  total: number;
}

export interface FileUploadState {
  fileName: string | null;
  content: string | null;
  isProcessing: boolean;
}