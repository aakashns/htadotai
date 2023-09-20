import { Context, getConfig } from "@/config";
import { WhatsAppWebhookBody } from "@/lib/whatsapp";

export async function onRequestPost(context: Context) {
  const config = getConfig(context);
  const { request, waitUntil } = context;

  // implement stuff here
  const requestBody = await request.json<WhatsAppWebhookBody>();
  console.log("WhatsApp webhook received", { url: request.url, requestBody });

  return new Response(JSON.stringify({ success: true }));
}
