import { HostRoom } from "@/components/room-shell";
export default function HostPage({ params, searchParams }: { params: { code: string }; searchParams: { name?: string; pin?: string } }) { return <HostRoom code={params.code.toUpperCase()} name={searchParams.name || "Host"} pin={searchParams.pin || "1234"} />; }
