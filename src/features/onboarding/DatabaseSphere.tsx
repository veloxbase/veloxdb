import { useEffect, useRef, type ReactNode } from "react";
import { PlusIcon } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

type SphereEngineItem = {
	name: string;
	content: ReactNode;
	isFuture?: boolean;
};

const ENGINES: SphereEngineItem[] = [
	{
		name: "PostgreSQL",
		content: <img src="/postgresql.svg" alt="PostgreSQL" className="h-full w-full object-contain" draggable={false} />,
	},
	{
		name: "MySQL",
		content: (
			<>
				<img src="/mysql-wordmark-dark.svg" alt="MySQL" className="h-full w-full object-contain dark:hidden" draggable={false} />
				<img src="/mysql-wordmark-light.svg" alt="MySQL" className="hidden h-full w-full object-contain dark:block" draggable={false} />
			</>
		),
	},
	{
		name: "SQLite",
		content: <img src="/sqlite.svg" alt="SQLite" className="h-full w-full object-contain" draggable={false} />,
	},
	{
		name: "MongoDB",
		content: <img src="/mongodb-icon-light.svg" alt="MongoDB" className="h-full w-full object-contain" draggable={false} />,
	},
	{
		name: "DuckDB",
		content: <img src="/DuckDB_icon-darkmode.svg" alt="DuckDB" className="h-full w-full object-contain" draggable={false} />,
	},
	{
		name: "Redis",
		content: <img src="/redis.svg" alt="Redis" className="h-full w-full object-contain" draggable={false} />,
	},
	{
		name: "ClickHouse",
		content: (
			<svg viewBox="0 0 24 24" className="h-full w-full" fill="none" aria-label="ClickHouse">
				<rect x="2" y="7" width="2.5" height="10" rx="1" fill="#FFCC00" />
				<rect x="6.5" y="4" width="2.5" height="16" rx="1" fill="#FF9900" />
				<rect x="11" y="2" width="2.5" height="20" rx="1" fill="#FF5500" />
				<rect x="15.5" y="8" width="2.5" height="8" rx="1" fill="#FFCC00" />
				<rect x="20" y="5" width="2.5" height="14" rx="1" fill="#FF0000" />
			</svg>
		),
	},
	{
		name: "libSQL",
		content: (
			<svg viewBox="0 0 24 24" className="h-full w-full p-0.5" fill="none" stroke="#00d492" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label="libSQL">
				<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z" />
				<path d="M6 6h10" />
				<path d="M6 10h10" />
				<path d="M6 14h6" />
			</svg>
		),
	},
	{
		name: "Turso",
		content: (
			<svg viewBox="0 0 24 24" className="h-full w-full" fill="none" aria-label="Turso">
				<circle cx="12" cy="12" r="10" fill="#4ff8d2" fillOpacity="0.2" />
				<path d="M8 8h8v3h-2.5v6h-3v-6H8V8Z" fill="#00e5a3" />
			</svg>
		),
	},
	{
		name: "Microsoft SQL Server",
		content: (
			<svg viewBox="0 0 24 24" className="h-full w-full" fill="none" aria-label="SQL Server">
				<rect x="3" y="3" width="8" height="8" rx="1" fill="#CC292B" />
				<rect x="13" y="3" width="8" height="8" rx="1" fill="#E64A19" />
				<rect x="3" y="13" width="8" height="8" rx="1" fill="#D32F2F" />
				<rect x="13" y="13" width="8" height="8" rx="1" fill="#B71C1C" />
			</svg>
		),
	},
	{
		name: "Azure SQL",
		content: (
			<svg viewBox="0 0 24 24" className="h-full w-full" fill="none" aria-label="Azure SQL">
				<path d="M12 3c-4.4 0-8 1.3-8 3v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6c0-1.7-3.6-3-8-3Z" fill="#0078D4" fillOpacity="0.25" stroke="#0078D4" strokeWidth="1.5" />
				<path d="M4 10c0 1.7 3.6 3 8 3s8-1.3 8-3" stroke="#0078D4" strokeWidth="1.5" />
				<path d="M4 14c0 1.7 3.6 3 8 3s8-1.3 8-3" stroke="#0078D4" strokeWidth="1.5" />
				<path d="M12 9c4.4 0 8-1.3 8-3s-3.6-3-8-3-8 1.3-8 3 3.6 3 8 3Z" fill="#0078D4" />
			</svg>
		),
	},
	{
		name: "ScyllaDB",
		content: (
			<svg viewBox="0 0 24 24" className="h-full w-full" fill="none" aria-label="ScyllaDB">
				<circle cx="12" cy="12" r="10" fill="#00C7B5" fillOpacity="0.2" />
				<path d="M7 17c1-3 3-5 5-5s4 2 5 5" stroke="#00C7B5" strokeWidth="2" strokeLinecap="round" />
				<circle cx="9.5" cy="9.5" r="1.5" fill="#00C7B5" />
				<circle cx="14.5" cy="9.5" r="1.5" fill="#00C7B5" />
			</svg>
		),
	},
	{
		name: "Apache Cassandra",
		content: (
			<svg viewBox="0 0 24 24" className="h-full w-full" fill="none" aria-label="Cassandra">
				<ellipse cx="12" cy="12" rx="9" ry="6" fill="#1F75FE" fillOpacity="0.2" stroke="#1F75FE" strokeWidth="1.5" />
				<circle cx="12" cy="12" r="3" fill="#1F75FE" />
			</svg>
		),
	},
	{
		name: "More engines in future",
		isFuture: true,
		content: (
			<div className="flex flex-col items-center justify-center text-center select-none">
				<PlusIcon className="size-5 text-purple-400" weight="bold" />
				<span className="text-[9px] font-bold text-purple-400/90 leading-none mt-0.5 tracking-wider uppercase">More</span>
			</div>
		),
	},
];

export function DatabaseSphere() {
	const containerRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		let angle = 0;
		let animId: number;

		const tick = () => {
			angle += 0.15;
			const children = container.children;
			const count = children.length;
			for (let i = 0; i < count; i++) {
				const el = children[i] as HTMLElement;
				const baseR = 140 + (i % 3) * 35;
				const baseAngle = (i / count) * Math.PI * 2;
				const a = baseAngle + (angle * Math.PI) / 180;
				const r = baseR + Math.sin(angle * 0.03 + i) * 15;
				const x = Math.cos(a) * r;
				const y = Math.sin(a) * r * 0.55;
				const scale = 0.72 + (Math.sin(angle * 0.04 + i * 1.5) + 1) * 0.15;
				const z = Math.sin(a + angle * 0.02) * 0.3;
				el.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
				el.style.opacity = String(0.5 + z + 0.5);
				el.style.zIndex = String(Math.round(z * 10 + 5));
			}
			animId = requestAnimationFrame(tick);
		};
		tick();
		return () => cancelAnimationFrame(animId);
	}, []);

	return (
		<div ref={containerRef} className="relative mx-auto h-[320px] w-[320px]">
			{ENGINES.map((item) => (
				<div
					key={item.name}
					title={item.name}
					className={cn(
						"absolute left-1/2 top-1/2 flex size-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-2xl border p-2 shadow-lg backdrop-blur-sm transition-all hover:scale-110 hover:shadow-xl",
						item.isFuture
							? "border-dashed border-purple-500/50 bg-purple-500/10 hover:border-purple-400 hover:bg-purple-500/20"
							: "border-border/30 bg-background/80 hover:border-border/60"
					)}
				>
					{item.content}
				</div>
			))}
		</div>
	);
}
