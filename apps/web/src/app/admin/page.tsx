import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
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
              <CardTitle>Ingest .axdb</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-3">
                <p className="text-sm text-muted-foreground">
                  Upload a post-event VisualAX .axdb file to publish results.
                </p>
                <Button variant="default" size="default" tabIndex={-1} aria-hidden={true}>Upload .axdb file →</Button>
              </div>
            </CardContent>
          </Card>
        </Link>
      </div>
    </main>
  );
}
