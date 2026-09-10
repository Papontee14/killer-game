import { PlayerRoom } from "@/components/room-shell";
export default async function RoomPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <PlayerRoom code={code.toUpperCase()} />;
}
