/** @type {import('tailwindcss').Config} */
module.exports = {
    content: {
        relative: true,
        files: ["./*.html", "./assets/js/*.js"],
    },
    theme: {
        extend: {
            colors: {
                primary: "#276749",
                forest: "#174936",
                cream: "#fbfaf5",
                mint: "#e7f3ec",
                citrus: "#e2f56f",
                clay: "#d96f45",
            },
            fontFamily: {
                display: ["Fraunces", "serif"],
                sans: ["Manrope", "sans-serif"],
            },
            opacity: {
                8: "0.08",
                12: "0.12",
                72: "0.72",
            },
        },
    },
    plugins: [],
};
