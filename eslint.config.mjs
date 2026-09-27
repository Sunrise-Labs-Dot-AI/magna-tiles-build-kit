import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const ignoredPaths = [
  ".next/**",
  "node_modules/**",
  "vendor/rapier-contact/**",
  "verification/**/*.png",
  "verification/contact-sheet.md"
];

export default [
  ...nextVitals,
  ...nextTypescript,
  {
    ignores: ignoredPaths
  }
];
