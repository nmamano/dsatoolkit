"use client";

import { useState, useRef, useEffect } from "react";
import { useChat } from "@ai-sdk/react";
import { MessageCircle, X, Send, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";

const starterQuestions = [
  "I'm new to interview prep. Where should I start?",
  "What DS&A topics does the toolkit cover?",
  "What are the main reusable techniques for trees?",
];

function getMessageText(message: { parts: Array<{ type: string; text?: string }> }): string {
  return message.parts
    .filter((p) => p.type === "text")
    .map((p) => p.text)
    .join("");
}

// Matches **bold**, *italic*, [link](url), bare URLs (https://... or domain.tld/...)
const tokenRegex = /(\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\)|https?:\/\/[^\s)]+|[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(?:\/[^\s)]*)?)/g;

function renderFormattedText(text: string): React.ReactNode[] {
  const result: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  const regex = new RegExp(tokenRegex.source, "g");

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      result.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    if (token.startsWith("**") && token.endsWith("**")) {
      result.push(<strong key={match.index}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("*") && token.endsWith("*")) {
      result.push(<em key={match.index}>{token.slice(1, -1)}</em>);
    } else if (token.startsWith("[")) {
      const linkMatch = token.match(/\[([^\]]+)\]\(([^)]+)\)/);
      if (linkMatch) {
        const href = linkMatch[2].startsWith("http") ? linkMatch[2] : `https://${linkMatch[2]}`;
        result.push(
          <a key={match.index} href={href} target="_blank" rel="noopener noreferrer" className="underline">{linkMatch[1]}</a>
        );
      }
    } else {
      const href = token.startsWith("http") ? token : `https://${token}`;
      result.push(
        <a key={match.index} href={href} target="_blank" rel="noopener noreferrer" className="underline">{token}</a>
      );
    }
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) {
    result.push(text.slice(lastIndex));
  }
  return result;
}

export default function ChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { messages, sendMessage, status, error } = useChat({
    onError: () => {},
  });

  const isLoading = status === "submitted" || status === "streaming";

  // Auto-scroll on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Focus input when opening
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    sendMessage({ text: input });
    setInput("");
  };

  const handleStarterClick = (q: string) => {
    sendMessage({ text: q });
  };

  return (
    <>
      {/* Floating button */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105 active:scale-95"
          aria-label="Open chat"
        >
          <MessageCircle className="h-6 w-6" />
        </button>
      )}

      {/* Chat panel */}
      {isOpen && (
        <div className="fixed bottom-6 right-6 z-50 flex w-[min(400px,calc(100vw-3rem))] flex-col rounded-xl border bg-background shadow-2xl sm:h-[500px] h-[min(500px,calc(100vh-6rem))]">
          {/* Header */}
          <div className="flex items-center justify-between border-b px-4 py-3">
            <div className="flex items-center gap-2">
              <MessageCircle className="h-5 w-5 text-primary" />
              <span className="font-semibold">Ask about DS&A</span>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="rounded-md p-1 hover:bg-muted"
              aria-label="Close chat"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Messages */}
          <ScrollArea className="flex-1 px-4 py-3" ref={scrollRef}>
            {messages.length === 0 ? (
              <div className="flex flex-col gap-2">
                <p className="text-sm text-muted-foreground mb-2">
                  Ask me about DS&A techniques for interview prep!
                </p>
                {starterQuestions.map((q) => (
                  <button
                    key={q}
                    onClick={() => handleStarterClick(q)}
                    className="rounded-lg border px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
                  >
                    {q}
                  </button>
                ))}
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {messages.map((m) => (
                  <div
                    key={m.id}
                    className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                        m.role === "user"
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted"
                      }`}
                    >
                      <p className="whitespace-pre-wrap">{renderFormattedText(getMessageText(m))}</p>
                    </div>
                  </div>
                ))}
                {isLoading && messages[messages.length - 1]?.role === "user" && (
                  <div className="flex justify-start">
                    <div className="rounded-lg bg-muted px-3 py-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                    </div>
                  </div>
                )}
              </div>
            )}
            {error && (
              <p className="mt-2 text-sm text-destructive">
                {error.message?.includes("credit") || error.message?.includes("balance")
                  ? "The chatbot has run out of credits for this month. Please try again next month!"
                  : "Something went wrong. Please try again."}
              </p>
            )}
          </ScrollArea>

          {/* Footer */}
          <div className="border-t px-4 py-2">
            <form onSubmit={handleSubmit} className="flex gap-2">
              <Input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask about DS&A techniques..."
                disabled={isLoading}
                className="flex-1"
              />
              <Button type="submit" size="icon" disabled={isLoading || !input.trim()}>
                <Send className="h-4 w-4" />
              </Button>
            </form>
            <p className="mt-1.5 text-center text-[10px] text-muted-foreground">
              Powered by Claude
            </p>
          </div>
        </div>
      )}
    </>
  );
}
