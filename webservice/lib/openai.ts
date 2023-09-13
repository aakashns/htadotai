interface GPTMessage {
  role: string;
  content: string;
}

interface GPTReponseBody {
  choices: {
    message: GPTMessage;
  }[];
}

interface GenerateGPTReplyArgs {
  openaiApiKey: string;
  messages: GPTMessage[];
  model?: string;
}

export async function generateGPTReply({
  openaiApiKey,
  messages,
  model = "gpt-3.5-turbo",
}: GenerateGPTReplyArgs) {
  const CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";

  const bodyJson = {
    model,
    messages,
  };

  const response: Response = await fetch(CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openaiApiKey}`,
    },
    body: JSON.stringify(bodyJson),
  });

  const responseJson = await response.json<GPTReponseBody>();

  return responseJson.choices[0].message;
}
