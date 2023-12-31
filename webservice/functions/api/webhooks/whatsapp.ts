import { Context, getConfig } from "@/config";
import { WhatsAppWebhookBody, processWhatsAppWebhook } from "@/lib/whatsapp";

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
  const requestBody = await request.json<WhatsAppWebhookBody>();
  const requestValue = requestBody.entry?.[0]?.changes?.[0]?.value;
  if (!requestBody.object || !requestValue) {
    return new Response("Bad Request", { status: 400 });
  } else {
    waitUntil(processWhatsAppWebhook({ config, waitUntil, requestValue }));
    return new Response(JSON.stringify({ success: true }));
  }
}
