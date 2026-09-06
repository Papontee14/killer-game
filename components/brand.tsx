// Hand-set 5 x 7 lettering on a shared pixel grid.
const glyphs = [
  ["11001", "11011", "11110", "11100", "11110", "11011", "11001"],
  ["11111", "01110", "01110", "01110", "01110", "01110", "11111"],
  ["11000", "11000", "11000", "11000", "11000", "11000", "11111"],
  ["11000", "11000", "11000", "11000", "11000", "11000", "11111"],
  ["11111", "11000", "11000", "11110", "11000", "11000", "11111"],
  ["11110", "11011", "11011", "11110", "11100", "11010", "11011"],
];
const lettering = glyphs.flatMap((rows, letter) =>
  rows.flatMap((row, y) => [...row].flatMap((pixel, x) =>
    pixel === "1" ? [`M${6 + letter * 24 + x * 4} ${4 + y * 4}h4v4h-4Z`] : [],
  )),
).join("");

export function Brand({ small = false }: { small?: boolean }) {
  return (
    <span className={`killer-logo ${small ? "small" : ""}`} role="img" aria-label="KILLER">
      <svg viewBox="0 0 156 56" aria-hidden="true" focusable="false" shapeRendering="crispEdges">
        {/* Dark red extrusion and ivory arcade lettering. */}
        <path d={lettering} fill="#772c38" transform="translate(2 3)" />
        <path d={lettering} fill="currentColor" />
        <path fill="#ff3347" d="M10 28h4v8h-4zM14 28h4v4h-4zM58 28h4v6h-4zM106 28h4v8h-4zM110 28h8v4h-8zM138 28h4v6h-4z" />
        {/* Stepped steel blade, guard, and riveted grip. */}
        <path fill="#35554e" d="M8 40h102v10H28v-2H20v-2H12v-2H8z" />
        <path fill="#c3d7cf" d="M6 38h104v10H26v-2H18v-2H10v-2H6z" />
        <path fill="#f3f4e9" d="M6 38h104v3H10v-1H6z" />
        <path fill="#819e94" d="M26 45h84v3H26z" />
        <path fill="#a81732" d="M10 41h20v3h12v4H26v-2H18v-2H10zM30 48h4v6h-4z" />
        <path fill="#ff3347" d="M10 41h16v3h-8v-1h-8zM30 48h2v4h-2zM42 51h3v3h-3z" />
        <path fill="#819e94" d="M110 35h4v16h-4z" />
        <path fill="#f3f4e9" d="M110 35h2v13h-2z" />
        <path fill="#263e38" d="M114 38h32v2h4v6h-4v2h-32z" />
        <path fill="#557368" d="M116 38h28v2h-28z" />
        <path fill="#0a201a" d="M122 40h2v8h-2zM134 40h2v8h-2z" />
        <path fill="#c3d7cf" d="M118 42h2v2h-2zM140 42h2v2h-2z" />
        <path fill="#ff3347" d="M0 29h3v3H0zM150 24h4v4h-4zM152 32h2v2h-2z" />
      </svg>
    </span>
  );
}
