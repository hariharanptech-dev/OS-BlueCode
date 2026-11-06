'use client';import {useEffect,type ReactNode} from 'react';import {useQuery} from '@tanstack/react-query';import {getMe} from '@/lib/api/endpoints';import {ApiError} from '@/lib/api/client';
export default function AuthGate({children}:{children:ReactNode}){
 const {isLoading,error,data}=useQuery({queryKey:['me'],queryFn:getMe,retry:false});
 const denied=error instanceof ApiError&&error.status===401;
 useEffect(()=>{if(denied)window.location.href='/login';},[denied]);
 if(isLoading||denied)return <div role="status" className="card h-40 animate-pulse" aria-label="Checking your session"/>;
 if(error)return <p role="alert" className="card">{(error as Error).message}</p>;
 return data?<>{children}</>:null;}
