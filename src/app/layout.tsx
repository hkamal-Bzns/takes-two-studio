import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Takes Two Studio — Admin",
  description: "Content management for the Takes Two Studio portfolio.",
  // The same generated set the public site uses, so the admin tab carries the
  // studio's own icon. This previously pointed at a third-party CDN.
  icons: {
    icon: [
      { url: "/api/icon/favicon.ico", sizes: "16x16 32x32" },
      { url: "/api/icon/favicon-32.png", type: "image/png", sizes: "32x32" },
    ],
    apple: { url: "/api/icon/apple-touch-icon.png", sizes: "180x180" },
  },
  manifest: "/api/icon/site.webmanifest",
  // A private CMS has no business in a search index.
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
