import {
  AirportFacility,
  EventBus,
  FacilityLoader,
  FacilityRepository,
  FacilitySearchType,
  FacilityType,
  RunwaySurfaceType,
  RunwayUtils,
} from '@microsoft/msfs-sdk';
import type { RunwayEnd } from '../core/types.ts';

/**
 * Looks up runway ends near a position with the MSFS Avionics Framework facility loader,
 * which reads the sim's own navdata (including add-on scenery runways the sim has loaded).
 *
 * OneWayRunway.course is the true course. Its latitude/longitude is the landing threshold of that
 * end, already moved in by any displaced threshold (startThresholdLength), while its length is the
 * whole pavement. Touchdown distance is therefore measured from the landing threshold.
 */
/** Surfaces that carry painted markings. */
const PAVED = [
  RunwaySurfaceType.Concrete,
  RunwaySurfaceType.Asphalt,
  RunwaySurfaceType.Bituminous,
  RunwaySurfaceType.Tarmac,
  RunwaySurfaceType.Macadam,
  RunwaySurfaceType.Brick,
  RunwaySurfaceType.OilTreated,
  RunwaySurfaceType.Paint,
];

export class RunwayProvider {
  private readonly loader: FacilityLoader;

  constructor(bus: EventBus) {
    this.loader = new FacilityLoader(FacilityRepository.getRepository(bus));
  }

  async findRunways(lat: number, lon: number): Promise<RunwayEnd[]> {
    const session = await this.loader.startNearestSearchSession(FacilitySearchType.Airport);
    const result = await session.searchNearest(lat, lon, 8000 /* metres */, 4);
    const out: RunwayEnd[] = [];
    for (const icao of result.added) {
      const airport: AirportFacility = await this.loader.getFacility(FacilityType.Airport, icao);
      for (const rw of RunwayUtils.getOneWayRunwaysFromAirport(airport)) {
        // Markings are painted for the runway as a whole: an ILS at either end counts.
        const parent = airport.runways[rw.parentRunwayIndex];
        const ils = !!rw.ilsFrequency || (!!parent && ((parent.primaryILSFrequency?.freqMHz ?? 0) > 0 || (parent.secondaryILSFrequency?.freqMHz ?? 0) > 0));
        out.push({
          airportIdent: airport.icaoStruct?.ident ?? String(icao).slice(7).trim(),
          designation: rw.designation,
          thresholdLat: rw.latitude,
          thresholdLon: rw.longitude,
          headingTrue: rw.course,
          lengthM: rw.length - (rw.startThresholdLength || 0),
          widthM: rw.width,
          displacedM: rw.startThresholdLength || 0,
          hard: PAVED.indexOf(rw.surface) >= 0,
          ils,
        });
      }
    }
    return out;
  }
}
