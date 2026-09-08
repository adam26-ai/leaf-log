import type { Metadata } from "next";
import "./globals.css";
import { fontVariables } from "@/lib/fonts";
import { getCurrentProfile } from "@/lib/profile";
import { UnitsProvider } from "@/components/units-provider";

export const metadata: Metadata = {
  title: "Leaf Log — your flight logbook",
  description:
    "The friendly flight logbook for the free-flight community. Upload your IGC flights, see them beautifully, and share what you choose. The official companion to the Leaf vario.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const profile = await getCurrentProfile();
  const defaultUnits = profile?.defaultUnits === "imperial" ? "imperial" : "metric";
  return (
    <html lang="en" className={`${fontVariables} h-full antialiased`}>
      <body className="bg-paper text-ink min-h-full flex flex-col overflow-x-hidden font-sans">
        <UnitsProvider key={`${profile?.id ?? "guest"}:${defaultUnits}`} defaultUnits={defaultUnits}>
          {children}
        </UnitsProvider>
      </body>
    </html>
  );
}
