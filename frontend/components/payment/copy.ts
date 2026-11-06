import type {PaymentStatus} from '@/types';
export const STATUS_COPY:Record<PaymentStatus,{title:string;body:string}>={
 SUCCESS:{title:'Payment confirmed',body:'Your subscription is active.'},
 FAILED:{title:'Payment failed',body:'You were not charged. Try again or use a different payment method.'},
 CANCELLED:{title:'Payment cancelled',body:'No charge was made. You can return to checkout when ready.'},
 PENDING:{title:'Verifying your payment',body:'We are waiting for confirmation from the bank. This page updates automatically.'},
 CREATED:{title:'Payment initiated',body:'Your payment has been created. Redirecting to PayU...'},
 VERIFICATION_PENDING:{title:'Verifying your payment',body:'We are waiting for confirmation from PayU. This page updates automatically.'},
 EXPIRED:{title:'Payment expired',body:'The payment session has expired. Please try again.'}};
