import type { Metadata } from "next";
import { Nav } from "@/components/Nav";
import { History } from "@/components/history/History";

export const metadata: Metadata = { title: "History · AI DJ Mixer" };

export default function HistoryPage() {
  return (
    <>
      <Nav active="/history" />
      <History />
    </>
  );
}
