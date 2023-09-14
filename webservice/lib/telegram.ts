import { GPTMessage } from "./openai";

interface Conversation {
  messages: GPTMessage[];
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
}

export async function sendTelegramMessage({
  telegramApiToken,
  chat_id,
  text,
}: SendTelegramMessageArgs) {
  const SEND_URL = `https://api.telegram.org/bot${telegramApiToken}/sendMessage`;

  const response: Response = await fetch(SEND_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      chat_id,
      text,
    }),
  });

  return response.json();
}

interface SendTelegramAction {
  telegramApiToken: string;
  chat_id: number;
  status: string;
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
  // get stored conversation history
  const conversation = await getConversation({ conversationsKV, chatId });

  // filter out recent messages
  const threeHoursAgo = Date.now() - 3 * 60 * 60 * 1000;
  const recentMessages = conversation.messages?.filter(
    (message) => message.date && message.date > threeHoursAgo
  );

  // construct new list of messages
  const updatedMessages = [...recentMessages, ...newMessages];
  updatedMessages.sort(
    (message1, message2) => (message1?.date || 0) - (message2?.date || 0)
  );

  // put the new conversation object back
  await putConversation({
    conversationsKV,
    chatId,
    conversation: { messages: updatedMessages },
  });
}
