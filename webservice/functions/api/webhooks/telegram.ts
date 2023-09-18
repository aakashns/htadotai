import { Config, Context, getConfig } from "@/config";
import { GPTMessage, generateGPTReply } from "@/lib/openai";
import {
  ConversationMessage,
  TelegramWebhookBody,
  getConversation,
  keepLatestMessages,
  sendTelegramAction,
  sendTelegramMessage,
  shouldRateLimit,
  updateConversation,
} from "@/lib/telegram";

const CLEAR_HISTORY_COMMANDS = [
  "clear",
  "/clear",
  "reset",
  "/reset",
  "delete",
  "/delete",
];

interface ProcessTelegramWebhookArgs {
  config: Config;
  waitUntil: (promise: Promise<any>) => void;
  requestBody: TelegramWebhookBody;
}

async function processTelegramWebhook({
  config,
  waitUntil,
  requestBody,
}: ProcessTelegramWebhookArgs) {
  const conversationsKV = config.HTADOTAI_TELEGRAM_CONVERSATIONS;

  // Get the Telegram message body
  const chatId = requestBody.message.chat.id;
  const messageText = requestBody.message.text;

  // Send "typing..." status
  waitUntil(
    sendTelegramAction({
      telegramApiToken: config.TELEGRAM_API_TOKEN,
      chat_id: chatId,
      action: "typing",
    })
  );

  // get stored conversation history
  const conversation = await getConversation({ conversationsKV, chatId });
  const latestMessages = keepLatestMessages(conversation.messages);

  // rate limit if required
  if (
    shouldRateLimit({
      messages: latestMessages,
      windowMs: config.TELEGRAM_RATE_LIMIT_WINDOW_MS,
      maxMessages: config.TELEGRAM_RATE_LIMIT_MAX_MESSAGES,
    })
  ) {
    await sendTelegramMessage({
      telegramApiToken: config.TELEGRAM_API_TOKEN,
      chat_id: chatId,
      text: "Too many messages received! Please wait for some time and try again.",
    });

    return;
  }

  // clear history if the user asked for it
  if (CLEAR_HISTORY_COMMANDS.includes(messageText.toLowerCase().trim())) {
    await conversationsKV.delete(chatId.toString());

    await sendTelegramMessage({
      telegramApiToken: config.TELEGRAM_API_TOKEN,
      chat_id: chatId,
      text: "I've deleted your conversation history. You can now start a fresh conversation!",
    });

    return;
  }

  // Send the message to OpenAI
  const systemMessage: GPTMessage = {
    role: "system",
    content: config.TELEGRAM_GPT_SYSTEM_PROMPT,
  };

  const userMessage:ConversationMessage = {
    role: "user",
    content: messageText,
    created: Date.now(),
  };

  const gptRequestBody = {
    model: config.TELEGRAM_GPT_MODEL,
    messages: [systemMessage, ...latestMessages, userMessage],
    max_tokens: config.TELEGRAM_GPT_MAX_TOKENS,
    temperature: config.TELEGRAM_GPT_TEMPERATURE,
  };

  console.log({ gptRequestBody });

  const gptResponseBody = await generateGPTReply({
    openaiApiKey: config.OPENAI_API_KEY,
    apiUrl: config.TELEGRAM_GPT_API_URL,
    body: gptRequestBody,
  });

  console.log({ gptResponseBody });

  const gptMessage: ConversationMessage = {
    ...gptResponseBody.choices[0].message,
    created: Date.now(),
  };
  const finishReason = gptResponseBody.choices[0].finish_reason;

  // Send the reply to Telegram
  await sendTelegramMessage({
    telegramApiToken: config.TELEGRAM_API_TOKEN,
    chat_id: chatId,
    text: gptMessage.content ?? "No content in reply",
    reply_markup:
      finishReason === "length"
        ? {
            keyboard: [[{ text: "Continue" }, { text: "Ok, thanks!" }]],
            one_time_keyboard: true,
            resize_keyboard: true,
          }
        : {},
  });

  // Update the conversation history
  await updateConversation({
    conversationsKV,
    chatId,
    newMessages: [userMessage, gptMessage],
  });
}

export async function onRequestPost(context: Context) {
  const config = getConfig(context);
  const { request, waitUntil } = context;
  const headerToken = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
  if (headerToken === config.TELEGRAM_WEBHOOK_SECRET) {
    const requestBody = await request.json<TelegramWebhookBody>();
    waitUntil(processTelegramWebhook({ config, waitUntil, requestBody }));
  }
  return new Response(JSON.stringify({ success: true }));
}
