import { Config } from "@/config";
import { GPTMessage, generateGPTReply } from "./openai";

export type ConversationMessage = GPTMessage & {
  created?: number;
};

interface Conversation {
  messages: ConversationMessage[];
}

export type TelegramWebhookBody = {
  update_id: number;
  message?: {
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
  };
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

type ShouldRateLimitOptions = {
  windowMs: number;
  maxMessages: number;
  messages: ConversationMessage[];
};

export function shouldRateLimit({
  windowMs,
  maxMessages,
  messages,
}: ShouldRateLimitOptions): boolean {
  const currentTimestamp = Date.now();
  let recentMessagesCount = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (!message.created || message.created < currentTimestamp - windowMs) {
      break;
    }
    recentMessagesCount++;
    if (recentMessagesCount > maxMessages) {
      return true;
    }
  }
  return false;
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

export function keepLatestMessages(messages: ConversationMessage[]) {
  const cutoffDate = Date.now() - 3 * 60 * 60 * 1000;
  let totalContentLength = 0;
  let result = [];

  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    const contentLength = message.content?.length || 0;

    if (!message.created || message.created < cutoffDate) {
      break;
    } else if (totalContentLength + contentLength <= 5000) {
      totalContentLength += contentLength;
      result.push(message);
    } else {
      break;
    }
  }

  return result.sort((a, b) => (a.created || 0) - (b.created || 0));
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

interface GetConversationArgs {
  conversationsKV: KVNamespace;
  chatId: number;
}

export async function getConversation({
  conversationsKV,
  chatId,
}: GetConversationArgs) {
  const chatIdStr = chatId.toString();
  const conversationStr = await conversationsKV.get(chatIdStr);
  const conversation = conversationStr
    ? (JSON.parse(conversationStr) as Conversation)
    : { messages: [] };
  return conversation;
}

interface PutConversationArgs {
  conversationsKV: KVNamespace;
  chatId: number;
  conversation: Conversation;
}

async function putConversation({
  conversationsKV,
  chatId,
  conversation,
}: PutConversationArgs) {
  await conversationsKV.put(chatId.toString(), JSON.stringify(conversation), {
    expirationTtl: 3 * 60 * 60,
  });
}

interface UpdateConversationArgs {
  conversationsKV: KVNamespace;
  chatId: number;
  newMessages: ConversationMessage[];
}

export async function updateConversation({
  conversationsKV,
  chatId,
  newMessages,
}: UpdateConversationArgs) {
  const conversation = await getConversation({ conversationsKV, chatId });
  const updatedMessages = keepLatestMessages([
    ...conversation.messages,
    ...newMessages,
  ]);
  await putConversation({
    conversationsKV,
    chatId,
    conversation: { messages: updatedMessages },
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
  waitUntil: (promise: Promise<any>) => void;
  requestBody: TelegramWebhookBody;
}

export async function processTelegramWebhook({
  config,
  waitUntil,
  requestBody,
}: ProcessTelegramWebhookArgs) {
  const conversationsKV = config.HTADOTAI_TELEGRAM_CONVERSATIONS;
  const telegramMessage = requestBody.message;

  if (!telegramMessage || !telegramMessage.chat || !telegramMessage.text) {
    console.error("Required fields missing in update", { telegramMessage });
    return;
  }
  // Get the Telegram message body
  const chatId = telegramMessage.chat.id;
  const messageText = telegramMessage.text;

  // Send "typing..." status
  waitUntil(
    sendTelegramAction({
      telegramApiToken: config.TELEGRAM_API_TOKEN,
      chat_id: chatId,
      action: "typing",
    })
  );

  // get stored conversation history
  const conversation = await getConversation({ conversationsKV, chatId });
  const latestMessages = keepLatestMessages(conversation.messages);

  // rate limit if required
  if (
    shouldRateLimit({
      messages: latestMessages,
      windowMs: config.TELEGRAM_RATE_LIMIT_WINDOW_MS,
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

  // clear history if the user asked for it
  if (CLEAR_HISTORY_COMMANDS.includes(messageText.toLowerCase().trim())) {
    await conversationsKV.delete(chatId.toString());

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
    messages: [systemMessage, ...latestMessages, userMessage],
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
  await updateConversation({
    conversationsKV,
    chatId,
    newMessages: [userMessage, gptMessage],
  });
}
