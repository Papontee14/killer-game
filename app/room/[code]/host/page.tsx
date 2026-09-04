import { HostRoom } from "@/components/room-shell";
export default function HostPage({ params }: { params: { code: string } }) { return <HostRoom code={params.code.toUpperCase()} />; }
