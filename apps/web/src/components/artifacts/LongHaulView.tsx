import type { LongHaulArtifact } from '@airport/shared';
import { formatNumber, formatPercent, UNAVAILABLE } from '../../lib/format';
import { ArtifactCard, assumptionFacts, AirportName, Bar, Facts, NoticePanel, Sources, type Fact } from './parts';

export function LongHaulView({ artifact }: { artifact: LongHaulArtifact }) {
  const facts: Fact[] = [
    { kind: 'Data period', text: artifact.observation },
    ...assumptionFacts(artifact.assumptions),
    ...artifact.missing.map<Fact>((m) => ({ kind: 'Limitation', text: `${m.input}: ${m.reason}` })),
  ];
  if (artifact.unclassifiedRouteCount > 0) {
    facts.push({ kind: 'Limitation', text: `${artifact.unclassifiedRouteCount} route${artifact.unclassifiedRouteCount === 1 ? '' : 's'} could not be placed by distance.` });
  }
  return (
    <ArtifactCard title="Long-haul share of scheduled departures">
      <p className="lead">
        <AirportName airport={artifact.airport} />
      </p>
      <div className="stats">
        <div className="stat">
          <span className="stat-value">{formatPercent(artifact.sharePercent)}</span>
          <span className="stat-label">long-haul share (routes of {formatNumber(artifact.thresholdMiles)} miles or more)</span>
          {artifact.sharePercentRange ? (
            <span className="sub">
              range {formatPercent(artifact.sharePercentRange.min)} to {formatPercent(artifact.sharePercentRange.max)}
            </span>
          ) : null}
        </div>
        <div className="stat">
          <span className="stat-value">{formatNumber(artifact.longHaulAverageDailyFlights)}</span>
          <span className="stat-label">long-haul average daily flights</span>
        </div>
        <div className="stat">
          <span className="stat-value">{formatNumber(artifact.totalAverageDailyFlights)}</span>
          <span className="stat-label">total average daily flights</span>
        </div>
        <div className="stat">
          <span className="stat-value">{formatNumber(artifact.routeCount)}</span>
          <span className="stat-label">routes</span>
        </div>
      </div>
      <p className="muted">Threshold: {formatNumber(artifact.thresholdMiles)} statute miles ({artifact.thresholdSource === 'user' ? 'chosen by you' : 'default'}).</p>
      <NoticePanel title="What this share measures" tone="strong">
        {artifact.mandatoryNotice}
      </NoticePanel>
      <div className="table-scroll">
        <table className="data compact">
          <caption>Distance bands (share of average daily scheduled flights)</caption>
          <thead>
            <tr>
              <th scope="col">Distance band</th>
              <th scope="col" className="num">
                Avg daily flights
              </th>
              <th scope="col" className="num">
                Share
              </th>
              <th scope="col">
                <span className="sr-only">Share bar</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {artifact.distanceBands.map((b) => (
              <tr key={b.label}>
                <th scope="row">{b.label}</th>
                <td className="num">{formatNumber(b.averageDailyFlights)}</td>
                <td className="num">{b.sharePercent == null ? UNAVAILABLE : formatPercent(b.sharePercent)}</td>
                <td>
                  <Bar percent={b.sharePercent} label={`${b.label}: ${formatPercent(b.sharePercent)}`} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {artifact.topLongHaulRoutes.length > 0 ? (
        <details className="sources">
          <summary>Top long-haul routes</summary>
          <ul>
            {artifact.topLongHaulRoutes.map((r) => (
              <li key={r.destination}>
                {r.destination} &middot; {formatNumber(r.distanceMiles)} mi &middot; {formatNumber(r.averageDailyFlights)} avg daily flights
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <Facts facts={facts} />
      <Sources sources={artifact.sources} />
    </ArtifactCard>
  );
}
