import { Env } from "@/lib/cloudflare";
import { generateGPTReply } from "@/lib/openai";
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

  // console.log("Received Telegram webhook request", requestBody);
  const userMessage = { role: "user", content: messageText, date: Date.now() };

  if (CLEAR_HISTORY_COMMANDS.includes(messageText.toLowerCase().trim())) {
    await conversationsKV.delete(chatId.toString());

    await sendTelegramMessage({
      telegramApiToken,
      chat_id: chatId,
      text: "I've deleted your conversation history. You can now start a fresh conversation!",
    });

    return;
  }

  // get stored conversation history
  const conversation = await getConversation({ conversationsKV, chatId });

  // console.log("Retrieved Telegram conversation history", conversation);

  // Send the message to OpenAI
  const gptResponseBody = await generateGPTReply({
    openaiApiKey,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      ...conversation?.messages,
      userMessage,
    ],
  });

  const gptMessage = gptResponseBody.choices[0].message;
  gptMessage.date = Date.now();
  const finishReason = gptResponseBody.choices[0].finish_reason;

  // Send the reply to Telegram
  const telegramResponseBody = await sendTelegramMessage({
    telegramApiToken,
    chat_id: chatId,
    text: gptMessage.content,
    reply_markup:
      finishReason === "length"
        ? { inline_keyboard: [[{ text: "Continue" }]] }
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
