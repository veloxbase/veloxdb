import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";

import type { VeloxyStreamChunk } from "@/data/types";

type UseVeloxyStreamOptions = {
	onChunk: (chunk: VeloxyStreamChunk) => void;
};

export function useVeloxyStream({ onChunk }: UseVeloxyStreamOptions) {
	useEffect(() => {
		let unlisten: (() => void) | undefined;
		void listen<VeloxyStreamChunk>("veloxy-stream-chunk", (event) => {
			onChunk(event.payload);
		}).then((fn) => {
			unlisten = fn;
		});
		return () => {
			unlisten?.();
		};
	}, [onChunk]);
}
