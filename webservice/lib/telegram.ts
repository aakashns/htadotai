import { GPTMessage } from "./openai";

export type ConversationMessage = GPTMessage & {
  created?: number;
};

interface Conversation {
  messages: ConversationMessage[];
}

export interface TelegramWebhookBody {
  message: {
    chat: {
      id: number;
    };
    text: string;
  };
}

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
  newMessages: GPTMessage[];
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
