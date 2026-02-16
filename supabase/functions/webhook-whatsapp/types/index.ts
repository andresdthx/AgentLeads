// Types and interfaces for the webhook handler

export interface RequestPayload {
  sent_by: string;
  remote_phone_number: string;
  message: {
    text: string;
  };
  contact: {
    first_name?: string;
  };
}

export interface Lead {
  id: string;
  phone: string;
  name?: string;
  classification?: string;
  score?: number;
  extracted_data?: ExtractedData;
  current_phase?: string;
  updated_at?: string;
}

export interface Message {
  lead_id: string;
  role: "user" | "assistant";
  content: string;
}

export interface ExtractedData {
  need?: string;
  timeline?: string;
  budget?: string;
  authority?: string;
}

export interface Classification {
  score: number;
  classification: "hot" | "warm" | "cold";
  extracted: ExtractedData;
  reasoning: string;
}

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}
