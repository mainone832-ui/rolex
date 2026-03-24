"use client";

const TIMESTAMP_KEYS = ["timestamp", "createdAt", "updatedAt"] as const;
const SERIAL_KEY = "__serial__";

function toLabel(key: string, labelMap?: Record<string, string>) {
  if (key === SERIAL_KEY) return "Serial";
  if (labelMap && labelMap[key]) return labelMap[key];

  return key
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (char) => char.toUpperCase());
}

function toValue(key: string, value: unknown, entryNumber: number) {
  if (key === SERIAL_KEY) return entryNumber;
  if (value === null || value === undefined || value === "") return "N/A";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function extractTimestamp(entry: Record<string, unknown>) {
  for (const key of TIMESTAMP_KEYS) {
    if (entry[key] !== undefined && entry[key] !== null && entry[key] !== "") {
      const raw = entry[key];
      const numeric = Number(raw);

      if (!Number.isNaN(numeric)) {
        const millis = numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
        return new Date(millis);
      }

      const parsed = new Date(String(raw));
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }
  }

  return null;
}

function buildFieldKeys(
  entry: Record<string, unknown>,
  preferredOrder?: string[],
  fillMissingPreferred?: boolean,
) {
  const skip = new Set<string>(TIMESTAMP_KEYS);

  const ordered: string[] = [];
  const rest: string[] = [];

  if (preferredOrder) {
    for (const key of preferredOrder) {
      if (
        fillMissingPreferred ||
        (entry[key] !== undefined && entry[key] !== null && entry[key] !== "")
      ) {
        ordered.push(key);
      }
    }
  }

  for (const key of Object.keys(entry)) {
    if (skip.has(key) || preferredOrder?.includes(key)) continue;
    rest.push(key);
  }

  rest.sort((a, b) => a.localeCompare(b));

  return [SERIAL_KEY, ...ordered, ...rest];
}

type SubmissionCardProps = {
  title: string;
  entryNumber: number;
  entry: Record<string, unknown>;
  preferredOrder?: string[];
  labelMap?: Record<string, string>;
  fillMissingPreferred?: boolean;
};

export default function SubmissionCard({
  entryNumber,
  entry,
  preferredOrder,
  labelMap,
  fillMissingPreferred = false,
}: SubmissionCardProps) {
  const timestamp = extractTimestamp(entry);
  const keys = buildFieldKeys(entry, preferredOrder, fillMissingPreferred);

  return (
    <div className="rounded-lg border border-[#d6d6d6] bg-white p-4">
      <div className="space-y-3">
        {keys.map((key) => (
          <div key={key} className="text-sm leading-tight">
            <div className="font-semibold text-[#1f2937]">
              {toLabel(key, labelMap)}:
            </div>
            <div className="text-[#1f2937] break-all">
              {toValue(key, entry[key], entryNumber)}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 text-right text-xs text-[#6b7280]">
        {timestamp ? timestamp.toLocaleString() : "Timestamp unavailable"}
      </div>
    </div>
  );
}
