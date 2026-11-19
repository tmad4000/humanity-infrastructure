# Humanity Infrastructure

**Knowledge is a birthright. So are the tools to use it.**

[humanityinfrastructure.com](https://humanityinfrastructure.com) is an open directory of tools and knowledge for human flourishing. Featured listings explain the practical need each tool serves and show its license. Anyone can suggest what belongs.

⭐ **If this resonates, star the repo** so more builders find it, then add the tool you wish everyone knew about.

<p>
  <a href="https://github.com/tmad4000/humanity-infrastructure/issues/new?template=suggest-resource.yml"><b>Suggest a resource</b></a> ·
  <a href="CONTRIBUTING.md"><b>Open a pull request</b></a> ·
  <a href="https://worldissuetracker.com/tracker/missing-civ-infrastructure"><b>Claim a quest</b></a> ·
  <a href="mailto:jacob@ideaflow.io?subject=Humanity%20Infrastructure">Email</a>
</p>

## On the shelves

| The need | Featured tool | License |
|---|---|---|
| Knowledge that survives when the internet doesn't | [Lastbook](https://lastbook.org): offline library of manuals, maps and videos, with optional local AI | Open source (MIT) |
| Use the best service for each task, without interface lock-in | [Paxi](https://paxi.fyi): compares every ride service and books the one you choose | Free, closed source (maker is a friend of the maintainer) |
| A shared, public list of what's broken and who's fixing it | [World Issue Tracker](https://worldissuetracker.com) | Built by the maintainer |
| Open document signing infrastructure | [SignuDoc](https://github.com/NYLLON-SOFTWARE/SignuDoc): e-signatures on your own cloud, $0 per seat | Open source (MIT) |

See the full list, the open Build List and the vision on [the site](https://humanityinfrastructure.com).

## How to contribute

- **No coding needed:** [open the suggestion form](https://github.com/tmad4000/humanity-infrastructure/issues/new?template=suggest-resource.yml). Include the name, official link, who it helps, access/license details and any affiliation.
- **Pull requests:** see [CONTRIBUTING.md](CONTRIBUTING.md). The site is plain HTML (`index.html`, `v2.html`, `v3.html`). There is no build step, and agents are welcome; please disclose AI assistance in your PR.
- **Build something missing:** pick an open quest on the [Missing Civilization Infrastructure tracker](https://worldissuetracker.com/tracker/missing-civ-infrastructure), or join the [World Quest Guild](https://quests.world) ([direct doc link](https://docs.google.com/document/d/1OggVeoEN4zAafRAox3yjFYtNwmYFJQHovXLviWI69zY/edit) if that redirect fails).

Inclusion is a curated pick, not a safety certification or an endorsement of every claim.

## Design versions

| URL | File | Description |
|-----|------|-------------|
| `/` | `index.html` | Main: "Knowledge is a birthright", need → tool shelves, live quests |
| `/v2` | `v2.html` | Editorial/red split-panel |
| `/v3` | `v3.html` | Dark blueprint |

## Maintainers: deployment

The site is served by Cloudflare Worker `humanity-infrastructure`. Run `python3 scripts/build.py` to generate `worker.js` from the HTML and private signup routes. `./deploy.sh` deploys through the scoped `wrangler-gcp` wrapper on the authorized host; `./deploy.sh --env preview` targets the separate preview Worker and D1 database. No global API key is used. The `/contribute` page remains a separate Worker.

See [signup operations](SIGNUP-OPERATIONS.md) for storage, secrets, CSV export, verification and rollback. AI-assisted implementation: Codex.

## Related

- [World Issue Tracker](https://worldissuetracker.com): public problem tracking (HI board: [humanity-infrastructure.worldissuetracker.com](https://humanity-infrastructure.worldissuetracker.com))
- [Build on Ideaflow](https://index.ideaflow.app/build) and the [Ideaflow apps index](https://index.ideaflow.app)
- Origin: `index.html` began in the `humanity3-earth` repo; the site previously redirected to humanity3.earth.

## License

Original code is [MIT licensed](LICENSES/MIT.txt). Original written content is
[CC BY 4.0](LICENSES/CC-BY-4.0.txt). Third-party material retains its existing
rights and notices; linked projects are not relicensed. See [scope and attribution](LICENSE).
