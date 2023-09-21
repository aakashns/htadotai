import { Config, WaitUntil } from "@/config";
import {
  ConversationMessage,
  getConversation,
  makeConversationId,
  shouldRateLimit,
  updateConversationMessages,
} from "./conversations";
import { GPTMessage, generateGPTReply, transcribeAudio } from "./openai";

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

type WhatsAppMedia = {
  id: string;
  link: string;
  caption: string;
  filename: string;
};

type BaseWhatsAppMessage = {
  from: string;
  id: string;
  timestamp: number;
};

type WhatsAppTextMessage = BaseWhatsAppMessage & {
  type: "text";
  text: {
    body: string;
  };
};

type WhatsAppAudioMessage = BaseWhatsAppMessage & {
  type: "audio";
  audio: WhatsAppMedia;
};

type InteractiveWhatsAppMessage = BaseWhatsAppMessage & {
  type: "interactive";
  interactive: {
    type: "button_reply";
    button_reply: {
      id: string;
      title: string;
    };
  };
};

type WhatsAppOtherMessage = BaseWhatsAppMessage & {
  type:
    | "contacts"
    | "document"
    | "image"
    | "location"
    | "sticker"
    | "unknown"
    | "template";
};

type WhatsAppMessage =
  | WhatsAppTextMessage
  | WhatsAppAudioMessage
  | InteractiveWhatsAppMessage
  | WhatsAppOtherMessage;

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
  const requestBody = {
    messaging_product: "whatsapp",
    status: "read",
    message_id: messageId,
  };

  const response = await fetch(MARK_READ_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${whatsAppApiToken}`,
    },
    body: JSON.stringify(requestBody),
  });

  const responseBody = await response.json();
  return responseBody;
}

type GetWhatsAppMediaArgs = {
  whatsAppApiToken: string;
  mediaId: string;
};

type GetWhatsAppMediaResponse = {
  messaging_product: "whatsapp";
  url: string;
  mime_type: string;
  sha256: string;
  file_size: string;
  id: string;
};

async function getWhatsAppMedia({
  whatsAppApiToken,
  mediaId,
}: GetWhatsAppMediaArgs) {
  const GET_MEDIA_URL = `https://graph.facebook.com/v16.0/${mediaId}`;
  const response = await fetch(GET_MEDIA_URL, {
    headers: {
      Authorization: `Bearer ${whatsAppApiToken}`,
    },
  });
  const responseBody = await response.json<GetWhatsAppMediaResponse>();
  return responseBody;
}

type DownloadWhatsAppMediaArgs = {
  whatsAppApiToken: string;
  mediaUrl: string;
};

async function downloadWhatsAppMedia({
  whatsAppApiToken,
  mediaUrl,
}: DownloadWhatsAppMediaArgs) {
  const response = await fetch(mediaUrl, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${whatsAppApiToken}`,
      "User-Agent": "Node.js/14.17.0",
    },
  });

  return response.blob();
}

type TranscribeAudioMessageArgs = {
  whatsAppMessage: WhatsAppAudioMessage;
  whatsAppApiToken: string;
  transcribeApiUrl: string;
  openaiApiKey: string;
};

async function transcribeAudioMessage({
  whatsAppApiToken,
  whatsAppMessage,
  transcribeApiUrl,
  openaiApiKey,
}: TranscribeAudioMessageArgs) {
  const mediaId = whatsAppMessage.audio.id;
  const { url } = await getWhatsAppMedia({
    whatsAppApiToken,
    mediaId,
  });
  const audioBlob = await downloadWhatsAppMedia({
    whatsAppApiToken,
    mediaUrl: url,
  });
  return await transcribeAudio({
    transcribeApiUrl,
    openaiApiKey: openaiApiKey,
    audioBlob,
    language: "en",
  });
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
    requestBody = {
      messaging_product: "whatsapp",
      to: to,
      type: "interactive",
      interactive: {
        type: "button",
        body: {
          text: messageText,
        },
        action: {
          buttons: replyButtons.map((buttonText) => ({
            type: "reply",
            reply: { id: buttonText, title: buttonText },
          })),
        },
      },
    };
  } else {
    requestBody = {
      messaging_product: "whatsapp",
      to: to,
      type: "text",
      text: { body: messageText },
    };
  }

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
  const whatsAppMessage = requestValue.messages?.[0];
  const whatsAppApiToken = config.WHATSAPP_API_TOKEN;

  if (!whatsAppMessage) {
    return;
  }

  // Mark message as read
  waitUntil(
    markWhatsAppMessageRead({
      whatsAppApiToken,
      phoneNumberId,
      messageId: whatsAppMessage.id,
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
      whatsAppApiToken,
      phoneNumberId: phoneNumberId,
      to: whatsAppMessage.from,
      messageText:
        "Too many messages received! Please wait for some time and try again.",
    });
    return;
  }

  let messageText: string;

  if (whatsAppMessage.type === "text") {
    messageText = whatsAppMessage.text.body;
  } else if (whatsAppMessage.type === "audio") {
    const { text } = await transcribeAudioMessage({
      whatsAppApiToken,
      whatsAppMessage,
      transcribeApiUrl: config.WHATSAPP_TRANSCRIBE_AUDIO_URL,
      openaiApiKey: config.OPENAI_API_KEY,
    });
    messageText = text;
  } else if (whatsAppMessage.type === "interactive") {
    messageText = whatsAppMessage.interactive.button_reply.id;
  } else {
    // Mention message type is not supported
    await sendWhatsAppMessage({
      whatsAppApiToken,
      phoneNumberId: phoneNumberId,
      to: whatsAppMessage.from,
      messageText: `Sorry, I can't understand ${whatsAppMessage.type} messages!`,
    });
    console.error("Unsupported whatsapp message received", { whatsAppMessage });
    return;
  }

  const systemMessage: GPTMessage = {
    role: "system",
    content: config.WHATSAPP_GPT_SYSTEM_PROMPT,
  };

  const userMessage: ConversationMessage = {
    role: "user",
    content: messageText,
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
  const finishReason = gptResponseBody.choices[0].finish_reason;

  await sendWhatsAppMessage({
    whatsAppApiToken,
    phoneNumberId: phoneNumberId,
    to: whatsAppMessage.from,
    messageText: gptMessage.content ?? "No content in reply",
    replyButtons: finishReason === "length" ? ["Continue"] : undefined,
  });

  await updateConversationMessages({
    conversationsKv,
    conversationId,
    newMessages: [userMessage, gptMessage],
    expirationTtl: config.WHATSAPP_EXPIRATION_TTL,
    maxContextChars: config.WHATSAPP_MAX_CONTEXT_CHARS,
  });
}
