// Request size checks for /api/chat. The caps follow nilmamano.com
// app/lib/chat-guard.ts; the per-IP limit stays in rate-limit.ts.

export const MAX_BODY_BYTES = 32_768;
export const MAX_MESSAGES = 20;
export const MAX_USER_CHARS = 2_000;
// A reply has maxOutputTokens 1000 (about 4,000 characters); this leaves room.
export const MAX_ASSISTANT_CHARS = 8_000;

export type ChatText = { type: "text"; text: string };
export type ChatMessage = { id: string; role: "user" | "assistant"; parts: ChatText[] };

// Throws RangeError when the body is larger than MAX_BODY_BYTES, SyntaxError when it is not JSON.
export async function readBody(req: Request): Promise<unknown> {
  if (Number(req.headers.get("content-length")) > MAX_BODY_BYTES) throw new RangeError();
  if (!req.body) throw new SyntaxError();
  const reader = req.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new RangeError();
      }
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally {
    reader.releaseLock();
  }
}

// Keeps only the text parts of each message. Returns null when the history
// breaks a cap or does not end with a visitor message.
export function parseMessages(value: unknown): ChatMessage[] | null {
  if (!Array.isArray(value) || !value.length || value.length > MAX_MESSAGES) return null;
  const messages: ChatMessage[] = [];
  for (const m of value) {
    if (!m || typeof m !== "object" || (m.role !== "user" && m.role !== "assistant")) return null;
    if (!Array.isArray(m.parts)) return null;
    const parts: ChatText[] = [];
    for (const p of m.parts) {
      if (p?.type === "text" && typeof p.text === "string") parts.push({ type: "text", text: p.text });
      else if (m.role === "user") return null; // visitors send text only
    }
    const length = parts.reduce((n, p) => n + p.text.length, 0);
    if (length > (m.role === "user" ? MAX_USER_CHARS : MAX_ASSISTANT_CHARS)) return null;
    if (m.role === "user" && !parts.some((p) => p.text.trim())) return null;
    messages.push({ id: typeof m.id === "string" ? m.id.slice(0, 64) : "", role: m.role, parts });
  }
  return messages.at(-1)!.role === "user" ? messages : null;
}
