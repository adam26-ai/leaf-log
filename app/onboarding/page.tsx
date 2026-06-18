import { redirect } from "next/navigation";
import { getCurrentUser, getCurrentProfile } from "@/lib/profile";
import { OnboardingForm } from "./onboarding-form";

export default async function OnboardingPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  const profile = await getCurrentProfile();
  if (profile) redirect("/logbook");

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <OnboardingForm />
      </div>
    </main>
  );
}
