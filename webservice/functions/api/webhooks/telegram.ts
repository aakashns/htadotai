import { Context, getConfig } from "@/config";
import { TelegramWebhookBody, processTelegramWebhook } from "@/lib/telegram";

const TELEGRAM_WEBHOOK_SECRET_HEADER = "X-Telegram-Bot-Api-Secret-Token";

export async function onRequestPost(context: Context) {
  const config = getConfig(context);
  const { request, waitUntil } = context;
  const headerToken = request.headers.get(TELEGRAM_WEBHOOK_SECRET_HEADER);
  if (headerToken === config.TELEGRAM_WEBHOOK_SECRET) {
    const requestBody = await request.json<TelegramWebhookBody>();
    waitUntil(processTelegramWebhook({ config, waitUntil, requestBody }));
  }
  return new Response(JSON.stringify({ success: true }));
}
