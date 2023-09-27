import { GPTMessage } from "./openai";

export type ConversationMessage = GPTMessage & { created?: number };

export type Conversation = { messages: ConversationMessage[] };

const EMPTY_CONVERSATION: Conversation = { messages: [] };

type KeepLatestMessagesArgs = { messages: ConversationMessage[]; expirationTtl: number; maxContextChars: number };

export function keepLatestMessages({ messages, expirationTtl, maxContextChars }: KeepLatestMessagesArgs) {
  const cutoffDate = Date.now() - expirationTtl * 1000;
  let totalContentLength = 0;
  let result = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    const contentLength = message.content?.length || 0;
    if (!message.created || message.created < cutoffDate) {
      break;
    } else if (totalContentLength + contentLength <= maxContextChars) {
      totalContentLength += contentLength;
      result.push(message);
    } else {
      break;
    }
  }
  return result.sort((a, b) => (a.created || 0) - (b.created || 0));
}

type GetConversationArgs = {
  conversationsKv?: KVNamespace;
  conversationId: string;
  expirationTtl: number;
  maxContextChars: number;
};

export async function getConversation({
  conversationsKv,
  conversationId,
  expirationTtl,
  maxContextChars,
}: GetConversationArgs) {
  const conversation = (await conversationsKv?.get<Conversation>(conversationId, "json")) ?? EMPTY_CONVERSATION;
  return {
    ...conversation,
    messages: keepLatestMessages({ messages: conversation.messages, expirationTtl, maxContextChars }),
  };
}

type UpdateConversationArgs = {
  conversationsKv?: KVNamespace;
  conversationId: string;
  newMessages: ConversationMessage[];
  expirationTtl: number;
  maxContextChars: number;
};

export async function updateConversationMessages({
  conversationsKv,
  conversationId,
  newMessages,
  expirationTtl,
  maxContextChars,
}: UpdateConversationArgs) {
  const conversation = (await conversationsKv?.get<Conversation>(conversationId, "json")) ?? EMPTY_CONVERSATION;
  const allMessages = [...conversation.messages, ...newMessages];
  const latestMessages = keepLatestMessages({ messages: allMessages, expirationTtl, maxContextChars });
  const newConversation = { ...conversation, messages: latestMessages };
  await conversationsKv?.put(conversationId, JSON.stringify(newConversation), { expirationTtl });
}

type ShouldRateLimitOptions = { window: number; maxMessages: number; messages: ConversationMessage[] };

export function shouldRateLimit({ window, maxMessages, messages }: ShouldRateLimitOptions): boolean {
  const currentTimestamp = Date.now();
  let recentMessagesCount = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (!message.created || message.created < currentTimestamp - window * 1000) {
      break;
    }
    recentMessagesCount++;
    if (recentMessagesCount > maxMessages) {
      return true;
    }
  }
  return false;
}

type Platform = "telegram" | "whatsapp";

export function makeConversationId(platform: Platform, id: number | string) {
  return `${platform}:${id}`;
}
