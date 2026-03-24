/** @type {import('tailwindcss').Config} */
export default {
	content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
	darkMode: "class",
	theme: {
		extend: {
			colors: {
				stork: {
					// Rose→purple palette matching the T9 logo gradient (#BE185D → #6B21A8)
					50: "#fff1f2", // subtle rose tint (selected item bg light mode)
					100: "#ffe4e6", // light rose (selected item bg, badge bg)
					200: "#fecdd3", // light rose (borders, dividers)
					300: "#fda4af", // medium rose (dark mode text accents)
					400: "#fb7185", // bright coral-rose (dark mode lighter accents)
					500: "#f43f5e", // vivid rose (focus rings, progress bars)
					600: "#be185d", // LOGO ROSE — primary buttons, active text, badges
					700: "#9d174d", // darker rose — button hover states
					800: "#6b21a8", // LOGO PURPLE — deep accent, dark mode active bg
					900: "#581c87", // deep purple — dark text, dark mode containers
					950: "#3b0764", // darkest purple — dark mode selected item bg
				},
			},
		},
	},
	plugins: [],
};
