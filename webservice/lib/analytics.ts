const ANALYTICS_WEBHOOK_SECRET_HEADER = "X-Analytics-Secret-Token";

export type AnalyticsMessage = {
  message_id: string;
  chat_id: string;
  platform: "whatsapp" | "telegram";
  sent_at: number;
  type: string;
  role: string;
  length: number;
  content?: string;
  language?: string;
};

type LogMessagesArgs = {
  analyticsUrl?: string;
  webhookSecret?: string;
  messages: AnalyticsMessage[];
};

export async function logMessages({ messages, analyticsUrl, webhookSecret }: LogMessagesArgs) {
  if (analyticsUrl && webhookSecret) {
    const headers = { [ANALYTICS_WEBHOOK_SECRET_HEADER]: webhookSecret, "Content-Type": "application/json" };
    return fetch(analyticsUrl, { headers, method: "POST", body: JSON.stringify({ messages }) });
  }
}

type LogMessageArgs = {
  analyticsUrl?: string;
  webhookSecret?: string;
  message: AnalyticsMessage;
};

export async function logMessage({ message, analyticsUrl, webhookSecret }: LogMessageArgs) {
  return logMessages({ messages: [message], analyticsUrl, webhookSecret });
}
