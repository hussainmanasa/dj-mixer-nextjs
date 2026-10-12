import type { Metadata } from "next";
import { Nav } from "@/components/Nav";
import { LibraryManager } from "@/components/library/LibraryManager";

export const metadata: Metadata = { title: "Library · AI DJ Mixer" };

export default function LibraryPage() {
  return (
    <>
      <Nav active="/library" />
      <LibraryManager />
    </>
  );
}
