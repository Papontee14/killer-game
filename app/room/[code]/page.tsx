import { PlayerRoom } from "@/components/room-shell";
export default function RoomPage({ params }: { params: { code: string } }) { return <PlayerRoom code={params.code.toUpperCase()} />; }
