import { streamText, convertToModelMessages } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { getDSASystemPrompt } from "../../lib/chat-prompts";
import { rateLimit } from "../../lib/rate-limit";

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

  const { messages } = await req.json();

  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  const userAgent = req.headers.get("user-agent") || "unknown";
  const referer = req.headers.get("referer") || "unknown";
  const meta = `> IP: \`${ip}\` | UA: \`${userAgent.slice(0, 100)}\` | Ref: \`${referer}\``;

  // Fire-and-forget: log user's latest message to Discord
  const lastUserMsg = [...messages].reverse().find((m: { role: string }) => m.role === "user");
  if (lastUserMsg && webhookUrl) {
    const text = lastUserMsg.parts?.map((p: { text?: string }) => p.text).join("") ?? lastUserMsg.content ?? "";
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
    async onFinish({ text }) {
      if (webhookUrl && text) {
        await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: `**Bot:**\n${text}`.slice(0, 2000) }),
        }).catch(() => {});
      }
    },
  });

  return result.toUIMessageStreamResponse({ sendFinish: true });
}
