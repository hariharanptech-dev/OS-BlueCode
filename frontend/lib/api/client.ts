export class ApiError extends Error{constructor(public status:number,message:string){super(message)}}
import {mockApi} from '../mock';
export async function api<T>(path:string,init?:RequestInit):Promise<T>{
  if(process.env.NEXT_PUBLIC_USE_MOCK==='true')return (await mockApi(path,init)) as T;
  let res:Response;
  try{res=await fetch(`/api/v1${path}`,{credentials:'include',headers:{'Content-Type':'application/json'},...init});}
  catch{throw new ApiError(0,'Cannot reach the server. Check your connection and try again.');}
  if(!res.ok){const b=await res.json().catch(()=>({}));throw new ApiError(res.status,(b as{message?:string}).message??'Something went wrong. Try again.');}
  return res.json() as Promise<T>;
}
