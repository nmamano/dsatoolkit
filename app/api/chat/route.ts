import { streamText, convertToModelMessages } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { getDSASystemPrompt } from "../../lib/chat-prompts";
import { rateLimit } from "../../lib/rate-limit";

const anthropic = createAnthropic();

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

  const result = streamText({
    model: anthropic("claude-haiku-4-5-20251001"),
    system: getDSASystemPrompt(),
    messages: await convertToModelMessages(messages),
    maxOutputTokens: 1000,
  });

  return result.toUIMessageStreamResponse();
}
