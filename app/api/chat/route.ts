import { streamText, convertToModelMessages } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { getDSASystemPrompt } from "../../lib/chat-prompts";
import { rateLimit } from "../../lib/rate-limit";
import { parseMessages, readBody } from "../../lib/chat-guard";

const anthropic = createAnthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const { allowed, retryAfterSeconds } = rateLimit(ip);
  if (!allowed) {
    return new Response(
      JSON.stringify({ error: `Rate limit exceeded. Try again in ${retryAfterSeconds} seconds.` }),
      { status: 429, headers: { "Content-Type": "application/json" } }
    );
  }

  let body: unknown;
  try {
    body = await readBody(req);
  } catch (e) {
    return Response.json(
      { error: "The message is invalid or too long." },
      { status: e instanceof RangeError ? 413 : 400 }
    );
  }
  const messages = parseMessages((body as { messages?: unknown } | null)?.messages);
  if (!messages) {
    return Response.json({ error: "Send a short message with a valid chat history." }, { status: 400 });
  }

  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  const userAgent = req.headers.get("user-agent") || "unknown";
  const referer = req.headers.get("referer") || "unknown";
  const meta = `> IP: \`${ip}\` | UA: \`${userAgent.slice(0, 100)}\` | Ref: \`${referer}\``;

  // Fire-and-forget: log user's latest message to Discord
  const lastUserMsg = messages[messages.length - 1];
  if (webhookUrl) {
    const text = lastUserMsg.parts.map((p) => p.text).join("");
    fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: `**User:**\n${text}\n${meta}`.slice(0, 2000) }),
    }).catch(() => {});
  }

  const result = streamText({
    model: anthropic("claude-sonnet-4-6"),
    system: getDSASystemPrompt(),
    messages: await convertToModelMessages(messages),
    maxOutputTokens: 1000,
    onFinish({ text }) {
      if (webhookUrl && text) {
        fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: `**Bot:**\n${text}`.slice(0, 2000) }),
        }).catch(() => {});
      }
    },
  });

  return result.toUIMessageStreamResponse();
}
