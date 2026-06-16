import Link from "next/link";
import { cn } from "@/lib/utils";

export function DriverLink({
  driverId,
  name,
  className,
}: {
  driverId: number;
  name: string;
  className?: string;
}) {
  return (
    <Link
      href={`/drivers/${driverId}`}
      className={cn(
        "font-medium text-primary underline-offset-2 hover:underline",
        className,
      )}
    >
      {name}
    </Link>
  );
}
