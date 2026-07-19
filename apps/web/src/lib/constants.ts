// Penalty added to a run's raw time for each cone struck.
// PCA Autocross convention is 2.000 seconds per cone.
export const CONE_PENALTY_MS = 2000;

// Planned scoring-group (date) count per season year. Years not listed fall
// back to the actual ingested group count. Counts *dates*, not raw Event rows
// (a combined same-date pair is one planned event).
export const PLANNED_SEASON_EVENTS: Record<number, number> = { 2026: 6 };
