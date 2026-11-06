import type {Plan} from '@/types';
/** Rows for the plan comparison table: every feature named by any plan, in first-seen order. */
export function featureRows(plans:Plan[]){const all=[...new Set(plans.flatMap(p=>p.features))];return all.map(f=>({feature:f,has:plans.map(p=>p.features.includes(f))}));}
