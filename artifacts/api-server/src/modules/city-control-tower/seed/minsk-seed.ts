export const minskZones = ['Центр','Каменная Горка','Уручье','Малиновка','Лошица','Серебрянка','Зелёный Луг','Новая Боровая','Вокзал','Аэропорт','Зыбицкая/Октябрьская','Шабаны','Ждановичи','Экспобел','Больничный кластер','Школьный кластер'];
export const minskRoutes=[
['Каменная Горка','Центр','morning_commute'],['Уручье','Центр','morning_commute'],['Малиновка','Центр','morning_commute'],['Центр','Каменная Горка','evening_commute'],['Центр','Лошица','evening_commute'],['Зыбицкая/Октябрьская','Каменная Горка','nightlife'],['Вокзал','Центр','railway'],['Центр','Аэропорт','airport'],['Аэропорт','Центр','airport'],['Шабаны','Центр','industrial_shift'],['Экспобел','Центр','mall_trip'],['Центр','Новая Боровая','dead_zone_inbound'],['Новая Боровая','Центр','dead_zone_outbound']
];
export function fakeObservations(count=150){
 return Array.from({length:count}).map((_,i)=>({city:'Minsk',source:'manual',weekday:i%7,hour:i%24,minuteSlot:[0,15,30,45][i%4],tariffClass:i%5===0?'comfort':'economy',price:8+(i%30),etaPickupMin:3+(i%12),tripDurationMin:10+(i%25),distanceKm:2+(i%18),validationStatus:'validated'}));
}
