export function redactLastName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) return "?.";
  return trimmed[0]!.toUpperCase() + ".";
}
