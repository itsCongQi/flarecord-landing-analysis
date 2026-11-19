import {
  AirportFacility,
  EventBus,
  FacilityLoader,
  FacilityRepository,
  FacilitySearchType,
  FacilityType,
  RunwayUtils,
} from '@microsoft/msfs-sdk';
import type { RunwayEnd } from '../core/types.ts';

/**
 * Looks up runway ends near a position with the MSFS Avionics Framework facility loader,
 * which reads the sim's own navdata (including add-on scenery runways the sim has loaded).
 *
 * VERIFY against the msfs-sdk version bundled with the EFB API: the nearest-search signature
 * and whether OneWayRunway.course is true or magnetic. If it is magnetic, add the airport's
 * magnetic variation before matching.
 */
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
        out.push({
          airportIdent: airport.icaoStruct?.ident ?? String(icao).slice(7).trim(),
          designation: rw.designation,
          // OneWayRunway latitude/longitude is the landing threshold of that end.
          thresholdLat: rw.latitude,
          thresholdLon: rw.longitude,
          headingTrue: rw.course,
          lengthM: rw.length,
          widthM: rw.width,
        });
      }
    }
    return out;
  }
}
