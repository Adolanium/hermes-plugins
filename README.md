# Hermes plugins

A public catalog of Adolanium's Hermes plugins.

[Browse the catalog](https://adolanium.github.io/hermes-plugins/)

The generated `index.html` contains all styling, search and filtering. The page uses a dark theme by default. It works as a standalone file, including without JavaScript. Preview images are optimized local WebP files sourced from public GitHub assets. Keep the `assets/` directory beside the HTML when copying the page.

## Refresh

Run `node scripts/build.mjs` with Node.js 22 or newer. An optional `GITHUB_TOKEN` environment variable increases the GitHub API rate limit. No dependencies are required.

The generator reads only the public user-repositories endpoint, excludes archived repositories and entries listed in `catalog.config.json`, and discovers repositories whose names begin with `hermes-` except excluded non-plugin repositories. Themes and pets are explicitly excluded. All forks are excluded, without exceptions.

Installation commands are copied from READMEs only when they use `hermes plugins install` and reference the same repository. Other entries link to their full installation instructions. Images are taken from repository READMEs and checked with GET requests. `media.json` records curated preview assets, original sources and selected demo frame timestamps. Static stills avoid blank animation openings; preview links open the original screenshot or demo. The curated assets remain stable during daily metadata refreshes. Nothing here implies admission to the upstream plugin catalog.

Edit `template.html` for layout or behavior. GitHub Actions rebuilds and deploys on pushes, manual runs and daily at 05:23 UTC. The deployed page refreshes directly; the checked-in `index.html` is a portable snapshot and changes only when rebuilt and committed. A failed refresh leaves the last successful deployment online. Scheduled workflows in public repositories may be disabled by GitHub after 60 days without repository activity; re-enable the workflow in Actions if needed.
