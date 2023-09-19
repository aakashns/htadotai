import { Context, getConfig } from "@/config";

export async function onRequestPost(context: Context) {
  const config = getConfig(context);
  const { request, waitUntil } = context;

  // implement stuff here
  
  return new Response(JSON.stringify({ success: true }));
}
