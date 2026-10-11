# Design overview

A conversational agent for US airport investment questions. The LLM understands the question and explains the answer;
application code retrieves the data and calculates every metric, score and ranking.

## 1. Architecture

```
Chat UI (Next.js) → API (Express) → Agent loop ⇄ LLM (Ollama Cloud, tool calling)
                                        └→ six tools → analytics / scoring → BTS, FAA, AeroDataBox
```

- **Data (public APIs, queried on demand):** BTS T-100 for monthly passengers, seats and departures; FAA for airport reference data;
  AeroDataBox (free plan) for route frequency and delay snapshots, called only when a question needs it.
- **Tools:** airport resolution, airport profile, long-haul share, congestion comparison, New England expansion ranking, and
  demand-pressure estimate. Each returns one structured **artifact** (table, scores, data period, assumptions, sources).
- **Response:** the assistant's text plus the artifacts. The UI renders the artifacts as the authoritative result; the text is commentary.
- **Layering:** `domain → analytics/scoring → application → agent/http`, with provider clients behind ports (enforced by lint).
  Provider responses are validated with Zod, and missing values stay missing rather than becoming zero.

## 2. Scoring methodology

### Terminal Expansion Opportunity Score (New England ranking)

Candidates are FAA public-use airports in CT, ME, MA, NH, RI and VT with at least 10,000 passengers in the latest 12 months.
BTS data compares the latest 12 months with the 12 before.

| Factor | Weight |
|---|---|
| Passenger scale (latest 12 months) | 30% |
| Passenger growth (year over year) | 25% |
| Demand–capacity gap (passenger growth minus seat growth) | 20% |
| Departure growth | 15% |
| Load factor | 10% |

- **Normalization:** each factor becomes a 0–100 percentile rank among the candidates (ties share the mean rank). Only order matters,
  so outliers and negative growth need no special handling.
- **Score:** the weighted sum of the percentiles. Ties on score are ordered by airport code, so results are reproducible.
- **Missing data:** a missing factor is never treated as zero. Its weight is removed and the rest is renormalized, and confidence drops.
  With fewer than three factors the airport is shown as unscored, with the reason.
- **Meaning:** an opportunity *indicator*, not ROI, profitability or an engineering assessment. Scores are relative to the airports in
  that ranking and should not be compared across runs. AeroDataBox is not used in the ranking.

### Unmet Demand Pressure (proxy)

A 0–100 score from load factor (35%), passenger growth (25%), passenger-versus-seat growth gap (25%) and departure growth (15%), each
scaled linearly between fixed bounds and banded low / moderate / elevated / high. It indicates demand/capacity pressure, **not**
passengers who could not travel. Delay data is shown separately as context and never changes the score.

### Other calculations

- **Long-haul share:** share of an airport's scheduled daily departures to destinations at least 3,000 miles away (AeroDataBox rolling
  7-day average, all service types, so not passenger-only).
- **Congestion comparison:** delay and cancellation statistics for two airports over a short window (default 12 hours). It declares a
  direction only when both airports have complete data and differ by at least a minute; otherwise it says the result is inconclusive.

## 3. Where and how AI is used

| The LLM | Application code |
|---|---|
| understands the question and picks the tool | retrieves the data |
| resolves references in follow-ups ("LA", "the first airport") | calculates every metric, score and ranking |
| asks which airport is meant when a name is ambiguous | builds the artifacts the UI shows |
| explains the results in plain language | |

The agent is a bounded tool-calling loop (step limit and timeouts) over six tools with Zod-validated arguments. The model is
configuration (`LLM_MODEL`); it was tested with `gpt-oss:120b` on Ollama Cloud. The model does not calculate or modify scores or rankings.
It reads deterministic tool results and explains them; structured artifacts are authoritative, and the prompt tells it to quote values exactly. Tool results include precomputed readings (for
example the sign of a growth gap or which airport leads a factor) so the model has less to infer. Model failures become safe error
responses, never raw provider output.

**Follow-ups:** the API is stateless. The client sends the message text of earlier turns (not artifacts), and the model calls the tools
again, so numbers always come from fresh deterministic results.

## 4. Key tradeoffs

- **Public APIs, not bulk datasets or a database.** Matches the assignment and keeps setup to a few keys; the cost is quota limits
  and no passenger-only route data.
- **Deterministic calculations, not LLM-calculated metrics.** Results are reproducible and unit-tested. The cost is that the model's
  wording can still be loose, which is why artifacts are authoritative.
- **Stateless conversation.** History travels with each request (at most 20 messages and 20,000 characters): no sessions or storage
  for a one-day prototype.
- **No RAG or vector store.** The problem is structured analytics, not document retrieval.
- **Percentile scoring.** Robust and easy to explain, but relative to a small candidate set (about 17 airports).

## 5. Assumptions and limitations

- Weights, bounds, the 10,000-passenger threshold and the 3,000-mile long-haul threshold are MVP assumptions, not industry standards.
- BTS data lags the calendar by about two months.
- Congestion uses short-window operational data with partial coverage, so comparisons are often inconclusive. It measures schedule
  disruption, not terminal capacity.
- Demand pressure is a proxy, not measured unserved demand.
- Only New England ranking is implemented, and the free AeroDataBox quota allows few long-haul and congestion questions per month.
