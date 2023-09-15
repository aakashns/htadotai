import { Env } from "@/lib/cloudflare";
import {
  generateGPTReply,
  keepLatestMessages,
  shouldRateLimit,
} from "@/lib/openai";
import {
  TelegramWebhookBody,
  getConversation,
  sendTelegramAction,
  sendTelegramMessage,
  updateConversation,
} from "@/lib/telegram";

const SYSTEM_PROMPT = `You are HTA - a personal AI assistant. Users interact 
with you via messaging platforms like Telegram. Keep your replies direct and
concise. Break replies into multiple short paragraphs if required, no longer
than 2-3 sentences each.`;

const CLEAR_HISTORY_COMMANDS = [
  "clear",
  "/clear",
  "reset",
  "/reset",
  "delete",
  "/delete",
];

interface ProcessTelegramWebhookArgs {
  env: Env;
  waitUntil: (promise: Promise<any>) => void;
  requestBody: TelegramWebhookBody;
}

async function processTelegramWebhook({
  env,
  waitUntil,
  requestBody,
}: ProcessTelegramWebhookArgs) {
  const telegramApiToken = env.TELEGRAM_API_TOKEN;
  const openaiApiKey = env.OPENAI_API_KEY;
  const conversationsKV = env.HTADOTAI_TELEGRAM_CONVERSATIONS;

  // Get the Telegram message body

  const chatId = requestBody.message.chat.id;
  const messageText = requestBody.message.text;

  // Send "typing..." status
  waitUntil(
    sendTelegramAction({ telegramApiToken, chat_id: chatId, action: "typing" })
  );

  // get stored conversation history
  const conversation = await getConversation({ conversationsKV, chatId });
  const latestMessages = keepLatestMessages(conversation.messages);

  // rate limit if required
  if (shouldRateLimit(latestMessages)) {
    await sendTelegramMessage({
      telegramApiToken,
      chat_id: chatId,
      text: "Too many messages received! Please wait for some time and try again.",
    });

    return;
  }

  // clear history if the user asked for it
  if (CLEAR_HISTORY_COMMANDS.includes(messageText.toLowerCase().trim())) {
    await conversationsKV.delete(chatId.toString());

    await sendTelegramMessage({
      telegramApiToken,
      chat_id: chatId,
      text: "I've deleted your conversation history. You can now start a fresh conversation!",
    });

    return;
  }

  // Send the message to OpenAI
  const userMessage = { role: "user", content: messageText, date: Date.now() };
  const gptResponseBody = await generateGPTReply({
    openaiApiKey,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      ...latestMessages,
      userMessage,
    ],
  });

  const gptMessage = gptResponseBody.choices[0].message;
  gptMessage.date = Date.now();
  const finishReason = gptResponseBody.choices[0].finish_reason;

  // Send the reply to Telegram
  await sendTelegramMessage({
    telegramApiToken,
    chat_id: chatId,
    text: gptMessage.content,
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

export async function onRequestPost(context: EventContext<Env, any, any>) {
  const { request, env, waitUntil } = context;
  const headerToken = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
  if (headerToken === env.TELEGRAM_WEBHOOK_SECRET) {
    const requestBody = await request.json<TelegramWebhookBody>();
    waitUntil(processTelegramWebhook({ env, waitUntil, requestBody }));
  }
  return new Response(JSON.stringify({ success: true }));
}
