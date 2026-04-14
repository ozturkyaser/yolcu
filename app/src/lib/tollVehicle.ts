import type { TollVehicleClass } from './api'

/** Profil-Feld hat Vorrang; sonst grobe Ableitung vom Karten-Icon. */
export function resolveTollVehicleClass(
  tollVehicleClass: TollVehicleClass | undefined | null,
  mapIcon: string | undefined | null,
): TollVehicleClass {
  if (tollVehicleClass) return tollVehicleClass
  if (mapIcon === 'two_wheeler') return 'motorcycle'
  if (mapIcon === 'local_shipping' || mapIcon === 'airport_shuttle' || mapIcon === 'rv_hookup' || mapIcon === 'warehouse')
    return 'heavy'
  if (mapIcon === 'pedal_bike' || mapIcon === 'hiking' || mapIcon === 'train' || mapIcon === 'sailing') return 'other'
  return 'car'
}
