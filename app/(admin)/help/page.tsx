import type { Metadata } from "next";
import { Nav } from "@/components/Nav";
import { Guide } from "@/components/help/Guide";

export const metadata: Metadata = { title: "Help · AI DJ Mixer" };

export default function HelpPage() {
  return (
    <>
      <Nav active="/help" />
      <Guide />
    </>
  );
}
