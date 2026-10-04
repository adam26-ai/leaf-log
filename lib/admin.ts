import { prisma } from "@/lib/prisma";

type AdminDb = Pick<typeof prisma, "user" | "siteAdmin">;

/** Local testing is pinned to an immutable account ID, never a claimable handle. */
export function isLocalMainAdmin(id: string): boolean {
  const url = process.env.DATABASE_URL;
  return process.env.NODE_ENV !== "production" && !!url && URL.canParse(url)
    && ["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname)
    && !!process.env.LOCAL_MAIN_ADMIN_USER_ID && id === process.env.LOCAL_MAIN_ADMIN_USER_ID;
}

export async function isMainAdmin(id: string, db: Pick<AdminDb, "user"> = prisma): Promise<boolean> {
  if (isLocalMainAdmin(id)) return true;
  const user = await db.user.findUnique({ where: { id }, select: { email: true, emailVerified: true } });
  return !!user?.emailVerified && user.email?.toLowerCase() === "leafvario@gmail.com";
}

export async function isSiteAdmin(id: string, db: AdminDb = prisma): Promise<boolean> {
  if (await isMainAdmin(id, db)) return true;
  const grant = await db.siteAdmin.findUnique({ where: { userId: id } });
  return !!grant && grant.revokedAt === null;
}

export async function requireMainAdmin(id: string | null) {
  if (!id || !await isMainAdmin(id)) throw new Error("Only the main admin can manage site administrators.");
  return id;
}

export async function searchAdminUsers(actorId: string | null, query: string) {
  await requireMainAdmin(actorId);
  const value = query.trim();
  if (value.length < 2) return [];
  if (value.length > 100) throw new Error("Use at most 100 characters.");
  return prisma.user.findMany({
    where: { profile: { isNot: null }, OR: [
      { email: { contains: value, mode: "insensitive" } },
      { profile: { handle: { contains: value, mode: "insensitive" } } },
      { profile: { displayName: { contains: value, mode: "insensitive" } } },
    ] },
    select: { id: true, email: true, profile: { select: { handle: true, displayName: true } } },
    orderBy: { id: "asc" }, take: 30,
  });
}

export async function listSiteAdmins(actorId: string | null) {
  await requireMainAdmin(actorId);
  return prisma.siteAdmin.findMany({
    include: { user: { select: { email: true, profile: { select: { handle: true, displayName: true } } } } },
    orderBy: [{ createdAt: "asc" }, { userId: "asc" }],
  });
}

export async function changeSiteAdmin(actorId: string | null, userId: string, operation: "grant" | "revoke" | "delete") {
  await requireMainAdmin(actorId);
  if (!userId || userId.length > 100) throw new Error("Choose a valid user.");
  if (await isMainAdmin(userId)) throw new Error("The main admin cannot be changed here.");
  if (operation === "grant") {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { profile: { select: { id: true } } } });
    if (!user?.profile) throw new Error("Choose a user with a pilot profile.");
    await prisma.siteAdmin.upsert({ where: { userId }, create: { userId }, update: { revokedAt: null } });
  } else if (operation === "revoke") {
    await prisma.siteAdmin.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  } else if (operation === "delete") {
    const result = await prisma.siteAdmin.deleteMany({ where: { userId, revokedAt: { not: null } } });
    if (!result.count) throw new Error("Revoke this admin before removing them from the list.");
  } else {
    throw new Error("Choose a valid admin action.");
  }
}
