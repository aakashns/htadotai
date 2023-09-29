const ANALYTICS_WEBHOOK_SECRET_HEADER = "X-Analytics-Secret-Token";

export function formatDateWithTimezone(date: Date) {
  let tzo = -date.getTimezoneOffset(),
    dif = tzo >= 0 ? "+" : "-",
    pad = function (num: number): string {
      let norm = Math.floor(Math.abs(num));
      return (norm < 10 ? "0" : "") + norm;
    };
  return (
    date.getFullYear() +
    "-" +
    pad(date.getMonth() + 1) +
    "-" +
    pad(date.getDate()) +
    "T" +
    pad(date.getHours()) +
    ":" +
    pad(date.getMinutes()) +
    ":" +
    pad(date.getSeconds()) +
    dif +
    pad(tzo / 60) +
    ":" +
    pad(tzo % 60)
  );
}

export type AnalyticsMessage = {
  message_id: string;
  chat_id: string;
  platform: "whatsapp" | "telegram";
  sent_at: string;
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
