# Have a say: voices, needs, thanks and reasons

Design notes for the patrons site. v1 is built; v2 is a design. Written 25 Nov 2026.

## What Jacob asked for

Jacob Cole, 25 Nov 2026, 12:17Z, verbatim:

> we could also offer a capacity by the way in this vision to vote on what software just by being an individual or being a user or benefiting from it then also putting like your commentary in and ultimately using the justify style system from the court of the Internet to have logic about what gets funded because as my advisor said voting is just one step better than an open war
>
> let's see if we can leave that you know also expressing a need the software package expressing in need and the people expressing how much it benefited them on trustworthy human terms on pure human connection terms and writing it out, logically versus just voting as potential options, I don't know how we can fit that into the system, but just the voting is even a good start anyway let's save all these notes and see if we can weave it in

Read as five asks:

1. Anyone can vote on what gets funded: as an individual, as a user, or as someone who benefits.
2. They can add commentary.
3. A project can state a need.
4. People can write out how much a project helped them, on human, trustworthy terms.
5. Funding should follow argued reasons, using the Internet Court's rule, because "voting is just one step better than an open war".

Voting alone is "a good start".

## The principle

Three layers, each harder to fake than the one before. Money in shared pots listens to them in that order of trust.

| Layer | What it is | Cost to give | Cost to fake | Status |
|---|---|---|---|---|
| Voices | A count of people who spoke up, with optional comment | Seconds | Low | **v1, live** |
| Needs and thanks | A project's stated need; a person's signed account of what it did for them | Minutes | Medium: a name is attached | v2 design |
| Reasons | The case for a project as an argument anyone can answer | An hour | High: objections are public and must be met | v2 design |

One rule holds across all three: **a patron's own split is always theirs.** None of these layers moves an individual patron's money. They shape only shared money: the default split for patrons who chose nothing, and any matching pool.

## v1 (built): voices and comments

- Every listed project has a "Have a say" button. No account is needed.
- A voice has a relation: **I use it**, **I benefit from it**, or **I think it matters**. These are Jacob's three: user, beneficiary, individual.
- An optional comment (500 characters) and an optional display name.
- One voice per project per person. Speaking again replaces the earlier voice.
- Counts are public at once. A comment is public only after a person approves it.
- The page shows "Most spoken for" and approved comments, and says plainly that counts weigh little on their own.

### Data

Table `patron_voices` (migration 0006): `id`, `project_id`, `relation`, `voter_hash`, `comment`, `display_name`, `comment_status` (`none`, `pending`, `approved`, `declined`), `created_at`, `updated_at`, unique on (`project_id`, `voter_hash`).

- `voter_hash` is a salted SHA-256 of the network address (for IPv6, of its /64, since one customer holds a whole /64). It is how one person counts once without an account. The address itself is never stored. This hash is kept as long as the voice is.
- `POST /api/patron-voice` `{project, relation, comment?, name?}`: same-origin only, catalog ids only, rate limited (two units of the sixty-unit hourly budget).
- `GET /api/patron-voices`: `{counts: {projectId: {total, use, benefit, believe}}, comments: [{project, relation, text, name, date}]}`. Approved comments only. No hashes, ids or pending text.
- `GET /admin/patron-voices.csv` and `POST /admin/patron-voices/moderate` `{id, updated_at, status}` with the owner bearer token. The decision is bound to the revision read; a changed comment or name returns to pending.

### Known limits of v1

- **One network is not one person.** A household or office shares a voice per project, and people sharing an address can replace each other's voice or send each other's comment back to pending; a person on two networks has two. Good enough for a show of hands, not for anything that moves money by itself.
- **Counts can be farmed** by rotating addresses. This is why the split formula below takes a logarithm and a small weight.
- **Moderation is manual.** Someone must read pending comments. Until they do, comments do not appear.

## v2 (design): needs and thanks

### A project states a need

A maintainer, after proving control of the project (a DNS record, a file in the repository, or a signed build; the same proof payouts will need), publishes one need at a time:

| Field | Example |
|---|---|
| What | "A part-time maintainer for the sync engine" |
| Why | "Two of us answer every issue at night. Releases have slipped to quarterly." |
| How much | "$1,500 a month" or "nothing right now; we are funded enough" |
| Until | A date, or "ongoing" |
| Instead | Optional: "pay our upstream, X, instead" |

- The need is shown on the project's row and in the ledger, with how much of it is met.
- "Funded enough" and "pay X instead" are first-class answers. A project that declines money is doing the commons a favour and the ledger says so.
- A stated need cannot raise a project above what stating none would give. It can only taper as the need fills. This stops a large ask from being a way to take more.

This is the same record as the creator's ask in the usage-meter design (factor **A**): the meter owns the number, this page owns the words.

### A person says thanks

A "thanks" is a short, signed account. It is not a rating.

| Prompt | Why it is there |
|---|---|
| What did it let you do? | Concrete, checkable |
| How often do you rely on it? | Context for the claim |
| What would you do without it? | The honest measure of benefit |
| Sign it | A name, and optionally an Ideaflow ID or a link that shows it is you |

- Shown under the project, newest first, with the name. Anonymous thanks are allowed but shown separately and never counted.
- A thanks can be **vouched for** by someone who knows the writer ("I work with Maya; this is true"). Vouching is the "trustworthy human terms" part: trust travels through people who know each other, not through a score.
- A thanks carries no weight of its own in any formula. It is evidence. It becomes a point in the project's case (below), where it can be answered.

## v2 (design): reasons, using the Internet Court's rule

The Court (court.globalbr.ai, repository `tmad4000/internet-court`) lays an argument out as an outline and applies one inspectable rule:

- Every row is one point that supports or opposes its parent.
- A point is **standing** unless it has a standing objection beneath it. If that objection is itself refuted, the point stands again.
- A branch's score is `100 × (standing pro weight − standing con weight) ÷ total standing weight`. +20 and above leans supported; −20 and below leans opposed; between is contested. A point with no standing replies is untested.

### One case per project

Each project that wants one gets a Court map with a fixed central claim:

> **"[Project] should receive more than its measured usage alone would give it."**

- Supporting points come from needs ("the maintainers cover hosting themselves"), thanks ("it replaced a $40-a-month tool for our clinic"), and facts with links (downloads, dependents, security record).
- Opposing points are welcome and are the point of the exercise: "it has a commercial licence that already pays the team", "the fork it depends on does the real work", "usage is one company's CI".
- A thanks or a need is imported as a point with its author and a link back. Its author is told when someone objects, and can answer.
- The map lives in the Court. The patrons page shows its score, its state (supported, contested, opposed, untested) and the three points carrying the most weight, and links to the full map.

### Why this is better than a vote

A vote says how many. It cannot say why, and it cannot be answered. An objection in a vote is just another vote. In the Court an objection has to be met or the point falls, and everyone can see which it was. That is the step past "one step better than an open war".

## How the layers feed the split

The usage-meter design (agent 4debe316, `patronage-usage-meter-fable-20261125/REPORT.md`) gives each patron's own money a weight per project:

```
weight = U × V × A      U usage · V the patron's own rating · A the creator's ask
```

That stays as it is. The layers here add two factors, and only where money is shared:

```
shared weight = U × A × C × J

C = 1 + log2(1 + distinct voices) ÷ 4        15 voices → ×2 · 255 voices → ×3
J = 2^(court score ÷ 100), kept within ½ to 2  untested map → 1
```

| Where | Uses |
|---|---|
| A patron's own $10 | U, V, A. Never C or J |
| Default for patrons who chose nothing | The average of patrons who did choose, adjusted by C and J |
| A matching pool | Quadratic matching on patron dollars, adjusted by J |

- **C is deliberately weak.** Voices are cheap. A thousand of them is less than a fourfold change.
- **J is bounded.** The best-argued case doubles a project's shared weight; the worst halves it. An untested case does nothing, so nobody is rewarded for a map no one has challenged.
- **A is the need.** It only ever tapers.
- **Thanks have no factor.** They work through J, as points that stand or fall.

This was proposed to the usage-meter design on 25 Nov 2026 and is not yet agreed. Jacob has not seen it.

## What the page shows next to the usage meter

For each project, one line of four small readings, each labelled with where it comes from:

| Reading | Source | Example |
|---|---|---|
| Use | The patron's own meter, or aggregate counts | "Used on 22 days" |
| Voices | `patron_voices` | "41 voices: 30 use it, 9 benefit, 2 think it matters" |
| Need | The project's stated need | "Needs $1,500/mo, 40% met" |
| Case | The Court map | "Supported, +46, 12 points standing" |

and below them the suggested amount, with "why this amount" opening the arithmetic. A patron can always overrule it.

## Build order

| Slice | What | Depends on |
|---|---|---|
| **1 (done)** | Voices, comments, moderation, public counts | Nothing |
| 2 | Needs: proof of control, the need record, display | The payout proof-of-control decision |
| 3 | Thanks: signed statements, vouching | Ideaflow ID sign-in being switched on |
| 4 | Court link: import points, show score and state | A Court API for creating and reading a map; agreement with the Court's owner |
| 5 | C and J in the shared split | Real money existing; the usage-meter formula being agreed |

## Open questions for Jacob

1. Should comments wait for a person to read them (as built), or appear at once and be removed if reported?
2. Who reads them?
3. Is "should receive more than its measured usage alone would give it" the right central claim for a project's case?
4. Are the bounds right: voices at most a few-fold, the argued case between half and double?
5. May thanks be anonymous at all?
