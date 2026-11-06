import type {SubStatus} from '@/types';
export const SUB_LABEL:Record<SubStatus,string>={ACTIVE:'Active',EXPIRED:'Expired',CANCELLED:'Cancelled',NONE:'No subscription'};
export const fmtDate=(iso?:string)=>iso?new Date(iso).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}):'—';
