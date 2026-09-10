import { HostRoom } from "@/components/room-shell";
export default async function HostPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <HostRoom code={code.toUpperCase()} />;
}
