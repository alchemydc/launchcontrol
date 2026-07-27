import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { matchEventFolder, resolveSmugmugTarget } from "@/lib/smugmug";

const eventDate = new Date("2026-04-25T00:00:00Z");

const folders = [
  {
    urlName: "2026-04-25-Blooming-Cones-Autocross",
    webUri: "https://rmrpca.smugmug.com/Autocross/2026/2026-04-25-Blooming-Cones-Autocross",
    dateAdded: "2026-04-26T12:00:00Z",
  },
  {
    urlName: "2026-03-14-Spring-Series-Autocross",
    webUri: "https://rmrpca.smugmug.com/Autocross/2026/2026-03-14-Spring-Series-Autocross",
    dateAdded: "2026-03-15T12:00:00Z",
  },
  {
    urlName: "2026-06-20-Summer-Slalom",
    webUri: "https://rmrpca.smugmug.com/Autocross/2026/2026-06-20-Summer-Slalom",
    dateAdded: "2026-06-21T12:00:00Z",
  },
];

describe("matchEventFolder", () => {
  it("matches by keyword subset and date", () => {
    const result = matchEventFolder(folders, "Blooming Cones", eventDate);
    expect(result).toBe(
      "https://rmrpca.smugmug.com/Autocross/2026/2026-04-25-Blooming-Cones-Autocross"
    );
  });

  it("ignores stopwords like 'Autocross' in event name", () => {
    const result = matchEventFolder(
      folders,
      "Blooming Cones Autocross",
      eventDate
    );
    expect(result).toBe(
      "https://rmrpca.smugmug.com/Autocross/2026/2026-04-25-Blooming-Cones-Autocross"
    );
  });

  it("uses date proximity as a tiebreaker", () => {
    // Both "spring" and "slalom" have low keyword overlap with each other;
    // pick the one whose date is closest to eventDate (April 25)
    const result = matchEventFolder(
      folders,
      "Spring Series",
      new Date("2026-03-14T00:00:00Z")
    );
    expect(result).toBe(
      "https://rmrpca.smugmug.com/Autocross/2026/2026-03-14-Spring-Series-Autocross"
    );
  });

  it("matches when photographer omits a word from the event name (reverse direction)", () => {
    // Event: "University Grad School" — SmugMug uses "Grad-School" without "University"
    const gradFolders = [
      {
        urlName: "2026-05-17-Autocross-Grad-School",
        webUri: "https://rmrpca.smugmug.com/Autocross/2026/2026-05-17-Autocross-Grad-School",
        dateAdded: "2026-05-18T12:00:00Z",
      },
    ];
    const result = matchEventFolder(
      gradFolders,
      "University Grad School",
      new Date("2026-05-17T00:00:00Z")
    );
    expect(result).toBe(
      "https://rmrpca.smugmug.com/Autocross/2026/2026-05-17-Autocross-Grad-School"
    );
  });

  it("returns null when no folder meets the score threshold", () => {
    const result = matchEventFolder(folders, "Nonexistent Event", eventDate);
    expect(result).toBeNull();
  });

  it("returns null for empty folder list", () => {
    const result = matchEventFolder([], "Blooming Cones", eventDate);
    expect(result).toBeNull();
  });

  it("returns null for empty event name after stopword removal", () => {
    const result = matchEventFolder(folders, "Autocross AX", eventDate);
    expect(result).toBeNull();
  });

  // M1.15: combined-event sessions are exported with an (A)/(B) suffix
  // ("Cone in 60 Seconds (A)" / "(B)"), but both sessions share one calendar
  // date and one SmugMug gallery. No code change was needed — the token side
  // already tolerates the extra suffix token (reverse-direction overlap
  // covers it), so both session names resolve to the same folder.
  it("matches both (A) and (B) combined-event session names to the same single-day gallery", () => {
    const combinedDate = new Date("2027-05-15T00:00:00Z");
    const combinedFolders = [
      {
        urlName: "2027-05-15-Cone-in-60-Seconds",
        webUri: "https://rmrpca.smugmug.com/Autocross/2027/2027-05-15-Cone-in-60-Seconds",
        dateAdded: "2027-05-16T12:00:00Z",
      },
    ];

    const sessionA = matchEventFolder(combinedFolders, "Cone in 60 Seconds (A)", combinedDate);
    const sessionB = matchEventFolder(combinedFolders, "Cone in 60 Seconds (B)", combinedDate);

    expect(sessionA).toBe(
      "https://rmrpca.smugmug.com/Autocross/2027/2027-05-15-Cone-in-60-Seconds",
    );
    expect(sessionB).toBe(sessionA);

    // The combined page's own label (stripped of the session suffix) matches too.
    const combinedLabel = matchEventFolder(combinedFolders, "Cone in 60 Seconds", combinedDate);
    expect(combinedLabel).toBe(sessionA);
  });
});

// PR #99 review: the SMUGMUG_* env fallbacks (and the "rmrpca"/"Autocross"
// hardcoded last resort) are deployment-level legacy config for the DEFAULT
// league only. An explicitly-supplied non-default league with no photo
// columns resolves to null — "no photos", never another league's galleries.
describe("resolveSmugmugTarget", () => {
  const ENV_KEYS = ["SMUGMUG_USER", "SMUGMUG_DISCIPLINE_PATH", "DEFAULT_LEAGUE_SLUG"] as const;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) saved[k] = process.env[k];
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("default league falls back to env, then the legacy hardcoded target", async () => {
    delete process.env.DEFAULT_LEAGUE_SLUG; // → "pca-rmr"
    process.env.SMUGMUG_USER = "envuser";
    delete process.env.SMUGMUG_DISCIPLINE_PATH;
    const target = await resolveSmugmugTarget({
      slug: "pca-rmr",
      smugmugUser: null,
      smugmugDisciplinePath: null,
    });
    expect(target).toEqual({ user: "envuser", discipline: "Autocross" });

    delete process.env.SMUGMUG_USER;
    const hardcoded = await resolveSmugmugTarget({
      slug: "pca-rmr",
      smugmugUser: null,
      smugmugDisciplinePath: null,
    });
    expect(hardcoded).toEqual({ user: "rmrpca", discipline: "Autocross" });
  });

  it("a non-default league with no photo config resolves to null even when env is set", async () => {
    delete process.env.DEFAULT_LEAGUE_SLUG;
    process.env.SMUGMUG_USER = "envuser";
    process.env.SMUGMUG_DISCIPLINE_PATH = "Autocross";
    const target = await resolveSmugmugTarget({
      slug: "rmsolo",
      smugmugUser: null,
      smugmugDisciplinePath: null,
    });
    expect(target).toBeNull();
  });

  it("a non-default league with its own config uses exactly that config", async () => {
    delete process.env.DEFAULT_LEAGUE_SLUG;
    process.env.SMUGMUG_USER = "envuser";
    const target = await resolveSmugmugTarget({
      slug: "rmsolo",
      smugmugUser: "rmsolophotos",
      smugmugDisciplinePath: "Solo",
    });
    expect(target).toEqual({ user: "rmsolophotos", discipline: "Solo" });
  });
});
