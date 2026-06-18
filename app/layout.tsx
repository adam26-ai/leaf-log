import type { Metadata } from "next";
import "./globals.css";
import { fontVariables } from "@/lib/fonts";

export const metadata: Metadata = {
  title: "Leaf Log — your flight logbook",
  description:
    "The friendly flight logbook for the free-flight community. Upload your IGC flights, see them beautifully, and share what you choose. The official companion to the Leaf vario.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${fontVariables} h-full antialiased`}>
      <body className="bg-paper text-ink min-h-full flex flex-col font-sans">
        {children}
      </body>
    </html>
  );
}
