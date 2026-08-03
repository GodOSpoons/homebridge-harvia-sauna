import { HAP, Logger } from 'homebridge';
import { HarviaEntitlementError } from '../api/errors';

// Wraps a HomeKit onSet handler's write to Harvia: logs exactly one clean
// line (no raw HTTP dumps or stack traces — HAP-NodeJS's default handling
// for a thrown error is verbose) and maps the failure to a HAP status
// HomeKit can act on, instead of a generic characteristic-write failure.
export async function runHarviaCommand(
  log: Logger,
  hap: HAP,
  label: string,
  action: () => Promise<void>
): Promise<void> {
  try {
    await action();
  } catch (error) {
    if (error instanceof HarviaEntitlementError) {
      log.warn(`Harvia: ${label} — ${error.message}`);
      throw new hap.HapStatusError(hap.HAPStatus.INSUFFICIENT_AUTHORIZATION);
    }
    const message = error instanceof Error ? error.message : String(error);
    log.warn(`Harvia: ${label} failed — ${message}`);
    throw new hap.HapStatusError(hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
  }
}
