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
    max_tokens: 100,
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
