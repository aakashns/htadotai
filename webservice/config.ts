type RequiredEnv = {
  TELEGRAM_API_TOKEN: string;
  OPENAI_API_KEY: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  HTADOTAI_TELEGRAM_CONVERSATIONS: KVNamespace;
};

const DEFAULT_TELEGRAM_GPT_SYSTEM_PROMPT = `You are HTA - a personal AI assistant. Users 
interact with you via messaging platforms like Telegram. Keep your replies 
direct and concise. Break replies into multiple short paragraphs if required, 
no longer than 2-3 sentences each.`;

const optionalEnvDefaults = {
  TELEGRAM_GPT_SYSTEM_PROMPT: DEFAULT_TELEGRAM_GPT_SYSTEM_PROMPT,
  TELEGRAM_GPT_MODEL: "gpt-3.5-turbo",
  TELEGRAM_GPT_TEMPERATURE: 0.8,
  TELEGRAM_GPT_MAX_TOKENS: 160,
  TELEGRAM_GPT_API_URL: "https://api.openai.com/v1/chat/completions",
  TELEGRAM_RATE_LIMIT_WINDOW_MS: 60000,
  TELEGRAM_RATE_LIMIT_MAX_MESSAGES: 10,
};

const HTADOTAI_TELEGRAM_CONVERSATIONS_KV_STUB = {
  get: () => {
    console.log(
      "KV namespace 'HTADOTAI_TELEGRAM_CONVERSATIONS' not connected!"
    );
    return "[]";
  },
  put: () => {
    console.log(
      "KV namespace 'HTADOTAI_TELEGRAM_CONVERSATIONS' not connected!"
    );
  },
};

type Env = RequiredEnv & Partial<typeof optionalEnvDefaults>;
export type Context = EventContext<Env, string, unknown>;

export function getConfig(context: Context): Config {
  const { env } = context;
  return {
    // required
    TELEGRAM_API_TOKEN: env.TELEGRAM_API_TOKEN,
    OPENAI_API_KEY: env.OPENAI_API_KEY,
    HTADOTAI_TELEGRAM_CONVERSATIONS:
      env.HTADOTAI_TELEGRAM_CONVERSATIONS ??
      HTADOTAI_TELEGRAM_CONVERSATIONS_KV_STUB,

    TELEGRAM_WEBHOOK_SECRET: env.TELEGRAM_WEBHOOK_SECRET,

    // optional
    TELEGRAM_GPT_SYSTEM_PROMPT:
      env.TELEGRAM_GPT_SYSTEM_PROMPT ?? DEFAULT_TELEGRAM_GPT_SYSTEM_PROMPT,
    TELEGRAM_GPT_MODEL:
      env.TELEGRAM_GPT_MODEL ?? optionalEnvDefaults.TELEGRAM_GPT_MODEL,
    TELEGRAM_GPT_TEMPERATURE:
      env.TELEGRAM_GPT_TEMPERATURE ??
      optionalEnvDefaults.TELEGRAM_GPT_TEMPERATURE,
    TELEGRAM_GPT_MAX_TOKENS:
      env.TELEGRAM_GPT_MAX_TOKENS ??
      optionalEnvDefaults.TELEGRAM_GPT_MAX_TOKENS,
    TELEGRAM_GPT_API_URL:
      env.TELEGRAM_GPT_API_URL ?? optionalEnvDefaults.TELEGRAM_GPT_API_URL,
    TELEGRAM_RATE_LIMIT_WINDOW_MS:
      env.TELEGRAM_RATE_LIMIT_WINDOW_MS ??
      optionalEnvDefaults.TELEGRAM_RATE_LIMIT_WINDOW_MS,
    TELEGRAM_RATE_LIMIT_MAX_MESSAGES:
      env.TELEGRAM_RATE_LIMIT_MAX_MESSAGES ??
      optionalEnvDefaults.TELEGRAM_RATE_LIMIT_MAX_MESSAGES,
  };
}

export type Config = RequiredEnv & typeof optionalEnvDefaults;
