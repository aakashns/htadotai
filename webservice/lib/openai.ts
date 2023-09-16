export type GPTMessageFunctionCall = {
  name: string;
  arguments: string;
};

export type GPTMessage = {
  role: "system" | "user" | "assistant" | "function";
  content: string | null;
  name?: string;
  function_call?: GPTMessageFunctionCall;
};

export type GPTFunctionParameters = {
  type: string;
  properties: {
    [key: string]: {
      type: string;
      description: string;
      enum?: string[];
    };
  };
  required: string[];
};

export type GPTFunction = {
  name: string;
  description: string;
  parameters: GPTFunctionParameters;
};

export type GPTRequestBody = {
  model: string;
  messages: GPTMessage[];
  functions?: GPTFunction[];
  temperature?: number | null;
  top_p?: number | null;
  n?: number | null;
  stream?: boolean | null;
  stop?: string | string[] | null;
  max_tokens?: number | null;
  presence_penalty?: number | null;
  frequency_penalty?: number | null;
  logit_bias?: { [token: number]: number };
  user?: string;
};

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

export function sanitizeMessages(messages: GPTMessage[]): GPTMessage[] {
  return messages.map(({ role, content, name, function_call }) => {
    const sanitizedMessage: GPTMessage = {
      role,
      content: content ?? null,
    };

    if (name) {
      sanitizedMessage.name = name;
    }

    if (function_call) {
      sanitizedMessage.function_call = {
        name: function_call.name,
        arguments: function_call.arguments,
      };
    }

    return sanitizedMessage;
  });
}

interface GenerateGPTReplyArgs {
  openaiApiKey: string;
  apiUrl: string;
  body: GPTRequestBody;
}

export async function generateGPTReply({
  openaiApiKey,
  apiUrl,
  body,
}: GenerateGPTReplyArgs) {
  body.messages = sanitizeMessages(body.messages);
  const response: Response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openaiApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  return response.json<GPTReponseBody>();
}
