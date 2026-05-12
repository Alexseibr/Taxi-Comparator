import { boolean, integer, jsonb, numeric, pgEnum, pgTable, text, timestamp, uniqueIndex, index, uuid, date } from 'drizzle-orm/pg-core';

const c = () => uuid().defaultRandom().primaryKey();
export const zoneTypeEnum = pgEnum('cct_zone_type',[ 'center','sleeping_district','mall','airport','railway','bus_station','industrial','nightlife','hospital','university','office_cluster','suburb','private_sector','event_area','school_cluster','dead_zone_candidate','other']);
export const routeTypeEnum = pgEnum('cct_route_type',['morning_commute','evening_commute','mall_trip','airport','railway','nightlife','industrial_shift','hospital','university','school_pickup','local_short','cross_city','dead_zone_inbound','dead_zone_outbound','other']);
export const tariffClassEnum = pgEnum('cct_tariff_class',['economy','comfort','comfort_plus','business','minivan','child','delivery','unknown']);
export const validationEnum = pgEnum('cct_validation_status',['pending','validated','rejected','needs_review']);
export const sourceEnum = pgEnum('cct_source',['yandex_go','manual','wb_internal','other']);

export const cityZones = pgTable('cct_city_zones',{
 id:c(), city:text().notNull(), name:text().notNull(), type:zoneTypeEnum().notNull(), polygonGeoJson:jsonb(), centerLat:numeric({precision:10,scale:7}), centerLng:numeric({precision:10,scale:7}), strategicWeight:integer().notNull().default(50), driverSupplyPriority:integer().notNull().default(50), demandPriority:integer().notNull().default(50), notes:text(), createdAt:timestamp().defaultNow().notNull(), updatedAt:timestamp().defaultNow().notNull()
});

export const routePairs = pgTable('cct_route_pairs',{
 id:c(), city:text().notNull(), originZoneId:uuid().notNull(), destinationZoneId:uuid().notNull(), routeKey:text().notNull(), routeName:text().notNull(), distanceKmEstimate:numeric({precision:8,scale:2}), normalDurationMinEstimate:numeric({precision:8,scale:2}), routeType:routeTypeEnum().notNull().default('other'), priority:integer().notNull().default(50), active:boolean().notNull().default(true), notes:text(), createdAt:timestamp().defaultNow().notNull(), updatedAt:timestamp().defaultNow().notNull()
},(t)=>({routeKeyUnique:uniqueIndex('cct_route_pairs_route_key_uq').on(t.routeKey)}));

export const marketObservations = pgTable('cct_market_observations',{
 id:c(), source:sourceEnum().notNull(), city:text().notNull(), capturedAt:timestamp().notNull(), weekday:integer().notNull(), hour:integer().notNull(), minuteSlot:integer().notNull(), originAddress:text(), destinationAddress:text(), originZoneId:uuid(), destinationZoneId:uuid(), routeKey:text(), tariffClass:tariffClassEnum().notNull().default('economy'), price:numeric({precision:10,scale:2}).notNull(), currency:text().notNull().default('BYN'), etaPickupMin:numeric({precision:8,scale:2}), tripDurationMin:numeric({precision:8,scale:2}), distanceKm:numeric({precision:8,scale:2}), surgeDetected:boolean().notNull().default(false), surgeText:text(), availabilityStatus:text().notNull().default('unknown'), screenshotUrl:text(), rawOcrText:text(), ocrConfidence:numeric({precision:5,scale:2}), parserVersion:text(), validationStatus:validationEnum().notNull().default('pending'), validatorComment:text(), createdAt:timestamp().defaultNow().notNull(), updatedAt:timestamp().defaultNow().notNull()
},(t)=>({cityCapturedIdx:index('cct_obs_city_captured_idx').on(t.city,t.capturedAt), cityOdIdx:index('cct_obs_city_od_idx').on(t.city,t.originZoneId,t.destinationZoneId), routeTariffWeekHrIdx:index('cct_obs_route_tariff_week_hr_idx').on(t.routeKey,t.tariffClass,t.weekday,t.hour), validationIdx:index('cct_obs_validation_idx').on(t.validationStatus)}));

export const routeBaselines = pgTable('cct_route_baselines',{
 id:c(), city:text().notNull(), routeKey:text().notNull(), tariffClass:tariffClassEnum().notNull(), weekday:integer().notNull(), hour:integer().notNull(), basePriceP25:numeric({precision:10,scale:2}), basePriceP50:numeric({precision:10,scale:2}), basePriceP75:numeric({precision:10,scale:2}), basePriceAvg:numeric({precision:10,scale:2}), normalEtaPickupP50:numeric({precision:8,scale:2}), sampleSize:integer().notNull().default(0), confidence:numeric({precision:3,scale:2}).notNull().default('0.3'), fallbackUsed:boolean().notNull().default(false), fallbackReason:text(), updatedAt:timestamp().defaultNow().notNull()
});

export const marketSignals = pgTable('cct_market_signals',{
 id:c(), observationId:uuid().notNull(), city:text().notNull(), routeKey:text(), surgeIndex:numeric({precision:8,scale:3}), surgeLevel:text().notNull(), etaPressureIndex:numeric({precision:8,scale:3}), etaPressureLevel:text().notNull(), demandSignalScore:integer().notNull(), supplyShortageScore:integer().notNull(), attackOpportunityScore:integer().notNull(), anomalyScore:integer().notNull(), reasonCodes:jsonb(), explanationText:text().notNull(), createdAt:timestamp().defaultNow().notNull()
});

export const driverEconomicsProfiles = pgTable('cct_driver_economics_profiles',{
 id:c(), city:text().notNull(), vehicleClass:tariffClassEnum().notNull(), fuelCostPerKm:numeric({precision:8,scale:3}).notNull(), maintenanceCostPerKm:numeric({precision:8,scale:3}).notNull(), depreciationCostPerKm:numeric({precision:8,scale:3}).notNull(), platformCommissionPct:numeric({precision:6,scale:4}).notNull(), taxOrOtherPct:numeric({precision:6,scale:4}).notNull().default('0'), driverTargetNetPerHour:numeric({precision:10,scale:2}).notNull(), driverTargetNetPerShift:numeric({precision:10,scale:2}).notNull(), minAcceptableNetPerTrip:numeric({precision:10,scale:2}).notNull(), avgIdleKmBetweenOrders:numeric({precision:8,scale:2}).notNull(), avgPickupKm:numeric({precision:8,scale:2}).notNull(), expectedIdleMin:numeric({precision:8,scale:2}).notNull(), active:boolean().notNull().default(true), createdAt:timestamp().defaultNow().notNull(), updatedAt:timestamp().defaultNow().notNull()
});

export const priceCorridorRecommendations = pgTable('cct_price_corridor_recommendations',{
 id:c(), city:text().notNull(), routeKey:text().notNull(), tariffClass:tariffClassEnum().notNull(), validFrom:timestamp().notNull(), validTo:timestamp().notNull(), yandexExpectedPrice:numeric({precision:10,scale:2}), aggressivePrice:numeric({precision:10,scale:2}).notNull(), growthPrice:numeric({precision:10,scale:2}).notNull(), balancedPrice:numeric({precision:10,scale:2}).notNull(), profitablePrice:numeric({precision:10,scale:2}).notNull(), driverProtectionPrice:numeric({precision:10,scale:2}).notNull(), selectedPrice:numeric({precision:10,scale:2}).notNull(), selectedMode:text().notNull(), clientDiscountPct:numeric({precision:6,scale:2}), requiredDriverBonus:numeric({precision:10,scale:2}), confidence:numeric({precision:3,scale:2}).notNull().default('0.5'), explanationText:text().notNull(), createdAt:timestamp().defaultNow().notNull()
});
