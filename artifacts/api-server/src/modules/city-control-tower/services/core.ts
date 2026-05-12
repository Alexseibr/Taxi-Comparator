export type BaselineInput = { prices:number[]; etas:number[]; sampleSize:number };
export const percentile=(arr:number[],p:number)=>{ if(!arr.length) return 0; const s=[...arr].sort((a,b)=>a-b); const i=(s.length-1)*p; const lo=Math.floor(i), hi=Math.ceil(i); return s[lo]+(s[hi]-s[lo])*(i-lo); };
export const baselineStats=(input:BaselineInput)=>({
  p25:percentile(input.prices,0.25), p50:percentile(input.prices,0.5), p75:percentile(input.prices,0.75), avg:input.prices.reduce((a,b)=>a+b,0)/(input.prices.length||1), etaP50:percentile(input.etas,0.5), confidence: input.sampleSize>=20?0.9:input.sampleSize>=10?0.7:input.sampleSize>=5?0.5:0.3
});

export const surgeLevel=(x:number)=> x<1.15?'normal':x<1.3?'mild':x<1.5?'high':'extreme';
export const etaLevel=(x:number)=> x<1.2?'normal':x<1.5?'mild':x<2?'high':'critical';

export const calcMarketSignal=(observed:number, baseline:number, eta:number, baselineEta:number)=>{
  const surge=observed/(baseline||1); const etaPressure=eta/(baselineEta||1);
  const surgeScore=Math.min(100,Math.round((surge-1)*100)); const etaScore=Math.min(100,Math.round((etaPressure-1)*100));
  const attack=Math.max(0,Math.min(100,Math.round(surgeScore*0.3+etaScore*0.2+40*0.15+40*0.15+50*0.15+50*0.05)));
  return { surgeIndex:surge, surgeLevel:surgeLevel(surge), etaPressureIndex:etaPressure, etaPressureLevel:etaLevel(etaPressure), attackOpportunityScore:attack };
};

export const calculateMinDriverEconomicsPrice=(x:{driverTargetNetPerHour:number;tripDurationMin:number;etaPickupMin:number;expectedIdleMin:number;fuelCostPerKm:number;maintenanceCostPerKm:number;depreciationCostPerKm:number;distanceKm:number;avgPickupKm:number;avgIdleKmBetweenOrders:number;commissionPct:number;taxPct:number;})=>{
 const t=(x.tripDurationMin+x.etaPickupMin+x.expectedIdleMin)/60; const target=x.driverTargetNetPerHour*t; const costPerKm=x.fuelCostPerKm+x.maintenanceCostPerKm+x.depreciationCostPerKm; const totalKm=x.distanceKm+x.avgPickupKm+x.avgIdleKmBetweenOrders; const costs=totalKm*costPerKm; return (target+costs)/(1-x.commissionPct-x.taxPct);
};
export const generatePriceCorridor=(yandex:number,min:number)=>{ const ag=yandex*0.8, gr=yandex*0.87, ba=yandex*0.93, pr=yandex*0.97, dp=Math.max(min,pr); return {aggressivePrice:ag,growthPrice:gr,balancedPrice:ba,profitablePrice:pr,driverProtectionPrice:dp};};
