import { defineRailway, github, project, service } from "railway/iac";
// This repository manages only its own resources in the environment. Other
// repositories export their own partial name.
// See https://docs.railway.com/infrastructure-as-code#multi-repo-projects
export const partial = "our-shared-story";
export default defineRailway(() => {
  const ourSharedStory = service("our-shared-story", {
    source: github("sealubong2006/our-shared-story", { branch: "main", checkSuites: false }),
    // Installs build tools even though NODE_ENV=production, then builds the website and the API.
    // Watch the whole repository: a change anywhere (website, API or shared code) redeploys.
    // Set explicitly, because leaving it out keeps whatever Railway had before.
    build: {
      buildCommand: "npm install --include=dev --no-audit --no-fund && npm run build",
      buildEnvironment: "V3",
      builder: "RAILPACK",
      watchPatterns: ["/**"],
    },
    // The server applies database changes itself before it starts listening.
    start: "npm start",
    healthcheck: "/api/health",
    healthcheckTimeout: 60,
    replicas: { "sfo": 1 },
    networking: { privateNetworkEndpoint: "family-albumapi" },
  });

  return project("thriving-flexibility", {
    // Variables (database URL, R2 keys, salt) stay private in Railway's dashboard and are
    // never read or written by this file.
    variables: { managed: false },
    resources: [ourSharedStory],
  });
});
