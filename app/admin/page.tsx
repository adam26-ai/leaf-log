import { notFound } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { requireProfile } from "@/lib/profile";
import { isMainAdmin, listSiteAdmins } from "@/lib/admin";
import { AdminManager } from "./admin-manager";

export const metadata = { title: "Admin — Leaf Log" };

export default async function AdminPage() {
  const profile = await requireProfile();
  if (!await isMainAdmin(profile.id)) notFound();
  const admins = await listSiteAdmins(profile.id);
  return <div className="flex flex-1 flex-col">
    <AppHeader profile={profile} />
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
      <h1 className="font-condensed text-3xl font-bold">Admin</h1>
      <p className="mt-2 text-sm text-gray-600">Manage access to edit and delete public sites. Only you, the main admin, can grant or revoke access.</p>
      <AdminManager mainAdmin={{ id: profile.id, handle: profile.handle, displayName: profile.displayName }} admins={admins.map(admin => ({
        id: admin.userId, email: admin.user.email, handle: admin.user.profile?.handle ?? null,
        displayName: admin.user.profile?.displayName ?? "Pilot", revoked: admin.revokedAt !== null,
      }))} />
    </main>
  </div>;
}
