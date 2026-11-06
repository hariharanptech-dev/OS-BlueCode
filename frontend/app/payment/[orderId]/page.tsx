'use client';import {useQuery} from '@tanstack/react-query';import {useParams} from 'next/navigation';import {getPaymentStatus} from '@/lib/api/endpoints';import {StatusView} from '@/components/payment/StatusView';
export default function PaymentResult(){const {orderId}=useParams<{orderId:string}>();
 const {data,error}=useQuery({queryKey:['pay',orderId],queryFn:()=>getPaymentStatus(orderId),refetchInterval:q=>(!q.state.data||q.state.data.status==='PENDING')?3000:false});
 if(error)return <p role="alert">{(error as Error).message}</p>;
 return <StatusView status={data?.status??'PENDING'}/>;}
