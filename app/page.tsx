"use client";

import type React from "react";
import { useState, useEffect, useMemo, useRef } from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CheckCircle2, Info, ClipboardCopy, ExternalLink, Eye, X } from "lucide-react";
import Image from "next/image";
import { Switch } from "@/components/ui/switch";
import toolManifest from "./tool_manifest.json";
import problemManifest from "./problem_manifest.json";
import { useToast } from "@/hooks/use-toast";
import { ThemeToggle } from "@/components/theme-toggle";

// Utility function to convert problem name to slug
const slugify = (text: string) => {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");
};

// Get problem slug from problem manifest
const getProblemSlug = (problemName: string): string | null => {
  // Try to find exact match first
  for (const [slug, problem] of Object.entries(problemManifest)) {
    if (problem.name === problemName) {
      return slug;
    }
  }
  // Fallback to slugifying the name
  console.error(
    `Problem slug not found for "${problemName}" in manifest. Falling back to slugified name.`
  );
  return slugify(problemName);
};

// Get URL for a problem
const getProblemUrl = (problemName: string): string => {
  const slug = getProblemSlug(problemName);
  return `https://start.interviewing.io/beyond-ctci/solution/${slug}`;
};

// Get problem difficulty from problem manifest
const getProblemDifficulty = (
  problemName: string
): "easy" | "medium" | "hard" | null => {
  const slug = getProblemSlug(problemName);
  if (!slug) return null;
  const entry = (problemManifest as Record<string, { difficulty?: string }>)[
    slug
  ];
  const difficulty = entry?.difficulty;
  if (difficulty === "easy" || difficulty === "medium" || difficulty === "hard")
    return difficulty;
  return null;
};

// Map difficulty to card color classes
const getDifficultyCardClasses = (
  difficulty: "easy" | "medium" | "hard" | null
): string => {
  switch (difficulty) {
    case "easy":
      return "bg-emerald-50 dark:bg-emerald-900/30 border-emerald-200 dark:border-emerald-400/60 hover:bg-emerald-100 dark:hover:bg-emerald-900/45 dark:hover:border-emerald-300";
    case "medium":
      return "bg-amber-50 dark:bg-amber-900/30 border-amber-200 dark:border-amber-400/60 hover:bg-amber-100 dark:hover:bg-amber-900/45 dark:hover:border-amber-300";
    case "hard":
      return "bg-rose-50 dark:bg-rose-900/30 border-rose-200 dark:border-rose-400/60 hover:bg-rose-100 dark:hover:bg-rose-900/45 dark:hover:border-rose-300";
    default:
      return "bg-white dark:bg-slate-800 border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-700";
  }
};

// Difficulty rank for ordering (stable: preserve original order within same rank)
const getDifficultyRank = (
  difficulty: "easy" | "medium" | "hard" | null
): number => {
  switch (difficulty) {
    case "easy":
      return 0;
    case "medium":
      return 1;
    case "hard":
      return 2;
    default:
      return 3; // unknown/absent goes last
  }
};

interface Tool {
  id: string;
  name: string;
  wantedOutcome: string;
  primaryProblem: string | null;
  otherProblems: string[];
  extraCredit: boolean;
}

interface ToolCategory {
  name: string;
  chapterNumber: number;
  tools: Tool[];
  allExtraCredit: boolean;
}

export default function Toolset() {
  const [completedTools, setCompletedTools] = useState<Set<string>>(new Set());
  const [totalCompleted, setTotalCompleted] = useState(0);
  const [completionDates, setCompletionDates] = useState<
    Record<string, string>
  >({});
  const [tooltip, setTooltip] = useState<{
    show: boolean;
    x: number;
    y: number;
    content: string;
  }>({
    show: false,
    x: 0,
    y: 0,
    content: "",
  });
  const [openModal, setOpenModal] = useState<string | null>(null);
  const [isHowToUseOpen, setIsHowToUseOpen] = useState(false);
  // Default to Core mode; only switch to Expert when user opts in
  const [isExtendedMode, setIsExtendedMode] = useState(false);
  const [showAccessNotice, setShowAccessNotice] = useState(true);
  const [clickedProblems, setClickedProblems] = useState<Set<string>>(
    new Set()
  );
  const [completedProblems, setCompletedProblems] = useState<Set<string>>(
    new Set()
  );
  const confettiTriggeredRef = useRef<string | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const previousCompletionCountRef = useRef<{ core: number; extended: number }>(
    {
      core: 0,
      extended: 0,
    }
  );

  const { toast } = useToast();

  // Process tools from manifest (new topic -> tools list format)
  const categories: ToolCategory[] = useMemo(() => {
    // The manifest is an ordered array of topics; preserve that order
    const topics = toolManifest as unknown as Array<{
      name: string;
      tools: Array<{
        slug: string;
        name: string;
        extra_credit?: boolean;
        primary_problem?: string;
        other_problems?: string[];
        wanted_outcome: string;
      }>;
    }>;

    const categoriesFromTopics: ToolCategory[] = topics.map((topic) => {
      const tools: Tool[] = (topic.tools || [])
        // Keep parity with previous behavior: only include tools with a primary problem
        .filter((t) => Boolean(t.primary_problem))
        // Preserve the tool order as defined in the manifest
        .map((t) => ({
          id: t.slug,
          name: t.name,
          wantedOutcome: t.wanted_outcome,
          primaryProblem: t.primary_problem ?? null,
          otherProblems: t.other_problems ?? [],
          extraCredit: t.extra_credit ?? false,
        }));

      const allExtraCredit =
        tools.length > 0 && tools.every((tool) => tool.extraCredit);

      return {
        name: topic.name,
        tools,
        allExtraCredit,
        chapterNumber: 0, // assigned below based on order
      };
    });

    // Assign continuous display numbers based on the given order
    categoriesFromTopics.forEach((category, index) => {
      category.chapterNumber = index + 1;
    });

    return categoriesFromTopics;
  }, []);

  // Build mapping from problem names to tools that use them (as primary or extra)
  // This includes ALL tools regardless of mode
  const problemToToolsMap = useMemo(() => {
    const map = new Map<
      string,
      Array<{
        tool: Tool;
        category: ToolCategory;
        isPrimary: boolean;
        toolIndex: number;
      }>
    >();

    categories.forEach((category) => {
      category.tools.forEach((tool, toolIndex) => {
        // Add primary problem
        if (tool.primaryProblem) {
          if (!map.has(tool.primaryProblem)) {
            map.set(tool.primaryProblem, []);
          }
          map.get(tool.primaryProblem)!.push({
            tool,
            category,
            isPrimary: true,
            toolIndex,
          });
        }

        // Add extra problems
        tool.otherProblems.forEach((problemName) => {
          if (!map.has(problemName)) {
            map.set(problemName, []);
          }
          map.get(problemName)!.push({
            tool,
            category,
            isPrimary: false,
            toolIndex,
          });
        });
      });
    });

    // Sort each array by category chapter number, then by tool index
    map.forEach((tools) => {
      tools.sort((a, b) => {
        if (a.category.chapterNumber !== b.category.chapterNumber) {
          return a.category.chapterNumber - b.category.chapterNumber;
        }
        return a.toolIndex - b.toolIndex;
      });
    });

    return map;
  }, [categories]);

  useEffect(() => {
    // Load completed tools from localStorage
    const saved = localStorage.getItem("toolset-completed");
    if (saved) {
      const parsed: string[] = JSON.parse(saved);
      const completed = new Set<string>(parsed);
      setCompletedTools(completed);
      setTotalCompleted(completed.size);
    }

    const savedDates = localStorage.getItem("toolset-completion-dates");
    if (savedDates) {
      setCompletionDates(JSON.parse(savedDates));
    }

    // Load mode preference from localStorage
    const savedMode = localStorage.getItem("toolset-mode");
    if (savedMode !== null) {
      setIsExtendedMode(savedMode === "extended");
    }

    // Load clicked problems from localStorage
    const savedClicked = localStorage.getItem("toolset-clicked-problems");
    if (savedClicked) {
      const parsed: string[] = JSON.parse(savedClicked);
      setClickedProblems(new Set<string>(parsed));
    }

    // Load completed problems from localStorage
    const savedCompleted = localStorage.getItem("toolset-completed-problems");
    if (savedCompleted) {
      const parsed: string[] = JSON.parse(savedCompleted);
      setCompletedProblems(new Set<string>(parsed));
    }

    const accessNoticeDismissed = localStorage.getItem(
      "toolset-access-notice-dismissed"
    );
    if (accessNoticeDismissed === "true") {
      setShowAccessNotice(false);
    }
  }, []);

  // Save mode preference to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem("toolset-mode", isExtendedMode ? "extended" : "core");
  }, [isExtendedMode]);

  const toggleTool = (toolId: string) => {
    const newCompleted = new Set(completedTools);
    const newDates = { ...completionDates };

    if (newCompleted.has(toolId)) {
      newCompleted.delete(toolId);
      delete newDates[toolId];
    } else {
      newCompleted.add(toolId);
      newDates[toolId] = new Date().toLocaleDateString();
    }

    setCompletedTools(newCompleted);
    setCompletionDates(newDates);
    setTotalCompleted(newCompleted.size);
    localStorage.setItem(
      "toolset-completed",
      JSON.stringify([...newCompleted])
    );
    localStorage.setItem("toolset-completion-dates", JSON.stringify(newDates));
  };

  const dismissAccessNotice = () => {
    setShowAccessNotice(false);
    localStorage.setItem("toolset-access-notice-dismissed", "true");
  };

  const toggleCategory = (categoryName: string) => {
    // Use visible categories for toggling, so we only toggle visible tools
    const category = visibleCategories.find((c) => c.name === categoryName);
    if (!category) return;

    const allVisibleToolsCompleted = category.tools.every((tool) =>
      completedTools.has(tool.id)
    );

    const newCompleted = new Set(completedTools);
    const newDates = { ...completionDates };

    if (allVisibleToolsCompleted) {
      // Uncheck all visible tools in this category
      category.tools.forEach((tool) => {
        newCompleted.delete(tool.id);
        delete newDates[tool.id];
      });
    } else {
      // Check all visible tools in this category
      const currentDate = new Date().toLocaleDateString();
      category.tools.forEach((tool) => {
        newCompleted.add(tool.id);
        if (!newDates[tool.id]) {
          newDates[tool.id] = currentDate;
        }
      });
    }

    setCompletedTools(newCompleted);
    setTotalCompleted(newCompleted.size);
    localStorage.setItem(
      "toolset-completed",
      JSON.stringify([...newCompleted])
    );
    localStorage.setItem("toolset-completion-dates", JSON.stringify(newDates));
    setCompletionDates(newDates);
  };

  const handleMouseEnter = (event: React.MouseEvent, toolId: string) => {
    if (completedTools.has(toolId) && completionDates[toolId]) {
      const rect = event.currentTarget.getBoundingClientRect();
      setTooltip({
        show: true,
        x: rect.left + rect.width / 2,
        y: rect.top - 10,
        content: `Completed: ${completionDates[toolId]}`,
      });
    }
  };

  const handleMouseLeave = () => {
    setTooltip({ show: false, x: 0, y: 0, content: "" });
  };

  const handleInfoHover = (event: React.MouseEvent, wantedOutcome: string) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setTooltip({
      show: true,
      x: rect.left + rect.width / 2,
      y: rect.top - 10,
      content: `${wantedOutcome}`,
    });
  };

  const buildLearningPrompt = (toolName: string, wantedOutcome: string) =>
    `Teach me this concept/tool as it applies to DS&A interviews: ${toolName}

Wanted outcome: ${wantedOutcome}

Format:

1. Start with a BRIEF overview, giving context, intuitive explanations, or real-world analogies only if relevant.

2. Explain the concept, keeping it practical to interviews.

3. Show one or two small examples. Use pseudocode if relevant.

4. End with a SHORT "Why this matters in interviews" section.

5. Optional: link any free resources (like LeetCode problems or NeetCode videos) that are DIRECTLY RELEVANT, but only if they are free and directly relevant.`;

  const openAIWithPrompt = (
    provider: "chatgpt" | "claude",
    toolName: string,
    wantedOutcome: string
  ) => {
    const encoded = encodeURIComponent(buildLearningPrompt(toolName, wantedOutcome));
    const urls = {
      chatgpt: `https://chatgpt.com/?q=${encoded}`,
      claude: `https://claude.ai/new?q=${encoded}`,
    };
    window.open(urls[provider], "_blank");
  };

  const copyLearningPrompt = (toolName: string, wantedOutcome: string) => {
    navigator.clipboard.writeText(buildLearningPrompt(toolName, wantedOutcome));
    toast({
      title: "Copied!",
      description: "Learning prompt copied to clipboard.",
    });
  };

  const handleProblemClick = (problemName: string) => {
    const newClicked = new Set(clickedProblems);
    if (!newClicked.has(problemName)) {
      newClicked.add(problemName);
      setClickedProblems(newClicked);
      localStorage.setItem(
        "toolset-clicked-problems",
        JSON.stringify([...newClicked])
      );
    }
  };

  const toggleProblemCompletion = (problemName: string) => {
    const newCompleted = new Set(completedProblems);
    if (newCompleted.has(problemName)) {
      newCompleted.delete(problemName);
    } else {
      newCompleted.add(problemName);
    }
    setCompletedProblems(newCompleted);
    localStorage.setItem(
      "toolset-completed-problems",
      JSON.stringify([...newCompleted])
    );
  };

  // Filter categories and tools based on mode
  const visibleCategories = useMemo(() => {
    let filtered: ToolCategory[];
    if (isExtendedMode) {
      filtered = categories.map((category) => ({ ...category }));
    } else {
      // Basic mode: filter out extra credit categories and tools
      filtered = categories
        .filter((category) => !category.allExtraCredit)
        .map((category) => ({
          ...category,
          tools: category.tools.filter((tool) => !tool.extraCredit),
        }))
        .filter((category) => category.tools.length > 0); // Remove empty categories
    }
    // Renumber visible categories to be continuous starting at 1
    return filtered.map((category, index) => ({
      ...category,
      chapterNumber: index + 1,
    }));
  }, [categories, isExtendedMode]);

  // Compute category completion based on visible tools only
  const completedCategories = useMemo(() => {
    const completed = new Set<string>();
    visibleCategories.forEach((category) => {
      const allVisibleToolsCompleted = category.tools.every((tool) =>
        completedTools.has(tool.id)
      );
      if (allVisibleToolsCompleted && category.tools.length > 0) {
        completed.add(category.name);
      }
    });
    return completed;
  }, [visibleCategories, completedTools]);

  const visibleTotalTools = visibleCategories.reduce(
    (sum, category) => sum + category.tools.length,
    0
  );

  const visibleCompletedTools = visibleCategories.reduce(
    (sum, category) =>
      sum + category.tools.filter((t) => completedTools.has(t.id)).length,
    0
  );

  // Adjust tooltip position to prevent offscreen clipping
  useEffect(() => {
    if (!tooltip.show || !tooltipRef.current) return;

    // Use requestAnimationFrame to ensure DOM has rendered
    const adjustPosition = () => {
      if (!tooltipRef.current) return;

      setTooltip((prev) => {
        if (!tooltipRef.current) return prev;

        const tooltipEl = tooltipRef.current;
        const rect = tooltipEl.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const padding = 8; // Minimum padding from viewport edges

        // Calculate current left and right edges (accounting for translate(-50%))
        const currentLeft = prev.x - rect.width / 2;
        const currentRight = prev.x + rect.width / 2;

        let adjustedX = prev.x;

        // Check if tooltip is cut off on the left
        if (currentLeft < padding) {
          adjustedX = rect.width / 2 + padding;
        }
        // Check if tooltip is cut off on the right
        else if (currentRight > viewportWidth - padding) {
          adjustedX = viewportWidth - rect.width / 2 - padding;
        }

        // Only update if position needs adjustment
        if (Math.abs(adjustedX - prev.x) > 0.1) {
          return { ...prev, x: adjustedX };
        }

        return prev;
      });
    };

    requestAnimationFrame(adjustPosition);
  }, [tooltip.show, tooltip.content]);

  // Trigger confetti when progress reaches 100%
  useEffect(() => {
    const isComplete =
      visibleTotalTools > 0 && visibleCompletedTools === visibleTotalTools;
    const modeKey = isExtendedMode ? "extended" : "core";
    const previousCount = previousCompletionCountRef.current[modeKey];
    const completionIncreased =
      visibleCompletedTools > previousCount &&
      visibleCompletedTools === visibleTotalTools;

    // Update previous completion count for this mode
    previousCompletionCountRef.current[modeKey] = visibleCompletedTools;

    // Reset trigger flag if progress drops below 100%
    if (!isComplete) {
      if (confettiTriggeredRef.current === modeKey) {
        confettiTriggeredRef.current = null;
      }
      return;
    }

    // Only trigger confetti if:
    // 1. Completion count actually increased in this mode (not just switching modes)
    // 2. We reached 100% in this mode
    // 3. We haven't celebrated for this mode yet
    if (
      completionIncreased &&
      isComplete &&
      confettiTriggeredRef.current !== modeKey
    ) {
      confettiTriggeredRef.current = modeKey;
      // Create confetti pieces
      const colors = [
        "#3b82f6",
        "#10b981",
        "#f59e0b",
        "#ef4444",
        "#8b5cf6",
        "#ec4899",
      ];
      const confettiCount = 50;

      for (let i = 0; i < confettiCount; i++) {
        setTimeout(() => {
          const confetti = document.createElement("div");
          confetti.className = "confetti-piece";
          const color = colors[Math.floor(Math.random() * colors.length)];
          confetti.style.setProperty("--color", color);
          confetti.style.left = `${Math.random() * 100}%`;
          confetti.style.top = "0";
          confetti.style.animationDelay = `${Math.random() * 0.5}s`;
          confetti.style.animationDuration = `${2 + Math.random() * 2}s`;

          // Add shoot animation for some pieces
          if (Math.random() > 0.5) {
            confetti.classList.add("shoot");
            const angle = (Math.random() * 360 * Math.PI) / 180;
            const velocity = 200 + Math.random() * 300;
            const tx = Math.cos(angle) * velocity;
            const ty = Math.sin(angle) * velocity;
            confetti.style.setProperty("--tx", `${tx}px`);
            confetti.style.setProperty("--ty", `${ty}px`);
          }

          document.body.appendChild(confetti);

          // Remove after animation
          setTimeout(() => {
            confetti.remove();
          }, 5000);
        }, i * 20);
      }
    }
  }, [visibleCompletedTools, visibleTotalTools, isExtendedMode]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-slate-900 dark:to-slate-800">
      {/* Override dialog overlay for this page */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
        [data-radix-dialog-overlay] {
          background-color: rgba(0, 0, 0, 0.4) !important;
        }
        .dark [data-radix-dialog-overlay] {
          background-color: rgba(0, 0, 0, 0.7) !important;
        }
      `,
        }}
      />
      {/* Tooltip */}
      {tooltip.show && (
        <div
          ref={tooltipRef}
          className="fixed z-50 px-3 py-2 bg-gray-900 dark:bg-slate-800 text-white dark:text-gray-100 text-sm rounded-lg shadow-lg whitespace-normal max-w-md pointer-events-none border border-slate-700"
          style={{
            left: tooltip.x,
            top: tooltip.y,
            transform: "translate(-50%, -100%)",
          }}
        >
          {tooltip.content}
          <div className="absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900 dark:border-t-slate-800"></div>
        </div>
      )}

      {/* Header */}
      <div className="shadow-sm border-b border-white/20 dark:border-slate-700/50 relative">
        <div className="max-w-4xl mx-auto px-4 py-8">
          {/* Theme Toggle and About Button - Top Right */}
          <div className="absolute top-4 right-4 flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => setIsHowToUseOpen(true)}
              className="rounded-full text-sm text-gray-700 dark:text-gray-200 hover:text-gray-900 dark:hover:text-gray-100 border-gray-300 dark:border-slate-600 hover:border-gray-400 dark:hover:border-slate-500 bg-white dark:bg-slate-800 hover:bg-gray-50 dark:hover:bg-slate-700"
            >
              About
            </Button>
            <ThemeToggle />
          </div>
          <div className="text-center pt-12 md:pt-0">
            {/* Title */}
            <h1 className="text-3xl md:text-7xl font-black bg-gradient-to-r from-teal-600 via-cyan-600 to-teal-800 dark:from-teal-400 dark:via-cyan-400 dark:to-teal-600 bg-clip-text text-transparent tracking-tight mb-2">
              TOOLKIT-{visibleTotalTools}
            </h1>
            <p className="text-base md:text-2xl italic font-medium bg-gradient-to-r from-teal-600 via-cyan-600 to-teal-700 dark:from-teal-400 dark:via-cyan-400 dark:to-teal-500 bg-clip-text text-transparent mb-6">
              Like a problem list, but for reusable techniques
            </p>

            <p className="text-sm md:text-xl text-gray-600 dark:text-gray-300 mb-8 max-w-2xl mx-auto">
              The essential DS&A tools and techniques for interviews -
              <br />
              with problems from{" "}
              <strong>Beyond Cracking the Coding Interview</strong>.
            </p>

            {/* Mode Toggle */}
            <div className="flex items-start justify-center gap-4 mb-6 relative">
              <div className="flex flex-col items-center w-32">
                <button
                  onClick={() => setIsExtendedMode(false)}
                  className="cursor-pointer transition-opacity hover:opacity-80"
                  type="button"
                >
                  <Image
                    src="/basic.png"
                    alt="Basic mode"
                    width={72}
                    height={72}
                    className={`rounded-xl border-2 border-orange-200 ${
                      !isExtendedMode
                        ? "opacity-100"
                        : "opacity-50 transition-opacity"
                    }`}
                  />
                </button>
                <div className="flex flex-col items-center gap-0.5 mt-2">
                  <span
                    className={`text-sm md:text-lg font-medium ${!isExtendedMode ? "text-gray-900 dark:text-gray-100" : "text-gray-500 dark:text-gray-400"}`}
                  >
                    Core
                  </span>
                  <span className="text-xs md:text-base italic text-gray-600 dark:text-gray-400">
                    (recommended)
                  </span>
                </div>
              </div>
              <div className="absolute left-1/2 top-0 -translate-x-1/2 flex items-center h-[72px]">
                <Switch
                  checked={isExtendedMode}
                  onCheckedChange={setIsExtendedMode}
                  className="bg-white border-gray-300 data-[state=checked]:bg-teal-600 data-[state=unchecked]:bg-gray-300 [&>span]:bg-white"
                />
              </div>
              <div className="flex flex-col items-center w-32">
                <button
                  onClick={() => setIsExtendedMode(true)}
                  className="cursor-pointer transition-opacity hover:opacity-80"
                  type="button"
                >
                  <Image
                    src="/extended.png"
                    alt="Extended mode"
                    width={72}
                    height={72}
                    className={`rounded-xl border-2 border-orange-200 ${
                      isExtendedMode
                        ? "opacity-100"
                        : "opacity-50 transition-opacity"
                    }`}
                  />
                </button>
                <span
                  className={`text-sm md:text-lg font-medium mt-2 ${isExtendedMode ? "text-gray-900 dark:text-gray-100" : "text-gray-500 dark:text-gray-400"}`}
                >
                  Expert
                </span>
              </div>
            </div>

            {/* Progress indicator */}
            <div className="mb-6">
              <div className="flex items-center justify-center gap-2 mb-2">
                <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
                <span
                  className="text-sm md:text-lg font-semibold text-gray-700 dark:text-gray-200"
                  suppressHydrationWarning
                >
                  {visibleCompletedTools} / {visibleTotalTools} Tools Acquired
                </span>
              </div>
              <div className="w-full max-w-md mx-auto bg-gray-200 dark:bg-slate-700 rounded-full h-3">
                <div
                  className="bg-gradient-to-r from-green-500 to-green-600 dark:from-green-400 dark:to-green-500 h-3 rounded-full transition-all duration-500 ease-out"
                  style={{
                    width: `${visibleTotalTools > 0 ? (visibleCompletedTools / visibleTotalTools) * 100 : 0}%`,
                  }}
                  suppressHydrationWarning
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="max-w-4xl mx-auto px-4 py-8">
        {showAccessNotice && (
          <div className="relative mb-6 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg shadow-sm px-5 pr-12 py-3 w-[60%] mx-auto">
            <button
              type="button"
              onClick={dismissAccessNotice}
              className="absolute top-2 right-2 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 transition-colors"
              aria-label="Dismiss notice"
            >
              <X className="h-4 w-4" />
            </button>
            <p className="text-xs italic text-gray-700 dark:text-gray-200 text-center">
              To access the problems, solutions, and AI interviewer, you'll have
              to create an account, but there's nothing else you need to do.
            </p>
          </div>
        )}
        <Accordion type="multiple" className="space-y-4">
          {visibleCategories.map((category) => (
            <AccordionItem
              key={category.name}
              value={category.name}
              className="bg-white dark:bg-slate-800 rounded-lg shadow-md border border-gray-200 dark:border-slate-700 overflow-hidden"
            >
              <div className="px-6 py-4 hover:bg-gray-50 dark:hover:bg-slate-700/50 relative">
                <div className="flex items-center gap-3 w-full">
                  <div
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                    className="flex items-center z-10 relative"
                  >
                    <Checkbox
                      checked={completedCategories.has(category.name)}
                      onCheckedChange={() => toggleCategory(category.name)}
                      className="data-[state=checked]:bg-green-600 data-[state=checked]:border-green-600"
                    />
                  </div>
                  <AccordionTrigger className="flex flex-1 items-center justify-between p-0 pr-6 text-left hover:no-underline absolute inset-0 w-full h-full">
                    <div className="flex flex-1 items-center justify-between pl-[60px] pr-0 py-4">
                      <h3 className="text-xs md:text-lg font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                        {`${category.chapterNumber}. `}
                        {category.name}
                        {category.allExtraCredit && (
                          <span className="text-[10px] bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300 px-1.5 py-0.5 rounded">
                            Extra Credit
                          </span>
                        )}
                      </h3>
                      <div className="flex items-center gap-3 ml-3 mr-4">
                        <span
                          className="text-xs md:text-sm text-gray-500 dark:text-gray-400"
                          suppressHydrationWarning
                        >
                          {
                            category.tools.filter((t) =>
                              completedTools.has(t.id)
                            ).length
                          }{" "}
                          / {category.tools.length}
                        </span>
                        <div className="w-8 md:w-16 bg-gray-200 dark:bg-slate-700 rounded-full h-2">
                          <div
                            className="bg-green-500 dark:bg-green-400 h-2 rounded-full transition-all duration-300"
                            style={{
                              width: `${
                                category.tools.length > 0
                                  ? (category.tools.filter((t) =>
                                      completedTools.has(t.id)
                                    ).length /
                                      category.tools.length) *
                                    100
                                  : 0
                              }%`,
                            }}
                            suppressHydrationWarning
                          />
                        </div>
                      </div>
                    </div>
                  </AccordionTrigger>
                </div>
              </div>
              <AccordionContent className="px-6 pt-3 pb-3">
                <div className="space-y-2">
                  {category.tools.map((tool) => (
                    <div
                      key={tool.id}
                      className={`flex items-center gap-3 p-2 rounded-md border transition-all duration-300 relative overflow-hidden ${
                        completedTools.has(tool.id)
                          ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-700"
                          : "bg-gray-50 dark:bg-slate-800/50 border-gray-200 dark:border-slate-700 hover:bg-gray-100 dark:hover:bg-slate-700 hover:shadow-sm"
                      }`}
                    >
                      {/* Animated background sweep */}
                      {completedTools.has(tool.id) && (
                        <div className="absolute inset-0 bg-gradient-to-r from-green-200 via-green-300 to-green-100 dark:from-green-900/30 dark:via-green-800/30 dark:to-green-900/20 animate-sweep"></div>
                      )}

                      <div className="relative z-10 flex flex-col sm:flex-row sm:items-center gap-3 w-full">
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <div className="relative flex items-center flex-shrink-0">
                            <Checkbox
                              id={tool.id}
                              checked={completedTools.has(tool.id)}
                              onCheckedChange={() => toggleTool(tool.id)}
                              onMouseEnter={(e) => handleMouseEnter(e, tool.id)}
                              onMouseLeave={handleMouseLeave}
                              className={`data-[state=checked]:bg-green-600 data-[state=checked]:border-green-600 transition-all duration-300 ${
                                completedTools.has(tool.id)
                                  ? "animate-burst"
                                  : ""
                              }`}
                            />
                          </div>

                          <div className="flex-1 min-w-0 flex items-start gap-2 flex-wrap">
                            <label
                              htmlFor={tool.id}
                              className={`font-medium cursor-pointer transition-all duration-300 text-xs md:text-sm ${
                                completedTools.has(tool.id)
                                  ? "text-green-800 dark:text-green-300"
                                  : "text-gray-900 dark:text-gray-100"
                              }`}
                            >
                              {tool.name}
                            </label>
                            {tool.extraCredit && (
                              <span className="text-[10px] md:text-xs bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300 px-1.5 md:px-2 py-0.5 rounded flex-shrink-0 self-start">
                                Extra Credit
                              </span>
                            )}
                            <Info
                              className="h-4 w-4 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 cursor-help flex-shrink-0 self-start mt-0.5"
                              onMouseEnter={(e) =>
                                handleInfoHover(e, tool.wantedOutcome)
                              }
                              onMouseLeave={handleMouseLeave}
                            />
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-2 flex-shrink-0 sm:flex-nowrap">
                          {tool.primaryProblem && (
                            <Button
                              asChild
                              variant="outline"
                              size="sm"
                              className="text-[10px] md:text-xs px-1.5 md:px-2 py-0.5 md:py-1 h-6 md:h-7 bg-blue-50 dark:bg-blue-900/30 border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/50"
                            >
                              <a
                                href={getProblemUrl(tool.primaryProblem)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1"
                                onClick={() =>
                                  handleProblemClick(tool.primaryProblem!)
                                }
                                onMouseEnter={(e) => {
                                  if (!tool.primaryProblem) return;
                                  const rect =
                                    e.currentTarget.getBoundingClientRect();
                                  setTooltip({
                                    show: true,
                                    x: rect.left + rect.width / 2,
                                    y: rect.top - 10,
                                    content: tool.primaryProblem,
                                  });
                                }}
                                onMouseLeave={handleMouseLeave}
                              >
                                <ExternalLink className="h-2.5 w-2.5 md:h-3 md:w-3 flex-shrink-0" />
                                <span className="hidden md:inline">
                                  Sample problem
                                </span>
                                <span className="md:hidden">Problem</span>
                              </a>
                            </Button>
                          )}

                          {tool.otherProblems.length > 0 && (
                            <>
                              <Button
                                variant="outline"
                                size="sm"
                                className="text-[10px] md:text-xs px-1.5 md:px-2 py-0.5 md:py-1 h-6 md:h-7 bg-orange-50 dark:bg-orange-900/30 border-orange-300 dark:border-orange-700 text-orange-700 dark:text-orange-300 hover:bg-orange-100 dark:hover:bg-orange-900/50"
                                onClick={() => setOpenModal(tool.id)}
                              >
                                Extra problems
                              </Button>
                              <Dialog
                                open={openModal === tool.id}
                                onOpenChange={(open) =>
                                  setOpenModal(open ? tool.id : null)
                                }
                              >
                                <DialogContent
                                  className="max-w-2xl max-h-[80vh] overflow-y-auto bg-white dark:bg-slate-800 border-gray-200 dark:border-slate-700"
                                  onOpenAutoFocus={(e) => e.preventDefault()}
                                >
                                  <DialogHeader>
                                    <DialogTitle className="text-gray-900 dark:text-gray-100">
                                      {tool.name}: Extra Problems
                                    </DialogTitle>
                                  </DialogHeader>
                                  <div className="space-y-2 mt-4">
                                    {/* Primary Problem */}
                                    {tool.primaryProblem && (
                                      <>
                                        <div className="mb-1">
                                          <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                                            Primary Problem
                                          </span>
                                        </div>
                                        {(() => {
                                          const difficulty =
                                            getProblemDifficulty(
                                              tool.primaryProblem
                                            );
                                          const colorClasses =
                                            getDifficultyCardClasses(
                                              difficulty
                                            );
                                          const isClicked = clickedProblems.has(
                                            tool.primaryProblem
                                          );
                                          const isCompleted =
                                            completedProblems.has(
                                              tool.primaryProblem
                                            );
                                          const toolsUsingProblem =
                                            problemToToolsMap.get(
                                              tool.primaryProblem
                                            ) || [];
                                          return (
                                            <div>
                                              <a
                                                href={getProblemUrl(
                                                  tool.primaryProblem
                                                )}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                onClick={() =>
                                                  handleProblemClick(
                                                    tool.primaryProblem!
                                                  )
                                                }
                                                className={`block p-3 rounded-md border transition-colors ${colorClasses} ${
                                                  isClicked
                                                    ? "opacity-75 ring-2 ring-blue-300 dark:ring-blue-600"
                                                    : ""
                                                }`}
                                              >
                                                <div className="flex items-center justify-between">
                                                  <div className="flex items-center gap-2">
                                                    <span className="text-sm font-medium text-gray-900 dark:text-gray-100 flex items-center">
                                                      {tool.primaryProblem}
                                                    </span>
                                                    {isClicked && (
                                                      <>
                                                        <Eye className="h-4 w-4 text-blue-600 dark:text-blue-400 flex-shrink-0 flex items-center" />
                                                        <div
                                                          onClick={(e) => {
                                                            e.preventDefault();
                                                            e.stopPropagation();
                                                            toggleProblemCompletion(
                                                              tool.primaryProblem!
                                                            );
                                                          }}
                                                          className="flex items-center justify-center"
                                                        >
                                                          <Checkbox
                                                            checked={
                                                              isCompleted
                                                            }
                                                            onCheckedChange={() =>
                                                              toggleProblemCompletion(
                                                                tool.primaryProblem!
                                                              )
                                                            }
                                                            className="h-3.5 w-3.5 data-[state=checked]:bg-green-600 data-[state=checked]:border-green-600 [&>span>svg]:h-3 [&>span>svg]:w-3"
                                                          />
                                                        </div>
                                                      </>
                                                    )}
                                                  </div>
                                                  <ExternalLink className="h-4 w-4 text-gray-400 dark:text-gray-500" />
                                                </div>
                                              </a>
                                              {toolsUsingProblem.length > 1 && (
                                                <div className="pl-3 mt-1 mb-3 text-xs text-gray-600 dark:text-gray-400">
                                                  <span className="font-bold">
                                                    Also uses:
                                                  </span>{" "}
                                                  {toolsUsingProblem
                                                    .filter(
                                                      (entry) =>
                                                        entry.tool.id !==
                                                        tool.id
                                                    )
                                                    .map((entry, idx) => (
                                                      <span
                                                        key={`${entry.category.chapterNumber}-${entry.tool.id}`}
                                                      >
                                                        {idx > 0 && ", "}
                                                        <span className="font-medium">
                                                          {
                                                            entry.category
                                                              .chapterNumber
                                                          }
                                                          .{" "}
                                                          {entry.category.name}
                                                        </span>{" "}
                                                        → {entry.tool.name}
                                                      </span>
                                                    ))}
                                                </div>
                                              )}
                                            </div>
                                          );
                                        })()}
                                        {tool.otherProblems.length > 0 && (
                                          <div className="my-4 border-t border-gray-200 dark:border-slate-700"></div>
                                        )}
                                      </>
                                    )}
                                    {/* Extra Problems */}
                                    {tool.otherProblems.length > 0 && (
                                      <>
                                        <div className="mb-1">
                                          <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                                            Extra Problems
                                          </span>
                                        </div>
                                        {[...tool.otherProblems]
                                          .map((name, idx) => ({
                                            name,
                                            idx,
                                            difficulty:
                                              getProblemDifficulty(name),
                                          }))
                                          .sort(
                                            (a, b) =>
                                              getDifficultyRank(a.difficulty) -
                                                getDifficultyRank(
                                                  b.difficulty
                                                ) || a.idx - b.idx
                                          )
                                          .map(({ name, difficulty }) => {
                                            const colorClasses =
                                              getDifficultyCardClasses(
                                                difficulty
                                              );
                                            const isClicked =
                                              clickedProblems.has(name);
                                            const isCompleted =
                                              completedProblems.has(name);
                                            const toolsUsingProblem =
                                              problemToToolsMap.get(name) || [];
                                            return (
                                              <div key={name}>
                                                <a
                                                  href={getProblemUrl(name)}
                                                  target="_blank"
                                                  rel="noopener noreferrer"
                                                  onClick={() =>
                                                    handleProblemClick(name)
                                                  }
                                                  className={`block p-3 rounded-md border transition-colors ${colorClasses} ${
                                                    isClicked
                                                      ? "opacity-75 ring-2 ring-blue-300 dark:ring-blue-600"
                                                      : ""
                                                  }`}
                                                >
                                                  <div className="flex items-center justify-between">
                                                    <div className="flex items-center gap-2">
                                                      <span className="text-sm font-medium text-gray-900 dark:text-gray-100 flex items-center">
                                                        {name}
                                                      </span>
                                                      {isClicked && (
                                                        <>
                                                          <Eye className="h-4 w-4 text-blue-600 dark:text-blue-400 flex-shrink-0 flex items-center" />
                                                          <div
                                                            onClick={(e) => {
                                                              e.preventDefault();
                                                              e.stopPropagation();
                                                              toggleProblemCompletion(
                                                                name
                                                              );
                                                            }}
                                                            className="flex items-center justify-center"
                                                          >
                                                            <Checkbox
                                                              checked={
                                                                isCompleted
                                                              }
                                                              onCheckedChange={() =>
                                                                toggleProblemCompletion(
                                                                  name
                                                                )
                                                              }
                                                              className="h-3.5 w-3.5 data-[state=checked]:bg-green-600 data-[state=checked]:border-green-600 [&>span>svg]:h-3 [&>span>svg]:w-3"
                                                            />
                                                          </div>
                                                        </>
                                                      )}
                                                    </div>
                                                    <ExternalLink className="h-4 w-4 text-gray-400 dark:text-gray-500" />
                                                  </div>
                                                </a>
                                                {toolsUsingProblem.filter(
                                                  (entry) =>
                                                    entry.tool.id !== tool.id
                                                ).length > 0 && (
                                                  <div className="pl-3 mt-1 mb-3 text-xs text-gray-600 dark:text-gray-400">
                                                    <span className="font-bold">
                                                      Also uses:
                                                    </span>{" "}
                                                    {toolsUsingProblem
                                                      .filter(
                                                        (entry) =>
                                                          entry.tool.id !==
                                                          tool.id
                                                      )
                                                      .map((entry, idx) => (
                                                        <span
                                                          key={`${entry.category.chapterNumber}-${entry.tool.id}`}
                                                        >
                                                          {idx > 0 && ", "}
                                                          <span className="font-medium">
                                                            {
                                                              entry.category
                                                                .chapterNumber
                                                            }
                                                            .{" "}
                                                            {
                                                              entry.category
                                                                .name
                                                            }
                                                          </span>{" "}
                                                          → {entry.tool.name}
                                                        </span>
                                                      ))}
                                                  </div>
                                                )}
                                              </div>
                                            );
                                          })}
                                      </>
                                    )}
                                  </div>
                                </DialogContent>
                              </Dialog>
                            </>
                          )}

                          {/* ChatGPT - always visible */}
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-6 w-6 md:h-7 md:w-7 bg-green-50 dark:bg-green-900/30 border-green-300 dark:border-green-700 text-green-700 dark:text-green-300 hover:bg-green-100 dark:hover:bg-green-900/50 flex items-center justify-center"
                            onClick={() =>
                              openAIWithPrompt("chatgpt", tool.name, tool.wantedOutcome)
                            }
                            title="Learn with ChatGPT"
                          >
                            <svg viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5 md:h-4 md:w-4">
                              <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364l2.0201-1.1638a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.4092-.6813zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0974-2.3616l2.603-1.5006 2.6029 1.5006v3.0013l-2.6029 1.5006-2.603-1.5006z"/>
                            </svg>
                          </Button>
                          {/* Claude - hidden on narrow screens */}
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-6 w-6 md:h-7 md:w-7 bg-green-50 dark:bg-green-900/30 border-green-300 dark:border-green-700 text-green-700 dark:text-green-300 hover:bg-green-100 dark:hover:bg-green-900/50 hidden sm:flex items-center justify-center"
                            onClick={() =>
                              openAIWithPrompt("claude", tool.name, tool.wantedOutcome)
                            }
                            title="Learn with Claude"
                          >
                            <svg viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5 md:h-4 md:w-4">
                              <path d="m3.127 10.604 3.135-1.76.053-.153-.053-.085H6.11l-.525-.032-1.791-.048-1.554-.065-1.505-.08-.38-.081L0 7.832l.036-.234.32-.214.455.04 1.009.069 1.513.105 1.097.064 1.626.17h.259l.036-.105-.089-.065-.068-.064-1.566-1.062-1.695-1.121-.887-.646-.48-.327-.243-.306-.104-.67.435-.48.585.04.15.04.593.456 1.267.981 1.654 1.218.242.202.097-.068.012-.049-.109-.181-.9-1.626-.96-1.655-.428-.686-.113-.411a2 2 0 0 1-.068-.484l.496-.674L4.446 0l.662.089.279.242.411.94.666 1.48 1.033 2.014.302.597.162.553.06.17h.105v-.097l.085-1.134.157-1.392.154-1.792.052-.504.25-.605.497-.327.387.186.319.456-.045.294-.19 1.23-.37 1.93-.243 1.29h.142l.161-.16.654-.868 1.097-1.372.484-.545.565-.601.363-.287h.686l.505.751-.226.775-.707.895-.585.759-.839 1.13-.524.904.048.072.125-.012 1.897-.403 1.024-.186 1.223-.21.553.258.06.263-.218.536-1.307.323-1.533.307-2.284.54-.028.02.032.04 1.029.098.44.024h1.077l2.005.15.525.346.315.424-.053.323-.807.411-3.631-.863-.872-.218h-.12v.073l.726.71 1.331 1.202 1.667 1.55.084.383-.214.302-.226-.032-1.464-1.101-.565-.497-1.28-1.077h-.084v.113l.295.432 1.557 2.34.08.718-.112.234-.404.141-.444-.08-.911-1.28-.94-1.44-.759-1.291-.093.053-.448 4.821-.21.246-.484.186-.403-.307-.214-.496.214-.98.258-1.28.21-1.016.19-1.263.112-.42-.008-.028-.092.012-.953 1.307-1.448 1.957-1.146 1.227-.274.109-.477-.247.045-.44.266-.39 1.586-2.018.956-1.25.617-.723-.004-.105h-.036l-4.212 2.736-.75.096-.324-.302.04-.496.154-.162 1.267-.871z"/>
                            </svg>
                          </Button>
                          {/* Copy to clipboard - hidden on narrow screens */}
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-6 w-6 md:h-7 md:w-7 bg-green-50 dark:bg-green-900/30 border-green-300 dark:border-green-700 text-green-700 dark:text-green-300 hover:bg-green-100 dark:hover:bg-green-900/50 hidden sm:flex items-center justify-center"
                            onClick={() =>
                              copyLearningPrompt(tool.name, tool.wantedOutcome)
                            }
                            title="Copy learning prompt"
                          >
                            <ClipboardCopy className="h-3.5 w-3.5 md:h-4 md:w-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>

      {/* How to Use Modal */}
      <Dialog open={isHowToUseOpen} onOpenChange={setIsHowToUseOpen}>
        <DialogContent
          className="max-w-2xl max-h-[80vh] overflow-y-auto bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-slate-800 dark:to-slate-800 border-gray-200 dark:border-slate-700"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle className="text-base md:text-lg text-gray-900 dark:text-gray-100">
              About / How to Use
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-4 text-gray-700 dark:text-gray-300">
            <div className="space-y-3">
              <div>
                <h4 className="text-sm md:text-base font-semibold text-gray-900 dark:text-gray-100 mb-1">
                  Philosophy
                </h4>
                <p className="text-xs md:text-sm">
                  TOOLKIT-X shares BCtCI's philosophy: to be ready for
                  interviews, don't memorize problems - build a{" "}
                  <strong>toolkit</strong> of reusable techniques, recipes, and
                  concepts.
                  <br />
                  <br />
                  Read the{" "}
                  <a
                    href="https://nilmamano.com/blog/toolkit" target="_blank" rel="noopener noreferrer"
                    className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-medium no-underline"
                  >
                    Toolkit-X blog post
                  </a>{" "}
                  for more.
                </p>
              </div>
              <div>
                <h4 className="text-sm md:text-base font-semibold text-gray-900 dark:text-gray-100 mb-1">
                  Core vs Expert Mode
                </h4>
                <p className="text-xs md:text-sm">
                  The <strong>Core toolkit</strong> is well-rounded and designed
                  to get you interview-ready.
                  <br />
                  <br />
                  If you acquire every Core tool, you can switch to the expanded{" "}
                  <strong>Expert toolkit</strong>, but be aware of diminishing
                  returns.
                </p>
              </div>
              <div>
                <h4 className="text-sm md:text-base font-semibold text-gray-900 dark:text-gray-100 mb-1">
                  'Acquiring' tools
                </h4>
                <div className="my-3">
                  <Image
                    src="https://nilmamano.com/blog/toolkit/tool.png"
                    alt="Tool UI component explanation"
                    width={800}
                    height={400}
                    className="rounded-lg border border-gray-200 dark:border-slate-700 w-full h-auto"
                  />
                </div>
                <p className="text-xs md:text-sm">
                  Each tool has a <strong>Sample Problem</strong> from BCtCI
                  that demonstrates its use. Click to view the statement and
                  solution explanation + code in multiple languages.
                  <br />
                  <br />
                  Before reading the solution, launch our{" "}
                  <strong>AI interviewer to try the question yourself</strong> -
                  and then compare your approach. Active learning is key!
                </p>
                <div className="my-3">
                  <Image
                    src="https://nilmamano.com/blog/toolkit/ai-interviewer.png"
                    alt="AI Interviewer prompt"
                    width={800}
                    height={400}
                    className="rounded-lg border border-gray-200 dark:border-slate-700 w-full h-auto"
                  />
                </div>
                <p className="text-xs md:text-sm">
                  The BCtCI platform requires an account, but{" "}
                  <strong>all content and the AI interviewer are free</strong>.
                  <br />
                  <br />
                  By default, skip the <strong>Extra Problems</strong>. The goal
                  isn't to solve them all -{" "}
                  <strong>this is not a Problem List</strong> where you have to
                  solve all the problems to check off the tool (Completionists,
                  I'm looking at you!) But if one problem isn't enough, check
                  out these optional problems using the same tool. Note: extra
                  problems may require more advanced tools.
                  <br />
                  <br />
                  To supplement our materials, click the{" "}
                  <strong>ChatGPT</strong> or <strong>Claude</strong> icon to
                  open your preferred AI with a prompt asking it to explain the
                  concept, or the clipboard icon to copy the prompt.
                  <br />
                  <br />
                  <strong>Tip:</strong> as you learn new tools, add them to your{" "}
                  <a
                    href="https://nilmamano.com/blog/bctci-free-resources#practice-tools"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-medium underline"
                  >
                    cheat sheet
                  </a>{" "}
                  in your own words.
                </p>
              </div>
              <div>
                <h4 className="text-sm md:text-base font-semibold text-gray-900 dark:text-gray-100 mb-1">
                  Tracking Progress
                </h4>
                <p className="text-xs md:text-sm">
                  Mark tools as you learn them. Complete all tools in a category
                  to mark the category as done. Your progress is saved locally
                  in your browser - no login required.
                </p>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Footer */}
      <footer className="border-t border-white/20 dark:border-slate-700/50 mt-16">
        <div className="max-w-4xl mx-auto px-4 py-8 text-center">
          <div className="flex justify-center items-center gap-6 flex-wrap">
            <a
              href="https://www.amazon.com/dp/195570600X"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm md:text-base text-orange-600 dark:text-orange-400 hover:text-orange-700 dark:hover:text-orange-300 font-bold"
            >
              Get the Book
            </a>
            <a
              href="https://bctci.co/discord"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm md:text-base text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 font-semibold"
            >
              Join Discord
            </a>
            <span className="text-sm md:text-base text-gray-600 dark:text-gray-400 font-medium">
              Created by{" "}
              <a
                href="https://nilmamano.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-medium no-underline"
              >
                Nil Mamano
              </a>
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
