import { notFound } from "next/navigation";
import { getSession } from "@/lib/session";
import { isAnyLeagueAdmin } from "@/lib/admin";
import { connection } from "next/server";

export const instant = false;

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await connection();
  const session = await getSession();
  if (!(await isAnyLeagueAdmin(session.msrUid))) notFound();
  return <>{children}</>;
}
