import { describe, expect, it } from "vitest";
import { matchEventFolder } from "@/lib/smugmug";

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
});
