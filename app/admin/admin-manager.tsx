"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { searchAdminUsersAction, changeSiteAdminAction } from "./actions";

type Admin = { id: string; email: string | null; handle: string | null; displayName: string; revoked: boolean };
type SearchUser = { id: string; email: string | null; profile: { handle: string; displayName: string } | null };

export function AdminManager({ mainAdmin, admins }: {
  mainAdmin: { id: string; handle: string; displayName: string }; admins: Admin[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchUser[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ id: string; operation: "revoke" | "delete" } | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  function search() {
    setError(""); setSelected(null); setMessage("");
    startTransition(async () => {
      try {
        const result = await searchAdminUsersAction(query);
        if (result.ok) setResults(result.users); else setError(result.error);
      } catch { setError("Could not search users. Please try again."); }
    });
  }
  function change(id: string, operation: "grant" | "revoke" | "delete") {
    setError(""); setMessage("");
    startTransition(async () => {
      try {
        const result = await changeSiteAdminAction(id, operation);
        if (!result.ok) { setError(result.error); return; }
        setConfirm(null); setSelected(null);
        setMessage(operation === "grant" ? "Site admin access enabled." : operation === "revoke" ? "Site admin access revoked. You can re-enable it later." : "Admin removed from the list. Their account is unchanged.");
        router.refresh();
      } catch { setError("Could not update admin access. Please try again."); }
    });
  }
  const chosen = results?.find(user => user.id === selected);
  const existing = admins.find(admin => admin.id === selected);
  return <>
    {error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}
    {message && <p role="status" className="mt-4 text-sm text-green-800">{message}</p>}
    <div className="mt-6 grid items-start gap-6 md:grid-cols-2">
      <Card className="min-w-0 p-5">
        <h2 className="font-condensed text-xl font-bold">Find users</h2>
        <form className="mt-4 flex flex-wrap gap-2" onSubmit={event => { event.preventDefault(); search(); }}>
          <label className="min-w-0 flex-1 text-sm">Search users
            <input type="search" value={query} onChange={event => { setQuery(event.target.value); setResults(null); setSelected(null); }} maxLength={100} disabled={pending} placeholder="Name, handle or email" className="mt-1 w-full rounded-md border border-gray-300 p-2" />
          </label>
          <Button type="submit" className="self-end" disabled={pending || query.trim().length < 2}>Search</Button>
        </form>
        <p className="mt-2 text-xs text-gray-500">Enter at least two characters. Up to 30 matches are shown.</p>
        <ul aria-label="User search results" className="mt-4 space-y-2">
          {results?.map(user => <li key={user.id}><button type="button" disabled={pending} aria-pressed={selected === user.id} onClick={() => setSelected(user.id)} className={`w-full break-words rounded-md border p-3 text-left text-sm ${selected === user.id ? "border-brand-blue bg-blue-50" : "border-gray-200"}`}>
            <span className="block font-semibold">{user.profile?.displayName} @{user.profile?.handle}</span><span className="text-gray-600">{user.email}</span>
          </button></li>)}
        </ul>
        {results?.length === 0 && <p className="mt-3 text-sm text-gray-600">No matching users.</p>}
        {chosen && <div className="mt-4">
          {chosen.id === mainAdmin.id ? <p className="text-sm">Main admin access is permanent.</p>
            : existing && !existing.revoked ? <p className="text-sm">This user already has active site admin access.</p>
            : <Button disabled={pending} onClick={() => change(chosen.id, "grant")}>{existing ? "Re-enable access" : "Grant site admin access"}</Button>}
        </div>}
      </Card>
      <Card className="min-w-0 p-5">
        <h2 className="font-condensed text-xl font-bold">Site admins</h2>
        <p className="mt-2 text-sm text-gray-600">Revoke access to turn an admin off. Re-enable them anytime, or delete the revoked entry to remove it from this list. Deleting an entry does not delete the user account.</p>
        <div className="mt-4 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm"><strong>{mainAdmin.displayName} @{mainAdmin.handle}</strong><p>Main admin · Always active</p></div>
        <ul aria-label="Site admins" className="mt-3 space-y-3">
          {admins.filter(admin => admin.id !== mainAdmin.id).map(admin => <li key={admin.id} className="break-words rounded-md border border-gray-200 p-3 text-sm">
            <p className="font-semibold">{admin.displayName}{admin.handle && ` @${admin.handle}`}</p><p className="text-gray-600">{admin.email}</p>
            <p className={`mt-1 font-medium ${admin.revoked ? "text-gray-500" : "text-green-800"}`}>{admin.revoked ? "Revoked" : "Active"}</p>
            {confirm?.id === admin.id ? <div className="mt-3">
              <p>{confirm.operation === "revoke" ? "Turn off this user's site admin access?" : "Permanently remove this revoked admin entry? Their user account will be kept."}</p>
              <div className="mt-2 flex flex-wrap gap-2"><Button variant="danger" disabled={pending} onClick={() => change(admin.id, confirm.operation)}>{confirm.operation === "revoke" ? "Confirm revoke" : "Confirm delete"}</Button><Button variant="outline" disabled={pending} onClick={() => setConfirm(null)}>Cancel</Button></div>
            </div> : <div className="mt-3 flex flex-wrap gap-2">
              {admin.revoked ? <><Button variant="outline" disabled={pending} onClick={() => change(admin.id, "grant")}>Re-enable</Button><Button variant="danger" disabled={pending} onClick={() => setConfirm({ id: admin.id, operation: "delete" })}>Delete</Button></>
                : <Button variant="outline" disabled={pending} onClick={() => setConfirm({ id: admin.id, operation: "revoke" })}>Revoke</Button>}
            </div>}
          </li>)}
        </ul>
        {!admins.length && <p className="mt-3 text-sm text-gray-500">No additional site admins yet.</p>}
      </Card>
    </div>
  </>;
}
