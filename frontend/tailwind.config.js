/** @type {import('tailwindcss').Config} */
export default {
	content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
	darkMode: "class",
	theme: {
		extend: {
			colors: {
				stork: {
					// Violet→purple palette — ties to logo's purple endpoint (#6B21A8)
					// without the rose/pink that made the UI feel too "girly"
					50: "#f5f3ff", // subtle violet tint (selected item bg light mode)
					100: "#ede9fe", // light violet (selected item bg, badge bg)
					200: "#ddd6fe", // light violet (borders, dividers)
					300: "#c4b5fd", // medium violet (dark mode text accents)
					400: "#a78bfa", // violet (dark mode lighter accents)
					500: "#8b5cf6", // vivid violet (focus rings, progress bars)
					600: "#7c3aed", // primary buttons, active text, badges
					700: "#6d28d9", // button hover states
					800: "#5b21b6", // deep accent, dark mode active bg
					900: "#4c1d95", // dark text, dark mode containers
					950: "#2e1065", // darkest — dark mode selected item bg
				},
			},
		},
	},
	plugins: [],
};
