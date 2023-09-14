import { Env } from "@/lib/cloudflare";
import { generateGPTReply } from "@/lib/openai";
import {
  TelegramWebhookBody,
  getConversation,
  sendTelegramMessage,
  updateConversation,
} from "@/lib/telegram";

const SYSTEM_PROMPT = `You are HTA - a personal AI assistant. Users interact 
with you via messaging platforms like Telegram. Keep your replies direct and
concise. Break replies into multiple short paragraphs if required, no longer
than 2-3 sentences each.`;

export async function onRequestPost(context: EventContext<Env, any, any>) {
  const { request, env } = context;
  const telegramApiToken = env.TELEGRAM_API_TOKEN;
  const openaiApiKey = env.OPENAI_API_KEY;
  const conversationsKV = env.HTADOTAI_TELEGRAM_CONVERSATIONS;

  // Get the Telegram message body
  const requestBody = await request.json<TelegramWebhookBody>();
  const chatId = requestBody.message.chat.id;
  const messageText = requestBody.message.text;

  console.log("Received Telegram webhook request", requestBody);
  const userMessage = { role: "user", content: messageText, date: Date.now() };

  if (
    ["clear", "/clear", "reset", "/reset"].includes(
      messageText.toLowerCase().trim()
    )
  ) {
    // clear conversation
    await conversationsKV.delete(chatId.toString());

    // send confirmation
    await sendTelegramMessage({
      telegramApiToken,
      chat_id: chatId,
      text: "Your conversation history has been cleared.",
    });

    return new Response(JSON.stringify({ success: true }));
  }

  // get stored conversation history
  const conversation = await getConversation({ conversationsKV, chatId });

  console.log("Retrieved Telegram conversation history", conversation);

  // Send the message to OpenAI
  const { content: gptMessageText } = await generateGPTReply({
    openaiApiKey,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      ...conversation?.messages,
      userMessage,
    ],
  });

  const gptMessage = {
    role: "assistant",
    content: gptMessageText,
    date: Date.now(),
  };

  // Send the reply to Telegram
  const sendMessageResult = await sendTelegramMessage({
    telegramApiToken,
    chat_id: chatId,
    text: gptMessage.content,
  });

  console.log("Sent Telegram message", { sendMessageResult });

  // Update the conversation history
  await updateConversation({
    conversationsKV,
    chatId,
    newMessages: [userMessage, gptMessage],
  });

  return new Response(JSON.stringify({ success: true }));
}
