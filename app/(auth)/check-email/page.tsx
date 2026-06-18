import Link from "next/link";
import { AccentBar } from "@/components/ui/accent-bar";
import { Wordmark } from "@/components/brand/wordmark";

export default function CheckEmailPage() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="px-6 py-5 sm:px-10">
        <Link href="/">
          <Wordmark className="text-2xl" />
        </Link>
      </header>
      <main className="flex flex-1 items-center justify-center px-6 py-12">
        <div className="flex w-full max-w-sm flex-col gap-3 text-center">
          <h1 className="font-condensed text-3xl font-bold text-ink">
            Check your email
          </h1>
          <AccentBar className="mx-auto" />
          <p className="text-gray-600">
            We sent you a magic sign-in link. Open it on this device to continue.
          </p>
        </div>
      </main>
    </div>
  );
}
