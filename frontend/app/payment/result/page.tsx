'use client';

import { Suspense, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { getPaymentStatus } from '@/lib/api/endpoints';
import { StatusView } from '@/components/payment/StatusView';
import type { PaymentStatus } from '@/types';

function ResultContent() {
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();

  const orderId = searchParams.get('orderId') ?? '';

  const { data, error, isLoading } = useQuery({
    queryKey: ['pay', orderId],
    queryFn: () => getPaymentStatus(orderId),
    enabled: Boolean(orderId),
    refetchInterval: (q) => (!q.state.data || q.state.data.status === 'PENDING' || q.state.data.status === 'VERIFICATION_PENDING') ? 2500 : false,
  });

  useEffect(() => {
    if (data?.status === 'SUCCESS') {
      queryClient.invalidateQueries({ queryKey: ['sub'] });
      queryClient.invalidateQueries({ queryKey: ['hist'] });
      queryClient.invalidateQueries({ queryKey: ['me'] });
    }
  }, [data?.status, queryClient]);

  if (!orderId) {
    return <p role="alert" className="card max-w-md mx-auto text-center text-ink">No order reference provided.</p>;
  }

  if (error) {
    return <p role="alert" className="card max-w-md mx-auto text-center text-warn">{(error as Error).message}</p>;
  }

  const currentStatus: PaymentStatus = data?.status ?? 'PENDING';

  return (
    <StatusView
      status={currentStatus}
      orderId={data?.orderId ?? orderId}
      txnRef={data?.txnRef}
      amount={data?.amount}
      currency={data?.currency ?? 'INR'}
      planName={data?.planName}
    />
  );
}

export default function PaymentResultPage() {
  return (
    <Suspense fallback={<StatusView status="PENDING" />}>
      <ResultContent />
    </Suspense>
  );
}
