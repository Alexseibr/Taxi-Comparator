import { Router } from 'express';
import { baselineStats, calcMarketSignal, calculateMinDriverEconomicsPrice, generatePriceCorridor } from '../services/core';

const router=Router();
router.get('/zones',(_req,res)=>res.json({items:[]}));
router.post('/zones',(req,res)=>res.status(201).json({item:req.body}));
router.get('/routes',(_req,res)=>res.json({items:[]}));
router.post('/observations',(req,res)=>res.status(201).json({item:req.body}));
router.post('/baselines/recalculate',(req,res)=>{ const p=Array.isArray(req.body.prices)?req.body.prices.map(Number):[]; const e=Array.isArray(req.body.etas)?req.body.etas.map(Number):[]; res.json(baselineStats({prices:p,etas:e,sampleSize:p.length})); });
router.post('/signals/recalculate',(req,res)=>{ const b=req.body||{}; res.json(calcMarketSignal(Number(b.observed||0),Number(b.baseline||1),Number(b.eta||0),Number(b.baselineEta||1)));});
router.post('/driver-profitability/calculate',(req,res)=>{ const b=req.body||{}; const min=calculateMinDriverEconomicsPrice(b); res.json({minDriverEconomicsPrice:min,requiredBonus:Math.max(0,min-(b.clientPrice??min))});});
router.post('/pricing/corridor',(req,res)=>{const b=req.body||{}; res.json(generatePriceCorridor(Number(b.yandexExpectedPrice||0),Number(b.minDriverEconomicsPrice||0)));});

export default router;
