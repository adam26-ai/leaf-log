import Link from "next/link";
import { Button } from "@/components/ui/button";
import { AccentBar } from "@/components/ui/accent-bar";
import { Wordmark } from "@/components/brand/wordmark";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between px-6 py-5 sm:px-10">
        <Wordmark className="text-2xl" />
        <Button asChild variant="ghost" size="sm">
          <Link href="/sign-in">Sign in</Link>
        </Button>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center px-6 py-20 text-center">
        <div className="flex w-full max-w-2xl flex-col items-center gap-7">
          <AccentBar width="3.5rem" />
          <h1 className="font-condensed text-5xl font-bold leading-[1.05] tracking-tight text-ink sm:text-6xl">
            Your flights, logged beautifully.
          </h1>
          <p className="max-w-xl text-lg leading-8 text-gray-600">
            The friendly flight logbook for the free-flight community. Upload an
            IGC file, see your flight come to life, and share only what you
            choose — private by default. The official companion to the{" "}
            <span className="font-medium text-ink">Leaf vario</span>.
          </p>
          <div className="mt-2 flex flex-col gap-3 sm:flex-row">
            <Button asChild size="lg">
              <Link href="/sign-in">Start your logbook</Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link href="/sign-in">Sign in</Link>
            </Button>
          </div>
        </div>
      </main>

      <footer className="px-6 py-6 text-center text-sm text-gray-500 sm:px-10">
        Built for the Leaf vario community.
      </footer>
    </div>
  );
}
