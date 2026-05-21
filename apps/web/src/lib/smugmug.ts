import { unstable_cache } from "next/cache";

const SMUGMUG_USER = process.env.SMUGMUG_USER ?? "rmrpca";
const SMUGMUG_DISCIPLINE = process.env.SMUGMUG_DISCIPLINE_PATH ?? "Autocross";
const API_BASE = "https://api.smugmug.com/api/v2";

// Tokens to ignore when fuzzy-matching event names against SmugMug folder names
const STOPWORDS = new Set([
  "autocross",
  "ax",
  "axn",
  "round",
  "the",
  "a",
  "an",
]);

interface FolderSummary {
  urlName: string;
  webUri: string;
  dateAdded: string;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0 && !STOPWORDS.has(t));
}

export function matchEventFolder(
  folders: FolderSummary[],
  eventName: string,
  eventDate: Date
): string | null {
  const eventTokens = tokenize(eventName);
  if (eventTokens.length === 0) return null;

  let bestScore = 0.6; // minimum combined threshold
  let bestUri: string | null = null;

  for (const folder of folders) {
    // Content tokens: strip pure-digit tokens (date prefix like 2026, 05, 17) from folder name
    const contentTokens = tokenize(folder.urlName).filter(
      (t) => !/^\d+$/.test(t)
    );
    if (contentTokens.length === 0) continue;

    const matchCount = eventTokens.filter((t) =>
      contentTokens.includes(t)
    ).length;
    if (matchCount === 0) continue;

    // Bidirectional: photographers sometimes abbreviate, so take the better direction
    const forward = matchCount / eventTokens.length;
    const reverse = matchCount / contentTokens.length;
    const tScore = Math.max(forward, reverse);

    // Parse date from UrlName prefix (e.g. "2026-04-25-blooming-cones")
    const dateMatch = /^(\d{4}-\d{2}-\d{2})/.exec(folder.urlName);
    const folderDate = dateMatch
      ? new Date(dateMatch[1] + "T00:00:00Z")
      : new Date(folder.dateAdded);
    let dateScore = 0;
    if (!Number.isNaN(folderDate.getTime())) {
      const daysDiff =
        Math.abs(eventDate.getTime() - folderDate.getTime()) /
        (1000 * 60 * 60 * 24);
      dateScore = Math.max(0, 1 - daysDiff / 30);
    }

    const combined = 0.6 * tScore + 0.4 * dateScore;
    if (combined > bestScore) {
      bestScore = combined;
      bestUri = folder.webUri;
    }
  }

  return bestUri;
}

async function fetchYearNodeId(year: number): Promise<string | null> {
  const apiKey = process.env.SMUGMUG_API_KEY;
  if (!apiKey) return null;

  const urlpath = encodeURIComponent(`/${SMUGMUG_DISCIPLINE}/${year}`);
  const url = `${API_BASE}/user/${SMUGMUG_USER}!urlpathlookup?urlpath=${urlpath}&APIKey=${apiKey}`;

  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    return (json?.Response?.Folder?.NodeID as string) ?? null;
  } catch {
    console.warn("[smugmug] year folder lookup failed for", year);
    return null;
  }
}

async function fetchEventFolders(yearNodeId: string): Promise<FolderSummary[]> {
  const apiKey = process.env.SMUGMUG_API_KEY;
  if (!apiKey) return [];

  const url = `${API_BASE}/node/${yearNodeId}!children?Type=Folder&count=200&APIKey=${apiKey}`;

  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];
    const json = await res.json();
    const nodes: Record<string, unknown>[] = Array.isArray(json?.Response?.Node)
      ? json.Response.Node
      : [];
    return nodes.map((n) => ({
      urlName: String(n.UrlName ?? ""),
      webUri: String(n.WebUri ?? ""),
      dateAdded: String(n.DateAdded ?? ""),
    }));
  } catch {
    console.warn("[smugmug] event folder list failed for node", yearNodeId);
    return [];
  }
}

// Cached per year — 1 week TTL (year folders are stable)
const cachedYearNodeId = unstable_cache(
  async (year: number) => fetchYearNodeId(year),
  ["smugmug-year-node", SMUGMUG_USER, SMUGMUG_DISCIPLINE],
  { revalidate: 604800 }
);

// Cached per year node — 1 hour TTL (new event folders get added during season)
const cachedEventFolders = unstable_cache(
  async (yearNodeId: string) => fetchEventFolders(yearNodeId),
  ["smugmug-event-folders", SMUGMUG_USER, SMUGMUG_DISCIPLINE],
  { revalidate: 3600 }
);

let missingKeyWarned = false;

export async function findSmugmugEventFolder(
  eventName: string,
  eventDate: Date
): Promise<string | null> {
  if (!process.env.SMUGMUG_API_KEY) {
    if (!missingKeyWarned) {
      console.warn("[smugmug] SMUGMUG_API_KEY not set — photos link disabled");
      missingKeyWarned = true;
    }
    return null;
  }

  try {
    const nodeId = await cachedYearNodeId(eventDate.getUTCFullYear());
    if (!nodeId) return null;
    const folders = await cachedEventFolders(nodeId);
    return matchEventFolder(folders, eventName, eventDate);
  } catch {
    return null;
  }
}
