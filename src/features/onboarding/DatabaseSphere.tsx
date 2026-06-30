import { useEffect, useRef } from "react";

const engines = [
	{ src: "/postgresql.svg", alt: "PostgreSQL" },
	{ src: "/mysql-wordmark-light.svg", alt: "MySQL" },
	{ src: "/sqlite.svg", alt: "SQLite" },
	{ src: "/mongodb-icon-light.svg", alt: "MongoDB" },
	{ src: "/DuckDB_icon-darkmode.svg", alt: "DuckDB" },
	{ src: "/redis.svg", alt: "Redis" },
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
				const baseR = 130 + (i % 3) * 40;
				const baseAngle = (i / count) * Math.PI * 2;
				const a = baseAngle + (angle * Math.PI) / 180;
				const r = baseR + Math.sin(angle * 0.03 + i) * 15;
				const x = Math.cos(a) * r;
				const y = Math.sin(a) * r * 0.6;
				const scale = 0.7 + (Math.sin(angle * 0.04 + i * 1.5) + 1) * 0.15;
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
			{engines.map((item) => (
				<div
					key={item.alt}
					className="absolute left-1/2 top-1/2 flex size-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-2xl border border-border/30 bg-background/80 p-2 shadow-lg backdrop-blur-sm transition-shadow hover:shadow-xl"
				>
					<img
						src={item.src}
						alt={item.alt}
						className="h-full w-full object-contain"
						draggable={false}
					/>
				</div>
			))}
		</div>
	);
}
