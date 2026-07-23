import { notFound } from "next/navigation";
import { getSession } from "@/lib/session";
import { isAnyLeagueAdmin } from "@/lib/admin";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!(await isAnyLeagueAdmin(session.msrUid))) notFound();
  return <>{children}</>;
}
