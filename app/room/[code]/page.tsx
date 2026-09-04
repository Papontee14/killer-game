import { PlayerRoom } from "@/components/room-shell";
export default function RoomPage({ params, searchParams }: { params: { code: string }; searchParams: { name?: string; pin?: string } }) { return <PlayerRoom code={params.code.toUpperCase()} name={searchParams.name || "ผู้เล่น"} pin={searchParams.pin || "1234"} />; }
