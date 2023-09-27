import { Config, WaitUntil } from "@/config";
import {
  ConversationMessage,
  getConversation,
  makeConversationId,
  shouldRateLimit,
  updateConversationMessages,
} from "./conversations";
import { GPTMessage, generateGPTReply, transcribeAudio } from "./openai";

type BaseWhatsAppMessage = { from: string; id: string; timestamp: number };

type WhatsAppTextMessage = BaseWhatsAppMessage & { type: "text"; text: { body: string } };

type WhatsAppAudioMessage = BaseWhatsAppMessage & {
  type: "audio";
  audio: { id: string; link: string; caption: string; filename: string };
};

type InteractiveWhatsAppMessage = BaseWhatsAppMessage & {
  type: "interactive";
  interactive: { type: "button_reply"; button_reply: { id: string; title: string } };
};

type WhatsAppOtherMessage = BaseWhatsAppMessage & {
  type: "contacts" | "document" | "image" | "location" | "sticker" | "unknown" | "template";
};

type WhatsAppMessage = WhatsAppTextMessage | WhatsAppAudioMessage | InteractiveWhatsAppMessage | WhatsAppOtherMessage;

type WhatsAppChangeValue = {
  messaging_product: "whatsapp";
  metadata: { display_phone_number: string; phone_number_id: string };
  contacts: { profile: { name: string }; wa_id: string }[];
  messages: WhatsAppMessage[];
};

export type WhatsAppWebhookBody = {
  object: "whatsapp_business_account";
  entry?: { id: string; changes?: { value: WhatsAppChangeValue; field: "messages" }[] }[];
};

type SendWhatsAppResponse = {
  messaging_product: "whatsapp";
  contacts: { input: string; wa_id: string }[];
  messages?: { id: string }[];
};

type MarkWhatsAppMessageReadArgs = { whatsAppApiToken: string; phoneNumberId: string; messageId: string };

async function markWhatsAppMessageRead({ whatsAppApiToken, phoneNumberId, messageId }: MarkWhatsAppMessageReadArgs) {
  const MARK_READ_URL = `https://graph.facebook.com/v16.0/${phoneNumberId}/messages`;
  const requestBody = { messaging_product: "whatsapp", status: "read", message_id: messageId };
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${whatsAppApiToken}` };
  const response = await fetch(MARK_READ_URL, { method: "POST", headers, body: JSON.stringify(requestBody) });
  return response.json();
}

type GetWhatsAppMediaArgs = { whatsAppApiToken: string; mediaId: string };

type GetWhatsAppMediaResponse = {
  messaging_product: "whatsapp";
  url: string;
  mime_type: string;
  sha256: string;
  file_size: string;
  id: string;
};

async function getWhatsAppMedia({ whatsAppApiToken, mediaId }: GetWhatsAppMediaArgs) {
  const GET_MEDIA_URL = `https://graph.facebook.com/v16.0/${mediaId}`;
  const response = await fetch(GET_MEDIA_URL, { headers: { Authorization: `Bearer ${whatsAppApiToken}` } });
  return response.json<GetWhatsAppMediaResponse>();
}

type DownloadWhatsAppMediaArgs = { whatsAppApiToken: string; mediaUrl: string };

async function downloadWhatsAppMedia({ whatsAppApiToken, mediaUrl }: DownloadWhatsAppMediaArgs) {
  const response = await fetch(mediaUrl, { method: "GET", headers: { Authorization: `Bearer ${whatsAppApiToken}` } });
  return response.blob();
}

type SendWhatsAppMessageArgs = {
  whatsAppApiToken: string;
  phoneNumberId: string;
  to: string;
  messageText: string;
  replyButtons?: string[];
};

async function sendWhatsAppMessage({
  whatsAppApiToken,
  phoneNumberId,
  to,
  messageText,
  replyButtons,
}: SendWhatsAppMessageArgs) {
  const SEND_URL = `https://graph.facebook.com/v16.0/${phoneNumberId}/messages`;
  let requestBody;
  if (replyButtons?.length) {
    const buttons = replyButtons.map((buttonText) => ({ type: "reply", reply: { id: buttonText, title: buttonText } }));
    requestBody = {
      messaging_product: "whatsapp",
      to: to,
      type: "interactive",
      interactive: { type: "button", body: { text: messageText }, action: { buttons } },
    };
  } else {
    requestBody = { messaging_product: "whatsapp", to: to, type: "text", text: { body: messageText } };
  }

  const response = await fetch(SEND_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${whatsAppApiToken}` },
    body: JSON.stringify(requestBody),
  });

  const responseBody = await response.json<SendWhatsAppResponse>();
  if (!responseBody.messages?.length) {
    console.error("Failed to send message", { requestBody, responseBody });
  }
  return responseBody;
}

type GetWhatsAppGptReplyArgs = {
  systemPrompt: string;
  messages: GPTMessage[];
  max_tokens: number;
  temperature: number;
  model: string;
  openaiApiKey: string;
  gptApiUrl: string;
};

export async function getWhatsAppGptReply({
  systemPrompt,
  messages,
  max_tokens,
  temperature,
  model,
  openaiApiKey,
  gptApiUrl,
}: GetWhatsAppGptReplyArgs) {}

type GetWhatsAppMessageTextArgs = {
  whatsAppMessage: WhatsAppMessage;
  whatsAppApiToken: string;
  transcribeApiUrl: string;
  openaiApiKey: string;
};

async function getWhatsAppMessageText({
  whatsAppMessage,
  whatsAppApiToken,
  transcribeApiUrl,
  openaiApiKey,
}: GetWhatsAppMessageTextArgs) {
  if (whatsAppMessage.type === "text") {
    return whatsAppMessage.text.body;
  } else if (whatsAppMessage.type === "audio") {
    const mediaId = whatsAppMessage.audio.id;
    const { url } = await getWhatsAppMedia({ whatsAppApiToken, mediaId });
    const audioBlob = await downloadWhatsAppMedia({ whatsAppApiToken, mediaUrl: url });
    const { text } = await transcribeAudio({ transcribeApiUrl, openaiApiKey: openaiApiKey, audioBlob, language: "en" });
    return text;
  } else if (whatsAppMessage.type === "interactive") {
    return whatsAppMessage.interactive.button_reply.id;
  }
}

type ProcessWhatsAppWebhookArgs = { config: Config; waitUntil: WaitUntil; requestValue: WhatsAppChangeValue };

export async function processWhatsAppWebhook({ config, waitUntil, requestValue }: ProcessWhatsAppWebhookArgs) {
  const phoneNumberId = requestValue.metadata.phone_number_id;
  const whatsAppMessage = requestValue.messages?.[0];
  const whatsAppApiToken = config.WHATSAPP_API_TOKEN;

  if (!whatsAppMessage) {
    return;
  }

  waitUntil(markWhatsAppMessageRead({ whatsAppApiToken, phoneNumberId, messageId: whatsAppMessage.id }));

  const conversationId = makeConversationId("whatsapp", phoneNumberId);
  const conversation = await getConversation({
    conversationsKv: config.CONVERSATIONS_KV,
    conversationId,
    expirationTtl: config.WHATSAPP_EXPIRATION_TTL,
    maxContextChars: config.WHATSAPP_MAX_CONTEXT_CHARS,
  });

  const isRateLimited = shouldRateLimit({
    messages: conversation.messages,
    window: config.WHATSAPP_RATE_LIMIT_WINDOW,
    maxMessages: config.WHATSAPP_RATE_LIMIT_MAX_MESSAGES,
  });
  const RATE_LIMITED_MESSAGE = "Too many messages received! Please wait for some time and try again.";
  if (isRateLimited) {
    await sendWhatsAppMessage({
      whatsAppApiToken,
      phoneNumberId: phoneNumberId,
      to: whatsAppMessage.from,
      messageText: RATE_LIMITED_MESSAGE,
    });
    return;
  }

  const messageText = await getWhatsAppMessageText({
    whatsAppMessage,
    whatsAppApiToken,
    transcribeApiUrl: config.WHATSAPP_TRANSCRIBE_AUDIO_URL,
    openaiApiKey: config.OPENAI_API_KEY,
  });

  if (!messageText) {
    await sendWhatsAppMessage({
      whatsAppApiToken,
      phoneNumberId: phoneNumberId,
      to: whatsAppMessage.from,
      messageText: `Sorry, I can't understand ${whatsAppMessage.type} messages!`,
    });
    console.error("Unsupported whatsapp message received", { whatsAppMessage });
    return;
  }

  const userMessage: ConversationMessage = { role: "user", content: messageText, created: Date.now() };
  const systemMessage: GPTMessage = { role: "system", content: config.WHATSAPP_GPT_SYSTEM_PROMPT };
  const gptRequestBody = {
    model: config.WHATSAPP_GPT_MODEL,
    messages: [systemMessage, ...conversation.messages, userMessage],
    max_tokens: config.WHATSAPP_GPT_MAX_TOKENS,
    temperature: config.WHATSAPP_GPT_TEMPERATURE,
  };
  const gptResponseBody = await generateGPTReply({
    openaiApiKey: config.OPENAI_API_KEY,
    gptApiUrl: config.WHATSAPP_GPT_API_URL,
    body: gptRequestBody,
  });
  const gptMessage: ConversationMessage = { ...gptResponseBody.choices[0].message, created: Date.now() };
  const finishReason = gptResponseBody.choices[0].finish_reason;

  await sendWhatsAppMessage({
    whatsAppApiToken,
    phoneNumberId: phoneNumberId,
    to: whatsAppMessage.from,
    messageText: gptMessage.content ?? "No content in reply",
    replyButtons: finishReason === "length" ? ["Continue"] : undefined,
  });

  await updateConversationMessages({
    conversationsKv: config.CONVERSATIONS_KV,
    conversationId,
    newMessages: [userMessage, gptMessage],
    expirationTtl: config.WHATSAPP_EXPIRATION_TTL,
    maxContextChars: config.WHATSAPP_MAX_CONTEXT_CHARS,
  });
}
