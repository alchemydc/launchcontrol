import Link from "next/link";
import { cn } from "@/lib/utils";

export function DriverLink({
  driverId,
  name,
  className,
  basePath = "",
}: {
  driverId: number;
  name: string;
  className?: string;
  /** "" for the legacy route (byte-identical to pre-Task-20 hrefs), "/l/[slug]"
   *  for league-scoped. */
  basePath?: string;
}) {
  return (
    <Link
      href={`${basePath}/drivers/${driverId}`}
      className={cn(
        "font-medium text-primary underline-offset-2 hover:underline",
        className,
      )}
    >
      {name}
    </Link>
  );
}
