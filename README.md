# Airport Investment Intelligence Agent

## What it does

A chat application that answers airport investment questions using public aviation APIs. Ask a question; get a written
explanation plus structured tables and notices computed by code. It handles, for example:

- **New England terminal-expansion ranking** — "Which airports in New England are strong candidates for terminal expansion?"
- **LAX/SNA congestion comparison** — "Compare LAX and SNA congestion."
- **ANC long-haul share** — "What percentage of flights out of Anchorage are long haul?"
- **SFO unmet-demand pressure** — "What is the unmet demand pressure at SFO?"

Follow-ups work conversationally ("Why is the first airport ranked above BOS?").

## Architecture

```
User → Chat UI → Express API → Agent / Ollama → deterministic tools → application analytics & scoring → public aviation APIs
```

Data sources (all queried at request time):

- U.S. DOT/BTS Socrata API: passengers, seats, departures, load factor
- FAA ArcGIS Aviation Facilities API: airport reference data and coordinates
- AeroDataBox API (RapidAPI): route frequency and delay statistics

**No bulk aviation datasets need to be downloaded.** Design, scoring and tradeoffs: [docs/architecture.md](docs/architecture.md).

## AI vs deterministic logic

**The LLM does not calculate or modify scores or rankings. It selects tools and explains deterministic results.**

| The LLM | Application code |
|---|---|
| understands intent | retrieves facts from the APIs |
| selects tools | calculates metrics |
| handles conversational follow-ups | computes scores and ranks airports |
| explains results | produces the authoritative artifacts the UI renders |

Structured artifacts are authoritative; model prose is explanatory. The UI renders tables, scores, periods, assumptions and notices from the artifacts, not from the model's text.

## Setup

You need Node.js 22+ and npm 10+ (or Docker with Compose v2), plus two API keys and a model name:
`OLLAMA_API_KEY` ([Ollama Cloud](https://ollama.com)), `AERODATABOX_API_KEY` (RapidAPI) and `LLM_MODEL`
(`.env.example` already sets `gpt-oss:120b`). BTS and FAA need no credentials.

Native:

```bash
npm ci
cp .env.example .env     # fill in OLLAMA_API_KEY and AERODATABOX_API_KEY (LLM_MODEL is pre-set)
npm run dev
```

Docker:

```bash
cp .env.example .env     # fill in the same values
docker compose up --build
```

- Web: <http://localhost:3000>
- API health: <http://localhost:3001/health>

Tested with `gpt-oss:120b` on Ollama Cloud. Other models may work, but must support reliable tool calling.

| Variable | Purpose | Default |
|---|---|---|
| `OLLAMA_API_KEY` | **Required for chat.** Ollama Cloud key (server-side only) | — |
| `LLM_MODEL` | **Required for chat.** Model name; must support tool calling | `gpt-oss:120b` in `.env.example` |
| `AERODATABOX_API_KEY` | **Required for route, long-haul and congestion questions.** RapidAPI key (server-side only) | — |
| `PORT` | API port (optional) | `3001` |
| `LOG_LEVEL` | API log level (optional) | `info` |
| `LLM_TIMEOUT_MS` | per-request model timeout (optional) | `30000` |
| `AGENT_MAX_STEPS` | max model calls per turn (optional) | `6` |

None of the keys is needed to start the API. Without the LLM settings `/health` still works and chat answers 503; without the
AeroDataBox key, route and delay questions report that they are unavailable, while profile, ranking and demand-pressure questions
(BTS and FAA data) still work.

Secrets are never committed (`.env` is git-ignored) or exposed to the browser.

## Voice input (bonus)

Optional and client-side. Speech is recognized by the browser's native Speech Recognition API and fills the composer; you still
press Send. No audio is sent to this application's backend, but the browser or its speech service may process it. Browser support
varies, and the button is disabled where it is unavailable.

## Tests

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

Tests use mocked HTTP and a scripted stand-in for the model; they never call real APIs or spend quota.

## Important limitations

- BTS data lags the calendar by about two months.
- Long-haul share uses scheduled departures across all listed service types (passenger and cargo), not passenger-only or performed flights.
- Congestion uses short observation windows with partial coverage, so results are often inconclusive; it is not a measure of terminal capacity.
- Demand pressure is a proxy for demand/capacity pressure, not an estimate of unserved passengers.
- Scoring weights and thresholds are MVP assumptions. Rankings are relative to the candidate set, not ROI or profitability.
- The free AeroDataBox plan allows only a limited number of long-haul and congestion questions per month.
- Model prose can contain wording errors; the structured artifacts are authoritative.

## Repository layout

| Path | Purpose |
|---|---|
| `apps/web` | Next.js chat UI; proxies `/api/chat` to the API server-side |
| `apps/api` | Express API: agent, tools, analytics, scoring, API clients |
| `packages/shared` | Zod contracts shared by web and API |
| `docs/architecture.md` | short design document: architecture, scoring methodology, AI usage, tradeoffs, assumptions and limitations |
