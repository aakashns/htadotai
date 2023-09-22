import { Config, WaitUntil } from "@/config";
import { GPTMessage, generateGPTReply, transcribeAudio } from "./openai";
import {
  ConversationMessage,
  updateConversationMessages,
  deleteConversation,
  getConversation,
  makeConversationId,
  shouldRateLimit,
} from "./conversations";

type TelegramMessage = {
  message_id: number;
  from?: {
    id: number;
    is_bot: boolean;
    first_name: string;
    last_name?: string;
    language_code?: string;
  };
  chat?: {
    id: number;
    type: "private" | "group" | "supergroup" | "channel";
    first_name?: string;
    last_name?: string;
  };
  date: number;
  text?: string;
  voice?: {
    file_id: string;
  };
};

export type TelegramWebhookBody = {
  update_id: number;
  message?: TelegramMessage;
};

interface SendTelegramMessageArgs {
  telegramApiToken: string;
  chat_id: number;
  text: string;
  reply_markup?: {
    keyboard?: { text: string }[][];
    one_time_keyboard?: boolean;
    resize_keyboard?: boolean;
  };
}

export async function sendTelegramMessage({
  telegramApiToken,
  chat_id,
  text,
  reply_markup = {},
}: SendTelegramMessageArgs) {
  const SEND_URL = `https://api.telegram.org/bot${telegramApiToken}/sendMessage`;

  const requestBody = {
    chat_id,
    text,
    reply_markup,
  };

  const response: Response = await fetch(SEND_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  const responseJson = await response.json();

  return responseJson;
}

interface SendTelegramAction {
  telegramApiToken: string;
  chat_id: number;
  action: string;
}

export async function sendTelegramAction({
  telegramApiToken,
  chat_id,
  action,
}: SendTelegramAction) {
  const SEND_URL = `https://api.telegram.org/bot${telegramApiToken}/sendChatAction`;
  await fetch(SEND_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      chat_id,
      action,
    }),
  });
}

type GetTelegramFileInfoArgs = {
  telegramApiToken: string;
  telegramFileId: string;
};

async function getTelegramFileInfo({
  telegramApiToken,
  telegramFileId,
}: GetTelegramFileInfoArgs) {
  const url = `https://api.telegram.org/bot${telegramApiToken}/getFile?file_id=${telegramFileId}`;
  const response = await fetch(url);
  return response.json<{ file_path: string }>();
}

type TranscribeTelegramVoiceMessageArgs = {
  telegramFileId: string;
  telegramApiToken: string;
  transcribeApiUrl: string;
  openaiApiKey: string;
};

async function transcribeTelegramVoiceMessage({
  telegramApiToken,
  telegramFileId,
  transcribeApiUrl,
  openaiApiKey,
}: TranscribeTelegramVoiceMessageArgs) {
  const fileInfoResponse = await getTelegramFileInfo({
    telegramApiToken,
    telegramFileId,
  });
  const { file_path } = fileInfoResponse;
  const fileUrl = `https://api.telegram.org/file/bot${telegramApiToken}/${file_path}`;
  const audioResponse = await fetch(fileUrl);
  const audioBlob = new Blob([await audioResponse.blob()], {
    type: "audio/ogg",
  });
  return transcribeAudio({
    transcribeApiUrl,
    openaiApiKey: openaiApiKey,
    audioBlob,
    language: "en",
  });
}

const CLEAR_HISTORY_COMMANDS = [
  "clear",
  "/clear",
  "reset",
  "/reset",
  "delete",
  "/delete",
];

interface ProcessTelegramWebhookArgs {
  config: Config;
  waitUntil: WaitUntil;
  requestBody: TelegramWebhookBody;
}

export async function processTelegramWebhook({
  config,
  waitUntil,
  requestBody,
}: ProcessTelegramWebhookArgs) {
  const conversationsKv = config.CONVERSATIONS_KV;
  const telegramMessage = requestBody.message;
  const chatId = telegramMessage?.chat?.id;

  if (!chatId) {
    console.error("Required fields missing in update", { telegramMessage });
    return;
  }

  // Send "typing..." status
  waitUntil(
    sendTelegramAction({
      telegramApiToken: config.TELEGRAM_API_TOKEN,
      chat_id: chatId,
      action: "typing",
    })
  );

  // get stored conversation history
  const conversationId = makeConversationId("telegram", chatId);
  const conversation = await getConversation({
    conversationsKv,
    conversationId,
    expirationTtl: config.TELEGRAM_EXPIRATION_TTL,
    maxContextChars: config.TELEGRAM_MAX_CONTEXT_CHARS,
  });

  // rate limit if required
  if (
    shouldRateLimit({
      messages: conversation.messages,
      window: config.TELEGRAM_RATE_LIMIT_WINDOW,
      maxMessages: config.TELEGRAM_RATE_LIMIT_MAX_MESSAGES,
    })
  ) {
    await sendTelegramMessage({
      telegramApiToken: config.TELEGRAM_API_TOKEN,
      chat_id: chatId,
      text: "Too many messages received! Please wait for some time and try again.",
    });

    return;
  }

  let messageText;

  if (telegramMessage.text) {
    messageText = telegramMessage.text;
  } else if (telegramMessage.voice) {
    console.log("Telegram voice note received", { telegramMessage });
    const { text } = await transcribeTelegramVoiceMessage({
      telegramApiToken: config.TELEGRAM_API_TOKEN,
      telegramFileId: telegramMessage.voice.file_id,
      transcribeApiUrl: config.WHATSAPP_TRANSCRIBE_AUDIO_URL,
      openaiApiKey: config.OPENAI_API_KEY,
    });
    messageText = text;
  } else {
    await sendTelegramMessage({
      telegramApiToken: config.TELEGRAM_API_TOKEN,
      chat_id: chatId,
      text: "Sorry, I can't understand messages of this type.",
    });
    return;
  }

  // clear history if the user asked for it
  if (CLEAR_HISTORY_COMMANDS.includes(messageText.toLowerCase().trim())) {
    await deleteConversation({ conversationsKv, conversationId });
    await sendTelegramMessage({
      telegramApiToken: config.TELEGRAM_API_TOKEN,
      chat_id: chatId,
      text: "I've deleted your conversation history. You can now start a fresh conversation!",
    });
    return;
  }

  // Send the message to OpenAI
  const systemMessage: GPTMessage = {
    role: "system",
    content: config.TELEGRAM_GPT_SYSTEM_PROMPT,
  };

  const userMessage: ConversationMessage = {
    role: "user",
    content: messageText,
    created: Date.now(),
  };

  const gptRequestBody = {
    model: config.TELEGRAM_GPT_MODEL,
    messages: [systemMessage, ...conversation.messages, userMessage],
    max_tokens: config.TELEGRAM_GPT_MAX_TOKENS,
    temperature: config.TELEGRAM_GPT_TEMPERATURE,
  };

  const gptResponseBody = await generateGPTReply({
    openaiApiKey: config.OPENAI_API_KEY,
    apiUrl: config.TELEGRAM_GPT_API_URL,
    body: gptRequestBody,
  });

  const gptMessage: ConversationMessage = {
    ...gptResponseBody.choices[0].message,
    created: Date.now(),
  };
  const finishReason = gptResponseBody.choices[0].finish_reason;

  // Send the reply to Telegram
  await sendTelegramMessage({
    telegramApiToken: config.TELEGRAM_API_TOKEN,
    chat_id: chatId,
    text: gptMessage.content ?? "No content in reply",
    reply_markup:
      finishReason === "length"
        ? {
            keyboard: [[{ text: "Continue" }, { text: "Ok, thanks!" }]],
            one_time_keyboard: true,
            resize_keyboard: true,
          }
        : {},
  });

  // Update the conversation history
  await updateConversationMessages({
    conversationsKv,
    conversationId,
    newMessages: [userMessage, gptMessage],
    expirationTtl: config.TELEGRAM_EXPIRATION_TTL,
    maxContextChars: config.TELEGRAM_MAX_CONTEXT_CHARS,
  });
}
