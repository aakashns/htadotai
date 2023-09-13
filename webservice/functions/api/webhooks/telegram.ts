import { Env } from "@/lib/cloudflare";
import { generateGPTReply } from "@/lib/openai";
import { TelegramWebhookBody, sendTelegramMessage } from "@/lib/telegram";

const SYSTEM_PROMPT = `You are HTA - a personal AI assistant. Users interact 
with you via messaging platforms like Telegram. Keep your replies direct and
concise. Break replies into multiple short paragraphs if required, no longer
than 2-3 sentences each.`;

export async function onRequestPost(context: EventContext<Env, any, any>) {
  const { request, env } = context;
  const telegramApiToken = env.TELEGRAM_API_TOKEN;
  const openaiApiKey = env.OPENAI_API_KEY;

  // Get the Telegram message body
  const requestBody = await request.json<TelegramWebhookBody>();
  const chatId = requestBody.message.chat.id;
  const messageText = requestBody.message.text;

  // Send the message to OpenAI
  const { content: replyText } = await generateGPTReply({
    openaiApiKey,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: messageText },
    ],
  });

  // Send the reply to Telegram
  await sendTelegramMessage({
    telegramApiToken,
    chat_id: chatId,
    text: replyText,
  });

  return new Response(JSON.stringify({ success: true }));
}
