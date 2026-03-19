/** @type {import('tailwindcss').Config} */
export default {
	content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
	darkMode: "class",
	theme: {
		extend: {
			colors: {
				stork: {
					50: "#f0f5ff",
					100: "#e0eaff",
					200: "#c7d7fe",
					300: "#a4bcfd",
					400: "#8098f9",
					500: "#6172f3",
					600: "#444ce7",
					700: "#3538cd",
					800: "#2d31a6",
					900: "#2b2f83",
					950: "#1a1d50",
				},
			},
		},
	},
	plugins: [],
};
