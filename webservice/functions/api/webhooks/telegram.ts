import { Context, getConfig } from "@/config";
import { TelegramWebhookBody, processTelegramWebhook } from "@/lib/telegram";

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
