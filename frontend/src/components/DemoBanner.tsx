import { useEffect, useState } from "react";
import { api } from "../api";

export function DemoBanner() {
	const [isDemo, setIsDemo] = useState(false);

	useEffect(() => {
		api
			.demo()
			.then(({ demo }) => setIsDemo(demo))
			.catch(() => {});
	}, []);

	if (!isDemo) return null;

	return (
		<div className="bg-amber-500 text-amber-950 text-center text-sm font-medium py-1.5 px-4 flex-shrink-0">
			Read-only demo — data is sample content.{" "}
			<a
				href="https://github.com/paperkite-hq/stork"
				className="underline hover:no-underline font-semibold"
				target="_blank"
				rel="noopener noreferrer"
			>
				Get Stork
			</a>{" "}
			to run your own instance.
		</div>
	);
}
