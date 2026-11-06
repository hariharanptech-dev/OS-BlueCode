/** DEVELOPMENT ONLY (NEXT_PUBLIC_USE_MOCK=true). Seed data is placeholder, not real business data. Never reports a payment as successful. */
const plans=[{id:'seed-basic',name:'Basic (seed)',description:'Placeholder plan',features:['Seed feature A'],amountLabel:'Configured by backend'},{id:'seed-pro',name:'Pro (seed)',description:'Placeholder plan',features:['Seed feature A','Seed feature B'],recommended:true,amountLabel:'Configured by backend'}];
export async function mockApi(path:string,init?:RequestInit):Promise<unknown>{
  const p=path.split('?')[0]??'';
  if(p==='/plans')return plans;
  if(p==='/auth/me')return {id:'mock',name:'Mock User',email:'mock@example.test'};
  if(p==='/subscriptions/me')return {planName:'None',status:'NONE'};
  if(p==='/payments/history')return {items:[],page:1,pageCount:1};
  if(p==='/payments/initiate')return {orderId:'MOCK-1',amount:'0',currency:'INR',total:'0',redirect:{url:'/payment/MOCK-1',method:'POST',fields:{}}};
  if(p.startsWith('/payments/'))return {orderId:'MOCK-1',status:'PENDING'};
  void init;return {ok:true,id:'mock',email:'mock@example.test'};
}
