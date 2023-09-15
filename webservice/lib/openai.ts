export interface GPTMessage {
  role: string;
  content: string;
  date?: number;
}

interface GPTReponseBody {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: {
    index: number;
    message: GPTMessage;
    finish_reason: string;
  }[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export function shouldRateLimit(messages: GPTMessage[]): boolean {
  const currentTimestamp = Date.now();
  const oneMinuteAgo = currentTimestamp - 60000; // 60 seconds ago

  let recentMessagesCount = 0;

  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    // if date is not set, or the message is older than 60 seconds, stop the loop
    if (!message.date || message.date < oneMinuteAgo) {
      break;
    }
    recentMessagesCount++;
    if (recentMessagesCount > 10) {
      return true; // more than 'n' messages in the last 60 seconds
    }
  }

  return false; // 'n' or less messages in the last 60 seconds
}

export function keepLatestMessages(messages: GPTMessage[]): GPTMessage[] {
  const cutoffDate = Date.now() - 3 * 60 * 60 * 1000;
  let totalContentLength = 0;
  let result: GPTMessage[] = [];

  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    const contentLength = message.content.length;

    if (!message.date || message.date < cutoffDate) {
      break;
    } else if (totalContentLength + contentLength <= 5000) {
      totalContentLength += contentLength;
      result.push(message);
    } else {
      break;
    }
  }

  return result.sort((a, b) => (a.date || 0) - (b.date || 0));
}

interface GenerateGPTReplyArgs {
  openaiApiKey: string;
  messages: GPTMessage[];
}

export async function generateGPTReply({
  openaiApiKey,
  messages,
}: GenerateGPTReplyArgs) {
  const CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";

  const bodyJson = {
    model: "gpt-3.5-turbo",
    messages: messages.map(({ role, content }) => ({ role, content })),
    max_tokens: 160,
    temperature: 0.8,
  };

  const response: Response = await fetch(CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openaiApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(bodyJson),
  });

  return response.json<GPTReponseBody>();
}
