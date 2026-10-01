import { notFound } from "next/navigation";
import { requireRmrMember } from "@/lib/session";
import { DriverPageView } from "./driver-page-view";
import { connection } from "next/server";

export const instant = false;

export default async function DriverPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ league?: string; season?: string; from?: string; to?: string }>;
}) {
  await connection();
  const { id } = await params;

  // Gate runs before notFound() so unauth viewers can't probe driver id existence.
  await requireRmrMember(`/drivers/${id}`);

  const driverId = Number(id);
  if (!Number.isInteger(driverId) || driverId <= 0) notFound();

  const rawSearchParams = await searchParams;

  return <DriverPageView driverId={driverId} basePath="" searchParams={rawSearchParams} />;
}
