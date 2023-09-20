import { Context, getConfig } from "@/config";
import { WhatsAppWebhookBody } from "@/lib/whatsapp";

export async function onRequestGet(context: Context) {
  const config = getConfig(context);
  const { searchParams } = new URL(context.request.url);

  let mode = searchParams.get("hub.mode");
  let token = searchParams.get("hub.verify_token");
  let challenge = searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === config.WHATSAPP_WEBHOOK_SECRET) {
    return new Response(challenge, { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}

export async function onRequestPost(context: Context) {
  const config = getConfig(context);
  const { request, waitUntil } = context;
  const headers: any = {};

  for (let [key, value] of Array.from(request.headers.entries())) {
    headers[key] = value;
  }

  // implement stuff here
  const requestBody = await request.json<WhatsAppWebhookBody>();
  console.log("WhatsApp webhook received", {
    url: request.url,
    headers: request.headers,
    requestBody,
  });

  return new Response(JSON.stringify({ success: true }));
}
