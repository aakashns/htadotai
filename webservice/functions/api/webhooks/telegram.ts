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
  const SEND_URL = `https://api.telegram.org/bot${telegramApiToken}/sendMessage`;

  const response: Response = await fetch(SEND_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      chat_id: chatId,
      text: `You said: ${messageText}`,
    }),
  });

  const responseJson = await response.json();

  console.log("Telegram send message response:", responseJson);

  return new Response(JSON.stringify({ "success": true }));
}