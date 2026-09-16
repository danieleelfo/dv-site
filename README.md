# Daniele Villanova — Personal Site

Personal website of Daniele Villanova — IT consultant and data/BI professional (Power BI, Data Modeling, AI Agentic system), creating knowledge to AI agents, persistent-memory systems, and interactive storytelling.

Live at [danielevillanova.com](https://danielevillanova.com)

## Structure

The site is organized around three areas, reflected in the homepage's interactive diagram:

- **Humans** — storytelling and creative/emergence projects (Night Stories, Story Teller, Bar AI)
- **AI Agents** — multi-agent architectures and persistent-memory experiments (Emergence Experiments, Console Playground)
- **Data** — enterprise data engineering, BI, and professional background (CV, Data Projects)

## Tech stack

- [React](https://react.dev) + [Vite](https://vitejs.dev)
- [react-router-dom](https://reactrouter.com) for routing, with language-prefixed URLs (`/:lang/...`)
- [react-i18next](https://react.i18next.com) for localization — supported languages: `it`, `en`, `es`, `fr`, `ca`, `nl`
- [Oxlint](https://oxc.rs) for linting

## Development

```bash
npm install
npm run dev
```

## Routing notes

- `/` redirects to `/en`
- All main routes are language-prefixed (`/:lang`, `/:lang/projects`, `/:lang/console`)
- `LangWrapper` validates the `:lang` param against supported languages and falls back to `/en` if invalid
- `/testN` and `/:lang/testN` routes are used for staging/previewing homepage variants before promoting one to `Home.jsx`

## Deployment

Deployed via Cloudflare (Pages), with the custom domain `danielevillanova.com`.

## Contact

daniele@danielevillanova.com
