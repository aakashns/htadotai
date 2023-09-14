import { Env } from "@/lib/cloudflare";
import { GPTMessage, generateGPTReply } from "@/lib/openai";
import { TelegramWebhookBody, sendTelegramMessage } from "@/lib/telegram";

interface ConversationHistory {
  messages: GPTMessage[];
}

const SYSTEM_PROMPT = `You are HTA - a personal AI assistant. Users interact 
with you via messaging platforms like Telegram. Keep your replies direct and
concise. Break replies into multiple short paragraphs if required, no longer
than 2-3 sentences each.`;

export async function onRequestPost(context: EventContext<Env, any, any>) {
  const { request, env } = context;
  const telegramApiToken = env.TELEGRAM_API_TOKEN;
  const openaiApiKey = env.OPENAI_API_KEY;

  // Get the Telegram message body
  const requestBody = await request.json<TelegramWebhookBody>();
  const chatId = requestBody.message.chat.id;
  const chatIdStr = chatId.toString();
  const messageText = requestBody.message.text;

  console.log("Received Telegram webhook request", requestBody);

  // get stored conversation history
  const conversationStr =
    (await env.HTADOTAI_TELEGRAM_CONVERSATIONS.get(chatIdStr)) || "{}";
  const conversation = conversationStr
    ? (JSON.parse(conversationStr) as ConversationHistory)
    : { messages: [] };

  console.log("Retrieved Telegram conversation history", conversation);

  // Construct full list of messages
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...conversation?.messages,
    { role: "user", content: messageText },
  ];

  // Send the message to OpenAI
  const gptReply = await generateGPTReply({
    openaiApiKey,
    messages,
  });

  console.log("Received GPT reply", { gptReply });

  // Send the reply to Telegram
  const sendMessageResult = await sendTelegramMessage({
    telegramApiToken,
    chat_id: chatId,
    text: gptReply.content,
  });

  console.log("Sent Telegram message", { sendMessageResult });

  // Update the conversation history
  const updatedConversation = {
    messages: [...messages, { role: "assistant", content: gptReply.content }],
  };
  await env.HTADOTAI_TELEGRAM_CONVERSATIONS.put(
    chatId.toString(),
    JSON.stringify(updatedConversation)
  );

  console.log("Updated conversation history", { chatId, updatedConversation });

  return new Response(JSON.stringify({ success: true }));
}
