import type { Metadata } from "next";
import { UploadForm } from "./upload-form";

export const metadata: Metadata = {
  title: "Ingest .axdb",
};

export default function AdminIngestPage() {
  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <UploadForm />
    </main>
  );
}
