import type { AirportProfileArtifact } from '@airport/shared';
import { formatPassengers, formatPercent, formatPeriod } from '../../lib/format';
import { ArtifactCard, assumptionFacts, AirportName, Facts, Sources, type Fact } from './parts';

export function ProfileView({ artifact }: { artifact: AirportProfileArtifact }) {
  const facts: Fact[] = [
    { kind: 'Data period', text: `${formatPeriod(artifact.period)}, compared with ${formatPeriod(artifact.previousPeriod)}.` },
    ...artifact.missing.map<Fact>((m) => ({ kind: 'Limitation', text: `${m.input}: ${m.reason}` })),
    ...assumptionFacts(artifact.assumptions),
  ];
  const items: [string, string][] = [
    ['Passengers', formatPassengers(artifact.passengers)],
    ['Seats', formatPassengers(artifact.seats)],
    ['Departures', formatPassengers(artifact.departures)],
    ['Load factor', formatPercent(artifact.loadFactorPercent)],
    ['Passenger growth', formatPercent(artifact.passengerGrowthPercent)],
    ['Seat growth', formatPercent(artifact.seatGrowthPercent)],
    ['Departure growth', formatPercent(artifact.departureGrowthPercent)],
  ];
  return (
    <ArtifactCard title={`Airport profile – ${artifact.airport.code}`} subtitle={formatPeriod(artifact.period)}>
      <p className="lead">
        <AirportName airport={artifact.airport} />
      </p>
      <dl className="kv grid">
        {items.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd className={value === 'Unavailable' ? 'muted' : undefined}>{value}</dd>
          </div>
        ))}
      </dl>
      <Facts facts={facts} />
      <Sources sources={artifact.sources} />
    </ArtifactCard>
  );
}
