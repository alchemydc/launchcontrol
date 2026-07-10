import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Admin",
};

export default function AdminPage() {
  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm flex flex-col gap-4">
        <h1 className="text-xl font-semibold">Admin</h1>
        <Link href="/admin/ingest">
          <Card className="cursor-pointer hover:border-primary/40 transition-colors">
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                Ingest .axdb
                <ChevronRight className="h-5 w-5 text-muted-foreground" />
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Upload a post-event VisualAX .axdb file to publish results.
              </p>
            </CardContent>
          </Card>
        </Link>
        <Link href="/admin/events">
          <Card className="cursor-pointer hover:border-primary/40 transition-colors">
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                Manage events
                <ChevronRight className="h-5 w-5 text-muted-foreground" />
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Edit event metadata or delete duplicate/bad events.
              </p>
            </CardContent>
          </Card>
        </Link>
      </div>
    </main>
  );
}
