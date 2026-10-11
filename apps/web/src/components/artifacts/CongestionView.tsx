import type { CongestionComparisonArtifact } from '@airport/shared';
import { formatHours, formatLocalWindow, formatMinutes, formatNumber, formatPercent, formatUtcWindow, UNAVAILABLE } from '../../lib/format';
import { ArtifactCard, assumptionFacts, AirportName, Facts, NoticePanel, Sources, type Fact } from './parts';

type Side = CongestionComparisonArtifact['airports'][number];
type Direction = NonNullable<Side['departures']>;

const OUTCOME_TITLE: Record<CongestionComparisonArtifact['comparisonOutcome'], string> = {
  'airport-a-higher-delay-pressure': 'Directional difference in delays',
  'airport-b-higher-delay-pressure': 'Directional difference in delays',
  mixed: 'Inconclusive comparison',
  insufficient: 'Inconclusive comparison: insufficient data',
};

/** Rows for one direction. Values come straight from the artifact; no winner is marked in any cell. */
function directionRows(label: string, pick: (side: Side) => Direction | null, sides: Side[]) {
  const cell = (render: (d: Direction) => string) => sides.map((s) => {
    const d = pick(s);
    return d ? render(d) : UNAVAILABLE;
  });
  return [
    { key: `${label}-flights`, label: `${label}: flights`, cells: cell((d) => formatNumber(d.flights)) },
    { key: `${label}-cancel`, label: `${label}: cancellation rate`, cells: cell((d) => formatPercent(d.cancellationRatePercent)) },
    { key: `${label}-median`, label: `${label}: weighted mean of median delay`, cells: cell((d) => formatMinutes(d.weightedMeanOfMedianDelayMinutes)) },
    { key: `${label}-index`, label: `${label}: mean delay index`, cells: cell((d) => formatNumber(d.meanDelayIndex)) },
    { key: `${label}-max`, label: `${label}: max delay index`, cells: cell((d) => formatNumber(d.maxDelayIndex)) },
  ];
}

export function CongestionView({ artifact }: { artifact: CongestionComparisonArtifact }) {
  const sides: Side[] = [...artifact.airports];
  const [a, b] = artifact.airports;
  const rows = [
    { key: 'requested', label: 'Requested window (local time)', cells: sides.map((s) => formatLocalWindow(s.requestedWindowLocal)) },
    { key: 'observed', label: 'Observed data window', cells: sides.map((s) => formatUtcWindow(s.observedWindowUtc)) },
    { key: 'covered', label: 'Covered hours', cells: sides.map((s) => formatHours(s.coveredHours)) },
    ...directionRows('Departures', (s) => s.departures, sides),
    ...directionRows('Arrivals', (s) => s.arrivals, sides),
  ];
  const directional = artifact.winnerSupported;
  const facts: Fact[] = [
    ...artifact.comparabilityNotes.map<Fact>((text) => ({ kind: 'Limitation', text })),
    ...sides.flatMap((s) => s.coverageReading.map<Fact>((text) => ({ kind: 'Limitation', text: `${s.airport.code}: ${text}` }))),
    ...assumptionFacts(artifact.assumptions),
  ];
  return (
    <ArtifactCard title="Schedule disruption comparison" subtitle={`${a.airport.code} and ${b.airport.code} · short observation window`}>
      <div className="outcome" data-directional={directional}>
        <strong>{OUTCOME_TITLE[artifact.comparisonOutcome]}</strong>
        <p>{artifact.outcomeReading}</p>
      </div>
      <p className="coverage">{artifact.coverageSummary}</p>
      <div className="table-scroll">
        <table className="data compare">
          <caption className="sr-only">Delay and cancellation figures for each airport</caption>
          <thead>
            <tr>
              <th scope="col">Measure</th>
              {sides.map((s) => (
                <th key={s.airport.code} scope="col">
                  <AirportName airport={s.airport} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <th scope="row">{r.label}</th>
                {r.cells.map((text, i) => (
                  <td key={i} className={text === UNAVAILABLE ? 'muted' : undefined}>
                    {text}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <NoticePanel tone="strong">{artifact.reading}</NoticePanel>
      <Facts facts={facts} />
      <Sources sources={artifact.sources} />
    </ArtifactCard>
  );
}
