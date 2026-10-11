'use client';

import { useState } from 'react';
import type { RankingArtifact } from '@airport/shared';
import { formatPassengers, formatPercentile, formatPeriod, formatPoints, formatWithUnit, UNAVAILABLE } from '../../lib/format';
import { ArtifactCard, assumptionFacts, AirportName, Bar, Facts, NoticePanel, Sources, type Fact } from './parts';

type Ranked = RankingArtifact['ranked'][number];

/** Table columns, in display order. Ids come from the ranking profile. */
const COLUMNS = [
  { id: 'passengerScale', label: 'Passengers (12 mo)' },
  { id: 'passengerGrowth', label: 'Passenger growth' },
  { id: 'demandCapacityGrowthGap', label: 'Demand-capacity growth gap' },
  { id: 'departureGrowth', label: 'Departure growth' },
  { id: 'loadFactor', label: 'Load factor' },
] as const;

const INITIAL_ROWS = 10;
const TOP_EMPHASIS = 3;

function FactorCell({ ranked, id }: { ranked: Ranked; id: string }) {
  const factor = ranked.factors.find((f) => f.id === id);
  if (!factor) return <td className="num muted">{UNAVAILABLE}</td>;
  if (factor.status === 'missing') {
    return (
      <td className="num muted" title={factor.reason}>
        {UNAVAILABLE}
      </td>
    );
  }
  return (
    <td className="num">
      {id === 'passengerScale' ? formatPassengers(factor.value) : formatWithUnit(factor.value, factor.unit)}
      <span className="sub">{formatPercentile(factor.percentileRank)}</span>
    </td>
  );
}

export function RankingView({ artifact }: { artifact: RankingArtifact }) {
  const [expanded, setExpanded] = useState(false);
  const rows = expanded ? artifact.ranked : artifact.ranked.slice(0, INITIAL_ROWS);
  const hidden = artifact.ranked.length - rows.length;
  const facts: Fact[] = [
    { kind: 'Data period', text: `${formatPeriod(artifact.period)}, compared with ${formatPeriod(artifact.previousPeriod)}.` },
    ...assumptionFacts(artifact.assumptions),
  ];
  const excludedText =
    artifact.excluded.total > 0
      ? `${artifact.excluded.total} airport${artifact.excluded.total === 1 ? '' : 's'} excluded: ${Object.entries(artifact.excluded.byReason)
          .map(([reason, count]) => `${count} ${reason}`)
          .join(', ')}.`
      : null;
  if (excludedText) facts.push({ kind: 'Limitation', text: excludedText });
  for (const u of artifact.unscored) facts.push({ kind: 'Limitation', text: `${u.airport.code} was not scored: ${u.reason}` });

  return (
    <ArtifactCard title={`Terminal expansion opportunity – ${artifact.region}`} subtitle={`${artifact.candidateCount} airports scored · ${formatPeriod(artifact.period)}`}>
      <NoticePanel tone="strong">{artifact.scopeNotice}</NoticePanel>
      <div className="table-scroll">
        <table className="data ranking">
          <caption className="sr-only">Airports ordered by terminal expansion opportunity score</caption>
          <thead>
            <tr>
              <th scope="col">Rank</th>
              <th scope="col">Airport</th>
              <th scope="col" className="num">
                Score
              </th>
              {COLUMNS.map((c) => (
                <th key={c.id} scope="col" className="num">
                  {c.label}
                </th>
              ))}
              <th scope="col">Confidence</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.airport.code} data-top={r.rank <= TOP_EMPHASIS}>
                <th scope="row" className="rank">
                  {r.rank}
                </th>
                <td>
                  <AirportName airport={r.airport} />
                </td>
                <td className="num score">
                  <strong>{formatPoints(r.scorePoints)}</strong>
                  <Bar percent={r.scorePoints} label={`Score ${formatPoints(r.scorePoints)} of 100`} />
                </td>
                {COLUMNS.map((c) => (
                  <FactorCell key={c.id} ranked={r} id={c.id} />
                ))}
                <td>
                  {r.confidence}
                  {r.missingFactors.length > 0 ? <span className="sub">missing: {r.missingFactors.join(', ')}</span> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hidden > 0 || expanded ? (
        <button type="button" className="link" onClick={() => setExpanded((v) => !v)}>
          {expanded ? 'Show top 10 only' : `Show remaining ${hidden} airports`}
        </button>
      ) : null}
      <NoticePanel>{artifact.interpretationNotice}</NoticePanel>
      <Facts facts={facts} />
      <details className="sources">
        <summary>Scoring details</summary>
        <p className="muted">
          Profile {artifact.profile}. Percentiles are ranks among the airports in this ranking; the score is the weighted sum of factor percentiles.
        </p>
        <table className="data compact">
          <thead>
            <tr>
              <th scope="col">Factor</th>
              <th scope="col" className="num">
                Weight
              </th>
              <th scope="col">Metric</th>
              <th scope="col">Reading</th>
            </tr>
          </thead>
          <tbody>
            {artifact.weights.map((w) => (
              <tr key={w.id}>
                <th scope="row">{w.label}</th>
                <td className="num">{formatWithUnit(w.weightPercent, 'percent')}</td>
                <td>{w.rawMetric}</td>
                <td>{w.interpretation}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
      <Sources sources={artifact.sources} />
    </ArtifactCard>
  );
}
