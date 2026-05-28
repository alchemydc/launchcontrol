/**
 * POST /api/auth/logout
 *
 * Destroys the main session cookie and redirects to the home page.
 * Must be POST (triggered by a <form method="post">) so it's not preloaded
 * by the browser as a GET prefetch and can't be triggered by CSRF-style links.
 */

import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";

export async function POST() {
  const session = await getSession();
  session.destroy();
  redirect("/");
}
