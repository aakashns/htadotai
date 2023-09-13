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
}

export async function generateGPTReply({
  openaiApiKey,
  messages,
}: GenerateGPTReplyArgs) {
  const CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";

  const bodyJson = {
    model: "gpt-3.5-turbo",
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

  console.log("GPT response", responseJson);

  return responseJson.choices[0].message;
}
