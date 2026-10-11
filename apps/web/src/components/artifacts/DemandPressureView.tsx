import type { DemandPressureArtifact } from '@airport/shared';
import { formatHours, formatNumber, formatPercent, formatPeriod, formatPoints, formatUtcWindow, formatWithUnit, UNAVAILABLE } from '../../lib/format';
import { ArtifactCard, assumptionFacts, AirportName, Bar, Facts, NoticePanel, Sources, type Fact } from './parts';

const BAND_LABEL = { low: 'Low', moderate: 'Moderate', elevated: 'Elevated', high: 'High' } as const;

export function DemandPressureView({ artifact }: { artifact: DemandPressureArtifact }) {
  const context = artifact.operationalContext;
  const facts: Fact[] = [
    { kind: 'Data period', text: `${formatPeriod(artifact.period)}, compared with ${formatPeriod(artifact.previousPeriod)}.` },
    { kind: 'Confidence', text: `${artifact.confidence}${artifact.missingSignals.length > 0 ? ' (some signals are missing)' : ''}` },
    ...artifact.missingSignals.map<Fact>((m) => ({ kind: 'Limitation', text: `${m.input}: ${m.reason}` })),
    ...assumptionFacts(artifact.assumptions),
  ];
  return (
    <ArtifactCard title="Demand/capacity pressure indicator" subtitle={`${artifact.profile} · proxy, not a passenger count`}>
      <NoticePanel tone="strong">{artifact.notice}</NoticePanel>
      <p className="lead">
        <AirportName airport={artifact.airport} />
      </p>
      <div className="stats">
        <div className="stat">
          <span className="stat-value">{artifact.scorePoints == null ? UNAVAILABLE : formatPoints(artifact.scorePoints)}</span>
          <span className="stat-label">pressure score (0&ndash;100)</span>
          <Bar percent={artifact.scorePoints} label={`Pressure score ${formatPoints(artifact.scorePoints)} of 100`} />
        </div>
        <div className="stat">
          <span className="stat-value">{artifact.band ? BAND_LABEL[artifact.band] : UNAVAILABLE}</span>
          <span className="stat-label">band</span>
        </div>
        <div className="stat">
          <span className="stat-value">{artifact.confidence}</span>
          <span className="stat-label">confidence</span>
        </div>
      </div>
      <div className="table-scroll">
        <table className="data compact">
          <caption>Components of the score</caption>
          <thead>
            <tr>
              <th scope="col">Signal</th>
              <th scope="col" className="num">
                Observed value
              </th>
              <th scope="col" className="num">
                Scale (0 to 100 points)
              </th>
              <th scope="col" className="num">
                Pressure points
              </th>
              <th scope="col" className="num">
                Weight
              </th>
              <th scope="col" className="num">
                Contribution
              </th>
            </tr>
          </thead>
          <tbody>
            {artifact.components.map((c) =>
              c.status === 'missing' ? (
                <tr key={c.id}>
                  <th scope="row">{c.label}</th>
                  <td colSpan={5} className="muted">
                    {UNAVAILABLE}: {c.reason}
                  </td>
                </tr>
              ) : (
                <tr key={c.id}>
                  <th scope="row">{c.label}</th>
                  <td className="num">{formatWithUnit(c.value, c.unit)}</td>
                  <td className="num">
                    {formatNumber(c.zeroAt)} to {formatNumber(c.hundredAt)}
                  </td>
                  <td className="num">{formatPoints(c.pressurePoints)}</td>
                  <td className="num">{formatPercent(c.effectiveWeightPercent)}</td>
                  <td className="num">{formatPoints(c.contributionPoints)}</td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
      <ul className="readings">
        {artifact.interpretation.passengerSeatGrowthGap ? <li>{artifact.interpretation.passengerSeatGrowthGap}</li> : null}
        <li>{artifact.interpretation.loadFactor}</li>
        <li>{artifact.interpretation.pressure}</li>
      </ul>
      {context.status === 'available' ? (
        <section className="context" aria-label="Operational context (not part of the score)">
          <h4>Operational context (not part of the score)</h4>
          <dl className="kv">
            <dt>Observed window</dt>
            <dd>{formatUtcWindow(context.observedWindowUtc)}</dd>
            <dt>Covered hours</dt>
            <dd>{formatHours(context.coveredHours)}</dd>
            <dt>Departure delay index</dt>
            <dd>{formatNumber(context.departureDelayIndex)}</dd>
            <dt>Departure cancellation rate</dt>
            <dd>{formatPercent(context.departureCancellationRatePercent)}</dd>
          </dl>
          <p className="muted">{context.note}</p>
        </section>
      ) : null}
      <Facts facts={facts} />
      <Sources sources={artifact.sources} />
    </ArtifactCard>
  );
}
