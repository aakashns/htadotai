interface SendTelegramMessageArgs {
  telegramApiToken: string;
  chat_id: number;
  text: string;
}

export async function sendTelegramMessage({ telegramApiToken, chat_id, text }: SendTelegramMessageArgs) {
  const SEND_URL = `https://api.telegram.org/bot${telegramApiToken}/sendMessage`;

  const response: Response = await fetch(SEND_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      chat_id,
      text,
    }),
  });

  return response.json();
}