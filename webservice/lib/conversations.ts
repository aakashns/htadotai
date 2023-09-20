import { GPTMessage } from "./openai";

export type ConversationMessage = GPTMessage & {
  created?: number;
};

export type Conversation = {
  messages: ConversationMessage[];
};

const EMPTY_CONVERSATION: Conversation = {
  messages: [],
};

type KeepLatestMessagesArgs = {
  messages: ConversationMessage[];
  expirationTtl: number;
  maxContextChars: number;
};

export function keepLatestMessages({
  messages,
  expirationTtl,
  maxContextChars,
}: KeepLatestMessagesArgs) {
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
  const conversation =
    (await conversationsKv?.get<Conversation>(conversationId, "json")) ??
    EMPTY_CONVERSATION;
  return {
    ...conversation,
    messages: keepLatestMessages({
      messages: conversation.messages,
      expirationTtl,
      maxContextChars,
    }),
  };
}

type PutConversationArgs = {
  conversationsKv?: KVNamespace;
  conversationId: string;
  conversation: Conversation;
  expirationTtl: number;
};

async function putConversation({
  conversationsKv,
  conversationId,
  conversation,
  expirationTtl,
}: PutConversationArgs) {
  await conversationsKv?.put(conversationId, JSON.stringify(conversation), {
    expirationTtl,
  });
}

interface UpdateConversationArgs {
  conversationsKv?: KVNamespace;
  conversationId: string;
  newMessages: ConversationMessage[];
  expirationTtl: number;
  maxContextChars: number;
}

export async function updateConversationMessages({
  conversationsKv,
  conversationId,
  newMessages,
  expirationTtl,
  maxContextChars,
}: UpdateConversationArgs) {
  const conversation =
    (await conversationsKv?.get<Conversation>(conversationId, "json")) ??
    EMPTY_CONVERSATION;
  const updatedMessages = keepLatestMessages({
    messages: [...conversation.messages, ...newMessages],
    expirationTtl: expirationTtl * 1000,
    maxContextChars,
  });
  const newConversation = {
    ...conversation,
    messages: updatedMessages,
  };

  await putConversation({
    conversationsKv,
    conversationId,
    conversation: newConversation,
    expirationTtl,
  });
}

type DeleteConversationArgs = {
  conversationsKv?: KVNamespace;
  conversationId: string;
};

export async function deleteConversation({
  conversationsKv,
  conversationId,
}: DeleteConversationArgs) {
  await conversationsKv?.delete(conversationId);
}

type ShouldRateLimitOptions = {
  window: number;
  maxMessages: number;
  messages: ConversationMessage[];
};

export function shouldRateLimit({
  window,
  maxMessages,
  messages,
}: ShouldRateLimitOptions): boolean {
  const currentTimestamp = Date.now();
  let recentMessagesCount = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (
      !message.created ||
      message.created < currentTimestamp - window * 1000
    ) {
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
