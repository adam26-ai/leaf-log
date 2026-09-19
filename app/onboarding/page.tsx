import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { getCurrentProfile } from "@/lib/profile";
import { signOutAction, switchEmailAction } from "@/lib/actions";
import { LeafLogLogo } from "@/components/brand/leaf-log-logo";
import { OnboardingForm } from "./onboarding-form";

export default async function OnboardingPage() {
  const session = await auth();
  const userId = session?.user?.id ?? null;
  if (!userId) redirect("/sign-in");

  const profile = await getCurrentProfile();
  if (profile) redirect("/logbook");

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between px-6 py-5 sm:px-10">
        <Link href="/"><LeafLogLogo /></Link>
        <form action={signOutAction}>
          <button type="submit" className="rounded-full px-3 py-2 text-sm font-medium text-ink hover:text-brand-blue-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue">Sign out</button>
        </form>
      </header>
      <main className="flex flex-1 items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-6 rounded-md border border-gray-200 bg-paper px-4 py-3 text-center text-sm text-gray-600">
            <p>Setting up a logbook as <strong className="break-all font-medium text-ink">{session?.user?.email}</strong>.</p>
            <form action={switchEmailAction}>
              <button type="submit" className="mt-1 font-medium text-brand-blue-strong underline underline-offset-2 hover:text-ink">Use a different email</button>
            </form>
          </div>
          <OnboardingForm />
        </div>
      </main>
    </div>
  );
}
