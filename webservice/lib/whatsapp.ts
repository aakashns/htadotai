import { Config, WaitUntil } from "@/config";
import {
  ConversationMessage,
  getConversation,
  makeConversationId,
  shouldRateLimit,
  updateConversationMessages,
} from "./conversations";
import { GPTMessage, generateGPTReply } from "./openai";

type WhatsAppMetadata = {
  display_phone_number: string;
  phone_number_id: string;
};

type WhatsAppContact = {
  profile: {
    name: string;
  };
  wa_id: string;
};

type WhatsAppMessage = {
  from: string;
  id: string;
  timestamp: number;
  text: {
    body: string;
  };
  type: string;
};

type WhatsAppChangeValue = {
  messaging_product: "whatsapp";
  metadata: WhatsAppMetadata;
  contacts: WhatsAppContact[];
  messages: WhatsAppMessage[];
};

export type WhatsAppWebhookBody = {
  object: "whatsapp_business_account";
  entry?: {
    id: string; // WhatsApp Business Account ID
    changes?: {
      value: WhatsAppChangeValue;
      field: "messages";
    }[];
  }[];
};

type SendWhatsAppResponse = {
  messaging_product: "whatsapp";
  contacts: {
    input: string;
    wa_id: string;
  }[];
  messages?: {
    id: string;
  }[];
};

type MarkWhatsAppMessageReadArgs = {
  whatsAppApiToken: string;
  phoneNumberId: string;
  messageId: string;
};

async function markWhatsAppMessageRead({
  whatsAppApiToken,
  phoneNumberId,
  messageId,
}: MarkWhatsAppMessageReadArgs) {
  const MARK_READ_URL = `https://graph.facebook.com/v16.0/${phoneNumberId}/messages`;

  return fetch(MARK_READ_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${whatsAppApiToken}`,
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      status: "read",
      message_id: messageId,
    }),
  });
}

type SendWhatsAppMessageArgs = {
  whatsAppApiToken: string;
  phoneNumberId: string;
  to: string;
  messageText: string;
};

async function sendWhatsAppMessage({
  whatsAppApiToken,
  phoneNumberId,
  to,
  messageText,
}: SendWhatsAppMessageArgs) {
  const SEND_URL = `https://graph.facebook.com/v16.0/${phoneNumberId}/messages`;

  const requestBody = {
    messaging_product: "whatsapp",
    to: to,
    type: "text",
    text: { body: messageText },
  };

  const response = await fetch(SEND_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${whatsAppApiToken}`,
    },
    body: JSON.stringify(requestBody),
  });

  const responseBody = await response.json<SendWhatsAppResponse>();
  if (!responseBody.messages?.length) {
    console.error("Failed to send message", { requestBody, responseBody });
  }

  return responseBody;
}

interface ProcessWhatsAppWebhookArgs {
  config: Config;
  waitUntil: WaitUntil;
  requestValue: WhatsAppChangeValue;
}

export async function processWhatsAppWebhook({
  config,
  waitUntil,
  requestValue,
}: ProcessWhatsAppWebhookArgs) {
  const conversationsKv = config.CONVERSATIONS_KV;
  const phoneNumberId = requestValue.metadata.phone_number_id;
  const whatsappMessage = requestValue.messages[0];

  // Mark message as read
  waitUntil(
    markWhatsAppMessageRead({
      whatsAppApiToken: config.WHATSAPP_API_TOKEN,
      phoneNumberId,
      messageId: whatsappMessage.id,
    })
  );

  // Get conversation history
  const conversationId = makeConversationId("whatsapp", phoneNumberId);
  const conversation = await getConversation({
    conversationsKv,
    conversationId,
    expirationTtl: config.WHATSAPP_EXPIRATION_TTL,
    maxContextChars: config.WHATSAPP_MAX_CONTEXT_CHARS,
  });

  // Rate limit if required
  if (
    shouldRateLimit({
      messages: conversation.messages,
      window: config.WHATSAPP_RATE_LIMIT_WINDOW,
      maxMessages: config.WHATSAPP_RATE_LIMIT_MAX_MESSAGES,
    })
  ) {
    // Send rate limited message
    await sendWhatsAppMessage({
      whatsAppApiToken: config.WHATSAPP_API_TOKEN,
      phoneNumberId: phoneNumberId,
      to: whatsappMessage.from,
      messageText:
        "Too many messages received! Please wait for some time and try again.",
    });
    return;
  }

  if (whatsappMessage.type !== "text") {
    // Mention message type is not supported
    await sendWhatsAppMessage({
      whatsAppApiToken: config.WHATSAPP_API_TOKEN,
      phoneNumberId: phoneNumberId,
      to: whatsappMessage.from,
      messageText: `I can't understand messages of the type "${whatsappMessage.type}"`,
    });
    return;
  }

  // Send the message to OpenAI
  const systemMessage: GPTMessage = {
    role: "system",
    content: config.WHATSAPP_GPT_SYSTEM_PROMPT,
  };

  const userMessage: ConversationMessage = {
    role: "user",
    content: whatsappMessage.text.body,
    created: Date.now(),
  };

  const gptRequestBody = {
    model: config.WHATSAPP_GPT_MODEL,
    messages: [systemMessage, ...conversation.messages, userMessage],
    max_tokens: config.WHATSAPP_GPT_MAX_TOKENS,
    temperature: config.WHATSAPP_GPT_TEMPERATURE,
  };

  const gptResponseBody = await generateGPTReply({
    openaiApiKey: config.OPENAI_API_KEY,
    apiUrl: config.WHATSAPP_GPT_API_URL,
    body: gptRequestBody,
  });

  const gptMessage: ConversationMessage = {
    ...gptResponseBody.choices[0].message,
    created: Date.now(),
  };

  // send message to WhatsApp
  await sendWhatsAppMessage({
    whatsAppApiToken: config.WHATSAPP_API_TOKEN,
    phoneNumberId: phoneNumberId,
    to: whatsappMessage.from,
    messageText: gptMessage.content ?? "No content in reply",
  });

  await updateConversationMessages({
    conversationsKv,
    conversationId,
    newMessages: [userMessage, gptMessage],
    expirationTtl: config.WHATSAPP_EXPIRATION_TTL,
    maxContextChars: config.WHATSAPP_MAX_CONTEXT_CHARS,
  });
}
