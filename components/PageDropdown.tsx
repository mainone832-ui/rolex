"use client";
import { useRouter, usePathname } from "next/navigation";

const links = [
  { label: "All", href: "/all" },
  { label: "Messages", href: "/messages" },
  { label: "Forms", href: "/forms" },
  { label: "Devices", href: "/devices" },
];

export default function PageDropdown() {
  const router = useRouter();
  const pathname = usePathname();

  return (
    <select
      className="h-10 rounded-lg border border-(--border) bg-white/90 px-3 text-sm focus:border-(--accent) focus:outline-none focus:ring-2 focus:ring-(--accent)"
      onChange={e => router.push(e.target.value)}
      value={links.find(l => l.href === pathname) ? pathname : links[0].href}
      style={{ minWidth: 120 }}
    >
      {links.map(link => (
        <option key={link.href} value={link.href}>
          {link.label}
        </option>
      ))}
    </select>
  );
}
