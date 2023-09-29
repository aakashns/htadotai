import { Config, WaitUntil } from "@/config";
import { GPTMessage, generateGPTReply, transcribeAudio } from "./openai";
import {
  ConversationMessage,
  updateConversationMessages,
  getConversation,
  makeConversationId,
  shouldRateLimit,
} from "./conversations";
import { formatDateWithTimezone, logMessage } from "./analytics";

type TelegramMessage = {
  message_id: number;
  from?: { id: number; is_bot: boolean; first_name: string; last_name?: string; language_code?: string };
  chat?: { id: number; type: "private" | "group" | "supergroup" | "channel"; first_name?: string; last_name?: string };
  date: number;
  text?: string;
  voice?: { file_id: string };
  photo?: any;
  audio?: any;
  document?: any;
  video?: any;
  video_note?: any;
};

type TelegramMessageType = "text" | "image" | "audio" | "video" | "document" | "unknown";

function getTelegramMessageType(message: TelegramMessage): TelegramMessageType {
  if (message.text) {
    return "text";
  } else if (message.photo) {
    return "image";
  } else if (message.audio) {
    return "audio";
  } else if (message.document) {
    return "document";
  } else if (message.video) {
    return "video";
  } else if (message.video_note) {
    return "video";
  } else if (message.voice) {
    return "audio";
  }
  return "unknown";
}

export type TelegramWebhookBody = { update_id: number; message?: TelegramMessage };

type ReplyMarkup = { keyboard?: { text: string }[][]; one_time_keyboard?: boolean; resize_keyboard?: boolean };

type STMArgs = { telegramApiToken: string; chat_id: number; text: string; reply_markup?: ReplyMarkup };

interface STMResponse {
  ok: boolean;
  result: {
    message_id: number;
  };
}

export async function sendTelegramMessage({ telegramApiToken, chat_id, text, reply_markup = {} }: STMArgs) {
  const response: Response = await fetch(`https://api.telegram.org/bot${telegramApiToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id, text, reply_markup }),
  });
  return response.json<STMResponse>();
}

type SendTelegramAction = { telegramApiToken: string; chat_id: number; action: string };

export async function sendTelegramAction({ telegramApiToken, chat_id, action }: SendTelegramAction) {
  await fetch(`https://api.telegram.org/bot${telegramApiToken}/sendChatAction`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id, action }),
  });
}

type GetTelegramFileInfoArgs = { telegramApiToken: string; telegramFileId: string };

type GetTelegramFileInfoResponse = {
  ok: boolean;
  result?: { file_id: string; file_unique_id: string; file_size: number; file_path: string };
};

async function getTelegramFileInfo({ telegramApiToken, telegramFileId }: GetTelegramFileInfoArgs) {
  const response = await fetch(`https://api.telegram.org/bot${telegramApiToken}/getFile?file_id=${telegramFileId}`);
  return response.json<GetTelegramFileInfoResponse>();
}

type GTMTArgs = {
  telegramMessage: TelegramMessage;
  telegramApiToken: string;
  transcribeApiUrl: string;
  openaiApiKey: string;
};

async function getTelegramMessageText({ telegramApiToken, telegramMessage, transcribeApiUrl, openaiApiKey }: GTMTArgs) {
  if (telegramMessage.text) {
    return telegramMessage.text;
  } else if (telegramMessage.voice) {
    const telegramFileId = telegramMessage.voice.file_id;
    const fileInfoResponse = await getTelegramFileInfo({ telegramApiToken, telegramFileId });
    const filePath = fileInfoResponse.result?.file_path;
    if (!filePath) {
      console.error("Cannot download voice note file", { fileInfoResponse });
      return;
    }
    const fileUrl = `https://api.telegram.org/file/bot${telegramApiToken}/${filePath}`;
    const audioResponse = await fetch(fileUrl);
    const audioBlob = await audioResponse.blob();
    const { text } = await transcribeAudio({ transcribeApiUrl, openaiApiKey: openaiApiKey, audioBlob, language: "en" });
    return text;
  }
}

type PTWArgs = { config: Config; waitUntil: WaitUntil; requestBody: TelegramWebhookBody };

export async function processTelegramWebhook({ config, waitUntil, requestBody }: PTWArgs) {
  const conversationsKv = config.CONVERSATIONS_KV;
  const telegramApiToken = config.TELEGRAM_API_TOKEN;
  const telegramMessage = requestBody.message;
  const chatId = telegramMessage?.chat?.id;

  if (!chatId) {
    console.error("Required fields missing in update", { telegramMessage });
    return;
  }

  waitUntil(sendTelegramAction({ telegramApiToken, chat_id: chatId, action: "typing" }));

  const conversationId = makeConversationId("telegram", chatId);
  const conversation = await getConversation({
    conversationsKv,
    conversationId,
    expirationTtl: config.TELEGRAM_EXPIRATION_TTL,
    maxContextChars: config.TELEGRAM_MAX_CONTEXT_CHARS,
  });

  const isRateLimited = shouldRateLimit({
    messages: conversation.messages,
    window: config.TELEGRAM_RATE_LIMIT_WINDOW,
    maxMessages: config.TELEGRAM_RATE_LIMIT_MAX_MESSAGES,
  });
  if (isRateLimited) {
    const rateLimitedText = "Too many messages received! Please wait for some time and try again.";
    await sendTelegramMessage({ telegramApiToken, chat_id: chatId, text: rateLimitedText });
    return;
  }

  const messageText = await getTelegramMessageText({
    telegramApiToken,
    telegramMessage,
    transcribeApiUrl: config.TELEGRAM_TRANSCRIBE_AUDIO_URL,
    openaiApiKey: config.OPENAI_API_KEY,
  });

  waitUntil(
    logMessage({
      analyticsUrl: config.ANALYTICS_URL,
      webhookSecret: config.ANALYTICS_WEBHOOK_SECRET,
      message: {
        platform: "telegram",
        chat_id: chatId.toString(),
        sent_at: formatDateWithTimezone(new Date(telegramMessage.date * 1000)),
        role: "user",
        length: messageText?.length ?? 0,
        type: getTelegramMessageType(telegramMessage),
        language: telegramMessage.from?.language_code,
      },
    })
  );

  if (!messageText) {
    await sendTelegramMessage({
      telegramApiToken,
      chat_id: chatId,
      text: "Sorry, I can't understand messages of this type.",
    });
    return;
  }

  const userMessage: ConversationMessage = { role: "user", content: messageText, created: Date.now() };

  const systemMessage: GPTMessage = { role: "system", content: config.TELEGRAM_GPT_SYSTEM_PROMPT };
  const gptRequestBody = {
    model: config.TELEGRAM_GPT_MODEL,
    messages: [systemMessage, ...conversation.messages, userMessage],
    max_tokens: config.TELEGRAM_GPT_MAX_TOKENS,
    temperature: config.TELEGRAM_GPT_TEMPERATURE,
  };
  const gptResponseBody = await generateGPTReply({
    openaiApiKey: config.OPENAI_API_KEY,
    gptApiUrl: config.TELEGRAM_GPT_API_URL,
    body: gptRequestBody,
  });
  const gptMessage = { ...gptResponseBody.choices[0].message, created: Date.now() };
  const finishReason = gptResponseBody.choices[0].finish_reason;

  const continueKeyboard = {
    keyboard: [[{ text: "Continue" }, { text: "Ok, thanks!" }]],
    one_time_keyboard: true,
    resize_keyboard: true,
  };
  const reply_markup = finishReason === "length" ? continueKeyboard : {};
  await sendTelegramMessage({
    telegramApiToken,
    chat_id: chatId,
    text: gptMessage.content ?? "No content in reply",
    reply_markup,
  });

  await updateConversationMessages({
    conversationsKv,
    conversationId,
    newMessages: [userMessage, gptMessage],
    expirationTtl: config.TELEGRAM_EXPIRATION_TTL,
    maxContextChars: config.TELEGRAM_MAX_CONTEXT_CHARS,
  });

  waitUntil(
    logMessage({
      analyticsUrl: config.ANALYTICS_URL,
      webhookSecret: config.ANALYTICS_WEBHOOK_SECRET,
      message: {
        platform: "telegram",
        chat_id: chatId.toString(),
        sent_at: formatDateWithTimezone(new Date(gptMessage.created)),
        role: "assistant",
        length: gptMessage.content?.length ?? 0,
        type: "text",
        language: telegramMessage.from?.language_code,
      },
    })
  );
}
