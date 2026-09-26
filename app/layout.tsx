import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Bray-Ghost · Autonomous Outreach Engine",
  description: "Autonomous client discovery, SEO auditing, and personalized cold outreach system.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className="h-full antialiased"
    >
      <body className="min-h-full flex flex-col bg-[#1a1a1a] text-[#c8c4bc] selection:bg-[#8b3a2a] selection:text-[#c8c4bc]">
        {children}
      </body>
    </html>
  );
}
