'use client';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';import {useState,type ReactNode} from 'react';
export default function Providers({children}:{children:ReactNode}){const [q]=useState(()=>new QueryClient());return <QueryClientProvider client={q}>{children}</QueryClientProvider>;}
