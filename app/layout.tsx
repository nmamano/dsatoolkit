import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/toaster";
import { cn } from "@/lib/utils";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import type React from "react";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL("https://dsatoolkit.com"),
  title: "TOOLKIT-X | Like a problem list, but for reusable techniques",
  description:
    "The essential DS&A tools and techniques for interviews - with problems from Beyond Cracking the Coding Interview.",
  icons: {
    icon: [
      { url: "/favicon/favicon.ico" },
      {
        url: "/favicon/favicon-96x96.png",
        sizes: "96x96",
        type: "image/png",
      },
      { url: "/favicon/favicon.svg", type: "image/svg+xml" },
    ],
    apple: [{ url: "/favicon/apple-touch-icon.png" }],
  },
  manifest: "/favicon/site.webmanifest",
  openGraph: {
    title: "TOOLKIT-X | Like a problem list, but for reusable techniques",
    description:
      "The essential DS&A tools and techniques for interviews - with problems from Beyond Cracking the Coding Interview.",
    url: "https://dsatoolkit.com",
    siteName: "Toolkit-X",
    images: [
      {
        url: "https://dsatoolkit.com/thumbnail.png",
        width: 1200,
        height: 630,
        alt: "TOOLKIT-X - Like a problem list, but for reusable techniques",
      },
    ],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "TOOLKIT-X | Like a problem list, but for reusable techniques",
    description:
      "The essential DS&A tools and techniques for interviews - with problems from Beyond Cracking the Coding Interview.",
    images: ["https://dsatoolkit.com/thumbnail.png"],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="icon" href="/favicon/favicon.ico" sizes="any" />
        <link rel="apple-touch-icon" href="/favicon/apple-touch-icon.png" />
        <link
          rel="icon"
          type="image/png"
          sizes="96x96"
          href="/favicon/favicon-96x96.png"
        />
        <link rel="manifest" href="/favicon/site.webmanifest" />
        <meta name="theme-color" content="#ffffff" />
      </head>
      <body
        className={cn(
          "min-h-screen bg-background font-sans antialiased",
          inter.className
        )}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
