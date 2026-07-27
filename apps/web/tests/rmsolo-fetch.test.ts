import { afterEach, describe, expect, it, vi } from "vitest";
import { assertRmsoloUrl, fetchRmsoloPdf } from "@/lib/rmsolo-index";

// PR #99 security review, item 3: the scraped index page controls which URLs
// the ingest loop downloads, so every outbound fetch is constrained — host
// allowlist, https-only, no redirects, streamed size cap, %PDF signature.

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("assertRmsoloUrl", () => {
  it("accepts https URLs on rmsolo.org hosts", () => {
    expect(() => assertRmsoloUrl("https://www.rmsolo.org/results/")).not.toThrow();
    expect(() => assertRmsoloUrl("https://rmsolo.org/wp-content/uploads/x.pdf")).not.toThrow();
    expect(() => assertRmsoloUrl("https://WWW.RMSOLO.ORG/a.pdf")).not.toThrow();
  });

  it("rejects plaintext http", () => {
    expect(() => assertRmsoloUrl("http://www.rmsolo.org/a.pdf")).toThrow(/non-https/);
  });

  it("rejects other hosts, including lookalikes and internal addresses", () => {
    expect(() => assertRmsoloUrl("https://evil.example/a.pdf")).toThrow(/approved RMsolo host/);
    expect(() => assertRmsoloUrl("https://rmsolo.org.evil.example/a.pdf")).toThrow(
      /approved RMsolo host/,
    );
    expect(() => assertRmsoloUrl("https://169.254.169.254/latest/meta-data")).toThrow(
      /approved RMsolo host/,
    );
  });

  it("rejects malformed URLs", () => {
    expect(() => assertRmsoloUrl("not a url")).toThrow(/malformed/);
  });
});

describe("fetchRmsoloPdf", () => {
  const URL_OK = "https://www.rmsolo.org/wp-content/uploads/event_Full.pdf";

  it("refuses a disallowed host without ever fetching", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(fetchRmsoloPdf("https://evil.example/a.pdf")).rejects.toThrow(
      /approved RMsolo host/,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses to follow redirects (they could leave the allowlisted host)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 302, headers: { location: "https://evil.example/" } })),
    );
    await expect(fetchRmsoloPdf(URL_OK)).rejects.toThrow(/refusing to follow redirect/);
  });

  it("rejects oversized responses via the declared content-length", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("x", {
            status: 200,
            headers: { "content-length": String(100 * 1024 * 1024) },
          }),
      ),
    );
    await expect(fetchRmsoloPdf(URL_OK)).rejects.toThrow(/declares .* bytes/);
  });

  it("rejects bodies that are not PDFs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>definitely not a pdf</html>", { status: 200 })),
    );
    await expect(fetchRmsoloPdf(URL_OK)).rejects.toThrow(/missing %PDF- signature/);
  });

  it("returns the buffer for a well-formed PDF response", async () => {
    const body = "%PDF-1.7 synthetic";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status: 200 })));
    const buf = await fetchRmsoloPdf(URL_OK);
    expect(buf.toString("utf8")).toBe(body);
  });

  it("propagates HTTP errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 404, statusText: "Not Found" })));
    await expect(fetchRmsoloPdf(URL_OK)).rejects.toThrow(/HTTP 404/);
  });
});
