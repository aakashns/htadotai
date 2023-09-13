import { sendTelegramMessage } from "@/lib/telegram";

interface Env {
  TELEGRAM_API_TOKEN: string;
}

interface TelegramRequestBody {
  message: {
    chat: {
      id: number;
    };
    text: string;
  };
}

export async function onRequestPost(context: EventContext<Env, any, any>) {
  const { request, env } = context;
  const telegramApiToken = env.TELEGRAM_API_TOKEN;

  // get the message body
  const requestBody = await request.json<TelegramRequestBody>();
  // console.log("Chat received:", requestBody);
  const chatId = requestBody.message.chat.id;
  const messageText = requestBody.message.text;

  // echo the message back
  await sendTelegramMessage({ telegramApiToken, chat_id: chatId, text: `You said: ${messageText}` })

  return new Response(JSON.stringify({ "success": true }));
} 