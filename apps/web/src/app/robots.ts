import type { MetadataRoute } from "next";

// Every page is server-rendered per request, so crawler traffic is billed as
// server CPU. Keep crawlers on the summary pages and off the long tail of
// per-driver pages and filter query-string permutations.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/drivers/", "/l/*/drivers/", "/me", "/admin", "/api/", "/login", "/*?"],
    },
  };
}
