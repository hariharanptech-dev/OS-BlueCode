import {describe,it,expect} from 'vitest';import {registerSchema,checkoutSchema} from '@/lib/validation/schemas';import {STATUS_COPY} from '@/components/payment/copy';
describe('validation',()=>{
 it('rejects weak password',()=>expect(registerSchema.safeParse({name:'Asha',email:'a@b.co',password:'short'}).success).toBe(false));
 it('requires terms',()=>expect(checkoutSchema.safeParse({planId:'p1',acceptTerms:false}).success).toBe(false));
 it('accepts valid checkout',()=>expect(checkoutSchema.safeParse({planId:'p1',acceptTerms:true}).success).toBe(true));});
describe('payment status',()=>it('has copy for all four states',()=>expect(Object.keys(STATUS_COPY).sort()).toEqual(['CANCELLED','FAILED','PENDING','SUCCESS'])));

import {SUB_LABEL} from '@/components/billing/status';
describe('subscription status',()=>it('labels every status',()=>expect(Object.keys(SUB_LABEL).sort()).toEqual(['ACTIVE','CANCELLED','EXPIRED','NONE'])));

import {featureRows} from '@/lib/utilities/features';
describe('plan comparison',()=>it('marks which plans include each feature',()=>{const r=featureRows([{id:'a',name:'A',description:'',amountLabel:'',features:['x']},{id:'b',name:'B',description:'',amountLabel:'',features:['x','y']}]);expect(r).toEqual([{feature:'x',has:[true,true]},{feature:'y',has:[false,true]}]);}));
