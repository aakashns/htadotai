type RequiredEnv = {
  CONVERSATIONS_KV?: KVNamespace;

  TELEGRAM_API_TOKEN: string;
  OPENAI_API_KEY: string;
  TELEGRAM_WEBHOOK_SECRET: string;

  WHATSAPP_API_TOKEN: string;
  WHATSAPP_WEBHOOK_SECRET: string;
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
  TELEGRAM_MAX_CONTEXT_CHARS: 5000,
  TELEGRAM_GPT_API_URL: "https://api.openai.com/v1/chat/completions",
  TELEGRAM_RATE_LIMIT_WINDOW: 60,
  TELEGRAM_RATE_LIMIT_MAX_MESSAGES: 10,
  TELEGRAM_EXPIRATION_TTL: 3 * 60 * 60,
};

type Env = RequiredEnv & Partial<typeof optionalEnvDefaults>;
export type Context = EventContext<Env, string, unknown>;

export function getConfig(context: Context): Config {
  const { env } = context;
  return {
    ...optionalEnvDefaults,
    ...env,
  };
}

export type Config = RequiredEnv & typeof optionalEnvDefaults;
export type WaitUntil = (promise: Promise<any>) => void;
