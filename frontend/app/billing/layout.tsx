import type {ReactNode} from 'react';import AuthGate from '@/components/layout/AuthGate';
export default function L({children}:{children:ReactNode}){return <AuthGate>{children}</AuthGate>;}
